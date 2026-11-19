/**
 * Server-side Postgres client factory. Every request gets a short-lived
 * client (connect → query → end). The connection string lives only in
 * DATABASE_URL (Vercel project env / local .env). Never import this from
 * client code.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

export const getDatabaseUrl = () =>
  (import.meta as unknown as { env?: Record<string, string> }).env?.DATABASE_URL ??
  readEnvVar('DATABASE_URL') ??
  process.env.DATABASE_URL;

/** Read .env file directly as a fallback when import.meta.env / process.env
   don't have the value (Astro dev server quirks, shell env overrides, etc.). */
function readEnvVar(key: string): string | undefined {
  try {
    const envContent = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
    const line = envContent.split('\n').find((l) => {
      const trimmed = l.trim();
      return trimmed.startsWith(`${key}=`) && !trimmed.startsWith('#');
    });
    return line?.split('=').slice(1).join('=').trim().replace(/^"|"$|^'|'$/g, '');
  } catch {
    return undefined;
  }
}

export async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  const servername =
    (import.meta as unknown as { env?: Record<string, string> }).env?.DATABASE_TLS_SERVERNAME ??
    readEnvVar('DATABASE_TLS_SERVERNAME') ??
    process.env.DATABASE_TLS_SERVERNAME;

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
