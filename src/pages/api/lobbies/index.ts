import { apiRoute, json } from '../../../lib/server/helpers';
import { withClient } from '../../../lib/server/db';
import { ensureAppUser } from '../../../lib/server/users';

export const prerender = false;

/** GET /api/lobbies — list open lobbies; POST — create one. */
export const GET = apiRoute(async ({ request, userId }) =>
  withClient(async (client) => {
    await ensureAppUser(client, userId);
    const res = await client.query(
      `select l.id, l.name, l.max_players, l.status, l.current_round, l.created_at,
              (select count(*)::int from public.lobby_seats s where s.lobby_id = l.id) as players,
              exists(select 1 from public.lobby_seats s where s.lobby_id = l.id and s.user_id = $1) as seated
         from public.lobbies l
        where l.status in ('waiting','live')
        order by l.created_at desc
        limit 24`,
      [userId],
    );
    return json({ lobbies: res.rows });
  }),
);

export const POST = apiRoute(async ({ request, userId }) =>
  withClient(async (client) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON.' }, 400);
    }
    const lobbyName = typeof (body as { name?: unknown })?.name === 'string'
      ? (body as { name: string }).name.trim().slice(0, 64)
      : '';
    if (!lobbyName) return json({ error: 'Give your lobby a name.' }, 400);
    if (lobbyName.length < 2) return json({ error: 'Name must be at least 2 characters.' }, 400);
    const displayName = typeof (body as { displayName?: unknown })?.displayName === 'string'
      ? (body as { displayName: string }).displayName.trim().slice(0, 32)
      : '';

    await ensureAppUser(client, userId);
    const created = await client.query(
      `insert into public.lobbies (host_user_id, name) values ($1, $2)
       returning id, name, max_players, status, created_at`,
      [userId, lobbyName],
    );
    await client.query(
      `insert into public.lobby_seats (lobby_id, user_id, display_name)
       values ($1, $2, $3) on conflict do nothing`,
      [created.rows[0].id, userId, displayName || null],
    );
    return json({ lobby: created.rows[0] }, 201);
  }),
);
