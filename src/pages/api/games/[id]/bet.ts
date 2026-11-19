import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { placeBet } from '../../../../lib/server/game';

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
    const direction = (body as { direction?: unknown })?.direction;
    const amount = (body as { amount?: unknown })?.amount;

    if (!roundId || typeof roundId !== 'string') {
      return json({ error: 'Missing round_id.' }, 400);
    }
    if (direction !== 'higher' && direction !== 'lower') {
      return json({ error: 'direction must be "higher" or "lower"' }, 400);
    }
    if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      return json({ error: 'amount must be a positive integer string' }, 400);
    }

    await ensureAppUser(client, userId);
    const result = await placeBet(client, gameId, roundId, userId, direction, amount);
    return json(result, 201);
  }),
);
