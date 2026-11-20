import pg from 'pg';
import { env } from '../config/env.js';
import { log } from '../log.js';

// int8 → bigint (money and counts). numeric stays a string; cast in SQL.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => BigInt(v));

export type Db = pg.PoolClient | pg.Pool;

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ...(env.DATABASE_TLS_SERVERNAME
    ? { ssl: { rejectUnauthorized: true, servername: env.DATABASE_TLS_SERVERNAME } }
    : {}),
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  statement_timeout: 10_000,
  query_timeout: 15_000,
  application_name: 'akipoly-game',
});

// Without this, Neon dropping an idle connection emits an unhandled 'error'
// and crashes the process. The pool discards the client on its own.
pool.on('error', (err) => log.warn({ err }, 'idle db client error'));

/**
 * Run fn in a transaction. A client whose connection broke is destroyed
 * (release(err)) instead of going back into the pool.
 */
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = rollbackErr as Error;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
