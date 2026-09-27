import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { OverworldGenerator } from '../../src/common/gen/generator';
import { blockOf } from '../../src/common/registry/blocks';
import type { Chunk } from '../../src/common/world/chunk';

function signature(c: Chunk): string {
  let h = 0;
  for (let y = 0; y < 256; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) h = (Math.imul(h, 31) + c.get(x, y, z)) | 0;
  return h + ':' + c.blockEntities.size;
}

function countBlocks(c: Chunk, pred: (id: string) => boolean): number {
  let n = 0;
  for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (pred(blockOf(c.get(x, y, z)).id)) n++;
  return n;
}

describe('world generation', () => {
  beforeAll(() => initItems());

  it('decorates identically regardless of generation order', () => {
    const a = new OverworldGenerator(12345);
    const b = new OverworldGenerator(12345);
    const sigA = signature(a.generate(3, 4));
    // Generate neighbours first in a scrambled order on the second generator
    for (const [x, z] of [
      [4, 5],
      [2, 3],
      [3, 5],
      [4, 3],
      [2, 4],
    ])
      b.generate(x!, z!);
    expect(signature(b.generate(3, 4))).toBe(sigA);
  });

  it('places ores, caves and vegetation', () => {
    const g = new OverworldGenerator(777);
    let coal = 0;
    let iron = 0;
    let diamond = 0;
    let plants = 0;
    for (let cx = 0; cx < 4; cx++)
      for (let cz = 0; cz < 4; cz++) {
        const c = g.generate(cx, cz);
        coal += countBlocks(c, (id) => id.endsWith('coal_ore'));
        iron += countBlocks(c, (id) => id.endsWith('iron_ore'));
        diamond += countBlocks(c, (id) => id.endsWith('diamond_ore'));
        plants += countBlocks(c, (id) => id === 'short_grass' || id === 'tall_grass' || id.endsWith('_log') || id === 'kelp' || id === 'seagrass' || id === 'snow');
      }
    expect(coal).toBeGreaterThan(100);
    expect(iron).toBeGreaterThan(50);
    expect(diamond).toBeGreaterThan(0);
    expect(plants).toBeGreaterThan(20);
  });

  it('locates and builds a stronghold with an end portal room', () => {
    const g = new OverworldGenerator(4242);
    const s = g.locate('stronghold', 0, 0)!;
    expect(s).toBeTruthy();
    const d = Math.hypot(s.x, s.z);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(1400);
    let frames = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = g.generate((s.x >> 4) + dx, (s.z >> 4) + dz);
        frames += countBlocks(c, (id) => id === 'end_portal_frame');
      }
    expect(frames).toBe(12);
  });

  it('builds villages with chests and villagers', () => {
    const g = new OverworldGenerator(99);
    const v = g.locate('village', 0, 0);
    expect(v).toBeTruthy();
    let doors = 0;
    let villagers = 0;
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        const c = g.generate((v!.x >> 4) + dx, (v!.z >> 4) + dz);
        doors += countBlocks(c, (id) => id.endsWith('_door'));
        villagers += c.genEntities.filter((e) => e.type === 'villager').length;
      }
    expect(doors).toBeGreaterThan(2);
    expect(villagers).toBeGreaterThan(0);
  });
});
