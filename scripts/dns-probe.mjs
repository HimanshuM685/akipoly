/** Dev-only probe: does Cloudflare DNS unblock Neon from this machine? */
import dns from 'dns';

try {
  dns.setServers(['1.1.1.1', '1.0.0.1']);
  console.log('setServers ok, resolver:', dns.getServers());
} catch (e) {
  console.error('setServers failed:', e.message);
}

const url =
  'postgresql://neondb_owner:npg_qyOAMB8ws4PX@ep-delicate-frost-bdazwvs7-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);
try {
  const rows = await sql`select 1 as ok`;
  console.log('RESULT:', JSON.stringify(rows));
} catch (e) {
  console.error('still failing:', e.message);
}
process.exit(0);
