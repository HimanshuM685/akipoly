import pino from 'pino';
import { env } from './config/env.js';

export const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'akipoly-game' },
  redact: ['token', '*.token', 'privateKey'],
});
