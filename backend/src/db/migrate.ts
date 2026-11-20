/**
 * Minimal forward-only migration runner. Applies migrations/NNN_*.sql in
 * order, each in its own transaction, recorded in schema_migrations.
 * Run: `npm run migrate` (prod, compiled) or `npm run migrate:dev`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, withTx } from './pool.js';
import { log } from '../log.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function migrate(): Promise<string[]> {
  await pool.query(
    `create table if not exists public.schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  const done = new Set(
    (await pool.query<{ name: string }>('select name from public.schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(dir + file, 'utf8');
    await withTx(async (c) => {
      await c.query(sql);
      await c.query('insert into public.schema_migrations (name) values ($1)', [file]);
    });
    log.info({ file }, 'migration applied');
    applied.push(file);
  }
  return applied;
}

export async function pendingMigrations(): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f));
  const res = await pool
    .query<{ name: string }>('select name from public.schema_migrations')
    .catch(() => ({ rows: [] as { name: string }[] }));
  const done = new Set(res.rows.map((r) => r.name));
  return files.filter((f) => !done.has(f));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((applied) => {
      log.info({ applied }, applied.length ? 'migrations complete' : 'schema up to date');
      return pool.end();
    })
    .catch((err) => {
      log.error({ err }, 'migration failed');
      process.exit(1);
    });
}
