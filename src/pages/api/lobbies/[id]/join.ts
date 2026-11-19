import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient, HttpError } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';

export const prerender = false;

export const POST = apiRoute(async ({ params, userId }) =>
  withClient(async (client) => {
    const lobbyId = params.id;
    if (!lobbyId) return json({ error: 'Missing lobby id.' }, 400);

    const lobby = await client.query('select id, status, max_players from public.lobbies where id = $1', [lobbyId]);
    if (lobby.rowCount === 0) throw new HttpError(404, 'lobby not found');
    const l = lobby.rows[0];
    if (l.status !== 'waiting') throw new HttpError(409, 'game already started');

    await ensureAppUser(client, userId);
    const count = await client.query(
      'select count(*)::int as n from public.lobby_seats where lobby_id = $1',
      [lobbyId],
    );
    if (count.rows[0].n >= l.max_players) throw new HttpError(409, 'lobby is full');

    await client.query(
      `insert into public.lobby_seats (lobby_id, user_id) values ($1, $2) on conflict do nothing`,
      [lobbyId, userId],
    );
    return json({ ok: true });
  }),
);
