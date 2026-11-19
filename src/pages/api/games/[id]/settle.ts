import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';
import { settleRound } from '../../../../lib/server/game';

export const prerender = false;

export const POST = apiRoute(async ({ params, userId, request }) =>
  withClient(async (client) => {
    const gameId = params.id;
    if (!gameId) return json({ error: 'Missing game id.' }, 400);

    let force = false;
    try {
      const body = await request.json().catch(() => ({}));
      force = Boolean((body as { force?: unknown })?.force);
    } catch {
      /* empty body = auto tick */
    }

    await ensureAppUser(client, userId);
    const result = await settleRound(client, gameId, force);
    return json(result);
  }),
);
