/** Dev-only: one-shot metrics probe for the landing page. */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9336',
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-metrics', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9336/json/list');
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome devtools endpoint never came up');
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const msgId = ++id;
  pending.set(msgId, { res, rej });
  ws.send(JSON.stringify({ id: msgId, method, params }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(2000);
const r = await send('Runtime.evaluate', {
  expression: `(() => ({
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    docH: document.documentElement.scrollHeight,
    pageZoom: getComputedStyle(document.querySelector('.page')).zoom,
    logoW: document.querySelector('.page__logo').getBoundingClientRect().width,
    pageBoxH: document.querySelector('.page').getBoundingClientRect().height,
  }))()`,
  returnByValue: true,
});
console.log(JSON.stringify(r.result.value, null, 2));
ws.close();
chrome.kill();
process.exit(0);
