import { createServer } from 'http';
import { initWs } from './ws.js';
import { initDb } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.WS_PORT || 8081;
const DATABASE_URL = process.env.DATABASE_URL;
const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const ARC_USDC_CONTRACT = process.env.ARC_USDC_CONTRACT;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;
const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS;

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'akipoly-game-backend' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

initWs(server, {
  databaseUrl: DATABASE_URL,
  privyAppId: PRIVY_APP_ID,
  arcRpcUrl: ARC_RPC_URL,
  usdcContract: ARC_USDC_CONTRACT,
  opPrivateKey: OPERATOR_PRIVATE_KEY,
  opAddress: OPERATOR_ADDRESS,
});

server.listen(PORT, () => {
  console.log(`[backend] Akipoly game server listening on port ${PORT}`);
  console.log(`[backend] WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`[backend] Health check: http://localhost:${PORT}/health`);
  if (!DATABASE_URL) {
    console.warn('[backend] WARNING: DATABASE_URL not set — game engine will fail on DB calls');
  }
  if (!PRIVY_APP_ID) {
    console.warn('[backend] WARNING: PRIVY_APP_ID not set — auth will fail');
  }
});

process.on('SIGTERM', () => {
  console.log('[backend] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[backend] Server closed');
    process.exit(0);
  });
});
