/**
 * POST /api/waitlist — capture an email into the Neon `waitlist` table.
 *
 * Server-side only. The connection string lives in the server-side
 * `DATABASE_URL` env var (set it in the Vercel project settings and in your
 * local `.env`) and never reaches the client. Deployed as a Vercel serverless
 * function. Uses node-postgres so it works through DNS-filtered networks too
 * (locally, `.env` carries the pooler IP; on Vercel, the hostname).
 */
import type { APIRoute } from 'astro';
import pg from 'pg';
import { readFileSync } from 'node:fs';

export const prerender = false;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY_BYTES = 2048;

/** Read .env file directly as a fallback when import.meta.env / process.env
   don't have the value (Astro dev server quirks, shell env overrides, etc.). */
function readEnvVar(key: string): string | undefined {
  try {
    const envContent = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    const line = envContent.split('\n').find((l) => {
      const trimmed = l.trim();
      return trimmed.startsWith(`${key}=`) && !trimmed.startsWith('#');
    });
    return line?.split('=').slice(1).join('=').trim().replace(/^"|"$|^'|'$/g, '');
  } catch {
    return undefined;
  }
}

export const POST: APIRoute = async ({ request }) => {
  // Size guard before parsing.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'Body too large.' }, 413);
  }

  let email: unknown;
  let source: unknown;
  try {
    const parsed = JSON.parse(raw);
    email = parsed?.email;
    source = parsed?.source;
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
    return json({ error: "That email doesn't look right." }, 400);
  }
  const cleanEmail = email.trim().toLowerCase().slice(0, 320);
  const cleanSource =
    typeof source === 'string' && source.trim() ? source.trim().slice(0, 64) : 'landing-page';

  // Astro exposes .env through import.meta.env (its dev server does not copy
  // it into process.env); Vercel functions also have it on process.env.
  // Prefer .env via import.meta.env, then direct .env file read, then process.env.
  const databaseUrl =
    import.meta.env.DATABASE_URL ??
    readEnvVar('DATABASE_URL') ??
    process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[waitlist] DATABASE_URL is not configured');
    return json({ error: 'Waitlist is not configured yet. Try again soon.' }, 503);
  }

  // Optional override for networks whose DNS refuses the Neon hostname:
  // dial the pooler IP while validating the real cert via SNI.
  const servername =
    import.meta.env.DATABASE_TLS_SERVERNAME ??
    readEnvVar('DATABASE_TLS_SERVERNAME') ??
    process.env.DATABASE_TLS_SERVERNAME;

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: servername ? { rejectUnauthorized: true, servername } : true,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    await client.query(
      'insert into public.waitlist (email, source) values ($1, $2)',
      [cleanEmail, cleanSource],
    );
    return json({ ok: true }, 200);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === '23505') {
      // Already on the list — not an error from the user's perspective.
      return json({ ok: true, already: true }, 200);
    }
    console.error('[waitlist] insert failed:', err);
    return json({ error: 'Something went wrong on our side. Try again in a minute.' }, 500);
  } finally {
    await client.end().catch(() => undefined);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
