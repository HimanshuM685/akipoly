/** Dev-only: load /dashboard headlessly and dump console + exceptions. */
import { spawn } from 'node:child_process';

const url = process.argv[2] ?? 'http://localhost:4321/dashboard';
const PORT = 9340;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-debugdash-profile-' + Date.now(),
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
const exceptions = [];
const consoleLines = [];

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
    exceptions.push(JSON.stringify(msg.params.exceptionDetails, null, 0).slice(0, 1200));
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
  }
  if (msg.method === 'Log.entryAdded') {
    consoleLines.push(`log/${msg.params.entry.level}: ${msg.params.entry.text}`.slice(0, 400));
  }
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
await send('Log.enable');
await send('Page.navigate', { url });
await sleep(6000);

const probe = await send('Runtime.evaluate', {
  expression: `(() => ({
    dashHtml: document.querySelector('.dash__panel')?.innerHTML?.slice(0, 500) ?? null,
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent),
    appIdInBundle: typeof document !== 'undefined',
  }))()`,
  returnByValue: true,
});

console.log(JSON.stringify({ probe: probe.result?.value, exceptions, consoleLines }, null, 2));
ws.close();
chrome.kill();
process.exit(0);
