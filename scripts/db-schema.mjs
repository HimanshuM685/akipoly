/**
 * Dev-only: connect to the Neon database (pooled endpoint) and run the given
 * SQL statements from stdin-safe args, or print the public schema listing when
 * called with no args. The connection string comes from the NEON_DATABASE_URL
 * environment variable and is NEVER committed.
 *
 *   $env:NEON_DATABASE_URL="postgres://..."; node scripts/db-schema.mjs
 *   $env:NEON_DATABASE_URL="postgres://..."; node scripts/db-schema.mjs "CREATE TABLE ..."
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.NEON_DATABASE_URL;
if (!url) {
  console.error('NEON_DATABASE_URL is not set. Refusing to connect.');
  process.exit(1);
}

const sql = neon(url);
const statements = process.argv.slice(2);

if (statements.length === 0) {
  // Read-only inspection: what tables exist?
  const tables = await sql`
    select table_name, table_type
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;
  console.log(JSON.stringify(tables, null, 2));

  const columns = await sql`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `;
  console.log(JSON.stringify(columns, null, 2));
  process.exit(0);
}

for (const statement of statements) {
  console.log('--- running:', statement.slice(0, 120).replace(/\s+/g, ' '));
  const result = await sql.unsafe(statement);
  console.log('ok', Array.isArray(result) ? `(${result.length} rows)` : result);
}
process.exit(0);
