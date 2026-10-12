/**
 * Worlds made with V4's generator keep generating exactly as they did when
 * the temples and bunkers were reworked (generator 5): terrain, structures
 * (the V4 bunker and jungle temple included) and the nether. The hashes were
 * recorded from the last commit before generator 5.
 */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator } from '../../src/common/gen/generator';
import type { Chunk } from '../../src/common/world/chunk';
import { hashChunks } from './v3-regression.test';

initItems();

describe('V4 worlds are unchanged by generator 5', () => {
  const seed = seedFromString('v4-regression');

  it('overworld terrain and surface', () => {
    const gen = createGenerator('overworld', seed, { version: 4 });
    const chunks: Chunk[] = [];
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) chunks.push(gen.generate(cx * 9, cz * 9));
    expect(hashChunks(chunks)).toBe('53a6f771');
  }, 120000);

  it('overworld structures, the bunker and jungle temple included', () => {
    const gen = createGenerator('overworld', seed, { version: 4 });
    const chunks: Chunk[] = [];
    for (const type of ['village', 'bunker', 'jungle_temple', 'desert_temple', 'witch_hut']) {
      const s = gen.locate!(type, 0, 0);
      expect(s, type).toBeTruthy();
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) chunks.push(gen.generate((s!.x >> 4) + dx, (s!.z >> 4) + dz));
    }
    expect(hashChunks(chunks)).toBe('607354bd');
  }, 240000);

  it('nether', () => {
    const nether = createGenerator('nether', seed, { version: 4 });
    const chunks: Chunk[] = [];
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) chunks.push(nether.generate(cx * 11, cz * 11));
    expect(hashChunks(chunks)).toBe('755c3676');
  }, 120000);
});
