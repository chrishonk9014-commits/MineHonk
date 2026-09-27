/**
 * Debug tool: renders a top-down shaded map of a generated area to PNG.
 * Usage: tsx tools/render-map.ts <seed> <centerX> <centerZ> <radiusChunks> <out.png> [dimension]
 */
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { initItems } from '../src/common/registry/items';
import { blockOf, STATE_BLOCK } from '../src/common/registry/blocks';
import { seedFromString } from '../src/common/math/rng';
import { createGenerator } from '../src/common/gen/generator';
import type { DimensionId } from '../src/common/data/biomes';
import { biomeOf } from '../src/common/registry/biomes';

initItems();
const [seedStr = 'minehonk', cxs = '0', czs = '0', rs = '16', out = 'map.png', dim = 'overworld', mode = 'blocks'] = process.argv.slice(2);
const seed = seedFromString(seedStr);
const gen = createGenerator(dim as DimensionId, seed);
const R = parseInt(rs, 10);
const ccx = Math.floor(parseInt(cxs, 10) / 16);
const ccz = Math.floor(parseInt(czs, 10) / 16);
const size = (R * 2 + 1) * 16;
const png = new PNG({ width: size, height: size });

const FALLBACK: Record<string, number> = {
  grass_block: 0x7fb238,
  water: 0x4060ff,
  sand: 0xf7e9a3,
  stone: 0x707070,
  snow: 0xffffff,
  snow_block: 0xffffff,
  ice: 0xa0a0ff,
  gravel: 0x888888,
  dirt: 0x976d4d,
  lava: 0xff4000,
};
function colorOf(state: number): number {
  const b = blockOf(state);
  if (b.def.mapColor !== undefined) return b.def.mapColor;
  if (FALLBACK[b.id] !== undefined) return FALLBACK[b.id]!;
  if (b.tags.has('leaves')) return 0x2f6f1f;
  if (b.tags.has('logs')) return 0x6b5132;
  if (b.tags.has('terracotta')) return 0xa05030;
  if (b.id.includes('sand')) return 0xd8c080;
  if (b.id.includes('snow')) return 0xf0f0f0;
  if (b.id.includes('ice')) return 0x9090f0;
  return 0x909090;
}

const t0 = performance.now();
let chunks = 0;
for (let dz = -R; dz <= R; dz++) {
  for (let dx = -R; dx <= R; dx++) {
    const c = gen.generate(ccx + dx, ccz + dz);
    chunks++;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let y = 255;
        while (y > 0 && (c.get(x, y, z) === 0 || blockOf(c.get(x, y, z)).id === 'cave_air')) y--;
        const st = c.get(x, y, z);
        let col = mode === 'biome' ? biomeOf(c.getBiome(x, z)).grass : colorOf(st);
        let shade = 1;
        if (blockOf(st).id === 'water') {
          let d = 0;
          while (d < 30 && STATE_BLOCK[c.get(x, y - d, z)] === STATE_BLOCK[st]) d++;
          shade = 1 - Math.min(0.5, d / 40);
        } else {
          const yn = z > 0 ? (() => { let yy = 255; while (yy > 0 && c.get(x, yy, z - 1) === 0) yy--; return yy; })() : y;
          shade = y > yn ? 1.12 : y < yn ? 0.84 : 1;
          shade *= 0.75 + (y / 255) * 0.5;
        }
        const r = Math.min(255, ((col >> 16) & 255) * shade);
        const g = Math.min(255, ((col >> 8) & 255) * shade);
        const b = Math.min(255, (col & 255) * shade);
        const px = (dx + R) * 16 + x;
        const pz = (dz + R) * 16 + z;
        const i = (pz * size + px) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      }
    }
  }
}
const ms = performance.now() - t0;
fs.writeFileSync(out, PNG.sync.write(png));
console.log(`generated ${chunks} chunks in ${ms.toFixed(0)}ms (${(ms / chunks).toFixed(2)} ms/chunk) -> ${out}`);
