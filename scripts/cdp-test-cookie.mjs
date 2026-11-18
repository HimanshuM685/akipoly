/**
 * Dev-only: cookie banner behaviour.
 * Usage: node scripts/cdp-test-cookie.mjs <url>
 */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const PORT = 9337;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-cookie-profile-' + Date.now(),
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
  bannerPresent: !!document.getElementById('cookie-banner'),
  dismissVisible: !!document.getElementById('cookie-dismiss'),
  docsLink: !!document.querySelector('.page__help[href="/docs"]'),
}))()`);

await evalJs(`(() => { document.getElementById('cookie-dismiss')?.click(); return true; })()`);
await sleep(400);
results.afterClick = await evalJs(`(() => ({
  bannerGone: !document.getElementById('cookie-banner'),
  ack: localStorage.getItem('akipoly:cookie-ack'),
}))()`);

await send('Page.navigate', { url });
await sleep(1800);
results.afterReload = await evalJs(`(() => ({
  bannerGone: !document.getElementById('cookie-banner'),
}))()`);

console.log(JSON.stringify(results, null, 2));
ws.close();
chrome.kill();
process.exit(0);
