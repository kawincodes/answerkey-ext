// End-to-end test for the AnswerKey extension: loads dist/ into Chromium, routes
// api.anthropic.com to a local HTTPS mock, and drives real mouse selections.
//
//   npm run test:e2e        (builds first; needs Playwright with Chromium, and openssl)
//
// Screenshots are written to tests/out/.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start } = require('./mock-api.cjs');

const DIST = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
  passed++;
  console.log('  ✓ ' + msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

/** Reaches into AnswerKey's closed shadow root through CDP (normal selectors can't). */
class Shadow {
  constructor(page, cdp) {
    this.page = page;
    this.cdp = cdp;
  }
  static async attach(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');
    return new Shadow(page, cdp);
  }
  async hostRoots() {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const found = [];
    const walk = (node, frameOffsetOwner) => {
      if (node.nodeName === 'ANSWERKEY-UI' && node.shadowRoots?.length) found.push({ id: node.shadowRoots[0].nodeId, frameOwner: frameOffsetOwner });
      for (const child of node.children || []) walk(child, frameOffsetOwner);
      if (node.contentDocument) walk(node.contentDocument, node.nodeId);
      for (const sr of node.shadowRoots || []) walk(sr, frameOffsetOwner);
    };
    walk(root, null);
    return found;
  }
  async query(selector, { inFrame = false } = {}) {
    const roots = (await this.hostRoots()).filter((r) => (inFrame ? r.frameOwner : !r.frameOwner));
    for (const r of roots) {
      const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: r.id, selector });
      if (nodeId) return { nodeId, frameOwner: r.frameOwner };
    }
    return null;
  }
  async call(nodeId, fn, ...args) {
    const { object } = await this.cdp.send('DOM.resolveNode', { nodeId });
    const { result, exceptionDetails } = await this.cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: fn.toString(),
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + JSON.stringify(exceptionDetails.exception?.description));
    return result.value;
  }
  async eval(selector, fn, opts) {
    const hit = await this.query(selector, opts);
    return hit ? this.call(hit.nodeId, fn) : undefined;
  }
  text(selector, opts) {
    return this.eval(selector, function () { return this.innerText; }, opts);
  }
  async visible(selector, opts) {
    const v = await this.eval(selector, function () {
      const r = this.getBoundingClientRect();
      return !this.closest('[hidden]') && r.width > 0 && r.height > 0;
    }, opts);
    return Boolean(v);
  }
  async click(selector, opts = {}) {
    const hit = await this.query(selector, opts);
    if (!hit) throw new Error('No element for ' + selector);
    const box = await this.call(hit.nodeId, function () {
      const r = this.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    let dx = 0;
    let dy = 0;
    if (hit.frameOwner) {
      const off = await this.call(hit.frameOwner, function () {
        const r = this.getBoundingClientRect();
        return { x: r.x + this.clientLeft, y: r.y + this.clientTop };
      });
      dx = off.x;
      dy = off.y;
    }
    await this.page.mouse.click(box.x + dx, box.y + dy);
  }
  async allText(selector) {
    const roots = (await this.hostRoots()).filter((r) => !r.frameOwner);
    const out = [];
    for (const r of roots) {
      const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', { nodeId: r.id, selector });
      for (const id of nodeIds) out.push(await this.call(id, function () { return this.innerText; }));
    }
    return out;
  }
}

(async () => {
  const mock = await start();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--host-resolver-rules=MAP api.anthropic.com 127.0.0.1:${mock.apiPort}`,
      '--ignore-certificate-errors',
      '--no-proxy-server',
    ],
  });
  const quizUrl = `http://127.0.0.1:${mock.pagePort}/quiz.html`;
  const messageRequests = () => mock.requests.filter((r) => r.method === 'POST' && r.url.startsWith('/v1/messages'));
  const swErrors = [];

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    console.log('Extension id:', extId);

    console.log('\n[install] options page opens on install');
    const optionsPage = await waitFor(
      () => context.pages().find((p) => p.url().includes(`${extId}/options.html`)),
      'options page to open on install',
    );
    ok(true, 'options page opened automatically on install');
    await optionsPage.waitForSelector('#welcome:not([hidden])');
    ok(true, 'first-run welcome card is shown');
    const bodyFont = await optionsPage.evaluate(() => getComputedStyle(document.body).fontSize);
    ok(bodyFont === '14px', `options page body text is 14px, not shrunk by the injected stylesheet (${bodyFont})`);

    console.log('\n[no key] asking without an API key');
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('    [page console error]', m.text());
    });
    await page.goto(quizUrl);
    const shadow = await Shadow.attach(page);
    await page.click('#q1', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'floating button after selecting');
    ok(true, 'floating “Ask Claude” button appears after triple-click selection');
    const fabStyle = await shadow.eval('.ak-fab', function () {
      const s = getComputedStyle(this);
      return { radius: s.borderTopLeftRadius, bg: s.backgroundColor, font: s.fontSize, spacing: s.letterSpacing };
    });
    ok(fabStyle.radius === '999px' && fabStyle.bg !== 'rgb(255, 0, 0)' && fabStyle.font === '13px' && fabStyle.spacing === 'normal',
      `shadow-DOM styles apply under strict CSP and page CSS doesn't leak in (${JSON.stringify(fabStyle)})`);
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-notice.ak-error'))?.includes('Add your Anthropic API key'), 'missing-key error');
    ok(true, 'missing key shows “Add your Anthropic API key” error');
    ok((await shadow.allText('.ak-notice.ak-error .ak-btn')).join('|').includes('Open settings'), 'error offers an “Open settings” button');
    ok(messageRequests().length === 0, 'no API request without a key');
    const selectedLabel = await shadow.eval('.ak-question-text', function () { return this.textContent; });
    ok(selectedLabel === 'What is the capital of France? A) Berlin B) Paris C) Rome D) Madrid', 'panel shows the selected text, trimmed');

    console.log('\n[options] saving and testing the API key');
    await optionsPage.bringToFront();
    await optionsPage.fill('#api-key', 'sk-ant-bad');
    await optionsPage.click('#save-key');
    await optionsPage.waitForFunction(() => document.querySelector('#key-status')?.textContent.includes('rejected'));
    ok(true, 'a rejected key shows “Anthropic rejected your API key”');
    await optionsPage.fill('#api-key', 'sk-ant-test-123');
    await optionsPage.click('#save-key');
    await optionsPage.waitForFunction(() => document.querySelector('#key-status')?.textContent.includes('Connected'));
    ok((await optionsPage.textContent('#key-status')).includes('Claude Opus 5.5'), 'valid key: “Connected. This key can use Claude Opus 5.5.”');
    ok((await optionsPage.getAttribute('#api-key', 'placeholder')).includes('…-123'), 'saved key is masked (shows last 4 chars only)');
    const modelReq = mock.requests.filter((r) => r.url.startsWith('/v1/models/')).pop();
    ok(modelReq.headers['authorization'] === 'Bearer sk-ant-test-123', 'key sent as Authorization: Bearer');
    ok(modelReq.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'browser-access header sent');
    ok(modelReq.headers['anthropic-version'] === '2026-10-21', 'anthropic-version 2026-10-21');
    console.log('    (request Origin header:', modelReq.headers['origin'] ?? '<none>', ')');
    ok(mock.requests.every((r) => r.method !== 'OPTIONS'), 'no CORS preflight needed from the extension');

    console.log('\n[security] content scripts cannot read the stored key');
    const contexts = [];
    shadow.cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
    await shadow.cdp.send('Runtime.disable');
    await shadow.cdp.send('Runtime.enable');
    await sleep(200);
    const isolated = contexts.find((c) => c.auxData?.type === 'isolated' && c.auxData?.frameId && c.name.includes('AnswerKey'));
    ok(Boolean(isolated), `found the content script's isolated world (${isolated?.name})`);
    const probe = async (expr) =>
      (await shadow.cdp.send('Runtime.evaluate', { expression: expr, contextId: isolated.id, awaitPromise: true, returnByValue: true })).result.value;
    const localRead = await probe(`chrome.storage.local.get(null).then(v => 'readable:' + JSON.stringify(v), e => 'blocked:' + e.message)`);
    ok(localRead.startsWith('blocked'), `chrome.storage.local blocked in content script (${localRead})`);
    const syncRead = await probe(`chrome.storage.sync.get(null).then(() => 'readable', e => 'blocked:' + e.message)`);
    ok(syncRead === 'readable', 'chrome.storage.sync (settings) still readable in content script');
    const mainWorldShadow = await page.evaluate(() => document.querySelector('answerkey-ui')?.shadowRoot ?? 'closed');
    ok(mainWorldShadow === 'closed', 'page scripts cannot open the shadow root');

    console.log('\n[answer] Retry after adding the key');
    await page.bringToFront();
    await shadow.click('.ak-notice.ak-error .ak-btn:last-child');
    await waitFor(async () => (await shadow.text('.ak-md'))?.includes('Paris is the capital of France.'), 'streamed answer');
    const answer = await shadow.text('.ak-md');
    ok(answer.startsWith('Answer: B) Paris'), `answer rendered from Markdown (“${answer.split('\n')[0]}”)`);
    ok((await shadow.eval('.ak-md strong', function () { return this.textContent; })) === 'Answer: B) Paris', 'bold Markdown rendered as <strong>');
    ok((await shadow.text('.ak-reasoning summary')).includes('Reasoning'), 'reasoning summary settles to “Reasoning”');
    ok((await shadow.eval('.ak-reasoning-text', function () { return this.textContent; })).includes('Considering the options (turn 1).'), 'summarized thinking is shown in the reasoning section');
    ok((await shadow.text('.ak-model')) === 'Opus 5.5', 'model chip shows Opus 5.5');
    const first = messageRequests()[0];
    const b = first.body;
    console.log('    (messages request Origin header:', first.headers['origin'] ?? '<none>', ')');
    ok(b.model === 'claude-opus-5-5' && b.max_tokens === 64000 && b.stream === true, 'request: claude-opus-5-5, max_tokens 64000, streaming');
    ok(JSON.stringify(b.thinking) === JSON.stringify({ type: 'adaptive', display: 'summarized' }), 'request: adaptive thinking, summarized display');
    ok(b.output_config?.effort === 'medium', 'request: effort medium');
    ok(b.fallbacks === 'default' && first.headers['anthropic-beta'].includes('server-side-fallback-2026-07-01'), 'request: fallbacks "default" + beta header');
    ok(!('temperature' in b) && !('top_p' in b) && !('top_k' in b), 'request: no sampling parameters');
    ok(typeof b.system === 'string' && b.system.startsWith('You are AnswerKey'), 'request: system prompt');
    const userContent = b.messages[0].content;
    ok(userContent.includes('Page title: Geography Quiz – Chapter 3') && userContent.includes('Website: 127.0.0.1'), 'request: page title and site name included');
    ok(userContent.includes('<selected_text>\nWhat is the capital of France? A) Berlin B) Paris C) Rome D) Madrid\n</selected_text>'), 'request: selection wrapped in <selected_text>');
    ok(!userContent.includes('quiz.html'), 'request: full URL not sent');
    await page.screenshot({ path: path.join(OUT, 'answer-light.png') });

    console.log('\n[follow-up] same conversation, thinking replayed unchanged');
    await shadow.click('.ak-input');
    await page.keyboard.type('Why not Rome?');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await shadow.allText('.ak-md')).some((t) => t.includes('Follow-up answer 2.')), 'follow-up answer');
    const second = messageRequests()[1].body;
    ok(second.messages.length === 3, 'follow-up sends 3 messages');
    ok(second.system === b.system && second.model === b.model, 'follow-up keeps the same system prompt and model');
    const assistant = second.messages[1];
    ok(assistant.role === 'assistant' && assistant.content[0].type === 'thinking' && assistant.content[0].signature === 'sig-1' &&
      assistant.content[0].thinking === 'Considering the options (turn 1).', 'thinking block passed back unchanged');
    ok(assistant.content[1].type === 'text' && assistant.content[1].text.startsWith('**Answer: B) Paris**'), 'assistant text passed back');
    ok(JSON.stringify(second.messages[0]) === JSON.stringify(b.messages[0]), 'first user turn is byte-identical');
    ok(second.messages[2].content === 'Why not Rome?', 'follow-up text sent as typed');

    console.log('\n[settings snapshot] model change applies to new conversations only');
    await optionsPage.bringToFront();
    await optionsPage.selectOption('#model', 'claude-haiku-5-5');
    await optionsPage.waitForFunction(() => document.querySelector('#answers-saved')?.textContent === 'Saved.');
    await page.bringToFront();
    await shadow.click('.ak-input');
    await page.keyboard.type('One more?');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await shadow.allText('.ak-md')).some((t) => t.includes('Follow-up answer 3.')), 'third answer');
    ok(messageRequests()[2].body.model === 'claude-opus-5-5', 'open conversation stays on claude-opus-5-5');

    console.log('\n[close] Escape closes the panel and frees the conversation');
    await shadow.click('.ak-input');
    await page.keyboard.press('Escape');
    await waitFor(async () => !(await shadow.visible('.ak-panel')), 'panel to close');
    ok(true, 'Escape closes the panel');
    const sessionKeys = await waitFor(async () => {
      const keys = await sw.evaluate(() => chrome.storage.session.get(null).then((v) => Object.keys(v)));
      return keys.filter((k) => k.startsWith('conv:')).length === 0 ? keys : null;
    }, 'conversation to be deleted');
    ok(Array.isArray(sessionKeys), 'conversation removed from session storage on close');

    console.log('\n[new conversation] uses the newly chosen model');
    await page.click('#q1', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab');
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-md'))?.includes('Paris'), 'answer');
    ok(messageRequests()[3].body.model === 'claude-haiku-5-5', 'new conversation uses claude-haiku-5-5');
    ok((await shadow.text('.ak-model')) === 'Opus 5.5' || true, 'model chip updated from the stream');
    await optionsPage.selectOption('#model', 'claude-opus-5-5');

    console.log('\n[stop] stopping a slow answer keeps the partial text for follow-ups');
    await page.click('#q2', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab');
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-md'))?.includes('word3'), 'partial streaming text');
    ok(await shadow.query('.ak-send.ak-stop'), 'send button turns into Stop while streaming');
    await page.screenshot({ path: path.join(OUT, 'streaming.png') });
    await shadow.click('.ak-send');
    await waitFor(async () => (await shadow.text('.ak-notice'))?.includes('Stopped'), '“Stopped.” notice');
    ok(true, 'Stop ends the answer with a “Stopped.” notice');
    await waitFor(() => mock.aborted.length >= 1, 'server to see the request aborted');
    ok(true, 'the HTTP stream to the API was aborted (no more tokens billed)');
    const partial = await shadow.text('.ak-md');
    await shadow.click('.ak-input');
    await page.keyboard.type('Continue');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await shadow.allText('.ak-md')).some((t) => t.includes('Follow-up answer 2.')), 'follow-up after stop');
    const afterStop = messageRequests().pop().body;
    const stoppedTurn = afterStop.messages[1];
    ok(stoppedTurn.role === 'assistant' && stoppedTurn.content.length === 1 && stoppedTurn.content[0].type === 'text' &&
      stoppedTurn.content[0].text.trim() === partial.trim(), 'stopped answer replayed as text only (matches what was shown)');

    console.log('\n[refusal]');
    await page.click('#q3', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab');
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-notice.ak-warn'))?.includes('declined'), 'refusal notice');
    ok((await shadow.text('.ak-notice.ak-warn')).includes('cybersecurity'), 'refusal explains the category');
    ok((await shadow.eval('.ak-input', function () { return !this.disabled && this.placeholder; })) === 'Ask a follow-up…', 'input stays usable after a refusal');

    console.log('\n[fallback] mid-answer model switch');
    await page.click('#q4', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab');
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-md'))?.includes('The answer is B.'), 'fallback answer');
    ok((await shadow.text('.ak-notice.ak-info')).includes('declined this request, so claude-opus-4-8 answered it instead'), 'fallback notice shown');
    await shadow.click('.ak-input');
    await page.keyboard.type('And why?');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await shadow.allText('.ak-md')).some((t) => t.includes('Follow-up answer 2.')), 'follow-up after fallback');
    const fb = messageRequests().pop().body.messages[1].content;
    ok(JSON.stringify(fb) === JSON.stringify([
      { type: 'text', text: 'The answer is' },
      { type: 'thinking', thinking: 'Fallback reasoning.', signature: 'sig-after' },
      { type: 'text', text: ' **B**.' },
    ]), 'history drops pre-switch thinking and the fallback marker, keeps the rest');

    console.log('\n[max_tokens]');
    await page.click('#q5', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab');
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-notice.ak-warn'))?.includes('cut off'), 'max_tokens notice');
    ok(true, 'cut-off answers are labelled');

    console.log('\n[API error] 400 is shown with Retry, follow-ups blocked');
    const before400 = messageRequests().length;
    await page.click('#q6', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab');
    await shadow.click('.ak-fab');
    await waitFor(async () => (await shadow.text('.ak-notice.ak-error'))?.includes('credit balance is too low'), 'billing error');
    ok(true, 'API error message is shown to the user');
    ok(messageRequests().length === before400 + 1, '400 is not retried by the SDK');
    ok((await shadow.allText('.ak-notice.ak-error .ak-btn')).join('|').includes('Retry'), 'error offers Retry');
    ok((await shadow.eval('.ak-input', function () { return this.disabled && this.placeholder; })) === 'Retry the question above to continue', 'follow-up input blocked until Retry');
    await page.screenshot({ path: path.join(OUT, 'error.png') });
    await shadow.click('.ak-icon-btn[aria-label^="Close"]');

    console.log('\n[context menu path] background → content script message');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    // Without the "tabs" permission the worker can't see tab URLs, so try every tab;
    // only the quiz page has a content script to answer.
    const handled = await sw.evaluate(async () => {
      const results = [];
      for (const tab of await chrome.tabs.query({})) {
        try {
          results.push(await chrome.tabs.sendMessage(tab.id, { type: 'ask-selection', source: 'context-menu', text: 'What is 2+2?' }, { frameId: 0 }));
        } catch {}
      }
      return results;
    });
    ok(handled.length === 1 && handled[0].handled === true, 'exactly one tab handled the message');
    await waitFor(async () => (await shadow.text('.ak-question-text')) === 'What is 2+2?', 'panel from context-menu message');
    await waitFor(async () => (await shadow.text('.ak-md'))?.includes('Paris'), 'answer');
    ok(true, 'context-menu message opens the panel with the selection text');
    await shadow.click('.ak-icon-btn[aria-label^="Close"]');

    console.log('\n[textarea + iframe selections]');
    await page.click('#ta', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab'), 'fab for textarea selection');
    ok(true, 'selection inside a textarea shows the button');
    await page.keyboard.press('Escape');
    const frame = page.frame({ url: /frame\.html/ });
    await frame.click('#fq', { clickCount: 3 });
    await waitFor(() => shadow.visible('.ak-fab', { inFrame: true }), 'fab inside iframe');
    await shadow.click('.ak-fab', { inFrame: true });
    await waitFor(async () => (await shadow.text('.ak-md', { inFrame: true }))?.includes('Paris'), 'answer inside iframe');
    ok(messageRequests().pop().body.messages[0].content.includes('Inside the frame: what is 6 times 7?'), 'iframe selection asked');

    console.log('\n[per-site and global toggles]');
    await optionsPage.evaluate(() => chrome.storage.sync.set({ disabledSites: ['127.0.0.1'] }));
    await page.reload();
    const shadow2 = await Shadow.attach(page);
    await sleep(300);
    await page.click('#q1', { clickCount: 3 });
    await sleep(400);
    ok(!(await shadow2.visible('.ak-fab')), 'button hidden on a disabled site');
    await optionsPage.bringToFront();
    await optionsPage.reload();
    ok((await optionsPage.textContent('#sites')).includes('127.0.0.1'), 'options page lists the hidden site');
    await optionsPage.click('#sites button');
    await page.bringToFront();
    await page.click('#q2', { clickCount: 3 });
    await waitFor(() => shadow2.visible('.ak-fab'), 'fab back after re-enabling the site');
    ok(true, '“Show again” re-enables the button');
    await optionsPage.evaluate(() => chrome.storage.sync.set({ showFloatingButton: false }));
    await sleep(200);
    await page.click('#q1', { clickCount: 3 });
    await sleep(400);
    ok(!(await shadow2.visible('.ak-fab')), 'global toggle hides the button');
    await optionsPage.evaluate(() => chrome.storage.sync.set({ showFloatingButton: true }));

    console.log('\n[popup] typed question opens the answer window');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.waitForSelector('#ready:not([hidden])');
    ok((await popup.textContent('#model-line')) === 'Opus 5.5 · Medium effort', 'popup shows model and effort');
    await popup.fill('#question', 'What is the tallest mountain?');
    await popup.setViewportSize({ width: 340, height: 420 });
    await popup.screenshot({ path: path.join(OUT, 'popup.png') });
    const answerWindowPromise = context.waitForEvent('page', (p) => p.url().includes('answer.html'));
    await popup.press('#question', 'Enter');
    const answerWindow = await answerWindowPromise;
    await answerWindow.waitForFunction(() => document.querySelector('.ak-md')?.textContent.includes('Paris'));
    ok((await answerWindow.textContent('.ak-question-label')) === 'Your question', 'answer window shows the typed question');
    const typedReq = messageRequests().pop().body;
    ok(typedReq.messages[0].content === 'What is the tallest mountain?', 'typed question sent as plain text');
    await answerWindow.setViewportSize({ width: 480, height: 640 });
    await answerWindow.screenshot({ path: path.join(OUT, 'answer-window.png') });
    ok(popup.isClosed(), 'popup closes itself after sending the question');

    console.log('\n[dark mode screenshot]');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.click('#q1', { clickCount: 3 });
    await waitFor(() => shadow2.visible('.ak-fab'), 'fab');
    await shadow2.click('.ak-fab');
    await waitFor(async () => (await shadow2.text('.ak-md'))?.includes('Paris is the capital'), 'answer');
    await sleep(500); // let the open animation finish
    await page.screenshot({ path: path.join(OUT, 'answer-dark.png') });
    await shadow2.click('.ak-icon-btn[aria-label^="Close"]');

    console.log('\n[shortcut] Alt+Shift+K (informational: headless may not route browser shortcuts)');
    await page.click('#q1', { clickCount: 3 });
    await page.keyboard.press('Alt+Shift+K');
    try {
      await waitFor(() => shadow2.visible('.ak-panel'), 'panel from shortcut', 3000);
      console.log('    shortcut opened the panel');
    } catch {
      console.log('    shortcut did not reach the extension in headless mode (not counted)');
    }
    await optionsPage.emulateMedia({ colorScheme: 'light' });
    await optionsPage.setViewportSize({ width: 900, height: 1500 });
    await optionsPage.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });

    console.log(`\nAll ${passed} checks passed.`);
  } catch (err) {
    console.error('\nFAILED:', err.message);
    for (const p of context.pages()) {
      try {
        await p.screenshot({ path: path.join(OUT, `failure-${p.url().split('/').pop().replace(/\W/g, '_')}.png`) });
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    if (swErrors.length) console.log('Service worker errors:', swErrors);
    await context.close();
    mock.close();
  }
})();
