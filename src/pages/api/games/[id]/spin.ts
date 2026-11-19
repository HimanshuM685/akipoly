import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { spin } from '../../../../lib/server/game';

export const prerender = false;

export const POST = apiRoute(async ({ params, userId }) =>
  withClient(async (client) => {
    const gameId = params.id;
    if (!gameId) return json({ error: 'Missing game id.' }, 400);
    await ensureAppUser(client, userId);
    const result = await spin(client, gameId, userId);
    return json(result);
  }),
);
