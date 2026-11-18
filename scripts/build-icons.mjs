/**
 * Dev-only: build the Akipoly icon set and wordmark from the master logo PNG.
 *
 *   node scripts/build-icons.mjs <path-to-akipoly-logo.png> [--out public/icons]
 *
 * Expects the AKIPOLY wordmark artwork (periwinkle letters + pixel raccoon
 * head on a black ground, or already-transparent). Steps:
 *   1. Key out the near-black background (flood fill from the borders).
 *   2. Locate the raccoon head (the widest column gap in the top band).
 *   3. Emit favicon PNGs (16/32/48), apple-touch-icon (180), PWA icons
 *      (192/512), a maskable 512, a crisp pixel-art favicon.svg, the
 *      transparent wordmark and head PNGs.
 */
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node scripts/build-icons.mjs <akipoly-logo.png> [--out <dir>]');
  process.exit(1);
}
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'public/icons';

const isNearBlack = (r, g, b) => Math.max(r, g, b) < 70;

const png = PNG.sync.read(readFileSync(input));
const { width, height, data } = png;

// --- 1. key out the background if the PNG carries no useful alpha ---
const opaqueAlpha = data.some((v, i) => i % 4 === 3 && v < 250);
if (!opaqueAlpha) {
  const visited = new Uint8Array(width * height);
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    const o = idx * 4;
    if (!isNearBlack(data[o], data[o + 1], data[o + 2])) return;
    visited[idx] = 1;
    stack.push([x, y]);
  };
  for (let x = 0; x < width; x++) { pushIf(x, 0); pushIf(x, height - 1); }
  for (let y = 0; y < height; y++) { pushIf(0, y); pushIf(width - 1, y); }
  while (stack.length) {
    const [x, y] = stack.pop();
    const o = (y * width + x) * 4;
    data[o + 3] = 0;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }
}

// --- helpers ---
const alphaAt = (x, y) => data[(y * width + x) * 4 + 3];

const bboxOf = (x0, y0, x1, y1) => {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alphaAt(x, y) > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
};

const crop = (box) => {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const so = ((box.minY + y) * width + (box.minX + x)) * 4;
      const doff = (y * w + x) * 4;
      out.data[doff] = data[so];
      out.data[doff + 1] = data[so + 1];
      out.data[doff + 2] = data[so + 2];
      out.data[doff + 3] = data[so + 3];
    }
  }
  return out;
};

const resize = (src, dstW, dstH) => {
  const out = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor((x + 0.5) * (src.width / dstW));
      const sy = Math.floor((y + 0.5) * (src.height / dstH));
      const so = (sy * src.width + sx) * 4;
      const doff = (y * dstW + x) * 4;
      out.data[doff] = src.data[so];
      out.data[doff + 1] = src.data[so + 1];
      out.data[doff + 2] = src.data[so + 2];
      out.data[doff + 3] = src.data[so + 3];
    }
  }
  return out;
};

const onTile = (raccoon, tileSize, fill, padRatio) => {
  const tile = new PNG({ width: tileSize, height: tileSize });
  const [fr, fg, fb] = fill;
  for (let i = 0; i < tile.data.length; i += 4) {
    tile.data[i] = fr; tile.data[i + 1] = fg; tile.data[i + 2] = fb; tile.data[i + 3] = 255;
  }
  const inner = Math.round(tileSize * (1 - padRatio * 2));
  const scaled = resize(raccoon, inner, inner);
  const off = Math.floor((tileSize - inner) / 2);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const so = (y * inner + x) * 4;
      const a = scaled.data[so + 3] / 255;
      if (a === 0) continue;
      const doff = ((off + y) * tileSize + (off + x)) * 4;
      for (let c = 0; c < 3; c++) {
        tile.data[doff + c] = Math.round(scaled.data[so + c] * a + tile.data[doff + c] * (1 - a));
      }
    }
  }
  return tile;
};

const write = (file, src) => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, file), PNG.sync.write(src));
};

// --- 2. locate the raccoon head ---
// Label connected components over the alpha mask; the stray speck in the
// master artwork must not stretch bboxes.
const labelComponents = (x0, y0, x1, y1) => {
  const w = x1 - x0;
  const h = y1 - y0;
  const labels = new Int32Array(w * h);
  let next = 0;
  const sizes = new Map();
  const stack = new Int32Array(w * h);
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const li = sy * w + sx;
      if (labels[li] !== 0 || alphaAt(sx + x0, sy + y0) <= 12) continue;
      next++;
      let size = 0;
      let sp = 0;
      stack[sp++] = li;
      labels[li] = next;
      while (sp > 0) {
        const cur = stack[--sp];
        size++;
        const cx = cur % w;
        const cy = (cur - cx) / w;
        const neighbours = [
          cx > 0 ? cur - 1 : -1,
          cx < w - 1 ? cur + 1 : -1,
          cy > 0 ? cur - w : -1,
          cy < h - 1 ? cur + w : -1,
        ];
        for (const n of neighbours) {
          if (n < 0 || labels[n] !== 0) continue;
          const nx = n % w;
          const ny = (n - nx) / w;
          if (alphaAt(nx + x0, ny + y0) <= 12) continue;
          labels[n] = next;
          stack[sp++] = n;
        }
      }
      sizes.set(next, size);
    }
  }
  return { labels, sizes, w, x0, y0 };
};

const bboxOfLargestComponents = (x0, y0, x1, y1, minSize) => {
  const { labels, sizes, w, x0: ox, y0: oy } = labelComponents(x0, y0, x1, y1);
  const keep = new Set([...sizes].filter(([, s]) => s >= minSize).map(([id]) => id));
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 0; i < labels.length; i++) {
    if (!keep.has(labels[i])) continue;
    const x = (i % w) + ox;
    const y = Math.floor(i / w) + oy;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
};

const topBandPx = Math.floor(height * 0.5);
const colOpaque = new Array(width).fill(0);
for (let y = 0; y < topBandPx; y++) {
  for (let x = 0; x < width; x++) {
    if (alphaAt(x, y) > 12) colOpaque[x]++;
  }
}
const fullBox = bboxOfLargestComponents(0, 0, width, height, 800);
if (!fullBox) throw new Error('No substantial components found — wrong image?');
const fullW = fullBox.maxX - fullBox.minX;

// Split the top band at the gap whose right-hand cluster is most
// square-ish (the raccoon head), ignoring tail-edge margins.
const candidates = [];
{
  let s = -1;
  for (let x = fullBox.minX; x <= fullBox.maxX + 1; x++) {
    const inBand = x <= fullBox.maxX;
    const empty = inBand && colOpaque[x] === 0;
    if (empty && s === -1) s = x;
    if (!empty && s !== -1) {
      const len = x - s;
      if (len >= 60) candidates.push({ start: s, len });
      s = -1;
    }
  }
}
let bestGap = null;
for (const gap of candidates) {
  const right = bboxOf(gap.start + gap.len, 0, fullBox.maxX + 1, topBandPx);
  if (!right) continue;
  const rw = right.maxX - right.minX + 1;
  if (rw < fullW * 0.18) continue; // tail-edge margin, not the head
  const aspect = rw / (right.maxY - right.minY + 1);
  const score = Math.abs(Math.log(aspect));
  if (!bestGap || score < bestGap.score) bestGap = { ...gap, score };
}

const headBox = bestGap
  ? bboxOfLargestComponents(bestGap.start + bestGap.len, 0, width, topBandPx, 800)
  : bboxOfLargestComponents(Math.floor(width * 0.55), 0, width, topBandPx, 800);
if (!headBox) throw new Error('Could not locate the raccoon head in the top band.');

// --- 3. emit ---
const wordmark = crop(fullBox);
const head = crop(headBox);

const headSquare = (size, pad = 0) => {
  const inner = size - pad * 2;
  const aspect = head.width / head.height;
  const w = aspect >= 1 ? inner : Math.round(inner * aspect);
  const h = aspect >= 1 ? Math.round(inner / aspect) : inner;
  const scaled = resize(head, w, h);
  const canvas = new PNG({ width: size, height: size });
  const offX = Math.floor((size - w) / 2);
  const offY = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const so = (y * w + x) * 4;
      const doff = ((offY + y) * size + (offX + x)) * 4;
      canvas.data[doff] = scaled.data[so];
      canvas.data[doff + 1] = scaled.data[so + 1];
      canvas.data[doff + 2] = scaled.data[so + 2];
      canvas.data[doff + 3] = scaled.data[so + 3];
    }
  }
  return canvas;
};

write('akipoly-wordmark.png', wordmark);
// Site-friendly downscaled copies (nearest-neighbor keeps the pixel look).
const wordmarkAspect = wordmark.width / wordmark.height;
write('akipoly-wordmark@1000.png', resize(wordmark, 1000, Math.round(1000 / wordmarkAspect)));
write('akipoly-head.png', head);
write('akipoly-head@320.png', resize(head, 320, Math.round(320 / (head.width / head.height))));
write('akipoly-head@96.png', resize(head, 96, Math.round(96 / (head.width / head.height))));
write('favicon-16.png', headSquare(16));
write('favicon-32.png', headSquare(32));
write('favicon-48.png', headSquare(48));
write('apple-touch-icon.png', onTile(headSquare(152), 180, [255, 245, 0], 0.16));
write('icon-192.png', onTile(headSquare(160), 192, [255, 245, 0], 0.16));
write('icon-512.png', onTile(headSquare(432), 512, [255, 245, 0], 0.16));
write('maskable-512.png', onTile(headSquare(340), 512, [255, 245, 0], 0.28));

// favicon.svg — the head as crisp pixel-art rects on a yellow rounded tile.
// Colours are quantised before run-merging so the SVG stays small.
const cell = (() => {
  const base = headSquare(64, 0);
  for (let i = 0; i < base.data.length; i += 4) {
    base.data[i] = Math.round(base.data[i] / 32) * 32;
    base.data[i + 1] = Math.round(base.data[i + 1] / 32) * 32;
    base.data[i + 2] = Math.round(base.data[i + 2] / 32) * 32;
  }
  return base;
})();
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
const rects = [];
for (let y = 0; y < cell.height; y++) {
  let x = 0;
  while (x < cell.width) {
    const o = (y * cell.width + x) * 4;
    const a = cell.data[o + 3];
    if (a < 32) { x++; continue; }
    const color = hex(cell.data[o], cell.data[o + 1], cell.data[o + 2]);
    let run = 1;
    while (x + run < cell.width) {
      const no = (y * cell.width + x + run) * 4;
      if (cell.data[no + 3] < 32) break;
      if (hex(cell.data[no], cell.data[no + 1], cell.data[no + 2]) !== color) break;
      run++;
    }
    rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${color}"/>`);
    x += run;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">` +
  `<rect width="64" height="64" rx="14" fill="#FFF500"/>` +
  `<rect x="2" y="2" width="60" height="60" rx="12" fill="none" stroke="#171717" stroke-width="4"/>` +
  `<g transform="translate(8 8) scale(0.75)">${rects.join('')}</g></svg>`;
writeFileSync(join(outDir, 'favicon.svg'), svg);

console.log('Source :', input);
console.log('Keyed  :', opaqueAlpha ? 'image already had alpha' : 'black background removed');
console.log('Wordmark bbox:', fullBox);
console.log('Head bbox    :', headBox, `(${head.width}x${head.height})`);
console.log('Out    :', outDir);

