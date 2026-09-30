/**
 * Worlds made before V4 keep generating exactly as they did: every dimension,
 * villages and other structures, chests and structure mobs. The hashes were
 * recorded from the last commit before V4's generator (V3.5).
 */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf } from '../../src/common/registry/blocks';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator, type DimensionGenerator } from '../../src/common/gen/generator';
import type { Chunk } from '../../src/common/world/chunk';

initItems();

export function hashChunks(chunks: Chunk[]): string {
  let h = 2166136261;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  for (const c of chunks) {
    for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) mix(blockOf(c.get(x, y, z)).id);
    mix(Array.from(c.biomes).join(','));
    mix(JSON.stringify([...c.blockEntities.entries()].sort((a, b) => a[0] - b[0])));
    mix(JSON.stringify(c.genEntities));
  }
  return (h >>> 0).toString(16);
}

function around(gen: DimensionGenerator, x: number, z: number, r = 1): Chunk[] {
  const out: Chunk[] = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.push(gen.generate((x >> 4) + dx, (z >> 4) + dz));
  return out;
}

function spread(gen: DimensionGenerator, step: number): Chunk[] {
  const out: Chunk[] = [];
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) out.push(gen.generate(cx * step, cz * step));
  return out;
}

describe('V3 worlds are unchanged by V4', () => {
  const seed = seedFromString('v3-regression');

  it('overworld terrain, caves and surface', () => {
    const gen = createGenerator('overworld', seed, { version: 3 });
    expect(hashChunks(spread(gen, 9))).toBe('7b181610');
  }, 120000);

  it('overworld structures', () => {
    const gen = createGenerator('overworld', seed, { version: 3 });
    const chunks: Chunk[] = [];
    for (const type of ['village', 'desert_temple', 'jungle_temple', 'witch_hut', 'igloo', 'pillager_outpost', 'ruined_portal']) {
      const s = gen.locate!(type, 0, 0);
      if (s) chunks.push(...around(gen, s.x, s.z, type === 'village' ? 2 : 1));
    }
    expect(chunks.length).toBeGreaterThan(20);
    expect(hashChunks(chunks)).toBe('85221c66');
  }, 240000);

  it('nether, end and farlands', () => {
    const nether = createGenerator('nether', seed, { version: 3 });
    const end = createGenerator('end', seed, { version: 3 });
    const far = createGenerator('farlands', seed, { version: 3 });
    expect(hashChunks(spread(nether, 11))).toBe('33a585f2');
    expect(hashChunks([...around(end, 0, 0), ...spread(end, 70)])).toBe('f7b2ffaf');
    expect(hashChunks(spread(far, 13))).toBe('4106c8f1');
  }, 240000);
});
