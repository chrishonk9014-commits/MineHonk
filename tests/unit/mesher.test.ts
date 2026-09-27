import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { initItems } from '../../src/common/registry/items';
import { bakedModels, ModelKind } from '../../src/client/render/models';
import { Mesher, PAD, padIndex } from '../../src/client/render/mesher';
import { createGenerator } from '../../src/common/gen/generator';
import { LightEngine } from '../../src/common/world/light';
import { chunkIndex } from '../../src/common/world/constants';
import type { Chunk } from '../../src/common/world/chunk';
import { stateCount, blockOf } from '../../src/common/registry/blocks';

initItems();

describe('mesher', () => {
  it('bakes every block state', () => {
    const models = bakedModels();
    expect(models.length).toBe(stateCount());
    const broken = models.map((m, s) => (m.kind === ModelKind.Quads && m.quads!.some((q) => q.tex === 'missing_block') ? blockOf(s).id : null)).filter(Boolean);
    expect([...new Set(broken)]).toEqual([]);
  });

  it('meshes generated terrain quickly', () => {
    const atlas = JSON.parse(fs.readFileSync('public/assets/blocks.json', 'utf8'));
    const mesher = new Mesher(atlas);
    const gen = createGenerator('overworld', 42);
    const chunks = new Map<number, Chunk>();
    const light = new LightEngine({ getChunk: (x, z) => chunks.get(chunkIndex(x, z)), markLightDirty: () => {} }, true);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = gen.generate(dx, dz);
      chunks.set(chunkIndex(dx, dz), c);
    }
    for (const c of chunks.values()) light.initChunk(c);
    const get = (x: number, y: number, z: number): Chunk | undefined => chunks.get(chunkIndex(x >> 4, z >> 4));
    let total = 0;
    let ms = 0;
    for (let sy = 0; sy < 16; sy++) {
      const blocks = new Uint16Array(PAD ** 3);
      const lt = new Uint8Array(PAD ** 3);
      for (let y = -1; y <= 16; y++) for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
        const wy = sy * 16 + y;
        const c = get(x, wy, z);
        if (!c || wy < 0 || wy > 255) { lt[padIndex(x, y, z)] = 0xf0; continue; }
        blocks[padIndex(x, y, z)] = c.get(x & 15, wy, z & 15);
        lt[padIndex(x, y, z)] = c.getLight(x & 15, wy, z & 15);
      }
      const tints = new Uint8Array(PAD * PAD * 9).fill(128);
      const t0 = performance.now();
      const layers = mesher.mesh({ blocks, light: lt, tints, fancyLeaves: true, smoothLighting: true });
      ms += performance.now() - t0;
      total += layers.reduce((a, l) => a + l.quads, 0);
    }
    console.log(`meshed 16 sections: ${total} quads in ${ms.toFixed(1)}ms`);
    expect(total).toBeGreaterThan(200);
    expect(ms).toBeLessThan(2000);
  });
});
