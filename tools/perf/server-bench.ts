/**
 * Server tick cost with many mobs, near and far from the player.
 *   npx tsx tools/perf/server-bench.ts
 * NO_LOD=1 treats every mob as near a player (full-rate AI everywhere).
 */
import { makeServer, join, tick } from '../../tests/helpers/testServer';
import { Mob } from '../../src/server/entity/Mob';

if (process.env.NO_LOD) (Mob.prototype as unknown as { playerWithin(): boolean }).playerWithin = () => true;

const TYPES = ['zombie', 'skeleton', 'cow', 'pig', 'sheep', 'chicken', 'spider', 'creeper'];

async function run(label: string, count: number, minDist: number, maxDist: number): Promise<void> {
  const { server } = await makeServer({ seed: 'server-bench' });
  const { player } = await join(server, 'Bench', 'uuid-bench', 10);
  // Let the area around the player load
  for (let i = 0; i < 60; i++) {
    tick(server, 2);
    await new Promise((r) => setTimeout(r, 0));
  }
  const dim = player.dim;
  let placed = 0;
  for (let i = 0; i < count * 4 && placed < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * (maxDist - minDist);
    const x = Math.floor(player.x + Math.cos(a) * d);
    const z = Math.floor(player.z + Math.sin(a) * d);
    if (!dim.isLoaded(x, z)) continue;
    const y = dim.getHeight(x, z);
    const m = server.mobs!.spawn(dim, TYPES[placed % TYPES.length]!, x + 0.5, y, z + 0.5, { persistent: true });
    if (m) placed++;
  }
  server.level.dayTime = 6000;
  tick(server, 40); // warm up
  const t0 = performance.now();
  const N = 200;
  for (let i = 0; i < N; i++) tick(server, 1);
  const ms = (performance.now() - t0) / N;
  const mobs = [...dim.entities.values()].filter((e) => e instanceof Mob).length;
  console.log(`${label.padEnd(28)} ${mobs} mobs  ${ms.toFixed(2)} ms/tick`);
}

await run('no extra mobs', 0, 0, 0);
await run('150 mobs near (8-40 blocks)', 150, 8, 40);
await run('150 mobs far (70-150 blocks)', 150, 70, 150);
process.exit(0);
