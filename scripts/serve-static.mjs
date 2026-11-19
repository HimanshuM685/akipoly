/** Dev-only static file server for the built client bundle (dist/client). */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/client');
const port = Number(process.argv[3] ?? 4323);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

createServer((req, res) => {
  let pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (pathname.endsWith('/')) pathname += 'index.html';
  let file = join(root, pathname);
  if (!existsSync(file)) file = join(root, pathname + '.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end('error');
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
