/**
 * Dev-only screenshot + overflow check via raw CDP (Node's built-in WebSocket).
 * Usage: node scripts/cdp-shot.mjs <url> <outPng> <width> <height>
 * Captures at an exact emulated device width and reports horizontal overflow.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, out, widthArg, heightArg, mode] = process.argv.slice(2);
const width = Number(widthArg);
const height = Number(heightArg);
const PORT = 9333;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:/Users/rxyam/AppData/Local/Temp/opencode/cdp-profile-${width}`,
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
    } catch { /* not up yet */ }
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
    if (msg.error) reject(new Error(`${method(msg)}: ${msg.error.message}`));
    else resolve(msg.result);
  }
};
function method() { return 'cdp'; }
ws.onerror = (e) => { throw new Error('WebSocket error: ' + (e.message ?? 'unknown')); };

await new Promise((resolve) => { ws.onopen = resolve; });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 2, mobile: width < 768,
});
await send('Page.navigate', { url });
await sleep(2500); // fonts + layout settle

if (mode === 'dismiss') {
  // Dismiss the intro splash the way Escape would, then let the transition finish.
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`,
  });
  await sleep(600);
}

const metrics = await send('Runtime.evaluate', {
  expression: `({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowPx: document.documentElement.scrollWidth - window.innerWidth,
  })`,
  returnByValue: true,
});

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  // Full-page captures tile many viewport renders, which double-draws fixed
  // elements (the splash); viewport-only capture is used for it.
  captureBeyondViewport: mode !== 'viewport',
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));

console.log(JSON.stringify({ ...metrics.result.value, out }, null, 2));
ws.close();
chrome.kill();
process.exit(0);
