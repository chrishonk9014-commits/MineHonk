/** V4: the Error Biome is one rare chunk, never two side by side, in the Overworld and Nether only. */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf } from '../../src/common/registry/blocks';
import { biomeOf } from '../../src/common/registry/biomes';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator, OverworldGenerator } from '../../src/common/gen/generator';
import { NetherGenerator } from '../../src/common/gen/nether';
import { ERROR_CELL, GLITCH_STAGES, levelFloor, levelAt, shaftAt, STRUCTURE_H } from '../../src/common/gen/v4/errorBiome';

initItems();

describe('V4 Error Biome', () => {
  it('is about one chunk in 5,000 and never two side by side', () => {
    const gen = new OverworldGenerator(seedFromString('error-rarity'));
    const cell = ERROR_CELL.overworld;
    let cells = 0;
    let found = 0;
    const seen: [number, number][] = [];
    for (let gx = -20; gx < 20; gx++)
      for (let gz = -20; gz < 20; gz++) {
        cells++;
        const e = gen.errorOfCell(gx, gz);
        if (!e) continue;
        found++;
        seen.push([e.cx, e.cz]);
        // Inside its own cell, a chunk away from the edges
        expect(e.cx - gx * cell).toBeGreaterThanOrEqual(1);
        expect(e.cx - gx * cell).toBeLessThanOrEqual(cell - 2);
        expect(e.cz - gz * cell).toBeGreaterThanOrEqual(1);
        expect(e.cz - gz * cell).toBeLessThanOrEqual(cell - 2);
      }
    const perChunk = (cells * cell * cell) / found;
    expect(perChunk).toBeGreaterThan(3500);
    expect(perChunk).toBeLessThan(7000);
    // No two Error chunks touch, even diagonally
    for (let i = 0; i < seen.length; i++)
      for (let j = i + 1; j < seen.length; j++) expect(Math.max(Math.abs(seen[i]![0] - seen[j]![0]), Math.abs(seen[i]![1] - seen[j]![1]))).toBeGreaterThan(1);
  });

  it('is exactly one chunk: the chunk is all Error Biome, its neighbours none of it', () => {
    const gen = new OverworldGenerator(seedFromString('error-shape'));
    const e = gen.nearestErrorChunk(0, 0)!;
    expect(e).toBeTruthy();
    const c = gen.generate(e.cx, e.cz);
    for (let i = 0; i < 256; i++) expect(biomeOf(c.biomes[i]!).id).toBe('error_biome');
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
    ] as const) {
      const n = gen.generate(e.cx + dx, e.cz + dz);
      expect([...n.biomes].some((b) => biomeOf(b).id === 'error_biome')).toBe(false);
      expect(gen.errorChunk(e.cx + dx, e.cz + dz)).toBeNull();
    }
    // A black and purple broken surface, nothing growing on it
    let broken = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (['error_block', 'missing_block', 'null_block', 'glitch_block'].includes(blockOf(c.get(x, e.surface, z)).id)) broken++;
    expect(broken).toBe(256);
    expect(c.genEntities.length).toBe(0);
  }, 60000);

  it('hides the five-stage Glitched Structure under the surface', () => {
    const gen = new OverworldGenerator(seedFromString('error-structure'));
    const e = gen.nearestErrorChunk(0, 0)!;
    const c = gen.generate(e.cx, e.cz);
    // Not visible from the surface: solid slab between the surface and the structure's roof
    const roof = e.base + STRUCTURE_H - 1;
    expect(e.surface - roof).toBeGreaterThanOrEqual(6);
    for (let y = roof; y <= e.surface; y++) expect(blockOf(c.get(8, y, 8)).id).not.toBe('air');
    // Every arena is open inside and the shafts below are shut by firewalls
    for (let s = 1; s <= GLITCH_STAGES; s++) {
      const f = levelFloor(e, s);
      expect(blockOf(c.get(7, f + 2, 2)).id).toBe('air');
      expect(levelAt(e, (e.cx << 4) + 7, f + 1, (e.cz << 4) + 7)).toBe(s);
      const sh = shaftAt(s);
      expect(blockOf(c.get(sh.lx, f, sh.lz)).id).toBe('glitch_firewall');
    }
    // The way into the first arena is open, the vault holds its chest
    const sh0 = shaftAt(0);
    expect(blockOf(c.get(sh0.lx, levelFloor(e, 0), sh0.lz)).id).toBe('ladder');
    expect(blockOf(c.get(7, levelFloor(e, GLITCH_STAGES + 1) + 1, 7)).id).toBe('chest');
    expect(gen.structureAt((e.cx << 4) + 7, levelFloor(e, 3) + 1, (e.cz << 4) + 7)).toBe('glitched_structure');
    expect(gen.structureAt((e.cx << 4) + 7, e.surface + 1, (e.cz << 4) + 7)).toBe('error_biome');
  }, 60000);

  it('generates in the Nether too, but never in the End or the Farlands, and never in older worlds', () => {
    const seed = seedFromString('error-dims');
    const nether = new NetherGenerator(seed);
    const e = nether.nearestErrorChunk(0, 0)!;
    expect(e).toBeTruthy();
    const c = nether.generate(e.cx, e.cz);
    expect(biomeOf(c.biomes[0]!).id).toBe('error_biome');
    expect(blockOf(c.get(7, levelFloor(e, 3) + 3, 7)).id).toBe('air');
    expect(nether.structureTypes()).toContain('glitched_structure');
    for (const dim of ['end', 'farlands'] as const) {
      const g = createGenerator(dim, seed);
      expect(g.structureTypes?.() ?? []).not.toContain('error_biome');
      expect(g.errorChunk).toBeUndefined();
      for (let cx = -3; cx <= 3; cx++) expect([...g.generate(cx * 50, cx * 30).biomes].some((b) => biomeOf(b).id === 'error_biome')).toBe(false);
    }
    const old = new OverworldGenerator(seed, { version: 3 });
    expect(old.nearestErrorChunk(0, 0)).toBeNull();
    expect(new NetherGenerator(seed, { version: 3 }).nearestErrorChunk(0, 0)).toBeNull();
  }, 60000);
});
