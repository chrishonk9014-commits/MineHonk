/**
 * V6 (generator 6) leaves the classic End alone: the main island, the outer
 * islands and an End city generate byte-identically for every generator
 * version, V6 included, and older worlds keep their outer islands all the
 * way out to the Expanded End. The hashes were recorded from the last commit
 * before V6 (V5.5).
 *
 * The other dimensions don't change in generator 6 at all.
 */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator, type DimensionGenerator } from '../../src/common/gen/generator';
import type { Chunk } from '../../src/common/world/chunk';
import { hashChunks } from './v3-regression.test';

initItems();

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

describe('the classic End is unchanged by V6', () => {
  const seed = seedFromString('v6-regression');

  for (const version of [1, 3, 5, 6]) {
    it(`main island, outer islands and an End city (generator ${version})`, () => {
      const g = createGenerator('end', seed, { version });
      expect(hashChunks(around(g, 0, 0, 2)), 'main island').toBe('f9c2209d');
      expect(hashChunks([...around(g, 1100, 0), ...around(g, 0, -1500), ...around(g, -2100, 1300), ...around(g, 2700, 2700)]), 'outer islands').toBe('ac20fd6a');
      const city = g.locate!('end_city', 1400, 300);
      expect(city).toBeTruthy();
      expect(hashChunks(around(g, city!.x, city!.z)), 'end city').toBe('ea8a27e2');
    }, 120000);
  }

  it('older worlds keep their outer islands right up to the Expanded End', () => {
    for (const version of [1, 3, 5]) {
      const g = createGenerator('end', seed, { version });
      expect(hashChunks([...around(g, 4500, -300), ...around(g, -3900, -3900), ...around(g, 5600, 900)]), `generator ${version}`).toBe('e7dd154f');
    }
  }, 120000);

  it('V6 worlds: the outer islands stop well before the Expanded End', () => {
    const g = createGenerator('end', seed, { version: 6 });
    const old = createGenerator('end', seed, { version: 5 });
    let land6 = 0;
    let land5 = 0;
    for (let i = 0; i < 400; i++) {
      const a = (i / 400) * Math.PI * 2;
      for (const d of [4700, 5200, 5800]) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        if (g.landAt!(x, z)) land6++;
        if (old.landAt!(x, z)) land5++;
      }
    }
    expect(land6).toBe(0);
    expect(land5).toBeGreaterThan(50);
  });
});

describe('generator 6 changes nothing outside the End', () => {
  const seed = seedFromString('v6-regression');
  for (const [dim, step] of [
    ['overworld', 9],
    ['nether', 11],
    ['farlands', 13],
  ] as const) {
    it(dim, () => {
      expect(hashChunks(spread(createGenerator(dim, seed, { version: 6 }), step))).toBe(hashChunks(spread(createGenerator(dim, seed, { version: 5 }), step)));
    }, 240000);
  }
});
