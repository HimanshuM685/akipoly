/**
 * Wipe all game data (lobbies, games, rounds, picks, payouts, transfers, VRF
 * jobs). Users and schema_migrations stay. The leaderboard is computed from
 * finished games, so this empties it.
 *
 * Stop the server first (it holds live game state in memory):
 *   scripts/wipe-game-data.sh            (docker)
 *   npm run wipe:dev -- --yes            (local)
 * --force also wipes payouts still owed on chain (pending/sending/held).
 */
import { fileURLToPath } from 'node:url';
import { pool, withTx } from './pool.js';
import { log } from '../log.js';

const TABLES = [
  'payouts', 'chain_transfers', 'vrf_jobs', 'legacy_round_seeds', 'picks',
  'rounds', 'game_players', 'games', 'lobby_players', 'lobbies',
];

export async function wipeGames(force: boolean): Promise<Record<string, number>> {
  const owed = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.payouts where status in ('pending', 'sending', 'held')`,
  );
  const n = owed.rows[0]?.n ?? 0;
  if (n > 0 && !force) {
    throw new Error(`${n} payouts still owed on chain (pending/sending/held); settle them or pass --force`);
  }
  return withTx(async (c) => {
    const counts: Record<string, number> = {};
    for (const t of TABLES) {
      counts[t] = (await c.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0]?.n ?? 0;
    }
    await c.query(`truncate ${TABLES.map((t) => `public.${t}`).join(', ')} restart identity`);
    return counts;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (!args.includes('--yes')) {
    console.error('Refusing to wipe without --yes. This deletes all game data permanently.');
    process.exit(1);
  }
  wipeGames(args.includes('--force'))
    .then((deleted) => {
      log.info({ deleted }, 'game data wiped');
      return pool.end();
    })
    .catch((err) => {
      log.error({ err }, 'wipe failed');
      process.exit(1);
    });
}
