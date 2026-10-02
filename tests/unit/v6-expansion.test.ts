/**
 * V6 - The End Expansion: the Expanded End's terrain and biomes, the
 * Expansion Portal (dormant until the dragon's defeat, built once, alive in
 * old worlds where the dragon is already dead), travel there and back inside
 * the End, multiplayer use, the Admin Panel's tools (all cheats) and the two
 * advancements.
 */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { seedFromString } from '../../src/common/math/rng';
import { blockOf, getProp, S, STATE_SOLID } from '../../src/common/registry/blocks';
import { biomeNum } from '../../src/common/registry/biomes';
import { EndGenerator, exitPortalY } from '../../src/common/gen/end';
import { arrivalLayout, ARRIVAL_PLATFORM } from '../../src/common/gen/endExpansion';
import { EXPANSION_BIOMES } from '../../src/common/endExpansion/biomes';
import { EXPANSION_INNER, EXPANSION_OUTER, EXPANSION_PORTAL_SITE, inExpansion } from '../../src/common/endExpansion/region';
import { PORTAL_HALF_WIDTH, PORTAL_HEIGHT } from '../../src/common/endExpansion/portal';
import { validateAdmin } from '../../src/common/game/admin';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { Dimension } from '../../src/server/world/Dimension';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { hashChunks } from './v3-regression.test';

initItems();

async function settle(server: GameServer, rounds = 40, cond?: () => boolean): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    if (cond?.()) return true;
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return cond ? cond() : true;
}

/** Puts the player on the main island near the Expansion Portal and lets the island load. */
async function toIsland(server: GameServer, player: ServerPlayer): Promise<void> {
  if (player.dim.id !== 'end') server.changeDimension(player, 'end', 0.5, 100, 40.5);
  await settle(server, 20);
  const gen = player.dim.generator as EndGenerator;
  server.teleport(player, 0.5, exitPortalY(gen.terrain) + 1, 40.5);
  await settle(server, 120, () => !!server.endExpansion!.state?.built);
}

function frameAt(dim: Dimension, x: number, y: number, z: number): { lit: boolean; portal: number } {
  const lit = getProp(dim.getState(x, y, z), 'lit') === 'true';
  let portal = 0;
  for (let dy = 1; dy < PORTAL_HEIGHT - 1; dy++) for (let dx = -PORTAL_HALF_WIDTH + 1; dx < PORTAL_HALF_WIDTH; dx++) if (dim.blockId(x + dx, y + dy, z) === 'expansion_portal') portal++;
  return { lit, portal };
}

/** Stands the player in a portal opening and holds them there until something happens. */
function standIn(server: GameServer, p: ServerPlayer, x: number, y: number, z: number, ticks: number, onTick?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    if (i === 0) {
      server.teleport(p, x + 0.5, y + 1, z + 0.5);
      p.portalCooldown = 0;
    }
    tick(server, 1);
    onTick?.();
  }
}

function killDragon(server: GameServer, player: ServerPlayer): void {
  const dragon = server.theEnd!.fight.dragon!;
  expect(dragon).toBeTruthy();
  player.spawnProtection = 100000;
  dragon.hurt(10000, { source: 'mob', attacker: player });
  tick(server, 205);
  expect(server.level.flags.dragonKilledOnce).toBe(true);
}

let reqNo = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): number {
  const req = reqNo++;
  server.handle(conn, { t: 'admin', req, action });
  return req;
}
type Result = { req: number; ok: boolean; text: string; data?: unknown };
function results(conn: FakeConn, req: number): Result[] {
  return (conn.of('admin_result') as Result[]).filter((r) => r.req === req);
}

describe('the Expanded End', () => {
  const seed = seedFromString('v6-expansion');

  it('lies in a ring far beyond the outer islands, with open void before it in V6 worlds', () => {
    const g = new EndGenerator(seed, { version: 6 });
    expect(EXPANSION_INNER).toBeGreaterThanOrEqual(6000);
    let land = 0;
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      for (const d of [4800, 5400, EXPANSION_INNER + 100]) if (g.landAt(Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d))) land++;
    }
    expect(land).toBe(0);
    // ...and land further in
    let inside = 0;
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      if (g.landAt(Math.round(Math.cos(a) * 7600), Math.round(Math.sin(a) * 7600))) inside++;
    }
    expect(inside).toBeGreaterThan(60);
  });

  it('has all seven biomes, each reachable inside the ring, with its own land and palette', () => {
    const g = new EndGenerator(seed);
    const ex = g.terrain.expansion;
    expect(EXPANSION_BIOMES.length).toBe(7);
    expect(new Set(EXPANSION_BIOMES.map((b) => b.name)).size).toBe(7);
    const a = ex.arrival();
    EXPANSION_BIOMES.forEach((def, i) => {
      const spot = ex.findBiome(i, a.x, a.z);
      expect(spot, def.id).toBeTruthy();
      const d = Math.hypot(spot!.x, spot!.z);
      expect(d).toBeGreaterThan(EXPANSION_INNER);
      expect(d).toBeLessThan(EXPANSION_OUTER);
      expect(g.biomeAt(spot!.x, spot!.z)).toBe(biomeNum(def.id));
      // The generated chunk there carries the biome and stands on its palette
      const c = g.generate(spot!.x >> 4, spot!.z >> 4);
      expect(c.getBiome(spot!.x & 15, spot!.z & 15)).toBe(biomeNum(def.id));
      const ids = new Set<string>();
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 200; y++) ids.add(blockOf(c.get(x, y, z)).id);
      expect(ids.has(def.palette.top) || ids.has(def.palette.under), def.id).toBe(true);
    });
  });

  it('makes biome regions large, with void gaps between different biomes', () => {
    const g = new EndGenerator(seed);
    const ex = g.terrain.expansion;
    // Along a long line, biome runs are hundreds of blocks long and every change crosses a gap
    let runs = 0;
    let last = -1;
    let changes = 0;
    let gapsAtChanges = 0;
    for (let x = -3000; x <= 3000; x += 4) {
      const z = 7800;
      const r = ex.regionAt(x, z);
      if (r.biome !== last) {
        if (last >= 0) {
          changes++;
          // the few blocks either side of the border are void
          let empty = true;
          for (let dx = -12; dx <= 12; dx += 4) if (g.terrain.column(x + dx, z)) empty = false;
          if (empty) gapsAtChanges++;
        }
        last = r.biome;
        runs++;
      }
    }
    expect(changes).toBeGreaterThan(2);
    expect(6000 / runs).toBeGreaterThan(200);
    expect(gapsAtChanges).toBe(changes);
  });

  it('is deterministic per seed', () => {
    const sample = (s: number): string => {
      const g = new EndGenerator(s);
      const a = g.terrain.expansion.arrival();
      return hashChunks([g.generate(a.x >> 4, a.z >> 4), g.generate(0, 7600 >> 4), g.generate(-7000 >> 4, 1000 >> 4)]);
    };
    expect(sample(seed)).toBe(sample(seed));
    expect(sample(seed)).not.toBe(sample(seed + 1));
  });

  it('has an arrival island with a platform and an open return portal', () => {
    const g = new EndGenerator(seed);
    const a = g.terrain.expansion.arrival();
    expect(inExpansion(a.x, a.z)).toBe(true);
    const L = arrivalLayout(a);
    const get = (x: number, y: number, z: number): string => blockOf(g.generate(x >> 4, z >> 4).get(x & 15, y, z & 15)).id;
    for (let dx = -ARRIVAL_PLATFORM; dx <= ARRIVAL_PLATFORM; dx += 2) for (let dz = -ARRIVAL_PLATFORM; dz <= ARRIVAL_PLATFORM; dz += 2) expect(STATE_SOLID[S(get(a.x + dx, a.floor - 1, a.z + dz))]).toBe(1);
    expect(get(L.stand.x, L.stand.y, L.stand.z)).toBe('air');
    expect(get(L.stand.x, L.stand.y + 1, L.stand.z)).toBe('air');
    expect(get(L.portal.x, L.portal.y, L.portal.z)).toBe('expansion_portal_frame');
    expect(get(L.portal.x, L.portal.y + 2, L.portal.z)).toBe('expansion_portal');
  });
});

describe('the Expansion Portal', () => {
  it('stands dormant until the dragon is defeated, then opens (built only once)', async () => {
    const { server } = await makeServer({ seed: 'v6-portal' });
    const { player } = await join(server, 'Tester', 'uuid-t', 6);
    await toIsland(server, player);
    const sys = server.endExpansion!;
    const st = sys.state!;
    expect(st.built).toBe(true);
    expect(st.active).toBe(false);
    expect(st.x).toBe(EXPANSION_PORTAL_SITE.x);
    expect(st.z).toBe(EXPANSION_PORTAL_SITE.z);
    const end = player.dim;
    expect(end.blockId(st.x - PORTAL_HALF_WIDTH, st.y + 2, st.z)).toBe('expansion_portal_frame');
    expect(frameAt(end, st.x, st.y, st.z)).toEqual({ lit: false, portal: 0 });
    // Clearly apart from the exit portal at the centre
    expect(Math.hypot(st.x, st.z)).toBeGreaterThan(50);

    killDragon(server, player);
    await settle(server, 60, () => frameAt(end, st.x, st.y, st.z).lit);
    expect(frameAt(end, st.x, st.y, st.z)).toEqual({ lit: true, portal: 12 });
    expect(sys.state).toMatchObject({ built: true, active: true, opened: true, cheat: false });

    // Built once: a frame piece knocked out (creative) is not put back by itself
    end.setBlock(st.x - PORTAL_HALF_WIDTH, st.y + 2, st.z, 0);
    await settle(server, 60);
    expect(end.blockId(st.x - PORTAL_HALF_WIDTH, st.y + 2, st.z)).toBe('air');
    // ...and can't be broken outside creative
    const frame = blockOf(end.getState(st.x, st.y, st.z)).def;
    expect(frame.hardness).toBe(-1);
  }, 120000);

  it('opens straight away in an old save where the dragon is already dead (and old saves load cleanly)', async () => {
    const storage = new MemoryStorage();
    const first = await makeServer({ seed: 'v6-old' }, storage);
    await first.server.stop();
    // A V5.5 save: older generator, the dragon dead, no Expansion Portal yet
    const lvl = storage.level as { generatorVersion: number; flags: Record<string, unknown> };
    lvl.generatorVersion = 5;
    lvl.flags = { ...lvl.flags, dragonKilled: true, dragonKilledOnce: true, gateways: 1 };
    delete lvl.flags.expansionPortal;
    const server = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(server);
    server.level.rules.doMobSpawning = false;
    expect(server.level.generatorVersion).toBe(5);
    const { player } = await join(server, 'Tester', 'uuid-t', 6);
    await toIsland(server, player);
    const st = server.endExpansion!.state!;
    expect(st).toMatchObject({ built: true, active: true, opened: true });
    expect(frameAt(player.dim, st.x, st.y, st.z)).toEqual({ lit: true, portal: 12 });
    // No dragon comes back for it
    expect(server.theEnd!.fight.dragon).toBeNull();
  }, 120000);

  it('takes players to the Expanded End and back, safely, without leaving the End', async () => {
    const { server } = await makeServer({ seed: 'v6-travel' });
    const { player } = await join(server, 'Tester', 'uuid-t', 4);
    await toIsland(server, player);
    killDragon(server, player);
    await settle(server, 40);
    const sys = server.endExpansion!;
    const st = sys.state!;
    expect(st.active).toBe(true);
    let leftEnd = false;
    standIn(server, player, st.x, st.y, st.z, 70, () => {
      if (player.dim.id !== 'end') leftEnd = true;
    });
    expect(inExpansion(player.x, player.z)).toBe(true);
    await settle(server, 300, () => player.dim.isLoaded(player.x, player.z) && STATE_SOLID[player.dim.getState(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z))] === 1);
    const end = player.dim;
    const fx = Math.floor(player.x);
    const fy = Math.floor(player.y);
    const fz = Math.floor(player.z);
    expect(STATE_SOLID[end.getState(fx, fy - 1, fz)]).toBe(1);
    expect(STATE_SOLID[end.getState(fx, fy, fz)]).toBe(0);
    expect(STATE_SOLID[end.getState(fx, fy + 1, fz)]).toBe(0);
    expect(player.achievements.has('enter_expanded_end')).toBe(false);
    await settle(server, 40);
    expect(player.achievements.has('enter_expanded_end')).toBe(true);

    // The return portal next to the arrival spot takes them back beside the Expansion Portal
    const L = arrivalLayout((end.generator as EndGenerator).terrain.expansion.arrival());
    tick(server, 120); // the arrival cooldown runs out
    standIn(server, player, L.portal.x, L.portal.y, L.portal.z, 70, () => {
      if (player.dim.id !== 'end') leftEnd = true;
    });
    expect(Math.hypot(player.x - st.x, player.z - st.z)).toBeLessThan(6);
    await settle(server, 120, () => player.dim.isLoaded(player.x, player.z));
    expect(STATE_SOLID[end.getState(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z))]).toBe(1);
    expect(leftEnd).toBe(false);
    expect(player.dim.id).toBe('end');
  }, 180000);

  it('repairs a broken arrival spot so nobody lands in the void or in rock', async () => {
    const { server } = await makeServer({ seed: 'v6-safe' });
    const { player } = await join(server, 'Tester', 'uuid-t', 4);
    await toIsland(server, player);
    server.endExpansion!.setActive(true, false);
    const L = arrivalLayout((player.dim.generator as EndGenerator).terrain.expansion.arrival());
    // Someone dug out the floor and walled the spot in
    server.endExpansion!.toExpansion(player, false);
    await settle(server, 300, () => player.dim.isLoaded(L.stand.x, L.stand.z));
    const end = player.dim;
    end.setBlock(L.stand.x, L.stand.y - 1, L.stand.z, 0);
    end.setBlock(L.stand.x, L.stand.y, L.stand.z, S('end_stone'));
    end.setBlock(L.stand.x, L.stand.y + 1, L.stand.z, S('end_stone'));
    server.teleport(player, 0.5, 80, 40.5);
    await settle(server, 40);
    server.endExpansion!.toExpansion(player, false);
    await settle(server, 300, () => !(server.endExpansion as unknown as { arriving: Map<unknown, unknown> }).arriving.size);
    expect(STATE_SOLID[end.getState(L.stand.x, L.stand.y - 1, L.stand.z)]).toBe(1);
    expect(end.blockId(L.stand.x, L.stand.y, L.stand.z)).toBe('air');
    expect(end.blockId(L.stand.x, L.stand.y + 1, L.stand.z)).toBe('air');
    expect(Math.floor(player.y)).toBe(L.stand.y);
  }, 180000);
});

describe('the Expansion Portal in multiplayer', () => {
  it('works for every player once open, and the server refuses it while it is closed', async () => {
    const { server } = await makeServer({ seed: 'v6-mp' });
    const a = await join(server, 'Alice', 'uuid-a', 4);
    const b = await join(server, 'Bob', 'uuid-b', 4);
    await toIsland(server, a.player);
    await toIsland(server, b.player);
    const sys = server.endExpansion!;
    const st = sys.state!;
    // Closed: even a portal block in the opening (however it got there) leads nowhere
    expect(st.active).toBe(false);
    b.player.dim.setBlock(st.x, st.y + 1, st.z, S('expansion_portal'));
    standIn(server, b.player, st.x, st.y, st.z, 120);
    expect(inExpansion(b.player.x, b.player.z)).toBe(false);
    b.player.dim.setBlock(st.x, st.y + 1, st.z, 0);

    killDragon(server, a.player);
    await settle(server, 40);
    expect(sys.state!.active).toBe(true);
    // Bob (who didn't kill it) goes through
    standIn(server, b.player, st.x, st.y, st.z, 70);
    expect(b.player.dim.id).toBe('end');
    expect(inExpansion(b.player.x, b.player.z)).toBe(true);
    // ...and so does Alice
    standIn(server, a.player, st.x, st.y, st.z, 70);
    expect(inExpansion(a.player.x, a.player.z)).toBe(true);
  }, 180000);
});

describe('V6 Admin Panel', () => {
  it('validates End Expansion requests', () => {
    expect(validateAdmin({ a: 'v6', op: 'status' })).toEqual({ a: 'v6', op: 'status' });
    expect(validateAdmin({ a: 'v6', op: 'tp_biome', biome: 'dune_isles' })).toEqual({ a: 'v6', op: 'tp_biome', biome: 'dune_isles' });
    expect(validateAdmin({ a: 'v6', op: 'tp_biome', biome: 'plains' })).toBeNull();
    expect(validateAdmin({ a: 'v6', op: 'tp_biome' })).toBeNull();
    expect(validateAdmin({ a: 'v6', op: 'nope' })).toBeNull();
  });

  it('switches and builds the portal and travels everywhere, awarding nothing', async () => {
    const { server } = await makeServer({ seed: 'v6-admin', cheats: true });
    const { conn, player } = await join(server, 'Tester', 'uuid-t', 4);
    const ok = async (action: Record<string, unknown>, waitTp = false): Promise<Result> => {
      const req = admin(server, conn, action);
      if (waitTp) await settle(server, 3000, () => results(conn, req).some((r) => (r.data as { teleported?: boolean } | undefined)?.teleported || !r.ok));
      const r = results(conn, req);
      expect(r.length, JSON.stringify(action)).toBeGreaterThan(0);
      expect(r.every((x) => x.ok), JSON.stringify(r)).toBe(true);
      return r[r.length - 1]!;
    };
    // Before the End is even visited
    const status = await ok({ a: 'v6', op: 'status' });
    expect((status.data as { biomes: unknown[] }).biomes.length).toBe(7);
    await ok({ a: 'v6', op: 'activate' });
    expect(server.endExpansion!.state).toMatchObject({ active: true, cheat: true, built: false });
    // Teleport to the portal: it gets built (open, because the panel opened it)
    await ok({ a: 'v6', op: 'tp_portal' }, true);
    expect(player.dim.id).toBe('end');
    await settle(server, 60, () => !!server.endExpansion!.state?.built);
    const st = server.endExpansion!.state!;
    expect(frameAt(player.dim, st.x, st.y, st.z)).toEqual({ lit: true, portal: 12 });
    await ok({ a: 'v6', op: 'deactivate' });
    expect(frameAt(player.dim, st.x, st.y, st.z)).toEqual({ lit: false, portal: 0 });
    // Rebuild after a frame piece is lost
    player.dim.setBlock(st.x + PORTAL_HALF_WIDTH, st.y + 3, st.z, 0);
    await ok({ a: 'v6', op: 'build_portal' });
    expect(player.dim.blockId(st.x + PORTAL_HALF_WIDTH, st.y + 3, st.z)).toBe('expansion_portal_frame');
    await ok({ a: 'v6', op: 'activate' });
    // Through the cheat-opened portal: a cheat visit
    standIn(server, player, st.x, st.y, st.z, 70);
    expect(inExpansion(player.x, player.z)).toBe(true);
    await settle(server, 200);
    // The arrival platform, then every biome
    await ok({ a: 'v6', op: 'tp_arrival' }, true);
    expect(inExpansion(player.x, player.z)).toBe(true);
    for (const b of EXPANSION_BIOMES) {
      await ok({ a: 'v6', op: 'tp_biome', biome: b.id }, true);
      await settle(server, 30);
      expect(server.endExpansion!.biomeIdAt(player.x, player.z), b.id).toBe(b.id);
      const where = await ok({ a: 'v6', op: 'where' });
      expect(where.text).toContain(b.name);
      expect(where.text).toContain(String(Math.floor(player.x)));
    }
    // Defeating the dragon from the panel: a cheat kill (no advancement) that still opens the portal
    await ok({ a: 'v6', op: 'deactivate' });
    server.level.flags.dragonKilled = false;
    server.level.flags.dragonKilledOnce = false;
    const st2 = server.endExpansion!.state!;
    server.level.flags.expansionPortal = { ...st2, opened: false, cheat: false };
    server.teleport(player, 0.5, exitPortalY((player.dim.generator as EndGenerator).terrain) + 1, 40.5);
    await settle(server, 200, () => !!server.theEnd!.fight.dragon);
    await ok({ a: 'v6', op: 'defeat_dragon' });
    tick(server, 205);
    await settle(server, 40);
    expect(server.level.flags.dragonKilledOnce).toBe(true);
    expect(player.achievements.has('kill_dragon')).toBe(false);
    expect(server.endExpansion!.state).toMatchObject({ active: true, opened: true, cheat: false });
    // None of it counts
    expect(player.achievements.has('enter_expanded_end')).toBe(false);
    expect(player.achievements.has('all_expanded_biomes')).toBe(false);
    expect(player.visitedEndBiomes.size).toBe(0);
  }, 300000);
});

describe('V6 advancements', () => {
  it('reaching the Expanded End and visiting all seven biomes', async () => {
    const { server } = await makeServer({ seed: 'v6-adv' });
    const { player } = await join(server, 'Tester', 'uuid-t', 3);
    await toIsland(server, player);
    killDragon(server, player);
    await settle(server, 40);
    const st = server.endExpansion!.state!;
    standIn(server, player, st.x, st.y, st.z, 70);
    await settle(server, 60);
    expect(player.achievements.has('enter_expanded_end')).toBe(true);
    const ex = (player.dim.generator as EndGenerator).terrain.expansion;
    const a = ex.arrival();
    for (let i = 0; i < EXPANSION_BIOMES.length; i++) {
      // Not before every biome has been seen (the arrival island's biome already counts)
      expect(player.achievements.has('all_expanded_biomes')).toBe(player.visitedEndBiomes.size === 7);
      const spot = ex.findBiome(i, a.x, a.z)!;
      // Walking (or gliding) there: an ordinary move, not a cheat
      server.teleport(player, spot.x + 0.5, spot.y, spot.z + 0.5);
      tick(server, 25);
    }
    expect(player.visitedEndBiomes.size).toBe(7);
    expect(player.achievements.has('all_expanded_biomes')).toBe(true);
  }, 180000);
});
