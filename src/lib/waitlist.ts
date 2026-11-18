/**
 * Waitlist integration point.
 *
 * No backend exists yet — this module is the single seam where one plugs in.
 * Set PUBLIC_WAITLIST_ENDPOINT (see .env.example) to a URL that accepts
 * `POST { email, source }` as JSON and returns a 2xx on success.
 *
 * Until then, submissions are simulated locally: nothing leaves the browser,
 * and the only record is a localStorage entry on this device. The UI state is
 * identical either way, but nothing is persisted to a server.
 */

const endpoint = import.meta.env.PUBLIC_WAITLIST_ENDPOINT as string | undefined;

export async function joinWaitlist(email: string): Promise<void> {
  if (endpoint) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'landing-page' }),
    });
    if (!res.ok) {
      throw new Error(`Waitlist request failed with status ${res.status}`);
    }
    return;
  }

  // Simulated submission — no network call is made.
  await new Promise((resolve) => setTimeout(resolve, 900));
  try {
    localStorage.setItem(
      'akipoly:waitlist:last-submission',
      JSON.stringify({ email, submittedAt: new Date().toISOString() }),
    );
  } catch {
    // Private mode or quota exceeded — non-fatal, the UI already moved on.
  }
  console.info(
    '[akipoly] PUBLIC_WAITLIST_ENDPOINT is not set — submission was kept locally only.',
  );
}
