/**
 * Dev-only: connect to the Neon database, working around this machine's DNS
 * filter (it refuses *.neon.tech) by dialing the resolved IP directly while
 * keeping the real hostname for SNI / TLS validation, and run the SQL given
 * as arguments. With no args, lists the public schema read-only.
 *
 *   $env:NEON_DATABASE_URL_HOST="..."; $env:NEON_DATABASE_URL_PASSWORD="..."; node scripts/db.mjs [SQL ...]
 *
 * The connection string is NEVER written to disk; passwords come from env vars.
 */
import pg from 'pg';

const host = process.env.NEON_DB_HOST;
const password = process.env.NEON_DB_PASSWORD;
if (!host || !password) {
  console.error('NEON_DB_HOST and NEON_DB_PASSWORD must be set.');
  process.exit(1);
}

export const client = new pg.Client({
  host,
  port: 5432,
  user: 'neondb_owner',
  password,
  database: 'neondb',
  ssl: {
    servername: process.env.NEON_DB_SNI,
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 10000,
});

const statements = process.argv.slice(2);

try {
  await client.connect();
} catch (err) {
  console.error('Connection failed:', err.message);
  process.exit(1);
}

try {
  if (statements.length === 0) {
    const tables = await client.query(`select table_name from information_schema.tables where table_schema='public' order by table_name`);
    console.log('public tables:', JSON.stringify(tables.rows));
    const counts = await client.query(`select table_name from information_schema.tables where table_schema='public'`);
    for (const row of counts.rows) {
      const count = await client.query(`select count(*)::int as n from "${row.table_name}"`);
      console.log(row.table_name, '→', count.rows[0].n, 'rows');
    }
  } else {
    for (const statement of statements) {
      console.log('--- running:', statement.slice(0, 140).replace(/\s+/g, ' '));
      const result = await client.query(statement);
      console.log('ok:', result.rowCount, 'row(s)');
    }
  }
} catch (err) {
  console.error('Query failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
