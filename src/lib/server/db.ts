/**
 * Server-side Postgres client factory. Every request gets a short-lived
 * client (connect → query → end). The connection string lives only in
 * DATABASE_URL (Vercel project env / local .env). Never import this from
 * client code.
 */
import pg from 'pg';

export const getDatabaseUrl = () =>
  process.env.DATABASE_URL ?? (import.meta as unknown as { env?: Record<string, string> }).env?.DATABASE_URL;

export async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  const servername =
    process.env.DATABASE_TLS_SERVERNAME ??
    (import.meta as unknown as { env?: Record<string, string> }).env?.DATABASE_TLS_SERVERNAME;

  const client = new pg.Client({
    connectionString,
    ssl: servername ? { rejectUnauthorized: true, servername } : true,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
