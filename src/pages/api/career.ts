import { apiRoute, json } from '../../lib/server/helpers';
import { withClient } from '../../lib/server/db';
import { ensureAppUser } from '../../lib/server/users';

export const prerender = false;

export const GET = apiRoute(async ({ userId }) =>
  withClient(async (client) => {
    await ensureAppUser(client, userId);
    const res = await client.query(
      `select g.id, g.started_at, g.ended_at, l.name as lobby_name,
              r.placement, r.points, r.eliminated_round
         from public.games g
         join public.lobbies l on l.id = g.lobby_id
         join public.game_results r on r.game_id = g.id and r.user_id = $1
        order by g.started_at desc nulls last
        limit 20`,
      [userId],
    );
    return json({ games: res.rows });
  }),
);

