/**
 * Dev-only splash behaviour test via raw CDP.
 * Usage: node scripts/cdp-test-intro.mjs <url>
 */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const PORT = 9335;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-intro-profile',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
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

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};

await new Promise((resolve) => { ws.onopen = resolve; });
await send('Page.enable');
await send('Runtime.enable');

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

await send('Page.navigate', { url });
await sleep(2200);

const results = {};

results.onLoad = await evalJs(`(() => ({
  introShown: !!document.getElementById('intro') && !document.getElementById('intro').classList.contains('intro--closing'),
  shellInert: document.getElementById('page-shell')?.hasAttribute('inert'),
  scrollLocked: document.documentElement.classList.contains('intro-open'),
  ctaFocused: document.activeElement?.id === 'intro-cta',
}))()`);

// Escape dismisses
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(600);
results.afterEscape = await evalJs(`(() => ({
  introRemoved: !document.getElementById('intro'),
  shellInertRemoved: !document.getElementById('page-shell')?.hasAttribute('inert'),
  scrollUnlocked: !document.documentElement.classList.contains('intro-open'),
}))()`);

// Fresh load with a deep link must skip the splash
await send('Page.navigate', { url: url + '#waitlist' });
await sleep(1800);
results.deepLink = await evalJs(`(() => ({
  introRemoved: !document.getElementById('intro'),
  shellInertRemoved: !document.getElementById('page-shell')?.hasAttribute('inert'),
}))()`);

console.log(JSON.stringify(results, null, 2));
ws.close();
chrome.kill();
process.exit(0);
