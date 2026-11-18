/**
 * Dev-only: waterwave page transition between / and /docs.
 * Usage: node scripts/cdp-test-wave.mjs <url>
 */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const PORT = 9338;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-wave-profile-' + Date.now(),
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

// fresh load: overlay must be hidden
results.initial = await evalJs(`(() => {
  const el = document.getElementById('waterwave');
  return { overlayPresent: !!el, visibility: el ? getComputedStyle(el).visibility : null };
})()`);

// click the "?" explainer badge
await evalJs(`(() => { document.querySelector('.page__help')?.click(); return true; })()`);
await sleep(300);
results.covering = await evalJs(`(() => {
  const el = document.getElementById('waterwave');
  return el ? { entering: el.classList.contains('waterwave--entering'), path: location.pathname } : null;
})()`);
await sleep(900);
results.atDocs = await evalJs(`(() => ({ path: location.pathname, leaving: document.getElementById('waterwave')?.classList.contains('waterwave--leaving') }))()`);
await sleep(700);
results.docsSettled = await evalJs(`(() => ({ flag: sessionStorage.getItem('akipoly:wave-nav'), leaving: document.getElementById('waterwave')?.classList.contains('waterwave--leaving') }))()`);

// click back to the site
await evalJs(`(() => { document.querySelector('.docs__back')?.click(); return true; })()`);
await sleep(300);
results.coveringBack = await evalJs(`(() => {
  const el = document.getElementById('waterwave');
  return el ? { entering: el.classList.contains('waterwave--entering'), path: location.pathname } : null;
})()`);
await sleep(1100);
results.backSettled = await evalJs(`(() => ({ path: location.pathname, flag: sessionStorage.getItem('akipoly:wave-nav') }))()`);

console.log(JSON.stringify(results, null, 2));
ws.close();
chrome.kill();
process.exit(0);
