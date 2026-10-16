import { it, expect } from 'vitest';
import { makeServer } from '../helpers/testServer';
import { admin, join, tick, SEED, VILLAGE } from '../helpers/halloween';
import { MemoryStorage } from '../../src/server/storage/Storage';
it('dbg: the village lookup right after a teleport, before the village is built', async () => {
  const { server } = await makeServer({ seed: SEED, cheats: true }, new MemoryStorage(), { clock: () => Date.UTC(2026, 9, 20) });
  const a = await join(server, 'Alice', 'uuid-a');
  server.handle(a.conn, { t: 'chat', text: `/tp ${VILLAGE.x} 120 ${VILLAGE.z}` });
  tick(server, 5);
  const t0 = performance.now();
  const r = admin(server, a.conn, { a: 'halloween', op: 'village_doors' });
  console.log('took', performance.now() - t0, r.ok, r.text);
  require('node:fs').writeFileSync('/tmp/claude-0/-home-user/d6887004-d452-5cf7-8b8b-14621ee25e63/scratchpad/dbg4.txt', `took ${performance.now() - t0} ${r.ok} ${r.text} ${JSON.stringify(r.data).slice(0, 300)}`);
  expect(r.ok).toBe(true);
}, 300000);
