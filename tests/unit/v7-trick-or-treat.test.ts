/**
 * V7 - The Halloween Update, phase 3: trick-or-treating. The Trick-or-Treat
 * Sack and its 128 candies, the four candies, temporary enchantments,
 * knocking, Candy Homes, Trick Homes, the Herobrine Head, the quest, the
 * Admin Panel's controls and the end of the season.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { HALLOWEEN_ENDS_AT } from '../../src/common/halloween/season';
import type { OverworldGenerator } from '../../src/common/gen/generator';
import { Random } from '../../src/common/math/rng';
import { blocks, STATE_BLOCK, getProp, S, stateOf } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { stackOf, markAdmin, type ItemStack, type Slot } from '../../src/common/game/itemstack';
import { CRAFTING } from '../../src/common/data/recipes';
import { LOOT_TABLES } from '../../src/common/data/loot';
import { rollLoot } from '../../src/common/game/loot';
import { recipeBook } from '../../src/common/game/recipeBook';
import { enchantLevel, tidyTemp } from '../../src/common/game/enchanting';
import { ENCHANT_BY_ID } from '../../src/common/data/enchantments';
import { validateC2S } from '../../src/common/net/validate';
import { validateAdmin, describeAdmin } from '../../src/common/game/admin';
import { Mob } from '../../src/server/entity/Mob';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import {
  CANDY_KINDS,
  CANDY_ITEM,
  CANDY_HOME_ODDS,
  CANDY_HOME_COUNT,
  SACK_ID,
  SACK_CAPACITY,
  REGULAR_BUFFS,
  BIG_BUFFS,
  KING_OUTCOMES,
  POISON_OUTCOMES,
  SEASONAL_RECIPES,
  poisonWorstCase,
  rollBite,
  rollCandyHome,
  sackContents,
  sackAdd,
  sackTake,
  sackTotal,
  withContents,
  type CandyKind,
} from '../../src/common/halloween/candy';
import { TEMP_ENCHANT_TICKS, activeTemp, setTempClock } from '../../src/common/halloween/tempEnchant';
import {
  NO_COSTUME_LINES,
  NO_SACK_LINES,
  FULL_SACK_LINES,
  ALREADY_LINES,
  FIGHT_LINES,
  EMPTY_LINES,
  OVER_LINES,
  CANDY_TIMES,
  TRICK_TIMES,
  TRICK_EMPTY_TICKS,
  TRICK_KINDS,
  TRICK_ODDS,
  TRICK_ENCOUNTERS,
  TRICK_HEROBRINE,
  QUEST_STEPS,
  QUEST_CANDY,
  trickKindFor,
  sanitizeProgress,
} from '../../src/common/halloween/trickOrTreat';
import type { DoorRecord } from '../../src/common/halloween/villages';
import { TrickOrTreatSystem, type DoorRef } from '../../src/server/systems/TrickOrTreat';

const MIN = 60_000;
const BEFORE = HALLOWEEN_ENDS_AT - MIN;
const AFTER = HALLOWEEN_ENDS_AT + MIN;
/** A Trick-or-Treat eligible village (seed "v7-villages", generator 9): see v7-villages.test.ts. */
const SEED = 'v7-villages';
const VILLAGE = { x: 552, z: 1000 };

const num = (id: string): number => itemById.get(id)!.num;
const idOf = (s: Slot | undefined): string => (s ? items[s.id]!.id : '');
const FACING: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

/** Every candy a player has: sacks, inventory and cursor, by kind. */
function candyOf(p: ServerPlayer): Record<CandyKind, number> {
  const out: Record<CandyKind, number> = { regular: 0, big: 0, king: 0, poisoned: 0 };
  const add = (st: Slot): void => {
    if (!st) return;
    if (idOf(st) === SACK_ID) {
      const c = sackContents(st);
      for (const k of CANDY_KINDS) out[k] += c.counts[k];
    }
    for (const k of CANDY_KINDS) if (idOf(st) === CANDY_ITEM[k]) out[k] += st.count;
  };
  for (let i = 0; i <= 40; i++) add(p.inventory.get(i));
  add(p.cursor);
  return out;
}
const total = (c: Record<CandyKind, number>): number => CANDY_KINDS.reduce((a, k) => a + c[k], 0);

function sackWith(fill: Partial<Record<CandyKind, number>>): ItemStack {
  const c = sackContents(null);
  for (const k of CANDY_KINDS) sackAdd(c, k, fill[k] ?? 0, false);
  return withContents(stackOf(SACK_ID), c);
}

/** Loads or generates every chunk of an area. */
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

/** A world in the season with its Trick-or-Treat Village built (a real one: not cheat-made). */
async function trickWorld(clock: { now: number } = { now: BEFORE }, storage = new MemoryStorage()): Promise<{ server: GameServer; storage: MemoryStorage; doors: DoorRef[] }> {
  const { server } = await makeServer({ seed: SEED }, storage, { clock: () => clock.now });
  const g = server.overworld.generator as OverworldGenerator;
  const s = g.villageAt(VILLAGE.x, VILLAGE.z)!;
  await loadArea(server, s.bounds.x0, s.bounds.z0, s.bounds.x1, s.bounds.z1);
  const rec = server.villages!.record(s.village!.key)!;
  expect(rec.kind).toBe('trick');
  const doors = rec.doors.map((door) => ({ key: s.village!.key, rec, door }));
  return { server, storage, doors };
}

/** Stands a player on a door's step, looking at it. */
function atDoor(p: ServerPlayer, d: DoorRecord): void {
  const [fx, fz] = FACING[d.facing]!;
  p.setPos(d.out[0] + 0.5, d.out[1], d.out[2] + 0.5);
  p.yaw = Math.atan2(fx, fz);
  p.pitch = 0;
}

function dress(p: ServerPlayer, sack: ItemStack | null = stackOf(SACK_ID), hat = 'carved_pumpkin'): void {
  p.inventory.set(39, hat ? stackOf(hat) : null);
  p.selectedSlot = 0;
  p.inventory.set(0, sack);
}

const speech = (conn: FakeConn): string[] => conn.of('speech').map((m) => m.text);
const knock = (server: GameServer, conn: FakeConn, d: DoorRecord): void => {
  server.handle(conn, { t: 'knock', x: d.x, y: d.y, z: d.z });
};

// ---------------------------------------------------------------------------
describe('the Trick-or-Treat Sack', () => {
  it('is one to a stack, made from string over wool, in the recipe book, only while Halloween is on', async () => {
    const it = itemById.get(SACK_ID)!;
    expect(it.maxStack).toBe(1);
    const r = CRAFTING.find((c) => c.result === SACK_ID)!;
    expect(r).toMatchObject({ type: 'shaped', pattern: [' S ', 'W W', 'WWW'] });
    expect(SEASONAL_RECIPES[SACK_ID]).toBe('halloween');
    expect(recipeBook().some((e) => e.result.id === it.num)).toBe(true);
    // Crafting it at a table: in the season, and not after it
    for (const [now, ok] of [
      [BEFORE, true],
      [AFTER, false],
    ] as const) {
      const { server } = await makeServer({ seed: 'v7-sack-craft' }, new MemoryStorage(), { clock: () => now });
      const { player } = await join(server, 'Ann', 'uuid-ann');
      server.interaction.containers.openCrafting(player, player.dim, Math.floor(player.x), Math.floor(player.y), Math.floor(player.z));
      const w = server.interaction.containers.windowOf(player);
      const grid = [null, 'string', null, 'white_wool', null, 'orange_wool', 'white_wool', 'black_wool', 'white_wool'];
      grid.forEach((id, i) => w.slots[1 + i]!.set(id ? stackOf(id) : null));
      w.refresh!();
      expect(idOf(w.slots[0]!.get()), `at ${now === BEFORE ? 'season' : 'after'}`).toBe(ok ? SACK_ID : '');
      await server.stop();
    }
  });

  it('holds exactly 128 candy, all kinds together; the count is the sack’s own data and never goes over', () => {
    const c = sackContents(null);
    expect(sackAdd(c, 'regular', 100, false)).toBe(100);
    expect(sackAdd(c, 'king', 40, false)).toBe(28);
    expect(sackTotal(c)).toBe(SACK_CAPACITY);
    expect(sackAdd(c, 'big', 1, false)).toBe(0);
    const st = withContents(stackOf(SACK_ID), c);
    expect(st.tag?.data?.candy).toEqual({ regular: 100, king: 28 });
    // Tampered with (or broken) data is cut back to what a sack can hold
    const bad = { ...st, tag: { data: { candy: { regular: 500, big: -3, king: 'x', poisoned: 1.7 } } } } as unknown as ItemStack;
    const r = sackContents(bad);
    expect(r.counts).toEqual({ regular: 128, big: 0, king: 0, poisoned: 0 });
    // Taking out: honest candy first, cheat-made candy stays cheat-made
    const m = sackContents(null);
    sackAdd(m, 'big', 3, false);
    sackAdd(m, 'big', 2, true);
    expect(sackTake(m, 'big', 4)).toEqual({ legit: 3, cheat: 1 });
    expect(m.counts.big).toBe(1);
    expect(m.cheat.big).toBe(1);
  });

  it('keeps its candy through every way a stack moves, and never makes or loses one', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'v7-sack-moves' }, storage, { clock: () => BEFORE });
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    const p = a.player;
    const ct = server.interaction.containers;
    p.inventory.set(0, sackWith({ regular: 40, big: 5 }));
    p.inventory.set(1, stackOf('candy', 20));
    p.inventory.set(2, stackOf('king_sized_candy', 2));
    const start = total(candyOf(p));
    const clickW = (slot: number, button = 0, mode = 'pickup', window = 0): void => server.handle(a.conn, { t: 'click', window, slot, button, mode, seq: 1 });
    // Click candy onto the sack (left: all that fits; right: one)
    clickW(37);
    expect(idOf(p.cursor)).toBe('candy');
    clickW(36, 1);
    expect(p.cursor?.count).toBe(19);
    expect(sackContents(p.inventory.get(0)).counts.regular).toBe(41);
    clickW(36);
    expect(p.cursor).toBeNull();
    expect(sackContents(p.inventory.get(0)).counts.regular).toBe(60);
    // The sack on the cursor onto candy
    clickW(36);
    expect(idOf(p.cursor)).toBe(SACK_ID);
    clickW(38);
    expect(p.inventory.get(2)).toBeNull();
    expect(sackContents(p.cursor).counts.king).toBe(2);
    clickW(36);
    expect(total(candyOf(p))).toBe(start);
    // Shift-click, number-key swaps and drags move it whole
    clickW(36, 0, 'quick');
    expect(p.inventory.get(0)).toBeNull();
    const at = [...Array(41).keys()].find((i) => idOf(p.inventory.get(i)) === SACK_ID)!;
    expect(sackTotal(sackContents(p.inventory.get(at)))).toBe(start);
    clickW(at >= 9 && at < 36 ? at : 36 + at, 4, 'swap');
    expect(idOf(p.inventory.get(4))).toBe(SACK_ID);
    expect(total(candyOf(p))).toBe(start);
    // Creative middle-click cloning gives an empty sack, never a copy of the candy
    p.setGamemode('creative');
    clickW(40, 2, 'clone');
    expect(idOf(p.cursor)).toBe(SACK_ID);
    expect(sackTotal(sackContents(p.cursor))).toBe(0);
    p.cursor = null;
    p.setGamemode('survival');
    // Into a chest and out again
    const cx = Math.floor(p.x) + 1;
    const cy = Math.floor(p.y);
    const cz = Math.floor(p.z);
    p.dim.setBlock(cx, cy, cz, S('chest'));
    ct.openChest(p, p.dim, cx, cy, cz);
    const w = ct.windowOf(p);
    const sackSlot = 27 + 27 + 4; // the chest's 27, the main inventory's 27, then hotbar slot 4
    clickW(sackSlot, 0, 'quick', w.id);
    expect(p.inventory.get(4)).toBeNull();
    expect(total(candyOf(p))).toBe(0);
    // Bob opens the same chest at once and takes it; Ann's click on the empty slot does nothing
    ct.openChest(b.player, p.dim, cx, cy, cz);
    const wb = ct.windowOf(b.player);
    const inChest = [...Array(27).keys()].find((i) => idOf(wb.slots[i]!.get()) === SACK_ID)!;
    server.handle(b.conn, { t: 'click', window: wb.id, slot: inChest, button: 0, mode: 'quick', seq: 1 });
    clickW(inChest, 0, 'quick', w.id);
    expect(total(candyOf(b.player))).toBe(start);
    expect(total(candyOf(p))).toBe(0);
    server.interaction.closeWindow(p, w.id);
    server.interaction.closeWindow(b.player, wb.id);
    // Handed over: Bob drops it, Ann picks it up
    const bs = [...Array(41).keys()].find((i) => idOf(b.player.inventory.get(i)) === SACK_ID)!;
    b.player.selectedSlot = bs < 9 ? bs : 0;
    if (bs >= 9) {
      b.player.inventory.set(0, b.player.inventory.get(bs));
      b.player.inventory.set(bs, null);
    }
    server.interaction.dropHeld(b.player, false);
    const dropped = [...p.dim.entities.values()].find((e) => e instanceof ItemEntity && idOf(e.stack) === SACK_ID) as ItemEntity;
    expect(sackTotal(sackContents(dropped.stack))).toBe(start);
    dropped.pickupDelay = 0;
    dropped.owner = null;
    dropped.setPos(p.x, p.y, p.z);
    for (let i = 0; i < 40 && !dropped.removed; i++) tick(server, 1);
    expect(dropped.removed).toBe(true);
    expect(total(candyOf(p))).toBe(start);
    // Saved with the player and read back
    await server.disconnect(a.conn);
    await server.saveAll();
    await server.stop();
    const again = await makeServer({}, storage, { clock: () => BEFORE });
    const back = await join(again.server, 'Ann', 'uuid-ann');
    expect(total(candyOf(back.player))).toBe(start);
    // A death drops it whole
    again.server.interaction.survival.damage(back.player, 100, { source: 'kill' });
    const onGround = [...back.player.dim.entities.values()].filter((e) => e instanceof ItemEntity && idOf(e.stack) === SACK_ID) as ItemEntity[];
    expect(onGround).toHaveLength(1);
    expect(sackTotal(sackContents(onGround[0]!.stack))).toBe(start);
    await again.server.stop();
  }, 120000);

  it('the window: take out only what fits, eat one, put every candy in; the server checks it all', async () => {
    const { server } = await makeServer({ seed: 'v7-sack-ui' }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn, player: p } = await join(server, 'Ann', 'uuid-ann');
    p.inventory.set(0, sackWith({ regular: 10, big: 3, poisoned: 1 }));
    p.inventory.set(5, stackOf('candy', 5));
    p.inventory.set(6, stackOf('big_candy', 2));
    const send = (m: Record<string, unknown>): void => server.handle(conn, { t: 'sack', slot: 0, ...m });
    send({ op: 'take', kind: 'regular', n: 4 });
    expect(sackContents(p.inventory.get(0)).counts.regular).toBe(6);
    expect(p.inventory.count(num('candy'))).toBe(9);
    // More than there are: what there is
    send({ op: 'take', kind: 'big', n: 50 });
    expect(sackContents(p.inventory.get(0)).counts.big).toBe(0);
    expect(p.inventory.count(num('big_candy'))).toBe(5);
    // Eating one straight from it (at full hunger, like any candy)
    p.food = 20;
    send({ op: 'eat', kind: 'regular' });
    expect(sackContents(p.inventory.get(0)).counts.regular).toBe(5);
    expect([...p.effects.keys()].some((id) => ['speed', 'jump_boost', 'haste'].includes(id))).toBe(true);
    // Every candy carried, in
    send({ op: 'fill' });
    expect(p.inventory.count(num('candy'))).toBe(0);
    expect(p.inventory.count(num('big_candy'))).toBe(0);
    expect(sackContents(p.inventory.get(0)).counts).toEqual({ regular: 14, big: 5, king: 0, poisoned: 1 });
    // A full inventory: nothing comes out, nothing is lost
    for (let i = 1; i < 36; i++) p.inventory.set(i, stackOf('cobblestone', 64));
    send({ op: 'take', kind: 'regular', n: 5 });
    expect(sackContents(p.inventory.get(0)).counts.regular).toBe(14);
    expect(speech(conn)).toContain('No room in your inventory.');
    // Malformed or pointless requests change nothing
    expect(validateC2S({ t: 'sack', slot: 0, op: 'take', kind: 'caramel' })).toBeNull();
    expect(validateC2S({ t: 'sack', slot: 37, op: 'fill' })).toBeNull();
    expect(validateC2S({ t: 'sack', slot: 0, op: 'take', kind: 'big', n: 999 })).toBeNull();
    server.handle(conn, { t: 'sack', slot: 7, op: 'eat', kind: 'big' });
    expect(sackTotal(sackContents(p.inventory.get(0)))).toBe(20);
    await server.stop();
  });

  it('candy given goes straight in; when it is full: "Your sack is full!", then the inventory, then the ground', async () => {
    const { server } = await makeServer({ seed: 'v7-sack-full' }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn, player: p } = await join(server, 'Ann', 'uuid-ann');
    p.inventory.set(0, sackWith({ regular: 126 }));
    const r = server.candy!.award(p, ['big', 'big', 'king', 'regular'], false);
    expect(r).toEqual({ inSack: 2, inInventory: 2, dropped: 0 });
    expect(sackTotal(sackContents(p.inventory.get(0)))).toBe(128);
    expect(speech(conn)).toContain('Your sack is full!');
    for (let i = 1; i < 36; i++) p.inventory.set(i, stackOf('cobblestone', 64));
    const before = [...p.dim.entities.values()].filter((e) => e instanceof ItemEntity).length;
    const r2 = server.candy!.award(p, ['poisoned', 'poisoned'], false);
    expect(r2.dropped).toBe(2);
    const drops = [...p.dim.entities.values()].filter((e) => e instanceof ItemEntity) as ItemEntity[];
    expect(drops.length).toBe(before + 1);
    const d = drops[drops.length - 1]!;
    expect(idOf(d.stack)).toBe('poisoned_candy');
    expect(Math.hypot(d.x - p.x, d.z - p.z)).toBeLessThan(1);
    await server.stop();
  });
});

// ---------------------------------------------------------------------------
describe('candy', () => {
  it('four candies, eaten like food at any hunger; Candy Homes give them at the stated odds', () => {
    for (const k of CANDY_KINDS) {
      const it = itemById.get(CANDY_ITEM[k])!;
      expect(it.def.food?.alwaysEdible).toBe(true);
      expect(it.def.food?.special).toBe('candy');
    }
    expect(CANDY_KINDS.reduce((a, k) => a + CANDY_HOME_ODDS[k], 0)).toBe(100);
    expect(CANDY_HOME_ODDS).toEqual({ regular: 62, big: 25, king: 5, poisoned: 8 });
    expect(CANDY_HOME_COUNT.reduce((a, c) => a + c.weight, 0)).toBe(100);
    const rng = new Random(2026);
    const seen: Record<CandyKind, number> = { regular: 0, big: 0, king: 0, poisoned: 0 };
    let handfuls = 0;
    let n = 0;
    for (let i = 0; i < 40000; i++) {
      const h = rollCandyHome(rng);
      expect(h.length).toBeGreaterThanOrEqual(1);
      expect(h.length).toBeLessThanOrEqual(3);
      handfuls++;
      for (const k of h) {
        seen[k]++;
        n++;
      }
    }
    for (const k of CANDY_KINDS) expect(Math.abs(seen[k] / n - CANDY_HOME_ODDS[k] / 100), k).toBeLessThan(0.01);
    expect(n / handfuls).toBeCloseTo(1.8, 1);
  });

  it('each does what it says: a mild buff, two buffs, something powerful, or sickness that never kills from full health', () => {
    const rng = new Random(7);
    const king = { buffs: 0, enchant: 0, payout: 0 };
    for (let i = 0; i < 6000; i++) {
      const r = rollBite('regular', rng);
      expect(r.effects).toHaveLength(1);
      expect(REGULAR_BUFFS.map((e) => e.id)).toContain(r.effects[0]!.id);
      const b = rollBite('big', rng);
      expect(b.effects).toHaveLength(2);
      expect(b.effects[0]!.id).not.toBe(b.effects[1]!.id);
      for (const e of b.effects) expect(BIG_BUFFS.map((x) => x.id)).toContain(e.id);
      const k = rollBite('king', rng);
      if (k.enchant) king.enchant++;
      else if (k.payout) {
        king.payout++;
        expect(['gold_ingot', 'diamond']).toContain(k.payout.item);
      } else king.buffs++;
      const p = rollBite('poisoned', rng);
      expect(p.damage + p.effects.length).toBeGreaterThan(0);
    }
    for (const o of KING_OUTCOMES) expect(Math.abs(king[o.kind] / 6000 - o.weight / 100), o.kind).toBeLessThan(0.03);
    expect(POISON_OUTCOMES.every((o) => o.effects.every((e) => ['poison', 'wither', 'blindness', 'nausea'].includes(e.id)))).toBe(true);
    expect(poisonWorstCase()).toBeLessThan(20);
  });

  it('a Poisoned Candy, eaten at full health, never kills (every one of its outcomes, played out)', async () => {
    const { server } = await makeServer({ seed: 'v7-poison' }, new MemoryStorage(), { clock: () => BEFORE });
    const { player: p } = await join(server, 'Ann', 'uuid-ann');
    p.spawnProtection = 0;
    for (let o = 0; o < POISON_OUTCOMES.length; o++) {
      p.effects.clear();
      p.health = 20;
      // Force each outcome in turn
      const w = POISON_OUTCOMES.slice(0, o).reduce((a, b) => a + b.weight, 0);
      const all = POISON_OUTCOMES.reduce((a, b) => a + b.weight, 0);
      server.candy!.rng = { next: () => (w + 0.5) / all, int: () => 0 };
      server.candy!.eat(p, 'poisoned', false);
      let low = p.health;
      for (let i = 0; i < 400; i++) {
        tick(server, 1);
        low = Math.min(low, p.health);
      }
      expect(p.dead, `outcome ${o}`).toBe(false);
      expect(low, `outcome ${o}`).toBeGreaterThan(0);
      expect(low, `outcome ${o}`).toBeLessThan(20);
    }
    await server.stop();
  });

  it('effects refresh rather than stack', async () => {
    const { server } = await makeServer({ seed: 'v7-refresh' }, new MemoryStorage(), { clock: () => BEFORE });
    const { player: p } = await join(server, 'Ann', 'uuid-ann');
    server.candy!.rng = { next: () => 0, int: () => 0 };
    server.candy!.eat(p, 'regular', false);
    tick(server, 100);
    server.candy!.eat(p, 'regular', false);
    expect(p.effects.get('speed')).toEqual({ amp: 0, ticks: 400 });
    server.candy!.eat(p, 'regular', false);
    expect(p.effects.get('speed')).toEqual({ amp: 0, ticks: 400 });
    await server.stop();
  });

  it('a King-Sized Candy can pay out (cheat-made from a cheat candy) or enchant something for three minutes', async () => {
    const { server } = await makeServer({ seed: 'v7-king' }, new MemoryStorage(), { clock: () => BEFORE });
    const { player: p } = await join(server, 'Ann', 'uuid-ann');
    // payout: the third outcome
    server.candy!.rng = { next: () => 0.9, int: () => 0 };
    server.candy!.eat(p, 'king', true);
    const gold = [...Array(36).keys()].map((i) => p.inventory.get(i)).find((s) => idOf(s) === 'gold_ingot' || idOf(s) === 'diamond');
    expect(gold).toBeTruthy();
    expect(gold!.tag?.admin).toBe(true);
    await server.stop();
  });
});

// ---------------------------------------------------------------------------
describe('temporary enchantments', () => {
  it('stay within the normal limits and are gone after three minutes wherever the item is', async () => {
    const { server } = await makeServer({ seed: 'v7-temp' }, new MemoryStorage(), { clock: () => BEFORE });
    const { player: p } = await join(server, 'Ann', 'uuid-ann');
    const candy = server.candy!;
    // Three swords: one in hand, one dropped, one in a chest
    const results: string[] = [];
    for (let i = 0; i < 60; i++) {
      p.selectedSlot = 0;
      p.inventory.set(0, { id: num('iron_sword'), count: 1, tag: { ench: { sharpness: 4 } } });
      candy.rng = new Random(i);
      const r = candy.enchantSomething(p);
      expect(r).toBeTruthy();
      const st = p.inventory.get(0)!;
      const t = activeTemp(st)!;
      const def = ENCHANT_BY_ID.get(t.id)!;
      expect(t.lvl).toBeLessThanOrEqual(def.maxLevel);
      expect(def.curse ?? false).toBe(false);
      // Never one that conflicts with Sharpness (Smite, Bane...), and Sharpness only above IV
      if (t.id === 'sharpness') expect(t.lvl).toBe(5);
      expect(['smite', 'bane_of_arthropods', 'glitchbane']).not.toContain(t.id);
      expect(t.until - server.level.time).toBe(TEMP_ENCHANT_TICKS);
      results.push(t.id);
    }
    expect(new Set(results).size).toBeGreaterThan(2);
    // In hand: a temporary Looting II on a sword
    p.inventory.set(0, { id: num('iron_sword'), count: 1, tag: { temp: { id: 'looting', lvl: 2, until: server.level.time + TEMP_ENCHANT_TICKS } } });
    p.inventory.set(1, { id: num('iron_sword'), count: 1, tag: { temp: { id: 'looting', lvl: 2, until: server.level.time + TEMP_ENCHANT_TICKS } } });
    expect(enchantLevel(p.inventory.get(0), 'looting')).toBe(2);
    // ...one dropped on the ground, one in a chest
    p.selectedSlot = 1;
    server.interaction.dropHeld(p, false);
    const ground = [...p.dim.entities.values()].find((e) => e instanceof ItemEntity && idOf(e.stack) === 'iron_sword') as ItemEntity;
    expect(ground.meta().ench).toBe(true);
    const chestSword: ItemStack = { id: num('iron_sword'), count: 1, tag: { temp: { id: 'looting', lvl: 2, until: server.level.time + TEMP_ENCHANT_TICKS } } };
    tick(server, TEMP_ENCHANT_TICKS + 25);
    expect(enchantLevel(p.inventory.get(0), 'looting')).toBe(0);
    expect(p.inventory.get(0)!.tag?.temp).toBeUndefined();
    expect(ground.stack.tag?.temp).toBeUndefined();
    expect(ground.meta().ench).toBe(false);
    // Wherever it was, the clock says it is over even before anything clears it
    expect(enchantLevel(chestSword, 'looting')).toBe(0);
    // A claim of lasting longer than a candy's enchantment is never honoured (never permanent)
    expect(activeTemp({ id: num('iron_sword'), count: 1, tag: { temp: { id: 'looting', lvl: 2, until: server.level.time + 10 * TEMP_ENCHANT_TICKS } } })).toBeNull();
    // A real enchantment it conflicts with, or the same one as high, replaces it
    const s2 = tidyTemp({ id: num('iron_sword'), count: 1, tag: { ench: { sharpness: 1 }, temp: { id: 'smite', lvl: 2, until: server.level.time + 100 } } });
    expect(s2.tag?.temp).toBeUndefined();
    await server.stop();
    setTempClock(0);
  }, 60000);
});

// ---------------------------------------------------------------------------
describe('knocking and Candy Homes', () => {
  let world: Awaited<ReturnType<typeof trickWorld>>;
  beforeAll(async () => {
    world = await trickWorld();
  }, 240000);

  it('every door of a Trick-or-Treat Village is offered for knocking while Halloween is on', async () => {
    const { server, doors } = world;
    const { conn, player } = await join(server, 'Ann', 'uuid-ann');
    atDoor(player, doors[0]!.door);
    tick(server, 12);
    const list = conn.last('knock_doors')!.doors;
    expect(list.some(([x, y, z]) => x === doors[0]!.door.x && y === doors[0]!.door.y && z === doors[0]!.door.z)).toBe(true);
    // Away from the village: none
    player.setPos(player.x + 400, player.y, player.z);
    tick(server, 12);
    expect(conn.last('knock_doors')!.doors).toEqual([]);
  });

  it('wants a costume and a sack with room, and says so (several ways)', async () => {
    const { server, doors } = world;
    const candyDoor = doors.find((d) => d.door.kind === 'candy')!.door;
    const { conn, player } = await join(server, 'Cat', 'uuid-cat');
    atDoor(player, candyDoor);
    dress(player, stackOf(SACK_ID), '');
    knock(server, conn, candyDoor);
    expect(NO_COSTUME_LINES).toContain(speech(conn).pop());
    dress(player, null);
    knock(server, conn, candyDoor);
    expect(NO_SACK_LINES).toContain(speech(conn).pop());
    dress(player, sackWith({ regular: 128 }));
    knock(server, conn, candyDoor);
    expect(FULL_SACK_LINES).toContain(speech(conn).pop());
    expect(candyDoor.got ?? []).not.toContain(player.uuid);
    // Several lines for each
    expect(NO_COSTUME_LINES.length).toBeGreaterThan(1);
    expect(NO_SACK_LINES.length).toBeGreaterThan(1);
    expect(FULL_SACK_LINES.length).toBeGreaterThan(1);
    // Right-clicking the door still just opens it
    const st = player.dim.getState(candyDoor.x, candyDoor.y, candyDoor.z);
    server.interaction.handleUseOn(player, { t: 'use_on', x: candyDoor.x, y: candyDoor.y, z: candyDoor.z, face: 2, hx: 0.5, hy: 0.5, hz: 0.5, hand: 0, yaw: player.yaw, pitch: 0, seq: 1 });
    expect(getProp(player.dim.getState(candyDoor.x, candyDoor.y, candyDoor.z), 'open')).not.toBe(getProp(st, 'open'));
    server.interaction.handleUseOn(player, { t: 'use_on', x: candyDoor.x, y: candyDoor.y, z: candyDoor.z, face: 2, hx: 0.5, hy: 0.5, hz: 0.5, hand: 0, yaw: player.yaw, pitch: 0, seq: 2 });
  });

  it('a Candy Home answers: the candy straight into the sack, once, skipped or not; again: "You already got candy here!"', async () => {
    const { server, doors } = world;
    const candyDoor = doors.find((d) => d.door.kind === 'candy')!.door;
    const { conn, player } = await join(server, 'Dan', 'uuid-dan');
    atDoor(player, candyDoor);
    dress(player);
    knock(server, conn, candyDoor);
    const got = total(candyOf(player));
    expect(got).toBeGreaterThanOrEqual(1);
    expect(got).toBeLessThanOrEqual(3);
    expect(sackTotal(sackContents(player.inventory.get(0)))).toBe(got);
    expect(candyDoor.got).toContain(player.uuid);
    const look = conn.of('fx').find((m) => m.kind === 'scene' && m.text === 'look')!;
    expect(look.skip).toBe(true);
    // Skipped at once: the door shuts, nothing more is given
    server.handle(conn, { t: 'scene_skip' });
    expect(conn.of('fx').filter((m) => m.kind === 'scene' && m.text === 'end')).toHaveLength(1);
    tick(server, CANDY_TIMES.end + 10);
    expect(total(candyOf(player))).toBe(got);
    expect(candyDoor.got!.filter((u) => u === player.uuid)).toHaveLength(1);
    knock(server, conn, candyDoor);
    expect(ALREADY_LINES).toContain(speech(conn).pop());
    expect(total(candyOf(player))).toBe(got);
    // Real candy, and the advancement
    expect(sackContents(player.inventory.get(0)).cheat).toEqual({ regular: 0, big: 0, king: 0, poisoned: 0 });
    expect(player.achievements.has('first_candy')).toBe(true);
    expect(player.halloween.candy).toBe(got);
  });

  it('the whole answer, unskipped: the door opens, a villager in a costume says hello and goodbye, the door shuts', async () => {
    const { server, doors } = world;
    const candyDoor = doors.filter((d) => d.door.kind === 'candy')[1]?.door ?? doors.find((d) => d.door.kind === 'candy')!.door;
    const { conn, player } = await join(server, 'Eve', 'uuid-eve');
    const other = await join(server, 'Fay', 'uuid-fay');
    atDoor(player, candyDoor);
    other.player.setPos(player.x + 2, player.y, player.z + 2);
    dress(player);
    // Someone who lives there, standing right behind the door
    const box = server.trickOrTreat!.house(player.dim, candyDoor)!;
    const [cx, cy, cz] = box.cells[0]!;
    const resident = server.mobs!.spawn(player.dim, 'villager', cx + 0.5, cy, cz + 0.5, { reason: 'event' })!;
    knock(server, conn, candyDoor);
    // ...steps back into the house, so whoever answers stands in the doorway alone
    const fromDoor = (): number => Math.hypot(resident.x - (candyDoor.x + 0.5), resident.z - (candyDoor.z + 0.5));
    expect(fromDoor()).toBeGreaterThanOrEqual(2.2);
    expect(TrickOrTreatSystem.inHouse(box, resident.x, resident.y, resident.z)).toBe(true);
    const got = total(candyOf(player));
    tick(server, CANDY_TIMES.greet + 2);
    const v = [...player.dim.entities.values()].find((e) => e instanceof Mob && e.data.trickScene) as Mob;
    expect(v).toBeTruthy();
    expect(v.type).toBe('villager');
    expect(v.meta().headwear).toBeTruthy();
    expect(getProp(player.dim.getState(candyDoor.x, candyDoor.y, candyDoor.z), 'open')).toBe('true');
    expect(fromDoor()).toBeGreaterThanOrEqual(2);
    resident.remove();
    // Others nearby see the villager and the door, not the knocker's camera
    expect(other.conn.of('fx').some((m) => m.kind === 'scene')).toBe(false);
    tick(server, CANDY_TIMES.end);
    expect(v.removed).toBe(true);
    expect(getProp(player.dim.getState(candyDoor.x, candyDoor.y, candyDoor.z), 'open')).toBe('false');
    expect(speech(conn).filter((t) => t.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(total(candyOf(player))).toBe(got);
    expect(conn.of('fx').some((m) => m.kind === 'scene' && m.text === 'end')).toBe(true);
  });

  it('a knock and a disconnect at once: the candy was given once, and it is saved', async () => {
    const storage = new MemoryStorage();
    const w2 = await trickWorld({ now: BEFORE }, storage);
    const candyDoor = w2.doors.find((d) => d.door.kind === 'candy')!.door;
    const { conn, player } = await join(w2.server, 'Gus', 'uuid-gus');
    atDoor(player, candyDoor);
    dress(player);
    knock(w2.server, conn, candyDoor);
    const got = total(candyOf(player));
    await w2.server.disconnect(conn);
    tick(w2.server, CANDY_TIMES.end + 5);
    await w2.server.saveAll();
    await w2.server.stop();
    const { server } = await makeServer({}, storage, { clock: () => BEFORE });
    const back = await join(server, 'Gus', 'uuid-gus');
    expect(total(candyOf(back.player))).toBe(got);
    const rec = Object.values(server.level.villages).find((r) => r.kind === 'trick')!;
    expect(rec.doors.find((d) => d.id === candyDoor.id)!.got).toEqual(['uuid-gus']);
    await server.stop();
  }, 240000);
});

// ---------------------------------------------------------------------------
describe('Trick Homes', () => {
  let world: Awaited<ReturnType<typeof trickWorld>>;
  beforeAll(async () => {
    world = await trickWorld();
    world.server.level.difficulty = 'peaceful';
  }, 240000);

  it('the encounter is fixed by the door, from a list, Herobrine one in a hundred', () => {
    expect(TRICK_KINDS.reduce((a, k) => a + TRICK_ODDS[k], 0)).toBe(100);
    expect(TRICK_ODDS.herobrine).toBe(1);
    const n = 200000;
    const seen: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const k = trickKindFor(Math.imul(i, 2654435761) >>> 0);
      seen[k] = (seen[k] ?? 0) + 1;
    }
    for (const k of TRICK_KINDS) expect(Math.abs((seen[k] ?? 0) / n - TRICK_ODDS[k] / 100), k).toBeLessThan(0.004);
    expect(trickKindFor(12345)).toBe(trickKindFor(12345));
    for (const k of TRICK_KINDS) expect(TRICK_ENCOUNTERS[k].mobs[0]).toBe(TRICK_ENCOUNTERS[k].grab);
    expect(TRICK_ENCOUNTERS.witch.mobs).toContain('witch');
  });

  it('knock: dragged inside, the door slams; its monsters keep to the house and drop nothing; leaving ends it, to be tried again', async () => {
    const { server, doors } = world;
    const ref = doors.find((d) => d.door.kind === 'trick')!;
    const d = ref.door;
    const { conn, player } = await join(server, 'Ann', 'uuid-ann2');
    atDoor(player, d);
    dress(player);
    // Someone lives there, just inside the door
    const box = server.trickOrTreat!.house(player.dim, d)!;
    const [cx, cy, cz] = box.cells[0]!;
    const resident = server.mobs!.spawn(player.dim, 'villager', cx + 0.5, cy, cz + 0.5, { reason: 'event' })!;
    expect(TrickOrTreatSystem.inHouse(box, resident.x, resident.y, resident.z)).toBe(true);
    const [fx, fz] = ({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] } as const)[d.facing];
    const outOfTheWay = (): boolean => !TrickOrTreatSystem.inHouse(box, resident.x, resident.y, resident.z, 0.3) && (resident.x - (d.x + 0.5)) * fx + (resident.z - (d.z + 0.5)) * fz > 2;
    knock(server, conn, d);
    // ...and is out of the way at once: behind whoever knocked, out of sight of the door
    expect(outOfTheWay()).toBe(true);
    expect(conn.of('fx').some((m) => m.kind === 'scene')).toBe(false);
    tick(server, TRICK_TIMES.grab + 1);
    expect(conn.of('fx').some((m) => m.kind === 'scene' && m.text === 'grab')).toBe(true);
    tick(server, TRICK_TIMES.drag - TRICK_TIMES.grab);
    expect(conn.of('fx').some((m) => m.kind === 'scene' && m.text === 'drag')).toBe(true);
    tick(server, TRICK_TIMES.slam - TRICK_TIMES.drag + 1);
    const run = server.trickOrTreat!.runAt(ref).trick!;
    expect(run.phase).toBe('fight');
    expect(TrickOrTreatSystem.inHouse(run.box, player.x, player.y, player.z)).toBe(true);
    expect(getProp(player.dim.getState(d.x, d.y, d.z), 'open')).toBe('false');
    // (and stayed out while the door stood open)
    expect(TrickOrTreatSystem.inHouse(box, resident.x, resident.y, resident.z, 0.3)).toBe(false);
    resident.remove();
    const mobs = run.mobs;
    expect(mobs.map((m) => m.type)).toEqual(TRICK_ENCOUNTERS[run.kind].mobs.slice());
    for (const m of mobs) {
      expect(m.data.noDrops).toBe(true);
      expect(m.persistent).toBe(false);
    }
    // Someone else knocking now hears the fight, and is not dragged in
    const b = await join(server, 'Bob', 'uuid-bob2');
    atDoor(b.player, d);
    dress(b.player);
    knock(server, b.conn, d);
    expect(FIGHT_LINES).toContain(speech(b.conn).pop());
    // The door opened wide: still nothing gets out
    server.interaction.handleUseOn(player, { t: 'use_on', x: d.x, y: d.y, z: d.z, face: 2, hx: 0.5, hy: 0.5, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: 1 });
    for (let i = 0; i < 200; i++) {
      tick(server, 1);
      for (const m of mobs) if (!m.removed) expect(TrickOrTreatSystem.inHouse(run.box, m.x, m.y, m.z, 0.5), m.type).toBe(true);
    }
    // Out of the door and away: it ends, its monsters go, nothing is used up
    player.setPos(d.out[0] + 0.5, d.out[1], d.out[2] + 0.5);
    tick(server, TRICK_EMPTY_TICKS + 2);
    expect(server.trickOrTreat!.runAt(ref).trick).toBeUndefined();
    for (const m of mobs) expect(m.removed).toBe(true);
    expect(d.used).toBe(false);
    // ...and it can be tried again
    knock(server, conn, d);
    tick(server, TRICK_TIMES.slam + 2);
    expect(server.trickOrTreat!.runAt(ref).trick?.phase).toBe('fight');
    // Dying in there ends it too
    server.interaction.survival.damage(player, 100, { source: 'kill' });
    tick(server, TRICK_EMPTY_TICKS + 2);
    expect(server.trickOrTreat!.runAt(ref).trick).toBeUndefined();
    expect(d.used).toBe(false);
    server.interaction.respawn(player);
  }, 60000);

  it('beaten: a chest appears and is looted once, for everyone; the door is empty after that', async () => {
    const { server, doors } = world;
    const ref = doors.filter((d) => d.door.kind === 'trick')[1] ?? doors.find((d) => d.door.kind === 'trick')!;
    const d = ref.door;
    const { conn, player } = await join(server, 'Cid', 'uuid-cid');
    const friend = await join(server, 'Dee', 'uuid-dee');
    atDoor(player, d);
    dress(player);
    knock(server, conn, d);
    tick(server, TRICK_TIMES.slam + 2);
    const run = server.trickOrTreat!.runAt(ref).trick!;
    // A friend follows them inside
    friend.player.setPos(run.landing[0], run.landing[1], run.landing[2]);
    tick(server, 2);
    expect(run.party.has(friend.player)).toBe(true);
    // (items in the house only: elsewhere the world goes on, chickens lay and leaves drop saplings)
    const loose = (): number => [...player.dim.entities.values()].filter((e) => e instanceof ItemEntity && TrickOrTreatSystem.inHouse(run.box, e.x, e.y, e.z, 1)).length;
    const before = loose();
    for (const m of run.mobs) m.hurt(1000, { source: 'player', attacker: player } as never);
    tick(server, 3);
    expect(run.phase).toBe('won');
    expect(d.used).toBe(true);
    // Nothing dropped by them
    expect(loose()).toBe(before);
    // The chest, rolled from the Trick Home table
    const chest = run.box.cells.find(([x, y, z]) => blocks[STATE_BLOCK[player.dim.getState(x, y, z)]!]!.id === 'chest')!;
    expect(chest).toBeTruthy();
    const inv = server.interaction.containers.containerAt(player.dim, chest[0], chest[1], chest[2], 27, 'chest');
    const ids = inv.slots.filter(Boolean).map((s) => idOf(s));
    expect(ids).toContain('candy');
    expect(ids.some((id) => id === 'big_candy' || id === 'king_sized_candy')).toBe(true);
    for (const s of inv.slots) if (s) expect(s.tag?.admin).toBeUndefined();
    expect(player.achievements.has('beat_trick_home')).toBe(true);
    expect(friend.player.achievements.has('beat_trick_home')).toBe(true);
    tick(server, 50);
    atDoor(player, d);
    knock(server, conn, d);
    expect(EMPTY_LINES).toContain(speech(conn).pop());
  }, 60000);

  it('Herobrine (from the Admin Panel): a short fight, his own loot, never his head, nothing counted', async () => {
    const { server, doors } = world;
    const ref = doors.filter((d) => d.door.kind === 'trick').pop()!;
    server.level.cheats = true;
    const { conn, player } = await join(server, 'Op', 'uuid-op');
    player.setPos(ref.door.out[0] + 0.5, ref.door.out[1], ref.door.out[2] + 0.5);
    const r = admin(server, conn, { a: 'halloween', op: 'trick', trick: 'herobrine' });
    expect(r.ok, r.text).toBe(true);
    tick(server, TRICK_TIMES.slam + 2);
    const run = server.trickOrTreat!.runAt(ref).trick!;
    expect(run.kind).toBe('herobrine');
    const hb = run.mobs[0]!;
    expect(hb.type).toBe('herobrine');
    expect(hb.maxHealth).toBe(TRICK_HEROBRINE.health);
    // Not the boss fight
    expect(server.herobrine!.fights.fight).toBeNull();
    tick(server, 120);
    expect(server.herobrine!.fights.fight).toBeNull();
    hb.hurt(1000, { source: 'player', attacker: player } as never);
    tick(server, 3);
    expect(run.phase).toBe('won');
    // The panel's run never uses up the real door, and its chest is cheat-made
    expect(ref.door.used).toBe(false);
    const chest = run.box.cells.find(([x, y, z]) => blocks[STATE_BLOCK[player.dim.getState(x, y, z)]!]!.id === 'chest')!;
    const inv = server.interaction.containers.containerAt(player.dim, chest[0], chest[1], chest[2], 27, 'chest');
    const got = inv.slots.filter(Boolean) as ItemStack[];
    expect(got.some((s) => s.tag?.name === "Herobrine's Pickaxe")).toBe(true);
    expect(got.some((s) => idOf(s) === 'herobrine_head')).toBe(false);
    for (const s of got) expect(s.tag?.admin).toBe(true);
    expect(player.achievements.has('herobrine_trick')).toBe(false);
  }, 60000);

  it('the loot tables: real items, candy in each, better with Herobrine, never the head', () => {
    for (const t of ['trick_home', 'trick_home_herobrine']) {
      for (const p of LOOT_TABLES[t]!.pools) for (const e of p.entries) if (e.item) expect(itemById.has(e.item), `${t}: ${e.item}`).toBe(true);
      expect(JSON.stringify(LOOT_TABLES[t])).not.toContain('herobrine_head');
    }
    const rng = new Random(11);
    let diamonds = 0;
    for (let i = 0; i < 500; i++) {
      const got = rollLoot('trick_home', { rng }).map((s) => idOf(s));
      expect(got).toContain('candy');
      expect(got.some((id) => id === 'big_candy' || id === 'king_sized_candy')).toBe(true);
      if (got.includes('diamond')) diamonds++;
    }
    // Occasionally something great
    expect(diamonds).toBeGreaterThan(10);
    expect(diamonds).toBeLessThan(100);
    const hb = rollLoot('trick_home_herobrine', { rng }).map((s) => idOf(s));
    expect(hb).toContain('diamond');
    expect(hb).toContain('king_sized_candy');
    expect(JSON.stringify(Object.values(LOOT_TABLES))).not.toContain('herobrine_head');
  });
});

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: unknown } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}

// ---------------------------------------------------------------------------
describe('the Herobrine Head', () => {
  it('only from a real defeat of Herobrine: never the creative menu, /give, the Admin Panel, or a cheat-placed block', async () => {
    const { server } = await makeServer({ seed: 'v7-head', cheats: true }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn, player } = await join(server, 'Op', 'uuid-op');
    expect(itemById.get('herobrine_head')!.def.creative).toBe('hidden');
    const r = server.admin.give(player, 'herobrine_head', 1);
    expect(r.ok).toBe(false);
    server.handle(conn, { t: 'chat', text: '/give herobrine_head' });
    tick(server, 1);
    expect([...Array(41).keys()].some((i) => idOf(player.inventory.get(i)) === 'herobrine_head')).toBe(false);
    // Creative: not out of nothing
    player.setGamemode('creative');
    server.handle(conn, { t: 'creative_set', slot: 36, item: { id: num('herobrine_head'), count: 1 } });
    expect(player.inventory.get(0)).toBeNull();
    server.handle(conn, { t: 'creative_pick', item: { id: num('herobrine_head'), count: 1 } });
    expect([...Array(41).keys()].some((i) => idOf(player.inventory.get(i)) === 'herobrine_head')).toBe(false);
    player.setGamemode('survival');
    // A cheat-placed one breaks into nothing
    const x = Math.floor(player.x) + 2;
    const y = Math.floor(player.y);
    const z = Math.floor(player.z);
    const { stateOf } = await import('../../src/common/registry/blocks');
    player.dim.setBlock(x, y - 1, z, stateOf('stone'));
    player.dim.setBlock(x, y, z, stateOf('herobrine_head', { facing: 'north' }));
    server.admin.setBlockMark(player.dim, x, y, z, true);
    server.mining.dropBlock(player.dim, x, y, z, player.dim.getState(x, y, z));
    expect([...player.dim.entities.values()].some((e) => e instanceof ItemEntity && idOf(e.stack) === 'herobrine_head')).toBe(false);
    await server.stop();
  });

  it('drops at the arena when Herobrine is beaten for real (and not when the fight was a cheat)', async () => {
    for (const cheat of [false, true]) {
      const { server } = await makeServer({ seed: 'v7-head-drop' }, new MemoryStorage(), { clock: () => BEFORE });
      const { player } = await join(server, 'Ann', 'uuid-ann');
      const hb = server.herobrine!;
      const f = hb.fights.startFinal(player.dim, { x: Math.floor(player.x), y: Math.floor(player.y), z: Math.floor(player.z), r: 20 }, { x: Math.floor(player.x) + 4, y: Math.floor(player.y), z: Math.floor(player.z) }, [], null, cheat);
      const boss = server.mobs!.spawn(player.dim, 'herobrine', player.x + 3, player.y, player.z, { reason: 'boss' })!;
      boss.noAi = true;
      f.boss = boss;
      f.state = 'fight';
      (hb as unknown as { onFinalDefeated(f: unknown): void }).onFinalDefeated(f);
      const heads = [...player.dim.entities.values()].filter((e) => e instanceof ItemEntity && idOf(e.stack) === 'herobrine_head');
      expect(heads.length, cheat ? 'cheat fight' : 'real fight').toBe(cheat ? 0 : 1);
      if (!cheat) {
        expect(Math.hypot(heads[0]!.x - boss.x, heads[0]!.z - boss.z)).toBeLessThan(1);
        expect((heads[0] as ItemEntity).stack.tag?.admin).toBeUndefined();
        // Not picked up before the hall comes down: it goes to the player
        (hb as unknown as { handOverHead(): void }).handOverHead();
        expect(heads[0]!.removed).toBe(true);
        expect([...Array(41).keys()].some((i) => idOf(player.inventory.get(i)) === 'herobrine_head')).toBe(true);
      }
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
describe('the Trick or Treat! quest', () => {
  it('six steps, each read off the real game (cheat items do not count), saved with the player', async () => {
    const storage = new MemoryStorage();
    const w = await trickWorld({ now: BEFORE }, storage);
    const { server, doors } = w;
    const { conn, player: p } = await join(server, 'Ann', 'uuid-annq');
    expect(QUEST_STEPS.map((s) => s.id)).toEqual(['sack', 'costume', 'wear', 'village', 'knock', 'candy']);
    tick(server, 12);
    expect(conn.last('quest')!.quest).toMatchObject({ title: 'Trick or Treat!', stage: 0, stages: 6 });
    // An Admin Panel sack does not count
    p.inventory.set(0, markAdmin(stackOf(SACK_ID)));
    tick(server, 12);
    expect(p.halloween.steps).toEqual([]);
    p.inventory.set(0, stackOf(SACK_ID));
    tick(server, 12);
    expect(p.halloween.steps).toEqual(['sack']);
    p.inventory.set(5, stackOf('zombie_head'));
    tick(server, 12);
    expect(p.halloween.steps).toEqual(['sack', 'costume']);
    p.inventory.set(39, p.inventory.get(5));
    p.inventory.set(5, null);
    tick(server, 12);
    expect(p.halloween.steps).toEqual(['sack', 'costume', 'wear']);
    // Walking into the village
    p.setPos(doors[0]!.door.out[0] + 0.5, doors[0]!.door.out[1], doors[0]!.door.out[2] + 0.5);
    tick(server, 45);
    expect(p.halloween.steps).toContain('village');
    // Knocking at Candy Homes until ten candies
    const candyDoors = doors.filter((d) => d.door.kind === 'candy').map((d) => d.door);
    let i = 0;
    while (p.halloween.candy < QUEST_CANDY && i < candyDoors.length) {
      const d = candyDoors[i++]!;
      atDoor(p, d);
      p.selectedSlot = 0;
      knock(server, conn, d);
      server.handle(conn, { t: 'scene_skip' });
      tick(server, 12);
    }
    if (p.halloween.candy < QUEST_CANDY) p.halloween.candy = QUEST_CANDY; // a small village: the count is what is tested here
    tick(server, 12);
    expect(p.halloween.steps).toEqual(['sack', 'costume', 'wear', 'village', 'knock', 'candy']);
    expect(p.halloween.done).toBe(true);
    expect(conn.of('title').some((m) => m.text === 'Trick or Treat!')).toBe(true);
    await server.disconnect(conn);
    await server.stop();
    const again = await makeServer({}, storage, { clock: () => BEFORE });
    const back = await join(again.server, 'Ann', 'uuid-annq');
    expect(back.player.halloween.done).toBe(true);
    expect(sanitizeProgress(JSON.parse(JSON.stringify(back.player.halloween)))).toEqual(back.player.halloween);
    await again.server.stop();
  }, 240000);
});

// ---------------------------------------------------------------------------
describe('the Admin Panel', () => {
  it('gives sacks (empty or full) and each candy, knocks, starts a Trick Home and resets doors: all cheat-made', async () => {
    expect(validateAdmin({ a: 'halloween', op: 'give_candy', candy: 'king' })).toEqual({ a: 'halloween', op: 'give_candy', candy: 'king' });
    expect(validateAdmin({ a: 'halloween', op: 'give_candy', candy: 'toffee' })).toBeNull();
    expect(validateAdmin({ a: 'halloween', op: 'trick', trick: 'herobrine' })).toEqual({ a: 'halloween', op: 'trick', trick: 'herobrine' });
    expect(validateAdmin({ a: 'halloween', op: 'trick', trick: 'dragon' })).toBeNull();
    expect(describeAdmin({ a: 'halloween', op: 'knock' })).toMatch(/knock/);
    const w = await trickWorld();
    const { server, doors } = w;
    server.level.cheats = true;
    const { conn, player } = await join(server, 'Op', 'uuid-op');
    let r = admin(server, conn, { a: 'halloween', op: 'give_full_sack' });
    expect(r.ok, r.text).toBe(true);
    const full = [...Array(36).keys()].map((i) => player.inventory.get(i)).find((s) => idOf(s) === SACK_ID)!;
    expect(sackTotal(sackContents(full))).toBe(128);
    expect(full.tag?.admin).toBe(true);
    for (const k of CANDY_KINDS) {
      r = admin(server, conn, { a: 'halloween', op: 'give_candy', candy: k });
      expect(r.ok).toBe(true);
    }
    for (const k of CANDY_KINDS) expect([...Array(36).keys()].map((i) => player.inventory.get(i)).find((s) => idOf(s) === CANDY_ITEM[k])?.tag?.admin).toBe(true);
    // Knocking with nothing on, no sack: it is answered anyway, and changes no real door
    player.inventory.clear();
    const candyDoor = doors.find((d) => d.door.kind === 'candy')!;
    player.setPos(candyDoor.door.out[0] + 0.5, candyDoor.door.out[1], candyDoor.door.out[2] + 0.5);
    const gotBefore = [...(candyDoor.door.got ?? [])];
    r = admin(server, conn, { a: 'halloween', op: 'knock' });
    expect(r.ok, r.text).toBe(true);
    tick(server, CANDY_TIMES.end + 30);
    expect(candyDoor.door.got ?? []).toEqual(gotBefore);
    expect(player.halloween.knocks).toBe(0);
    // Reset the doors
    candyDoor.door.got = ['someone'];
    candyDoor.door.used = true;
    r = admin(server, conn, { a: 'halloween', op: 'reset_doors' });
    expect(r.ok, r.text).toBe(true);
    expect(candyDoor.door.got).toBeUndefined();
    expect(candyDoor.door.used).toBe(false);
    await server.stop();
  }, 240000);
});

// ---------------------------------------------------------------------------
describe('after the season', () => {
  it('no knocking and no new candy (or sacks); the sack, candy and costumes people have keep working', async () => {
    const clock = { now: BEFORE };
    const w = await trickWorld(clock);
    const { server, doors } = w;
    const { conn, player: p } = await join(server, 'Ann', 'uuid-anna');
    const d = doors.find((x) => x.door.kind === 'candy')!.door;
    atDoor(p, d);
    dress(p, sackWith({ regular: 5, king: 1 }));
    clock.now = AFTER;
    tick(server, 25);
    expect(server.halloweenState().active).toBe(false);
    expect(conn.last('knock_doors')?.doors ?? []).toEqual([]);
    knock(server, conn, d);
    expect(OVER_LINES).toContain(speech(conn).pop());
    expect(total(candyOf(p))).toBe(6);
    // The sack still works, so does the candy, so does the costume
    server.handle(conn, { t: 'sack', slot: 0, op: 'take', kind: 'regular', n: 2 });
    expect(p.inventory.count(num('candy'))).toBe(2);
    server.handle(conn, { t: 'sack', slot: 0, op: 'eat', kind: 'king' });
    expect(sackContents(p.inventory.get(0)).counts.king).toBe(0);
    expect(p.meta().headwear).toBe('carved_pumpkin');
    // ...but no new sacks
    server.interaction.containers.openCrafting(p, p.dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const win = server.interaction.containers.windowOf(p);
    [null, 'string', null, 'white_wool', null, 'white_wool', 'white_wool', 'white_wool', 'white_wool'].forEach((id, i) => win.slots[1 + i]!.set(id ? stackOf(id) : null));
    win.refresh!();
    expect(win.slots[0]!.get()).toBeNull();
    // The quest is not shown
    expect(conn.last('quest')?.quest ?? null).toBeNull();
    await server.stop();
  }, 240000);
});
