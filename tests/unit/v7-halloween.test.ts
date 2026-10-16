/**
 * V7 - The Halloween Update, phase 1: the season's rules (the exact cutoff,
 * the world setting, the Admin Panel's simulations), the clock (the hub's
 * time), the "Halloween content" world option surviving saves and restarts,
 * the server telling every player, the five dimension pumpkins (one block
 * each, one per dimension, scattered only while Halloween is on, only ever
 * into air, the same for the same world, kept after the season) and the
 * Admin Panel's Halloween tab.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { HALLOWEEN_ENDS_AT, HALLOWEEN_WINDOWS, DATE_TEST_LEAD, halloweenState, halloweenTested, seasonActive, seasonWindowAt, seasonWindowFor, simulatedDateStart, normalizeHalloweenSetting, halloweenReasonText } from '../../src/common/halloween/season';
import { SeasonClock, hubTimeOf } from '../../src/common/halloween/clock';
import { DIMENSION_PUMPKINS, PUMPKIN_IDS, PUMPKIN_GROUND, decoratePumpkins, pumpkinFor, pumpkinSpot } from '../../src/common/halloween/pumpkins';
import { createLevelData, sanitizeLevelData } from '../../src/server/world/LevelData';
import { createGenerator } from '../../src/common/gen/generator';
import { seedFromString } from '../../src/common/math/rng';
import { blocks, blockById, getBlock, STATE_BLOCK, S, stateOf, getProp } from '../../src/common/registry/blocks';
import { itemById, CREATIVE_TABS } from '../../src/common/registry/items';
import { validateAdmin, describeAdmin, ADMIN_DIMENSIONS, type HalloweenStatus } from '../../src/common/game/admin';
import type { DimensionId } from '../../src/common/data/biomes';
import type { Chunk } from '../../src/common/world/chunk';
import { readFileSync } from 'node:fs';

const MIN = 60_000;
const BEFORE = HALLOWEEN_ENDS_AT - MIN;
const AFTER = HALLOWEEN_ENDS_AT + MIN;

describe('the Halloween season', () => {
  it('ends at November 7, 2026, 12:00 AM Pacific Standard Time, the same moment everywhere', () => {
    expect(HALLOWEEN_ENDS_AT).toBe(Date.parse('2026-11-07T08:00:00Z'));
    expect(new Date(HALLOWEEN_ENDS_AT).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).toBe('11/7/2026, 12:00:00 AM');
    // The same instant reads differently around the world, but it is one cutoff
    expect(new Date(HALLOWEEN_ENDS_AT).toLocaleString('en-GB', { timeZone: 'Europe/London' })).toBe('07/11/2026, 08:00:00');
    expect(new Date(HALLOWEEN_ENDS_AT).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).toBe('11/7/2026, 5:00:00 PM');
  });

  it('the menu: on one minute before the cutoff, off at it and one minute after', () => {
    expect(seasonActive(BEFORE)).toBe(true);
    expect(seasonActive(HALLOWEEN_ENDS_AT - 1)).toBe(true);
    expect(seasonActive(HALLOWEEN_ENDS_AT)).toBe(false);
    expect(seasonActive(AFTER)).toBe(false);
    // Today (the season is on now, and on when V7 shipped)
    expect(seasonActive(Date.parse('2026-10-12T12:00:00Z'))).toBe(true);
    expect(seasonActive(Date.parse('2027-10-31T12:00:00Z'))).toBe(false);
  });

  it('a world: the date and its setting (Seasonal worlds stop, Always on worlds keep it)', () => {
    expect(halloweenState(BEFORE, 'seasonal')).toEqual({ active: true, reason: 'season', setting: 'seasonal', inSeason: true, content: 'real', date: 'real' });
    expect(halloweenState(AFTER, 'seasonal')).toEqual({ active: false, reason: 'expired', setting: 'seasonal', inSeason: false, content: 'real', date: 'real' });
    expect(halloweenState(BEFORE, 'always')).toMatchObject({ active: true, reason: 'always' });
    expect(halloweenState(AFTER, 'always')).toMatchObject({ active: true, reason: 'always' });
    // Next year does not bring it back by itself
    expect(halloweenState(Date.parse('2027-10-31T00:00:00Z'), 'seasonal').active).toBe(false);
  });

  it('the Admin Panel tests: the content forced on or off, a date just before or after the cutoff', () => {
    // A simulated date is just a date: the world's answer for it
    expect(simulatedDateStart('before', BEFORE - 30 * 86400_000)).toBe(HALLOWEEN_ENDS_AT - DATE_TEST_LEAD);
    expect(simulatedDateStart('after', BEFORE - 30 * 86400_000)).toBe(HALLOWEEN_ENDS_AT + DATE_TEST_LEAD);
    expect(simulatedDateStart('real', 12345)).toBe(12345);
    expect(halloweenState(simulatedDateStart('after', BEFORE), 'seasonal', { content: 'real', date: 'after' })).toMatchObject({ active: false, reason: 'expired', inSeason: false, date: 'after' });
    // An Always on world keeps it after the cutoff, simulated or not
    expect(halloweenState(AFTER, 'always', { content: 'real', date: 'after' })).toMatchObject({ active: true, reason: 'always', inSeason: false });
    // Forced: whatever the date and setting say
    expect(halloweenState(AFTER, 'seasonal', { content: 'on', date: 'real' })).toMatchObject({ active: true, reason: 'forced', content: 'on' });
    expect(halloweenState(BEFORE, 'always', { content: 'off', date: 'real' })).toMatchObject({ active: false, reason: 'forced', content: 'off' });
    expect(halloweenTested(halloweenState(BEFORE, 'seasonal'))).toBe(false);
    expect(halloweenTested(halloweenState(BEFORE, 'seasonal', { content: 'real', date: 'before' }))).toBe(true);
    expect(halloweenReasonText(halloweenState(AFTER, 'seasonal'))).toMatch(/^Off/);
    expect(halloweenReasonText(halloweenState(BEFORE, 'seasonal'))).toMatch(/November 7, 2026/);
    expect(halloweenReasonText(halloweenState(AFTER, 'seasonal', { content: 'on', date: 'real' }))).toMatch(/forced on/);
    expect(halloweenReasonText(halloweenState(AFTER, 'seasonal', { content: 'real', date: 'after' }))).toMatch(/just after the cutoff/);
  });

  it('is one window, written in one place, and nothing brings it back by itself', () => {
    expect(HALLOWEEN_WINDOWS).toHaveLength(1);
    expect(HALLOWEEN_WINDOWS[0]).toMatchObject({ id: 'halloween-2026', from: null, until: Date.parse('2026-11-07T08:00:00Z') });
    expect(seasonWindowAt(BEFORE)?.id).toBe('halloween-2026');
    expect(seasonWindowAt(AFTER)).toBeNull();
    // Every Halloween after this one: off (no future windows)
    for (const y of [2027, 2028, 2030, 2040]) expect(seasonActive(Date.UTC(y, 9, 31, 12))).toBe(false);
    // A later Halloween is one more window (docs/SEASONS.md): on in it, off between
    const year2 = [...HALLOWEEN_WINDOWS, { id: 'halloween-2027', name: 'Halloween 2027', from: Date.UTC(2027, 9, 1, 7), until: Date.UTC(2027, 10, 7, 8), untilText: 'November 7, 2027, 12:00 AM PST', untilDate: 'November 7, 2027' }];
    expect(seasonWindowAt(Date.UTC(2027, 9, 31), year2)?.id).toBe('halloween-2027');
    expect(seasonWindowAt(Date.UTC(2027, 5, 1), year2)).toBeNull();
    expect(seasonWindowFor(Date.UTC(2027, 5, 1), year2).id).toBe('halloween-2027');
    expect(seasonWindowFor(Date.UTC(2028, 5, 1), year2).id).toBe('halloween-2027');
    // Nothing else in the code writes the cutoff down
    const files = ['src/client/ui/Screens.ts', 'src/client/ui/OnlineScreens.ts', 'src/client/ui/AdminPanel.ts', 'src/client/ui/updateLogV7.ts', 'src/server/systems/Halloween.ts', 'src/client/App.ts'];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/November 7|2026-11-07|Date\.UTC\(2026/);
  });

  it('the clock: the hub time when known, the device clock otherwise', () => {
    let device = Date.parse('2026-12-25T00:00:00Z');
    const clock = new SeasonClock(() => device);
    // A device clock set to Christmas: the season looks over
    expect(clock.source).toBe('device');
    expect(seasonActive(clock.now())).toBe(false);
    // The hub says it is still October
    clock.setReference(Date.parse('2026-10-20T00:00:00Z'));
    expect(clock.source).toBe('hub');
    expect(clock.now()).toBe(Date.parse('2026-10-20T00:00:00Z'));
    expect(seasonActive(clock.now())).toBe(true);
    device += 5 * MIN;
    expect(clock.now()).toBe(Date.parse('2026-10-20T00:05:00Z'));
    // The worker takes the page's correction
    const worker = new SeasonClock(() => device);
    worker.adopt(clock.offset, clock.source);
    expect(worker.now()).toBe(clock.now());
    // A device-only correction is no correction
    const other = new SeasonClock(() => device);
    other.adopt(12345, 'device');
    expect(other.offset).toBe(0);
    // What the hub answers: its `now`, or its Date header
    expect(hubTimeOf({ ok: true, now: 1790000000000 }, null)).toBe(1790000000000);
    expect(hubTimeOf({ ok: true }, 'Sat, 07 Nov 2026 08:00:00 GMT')).toBe(HALLOWEEN_ENDS_AT);
    expect(hubTimeOf(null, 'nonsense')).toBeNull();
    // Test browsers pin it; the hub no longer moves it
    clock.pin(AFTER);
    clock.setReference(BEFORE);
    expect(clock.source).toBe('test');
    expect(Math.abs(clock.now() - AFTER)).toBeLessThan(1000);
  });
});

describe('the Halloween content world option', () => {
  it('defaults to Seasonal, and old worlds (no setting saved) are Seasonal', () => {
    expect(createLevelData({ id: 'a', name: 'A', seed: 's', mode: 'survival', difficulty: 'normal' }).halloween).toBe('seasonal');
    expect(createLevelData({ id: 'a', name: 'A', seed: 's', mode: 'survival', difficulty: 'normal', halloween: 'always' }).halloween).toBe('always');
    const old = JSON.parse(JSON.stringify(createLevelData({ id: 'a', name: 'A', seed: 's', mode: 'survival', difficulty: 'normal' })));
    delete old.halloween;
    expect(sanitizeLevelData(old, 'a')!.halloween).toBe('seasonal');
    expect(sanitizeLevelData({ ...old, halloween: 'nonsense' }, 'a')!.halloween).toBe('seasonal');
    expect(sanitizeLevelData({ ...old, halloween: 'always' }, 'a')!.halloween).toBe('always');
    expect(normalizeHalloweenSetting(undefined)).toBe('seasonal');
  });

  it('survives saving, reloading and a server restart, and the server tells every player', async () => {
    const storage = new MemoryStorage();
    const first = await makeServer({ seed: 'halloween-save', halloween: 'always' }, storage, { clock: () => AFTER });
    expect(first.server.level.halloween).toBe('always');
    await first.server.saveAll();
    await first.server.stop();
    const { server } = await makeServer({}, storage, { clock: () => AFTER });
    expect(server.level.halloween).toBe('always');
    const { conn } = await join(server, 'Alex', 'uuid-alex');
    const w = conn.last('welcome')!;
    expect(w.world.halloween).toMatchObject({ active: true, reason: 'always', setting: 'always' });
  });

  it('a Seasonal world: on before the cutoff, off after, and players hear the moment it passes', async () => {
    let now = HALLOWEEN_ENDS_AT - 2000;
    const { server } = await makeServer({ seed: 'halloween-cutoff' }, new MemoryStorage(), { clock: () => now });
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    expect(a.conn.last('welcome')!.world.halloween).toMatchObject({ active: true, reason: 'season' });
    expect(server.halloweenState().active).toBe(true);
    tick(server, 40);
    const before = [a.conn.of('world_info').length, b.conn.of('world_info').length];
    now = HALLOWEEN_ENDS_AT + 1;
    tick(server, 40);
    for (const [i, c] of [a.conn, b.conn].entries()) {
      expect(c.of('world_info').length).toBeGreaterThan(before[i]!);
      expect(c.last('world_info')!.world.halloween).toMatchObject({ active: false, reason: 'expired' });
    }
  });
});

describe('the dimension pumpkins', () => {
  it('one pumpkin for each dimension, and every dimension has one', () => {
    const dims = new Set(DIMENSION_PUMPKINS.map((p) => p.dim));
    expect([...dims].sort()).toEqual([...ADMIN_DIMENSIONS].sort());
    expect(DIMENSION_PUMPKINS).toHaveLength(ADMIN_DIMENSIONS.length);
    expect(new Set(PUMPKIN_IDS).size).toBe(PUMPKIN_IDS.length);
    expect(pumpkinFor('end').id).toBe('ender_pumpkin');
    for (const d of ADMIN_DIMENSIONS) for (const id of PUMPKIN_GROUND[d]) expect(blockById.has(id), `${d}: ${id}`).toBe(true);
  });

  it('each is one ordinary block: a lit, carved cube that faces its placer and drops itself', () => {
    const atlas = JSON.parse(readFileSync('public/assets/blocks.json', 'utf8')) as { textures: Record<string, unknown> };
    for (const p of DIMENSION_PUMPKINS) {
      const b = getBlock(p.id);
      expect(b.def.model).toBe('cube');
      expect(b.def.props?.facing).toEqual(['north', 'south', 'west', 'east']);
      expect(b.def.light).toBeGreaterThan(0);
      expect(b.def.drops ?? 'self').toBe('self');
      expect(b.def.hardness).toBe(1);
      for (const t of Object.values(b.def.tex)) expect(atlas.textures[t!], t).toBeTruthy();
      // Its item places it, in the Halloween tab
      expect(itemById.get(p.id)?.def.block).toBe(p.id);
      expect(itemById.get(p.id)?.def.creative).toBe('halloween');
    }
    expect(CREATIVE_TABS.some((t) => t.id === 'halloween')).toBe(true);
  });

  /** A sample of chunks in a dimension with land in them (round the spawn, and further out). */
  const sample = (dim: DimensionId, seed = 0): [number, number][] => {
    const out: [number, number][] = [];
    const sp = dim === 'overworld' ? createGenerator('overworld', seed).findSpawn() : { x: 0, z: 0 };
    const sx = Math.floor(sp.x) >> 4;
    const sz = Math.floor(sp.z) >> 4;
    // The End: round the main island and out in the Expanded End; elsewhere a spread
    const centres: [number, number][] = dim === 'end' ? [[0, 0], [0, 450]] : [[sx, sz], [sx + 40, sz - 30]];
    for (const [ox, oz] of centres) for (let i = 0; i < 100; i++) out.push([ox + (i % 10) - 5, oz + Math.floor(i / 10) - 5]);
    return out;
  };

  for (const dim of ADMIN_DIMENSIONS) {
    it(`${dim}: only ever adds its own pumpkin into air, at most one a chunk, the same every time`, () => {
      const seed = seedFromString('pumpkin-' + dim);
      const gen = createGenerator(dim, seed);
      const pumpkin = S(pumpkinFor(dim).id);
      let placed = 0;
      for (const [cx, cz] of sample(dim, seed)) {
        const plain = gen.generate(cx, cz);
        const decorated = gen.generate(cx, cz);
        const spot = decoratePumpkins(decorated, dim, seed, (x, y, z) => gen.structureAt?.(x, y, z) ?? null);
        let diffs = 0;
        for (let y = 0; y < 256; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const a = plain.get(x, y, z);
              const b = decorated.get(x, y, z);
              if (a === b) continue;
              diffs++;
              expect(a, 'into air').toBe(0);
              expect(STATE_BLOCK[b]).toBe(STATE_BLOCK[pumpkin]);
              expect(spot).toMatchObject({ x: (cx << 4) + x, y, z: (cz << 4) + z });
              // On its dimension's natural ground
              expect(PUMPKIN_GROUND[dim]).toContain(blocks[STATE_BLOCK[plain.get(x, y - 1, z)]!]!.id);
            }
        expect(diffs).toBeLessThanOrEqual(1);
        expect(diffs).toBe(spot ? 1 : 0);
        if (spot) {
          placed++;
          // The same world places the same pumpkin, facing the same way
          expect(pumpkinSpot(gen.generate(cx, cz), dim, seed, (x, y, z) => gen.structureAt?.(x, y, z) ?? null)).toEqual(spot);
          expect(['north', 'south', 'west', 'east']).toContain(getProp(spot.state, 'facing'));
        }
      }
      // Rare, but there are some
      expect(placed, `${dim} pumpkins in 200 chunks`).toBeGreaterThan(0);
      expect(placed).toBeLessThan(200 / 5);
    }, 240000);
  }

  it('another world (another seed) puts them elsewhere', () => {
    const spots = (seed: number): string[] => {
      const gen = createGenerator('overworld', seed);
      const out: string[] = [];
      for (const [cx, cz] of sample('overworld', seed)) {
        const s = pumpkinSpot(gen.generate(cx, cz), 'overworld', seed);
        if (s) out.push(`${s.x},${s.z}`);
      }
      return out;
    };
    const a = spots(seedFromString('world-a'));
    const b = spots(seedFromString('world-b'));
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  }, 120000);
});

/** Loads or generates the chunks round the spawn on a real server; returns the pumpkins in them. */
async function pumpkinsAround(server: GameServer, r = 9): Promise<number> {
  const dim = server.overworld;
  if (!server.level.spawn) {
    const sp = dim.generator.findSpawn();
    server.level.spawn = [sp.x, sp.y, sp.z];
  }
  const s = server.level.spawn;
  const cx0 = Math.floor(s[0]) >> 4;
  const cz0 = Math.floor(s[2]) >> 4;
  const want = (2 * r + 1) ** 2;
  // A chunk is read from storage first (asynchronously) and generated only if it was never saved
  for (let i = 0; i < 200 && dim.chunks.size < want; i++) {
    dim.want(cx0, cz0, r, server.tickNo);
    await new Promise((res) => setTimeout(res, 0));
    dim.processGeneration(5000);
  }
  expect(dim.chunks.size).toBeGreaterThanOrEqual(want);
  let n = 0;
  const ids = new Set(PUMPKIN_IDS.map((id) => getBlock(id).num));
  for (const c of dim.chunks.values() as IterableIterator<Chunk>)
    for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (ids.has(STATE_BLOCK[c.get(x, y, z)]!)) n++;
  return n;
}

describe('pumpkins on a real server', () => {
  it('scattered on new chunks only while Halloween is on, and their chunks are saved so they stay', async () => {
    const on = await makeServer({ seed: 'pumpkin-server' }, new MemoryStorage(), { clock: () => BEFORE });
    const n = await pumpkinsAround(on.server);
    expect(n).toBeGreaterThan(0);
    expect(on.server.halloween!.placed).toBe(n);
    // Every chunk with a pumpkin is marked to be saved
    for (const c of on.server.overworld.chunks.values()) {
      let has = false;
      for (let y = 0; y < 256 && !has; y++) for (let z = 0; z < 16 && !has; z++) for (let x = 0; x < 16 && !has; x++) if (PUMPKIN_IDS.includes(blocks[STATE_BLOCK[c.get(x, y, z)]!]!.id)) has = true;
      if (has) expect(c.modified).toBe(true);
    }
    // The same world after the cutoff: the same land, and no pumpkins
    const off = await makeServer({ seed: 'pumpkin-server' }, new MemoryStorage(), { clock: () => AFTER });
    expect(await pumpkinsAround(off.server)).toBe(0);
    // An Always on world keeps getting them
    const always = await makeServer({ seed: 'pumpkin-server', halloween: 'always' }, new MemoryStorage(), { clock: () => AFTER });
    expect(await pumpkinsAround(always.server)).toBe(n);
  }, 240000);

  it('the season ending removes nothing: saved pumpkins load back after the cutoff', async () => {
    const storage = new MemoryStorage();
    let now = BEFORE;
    const first = await makeServer({ seed: 'pumpkin-keep' }, storage, { clock: () => now });
    const n = await pumpkinsAround(first.server);
    expect(n).toBeGreaterThan(0);
    await first.server.saveAll();
    await first.server.stop();
    now = AFTER;
    const { server } = await makeServer({}, storage, { clock: () => now });
    expect(server.halloweenState().active).toBe(false);
    // The chunks with pumpkins were saved: they load back as they were
    expect(await pumpkinsAround(server)).toBe(n);
    expect(server.halloween!.placed).toBe(0);
  }, 240000);
});

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: HalloweenStatus } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}

describe("the Admin Panel's Halloween tab", () => {
  it('validates its requests', () => {
    expect(validateAdmin({ a: 'halloween', op: 'status' })).toEqual({ a: 'halloween', op: 'status' });
    expect(validateAdmin({ a: 'halloween', op: 'place', pumpkin: 'ember_pumpkin' })).toEqual({ a: 'halloween', op: 'place', pumpkin: 'ember_pumpkin' });
    expect(validateAdmin({ a: 'halloween', op: 'place', pumpkin: 'diamond_block' })).toBeNull();
    expect(validateAdmin({ a: 'halloween', op: 'test', date: 'after' })).toEqual({ a: 'halloween', op: 'test', date: 'after' });
    expect(validateAdmin({ a: 'halloween', op: 'test', content: 'off', date: 'before' })).toEqual({ a: 'halloween', op: 'test', content: 'off', date: 'before' });
    expect(validateAdmin({ a: 'halloween', op: 'test', content: 'forever' })).toBeNull();
    expect(validateAdmin({ a: 'halloween', op: 'test', date: 'yesterday' })).toBeNull();
    expect(validateAdmin({ a: 'halloween', op: 'test' })).toBeNull();
    expect(validateAdmin({ a: 'halloween', op: 'simulate', sim: 'expired' })).toBeNull();
    expect(validateAdmin({ a: 'halloween', op: 'delete_world' })).toBeNull();
    expect(describeAdmin({ a: 'halloween', op: 'status' })).toBeNull();
    expect(describeAdmin({ a: 'halloween', op: 'place_all' })).toMatch(/pumpkin/);
  });

  it('shows the state and why, shows a ghost, places each pumpkin (cheat-made) and simulates the cutoff', async () => {
    const { server } = await makeServer({ seed: 'halloween-admin', cheats: true }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn, player } = await join(server, 'Op', 'uuid-op', 4);
    let r = admin(server, conn, { a: 'halloween', op: 'status' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ state: { active: true, reason: 'season', setting: 'seasonal', inSeason: true, content: 'real', date: 'real' }, endsAt: HALLOWEEN_ENDS_AT, now: BEFORE, realNow: BEFORE, season: 'Halloween 2026' });
    expect(r.data!.text).toMatch(/season/);

    r = admin(server, conn, { a: 'halloween', op: 'ghost' });
    expect(r.ok).toBe(true);
    expect(conn.of('ghost')).toHaveLength(1);

    player.yaw = 0;
    r = admin(server, conn, { a: 'halloween', op: 'place_all' });
    expect(r.ok, r.text).toBe(true);
    const found: { id: string; x: number; y: number; z: number }[] = [];
    for (let x = Math.floor(player.x) - 8; x <= Math.floor(player.x) + 8; x++)
      for (let z = Math.floor(player.z) - 8; z <= Math.floor(player.z) + 8; z++)
        for (let y = Math.floor(player.y) - 7; y <= Math.floor(player.y) + 7; y++) {
          const id = blocks[STATE_BLOCK[player.dim.getState(x, y, z)]!]!.id;
          if (PUMPKIN_IDS.includes(id)) found.push({ id, x, y, z });
        }
    expect(found.map((f) => f.id).sort()).toEqual([...PUMPKIN_IDS].sort());
    for (const f of found) {
      // Cheat-made: breaking it never counts
      expect(server.admin.blockMarked(player.dim, f.x, f.y, f.z)).toBe(true);
      // Looking back at the player (who looks north)
      expect(getProp(player.dim.getState(f.x, f.y, f.z), 'facing')).toBe('south');
    }

    r = admin(server, conn, { a: 'halloween', op: 'test', date: 'after' });
    expect(r.data!.state).toMatchObject({ active: false, reason: 'expired', date: 'after', inSeason: false });
    expect(r.data!.now).toBe(HALLOWEEN_ENDS_AT + DATE_TEST_LEAD);
    expect(r.data!.realNow).toBe(BEFORE);
    expect(conn.last('world_info')!.world.halloween).toMatchObject({ active: false, date: 'after' });
    r = admin(server, conn, { a: 'halloween', op: 'test', content: 'on' });
    expect(r.data!.state).toMatchObject({ active: true, reason: 'forced', content: 'on', date: 'after' });
    r = admin(server, conn, { a: 'halloween', op: 'test', content: 'off', date: 'before' });
    expect(r.data!.state).toMatchObject({ active: false, reason: 'forced', content: 'off', date: 'before', inSeason: true });
    r = admin(server, conn, { a: 'halloween', op: 'test', content: 'real', date: 'real' });
    expect(r.data!.state).toMatchObject({ active: true, reason: 'season', content: 'real', date: 'real' });
    // Not saved, and the world's own setting never changes: a new server for the world starts without them
    admin(server, conn, { a: 'halloween', op: 'test', content: 'off', date: 'after' });
    expect(server.level.halloween).toBe('seasonal');
    await server.saveAll();
    expect(JSON.stringify(server.level)).not.toMatch(/"(content|date)":"(off|after)"/);
  });

  it('only the owner and operators of a world with cheats can use it', async () => {
    const { server } = await makeServer({ seed: 'halloween-noop', cheats: false }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn } = await join(server, 'Pat', 'uuid-pat');
    const r = admin(server, conn, { a: 'halloween', op: 'place_all' });
    expect(r.ok).toBe(false);
    expect(conn.of('ghost')).toHaveLength(0);
    void stateOf;
  });
});
