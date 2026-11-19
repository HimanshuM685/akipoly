/**
 * Ensure the Privy user has an app_users row; returns the row.
 */
import pg from 'pg';
import { HttpError } from './db';

export interface AppUser {
  privy_user_id: string;
  wallet_address: string | null;
  display_name: string | null;
}

export async function ensureAppUser(
  client: pg.Client,
  privyUserId: string,
  walletAddress?: string | null,
  displayName?: string | null,
): Promise<AppUser> {
  if (!privyUserId) throw new HttpError(401, 'missing user');

  const existing = await client.query(
    'select privy_user_id, wallet_address, display_name from public.app_users where privy_user_id = $1',
    [privyUserId],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    // Best-effort freshen wallet address if the client sent one.
    if (walletAddress && walletAddress !== row.wallet_address) {
      await client.query(
        'update public.app_users set wallet_address = $2 where privy_user_id = $1',
        [privyUserId, walletAddress],
      ).catch(() => undefined);
      row.wallet_address = walletAddress;
    }
    return row;
  }

  const inserted = await client.query(
    `insert into public.app_users (privy_user_id, wallet_address, display_name)
     values ($1, $2, $3)
     on conflict (privy_user_id) do update set
       wallet_address = coalesce(excluded.wallet_address, public.app_users.wallet_address)
     returning privy_user_id, wallet_address, display_name`,
    [privyUserId, walletAddress ?? null, displayName ?? null],
  );
  return inserted.rows[0];
}
