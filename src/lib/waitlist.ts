/**
 * Waitlist integration.
 *
 * Posts to the site's own serverless endpoint (/api/waitlist), which writes to
 * the Neon `waitlist` table. Set PUBLIC_WAITLIST_ENDPOINT to override (e.g. to
 * point a fork at a different backend). With no override, same-origin is used.
 */

const endpoint =
  (import.meta.env.PUBLIC_WAITLIST_ENDPOINT as string | undefined) ?? '/api/waitlist';

export async function joinWaitlist(email: string): Promise<void> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, source: 'landing-page' }),
  });

  if (!res.ok) {
    let message = `Waitlist request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data?.error === 'string') message = data.error;
    } catch {
      // Non-JSON error body — keep the status message.
    }
    console.error('[akipoly] Waitlist submission failed:', message);
    throw new Error(message);
  }
}
