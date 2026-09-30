/** V4: fences, panes, walls and gates take the right shape, in play and in generated structures. */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { S, stateOf, getProp, blockOf } from '../../src/common/registry/blocks';
import { connectState, type WorldReader } from '../../src/common/game/placement';
import { connectsTable, reconnectSeam } from '../../src/common/game/connections';
import { seedFromString } from '../../src/common/math/rng';
import { OverworldGenerator } from '../../src/common/gen/generator';
import type { Chunk } from '../../src/common/world/chunk';
import { makeServer, join, tick } from '../helpers/testServer';

initItems();

class Grid implements WorldReader {
  readonly m = new Map<string, number>();
  put(x: number, z: number, id: string | number, y = 0): void {
    this.m.set(`${x},${y},${z}`, typeof id === 'number' ? id : S(id));
  }
  getState(x: number, y: number, z: number): number {
    return this.m.get(`${x},${y},${z}`) ?? 0;
  }
}

const sides = (s: number): string =>
  ['north', 'east', 'south', 'west']
    .filter((d) => getProp(s, d) === 'true')
    .map((d) => d[0])
    .join('');

describe('V4 block connections', () => {
  it('glass panes join panes and blocks: straight, corner, T and cross', () => {
    const g = new Grid();
    // A plus of panes around (0, 0) with a stone block to the east of the east arm
    for (const [x, z] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      g.put(x, z, 'glass_pane');
    g.put(2, 0, 'stone');
    expect(sides(connectState(g, 0, 0, 0, S('glass_pane')))).toBe('nesw');
    expect(sides(connectState(g, 1, 0, 0, S('glass_pane')))).toBe('ew');
    expect(sides(connectState(g, 0, 0, 1, S('glass_pane')))).toBe('n');
    // Corner and T
    const c = new Grid();
    c.put(0, 0, 'glass_pane');
    c.put(1, 0, 'glass_pane');
    c.put(0, 1, 'glass_pane');
    expect(sides(connectState(c, 0, 0, 0, S('glass_pane')))).toBe('es');
    c.put(-1, 0, 'iron_bars');
    expect(sides(connectState(c, 0, 0, 0, S('glass_pane')))).toBe('esw');
    // Panes join glass blocks and walls
    const w = new Grid();
    w.put(0, 0, 'glass_pane');
    w.put(0, -1, 'glass');
    w.put(0, 1, 'cobblestone_wall');
    expect(sides(connectState(w, 0, 0, 0, S('glass_pane')))).toBe('ns');
  });

  it('fences join fences, blocks and gates along the gate line only', () => {
    const g = new Grid();
    g.put(0, 0, 'oak_fence');
    g.put(1, 0, 'oak_fence');
    g.put(-1, 0, 'spruce_fence');
    g.put(0, 1, 'stone');
    g.put(0, -1, stateOf('oak_fence_gate', { facing: 'north' }));
    // The gate faces north, so it spans east-west and cannot join a fence to its south
    expect(sides(connectState(g, 0, 0, 0, S('oak_fence')))).toBe('esw');
    g.put(0, -1, stateOf('oak_fence_gate', { facing: 'east' }));
    expect(sides(connectState(g, 0, 0, 0, S('oak_fence')))).toBe('nesw');
    // Nether brick fences do not join wooden ones
    g.put(1, 0, 'nether_brick_fence');
    expect(sides(connectState(g, 0, 0, 0, S('oak_fence')))).toBe('nsw');
  });

  it('walls join walls, panes and aligned gates, and raise a post at corners', () => {
    const g = new Grid();
    g.put(0, 0, 'cobblestone_wall');
    g.put(1, 0, 'cobblestone_wall');
    g.put(-1, 0, 'cobblestone_wall');
    let s = connectState(g, 0, 0, 0, S('cobblestone_wall'));
    expect(sides(s)).toBe('ew');
    expect(getProp(s, 'up')).toBe('false');
    g.put(0, 1, stateOf('oak_fence_gate', { facing: 'north' }));
    s = connectState(g, 0, 0, 0, S('cobblestone_wall'));
    expect(sides(s)).toBe('ew');
    g.put(0, 1, stateOf('oak_fence_gate', { facing: 'east' }));
    s = connectState(g, 0, 0, 0, S('cobblestone_wall'));
    expect(sides(s)).toBe('esw');
    expect(getProp(s, 'up')).toBe('true');
  });

  it('every connecting block of generated V4 structures has its proper shape, across chunk borders too', () => {
    const gen = new OverworldGenerator(seedFromString('v4-connections'));
    const v = gen.locate('village', 0, 0)!;
    expect(v).toBeTruthy();
    const cx0 = (v.x >> 4) - 3;
    const cz0 = (v.z >> 4) - 3;
    const chunks = new Map<string, Chunk>();
    for (let dz = 0; dz < 7; dz++) for (let dx = 0; dx < 7; dx++) chunks.set(`${cx0 + dx},${cz0 + dz}`, gen.generate(cx0 + dx, cz0 + dz));
    const w: WorldReader = { getState: (x, y, z) => chunks.get(`${x >> 4},${z >> 4}`)?.get(x & 15, y, z & 15) ?? 0 };
    // What the server does when neighbouring chunks are both loaded
    for (const c of chunks.values()) {
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const n = chunks.get(`${c.cx + dx},${c.cz + dz}`);
        if (n) reconnectSeam(w, c, n, (x, y, z, s) => chunks.get(`${x >> 4},${z >> 4}`)!.setRaw(x & 15, y, z & 15, s));
      }
    }
    const table = connectsTable();
    let checked = 0;
    const wrong: string[] = [];
    for (let dz = 1; dz < 6; dz++)
      for (let dx = 1; dx < 6; dx++) {
        const c = chunks.get(`${cx0 + dx},${cz0 + dz}`)!;
        for (let y = 0; y < 256; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const s = c.get(x, y, z);
              if (!table[s]) continue;
              checked++;
              const wx = (c.cx << 4) + x;
              const wz = (c.cz << 4) + z;
              if (connectState(w, wx, y, wz, s) !== s) wrong.push(`${blockOf(s).id}@${wx},${y},${wz}`);
            }
      }
    expect(checked).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  }, 120000);

  it('the server joins fences across a chunk border when the second chunk loads', async () => {
    const { server } = await makeServer({ seed: 'seam-test' });
    const { player } = await join(server);
    const dim = server.overworld;
    const x = (Math.floor(player.x) & ~15) + 15;
    const z = Math.floor(player.z);
    const y = 150;
    // Fences either side of the border between two loaded chunks, written without neighbour updates
    dim.getChunk(x >> 4, z >> 4)!.setRaw(x & 15, y, z & 15, S('oak_fence'));
    dim.getChunk((x + 1) >> 4, z >> 4)!.setRaw((x + 1) & 15, y, z & 15, S('oak_fence'));
    (server.blockUpdates as unknown as { joinNeighbours(d: typeof dim, c: Chunk): void }).joinNeighbours(dim, dim.getChunk((x + 1) >> 4, z >> 4)!);
    tick(server, 1);
    expect(getProp(dim.getState(x, y, z), 'east')).toBe('true');
    expect(getProp(dim.getState(x + 1, y, z), 'west')).toBe('true');
  });
});
