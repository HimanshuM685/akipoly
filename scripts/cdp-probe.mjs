/** Dev-only: probe computed styles of the dash copy paragraph. */
import { spawn } from 'node:child_process';

const PORT = 9341;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-probe-profile-' + Date.now(),
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
await send('Page.navigate', { url: 'http://localhost:4323/dashboard' });
await sleep(3500);

const result = await send('Runtime.evaluate', {
  expression: `(() => {
    const el = [...document.querySelectorAll('p')].find(p => p.textContent.toLowerCase().includes('sign in to claim it'));
    if (!el) return 'not found';
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      className: el.className,
      textTransform: cs.textTransform,
      bg: cs.backgroundColor,
      color: cs.color,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      width: rect.width,
      tag: el.tagName,
    };
  })()`,
  returnByValue: true,
});

console.log(JSON.stringify(result.result.value, null, 2));
ws.close();
chrome.kill();
process.exit(0);
