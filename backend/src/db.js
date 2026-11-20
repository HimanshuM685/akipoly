import pg from 'pg';

let pool = null;

export function initDb(connectionString) {
  pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  return pool;
}

export function getDb() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDb first.');
  }
  return pool;
}

export async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function getUserBalance(userId) {
  const result = await query('SELECT balance FROM public.app_users WHERE user_id = $1', [userId]);
  return result.rows[0]?.balance ?? null;
}

export async function updateUserBalance(userId, amount) {
  const result = await query(
    'UPDATE public.app_users SET balance = balance + $2 WHERE user_id = $1 RETURNING balance',
    [userId, amount]
  );
  return result.rows[0]?.balance ?? null;
}

export async function createPayout(gameId, roundId, userId, amountUsdc) {
  const result = await query(
    `INSERT INTO public.payouts (game_id, round_id, user_id, amount_usdc, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id, tx_hash, status`,
    [gameId, roundId, userId, amountUsdc]
  );
  return result.rows[0];
}

export async function confirmPayout(txHash) {
  const result = await query(
    `UPDATE public.payouts
     SET status = 'confirmed', confirmed_at = now()
     WHERE tx_hash = $1
     RETURNING id, status`,
    [txHash]
  );
  return result.rows[0];
}

export async function failPayout(txHash) {
  const result = await query(
    `UPDATE public.payouts
     SET status = 'failed'
     WHERE tx_hash = $1
     RETURNING id, status`,
    [txHash]
  );
  return result.rows[0];
}
