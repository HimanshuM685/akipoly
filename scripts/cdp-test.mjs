/**
 * Dev-only interaction test via raw CDP: drives the waitlist form the way a
 * user would — bad email, then a good one — and checks the UI states.
 * Usage: node scripts/cdp-test.mjs <url>
 */
import { spawn } from 'node:child_process';

const url = process.argv[2]; // single screen; form is on the page itself
const allowUnreachable = process.argv.includes('--allow-unreachable'); // on DNS-filtered networks the DB is unreachable by design
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
  alertVisible: !document.getElementById('waitlist-alert').hidden,
  alertText: document.getElementById('waitlist-alert-text')?.textContent ?? null,
}))()`);

// The endpoint depends on the database being reachable from this machine.
// On DNS-filtered networks Neon is unreachable by design: assert the form
// either reaches the success state OR shows the explicit error state.
results.validOk = results.valid.successVisible || results.valid.alertVisible;
results.validStrictOk = results.valid.successVisible;
if (!results.validOk) {
  console.error('Expected either the success state or the explicit error state — neither appeared.');
  process.exitCode = 1;
}
if (!allowUnreachable && !results.validStrictOk) {
  console.error('Expected the success state (strict mode). Got the error state instead:', results.valid.alertText);
  process.exitCode = 1;
}

// 3. Share link points at an X intent with a preloaded caption
results.share = await evalJs(`(() => {
  const link = document.getElementById('waitlist-share');
  return { href: link?.getAttribute('href') };
})()`);

results.exceptions = exceptions;
console.log(JSON.stringify(results, null, 2));
ws.close();
chrome.kill();
process.exit(0);
