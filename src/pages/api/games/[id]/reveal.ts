import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient, withClientRetry, HttpError } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { revealRandomness } from '../../../../lib/server/game';

export const prerender = false;

export const GET = apiRoute(async () => {
  return json({ error: 'Method not allowed. Use POST.' }, 405);
});

export const POST = apiRoute(async ({ params, userId, request }) => {
  try {
    return await withClientRetry(async (client) => {
      const gameId = params.id;
      if (!gameId) return json({ error: 'Missing game id.' }, 400);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON.' }, 400);
      }

      const roundId = (body as { round_id?: unknown })?.round_id;
      const seed = (body as { seed?: unknown })?.seed;

      if (!roundId || typeof roundId !== 'string') {
        return json({ error: 'Missing round_id.' }, 400);
      }
      if (typeof seed !== 'string' || seed.length < 1) {
        return json({ error: 'seed must be a non-empty string' }, 400);
      }

      await ensureAppUser(client, userId);
      const result = await revealRandomness(client, gameId, roundId, userId, seed);
      return json(result, 200);
    });
  } catch (err: unknown) {
    if (err instanceof HttpError) throw err;
    console.error('[reveal] unexpected error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
});
