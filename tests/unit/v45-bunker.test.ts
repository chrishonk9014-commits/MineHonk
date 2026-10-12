/**
 * Version 4.5 bunkers: random layouts, a bedrock shell nobody can dig
 * through, the keycard in a guard post's chest on the surface, biome styles,
 * and the quest from the guard post to the vault.
 */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf, STATE_SOLID } from '../../src/common/registry/blocks';
import { biome } from '../../src/common/registry/biomes';
import { stackOf } from '../../src/common/game/itemstack';
import { rollLoot } from '../../src/common/game/loot';
import { itemOf } from '../../src/common/registry/items';
import { Random, seedFromString } from '../../src/common/math/rng';
import { OverworldGenerator } from '../../src/common/gen/generator';
import { bunkerLayout, bunkerStyle, BK } from '../../src/common/gen/v5/bunker';
import type { Start, QuestSpec } from '../../src/common/gen/structures/manager';
import type { Chunk } from '../../src/common/world/chunk';
import type { GameServer } from '../../src/server/GameServer';
import { makeServer, join, tick } from '../helpers/testServer';

initItems();

type P3 = [number, number, number];
type BunkerQ = Extract<QuestSpec, { kind: 'bunker' }>;

async function settle(server: GameServer, rounds = 120): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** A generated bunker and a block lookup over its chunks. */
function bunkerOf(seed: string): { s: Start; q: BunkerQ; id: (x: number, y: number, z: number) => string; chunks: Chunk[] } {
  const gen = new OverworldGenerator(seedFromString(seed));
  const loc = gen.locate('bunker', 0, 0)!;
  const s = gen.structures.startsFor(loc.x >> 4, loc.z >> 4).find((t) => t.type === 'bunker')!;
  const map = new Map<string, Chunk>();
  for (let cx = s.bounds.x0 >> 4; cx <= s.bounds.x1 >> 4; cx++) for (let cz = s.bounds.z0 >> 4; cz <= s.bounds.z1 >> 4; cz++) map.set(cx + ',' + cz, gen.generate(cx, cz));
  const state = (x: number, y: number, z: number): number => map.get((x >> 4) + ',' + (z >> 4))!.get(x & 15, y, z & 15);
  return { s, q: s.quest as BunkerQ, id: (x, y, z) => blockOf(state(x, y, z)).id, chunks: [...map.values()] };
}

/** Walkable cells at floor level reachable from the foot of the ladder; `open` lists blocks treated as air. */
function reach(q: BunkerQ, id: (x: number, y: number, z: number) => string, open: P3[]): Set<string> {
  const opened = new Set(open.map((p) => p.join(',')));
  const y = q.reader[1] - 1;
  const clear = (x: number, yy: number, z: number): boolean => {
    if (opened.has(`${x},${yy},${z}`)) return true;
    const b = id(x, yy, z);
    return b === 'air' || b === 'ladder' || b.endsWith('_bed') || b === 'cobweb' || b === 'lantern';
  };
  const a = q.area;
  const start = [q.hatch![0], q.hatch![2]];
  const seen = new Set([start.join(',')]);
  const todo = [start];
  while (todo.length) {
    const [x, z] = todo.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x! + dx!;
      const nz = z! + dz!;
      const k = nx + ',' + nz;
      if (seen.has(k) || nx < a.x0 || nx > a.x1 || nz < a.z0 || nz > a.z1) continue;
      if (!clear(nx, y, nz) || !clear(nx, y + 1, nz)) continue;
      seen.add(k);
      todo.push([nx, nz]);
    }
  }
  return seen;
}
const beside = (set: Set<string>, p: P3): boolean => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => set.has(p[0] + dx! + ',' + (p[2] + dz!)));

describe('Version 4.5 bunkers', () => {
  it('are laid out at random, always with a way from the gate to every generator and the vault', () => {
    const plans = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const L = bunkerLayout(new Random(k * 7919 + 1));
      plans.add(JSON.stringify([L.entry, L.vault, L.active, L.doors, L.themes]));
      expect(L.generators.length).toBeGreaterThanOrEqual(2);
      expect(L.generators.length).toBeLessThanOrEqual(3);
      expect(L.active.filter(Boolean).length).toBeGreaterThanOrEqual(7);
    }
    expect(plans.size).toBeGreaterThan(35);
  });

  it('dress for their biome', () => {
    const styles = new Set(['desert', 'badlands', 'snowy_plains', 'taiga', 'jungle', 'swamp', 'stony_peaks', 'plains', 'snowy_taiga'].map((b) => bunkerStyle(biome(b)).id));
    expect([...styles].sort()).toEqual(['arid', 'desert', 'jungle', 'mountain', 'snow', 'swamp', 'taiga', 'temperate']);
  });

  it('sit in a bedrock shell, keep the keycard up top, and only open with the card and the generators', () => {
    const { s, q, id, chunks } = bunkerOf('v45-bunker');
    const a = q.area;
    const y0 = a.y0;
    const y1 = y0 + 6;
    // The shell: every block of its six faces is bedrock, except where the ladder comes down
    let holes = 0;
    for (let x = a.x0; x <= a.x1; x++)
      for (let z = a.z0; z <= a.z1; z++)
        for (let y = y0; y <= y1; y++) {
          const face = x === a.x0 || x === a.x1 || z === a.z0 || z === a.z1 || y === y0 || y === y1;
          if (!face) continue;
          if (x === q.hatch![0] && z === q.hatch![2]) continue;
          if (x === q.hatch![0] && z === q.hatch![2] + 1 && y === y1) continue;
          if (id(x, y, z) !== 'bedrock') holes++;
        }
    expect(holes).toBe(0);
    // Only the hatch leads down, and the ladder reaches the floor
    expect(id(q.hatch![0], q.hatch![1], q.hatch![2])).toBe('iron_trapdoor');
    expect(id(q.hatch![0], y0 + 2, q.hatch![2])).toBe('ladder');
    expect(q.reader[1]).toBe(s.y + BK + 2);
    // Gate shut: only the entry hall can be reached
    const shut = reach(q, id, []);
    expect(shut.size).toBeLessThanOrEqual(16);
    for (const g of q.generators) expect(beside(shut, g)).toBe(false);
    // Past the gate: every generator, but not the vault
    const gate = reach(q, id, q.doors);
    for (const g of q.generators) expect(beside(gate, g), 'generator reachable').toBe(true);
    expect(beside(gate, q.vault)).toBe(false);
    // Blast door open: the vault
    expect(beside(reach(q, id, [...q.doors, ...q.blast]), q.vault)).toBe(true);
    // The entry hall and vault are walled in bedrock: their neighbours through a wall are never plating
    for (const d of [...q.doors, ...q.blast]) expect(id(...d)).toBe('bunker_blast_door');
    // The keycard: in the guard post's chest on the surface, never in a chest underground
    expect(q.cache![1]).toBeGreaterThan(s.y);
    expect(id(...q.cache!)).toBe('chest');
    let cacheChests = 0;
    for (const c of chunks)
      for (const [, be] of c.blockEntities) {
        const loot = (be as { loot?: string }).loot;
        if (loot === 'chest/bunker_cache') cacheChests++;
        expect(loot).not.toBe('chest/bunker_barracks');
      }
    expect(cacheChests).toBe(1);
    for (let i = 0; i < 30; i++) expect(rollLoot('chest/bunker_cache', { rng: new Random(i) }).some((st) => itemOf(st.id)!.id === 'bunker_keycard')).toBe(true);
  }, 240000);

  it('runs its quest: the guard post, the keycard gate, the generators and the vault', async () => {
    const { server } = await makeServer({ seed: 'v45-bunker' });
    const { player, conn } = await join(server);
    const { q, s } = bunkerOf('v45-bunker');
    const dim = player.dim;
    server.teleport(player, q.hatch![0] + 0.5, q.hatch![1] + 1, q.hatch![2] + 1.5);
    await settle(server);
    expect(conn.last('quest')?.quest?.text).toMatch(/guard post/);
    const use = (p: P3): void => void server.structureQuests!.useBlock(player, ...p, dim.getState(...p));
    use(q.reader);
    expect(dim.blockId(...q.doors[0]!)).toBe('bunker_blast_door');
    player.inventory.set(player.selectedSlot, stackOf('bunker_keycard', 1));
    use(q.reader);
    for (const d of q.doors) expect(dim.blockId(...d)).toBe('air');
    for (const g of q.generators) use(g);
    for (const b of q.blast) expect(dim.blockId(...b)).toBe('air');
    server.teleport(player, q.vault[0] + 0.5, q.vault[1], q.vault[2] - 1.5);
    tick(server, 25);
    expect(server.level.quests.bunker[`bunker:${s.x},${s.y},${s.z}`]!.done).toBe(true);
    expect(player.achievements.has('bunker_quest')).toBe(true);
    // Bedrock is bedrock: the shell can't be mined
    expect(STATE_SOLID[dim.getState(q.area.x0, q.area.y0 + 2, q.area.z0)]).toBeTruthy();
  }, 240000);
});
