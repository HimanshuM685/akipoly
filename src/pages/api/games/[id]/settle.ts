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
    if (force) {
      // Only the host may force an early settle (respin).
      const hostRes = await client.query(
        `select l.host_user_id from public.games g
           join public.lobbies l on l.id = g.lobby_id
          where g.id = $1`,
        [gameId],
      );
      if (hostRes.rowCount === 0) return json({ error: 'game not found' }, 404);
      if (hostRes.rows[0].host_user_id !== userId) {
        return json({ error: 'only the host can respin' }, 403);
      }
    }
    const result = await settleRound(client, gameId, force);
    return json(result);
  }),
);
