/**
 * V7 phase 5: the server's tick time and memory over a whole 45-minute
 * haunting, played as fast as the server can tick (54,000 ticks), with two
 * players walking about and building. Run against any checkout, so V7 can be
 * compared with V6.5 on the same machine:
 *
 *   node --expose-gc --import tsx tools/perf/haunt-bench.ts <checkout> <label> [character|auto|none]
 *
 * "none" ticks the same world for as long with no haunting (the baseline);
 * "auto" is the automatic haunting (V7); a character name starts that one
 * from the Admin Panel (V6.5 has only Herobrine). Prints one JSON line.
 */
import * as path from 'node:path';

const [root, label, who = 'herobrine'] = process.argv.slice(2);
if (!root || !label) throw new Error('usage: haunt-bench.ts <checkout> <label> [character|auto|none]');
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const mod = async <T>(p: string): Promise<T> => (await import(path.resolve(root, p))) as T;
const helpers = await mod<Any>('tests/helpers/testServer.ts');
const { MemoryStorage } = await mod<Any>('src/server/storage/Storage.ts');
const { S } = await mod<Any>('src/common/registry/blocks.ts');
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});

const { server } = await helpers.makeServer({ seed: 'haunt-bench', mode: 'survival', difficulty: 'normal', cheats: true }, new MemoryStorage(), { clock: () => Date.parse('2026-10-20T20:00:00Z') });
const a = await helpers.join(server, 'Ann', 'uuid-ann', 4);
const b = await helpers.join(server, 'Bob', 'uuid-bob', 4);
const TICKS = Number(process.env.TICKS ?? 45 * 60 * 20);
let req = 1;
const admin = (action: Record<string, unknown>): Any => {
  const r = req++;
  server.handle(a.conn, { t: 'admin', req: r, action });
  helpers.tick(server, 1);
  return a.conn.received.filter((m: Any) => m.t === 'admin_result' && m.req === r).pop();
};
if (who === 'auto') {
  server.level.flags.autoHaunt = { haunted: true, after: 0, played: 0, at: Date.now() };
  helpers.tick(server, 2);
} else if (who !== 'none') {
  const r = admin({ a: 'haunt', op: 'start', minutes: 45, erase: false, ...(process.env.ENDING ? { ending: process.env.ENDING } : {}), ...(who !== 'herobrine' ? { character: who } : {}) });
  if (!r?.ok) throw new Error(`could not start: ${r?.text}`);
}
const hauntOf = (): Any => server.level.flags.haunt;
const started = !!hauntOf();
// Keep the clients' message lists from growing for ever (a real connection sends them on)
const drain = (): void => {
  a.conn.received.length = 0;
  b.conn.received.length = 0;
};
gc();
const heap0 = process.memoryUsage().heapUsed;
const times: number[] = [];
let ticks = 0;
let maxEntities = 0;
let maxChanges = 0;
const x0 = a.player.x;
const z0 = a.player.z;
for (let i = 0; i < TICKS; i++) {
  // The players wander about, and now and then build and dig (what a haunting notices)
  const t = i / 20;
  a.player.setPos(x0 + Math.sin(t / 40) * 12, a.player.y, z0 + Math.cos(t / 40) * 12);
  b.player.setPos(x0 + Math.cos(t / 55) * 9, b.player.y, z0 - Math.sin(t / 55) * 9);
  if (i % 400 === 0) {
    const x = Math.floor(a.player.x) + 2;
    const z = Math.floor(a.player.z);
    const y = a.player.dim.getHeight(x, z) + 1;
    a.player.dim.setBlock(x, y, z, S('oak_planks'));
  }
  const t0 = performance.now();
  helpers.tick(server, 1);
  times.push(performance.now() - t0);
  ticks++;
  if (i % 200 === 0) {
    drain();
    maxEntities = Math.max(maxEntities, server.overworld.entities.size);
    maxChanges = Math.max(maxChanges, ((server.level.flags.hauntBlocks as unknown[]) ?? []).length);
  }
  // Its end shows everyone out: the run is over
  if (started && !hauntOf() && i > 100) break;
  if (!server.players.size) break;
}
drain();
gc();
const heap1 = process.memoryUsage().heapUsed;
const sorted = [...times].sort((x, y) => x - y);
const avg = times.reduce((s, v) => s + v, 0) / times.length;
console.log(
  JSON.stringify({
    label,
    who,
    ticks,
    minutes: +(ticks / 1200).toFixed(1),
    avgTickMs: +avg.toFixed(3),
    p99TickMs: +sorted[Math.floor(sorted.length * 0.99)]!.toFixed(2),
    maxTickMs: +sorted[sorted.length - 1]!.toFixed(1),
    heapGrowthMB: +((heap1 - heap0) / 1048576).toFixed(1),
    maxEntities,
    maxRecordedBlocks: maxChanges,
  }),
);
process.exit(0);
