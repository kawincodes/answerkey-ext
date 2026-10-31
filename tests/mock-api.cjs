// Mock Anthropic API (HTTPS, streams real server-sent events) and a test page
// server (HTTP) for the AnswerKey end-to-end test. The browser is pointed at this
// mock with --host-resolver-rules, so no real API calls are made.
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const requests = []; // every API request received: { method, url, headers, body }
const aborted = []; // message requests the client closed before the stream ended

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const messageStart = (model) =>
  ev('message_start', {
    message: {
      id: 'msg_test_' + requests.length,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 50, output_tokens: 1 },
    },
  });
const blockStart = (index, block) => ev('content_block_start', { index, content_block: block });
const delta = (index, d) => ev('content_block_delta', { index, delta: d });
const blockStop = (index) => ev('content_block_stop', { index });
const messageDelta = (stop_reason, stop_details = null) =>
  ev('message_delta', { delta: { stop_reason, stop_sequence: null, stop_details }, usage: { output_tokens: 42 } });
const messageStop = () => ev('message_stop', {});

function thinkingBlock(index, text, signature) {
  return [
    blockStart(index, { type: 'thinking', thinking: '', signature: '' }),
    delta(index, { type: 'thinking_delta', thinking: text }),
    delta(index, { type: 'signature_delta', signature }),
    blockStop(index),
  ];
}
function textBlock(index, parts) {
  return [blockStart(index, { type: 'text', text: '' }), ...parts.map((t) => delta(index, { type: 'text_delta', text: t })), blockStop(index)];
}

function lastUserText(body) {
  const last = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  return typeof last.content === 'string' ? last.content : last.content.map((b) => b.text || '').join('');
}

function scenario(body) {
  const q = lastUserText(body);
  const model = body.model;
  if (q.includes('[refuse]')) {
    return { events: [messageStart(model), messageDelta('refusal', { type: 'refusal', category: 'cyber', explanation: null }), messageStop()] };
  }
  if (q.includes('[fallback]')) {
    return {
      events: [
        messageStart(model),
        ...thinkingBlock(0, 'Opus reasoning before the switch.', 'sig-before'),
        ...textBlock(1, ['The answer is']),
        blockStart(2, { type: 'fallback', from: { model }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal' } }),
        blockStop(2),
        ...thinkingBlock(3, 'Fallback reasoning.', 'sig-after'),
        ...textBlock(4, [' **B**.']),
        messageDelta('end_turn'),
        messageStop(),
      ],
    };
  }
  if (q.includes('[maxtokens]')) {
    return { events: [messageStart(model), ...thinkingBlock(0, 'Long thought', 'sig-mt'), ...textBlock(1, ['This answer goes on and on']), messageDelta('max_tokens'), messageStop()] };
  }
  if (q.includes('[bad]')) {
    return { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' }, request_id: 'req_test' } };
  }
  if (q.includes('[slow]')) {
    const words = Array.from({ length: 60 }, (_, i) => `word${i} `);
    return { delayMs: 120, events: [messageStart(model), ...thinkingBlock(0, 'Thinking slowly…', 'sig-slow'), ...textBlock(1, words), messageDelta('end_turn'), messageStop()] };
  }
  const turn = body.messages.filter((m) => m.role === 'user').length;
  return {
    events: [
      messageStart(model),
      ...thinkingBlock(0, `Considering the options (turn ${turn}).`, `sig-${turn}`),
      ...textBlock(1, turn === 1 ? ['**Answer: B) Paris**', '\n\nParis is the capital ', 'of France.'] : [`Follow-up answer ${turn}.`]),
      messageDelta('end_turn'),
      messageStop(),
    ],
  };
}

function handleApi(req, res) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {}
    const record = { method: req.method, url: req.url, headers: req.headers, body };
    requests.push(record);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
      return res.end();
    }
    const auth = req.headers['authorization'] || '';
    if (auth === 'Bearer sk-ant-bad') {
      res.writeHead(401, { 'content-type': 'application/json', 'request-id': 'req_test' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models/')) {
      const id = decodeURIComponent(req.url.split('/').pop());
      if (id === 'claude-haiku-5-5' && auth.includes('nohaiku')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `model: ${id}` } }));
      }
      const names = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-fable-5-1': 'Claude Fable 5.1' };
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_test' });
      return res.end(JSON.stringify({ type: 'model', id, display_name: names[id] || id, created_at: '2026-01-01T00:00:00Z' }));
    }
    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
      const s = scenario(body);
      if (s.status) {
        res.writeHead(s.status, { 'content-type': 'application/json', 'request-id': 'req_test' });
        return res.end(JSON.stringify(s.json));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_test' });
      let closed = false;
      res.on('close', () => {
        if (!res.writableFinished) {
          closed = true;
          aborted.push(record);
        }
      });
      for (const chunk of s.events) {
        if (closed) return;
        res.write(chunk);
        if (s.delayMs) await new Promise((r) => setTimeout(r, s.delayMs));
      }
      return res.end();
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Not found' } }));
  });
}

const QUIZ = `<!doctype html><html><head><meta charset="utf-8"><title>Geography Quiz – Chapter 3</title><link rel="stylesheet" href="/site.css"></head>
<body>
<h1>Chapter 3 quiz</h1>
<p id="q1">What is the capital of France? A) Berlin B) Paris C) Rome D) Madrid</p>
<p id="q2">Explain photosynthesis in detail please. [slow]</p>
<p id="q3">How do I do the dangerous thing? [refuse]</p>
<p id="q4">Which option is correct here? [fallback]</p>
<p id="q5">Write a very long essay. [maxtokens]</p>
<p id="q6">This one will fail with a billing error. [bad]</p>
<textarea id="ta" rows="2" cols="60">Text inside a textarea that can be selected</textarea>
<iframe id="frame" src="/frame.html" width="600" height="160"></iframe>
<div style="height: 1500px"></div>
</body></html>`;
const FRAME = `<!doctype html><html><head><title>Embedded question</title></head><body><p id="fq">Inside the frame: what is 6 times 7?</p></body></html>`;

function handlePages(req, res) {
  const csp = "default-src 'self'; style-src 'self'; script-src 'self'; frame-src 'self'";
  if (req.url === '/quiz.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp });
    return res.end(QUIZ);
  }
  if (req.url === '/frame.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp });
    return res.end(FRAME);
  }
  if (req.url === '/site.css') {
    // Hostile page CSS: should not leak into the shadow-DOM UI.
    res.writeHead(200, { 'content-type': 'text/css' });
    return res.end('body{font:16px Georgia,serif;margin:24px} button{background:red!important;font-size:30px!important} *{letter-spacing:2px}');
  }
  res.writeHead(404);
  res.end('not found');
}

/** A throwaway self-signed certificate for api.anthropic.com (needs the openssl CLI). */
function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answerkey-cert-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=api.anthropic.com', '-addext', 'subjectAltName=DNS:api.anthropic.com'],
    { stdio: 'ignore' },
  );
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function start() {
  const api = https.createServer(selfSignedCert(), handleApi);
  const pages = http.createServer(handlePages);
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  await new Promise((r) => pages.listen(0, '127.0.0.1', r));
  return {
    apiPort: api.address().port,
    pagePort: pages.address().port,
    requests,
    aborted,
    close: () => {
      api.close();
      pages.close();
    },
  };
}

module.exports = { start };
