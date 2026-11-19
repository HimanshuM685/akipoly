/** Dev-only: dump waterwave state on /docs. */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const PORT = 9342;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-wavedebug-profile-' + Date.now(),
  '--window-size=1440,900',
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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result?.value;
};

await send('Page.navigate', { url });
await sleep(2000);

console.log(
  JSON.stringify(
    {
      reducedMotion: await evalJs(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`),
      htmlClass: await evalJs(`document.documentElement.className`),
      waterwaveExists: await evalJs(`!!document.getElementById('waterwave')`),
      waterwaveClass: await evalJs(`document.getElementById('waterwave')?.className`),
      waterwaveVisibility: await evalJs(`document.getElementById('waterwave') && getComputedStyle(document.getElementById('waterwave')).visibility`),
      waterwaveTransform: await evalJs(`document.getElementById('waterwave') && getComputedStyle(document.getElementById('waterwave')).transform`),
      flag: await evalJs(`sessionStorage.getItem('akipoly:wave-nav')`),
      animationName: await evalJs(`document.getElementById('waterwave') && getComputedStyle(document.getElementById('waterwave')).animationName`),
    },
    null,
    2,
  ),
);

ws.close();
chrome.kill();
process.exit(0);
