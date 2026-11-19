import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient, HttpError } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { vote } from '../../../../lib/server/game';

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
    const choice = (body as { vote?: unknown })?.vote;
    if (choice !== 'higher' && choice !== 'lower') {
      throw new HttpError(400, 'vote must be "higher" or "lower"');
    }
    await ensureAppUser(client, userId);
    const result = await vote(client, gameId, userId, choice);
    return json(result);
  }),
);
