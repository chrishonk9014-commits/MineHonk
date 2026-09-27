/**
 * Dedicated MineHonk server.
 *
 *   PORT=8080 DATA_DIR=./data STATIC_DIR=./dist node dist-server/server.mjs
 *
 * Serves the built client (if STATIC_DIR exists), the account/friends/world
 * API under /api and game connections on /play.
 */
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { initItems } from '../common/registry/items';
import { Hub } from './Hub';

initItems();

const port = Number(process.env.PORT ?? 8080);
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const staticCandidate = path.resolve(process.env.STATIC_DIR ?? 'dist');
const staticDir = existsSync(path.join(staticCandidate, 'index.html')) ? staticCandidate : null;

const hub = await Hub.create({
  port,
  host: process.env.HOST,
  dataDir,
  staticDir,
  maxPlayersPerWorld: Number(process.env.MAX_PLAYERS ?? 16),
  trustProxy: process.env.TRUST_PROXY === '1',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
await hub.listen();
console.log(`[hub] data in ${dataDir}${staticDir ? `, serving client from ${staticDir}` : ' (no client build found; run npm run build)'}`);

let closing = false;
const shutdown = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  console.log('[hub] saving worlds and shutting down...');
  await hub.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
