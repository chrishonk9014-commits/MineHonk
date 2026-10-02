/**
 * V6 phase 2 browser check helper: where things generated in the e2e world
 * (seed given as the argument). Prints JSON: an example of each ore of the
 * Expanded End and the tallest giant chorus tree near the arrival platform,
 * so tests/e2e/v6.mjs can go and look at them.
 *
 *   npx tsx tests/e2e/v6-sites.ts v6-e2e
 */
import { initItems } from '../../src/common/registry/items';
import { blockOf } from '../../src/common/registry/blocks';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator } from '../../src/common/gen/generator';
import type { EndGenerator } from '../../src/common/gen/end';
import { expansionBiomeIndex } from '../../src/common/endExpansion/biomes';

initItems();
const g = createGenerator('end', seedFromString(process.argv[2] ?? 'v6-e2e')) as EndGenerator;
const ex = g.terrain.expansion;
const a = ex.arrival();

function scan(biome: string, want: (id: string) => boolean, r = 4): { x: number; y: number; z: number }[] {
  const s = ex.findBiome(expansionBiomeIndex(biome), a.x, a.z)!;
  const out: { x: number; y: number; z: number }[] = [];
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const c = g.generate((s.x >> 4) + dx, (s.z >> 4) + dz);
      for (let y = 2; y < 250; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (want(blockOf(c.get(x, y, z)).id)) out.push({ x: (c.cx << 4) + x, y, z: (c.cz << 4) + z });
    }
  return out;
}

const ores: Record<string, { x: number; y: number; z: number }> = {};
for (const [ore, biome] of [
  ['ender_ore', 'highlands'],
  ['void_crystal_ore', 'void_wastes'],
  ['astral_ore', 'astral_end'],
  ['ancient_end_fragment', 'shattered_end'],
] as const) {
  const found = scan(biome, (id) => id === ore, ore === 'astral_ore' ? 8 : 4);
  if (found.length) ores[ore] = found[Math.floor(found.length / 2)]!;
}

// The giant chorus tree with the tallest trunk
const stalks = scan('chorus_forest', (id) => id === 'chorus_stalk', 4);
const columns = new Map<string, { x: number; z: number; lo: number; hi: number }>();
for (const p of stalks) {
  const k = `${p.x},${p.z}`;
  const c = columns.get(k) ?? { x: p.x, z: p.z, lo: p.y, hi: p.y };
  c.lo = Math.min(c.lo, p.y);
  c.hi = Math.max(c.hi, p.y);
  columns.set(k, c);
}
const tree = [...columns.values()].sort((p, q) => q.hi - q.lo - (p.hi - p.lo))[0] ?? null;

console.log(JSON.stringify({ arrival: { x: a.x, y: a.floor, z: a.z }, ores, tree }));
