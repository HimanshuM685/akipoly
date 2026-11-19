import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient, HttpError } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';

export const prerender = false;

export const POST = apiRoute(async ({ params, userId, request }) =>
  withClient(async (client) => {
    const lobbyId = params.id;
    if (!lobbyId) return json({ error: 'Missing lobby id.' }, 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON.' }, 400);
    }
    const displayName = typeof (body as { displayName?: unknown })?.displayName === 'string'
      ? (body as { displayName: string }).displayName.trim().slice(0, 32)
      : '';

    const lobby = await client.query('select id, status, max_players from public.lobbies where id = $1', [lobbyId]);
    if (lobby.rowCount === 0) throw new HttpError(404, 'lobby not found');
    const l = lobby.rows[0];
    if (l.status !== 'waiting') throw new HttpError(409, 'game already started');

    await ensureAppUser(client, userId, undefined, displayName || null);
    const count = await client.query(
      'select count(*)::int as n from public.lobby_seats where lobby_id = $1',
      [lobbyId],
    );
    if (count.rows[0].n >= l.max_players) throw new HttpError(409, 'lobby is full');

    await client.query(
      `insert into public.lobby_seats (lobby_id, user_id, display_name)
       values ($1, $2, $3)
       on conflict (lobby_id, user_id) do update set
         display_name = coalesce(excluded.display_name, public.lobby_seats.display_name)`,
      [lobbyId, userId, displayName || null],
    );
    return json({ ok: true });
  }),
);
