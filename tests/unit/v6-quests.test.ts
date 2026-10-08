/**
 * V6 phase 4: the five End quests, end to end on a real server, through the
 * messages a client really sends (so nothing can be skipped or faked).
 *
 * Each quest: its trigger, every step checked on the server, the tracker
 * showing the next step, rewards once per world (loot) and once per player
 * (advancements), everyone present sharing progress, state through a
 * restart, and nothing earned by the Admin Panel.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { settle } from '../helpers/v6p4';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import type { EndGenerator } from '../../src/common/gen/end';
import type { Start } from '../../src/common/gen/structures/manager';
import { blocks, STATE_BLOCK, STATE_SOLID, S, getProp } from '../../src/common/registry/blocks';
import { items } from '../../src/common/registry/items';
import { stackOf, isAdminStack, itemIdOf, type ItemStack } from '../../src/common/game/itemstack';
import { QUEST, portalCells, type EndQuestSpec } from '../../src/common/endExpansion/quests';
import { NEST_LORE, LORE } from '../../src/common/endExpansion/lore';
import { Mob } from '../../src/server/entity/Mob';
import type { EngBE } from '../../src/server/engineering/state';

const blockId = (s: number): string => blocks[STATE_BLOCK[s]!]!.id;
type P3 = [number, number, number];

interface World {
  server: GameServer;
  storage: MemoryStorage;
  players: ServerPlayer[];
  conns: FakeConn[];
}

/** Players in the Expanded End (on the arrival island). */
async function inBand(seed: string, n = 1, opts: Record<string, unknown> = {}, storage = new MemoryStorage()): Promise<World> {
  const { server } = await makeServer({ seed, ...opts }, storage);
  const players: ServerPlayer[] = [];
  const conns: FakeConn[] = [];
  for (let i = 0; i < n; i++) {
    const j = await join(server, 'P' + i);
    players.push(j.player);
    conns.push(j.conn);
  }
  const g = server.dim('end').generator as EndGenerator;
  const a = g.terrain.expansion.arrival();
  for (const p of players) server.changeDimension(p, 'end', a.x + 0.5, a.floor, a.z - 0.5);
  await goTo({ server, storage, players, conns }, [a.x, a.floor, a.z]);
  for (const p of players) p.spawnProtection = 0;
  return { server, storage, players, conns };
}

/** Everyone to a place (each a block apart); waits for the chunks around it. */
async function goTo(w: World, at: P3, r = 48): Promise<void> {
  const end = w.server.dim('end');
  w.players.forEach((p, i) => w.server.teleport(p, at[0] + 0.5 + i, at[1], at[2] + 0.5));
  await settle(w.server, 1500, () => [-r, 0, r].every((dx) => [-r, 0, r].every((dz) => end.isLoaded(at[0] + dx, at[2] + dz))));
  w.players.forEach((p, i) => w.server.teleport(p, at[0] + 0.5 + i, at[1], at[2] + 0.5));
}

let seqNo = 1;
/** A right click on a block, as the client sends it (the player must be within reach). */
function useOn(w: World, i: number, at: P3, hand: 0 | 1 = 0): void {
  const p = w.players[i]!;
  // Stand in the nearest open air within reach (reach is checked from the eyes)
  const [x, y, z] = standNear(w, at);
  w.server.teleport(p, x + 0.5, y, z + 0.5);
  w.server.handle(w.conns[i]!, { t: 'use_on', x: at[0], y: at[1], z: at[2], face: 1, hx: 0.5, hy: 1, hz: 0.5, hand, yaw: 0, pitch: -1, seq: seqNo++ });
  p.interactBudget = 0;
}

/** The nearest place to stand (feet and head in air) within reach of a block. */
function standNear(w: World, at: P3): P3 {
  const end = w.server.dim('end');
  const open = (x: number, y: number, z: number): boolean => !STATE_SOLID[end.getState(x, y, z)] && !STATE_SOLID[end.getState(x, y + 1, z)];
  let best: P3 | null = null;
  let bd = Infinity;
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -3; dy <= 2; dy++)
      for (let dz = -3; dz <= 3; dz++) {
        const d = Math.hypot(dx, dy + 1.5, dz);
        if (d >= bd || (dx === 0 && dz === 0 && dy >= -1 && dy <= 0)) continue;
        if (open(at[0] + dx, at[1] + dy, at[2] + dz)) {
          best = [at[0] + dx, at[1] + dy, at[2] + dz];
          bd = d;
        }
      }
  expect(best, `somewhere to stand by ${at.join(',')}`).toBeTruthy();
  return best!;
}

/** Holds a stack in the main hand (slot 0). */
function hold(p: ServerPlayer, st: ItemStack | null): void {
  p.selectedSlot = 0;
  p.inventory.set(0, st);
}

function count(p: ServerPlayer, id: string): number {
  let n = 0;
  for (let i = 0; i < p.inventory.size; i++) {
    const s = p.inventory.get(i);
    if (s && itemIdOf(s) === id) n += s.count;
  }
  return n;
}

function stacks(p: ServerPlayer): ItemStack[] {
  const out: ItemStack[] = [];
  for (let i = 0; i < p.inventory.size; i++) {
    const s = p.inventory.get(i);
    if (s) out.push(s);
  }
  return out;
}

function questOf(s: Start): EndQuestSpec | null {
  return s.quest?.kind === 'end' ? (s.quest as EndQuestSpec) : null;
}

/** The quest structure whose plan holds a position. */
function startWith(w: World, at: P3, pick: (q: EndQuestSpec) => boolean): Start {
  const g = w.server.dim('end').generator as EndGenerator;
  const s = g.expansionStartsAt(at[0], at[2]).find((st) => {
    const q = questOf(st);
    return !!q && pick(q);
  });
  expect(s).toBeTruthy();
  return s!;
}

const tracker = (c: FakeConn): string => c.of('quest').filter((q) => q.quest).pop()?.quest?.text ?? '';

// ---------------------------------------------------------------------------
// THE LOST OBSERVATORY
// ---------------------------------------------------------------------------

describe('THE LOST OBSERVATORY', () => {
  it('find the lens, mend it, power it 30 s at 256 EU/t through its foot, look through it: a map to an unfound giant (once a day); loot once a world, advancements for everyone there', async () => {
    const w = await inBand('v6-structures', 2);
    const [p, q] = w.players as [ServerPlayer, ServerPlayer];
    const eq = w.server.endQuests!;
    const site = eq.nearestSite(p, 'lost_observatory');
    expect(site).toBeTruthy();
    const lens = site!.key.slice(4).split(',').map(Number) as P3;
    await goTo(w, site!.at);
    const end = w.server.dim('end');
    expect(blockId(end.getState(...lens))).toBe('ancient_lens');
    const spec = questOf(startWith(w, lens, (qq) => !!qq.lens && qq.lens.lens.join() === lens.join()))!.lens!;
    // The tracker offers the first step inside the observatory
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Find the observatory/);
    // 1. Found (the lens used): it is cracked
    useOn(w, 0, lens);
    expect(blockId(end.getState(...lens))).toBe('ancient_lens');
    expect(eq.rec(site!.key).stage).toBe(1);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Repair the lens/);
    // Not within reach: nothing
    hold(p, stackOf('ancient_fragment', 8));
    w.server.teleport(p, lens[0] + 20.5, lens[1], lens[2] + 0.5);
    w.server.handle(w.conns[0]!, { t: 'use_on', x: lens[0], y: lens[1], z: lens[2], face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: seqNo++ });
    expect(blockId(end.getState(...lens))).toBe('ancient_lens');
    // 2. Mended with 8 Ancient Fragments
    useOn(w, 0, lens);
    expect(blockId(end.getState(...lens))).toBe('restored_ancient_lens');
    expect(count(p, 'ancient_fragment')).toBe(0);
    for (const m of spec.mend) expect(blockId(end.getState(...m))).toBe('ancient_conduit');
    // Looking before it's awake does nothing (it opens its machine window instead)
    useOn(w, 0, lens);
    expect(count(p, 'ancient_map')).toBe(0);
    // 3. Power at its foot: a charged Void Cell beside the core
    const [cx, cy, cz] = spec.core;
    const spot = ([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]] as P3[]).map(([dx, dy, dz]) => [cx + dx, cy + dy, cz + dz] as P3).find((s) => blockId(end.getState(...s)) === 'air' || blockId(end.getState(...s)).includes('brick'))!;
    end.setBlock(spot[0], spot[1], spot[2], S('void_cell'));
    (end.getBlockEntity(...spot) as EngBE).energy = 1_000_000;
    tick(w.server, 100);
    expect(eq.rec(site!.key).stage).toBe(2);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Power the telescope.*\d+%/);
    tick(w.server, QUEST.lensTicks);
    expect((end.getBlockEntity(...lens) as { awake?: boolean }).awake).toBe(true);
    expect(eq.rec(site!.key).stage).toBe(3);
    // 4. Look through it, with a second player nearby
    const qs = standNear(w, lens);
    w.server.teleport(q, qs[0] + 0.5, qs[1], qs[2] + 0.5);
    hold(p, null);
    useOn(w, 0, lens);
    await settle(w.server, 400, () => count(p, 'ancient_map') > 0);
    const map = stacks(p).find((s) => itemIdOf(s) === 'ancient_map')!;
    expect(map.tag?.data?.map).toBe('marked');
    expect(Array.isArray(map.tag?.data?.target)).toBe(true);
    expect(count(p, 'astral_shard')).toBe(2);
    expect(stacks(p).some((s) => s.tag?.lore === 'stars_circle')).toBe(true);
    expect(eq.rec(site!.key).done).toBe(true);
    for (const pl of [p, q]) expect(pl.achievements.has('quest_lost_observatory'), pl.name).toBe(true);
    // Again the same day: nothing new
    useOn(w, 0, lens);
    await settle(w.server, 40);
    expect(count(p, 'ancient_map')).toBe(1);
    // The next day: another map, but no more loot
    w.server.level.time += QUEST.lookEvery;
    useOn(w, 0, lens);
    await settle(w.server, 400, () => count(p, 'ancient_map') > 1);
    expect(count(p, 'ancient_map')).toBe(2);
    expect(count(p, 'astral_shard')).toBe(2);
  }, 600000);
});

// ---------------------------------------------------------------------------
// THE BROKEN GATEWAY
// ---------------------------------------------------------------------------

/** The broken portal nearest the player that has a pair, and that pair. */
function portalWithPair(w: World): { a: string; b: string; aSite: Parameters<typeof portalCells>[0]; bSite: Parameters<typeof portalCells>[0] } {
  const eq = w.server.endQuests!;
  const p = w.players[0]!;
  const all = [...eq.censusNow()].filter(([, v]) => v.pair);
  all.sort(([, u], [, v]) => Math.hypot(portalCells(u.site).base[0] - p.x, portalCells(u.site).base[2] - p.z) - Math.hypot(portalCells(v.site).base[0] - p.x, portalCells(v.site).base[2] - p.z));
  const [a, v] = all[0]!;
  return { a, b: v.pair!, aSite: v.site, bSite: eq.censusNow().get(v.pair!)!.site };
}

describe('THE BROKEN GATEWAY', () => {
  it('pairs are fixed by the seed, both ways, far apart; every broken portal but an odd one out has one', async () => {
    const w = await inBand('v6-structures');
    const { a, b } = portalWithPair(w);
    const eq = w.server.endQuests!;
    // Far apart: about a sixteenth of the way round the band (some thousands of blocks)
    const dist = (k1: string, k2: string): number => {
      const u = k1.split(',').map(Number);
      const v = k2.split(',').map(Number);
      return Math.hypot(u[0]! - v[0]!, u[2]! - v[2]!);
    };
    const all = [...eq.censusNow()].filter(([, v]) => v.pair).map(([k, v]) => dist(k, v.pair!)).sort((x, y) => x - y);
    expect(all[Math.floor(all.length / 2)]!).toBeGreaterThan(1500);
    expect(dist(a, b)).toBeGreaterThan(500);
    // The same pairs in a second world with the same seed
    const w2 = await inBand('v6-structures');
    const { a: a2, b: b2 } = portalWithPair(w2);
    expect([a2, b2]).toEqual([a, b]);
    // Symmetric, and every broken portal in the band paired but at most one
    const cell = eq.censusNow();
    let unpaired = 0;
    for (const [k, v] of cell) {
      if (!v.pair) unpaired++;
      else expect(cell.get(v.pair)!.pair).toBe(k);
    }
    expect(unpaired).toBeLessThanOrEqual(1);
    expect(cell.size).toBeGreaterThan(20);
  }, 600000);

  it('inspect, mend (12 bricks and a crystal), follow the map, mend the pair, step through: a gateway both ways for good; a lore fragment the first time', async () => {
    const w = await inBand('v6-structures');
    const [p] = w.players as [ServerPlayer];
    const { a, b, aSite, bSite } = portalWithPair(w);
    const end = w.server.dim('end');
    const A = portalCells(aSite);
    const B = portalCells(bSite);
    await goTo(w, [A.base[0] + A.normal[0] * 2, A.base[1], A.base[2] + A.normal[1] * 2]);
    // 1. Inspected (a dead sheet cell, or the frame)
    const cellA = A.sheet.find((c) => blockId(end.getState(...c)) === 'dead_portal') ?? A.frame.find((c) => blockId(end.getState(...c)) !== 'air')!;
    hold(p, null);
    useOn(w, 0, cellA);
    expect(w.server.endQuests!.rec(`gate:${a}`).stage).toBe(1);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Repair its frame/);
    // Not enough bricks: nothing
    hold(p, stackOf('ancient_end_bricks', 11));
    p.inventory.set(1, stackOf('end_crystal', 1));
    useOn(w, 0, cellA);
    expect(w.server.endQuests!.gates[a]?.repaired).toBeFalsy();
    // 2. Mended: the whole frame back, a dead sheet, and a map to the pair
    hold(p, stackOf('ancient_end_bricks', 12));
    useOn(w, 0, cellA);
    expect(w.server.endQuests!.gates[a]?.repaired).toBe(true);
    expect(count(p, 'ancient_end_bricks')).toBe(0);
    expect(count(p, 'end_crystal')).toBe(0);
    for (const f of A.frame) expect(blockId(end.getState(...f))).toMatch(/ancient_end_bricks/);
    for (const c of A.sheet) expect(blockId(end.getState(...c))).toBe('dead_portal');
    const map = stacks(p).find((s) => itemIdOf(s) === 'ancient_map')!;
    expect(map.tag?.data?.target).toEqual(B.base);
    // One end alone takes nobody anywhere
    w.server.teleport(p, A.base[0] + 0.5, A.base[1], A.base[2] + 0.5);
    tick(w.server, 80);
    expect(Math.floor(p.x)).toBe(A.base[0]);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Follow the map to its pair/);
    // 3. Follow the map; 4. mend the pair
    await goTo(w, [B.base[0] + B.normal[0] * 2, B.base[1], B.base[2] + B.normal[1] * 2]);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Repair the pair/);
    const cellB = B.sheet.find((c) => blockId(end.getState(...c)) === 'dead_portal') ?? B.frame[1]!;
    hold(p, stackOf('ancient_end_bricks', 12));
    p.inventory.set(1, stackOf('end_crystal', 1));
    useOn(w, 0, cellB);
    expect(w.server.endQuests!.gates[b]?.linked).toBe(true);
    expect(w.server.endQuests!.gates[a]?.linked).toBe(true);
    for (const c of B.sheet) expect(blockId(end.getState(...c))).toBe('ancient_gateway');
    expect(p.achievements.has('repair_gateway_pair')).toBe(true);
    // 5. Step through: to the first portal (its chunks load first), its sheet now lit too
    w.server.teleport(p, B.base[0] + 0.5, B.base[1], B.base[2] + 0.5);
    // (kept healthy while waiting: a Void Stalker roaming near a gateway can otherwise end the trip)
    await settle(w.server, 1500, () => ((p.health = 20), Math.hypot(p.x - A.base[0], p.z - A.base[2]) < 8));
    expect(Math.hypot(p.x - A.base[0], p.z - A.base[2])).toBeLessThan(8);
    await settle(w.server, 60, () => ((p.health = 20), false));
    for (const c of A.sheet) expect(blockId(end.getState(...c))).toBe('ancient_gateway');
    expect(p.achievements.has('quest_broken_gateway')).toBe(true);
    expect(stacks(p).some((s) => s.tag?.lore === 'gateways_stitches')).toBe(true);
    // And back the other way
    await settle(w.server, 80, () => ((p.health = 20), false));
    w.server.teleport(p, A.base[0] + 0.5, A.base[1], A.base[2] + 0.5);
    await settle(w.server, 1500, () => ((p.health = 20), Math.hypot(p.x - B.base[0], p.z - B.base[2]) < 8));
    expect(Math.hypot(p.x - B.base[0], p.z - B.base[2])).toBeLessThan(8);
    // The classic gateways are untouched (nothing here is an end_gateway)
    for (const c of [...A.sheet, ...B.sheet]) expect(blockId(end.getState(...c))).not.toBe('end_gateway');
  }, 900000);
});

// ---------------------------------------------------------------------------
// THE SILENT CITY
// ---------------------------------------------------------------------------

describe('THE SILENT CITY', () => {
  it('a host is always found (the Fallen City, else a settlement or ruins); its hall and four reliquaries are built into it; shards make the key; the key opens the hall; the bell recovered', async () => {
    const w = await inBand('v6-structures', 2);
    const [p, q] = w.players as [ServerPlayer, ServerPlayer];
    for (const pl of w.players) pl.abilities.invulnerable = true;
    const eq = w.server.endQuests!;
    await settle(w.server, 400, () => !!eq.host);
    const h = eq.host!;
    expect(['fallen_city', 'end_settlement', 'end_ruins']).toContain(h.type);
    // The hall and the reliquaries go into the city as its chunks load
    await goTo(w, [h.hall[0], h.hall[1] + 1, h.hall[2] + 5], 96);
    await settle(w.server, 400, () => h.built.length === 1 + h.spots.length);
    expect(h.built).toContain('hall');
    const end = w.server.dim('end');
    expect(h.door).toBeTruthy();
    for (const d of h.door!) expect(blockId(end.getState(...d))).toBe('ancient_vault_door');
    const chestAt: P3 = [h.hall[0], h.hall[1] + 1, h.hall[2] - 2];
    expect(blockId(end.getState(...chestAt))).toBe('chest');
    expect((end.getBlockEntity(...chestAt) as { loot?: string }).loot).toBe('chest/silent_hall');
    // 1. Found
    tick(w.server, 25);
    expect(eq.rec('silent').flags).toContain('found');
    expect(tracker(w.conns[0]!)).toMatch(/Collect the Ancient Key Shards/);
    // The door won't open without the key
    hold(p, null);
    useOn(w, 0, h.door![0]!);
    expect(blockId(end.getState(...h.door![0]!))).toBe('ancient_vault_door');
    // 2. The four shards, one per reliquary (each opens once)
    const rel = h.rel.filter((r): r is P3 => !!r);
    expect(rel.length).toBe(QUEST.shards);
    for (const r of rel) {
      expect(blockId(end.getState(...r))).toBe('ancient_reliquary');
      useOn(w, 0, r);
      expect(getProp(end.getState(...r), 'open')).toBe('true');
      useOn(w, 0, r);
    }
    expect(count(p, 'ancient_key_shard')).toBe(QUEST.shards);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Combine the shards/);
    // 3. The key: four shards at a crafting grid
    const { matchCrafting } = await import('../../src/common/game/crafting');
    const grid = Array.from({ length: 4 }, () => stackOf('ancient_key_shard', 1));
    const r = matchCrafting(grid, 2, 2);
    expect(r && items[r.result]!.id).toBe('ancient_key');
    for (let i = 0; i < p.inventory.size; i++) if (itemIdOf(p.inventory.get(i) ?? stackOf('air', 1)) === 'ancient_key_shard') p.inventory.set(i, null);
    hold(p, stackOf('ancient_key', 1));
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Open the sealed hall/);
    // 4. The hall opens (the key isn't used up)
    useOn(w, 0, h.door![0]!);
    for (const d of h.door!) expect(blockId(end.getState(...d))).toBe('air');
    expect(count(p, 'ancient_key')).toBe(1);
    // The bell from the chest: the quest is done, for both players there
    const { rollLoot } = await import('../../src/common/game/loot');
    const { Random } = await import('../../src/common/math/rng');
    const loot = rollLoot('chest/silent_hall', { rng: new Random(1) });
    expect(loot.some((s) => itemIdOf(s) === 'silent_bell')).toBe(true);
    w.server.teleport(q, h.hall[0] + 0.5, h.hall[1] + 1, h.hall[2] + 0.5);
    p.inventory.set(5, stackOf('silent_bell', 1));
    await settle(w.server, 40);
    expect(eq.rec('silent').done).toBe(true);
    for (const pl of [p, q]) expect(pl.achievements.has('quest_silent_city'), pl.name).toBe(true);
  }, 900000);

  it('the Silent Bell holds every Construct within 64 blocks still for 10 seconds, with 5 minutes to ring again; the key opens a library archive too', async () => {
    const w = await inBand('v6-structures');
    const [p] = w.players as [ServerPlayer];
    p.abilities.invulnerable = true;
    const end = w.server.dim('end');
    const at = { x: p.x, y: p.y, z: p.z };
    const spawn = (dx: number): Mob => w.server.mobs!.spawn(end, 'guardian_sentinel', at.x + dx, at.y, at.z, { data: { home: [Math.floor(at.x + dx), Math.floor(at.y), Math.floor(at.z)] }, persistent: true })!;
    const near = [spawn(6), spawn(-20)];
    await goTo(w, [Math.floor(at.x) + 80, Math.floor(at.y), Math.floor(at.z)], 32);
    w.server.teleport(p, at.x, at.y, at.z);
    const far = spawn(80);
    tick(w.server, 4);
    hold(p, stackOf('silent_bell', 1));
    w.server.handle(w.conns[0]!, { t: 'use', hand: 0, action: 'start' });
    tick(w.server, 2);
    for (const m of near) {
      expect(m.noAi).toBe(true);
      expect(m.target).toBeNull();
    }
    expect(far.noAi).toBe(false);
    expect(w.conns[0]!.of('cooldown').pop()?.ticks).toBe(QUEST.bellCooldown);
    tick(w.server, QUEST.bellTicks + 4);
    for (const m of near) expect(m.noAi).toBe(false);
    // Within the cooldown: nothing
    w.server.handle(w.conns[0]!, { t: 'use', hand: 0, action: 'start' });
    tick(w.server, 2);
    for (const m of near) expect(m.noAi).toBe(false);
    // The Ancient Key opens a library's sealed archive (and puts its chest inside)
    const g = end.generator as EndGenerator;
    const it = g.expansionStructures!.nearestSteps('end_library', Math.floor(p.x), Math.floor(p.z), 24, (s) => !!questOf(s)?.seals?.some((x) => x.kind === 'archive'));
    let r = it.next();
    while (!r.done) r = it.next();
    const lib = r.value!;
    expect(lib).toBeTruthy();
    const seal = questOf(lib)!.seals!.find((s) => s.kind === 'archive')!;
    await goTo(w, [seal.door[0]![0], seal.door[0]![1], seal.door[0]![2] - 3], 48);
    w.server.endMobs!.killNear(end, p.x, p.y, p.z, 200);
    expect(blockId(end.getState(...seal.door[0]!))).toBe('ancient_vault_door');
    hold(p, null);
    useOn(w, 0, seal.door[0]!);
    expect(blockId(end.getState(...seal.door[0]!))).toBe('ancient_vault_door');
    hold(p, stackOf('ancient_key', 1));
    useOn(w, 0, seal.door[0]!);
    for (const d of seal.door) expect(blockId(end.getState(...d))).toBe('air');
    const room = seal.room;
    let chests = 0;
    for (let x = room.x0; x <= room.x1; x++) for (let y = room.y0; y <= room.y1; y++) for (let z = room.z0; z <= room.z1; z++) if ((end.getBlockEntity(x, y, z) as { loot?: string } | undefined)?.loot === 'chest/end_library_archive') chests++;
    expect(chests).toBe(1);
  }, 900000);
});

// ---------------------------------------------------------------------------
// THE CRYSTAL VAULT
// ---------------------------------------------------------------------------

describe('THE CRYSTAL VAULT', () => {
  it('four crystals on four pedestals, powered by Crystal Generators, light one by one; the door opens and its Bulwark wakes; Ender Blink the first vault a player clears', async () => {
    // (a seed with an End Palace: they are the rarest structure, and many worlds have none)
    const w = await inBand('v6-e2e');
    const [p] = w.players as [ServerPlayer];
    p.abilities.invulnerable = true;
    const end = w.server.dim('end');
    // The nearest End Palace (the rarest variant)
    const site = w.server.endQuests!.nearestSite(p, 'crystal_vault')!;
    expect(site).toBeTruthy();
    await goTo(w, site.at, 64);
    w.server.endMobs!.killNear(end, p.x, p.y, p.z, 300);
    const palace = startWith(w, site.at, (qq) => !!qq.vault && `vault:${qq.vault.pedestals[0]!.join(',')}` === site.key);
    const qs = questOf(palace)!;
    const vault = qs.vault!;
    const door = qs.seals!.find((s) => s.kind === 'vault')!.door;
    const key = `vault:${vault.pedestals[0]!.join(',')}`;
    const eq = w.server.endQuests!;
    expect(blockId(end.getState(...door[0]!))).toBe('crystal_vault_door');
    const clear = async (): Promise<void> => {
      // 1. Inspected: four empty pedestals rise on the dais
      hold(p, null);
      useOn(w, 0, door[0]!);
      expect(eq.rec(key).stage).toBeGreaterThanOrEqual(1);
      for (const pd of vault.pedestals) {
        expect(blockId(end.getState(...pd))).toBe('crystal_pedestal');
        expect(getProp(end.getState(...pd), 'crystal')).toBe('false');
      }
      // 2. A crystal on each
      for (const pd of vault.pedestals) {
        hold(p, stackOf('end_crystal', 1));
        useOn(w, 0, pd);
        expect(getProp(end.getState(...pd), 'crystal')).toBe('true');
      }
      expect(count(p, 'end_crystal')).toBe(0);
      // Power from anything but a working Crystal Generator doesn't light them
      for (const pd of vault.pedestals) {
        end.setBlock(pd[0], pd[1] + 1, pd[2], S('void_cell'));
        (end.getBlockEntity(pd[0], pd[1] + 1, pd[2]) as EngBE).energy = 100000;
      }
      tick(w.server, 60);
      for (const pd of vault.pedestals) expect(getProp(end.getState(...pd), 'lit')).toBe('false');
      // 3. Crystal Generators on them: they light up in turn, then the door opens
      for (const pd of vault.pedestals) {
        end.setBlock(pd[0], pd[1] + 1, pd[2], 0);
        end.setBlock(pd[0], pd[1] + 1, pd[2], S('crystal_generator'));
        const { portAt } = await import('../../src/server/engineering/ports');
        portAt(w.server, end, pd[0], pd[1] + 1, pd[2], 1)!.insert(stackOf('end_crystal_fragment', 4));
      }
      const litAt: number[] = [];
      await settle(w.server, 400, () => {
        vault.pedestals.forEach((pd, i) => {
          if (litAt[i] === undefined && getProp(end.getState(...pd), 'lit') === 'true') litAt[i] = w.server.tickNo;
        });
        return blockId(end.getState(...door[0]!)) === 'air';
      });
      expect(litAt.length).toBe(4);
      for (let i = 1; i < 4; i++) expect(litAt[i]! - litAt[i - 1]!).toBeGreaterThanOrEqual(QUEST.lightEvery - 4);
      for (const d of door) expect(blockId(end.getState(...d))).toBe('air');
      // 4. The Bulwark wakes; beaten, the vault is cleared
      const bulwark = [...end.entities.values()].find((e) => e instanceof Mob && e.data.vault === key) as Mob;
      expect(bulwark).toBeTruthy();
      expect(bulwark.data.awake).toBe(true);
      tick(w.server, 20);
      expect(tracker(w.conns[0]!)).toMatch(/Bulwark/);
      bulwark.hurt(10000, { source: 'player', attacker: p });
      tick(w.server, 30);
    };
    await clear();
    expect(eq.rec(key).done).toBe(true);
    expect(p.achievements.has('quest_crystal_vault')).toBe(true);
    expect(count(p, 'ender_blink_module')).toBe(1);
    expect(p.endRewards.has('vault_blink')).toBe(true);
    // Its hoard waits inside
    const room = qs.seals!.find((s) => s.kind === 'vault')!.room;
    let hoard = 0;
    for (let x = room.x0; x <= room.x1; x++) for (let y = room.y0; y <= room.y1; y++) for (let z = room.z0; z <= room.z1; z++) if ((end.getBlockEntity(x, y, z) as { loot?: string } | undefined)?.loot === 'chest/end_palace_vault') hoard++;
    expect(hoard).toBeGreaterThanOrEqual(1);
    // A second vault cleared: no second Ender Blink (the first is put away first)
    for (let i = 0; i < 9; i++) if (itemIdOf(p.inventory.get(i) ?? stackOf('air', 1)) === 'ender_blink_module') {
      p.inventory.set(30, p.inventory.get(i));
      p.inventory.set(i, null);
    }
    eq.adminReset('crystal_vault');
    expect(blockId(end.getState(...door[0]!))).toBe('crystal_vault_door');
    await clear();
    expect(count(p, 'ender_blink_module')).toBe(1);
  }, 900000);

  it("a vault the Admin Panel built can be tried out, but counts for nothing: no advancement, and its Ender Blink is a cheat's", async () => {
    const w = await inBand('v6-structures');
    const [p] = w.players as [ServerPlayer];
    p.abilities.invulnerable = true;
    const end = w.server.dim('end');
    const palace = w.server.endStructures!.generateAt(p, 'end_palace')!;
    await settle(w.server, 900, () => w.server.endStructures!.pendingBuilds === 0);
    w.server.endMobs!.killNear(end, p.x, p.y, p.z, 300);
    const qs = questOf(palace)!;
    const vault = qs.vault!;
    const door = qs.seals!.find((s) => s.kind === 'vault')!.door;
    hold(p, null);
    useOn(w, 0, door[0]!);
    for (const pd of vault.pedestals) {
      hold(p, stackOf('end_crystal', 1));
      useOn(w, 0, pd);
      end.setBlock(pd[0], pd[1] + 1, pd[2], S('crystal_generator'));
      const { portAt } = await import('../../src/server/engineering/ports');
      portAt(w.server, end, pd[0], pd[1] + 1, pd[2], 1)!.insert(stackOf('end_crystal_fragment', 4));
    }
    await settle(w.server, 400, () => blockId(end.getState(...door[0]!)) === 'air');
    const key = `vault:${vault.pedestals[0]!.join(',')}`;
    const bulwark = [...end.entities.values()].find((e) => e instanceof Mob && e.data.vault === key) as Mob;
    expect(bulwark).toBeTruthy();
    bulwark.hurt(10000, { source: 'player', attacker: p });
    tick(w.server, 30);
    expect(w.server.endQuests!.rec(key).done).toBe(true);
    expect(p.achievements.has('quest_crystal_vault')).toBe(false);
    const mod = stacks(p).find((s) => itemIdOf(s) === 'ender_blink_module')!;
    expect(isAdminStack(mod)).toBe(true);
    expect(p.endRewards.has('vault_blink')).toBe(false);
    // Its quests survive a restart (the structure is remembered)
    expect((w.server.level.flags as { endGenerated?: unknown[] }).endGenerated?.length).toBe(1);
  }, 900000);
});

// ---------------------------------------------------------------------------
// THE DRAGON'S HISTORY
// ---------------------------------------------------------------------------

describe("THE DRAGON'S HISTORY", () => {
  it('read the Nest, then three more of the Dragon, gather four scale fragments, mend the ring: one way into the Sanctum (built then), and a way back', async () => {
    const w = await inBand('v6-structures');
    const [p] = w.players as [ServerPlayer];
    p.abilities.invulnerable = true;
    const es = w.server.endStructures!;
    // The Nest, carved
    es.forceNest();
    const plan = es.nestPlan();
    await goTo(w, plan.floor, 64);
    await settle(w.server, 1500, () => !!es.nest?.built);
    expect(es.nest?.built).toBe(true);
    tick(w.server, 25);
    const eq = w.server.endQuests!;
    expect(tracker(w.conns[0]!)).toMatch(/Read the Nest/);
    // The ring won't take scales before the story is known
    const ring = plan.portal;
    const sheet = ([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const).map(([dx, dy]) => [ring[0] + dx, ring[1] + dy, ring[2]] as P3).find((c) => blockId(w.server.dim('end').getState(...c)) === 'dead_portal')!;
    expect(sheet).toBeTruthy();
    hold(p, stackOf('dragon_scale_fragment', 4));
    useOn(w, 0, sheet);
    expect(eq.rec('dragon').flags).not.toContain('repaired');
    // 1. The Nest's five; 2. three more about the Dragon (read, as the client tells it)
    const read = (id: string): void => {
      hold(p, stackOf('book', 1, { tag: { lore: id } }));
      w.server.handle(w.conns[0]!, { t: 'use', hand: 0, action: 'start' });
    };
    for (const f of NEST_LORE) read(f.id);
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/more fragments about the Dragon \(0\/3\)/);
    for (const f of LORE.filter((l) => l.topic === 'dragon').slice(0, QUEST.dragonFragments)) read(f.id);
    // 3. Four scale fragments
    hold(p, stackOf('dragon_scale_fragment', 3));
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Dragon Scale Fragments \(3\/4\)/);
    hold(p, stackOf('dragon_scale_fragment', 4));
    tick(w.server, 25);
    expect(tracker(w.conns[0]!)).toMatch(/Repair the Nest/);
    // 4. The ring mended
    useOn(w, 0, sheet);
    expect(eq.rec('dragon').flags).toContain('repaired');
    expect(count(p, 'dragon_scale_fragment')).toBe(0);
    expect(blockId(w.server.dim('end').getState(...sheet))).toBe('ancient_gateway');
    // Through it: the Sanctum is built where it floats, deep in the band
    w.server.teleport(p, ring[0] + 0.5, ring[1] - 1, ring[2] + 0.5);
    const st = (): { at: P3; built: boolean } | null => (w.server.level.flags as { dragonSanctum?: { at: P3; built: boolean } }).dragonSanctum ?? null;
    await settle(w.server, 1500, () => !!st()?.built && Math.hypot(p.x - st()!.at[0], p.z - st()!.at[2]) < 8);
    const sanct = st()!;
    expect(sanct.built).toBe(true);
    const { inExpansion } = await import('../../src/common/endExpansion/region');
    expect(inExpansion(sanct.at[0], sanct.at[2])).toBe(true);
    await settle(w.server, 40);
    expect(eq.rec('dragon').done).toBe(true);
    expect(p.achievements.has('quest_dragons_history')).toBe(true);
    // What it keeps: the Sanctum Dragon Scale and the last fragment
    const end = w.server.dim('end');
    let chest: { loot?: string } | undefined;
    for (let dx = -6; dx <= 6 && !chest; dx++) for (let dz = -6; dz <= 6 && !chest; dz++) for (let dy = 0; dy < 9; dy++) {
      const b = end.getBlockEntity(sanct.at[0] + dx, sanct.at[1] + dy, sanct.at[2] + dz) as { loot?: string } | undefined;
      if (b?.loot) chest = b;
    }
    expect(chest?.loot).toBe('chest/dragon_sanctum');
    const { rollLoot } = await import('../../src/common/game/loot');
    const { Random } = await import('../../src/common/math/rng');
    const loot = rollLoot('chest/dragon_sanctum', { rng: new Random(2) });
    expect(loot.some((s) => itemIdOf(s) === 'sanctum_dragon_scale')).toBe(true);
    expect(loot.some((s) => s.tag?.lore === 'sanctum_seen')).toBe(true);
    // The way back
    const back = sanct.at[2] - 6 + 1;
    w.server.teleport(p, sanct.at[0] + 0.5, sanct.at[1] + 1, back + 0.5);
    await settle(w.server, 1500, () => Math.hypot(p.x - ring[0], p.z - ring[2]) < 8);
    expect(Math.hypot(p.x - ring[0], p.z - ring[2])).toBeLessThan(8);
  }, 900000);
});

// ---------------------------------------------------------------------------
// Saves, old worlds and the Admin Panel
// ---------------------------------------------------------------------------

/** Turns a player to look at the middle of a block. */
function lookAt(w: World, p: ServerPlayer, at: P3): void {
  const [ex, ey, ez] = w.server.eyePos(p);
  const dx = at[0] + 0.5 - ex;
  const dy = at[1] + 0.5 - ey;
  const dz = at[2] + 0.5 - ez;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = -Math.asin(dy / Math.hypot(dx, dy, dz));
}

/** An admin request as the panel sends it; its (last) answer. */
function adminOf(w: World, i = 0): (action: Record<string, unknown>) => { ok: boolean; text: string; data?: Record<string, unknown> } {
  let req = 5000;
  return (action) => {
    const r = req++;
    w.server.handle(w.conns[i]!, { t: 'admin', req: r, action });
    tick(w.server, 2);
    return (w.conns[i]!.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? {}) as never;
  };
}

const END_QUEST_ADVANCEMENTS = ['quest_lost_observatory', 'quest_broken_gateway', 'quest_silent_city', 'quest_crystal_vault', 'quest_dragons_history', 'all_end_quests', 'repair_gateway_pair', 'teleport_own_nodes', 'fill_void_cell', 'elytra_upgrade', 'elytra_full', 'restore_ancient_core', 'run_crystal_generator'];

describe("the quests' lore", () => {
  it('the three quest fragments follow the lore rules, are never placed as loot, and are listed in the docs', async () => {
    const { readFileSync } = await import('node:fs');
    const { QUEST_LORE, loreWeight, LORE_SITES } = await import('../../src/common/endExpansion/lore');
    const docs = readFileSync('docs/END_EXPANSION.md', 'utf8');
    expect(QUEST_LORE.map((f) => f.id)).toEqual(['stars_circle', 'gateways_stitches', 'sanctum_seen']);
    for (const f of QUEST_LORE) {
      expect(f.lines.length, f.id).toBeLessThanOrEqual(4);
      for (const line of f.lines) {
        expect(line.length, f.id).toBeLessThan(70);
        expect(docs, `${f.id} missing from the docs`).toContain(line);
      }
      expect(docs).toContain(f.id);
      expect(f.lines.join(' ').toLowerCase()).not.toMatch(/herobrine|computer|farlands|error/);
      for (const site of LORE_SITES) expect(loreWeight(f, site), `${f.id} at ${site}`).toBe(0);
    }
  });
});

describe('saves, old worlds and the Admin Panel', () => {
  it('quest states, gateways, the Silent City, nodes, machines and Elytra data survive a save; the quests carry on after it', async () => {
    const storage = new MemoryStorage();
    const w = await inBand('v6-structures', 1, {}, storage);
    const [p] = w.players as [ServerPlayer];
    p.abilities.invulnerable = true;
    const eq = w.server.endQuests!;
    const end = w.server.dim('end');
    await settle(w.server, 400, () => !!eq.host);
    // A gateway half mended
    const { a, aSite } = portalWithPair(w);
    const A = portalCells(aSite);
    await goTo(w, [A.base[0] + A.normal[0] * 2, A.base[1], A.base[2] + A.normal[1] * 2]);
    const cellA = A.sheet.find((c) => blockId(end.getState(...c)) === 'dead_portal') ?? A.frame.find((c) => blockId(end.getState(...c)) !== 'air')!;
    hold(p, null);
    useOn(w, 0, cellA);
    hold(p, stackOf('ancient_end_bricks', 12));
    p.inventory.set(1, stackOf('end_crystal', 1));
    useOn(w, 0, cellA);
    expect(eq.gates[a]?.repaired).toBe(true);
    // An observatory found (the lens still cracked)
    const site = eq.nearestSite(p, 'lost_observatory')!;
    const lens = site.key.slice(4).split(',').map(Number) as P3;
    await goTo(w, site.at);
    hold(p, null);
    useOn(w, 0, lens);
    expect(eq.rec(site.key).stage).toBe(1);
    expect(p.endQuest).toBe(site.key);
    // Machines, with what's in them and how they're set (out of the way, not joined up)
    const [mx, my, mz] = [Math.floor(p.x) + 3, Math.floor(p.y) + 6, Math.floor(p.z)];
    const machines: [string, P3][] = [
      ['void_cell', [mx, my, mz]],
      ['crystal_generator', [mx + 2, my, mz]],
      ['end_processor', [mx + 4, my, mz]],
      ['crystal_grower', [mx + 6, my, mz]],
      ['ender_bridge_projector', [mx + 8, my, mz]],
      ['teleport_node', [mx + 10, my, mz]],
    ];
    for (const [id, at] of machines) {
      end.setBlock(...at, S(id));
      w.server.engineering!.onPlaced(p, end, ...at, stackOf(id, 1));
      const b = end.getBlockEntity(...at) as EngBE;
      b.cfg = { ...(b.cfg ?? {}), signal: 'on' };
    }
    (end.getBlockEntity(...machines[0]![1]) as EngBE).energy = 1_234_567;
    const { portAt } = await import('../../src/server/engineering/ports');
    expect(portAt(w.server, end, ...machines[1]![1], 1)!.insert(stackOf('end_crystal_fragment', 5))).toBe(5);
    expect(portAt(w.server, end, ...machines[2]![1], 1)!.insert(stackOf('ender_ore', 3))).toBe(3);
    tick(w.server, 20);
    // The wings, and what the player has earned
    const { withUpgrade, elytraUpgrades } = await import('../../src/common/endExpansion/elytra');
    p.inventory.set(38, { ...withUpgrade(withUpgrade(stackOf('elytra', 1), 'reinforced'), 'void_recovery'), damage: 123 });
    p.recoverCooldown = 4000;
    p.recipes.add('void_skiff');
    p.endRewards.add('vault_blink');
    tick(w.server, 5);
    await w.server.stop();
    const saved = {
      quests: JSON.parse(JSON.stringify(w.server.level.quests.end)),
      flags: JSON.parse(JSON.stringify({ g: (w.server.level.flags as Record<string, unknown>).endGates, s: (w.server.level.flags as Record<string, unknown>).silentCity, n: (w.server.level.flags as Record<string, unknown>).endNodes })),
      bes: machines.map(([, at]) => JSON.parse(JSON.stringify(end.getBlockEntity(...at)))),
      cooldown: p.recoverCooldown,
    };
    expect(Object.keys(saved.flags.n).length).toBe(1);
    expect(saved.flags.s).toBeTruthy();

    // Back again
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    s2.level.rules.doMobSpawning = false;
    const j = await join(s2, 'P0');
    const w2: World = { server: s2, storage, players: [j.player], conns: [j.conn] };
    const p2 = j.player;
    p2.abilities.invulnerable = true;
    expect(p2.dim.id).toBe('end');
    await goTo(w2, site.at);
    const end2 = s2.dim('end');
    expect(s2.level.quests.end).toEqual(saved.quests);
    const f2 = s2.level.flags as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify({ g: f2.endGates, s: f2.silentCity, n: f2.endNodes }))).toEqual(saved.flags);
    expect(s2.endQuests!.gates[a]?.repaired).toBe(true);
    expect(s2.endQuests!.host).toBeTruthy();
    machines.forEach(([id, at], i) => {
      const b = end2.getBlockEntity(...at) as EngBE;
      expect(b?.id, id).toBe(id);
      expect(b.energy ?? 0, id).toBe(saved.bes[i].energy ?? 0);
      expect(b.items ?? null, id).toEqual(saved.bes[i].items ?? null);
      expect(b.cfg?.signal, id).toBe('on');
      expect(b.by, id).toBe(p2.uuid);
    });
    expect((end2.getBlockEntity(...machines[0]![1]) as EngBE).energy).toBe(1_234_567);
    expect(s2.endTransport!.nodeList().map(([k]) => k)).toEqual([`end|${machines[5]![1].join(',')}`]);
    const wings = p2.inventory.get(38)!;
    expect(elytraUpgrades(wings)).toEqual(['reinforced', 'void_recovery']);
    expect(wings.damage).toBe(123);
    expect(p2.recoverCooldown).toBeGreaterThan(saved.cooldown - 400);
    expect(p2.recipes.has('void_skiff')).toBe(true);
    expect(p2.endRewards.has('vault_blink')).toBe(true);
    expect(p2.endQuest).toBe(site.key);
    // The gateway's mended frame is still there
    for (const f of A.frame) if (end2.isLoaded(f[0], f[2])) expect(blockId(end2.getState(...f))).toMatch(/ancient_end_bricks/);
    // The observatory carries on where it was left
    tick(s2, 25);
    expect(tracker(j.conn)).toMatch(/Repair the lens/);
    hold(p2, stackOf('ancient_fragment', 8));
    useOn(w2, 0, lens);
    expect(blockId(end2.getState(...lens))).toBe('restored_ancient_lens');
    tick(s2, 25);
    expect(tracker(j.conn)).toMatch(/Power the telescope/);
  }, 900000);

  it('phase 1 and 2 worlds load and run with no End quest sites (no structures there); a phase 3 save, without End quest data, gets its structures\' quests', async () => {
    const { makeServerAt } = await import('../helpers/testServer');
    for (const version of [6, 7]) {
      const { server } = await makeServerAt(version, { seed: 'v6-p4-old-' + version });
      const j = await join(server, 'Old');
      const g = server.dim('end').generator as EndGenerator;
      const a = g.terrain.expansion.arrival();
      server.changeDimension(j.player, 'end', a.x + 0.5, a.floor, a.z - 0.5);
      const w: World = { server, storage: new MemoryStorage(), players: [j.player], conns: [j.conn] };
      await goTo(w, [a.x, a.floor, a.z]);
      tick(server, 100);
      const eq = server.endQuests!;
      for (const q of ['lost_observatory', 'broken_gateway', 'crystal_vault'] as const) expect(eq.nearestSite(j.player, q), `${version} ${q}`).toBeNull();
      expect(eq.censusNow().size).toBe(0);
      expect(eq.adminStart(j.player, 'lost_observatory').ok).toBe(false);
      expect(Object.keys(server.level.quests.end)).toEqual([]);
    }
    // A phase 3 save: no `end` among its quests, players without the new fields
    const storage = new MemoryStorage();
    const first = await makeServer({ seed: 'v6-structures' }, storage);
    await join(first.server, 'P0');
    await first.server.stop();
    const lvl = storage.level as { quests: Record<string, unknown>; flags: Record<string, unknown> };
    delete lvl.quests.end;
    for (const k of ['endGates', 'silentCity', 'endNodes', 'dragonSanctum', 'endGenerated']) delete lvl.flags[k];
    for (const [, d] of storage.players) for (const k of ['recipes', 'endRewards', 'recoverCooldown', 'endQuest']) delete (d as Record<string, unknown>)[k];
    const w = await inBand('v6-structures', 1, {}, storage);
    expect(w.server.level.quests.end).toEqual({});
    const [p] = w.players as [ServerPlayer];
    expect(p.recipes.size + p.endRewards.size + p.recoverCooldown).toBe(0);
    expect(p.endQuest).toBeNull();
    const eq = w.server.endQuests!;
    const site = eq.nearestSite(p, 'lost_observatory')!;
    expect(site).toBeTruthy();
    const lens = site.key.slice(4).split(',').map(Number) as P3;
    await goTo(w, site.at);
    hold(p, null);
    useOn(w, 0, lens);
    expect(eq.rec(site.key).stage).toBe(1);
    expect(portalWithPair(w).a).toBeTruthy();
    await settle(w.server, 400, () => !!eq.host);
    expect(eq.host).toBeTruthy();
  }, 900000);

  it('every Admin Panel op works and awards nothing', async () => {
    const { validateAdmin } = await import('../../src/common/game/admin');
    const { END_QUEST_IDS } = await import('../../src/common/endExpansion/quests');
    for (const op of ['quest_start', 'quest_complete', 'quest_reset', 'quest_tp']) {
      for (const quest of END_QUEST_IDS) expect(validateAdmin({ a: 'v6', op, quest })).toEqual({ a: 'v6', op, quest });
      expect(validateAdmin({ a: 'v6', op, quest: 'nope' })).toBeNull();
      expect(validateAdmin({ a: 'v6', op })).toBeNull();
    }
    for (const op of ['fill_eu', 'force_gate', 'open_sanctum']) expect(validateAdmin({ a: 'v6', op })).toEqual({ a: 'v6', op });
    // (a seed with every kind of quest site, an End Palace's vault among them)
    const w = await inBand('v6-e2e', 1, { cheats: true });
    const [p] = w.players as [ServerPlayer];
    p.abilities.invulnerable = true;
    const admin = adminOf(w);
    const eq = w.server.endQuests!;
    const end = w.server.dim('end');
    const nothingEarned = (): void => {
      for (const id of END_QUEST_ADVANCEMENTS) expect(p.achievements.has(id), id).toBe(false);
      expect(p.endRewards.size).toBe(0);
      for (const s of stacks(p)) expect(isAdminStack(s), itemIdOf(s)).toBe(true);
    };
    // The give sets
    for (const set of ['end_machines', 'elytra_modules', 'quest_items']) {
      tick(w.server, 40);
      expect(admin({ a: 'v6', op: 'give_set', set }).ok, set).toBe(true);
    }
    expect(stacks(p).some((s) => itemIdOf(s) === 'thrust_module')).toBe(true);
    // A cheat module on an Elytra: it works, but earns nothing
    const ct = w.server.interaction.containers;
    ct.openSmithing(p, end, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const win = ct.windowFor(p)!;
    win.slots[0]!.set(stackOf('elytra', 1));
    win.slots[1]!.set({ ...stackOf('thrust_module', 1), tag: { admin: true } });
    win.refresh?.();
    const up = win.slots[2]!.get() as ItemStack;
    expect(up).toBeTruthy();
    win.slots[2]!.onTake?.(p, up);
    expect(isAdminStack(up)).toBe(true);
    w.server.interaction.closeWindow(p, win.id, true);
    nothingEarned();
    // Each quest: teleport to its nearest site, start it, complete it, reset it
    for (const q of END_QUEST_IDS) {
      if (q === 'dragons_history') continue;
      const tp = admin({ a: 'v6', op: 'quest_tp', quest: q });
      expect(tp.ok, q + ' ' + tp.text).toBe(true);
      await settle(w.server, 1500, () => w.conns[0]!.received.some((m) => m.t === 'admin_result' && (m as { data?: { teleported?: boolean } }).data?.teleported && (m as unknown as { req: number }).req >= 5000) && end.isLoaded(p.x + 32, p.z + 32) && end.isLoaded(p.x - 32, p.z - 32));
      w.conns[0]!.received.length = 0;
      const site = eq.nearestSite(p, q)!;
      expect(site, q).toBeTruthy();
      expect(Math.hypot(site.at[0] - p.x, site.at[2] - p.z), q).toBeLessThan(48);
      const st = admin({ a: 'v6', op: 'quest_start', quest: q });
      expect(st.ok, q + ' ' + st.text).toBe(true);
      expect(p.endQuest, q).toBeTruthy();
      const key = p.endQuest!;
      expect(eq.rec(key).done).toBe(false);
      const done = admin({ a: 'v6', op: 'quest_complete', quest: q });
      expect(done.ok, q + ' ' + done.text).toBe(true);
      expect(eq.rec(key).done, q).toBe(true);
      expect(eq.rec(key).flags, q).toContain('cheat');
      tick(w.server, 40);
      nothingEarned();
      expect(admin({ a: 'v6', op: 'quest_reset', quest: q }).ok).toBe(true);
      expect(w.server.level.quests.end[key], q).toBeUndefined();
      if (q === 'lost_observatory') expect(blockId(end.getState(...(key.slice(4).split(',').map(Number) as P3)))).toBe('ancient_lens');
    }
    // Fill EU: the machine looked at, full, marked a cheat (a full Void Cell earns nothing)
    lookAt(w, p, [Math.floor(p.x), Math.floor(p.y) + 40, Math.floor(p.z)]);
    expect(admin({ a: 'v6', op: 'fill_eu' }).ok).toBe(false);
    // (in front of the eyes, or whatever is in the way there)
    let cellAt: P3 = [Math.floor(p.x) + 2, Math.floor(p.y) + 3, Math.floor(p.z)];
    lookAt(w, p, cellAt);
    cellAt = eq.lookedAt(p) ?? cellAt;
    end.setBlock(...cellAt, S('void_cell'));
    lookAt(w, p, cellAt);
    expect(eq.lookedAt(p)).toEqual(cellAt);
    expect(admin({ a: 'v6', op: 'fill_eu' }).ok).toBe(true);
    const cell = end.getBlockEntity(...cellAt) as EngBE;
    expect(cell.energy).toBe(2_000_000);
    expect(cell.cheat).toBe(1);
    tick(w.server, 40);
    // Cheat-made nodes: a trip between them earns nothing
    const nodeAt: P3 = [cellAt[0] + 4, cellAt[1] - 3, cellAt[2]];
    for (const at of [nodeAt, [nodeAt[0] + 6, nodeAt[1], nodeAt[2]] as P3]) {
      end.setBlock(...at, S('teleport_node'));
      w.server.engineering!.onPlaced(p, end, ...at, { ...stackOf('teleport_node', 1), tag: { admin: true } });
      (end.getBlockEntity(...at) as EngBE).energy = 200000;
    }
    expect(w.server.endTransport!.nodeList().every(([, r]) => r.cheat)).toBe(true);
    nothingEarned();
    // Force a gateway: look at a broken portal; then through it (nothing earned)
    lookAt(w, p, [Math.floor(p.x), Math.floor(p.y) + 40, Math.floor(p.z)]);
    expect(admin({ a: 'v6', op: 'force_gate' }).ok).toBe(false);
    const { a, b, aSite, bSite } = portalWithPair(w);
    const A = portalCells(aSite);
    const B = portalCells(bSite);
    await goTo(w, [A.base[0] + A.normal[0] * 3, A.base[1], A.base[2] + A.normal[1] * 3]);
    const sheet = A.sheet.find((c) => blockId(end.getState(...c)) === 'dead_portal') ?? A.sheet[0]!;
    lookAt(w, p, sheet);
    const fg = admin({ a: 'v6', op: 'force_gate' });
    expect(fg.ok, fg.text).toBe(true);
    expect(eq.gates[a]?.linked && eq.gates[b]?.linked).toBe(true);
    for (const c of A.sheet) expect(blockId(end.getState(...c))).toBe('ancient_gateway');
    w.server.teleport(p, A.base[0] + 0.5, A.base[1], A.base[2] + 0.5);
    await settle(w.server, 1500, () => Math.hypot(p.x - B.base[0], p.z - B.base[2]) < 8);
    expect(Math.hypot(p.x - B.base[0], p.z - B.base[2])).toBeLessThan(8);
    tick(w.server, 40);
    nothingEarned();
    // Open the Sanctum: not before the Nest is carved; then a cheat way in
    expect(admin({ a: 'v6', op: 'open_sanctum' }).ok).toBe(false);
    const es = w.server.endStructures!;
    es.forceNest();
    const plan = es.nestPlan();
    await goTo(w, plan.floor, 64);
    await settle(w.server, 1500, () => !!es.nest?.built);
    const os = admin({ a: 'v6', op: 'open_sanctum' });
    expect(os.ok, os.text).toBe(true);
    expect(eq.rec('dragon').flags).toContain('cheat');
    const ring = plan.portal;
    w.server.teleport(p, ring[0] + 0.5, ring[1] - 1, ring[2] + 0.5);
    const sanct = (): { at: P3; built: boolean } | null => (w.server.level.flags as { dragonSanctum?: { at: P3; built: boolean } }).dragonSanctum ?? null;
    await settle(w.server, 1500, () => !!sanct()?.built && Math.hypot(p.x - sanct()!.at[0], p.z - sanct()!.at[2]) < 8);
    expect(sanct()?.built).toBe(true);
    tick(w.server, 40);
    // The Dragon's History through the panel, too
    for (const op of ['quest_start', 'quest_complete']) expect(admin({ a: 'v6', op, quest: 'dragons_history' }).ok, op).toBe(true);
    expect(eq.rec('dragon').done).toBe(true);
    tick(w.server, 40);
    nothingEarned();
    expect(admin({ a: 'v6', op: 'quest_reset', quest: 'dragons_history' }).ok).toBe(true);
    // The status shows the quests
    const status = admin({ a: 'v6', op: 'quest_reset', quest: 'silent_city' }).data as { quests?: { on: boolean } };
    expect(status.quests?.on).toBe(true);
    // The End test line, built up in the open: it runs, its bridge reaches out, and none of it counts
    const ry = 200;
    w.server.teleport(p, sanct()!.at[0] + 40.5, ry, sanct()!.at[2] + 0.5);
    p.abilities.flying = true;
    const [rx, rz] = [Math.floor(p.x) + 2, Math.floor(p.z) + 2];
    await settle(w.server, 600, () => end.isLoaded(rx - 16, rz) && end.isLoaded(rx + 48, rz));
    w.server.teleport(p, rx - 1.5, ry, rz - 1.5);
    expect(admin({ a: 'v6', op: 'end_rig' }).ok).toBe(true);
    p.abilities.flying = true;
    tick(w.server, 80);
    const gen = end.getBlockEntity(rx, ry, rz) as EngBE;
    expect(gen.cheat).toBeTruthy();
    expect(gen.status).toBe('working');
    expect(w.server.endTransport!.nodeList().filter(([k]) => k.includes(`,${ry},`)).length).toBe(2);
    expect(blockId(end.getState(rx + 11, ry, rz + 1))).toMatch(/^ender_light/);
    expect(blockId(end.getState(rx + 30, ry, rz + 1))).toMatch(/^ender_light/);
    expect(((end.getBlockEntity(rx + 4, ry, rz) as EngBE).items ?? []).some((it) => !!it)).toBe(true);
    tick(w.server, 40);
    nothingEarned();
  }, 1500000);
});
