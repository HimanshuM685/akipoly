import { createServer } from 'node:http';
import { arc, env } from './config/env.js';
import { log } from './log.js';
import { pool, poolStats } from './db/pool.js';
import { pendingMigrations } from './db/migrate.js';
import { treasuryAddress } from './chain/usdc.js';
import { startScheduler, stopScheduler } from './scheduler/ticker.js';
import { startPayoutWorker, stopPayoutWorker } from './services/payouts.js';
import { attachWebSocket } from './ws/server.js';

async function main() {
  const pending = await pendingMigrations().catch((err) => {
    log.fatal({ err }, 'cannot reach the database — check DATABASE_URL and network');
    process.exit(1);
  });
  if (pending.length) {
    log.fatal({ pending }, 'database schema is behind — run `npm run migrate` first');
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/health') return send(200, { status: 'ok', network: arc.network, db: poolStats() });
    if (req.url === '/ready') {
      try {
        await pool.query('select 1');
        return send(200, { status: 'ready' });
      } catch {
        return send(503, { status: 'db unavailable' });
      }
    }
    send(404, { error: 'not found' });
  });

  const wss = attachWebSocket(server);
  startScheduler();
  if (env.PAYOUT_WORKER) startPayoutWorker();

  server.listen(env.PORT, () => {
    log.info({ port: env.PORT, network: arc.network, chainId: arc.chainId, treasury: treasuryAddress }, 'akipoly game server up');
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    stopScheduler();
    stopPayoutWorker();
    for (const client of wss.clients) client.close(1001, 'server restarting');
    wss.close();
    server.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
});
