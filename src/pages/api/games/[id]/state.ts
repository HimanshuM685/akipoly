import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClientRetry } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { snapshotGame } from '../../../../lib/server/game';

export const prerender = false;

export const GET = apiRoute(async ({ params, userId }) =>
  withClientRetry(async (client) => {
    const gameId = params.id;
    if (!gameId) return json({ error: 'Missing game id.' }, 400);
    await ensureAppUser(client, userId);
    const snapshot = await snapshotGame(client, gameId, userId);
    return json(snapshot);
  }),
);
