/**
 * Chunk generation, lighting, encoding and meshing timings per dimension.
 * Runs in Node: npx tsx tools/perf/gen-bench.ts [chunks]
 */
import { createGenerator } from '../../src/common/gen/generator';
import { seedFromString } from '../../src/common/math/rng';
import { LightEngine } from '../../src/common/world/light';
import { encodeChunk, type Chunk } from '../../src/common/world/chunk';
import { chunkIndex } from '../../src/common/world/constants';
import { initItems } from '../../src/common/registry/items';
import fs from 'node:fs';
import { Mesher, PAD, padIndex } from '../../src/client/render/mesher';
import type { AtlasMeta } from '../../src/client/render/atlasInfo';

initItems();
const N = Number(process.argv[2] ?? 7);
const meta = JSON.parse(fs.readFileSync('public/assets/blocks.json', 'utf8')) as AtlasMeta;
const mesher = new Mesher(meta);
mesher.greedy = process.env.GREEDY !== '0';

for (const dim of ['overworld', 'nether', 'end', 'farlands'] as const) {
  const gen = createGenerator(dim, seedFromString('bench-seed'), process.env.GEN_VERSION ? { version: Number(process.env.GEN_VERSION) } : {});
  const chunks = new Map<number, Chunk>();
  const base = dim === 'end' ? 0 : dim === 'farlands' ? 0 : 0;
  const t0 = performance.now();
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) chunks.set(chunkIndex(base + x, base + z), gen.generate(base + x, base + z));
  const genMs = (performance.now() - t0) / (N * N);
  const light = new LightEngine({ getChunk: (cx, cz) => chunks.get(chunkIndex(cx, cz)), markLightDirty: () => {} }, dim !== 'nether' && dim !== 'end');
  const t1 = performance.now();
  for (const c of chunks.values()) light.initChunk(c);
  const lightMs = (performance.now() - t1) / chunks.size;
  const t2 = performance.now();
  let bytes = 0;
  for (const c of chunks.values()) bytes += encodeChunk(c, { light: true, blockEntities: true }).length;
  const encMs = (performance.now() - t2) / chunks.size;
  // Mesh the inner chunks' sections
  let sections = 0;
  let quads = 0;
  const t3 = performance.now();
  for (let z = 1; z < N - 1; z++)
    for (let x = 1; x < N - 1; x++) {
      const c = chunks.get(chunkIndex(base + x, base + z))!;
      for (let sy = 0; sy <= c.topSection(); sy++) {
        const blocks = new Uint16Array(PAD * PAD * PAD);
        const lightA = new Uint8Array(PAD * PAD * PAD);
        for (let dz = -1; dz <= 16; dz++)
          for (let dx = -1; dx <= 16; dx++) {
            const nc = chunks.get(chunkIndex(base + x + Math.floor(dx / 16), base + z + Math.floor(dz / 16)))!;
            const lx = (dx + 16) & 15;
            const lz = (dz + 16) & 15;
            for (let y = -1; y <= 16; y++) {
              const wy = sy * 16 + y;
              if (wy < 0 || wy > 255) continue;
              blocks[padIndex(dx, y, dz)] = nc.get(lx, wy, lz);
              lightA[padIndex(dx, y, dz)] = nc.getLight(lx, wy, lz);
            }
          }
        const { layers } = mesher.mesh({ blocks, light: lightA, tints: new Uint8Array(PAD * PAD * 9).fill(128), fancyLeaves: true, smoothLighting: true });
        for (const l of layers) quads += l.quads;
        sections++;
      }
    }
  const meshMs = (performance.now() - t3) / Math.max(1, sections);
  console.log(`${dim.padEnd(10)} gen ${genMs.toFixed(2)}ms/chunk  light ${lightMs.toFixed(2)}ms  encode ${encMs.toFixed(2)}ms (${Math.round(bytes / chunks.size / 1024)}KB)  mesh ${meshMs.toFixed(2)}ms/section  ${Math.round(quads / Math.max(1, (N - 2) * (N - 2)))} quads/chunk`);
}
