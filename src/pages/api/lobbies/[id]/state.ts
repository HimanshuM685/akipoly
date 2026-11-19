import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient, HttpError } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';

export const prerender = false;

export const GET = apiRoute(async ({ params, userId }) =>
  withClient(async (client) => {
    const lobbyId = params.id;
    if (!lobbyId) return json({ error: 'Missing lobby id.' }, 400);

    const lobby = await client.query(
      `select l.id, l.name, l.max_players, l.status, l.current_round, l.host_user_id, l.created_at
         from public.lobbies l where l.id = $1`,
      [lobbyId],
    );
    if (lobby.rowCount === 0) throw new HttpError(404, 'lobby not found');
    const l = lobby.rows[0];

    await ensureAppUser(client, userId);
    const seats = await client.query(
      `select s.user_id, coalesce(s.display_name, u.display_name) as display_name, u.wallet_address, s.joined_at
         from public.lobby_seats s
         join public.app_users u on u.privy_user_id = s.user_id
        where s.lobby_id = $1
        order by s.joined_at asc`,
      [lobbyId],
    );

    // The active game row, if any.
    const game = await client.query(
      `select id, ended_at is not null as ended from public.games where lobby_id = $1 order by started_at desc limit 1`,
      [lobbyId],
    );

    return json({
      lobby: l,
      seats: seats.rows.map((s) => ({ ...s, is_host: s.user_id === l.host_user_id })),
      gameId: game.rows[0]?.id ?? null,
      gameEnded: game.rows[0]?.ended ?? false,
      me: {
        is_host: l.host_user_id === userId,
        is_seated: seats.rows.some((s) => s.user_id === userId),
      },
    });
  }),
);

export const POST = apiRoute(async ({ params, userId }) =>
  withClient(async (client) => {
    const lobbyId = params.id;
    if (!lobbyId) return json({ error: 'Missing lobby id.' }, 400);

    const lobby = await client.query(
      `select id, status, host_user_id from public.lobbies where id = $1 for update`,
      [lobbyId],
    );
    if (lobby.rowCount === 0) throw new HttpError(404, 'lobby not found');
    const l = lobby.rows[0];
    if (l.host_user_id !== userId) throw new HttpError(403, 'only the host starts the game');
    if (l.status !== 'waiting') throw new HttpError(409, 'game already started');

    await ensureAppUser(client, userId);
    const seats = await client.query(
      `select count(*)::int as n,
              count(*) filter (where display_name is null) as unnamed
         from public.lobby_seats where lobby_id = $1`,
      [lobbyId],
    );
    if (seats.rows[0].n < 2) throw new HttpError(409, 'need at least 2 players (1 host + 1 voter)');
    if (seats.rows[0].unnamed > 0) {
      throw new HttpError(409, 'everyone needs a display name before the game starts');
    }

    const game = await client.query(
      `insert into public.games (lobby_id) values ($1) returning id`,
      [lobbyId],
    );
    await client.query(
      `insert into public.rounds (game_id, round_number, status) values ($1, 1, 'awaiting_spin')`,
      [game.rows[0].id],
    );
    await client.query(
      `update public.lobbies set status = 'live', current_round = 1, updated_at = now() where id = $1`,
      [lobbyId],
    );
    return json({ gameId: game.rows[0].id }, 201);
  }),
);
