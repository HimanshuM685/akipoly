/**
 * Dev-only: run the BUILT Vercel serverless bundle in-process and call the
 * waitlist endpoint with various bodies. This exercises the exact artifact
 * that ships, including the neon() branch.
 *
 *   node scripts/waitlist-endpoint-test.mjs
 */

const entryUrl = new URL(
  '../.vercel/output/functions/_render.func/.vercel/output/server/entry.mjs',
  import.meta.url,
);

const mod = await import(entryUrl.href);
const handler = mod.default ?? mod;
if (typeof handler?.fetch !== 'function') {
  console.error('Entry does not export a fetch handler.');
  process.exit(1);
}

const cases = [
  ['empty object', {}],
  ['invalid email', { email: 'nope' }],
  ['missing email', { source: 'smoke-test' }],
  ['valid email', { email: 'smoke-test-' + Date.now() + '@example.com', source: 'smoke-test' }],
];

for (const [label, body] of cases) {
  const res = await handler.fetch(
    new Request('http://localhost/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  console.log(`${label} → ${res.status}`);
  console.log('   body:', text.slice(0, 200));
}

process.exit(0);
