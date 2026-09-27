/**
 * Debug tool: zoomed top-down map of generated chunks around a position plus
 * a count of structure blocks. Usage: tsx tools/structure-map.ts <seed> <x> <z> <radiusChunks> <out.png>
 */
import { initItems } from '../src/common/registry/items';
import { OverworldGenerator } from '../src/common/gen/generator';
import { seedFromString } from '../src/common/math/rng';
import { blockOf } from '../src/common/registry/blocks';
import { PNG } from 'pngjs';
import fs from 'node:fs';
initItems();
const g = new OverworldGenerator(seedFromString(process.argv[2]!));
const cx = Math.floor(Number(process.argv[3]) / 16), cz = Math.floor(Number(process.argv[4]) / 16), R = Number(process.argv[5] ?? 3);
const counts: Record<string, number> = {};
const S = 4; const size = (2 * R + 1) * 16;
const png = new PNG({ width: size * S, height: size * S });
const col = (id: string): number => {
  if (id === 'dirt_path') return 0xb09050; if (id.includes('planks')) return 0xc8a060; if (id.includes('log')) return 0x6b5132; if (id.includes('cobble')) return 0x777777;
  if (id.includes('stairs') || id.includes('slab')) return 0x5a3a20; if (id === 'water') return 0x3050ff; if (id.includes('leaves')) return 0x2f6f1f; if (id === 'grass_block') return 0x70a040;
  if (id === 'farmland' || ['wheat','carrots','potatoes','beetroots','sunroot'].includes(id)) return 0xd0c040; if (id.includes('fence')) return 0x9a7a4a; if (id === 'bell' || id === 'lantern') return 0xffe060;
  if (id.includes('sand')) return 0xe0d090; if (id.includes('terracotta')) return 0xc06030; if (id === 'short_grass' || id === 'tall_grass') return 0x5a9a30; return 0x999999;
};
for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
  const c = g.generate(cx + dx, cz + dz);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let y = 255; while (y > 0 && c.get(x, y, z) === 0) y--;
    const id = blockOf(c.get(x, y, z)).id;
    for (let yy = 0; yy < 256; yy++) { const i2 = blockOf(c.get(x, yy, z)).id; if (/door|bed|chest|bell|path|farmland|bookshelf|furnace|anvil|spawner|frame/.test(i2)) counts[i2] = (counts[i2] ?? 0) + 1; }
    const px = (dx + R) * 16 + x, pz = (dz + R) * 16 + z; const cc = col(id);
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const o = ((pz * S + b) * size * S + px * S + a) * 4; png.data[o] = cc >> 16; png.data[o + 1] = (cc >> 8) & 255; png.data[o + 2] = cc & 255; png.data[o + 3] = 255; }
  }
}
console.log(JSON.stringify(counts));
fs.writeFileSync(process.argv[6]!, PNG.sync.write(png));
