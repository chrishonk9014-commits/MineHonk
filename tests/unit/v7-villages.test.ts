/**
 * V7 - The Halloween Update, phase 2: Trick-or-Treat Villages, Abandoned
 * Villages, costume heads, zombie villagers and the undead guardians.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, makeServerAt, join, tick, type FakeConn } from '../helpers/testServer';
import { hashChunks } from './v3-regression.test';
import type { GameServer } from '../../src/server/GameServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { HALLOWEEN_ENDS_AT } from '../../src/common/halloween/season';
import { createGenerator, type OverworldGenerator } from '../../src/common/gen/generator';
import type { Start } from '../../src/common/gen/structures/manager';
import { seedFromString, Random } from '../../src/common/math/rng';
import { blocks, STATE_BLOCK, getProp, stateOf, S } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { CRAFTING, SMELTING, STONECUTTING, SMITHING } from '../../src/common/data/recipes';
import { ENG_CRAFTING } from '../../src/common/engineering/catalog';
import { LOOT_TABLES } from '../../src/common/data/loot';
import { rollLoot } from '../../src/common/game/loot';
import { computeBlockDrops } from '../../src/common/game/drops';
import { validateAdmin, describeAdmin, structureName, type VillageDoorsInfo } from '../../src/common/game/admin';
import { villageVariant, dealDoors, type VillageHooks, inGuardArea, sanitizeVillageRecords, ABANDONED_ONE_IN, TRICK_IN, TRICK_OUT_OF, TRICK_HOMES_MIN, TRICK_HOMES_MAX, GUARDIANS_MIN, GUARDIANS_MAX, type GuardArea } from '../../src/common/halloween/villages';
import { COSTUME_HEADS, HEAD_IDS, WEARABLE_BLOCKS } from '../../src/common/halloween/heads';
import { GUARD_LEASH } from '../../src/server/ai/goals';
import { Mob } from '../../src/server/entity/Mob';
import { mobDef } from '../../src/common/data/mobs';
import type { DimensionId } from '../../src/common/data/biomes';
import type { Chunk } from '../../src/common/world/chunk';

const MIN = 60_000;
const BEFORE = HALLOWEEN_ENDS_AT - MIN;
const AFTER = HALLOWEEN_ENDS_AT + MIN;

/**
 * The test world (seed "v7-villages", generator 9) has, near the origin, an
 * ordinary village at (-200, 1208), a Trick-or-Treat eligible one at
 * (552, 1000) and, much further out, an Abandoned Village at (-888, -2392).
 */
const SEED_NAME = 'v7-villages';
const seed = seedFromString(SEED_NAME);

const idOf = (st: number): string => blocks[STATE_BLOCK[st]!]!.id;

function villageChunks(g: OverworldGenerator, s: Start, reverse = false): Chunk[] {
  const b = s.bounds;
  const keys: [number, number][] = [];
  for (let cx = b.x0 >> 4; cx <= b.x1 >> 4; cx++) for (let cz = b.z0 >> 4; cz <= b.z1 >> 4; cz++) keys.push([cx, cz]);
  if (reverse) keys.reverse();
  const out = keys.map(([cx, cz]) => g.generate(cx, cz));
  // Same order for hashing, whichever order they generated in
  return out.sort((a, b2) => a.cx - b2.cx || a.cz - b2.cz);
}

function count(chunks: Chunk[], test: (id: string) => boolean): number {
  let n = 0;
  for (const c of chunks) for (let y = 1; y < 200; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (test(idOf(c.get(x, y, z)))) n++;
  return n;
}

function startAt(g: OverworldGenerator, x: number, z: number): Start {
  const s = g.villageAt(x, z);
  if (!s) throw new Error(`no village at ${x}, ${z}`);
  return s;
}

const v9 = (villages?: VillageHooks): OverworldGenerator => createGenerator('overworld', seed, { version: 9, villages }) as OverworldGenerator;
const v8 = (): OverworldGenerator => createGenerator('overworld', seed, { version: 8 }) as OverworldGenerator;

// ---------------------------------------------------------------------------
describe('generator 9 villages', () => {
  it('normal villages, and Trick-or-Treat villages nobody dressed, are the V4 village block for block', () => {
    const g9 = v9();
    const g8 = v8();
    for (const [x, z, variant] of [
      [-200, 1208, 'normal'],
      [552, 1000, 'trick'],
    ] as const) {
      const s = startAt(g9, x, z);
      expect(s.village!.variant).toBe(variant);
      expect(s.type).toBe('village');
      const old = g8.structures.startsFor(x >> 4, z >> 4).find((t) => t.x === s.x && t.z === s.z)!;
      expect(old, 'the V4 village is in the same place').toBeTruthy();
      expect(s.bounds).toEqual(old.bounds);
      expect(hashChunks(villageChunks(g9, s))).toBe(hashChunks(villageChunks(g8, old)));
    }
  }, 240000);

  it('leaves every other dimension, and the Overworld outside Abandoned Villages, as generator 8 made it', () => {
    for (const dim of ['nether', 'end', 'farlands', 'computer'] as DimensionId[]) {
      const a = createGenerator(dim, seed, { version: 8 });
      const b = createGenerator(dim, seed, { version: 9 });
      const pick = (g: typeof a): Chunk[] => [g.generate(0, 0), g.generate(9, -4), g.generate(-13, 21), g.generate(40, 40)];
      expect(hashChunks(pick(b)), dim).toBe(hashChunks(pick(a)));
    }
    const g9 = v9();
    const g8 = v8();
    const chunks9: Chunk[] = [];
    const chunks8: Chunk[] = [];
    for (let cx = -40; cx <= 40; cx += 10)
      for (let cz = -40; cz <= 40; cz += 10) {
        if (g9.villageAt(cx * 16 + 8, cz * 16 + 8)?.village?.variant === 'abandoned') continue;
        chunks9.push(g9.generate(cx, cz));
        chunks8.push(g8.generate(cx, cz));
      }
    expect(hashChunks(chunks9)).toBe(hashChunks(chunks8));
    // Villages are the only structure type that changed
    expect(g9.structureTypes()).toEqual(expect.arrayContaining(['village', 'trick_village', 'abandoned_village']));
    expect(g8.structureTypes()).not.toContain('trick_village');
    expect(g8.structureTypes()).not.toContain('abandoned_village');
  }, 240000);

  it('dresses a Trick-or-Treat Village only when the server says so, the same in any chunk order', () => {
    const dressed = villageChunks(v9({ trick: () => true }), startAt(v9(), 552, 1000));
    const again = villageChunks(v9({ trick: () => true }), startAt(v9(), 552, 1000), true);
    expect(hashChunks(again)).toBe(hashChunks(dressed));
    const plain = villageChunks(v9({ trick: () => false }), startAt(v9(), 552, 1000));
    const g8 = v8();
    const old = g8.structures.startsFor(552 >> 4, 1000 >> 4).find((t) => t.type === 'village')!;
    expect(hashChunks(plain)).toBe(hashChunks(villageChunks(g8, old)));
    const pumpkins = count(dressed, (id) => id === 'hallow_pumpkin' || id === 'jack_o_lantern' || id === 'carved_pumpkin');
    const lights = count(dressed, (id) => id === 'factory_light_orange' || id === 'factory_light_purple');
    const heads = count(dressed, (id) => HEAD_IDS.includes(id));
    const webs = count(dressed, (id) => id === 'cobweb');
    expect(pumpkins).toBeGreaterThan(15);
    expect(lights).toBeGreaterThan(15);
    expect(heads).toBeGreaterThan(0);
    // Tasteful: a few cobwebs a house, no more
    expect(webs).toBeGreaterThan(3);
    expect(webs).toBeLessThan(60);
    expect(count(plain, (id) => id === 'factory_light_orange' || id === 'factory_light_purple' || id === 'hallow_pumpkin' || HEAD_IDS.includes(id))).toBe(0);
    // Its people are ordinary villagers
    const ents = dressed.flatMap((c) => c.genEntities.map((e) => e.type));
    expect(ents).toContain('villager');
    expect(ents).not.toContain('zombie_villager');
    // Every door it lists is a real door, with room to stand in front
    const g = v9({ trick: () => true });
    const s = startAt(g, 552, 1000);
    const byKey = new Map(dressed.map((c) => [`${c.cx},${c.cz}`, c]));
    const at = (x: number, y: number, z: number): string => idOf(byKey.get(`${x >> 4},${z >> 4}`)!.get(x & 15, y, z & 15));
    for (const d of s.village!.doors) {
      expect(at(d.x, d.y, d.z), `door ${d.id}`).toMatch(/_door$/);
      expect(getProp(byKey.get(`${d.x >> 4},${d.z >> 4}`)!.get(d.x & 15, d.y, d.z & 15), 'half')).toBe('lower');
      expect(at(d.x, d.y + 1, d.z)).toMatch(/_door$/);
      // The knocking spot is the block straight in front of the door, the way it looks out
      const [fx, fz] = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[d.facing];
      expect(d.out).toEqual([d.x + fx, d.y, d.z + fz]);
    }
  }, 240000);

  it('Abandoned Villages: the same plan in ruins, with zombie villagers and undead guardians', () => {
    const g9 = v9();
    const at = g9.locate('abandoned_village', 0, 0)!;
    expect(at).toEqual({ x: -888, y: 73, z: -2392 });
    const s = startAt(g9, at.x, at.z);
    expect(s.type).toBe('abandoned_village');
    expect(g9.structureAt(s.x, s.y + 1, s.z)).toBe('abandoned_village');
    // Where generator 8 has an ordinary village, with the same bounds
    const old = v8().structures.startsFor(s.x >> 4, s.z >> 4).find((t) => t.x === s.x && t.z === s.z)!;
    expect(old.bounds).toEqual(s.bounds);
    const ruin = villageChunks(g9, s);
    const intact = villageChunks(v8(), old);
    const n = (cs: Chunk[], ids: string[]): number => count(cs, (id) => ids.includes(id));
    // Dim: no torches or lanterns left (a few soul lanterns burn), no beds
    expect(n(ruin, ['torch', 'wall_torch', 'lantern'])).toBe(0);
    expect(n(intact, ['lantern'])).toBeGreaterThan(4);
    expect(n(ruin, ['red_bed', 'yellow_bed', 'brown_bed', 'green_bed', 'light_blue_bed', 'lime_bed', 'pink_bed'])).toBe(0);
    // Collapsed: far fewer windows and roof blocks, cobwebs, overgrowth
    expect(n(ruin, ['glass_pane'])).toBeLessThan(n(intact, ['glass_pane']) / 3);
    expect(n(ruin, ['cobweb'])).toBeGreaterThan(20);
    expect(n(ruin, ['vine'])).toBeGreaterThan(n(intact, ['vine']) + 20);
    expect(n(ruin, ['mossy_cobblestone', 'cracked_stone_bricks', 'mossy_stone_bricks'])).toBeGreaterThan(n(intact, ['mossy_cobblestone', 'cracked_stone_bricks', 'mossy_stone_bricks']));
    // Its chests: the abandoned tables, and one treasure
    const loots = ruin.flatMap((c) => [...c.blockEntities.values()].map((e) => (e as { loot?: string }).loot).filter(Boolean)) as string[];
    expect(loots.length).toBeGreaterThan(2);
    for (const l of loots) expect(l).toMatch(/^chest\/abandoned_village/);
    expect(loots.filter((l) => l === 'chest/abandoned_village_treasure')).toHaveLength(1);
    // No villagers, golem, cat or animals: zombie villagers and guardians, all keeping to the village
    const ents = ruin.flatMap((c) => c.genEntities);
    const types = new Set(ents.map((e) => e.type));
    for (const t of ['villager', 'iron_golem', 'cat', 'cow', 'sheep', 'pig', 'chicken']) expect(types.has(t), t).toBe(false);
    const zv = ents.filter((e) => e.type === 'zombie_villager');
    const guards = ents.filter((e) => e.data?.guardian);
    expect(zv.length).toBeGreaterThan(0);
    expect(zv.length).toBeLessThanOrEqual(8);
    expect(guards.length).toBeGreaterThanOrEqual(GUARDIANS_MIN);
    expect(guards.length).toBeLessThanOrEqual(GUARDIANS_MAX);
    for (const e of ents) {
      const a = e.data!.guard as GuardArea;
      expect(a).toEqual({ x0: s.bounds.x0, z0: s.bounds.z0, x1: s.bounds.x1, z1: s.bounds.z1, y: s.y });
      expect(inGuardArea(a, e.x, e.z)).toBe(true);
    }
    // The same in any chunk order
    expect(hashChunks(villageChunks(v9(), s, true))).toBe(hashChunks(ruin));
  }, 240000);

  it(`rarity: one village in ${ABANDONED_ONE_IN} is Abandoned, and ${TRICK_IN} in ${TRICK_OUT_OF} of the rest are Trick-or-Treat eligible`, () => {
    // The variant depends only on the seed and the start chunk: over 400 seeds and 100 villages each
    let n = 0;
    let abandoned = 0;
    let trick = 0;
    for (let s = 0; s < 400; s++)
      for (let i = 0; i < 100; i++) {
        n++;
        const v = villageVariant(s * 7919 + 13, i * 28 + (s % 7), i * 17 - 40 * (s % 5));
        if (v === 'abandoned') abandoned++;
        else if (v === 'trick') trick++;
      }
    expect(abandoned / n).toBeGreaterThan(0.02);
    expect(abandoned / n).toBeLessThan(0.03);
    expect(trick / (n - abandoned)).toBeGreaterThan(0.63);
    expect(trick / (n - abandoned)).toBeLessThan(0.7);
    expect(villageVariant(seed, 34, 62)).toBe(villageVariant(seed, 34, 62));
    // Planned villages over many seeds: the variant never changes whether a village is there
    let planned = 0;
    let ruined = 0;
    for (let k = 0; k < 6; k++) {
      const g = createGenerator('overworld', 5000 + k * 104729, { version: 9 }) as OverworldGenerator;
      const g8k = createGenerator('overworld', 5000 + k * 104729, { version: 8 }) as OverworldGenerator;
      for (let rx = -2; rx <= 2; rx++)
        for (let rz = -2; rz <= 2; rz++) {
          const a = g.structures.regionStart('village', rx, rz);
          const b = g8k.structures.regionStart('village', rx, rz);
          expect(!!a).toBe(!!b);
          if (!a) continue;
          planned++;
          expect(a.bounds).toEqual(b!.bounds);
          if (a.village!.variant === 'abandoned') ruined++;
        }
    }
    expect(planned).toBeGreaterThan(4);
    expect(ruined).toBeLessThanOrEqual(planned);
  }, 240000);

  it('every Trick-or-Treat Village has 2 to 4 Trick Homes, never all of its doors', () => {
    let villages = 0;
    for (let k = 0; k < 10 && villages < 8; k++) {
      const g = createGenerator('overworld', 777 + k * 15485863, { version: 9 }) as OverworldGenerator;
      for (let rx = -2; rx <= 2; rx++)
        for (let rz = -2; rz <= 2; rz++) {
          const s = g.structures.regionStart('village', rx, rz);
          if (s?.village?.variant !== 'trick') continue;
          villages++;
          const doors = s.village.doors;
          const tricks = doors.filter((d) => d.kind === 'trick').length;
          expect(doors.length).toBeGreaterThanOrEqual(3);
          expect(tricks).toBeGreaterThanOrEqual(TRICK_HOMES_MIN);
          expect(tricks).toBeLessThanOrEqual(TRICK_HOMES_MAX);
          expect(tricks).toBeLessThan(doors.length);
          for (const d of doors) expect(['cottage', 'house', 'manor', 'workshop']).toContain(d.design);
        }
    }
    expect(villages).toBeGreaterThanOrEqual(4);
    // Small villages too: three doors give two Trick Homes and a Candy Home
    for (let s = 0; s < 50; s++) {
      const three = dealDoors(s, '3,4', [0, 1, 2].map((id) => ({ id, x: id, y: 64, z: 0, facing: 'north' as const, out: [id, 64, -1] as [number, number, number], design: 'house' })));
      expect(three.filter((d) => d.kind === 'trick')).toHaveLength(2);
    }
  }, 240000);
});

// ---------------------------------------------------------------------------
/** Loads or generates every chunk of an area on a real server. */
async function loadArea(server: GameServer, x0: number, z0: number, x1: number, z1: number): Promise<void> {
  const dim = server.overworld;
  const cx = ((x0 + x1) >> 1) >> 4;
  const cz = ((z0 + z1) >> 1) >> 4;
  const r = Math.max((x1 - x0) >> 4, (z1 - z0) >> 4) / 2 + 2;
  const all = (): boolean => {
    for (let x = x0 >> 4; x <= x1 >> 4; x++) for (let z = z0 >> 4; z <= z1 >> 4; z++) if (!dim.getChunk(x, z)) return false;
    return true;
  };
  for (let i = 0; i < 400 && !all(); i++) {
    dim.want(cx, cz, Math.ceil(r), server.tickNo);
    await new Promise((res) => setTimeout(res, 0));
    dim.processGeneration(5000);
  }
  expect(all()).toBe(true);
}

function countIn(server: GameServer, s: { bounds: { x0: number; z0: number; x1: number; z1: number } }, test: (id: string) => boolean): number {
  let n = 0;
  const dim = server.overworld;
  for (let x = s.bounds.x0; x <= s.bounds.x1; x++) for (let z = s.bounds.z0; z <= s.bounds.z1; z++) for (let y = 40; y < 160; y++) if (test(idOf(dim.getState(x, y, z)))) n++;
  return n;
}

const isLight = (id: string): boolean => id === 'factory_light_orange' || id === 'factory_light_purple';

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: unknown } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}

describe('Trick-or-Treat Villages on a server', () => {
  it('are dressed when first built in the season, recorded with every door, and stay dressed after it (even chunks built later)', async () => {
    const storage = new MemoryStorage();
    let now = BEFORE;
    const first = await makeServer({ seed: SEED_NAME }, storage, { clock: () => now });
    const g = first.server.overworld.generator as OverworldGenerator;
    const s = startAt(g, 552, 1000);
    // Half the village during the season...
    const mid = (s.bounds.x0 + s.bounds.x1) >> 1;
    await loadArea(first.server, s.bounds.x0, s.bounds.z0, mid, s.bounds.z1);
    const rec = first.server.villages!.record(s.village!.key)!;
    expect(rec).toMatchObject({ kind: 'trick', x: s.x, z: s.z, decidedAt: BEFORE });
    expect(rec.doors).toHaveLength(s.village!.doors.length);
    for (const d of rec.doors) {
      expect(d.used).toBe(false);
      expect(['candy', 'trick']).toContain(d.kind);
      expect(typeof d.seed).toBe('number');
    }
    await first.server.saveAll();
    expect(storage.level).toHaveProperty(['villages', s.village!.key, 'kind'], 'trick');
    await first.server.stop();
    // ...the rest after the cutoff: it is still one village, dressed all through
    now = AFTER;
    const { server } = await makeServer({}, storage, { clock: () => now });
    expect(server.halloweenState().active).toBe(false);
    expect(server.villages!.record(s.village!.key)).toEqual(rec);
    await loadArea(server, s.bounds.x0, s.bounds.z0, s.bounds.x1, s.bounds.z1);
    const full = countIn(server, s, isLight);
    const offline = villageChunks(v9({ trick: () => true }), s);
    expect(full).toBe(count(offline, isLight));
    // A village first built after the cutoff is an ordinary one, and stays so
    const other = await makeServer({ seed: SEED_NAME }, new MemoryStorage(), { clock: () => AFTER });
    await loadArea(other.server, s.bounds.x0, s.bounds.z0, s.bounds.x1, s.bounds.z1);
    expect(other.server.villages!.record(s.village!.key)).toMatchObject({ kind: 'normal', doors: [] });
    expect(countIn(other.server, s, isLight)).toBe(0);
  }, 480000);

  it('records survive saving and reading back, and bad records are dropped', () => {
    const recs = sanitizeVillageRecords({
      '34,62': { kind: 'trick', decidedAt: 5, x: 1, y: 70, z: 2, style: 'plains', doors: [{ id: 0, x: 1, y: 71, z: 3, facing: 'east', out: [2, 71, 3], design: 'house', kind: 'trick', seed: 99, used: true }, { id: 'x' }] },
      bad: { kind: 'haunted', x: 1, y: 2, z: 3 },
      'admin@5,5': { kind: 'abandoned', x: 5, y: 64, z: 5, area: { x0: 0, z0: 0, x1: 10, z1: 10, y: 64 }, cheat: true },
    });
    expect(Object.keys(recs).sort()).toEqual(['34,62', 'admin@5,5']);
    expect(recs['34,62']!.doors).toEqual([{ id: 0, x: 1, y: 71, z: 3, facing: 'east', out: [2, 71, 3], design: 'house', kind: 'trick', seed: 99, used: true }]);
    expect(recs['admin@5,5']).toMatchObject({ kind: 'abandoned', cheat: true, area: { x0: 0, x1: 10 } });
  });

  it('every player in a world sees the same village, and only real discovery counts', async () => {
    const { server } = await makeServer({ seed: SEED_NAME }, new MemoryStorage(), { clock: () => BEFORE });
    const g = server.overworld.generator as OverworldGenerator;
    const s = startAt(g, 552, 1000);
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    for (const p of [a.player, b.player]) server.teleport(p, s.x + 0.5, s.y + 2, s.z + 0.5);
    await loadArea(server, s.x - 24, s.z - 24, s.x + 24, s.z + 24);
    tick(server, 45);
    for (const { conn, player } of [a, b]) {
      expect(conn.of('title').map((t) => t.text)).toContain('Trick-or-Treat Village');
      expect(player.achievements.has('find_trick_village')).toBe(true);
    }
    // The same blocks for both: the server's
    expect(countIn(server, s, isLight)).toBeGreaterThan(10);
  }, 480000);
});

describe('Abandoned Villages on a server', () => {
  it('haunt the players near them (ghosts day and night), and finding one is an advancement', async () => {
    const { server } = await makeServer({ seed: SEED_NAME }, new MemoryStorage(), { clock: () => AFTER });
    const g = server.overworld.generator as OverworldGenerator;
    const s = startAt(g, -888, -2392);
    const { conn, player } = await join(server, 'Ann', 'uuid-ann');
    server.level.dayTime = 6000;
    server.teleport(player, s.x + 0.5, s.y + 2, s.z + 0.5);
    await loadArea(server, s.x - 20, s.z - 20, s.x + 20, s.z + 20);
    tick(server, 45);
    expect(conn.last('haunted_area')!.area).toEqual(s.village!.guard);
    expect(conn.of('title').map((t) => t.text)).toContain('Abandoned Village');
    expect(player.achievements.has('find_abandoned_village')).toBe(true);
    // Leaving: the ghosts stop
    server.teleport(player, s.bounds.x1 + 200, 120, s.z);
    tick(server, 25);
    expect(conn.last('haunted_area')!.area).toBeNull();
  }, 480000);
});

// ---------------------------------------------------------------------------
describe('undead guardians', () => {
  /** A flat, open test field round the spawn, and its guard area. */
  async function field(): Promise<{ server: GameServer; conn: FakeConn; player: Awaited<ReturnType<typeof join>>['player']; area: GuardArea; y: number }> {
    const { server } = await makeServer({ seed: 'v7-guards', difficulty: 'normal' }, new MemoryStorage(), { clock: () => AFTER });
    const { conn, player } = await join(server, 'Ann', 'uuid-ann', 6);
    const dim = server.overworld;
    const x0 = Math.floor(player.x) - 30;
    const z0 = Math.floor(player.z) - 30;
    await loadArea(server, x0 - 40, z0 - 40, x0 + 100, z0 + 100);
    const y = 120;
    // A grass floor at y 119 over the whole field, open sky above
    for (let x = x0 - 30; x <= x0 + 90; x++)
      for (let z = z0 - 30; z <= z0 + 90; z++) {
        dim.setBlock(x, y - 1, z, S('grass_block'));
        for (let yy = y; yy < y + 12; yy++) if (dim.getState(x, yy, z)) dim.setBlock(x, yy, z, 0);
      }
    const area: GuardArea = { x0, z0, x1: x0 + 24, z1: z0 + 24, y };
    server.level.dayTime = 6000;
    server.level.raining = false;
    return { server, conn, player, area, y };
  }

  it('never burn in daylight; other undead do', async () => {
    const { server, player, area, y } = await field();
    server.teleport(player, area.x0 + 12, y, area.z0 - 3);
    const guard = server.mobs!.spawn(server.overworld, 'zombie', area.x0 + 6, y, area.z0 + 6, { data: { guard: area, guardian: true }, persistent: true })!;
    const zv = server.mobs!.spawn(server.overworld, 'zombie_villager', area.x0 + 8, y, area.z0 + 8, { data: { guard: area, profession: 'farmer' }, persistent: true })!;
    const plain = server.mobs!.spawn(server.overworld, 'zombie', area.x0 + 18, y, area.z0 + 18, { persistent: true })!;
    player.gamemode = 'creative';
    tick(server, 400);
    expect(guard.dead).toBe(false);
    expect(guard.fireTicks).toBe(0);
    expect(guard.health).toBe(guard.maxHealth);
    expect(zv.fireTicks).toBe(0);
    expect(zv.data.profession).toBe('farmer');
    expect(plain.fireTicks > 0 || plain.health < plain.maxHealth || plain.dead).toBe(true);
    expect(mobDef('zombie_villager')).toMatchObject({ undead: true, brain: 'zombie', burnsInDay: true });
  }, 480000);

  it('stay in their village over a long run: no wandering off, no chasing far out, no leaving through chunk unloads', async () => {
    const { server, player, area, y } = await field();
    const dim = server.overworld;
    const guards: Mob[] = [];
    for (let i = 0; i < 6; i++) guards.push(server.mobs!.spawn(dim, i % 2 ? 'skeleton' : 'zombie', area.x0 + 4 + i * 3, y, area.z0 + 4 + ((i * 7) % 16), { data: { guard: area, guardian: true }, persistent: true })!);
    // Bait: a player just outside, then far outside, then back in and out again
    player.gamemode = 'survival';
    player.health = 1e9;
    const furthest = new Map<Mob, number>();
    const outBy = (m: Mob): number => Math.max(area.x0 - m.x, m.x - (area.x1 + 1), area.z0 - m.z, m.z - (area.z1 + 1), 0);
    const watch = (): void => {
      for (const m of guards) if (!m.dead && m.dim === dim) furthest.set(m, Math.max(furthest.get(m) ?? 0, outBy(m)));
    };
    const spots: [number, number][] = [
      [area.x1 + 4, area.z0 + 12],
      [area.x0 + 12, area.z1 + 14],
      [area.x0 + 12, area.z0 + 12],
      [area.x0 - 9, area.z0 + 3],
    ];
    for (let round = 0; round < 3; round++)
      for (const [px, pz] of spots) {
        server.teleport(player, px + 0.5, y, pz + 0.5);
        for (let t = 0; t < 300; t++) {
          tick(server, 1);
          player.health = player.maxHealth;
          watch();
        }
      }
    for (const m of guards) {
      expect(m.dead).toBe(false);
      expect(furthest.get(m)!, `${m.type} strayed`).toBeLessThanOrEqual(GUARD_LEASH + 1.5);
    }
    // The player leaves: the chunks unload with the guardians in them, then load again
    server.teleport(player, area.x0 + 2000, 140, area.z0 + 2000);
    for (let i = 0; i < 40; i++) {
      tick(server, 10);
      await new Promise((r) => setTimeout(r, 0));
    }
    await dim.unloadUnused(server.tickNo + 100000, 1);
    expect(guards.every((m) => !dim.entities.has(m.id))).toBe(true);
    server.teleport(player, area.x0 + 12, y, area.z0 - 4);
    await loadArea(server, area.x0 - 8, area.z0 - 8, area.x1 + 8, area.z1 + 8);
    tick(server, 600);
    const back = [...dim.entities.values()].filter((e) => e instanceof Mob && (e as Mob).data.guardian) as Mob[];
    expect(back).toHaveLength(6);
    for (const m of back) {
      expect(m.persistenceRequired).toBe(true);
      expect(outBy(m)).toBeLessThanOrEqual(GUARD_LEASH + 1.5);
    }
    // And after a while with nobody to chase, all of them are inside
    server.teleport(player, area.x0 + 12, y + 30, area.z0 + 12);
    player.gamemode = 'creative';
    tick(server, 900);
    for (const m of back) expect(inGuardArea(area, m.x, m.z, 1), `${m.type} at ${m.x}, ${m.z}`).toBe(true);
  }, 600000);
});

// ---------------------------------------------------------------------------
describe('costume heads', () => {
  it('four heads, none of them craftable', () => {
    expect(COSTUME_HEADS.map((h) => h.id)).toEqual(['skeleton_skull', 'zombie_head', 'creeper_head', 'herobrine_head']);
    const all = JSON.stringify([CRAFTING, SMELTING, STONECUTTING, SMITHING, ENG_CRAFTING]);
    for (const id of HEAD_IDS) {
      expect(itemById.has(id), id).toBe(true);
      expect(all.includes(`"${id}"`), `${id} has a recipe`).toBe(false);
    }
    expect(WEARABLE_BLOCKS).toContain('carved_pumpkin');
  });

  it('each is placed facing you, drops itself and has a small box', () => {
    for (const id of HEAD_IDS) {
      const st = stateOf(id, { facing: 'east' });
      expect(getProp(st, 'facing')).toBe('east');
      const drops = computeBlockDrops(st, null, new Random(1));
      expect(drops.items.map((s) => items[s.id]!.id)).toEqual([id]);
    }
  });

  it('are worn on the head (and so is a carved pumpkin), for every player to see', async () => {
    const { server } = await makeServer({ seed: 'v7-heads', mode: 'creative' }, new MemoryStorage(), { clock: () => BEFORE });
    const { player } = await join(server, 'Ann', 'uuid-ann');
    for (const id of [...HEAD_IDS, 'carved_pumpkin']) {
      player.inventory.set(39, null);
      player.selectedSlot = 0;
      player.inventory.set(0, { id: itemById.get(id)!.num, count: 1 });
      server.interaction.handleUse(player, { t: 'use', hand: 0, action: 'start' });
      expect(items[player.inventory.get(39)!.id]!.id, id).toBe(id);
      expect(player.meta().headwear).toBe(id);
    }
  });

  it('fool their own kind: a zombie notices someone in a zombie head from half as far', async () => {
    const { server } = await makeServer({ seed: 'v7-heads' }, new MemoryStorage(), { clock: () => AFTER });
    const { player } = await join(server, 'Ann', 'uuid-ann');
    const { nearestPlayerTarget } = await import('../../src/server/ai/goals');
    const z = server.mobs!.spawn(server.overworld, 'zombie', player.x + 20, player.y, player.z)!;
    const pick = nearestPlayerTarget(32);
    expect(pick(z)).toBe(player);
    player.inventory.set(39, { id: itemById.get('zombie_head')!.num, count: 1 });
    expect(pick(z)).toBeNull();
    player.inventory.set(39, { id: itemById.get('creeper_head')!.num, count: 1 });
    expect(pick(z)).toBe(player);
  });
});

// ---------------------------------------------------------------------------
describe('Abandoned Village loot', () => {
  const value: Record<string, number> = { diamond: 8, emerald: 2, emerald_block: 18, gold_ingot: 2, iron_ingot: 1, golden_apple: 8, enchanted_golden_apple: 60, totem_of_undying: 40, experience_bottle: 1, enchanted_book: 6, ender_pearl: 2 };
  const worth = (table: string, n = 400): number => {
    const rng = new Random(42);
    let v = 0;
    for (let i = 0; i < n; i++) for (const s of rollLoot(table, { rng })) v += (value[items[s.id]!.id] ?? 0.2) * s.count + (s.tag?.ench ? 6 : 0);
    return v / n;
  };

  it('only real items, and better than a village, the treasure best of all', () => {
    for (const t of ['chest/abandoned_village', 'chest/abandoned_village_smithy', 'chest/abandoned_village_treasure']) {
      expect(LOOT_TABLES[t], t).toBeTruthy();
      for (const p of LOOT_TABLES[t]!.pools) for (const e of p.entries) if ('item' in e && e.item) expect(itemById.has(e.item), `${t}: ${e.item}`).toBe(true);
    }
    const village = worth('chest/village');
    const house = worth('chest/abandoned_village');
    const smithy = worth('chest/abandoned_village_smithy');
    const treasure = worth('chest/abandoned_village_treasure');
    expect(house).toBeGreaterThan(village * 2);
    expect(smithy).toBeGreaterThan(worth('chest/village_smithy'));
    expect(treasure).toBeGreaterThan(house * 2);
    // Balanced: a house chest is no treasure trove
    expect(house).toBeLessThan(80);
    // The treasure always holds something precious
    const rng = new Random(7);
    for (let i = 0; i < 100; i++) {
      const got = rollLoot('chest/abandoned_village_treasure', { rng }).map((s) => items[s.id]!.id);
      expect(got.some((id) => ['diamond', 'emerald_block', 'diamond_chestplate', 'diamond_sword', 'enchanted_golden_apple', 'totem_of_undying'].includes(id))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the Admin Panel's villages", () => {
  it('validates its requests', () => {
    expect(validateAdmin({ a: 'halloween', op: 'spawn_trick_village' })).toEqual({ a: 'halloween', op: 'spawn_trick_village' });
    expect(validateAdmin({ a: 'halloween', op: 'spawn_abandoned_village' })).toEqual({ a: 'halloween', op: 'spawn_abandoned_village' });
    expect(validateAdmin({ a: 'halloween', op: 'door_tp', door: 3 })).toEqual({ a: 'halloween', op: 'door_tp', door: 3 });
    expect(validateAdmin({ a: 'halloween', op: 'door_tp', door: -1 })).toBeNull();
    expect(describeAdmin({ a: 'halloween', op: 'spawn_abandoned_village' })).toMatch(/Abandoned Village/);
    expect(describeAdmin({ a: 'halloween', op: 'village_doors' })).toBeNull();
    expect(structureName('trick_village')).toBe('Trick-or-Treat Village');
    expect(structureName('abandoned_village')).toBe('Abandoned Village');
  });

  it('builds either village around you in any world (cheat-made), and lists the doors', async () => {
    // A world from before V7 (generator 8), after the season
    const { server } = await makeServerAt(8, { seed: 'v7-admin-villages', cheats: true });
    (server as unknown as { clock: () => number }).clock = () => AFTER;
    const { conn, player } = await join(server, 'Op', 'uuid-op', 6);
    let r = admin(server, conn, { a: 'halloween', op: 'spawn_trick_village' });
    expect(r.ok, r.text).toBe(true);
    for (let i = 0; i < 300 && server.villages!.pendingBuilds > 0; i++) {
      tick(server, 1);
      await new Promise((res) => setTimeout(res, 0));
    }
    expect(server.villages!.pendingBuilds).toBe(0);
    r = admin(server, conn, { a: 'halloween', op: 'village_doors' });
    expect(r.ok, r.text).toBe(true);
    const info = (r.data as { doors: VillageDoorsInfo }).doors;
    expect(info.cheat).toBe(true);
    const tricks = info.doors.filter((d) => d.kind === 'trick').length;
    expect(tricks).toBeGreaterThanOrEqual(2);
    expect(tricks).toBeLessThanOrEqual(4);
    // Its blocks are cheat-made, and so are its villagers
    const d0 = info.doors[0]!;
    expect(idOf(player.dim.getState(d0.x, d0.y, d0.z))).toMatch(/_door$/);
    expect(server.admin.blockMarked(player.dim, d0.x, d0.y, d0.z)).toBe(true);
    const villagers = [...player.dim.entities.values()].filter((e) => e instanceof Mob && e.type === 'villager') as Mob[];
    expect(villagers.length).toBeGreaterThan(0);
    for (const m of villagers) expect(m.admin).toBe(true);
    // Walking in counts for nothing
    tick(server, 45);
    expect(player.achievements.has('find_trick_village')).toBe(false);
    // To a door
    r = admin(server, conn, { a: 'halloween', op: 'door_tp', door: d0.id });
    expect(r.ok, r.text).toBe(true);
    expect(Math.floor(player.x)).toBe(d0.out[0]);
    expect(Math.floor(player.z)).toBe(d0.out[2]);
    // An Abandoned Village somewhere else: haunted, its undead cheat-made
    server.teleport(player, 300.5, 100, 300.5);
    await loadArea(server, Math.floor(player.x) - 40, Math.floor(player.z) - 40, Math.floor(player.x) + 40, Math.floor(player.z) + 40);
    r = admin(server, conn, { a: 'halloween', op: 'spawn_abandoned_village' });
    expect(r.ok, r.text).toBe(true);
    for (let i = 0; i < 300 && server.villages!.pendingBuilds > 0; i++) {
      tick(server, 1);
      await new Promise((res) => setTimeout(res, 0));
    }
    tick(server, 25);
    expect(conn.last('haunted_area')?.area).toBeTruthy();
    const undead = [...player.dim.entities.values()].filter((e) => e instanceof Mob && (e as Mob).data.guard) as Mob[];
    expect(undead.length).toBeGreaterThan(0);
    for (const m of undead) expect(m.admin).toBe(true);
    expect(player.achievements.has('find_abandoned_village')).toBe(false);
  }, 600000);
});
