/** V2 underground generation: V1 worlds unchanged, V2 caves deterministic, seamless and big. */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf } from '../../src/common/registry/blocks';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator, OverworldGenerator } from '../../src/common/gen/generator';
import type { Chunk } from '../../src/common/world/chunk';
import { CaveBiome } from '../../src/common/gen/caves/caveBiomes';
import { RIVER_LEVEL } from '../../src/common/gen/caves/carver';

initItems();

function hashChunks(chunks: Chunk[]): string {
  let h = 2166136261;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  for (const c of chunks) {
    for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) mix(blockOf(c.get(x, y, z)).id);
    mix(Array.from(c.biomes).join(','));
  }
  return (h >>> 0).toString(16);
}

function countIds(c: Chunk, ids: string[], y0 = 5, y1 = 60): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (ids.includes(blockOf(c.get(x, y, z)).id)) n++;
  return n;
}

describe('V2 caves', () => {
  it('worlds made with the V1 generator are generated exactly as in V1', () => {
    const gen = createGenerator('overworld', seedFromString('v1-regression'), { version: 1 });
    const chunks: Chunk[] = [];
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) chunks.push(gen.generate(cx * 5, cz * 5));
    // Recorded from the last commit before the Caves Update
    expect(hashChunks(chunks)).toBe('4ccf0381');
  });

  it('worlds made with the V2 generator are generated exactly as in V2', () => {
    const gen = createGenerator('overworld', seedFromString('v2-regression'), { version: 2 });
    const chunks: Chunk[] = [];
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) chunks.push(gen.generate(cx * 7, cz * 7));
    // (7, 7) holds frozen caves, which V3 reworks for new worlds only
    chunks.push(gen.generate(7, 7));
    // Recorded from the last commit before V3's generator
    expect(hashChunks(chunks)).toBe('78e60319');
  }, 60000);

  it('are deterministic and independent of generation order', () => {
    const seed = seedFromString('cave-order');
    const a = new OverworldGenerator(seed);
    const b = new OverworldGenerator(seed);
    const order = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const ra = order.map(([x, z]) => a.generate(x!, z!));
    const rb = [...order].reverse().map(([x, z]) => b.generate(x!, z!)).reverse();
    expect(hashChunks(ra)).toBe(hashChunks(rb));
  });

  it('are seamless across chunk borders', () => {
    // A cave passing a border continues on the other side: compare open cells on both sides of each seam
    const gen = new OverworldGenerator(seedFromString('seams'));
    let open = 0;
    let matched = 0;
    const sp = gen.findSpawn();
    const x0 = sp.x >> 4;
    const z0 = sp.z >> 4;
    for (let cx = x0; cx < x0 + 6; cx++) {
      const a = gen.generate(cx, z0);
      const b = gen.generate(cx + 1, z0);
      for (let y = 8; y < 50; y++)
        for (let z = 0; z < 16; z++) {
          const oa = blockOf(a.get(15, y, z)).id === 'cave_air';
          const ob = blockOf(b.get(0, y, z)).id === 'cave_air';
          if (oa) {
            open++;
            if (ob) matched++;
          }
        }
    }
    expect(open).toBeGreaterThan(50);
    // Neighbouring columns agree most of the time (a hard cut would give ~ the cave density, well below this)
    expect(matched / open).toBeGreaterThan(0.6);
  });

  it('carve much more underground space than V1', () => {
    const s = seedFromString('volume');
    const v1 = createGenerator('overworld', s, { version: 1 });
    const v2 = createGenerator('overworld', s, { version: 2 });
    let a = 0;
    let b = 0;
    for (let cz = 0; cz < 4; cz++)
      for (let cx = 0; cx < 4; cx++) {
        a += countIds(v1.generate(cx * 3, cz * 3), ['cave_air', 'water', 'lava']);
        b += countIds(v2.generate(cx * 3, cz * 3), ['cave_air', 'water', 'lava']);
      }
    expect(b).toBeGreaterThan(a * 1.1);
  });

  it('has rare mega-caverns, ravines and underground rivers', () => {
    const gen = new OverworldGenerator(seedFromString('minehonk'));
    const carver = gen.terrain.carver!;
    const mega = carver.nearestMega(0, 0)!;
    expect(mega).toBeTruthy();
    // The middle of a mega-cavern is a huge open space
    const c = gen.generate(mega.x >> 4, mega.z >> 4);
    const open = countIds(c, ['cave_air', 'water', 'lava'], mega.y - 10, mega.y + 12);
    expect(open).toBeGreaterThan(16 * 16 * 22 * 0.5);
    const rav = carver.nearestRavine(0, 0)!;
    expect(rav).toBeTruthy();
    expect(RIVER_LEVEL).toBeLessThan(40);
  });

  it('the runtime cave biome lookup agrees with world generation', () => {
    const gen = new OverworldGenerator(seedFromString('biome-agree'));
    let checked = 0;
    for (let cx = 0; cx < 3; cx++) {
      const proto = gen.terrain.generate(cx * 7, 3);
      const grid = proto.caveBiomes!;
      for (let cy = 2; cy < 14; cy++)
        for (let gz = 0; gz < 4; gz++)
          for (let gx = 0; gx < 4; gx++) {
            const want = grid[(cy * 4 + gz) * 4 + gx]!;
            const got = gen.terrain.caveBiomeAt(cx * 7 * 16 + gx * 4 + 1, cy * 4 + 3, 3 * 16 + gz * 4);
            if (!want || !got) continue;
            expect(got).toBe(want);
            checked++;
          }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('assigns every cave biome somewhere', () => {
    const gen = new OverworldGenerator(seedFromString('biomes'));
    const seen = new Set<number>();
    for (let x = -3000; x <= 3000 && seen.size < 9; x += 97)
      for (let z = -3000; z <= 3000 && seen.size < 9; z += 211) for (const y of [12, 20, 30, 40, 50]) seen.add(gen.terrain.caveBiomeAt(x, y, z));
    for (const b of [CaveBiome.Caves, CaveBiome.Deep, CaveBiome.Lush, CaveBiome.Mushroom, CaveBiome.Crystal, CaveBiome.Dripstone, CaveBiome.Lava, CaveBiome.Frozen, CaveBiome.DeepDark]) expect(seen.has(b), `biome ${b}`).toBe(true);
  });
});
