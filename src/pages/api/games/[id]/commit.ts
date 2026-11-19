import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { commitRandomness } from '../../../../lib/server/game';

export const prerender = false;

export const POST = apiRoute(async ({ params, userId, request }) =>
  withClient(async (client) => {
    const gameId = params.id;
    if (!gameId) return json({ error: 'Missing game id.' }, 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON.' }, 400);
    }

    const roundId = (body as { round_id?: unknown })?.round_id;
    const commitment = (body as { commitment?: unknown })?.commitment;

    if (!roundId || typeof roundId !== 'string') {
      return json({ error: 'Missing round_id.' }, 400);
    }
    if (typeof commitment !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(commitment)) {
      return json({ error: 'commitment must be a 0x-prefixed 64-char hex string' }, 400);
    }

    await ensureAppUser(client, userId);
    const result = await commitRandomness(client, gameId, roundId, userId, commitment);
    return json(result, 201);
  }),
);
