/**
 * Dev-only interaction test via raw CDP: drives the waitlist form the way a
 * user would — bad email, then a good one — and checks the UI states.
 * Usage: node scripts/cdp-test.mjs <url>
 */
import { spawn } from 'node:child_process';

const url = process.argv[2] + '#waitlist'; // deep link skips the intro splash
const PORT = 9334;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-test-profile',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome devtools endpoint never came up');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const exceptions = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails?.text ?? 'unknown exception');
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.method}: ${msg.error.message}`));
    else resolve(msg.result);
  }
};

await new Promise((resolve) => { ws.onopen = resolve; });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(2500);

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

const results = {};

// 1. Submit with an invalid email
await evalJs(`(() => {
  const input = document.getElementById('waitlist-email');
  input.value = 'not-an-email';
  document.getElementById('waitlist-submit').click();
  return true;
})()`);
await sleep(300);
results.invalid = await evalJs(`(() => ({
  errorShown: !document.getElementById('waitlist-email-error').hidden,
  errorText: document.getElementById('waitlist-email-error-text').textContent,
  ariaInvalid: document.getElementById('waitlist-email').getAttribute('aria-invalid'),
  successHidden: document.getElementById('waitlist-success').hidden,
}))()`);

// 2. Submit with a valid email
await evalJs(`(() => {
  const input = document.getElementById('waitlist-email');
  input.value = 'akemi@example.com';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('waitlist-form').requestSubmit();
  return true;
})()`);
await sleep(1600);
results.valid = await evalJs(`(() => ({
  successVisible: !document.getElementById('waitlist-success').hidden,
  formHidden: document.getElementById('waitlist-form').hidden,
  fineprintHidden: document.getElementById('waitlist-fineprint').hidden,
  stored: localStorage.getItem('akipoly:waitlist:last-submission'),
}))()`);

// 3. Share button copies URL (clipboard may fail headless; label must not crash)
results.share = await evalJs(`(async () => {
  const btn = document.getElementById('waitlist-share');
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  return btn.textContent;
})()`);

results.exceptions = exceptions;
console.log(JSON.stringify(results, null, 2));
ws.close();
chrome.kill();
process.exit(0);
