/**
 * POST /api/waitlist — capture an email into the Neon `waitlist` table.
 *
 * Server-side only. The database connection string lives in the server-side
 * `DATABASE_URL` env var (set it in the Vercel project settings) and never
 * reaches the client. Deployed as a Vercel serverless function.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY_BYTES = 2048;

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

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[waitlist] DATABASE_URL is not configured');
    return json({ error: 'Waitlist is not configured yet. Try again soon.' }, 503);
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    await sql`insert into public.waitlist (email, source) values (${cleanEmail}, ${cleanSource})`;
    return json({ ok: true }, 200);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === '23505') {
      // Already on the list — not an error from the user's perspective.
      return json({ ok: true, already: true }, 200);
    }
    console.error('[waitlist] insert failed:', err);
    return json({ error: 'Something went wrong on our side. Try again in a minute.' }, 500);
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
