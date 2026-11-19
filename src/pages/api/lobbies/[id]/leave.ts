import { apiRoute, json } from '../../../../lib/server/helpers';
import { withClient, HttpError } from '../../../../lib/server/db';
import { ensureAppUser } from '../../../../lib/server/users';

export const prerender = false;

export const POST = apiRoute(async ({ params, userId }) =>
  withClient(async (client) => {
    const lobbyId = params.id;
    if (!lobbyId) return json({ error: 'Missing lobby id.' }, 400);

    const lobby = await client.query('select id, status, host_user_id from public.lobbies where id = $1', [lobbyId]);
    if (lobby.rowCount === 0) throw new HttpError(404, 'lobby not found');
    const l = lobby.rows[0];

    await ensureAppUser(client, userId);

    if (l.status === 'waiting') {
      // Host leaves → disband the lobby entirely.
      if (l.host_user_id === userId) {
        await client.query('delete from public.lobbies where id = $1', [lobbyId]);
        return json({ ok: true, disbanded: true });
      }
      await client.query('delete from public.lobby_seats where lobby_id = $1 and user_id = $2', [lobbyId, userId]);
      return json({ ok: true });
    }

    return json({ error: 'game already started — you can only leave it' }, 409);
  }),
);
