// Build script: bundles the TypeScript entry points with esbuild and copies the
// static files (manifest, HTML, CSS, icons) into dist/.
//
//   node build.mjs           one-off build into dist/
//   node build.mjs --watch   rebuild on change
//   node build.mjs --zip     build, then write answerkey-edge-v<version>.zip
//                            (the package to upload to the Edge Add-ons store)

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const entryPoints = {
  background: join(src, 'background/index.ts'),
  content: join(src, 'content/index.ts'),
  options: join(src, 'pages/options.ts'),
  popup: join(src, 'pages/popup.ts'),
  answer: join(src, 'pages/answer.ts'),
};

async function copyStatic() {
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  for (const file of await readdir(join(src, 'pages'))) {
    if (file.endsWith('.html') || file.endsWith('.css')) {
      await cp(join(src, 'pages', file), join(dist, file));
    }
  }
  await cp(join(root, 'icons'), join(dist, 'icons'), {
    recursive: true,
    filter: (path) => !path.endsWith('.svg'),
  });
}

const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await copyStatic();
        if (watch) console.log(`[${new Date().toLocaleTimeString()}] rebuilt dist/`);
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints,
  outdir: dist,
  bundle: true,
  // Content scripts cannot be ES modules, so every bundle is a plain IIFE.
  format: 'iife',
  platform: 'browser',
  target: ['chrome116'],
  // The content script loads in every frame of every page, so release builds are
  // minified. Watch builds stay readable, with source maps, for debugging.
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'eof',
  logLevel: 'info',
  plugins: [copyStaticPlugin],
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching for changes... (load the dist/ folder as an unpacked extension)');
} else {
  await esbuild.build(options);
  if (zip) {
    const out = join(root, `answerkey-edge-v${pkg.version}.zip`);
    await writeZip(dist, out);
    console.log(`Wrote ${relative(root, out)}`);
  }
}

// Minimal ZIP writer (deflate), so packaging needs no extra tools on any OS.
async function writeZip(dir, outFile) {
  const files = await listFiles(dir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = await readFile(file);
    const name = Buffer.from(relative(dir, file).split('\\').join('/'));
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  await writeFile(outFile, Buffer.concat([...localParts, ...centralParts, end]));
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else out.push(path);
  }
  return out.sort();
}
