/**
 * V6 phase 5: the End's events. Void Storms every 2-4 days (3-5 minutes,
 * never in an eclipse), the End Eclipse about one day in forty (at least 20
 * days apart, one night long); both only in the Expanded End. Their hazards
 * are shown first, debris never breaks a block, remnants and monoliths go
 * (setting anyone on them down safely), the shards dissolve, and the state
 * survives a save and reload.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { DAY, STORM, ECLIPSE } from '../../src/common/endExpansion/events';
import { EndGenerator } from '../../src/common/gen/end';
import { inExpansion } from '../../src/common/endExpansion/region';
import { STATE_BLOCK, blocks } from '../../src/common/registry/blocks';
import { Random } from '../../src/common/math/rng';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { DamageInfo } from '../../src/server/systems/Survival';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** A player on the arrival island, out in the Expanded End. */
async function inBand(server: GameServer, name = 'Tester'): Promise<{ player: ServerPlayer; conn: FakeConn }> {
  const { player, conn } = await join(server, name, 'uuid-' + name, 4);
  const a = (server.dim('end').generator as EndGenerator).terrain.expansion.arrival();
  server.changeDimension(player, 'end', a.x + 0.5, a.floor + 1, a.z + 0.5);
  await settle(server, 120);
  server.teleport(player, a.x + 0.5, a.floor + 1, a.z + 0.5);
  player.spawnProtection = 0;
  await settle(server, 20);
  return { player, conn };
}

const idAt = (server: GameServer, x: number, y: number, z: number): string => blocks[STATE_BLOCK[server.dim('end').getState(x, y, z)]!]!.id;

describe('the schedule', () => {
  it('storms every 2-4 days for 3-5 minutes; eclipses about one day in forty, 20 days apart; never both', async () => {
    const { server } = await makeServer({ seed: 'events-rates' });
    const ev = server.endEvents!;
    ev.rng = new Random(99);
    const days = 1200;
    let storms = 0;
    let eclipses = 0;
    let stormOn = -1;
    let eclipseOn = -1;
    const stormStarts: number[] = [];
    const eclipseDays: number[] = [];
    const t0 = server.level.time;
    for (let t = t0; t < t0 + days * DAY; t += 50) {
      server.level.time = t;
      ev.tick();
      const st = ev.state;
      const s = st.storm.phase === 'active';
      const e = st.eclipse.active;
      expect(s && e).toBe(false);
      if (s && stormOn < 0) {
        stormOn = t;
        storms++;
        stormStarts.push(t);
      } else if (!s && stormOn >= 0) {
        const len = t - stormOn;
        expect(len).toBeGreaterThanOrEqual(STORM.minTicks - 50);
        expect(len).toBeLessThanOrEqual(STORM.maxTicks + 100);
        stormOn = -1;
      }
      if (e && eclipseOn < 0) {
        eclipseOn = t;
        eclipses++;
        eclipseDays.push(Math.floor(t / DAY));
      } else if (!e && eclipseOn >= 0) {
        expect(t - eclipseOn).toBeLessThanOrEqual(ECLIPSE.ticks + 100);
        eclipseOn = -1;
      }
    }
    // Storms: one every 2-4 days (pushed back a little now and then by an eclipse)
    for (let i = 1; i < stormStarts.length; i++) {
      const gap = (stormStarts[i]! - stormStarts[i - 1]!) / DAY;
      expect(gap).toBeGreaterThanOrEqual(STORM.minGapDays - 0.01);
      expect(gap).toBeLessThanOrEqual(STORM.maxGapDays + 2);
    }
    expect(storms).toBeGreaterThan(days / 4.5);
    expect(storms).toBeLessThan(days / 1.9);
    // Eclipses: 2.5% a day, at least 20 days apart (about one in sixty days, all told)
    for (let i = 1; i < eclipseDays.length; i++) expect(eclipseDays[i]! - eclipseDays[i - 1]!).toBeGreaterThanOrEqual(ECLIPSE.minGapDays);
    expect(eclipses).toBeGreaterThan(days / 120);
    expect(eclipses).toBeLessThan(days / 30);
  }, 120000);
});

describe('only in the Expanded End', () => {
  it('the classic End is never stormy or eclipsed, and nobody there is touched', async () => {
    const { server } = await makeServer({ seed: 'events-band' });
    const { player } = await inBand(server, 'Far');
    const { player: home } = await join(server, 'Home', 'uuid-home', 3);
    server.changeDimension(home, 'end', 0.5, 100, 20.5);
    await settle(server, 60);
    const ev = server.endEvents!;
    ev.startStorm(false);
    tick(server, 80);
    expect(ev.state.storm.phase).toBe('active');
    const end = server.dim('end');
    expect(ev.storming(end, 0, 0)).toBe(false);
    expect(ev.storming(end, player.x, player.z)).toBe(true);
    expect(inExpansion(home.x, home.z)).toBe(false);
    const hit: ServerPlayer[] = [];
    const s = server.interaction.survival;
    const orig = s.damage.bind(s);
    s.damage = (p: ServerPlayer, n: number, info: DamageInfo): number => {
      if (info.source === 'void_debris') hit.push(p);
      return orig(p, n, info);
    };
    for (let i = 0; i < 600; i++) {
      home.health = player.health = 20;
      tick(server, 1);
    }
    expect(hit.includes(home)).toBe(false);
    ev.stopStorm();
    ev.startEclipse(false);
    tick(server, 2);
    expect(ev.eclipsed(end, 0, 0)).toBe(false);
    expect(ev.eclipsed(end, player.x, player.z)).toBe(true);
  }, 90000);
});

describe('a Void Storm', () => {
  it('warns first, marks every piece of debris 24 ticks ahead, never breaks a block, and its remnants fade safely', async () => {
    const { server } = await makeServer({ seed: 'events-storm' });
    const { player, conn } = await inBand(server);
    const ev = server.endEvents!;
    ev.rng = new Random(5);
    const before = conn.received.length;
    ev.warnStorm(false);
    tick(server, 2);
    expect(conn.received.slice(before).some((m) => m.t === 'fx' && m.kind === 'hack' && m.text === 'VOID STORM APPROACHING')).toBe(true);
    // The minute's warning, then the storm
    server.level.time = ev.state.storm.startAt;
    tick(server, 2);
    expect(ev.state.storm.phase).toBe('active');
    // The island under them, block by block
    const dim = server.dim('end');
    const px = Math.floor(player.x);
    const pz = Math.floor(player.z);
    const py = Math.floor(player.y);
    const snapshot = (): string => {
      const out: number[] = [];
      for (let x = px - 16; x <= px + 16; x++) for (let z = pz - 16; z <= pz + 16; z++) for (let y = py - 6; y <= py + 2; y++) out.push(dim.getState(x, y, z));
      return out.join(',');
    };
    const remnantKeys = (): Set<string> => {
      const k = new Set<string>();
      for (const r of (server.level.flags.endEventBlocks as { structs: { cells: [number, number, number, number][] }[] }).structs) for (const c of r.cells) k.add(`${c[0]},${c[1]},${c[2]}`);
      return k;
    };
    const ground0 = snapshot();
    const warns: { id: number; at: number }[] = [];
    const hits: number[] = [];
    const s = server.interaction.survival;
    const orig = s.damage.bind(s);
    s.damage = (p: ServerPlayer, n: number, info: DamageInfo): number => {
      if (info.source === 'void_debris') hits.push(server.tickNo);
      return orig(p, n, info);
    };
    let seen = conn.received.length;
    for (let i = 0; i < 1500; i++) {
      player.health = 20;
      server.teleport(player, px + 0.5, py, pz + 0.5);
      tick(server, 1);
      for (const m of conn.received.slice(seen)) if (m.t === 'fx' && m.kind === 'warn_circle' && m.color === 0x9a6aff) warns.push({ id: m.id!, at: server.tickNo });
      seen = conn.received.length;
    }
    expect(warns.length).toBeGreaterThan(5);
    // Every hit came at least 24 ticks after a mark
    for (const h of hits) expect(warns.some((w) => h - w.at >= 24 && h - w.at <= 40)).toBe(true);
    // Debris never broke a block (only the remnants' own cells may differ)
    const keys = remnantKeys();
    const now = snapshot().split(',');
    const was = ground0.split(',');
    let i = 0;
    for (let x = px - 16; x <= px + 16; x++)
      for (let z = pz - 16; z <= pz + 16; z++)
        for (let y = py - 6; y <= py + 2; y++, i++) if (now[i] !== was[i]) expect(keys.has(`${x},${y},${z}`)).toBe(true);
    // A remnant rose near them; stand on it as the storm ends
    const structs = (server.level.flags.endEventBlocks as { structs: { kind: string; cells: [number, number, number, number][]; chest?: [number, number, number] }[] }).structs.filter((r) => r.kind === 'remnant');
    expect(structs.length).toBeGreaterThan(0);
    const r0 = structs[0]!;
    const top = r0.cells.reduce((a, c) => (c[1] > a[1] ? c : a));
    server.teleport(player, top[0] + 0.5, top[1] + 1, top[2] + 0.5);
    tick(server, 1);
    // Its last 30 seconds: a warning
    const b2 = conn.received.length;
    server.level.time = ev.state.storm.endAt - STORM.fadeWarnTicks + 1;
    tick(server, 12);
    expect(conn.received.slice(b2).some((m) => m.t === 'fx' && m.kind === 'hack' && m.text === 'THE REMNANT IS FADING')).toBe(true);
    server.level.time = ev.state.storm.endAt;
    tick(server, 3);
    expect(ev.state.storm.phase).toBe('calm');
    // Every remnant block is gone, the player stands on real ground
    for (const c of r0.cells) expect(['remnant_stone', 'remnant_bricks', 'fading_remnant', 'chest']).not.toContain(idAt(server, c[0], c[1], c[2]));
    const below = idAt(server, Math.floor(player.x), Math.floor(player.y - 0.1), Math.floor(player.z));
    expect(below).not.toBe('air');
    expect(['remnant_stone', 'remnant_bricks', 'fading_remnant']).not.toContain(below);
    expect((server.level.flags.endEventBlocks as { structs: unknown[] }).structs.length).toBe(0);
  }, 120000);

  it('low-gravity pockets are marked 24 ticks first, then active for their time', async () => {
    const { server } = await makeServer({ seed: 'events-pocket' });
    const { player, conn } = await inBand(server);
    const ev = server.endEvents!;
    const before = conn.received.length;
    const pk = ev.addPocket(player.dim, player.x + 3, player.y, player.z, STORM.pocketRadius, 24, STORM.pocketTicks);
    expect(ev.pocketAt(player.dim, pk.x, pk.y, pk.z)).toBeNull();
    tick(server, 25);
    expect(ev.pocketAt(player.dim, pk.x, pk.y, pk.z)).toBeTruthy();
    const fx = conn.received.slice(before).filter((m) => m.t === 'fx');
    expect(fx.some((m) => m.kind === 'warn_circle' && m.ticks === 24)).toBe(true);
    expect(fx.some((m) => m.kind === 'zone' && m.text === 'lowgrav')).toBe(true);
  }, 60000);
});

describe('the End Eclipse', () => {
  it('a title once, monoliths near the player, shards that grow, dissolve at dawn, and the monoliths go', async () => {
    const { server } = await makeServer({ seed: 'events-eclipse' });
    const { player, conn } = await inBand(server);
    const ev = server.endEvents!;
    ev.rng = new Random(3);
    ev.startEclipse(false);
    for (let i = 0; i < 400; i++) {
      player.health = 20;
      tick(server, 1);
    }
    const titles = conn.received.filter((m) => m.t === 'title' && m.text === 'THE END ECLIPSE');
    expect(titles.length).toBe(1);
    const b = server.level.flags.endEventBlocks as { structs: { kind: string; cells: [number, number, number, number][] }[]; shards: [number, number, number][] };
    const monoliths = b.structs.filter((s) => s.kind === 'monolith');
    expect(monoliths.length).toBeGreaterThanOrEqual(ECLIPSE.monoliths[0]);
    // Shards grow on the islands near them
    for (let i = 0; i < ECLIPSE.shardEvery * 4; i++) tick(server, 1);
    expect(b.shards.length).toBeGreaterThan(0);
    const shard = b.shards[0]!;
    expect(idAt(server, ...shard)).toBe('eclipse_shard_growth');
    // Dawn: the last 30 seconds warn, then everything goes
    const c0 = conn.received.length;
    server.level.time = ev.state.eclipse.endAt - ECLIPSE.fadeWarnTicks + 1;
    tick(server, 12);
    expect(conn.received.slice(c0).some((m) => m.t === 'fx' && m.kind === 'hack')).toBe(true);
    server.level.time = ev.state.eclipse.endAt;
    tick(server, 3);
    expect(ev.state.eclipse.active).toBe(false);
    tick(server, 40);
    expect(idAt(server, ...shard)).not.toBe('eclipse_shard_growth');
    for (const m of monoliths) for (const c of m.cells) expect(['monolith_obsidian', 'monolith_astral', 'fading_monolith', 'chest']).not.toContain(idAt(server, c[0], c[1], c[2]));
  }, 120000);
});

describe('saved with the world', () => {
  it('a storm in progress and its remnant come back after a reload, and are put away when it ends', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'events-save' }, storage);
    const { player } = await inBand(server);
    const ev = server.endEvents!;
    ev.startStorm(false);
    tick(server, 80);
    expect(ev.buildRemnant(player, false)).toBeTruthy();
    const endAt = ev.state.storm.endAt;
    await server.stop();
    const { GameServer } = await import('../../src/server/GameServer');
    const { installGameplay } = await import('../../src/server/gameplay');
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    s2.level.rules.doMobSpawning = false;
    expect(s2.endEvents!.state.storm.phase).toBe('active');
    expect(s2.endEvents!.state.storm.endAt).toBe(endAt);
    const saved = (s2.level.flags.endEventBlocks as { structs: unknown[] }).structs;
    expect(saved.length).toBe(1);
    // The storm ends while the remnant's chunks are loaded: it goes
    const { player: p2 } = await join(s2, 'Tester', 'uuid-Tester', 4);
    await settle(s2, 120);
    s2.level.time = endAt;
    await settle(s2, 40);
    expect(s2.endEvents!.state.storm.phase).toBe('calm');
    expect((s2.level.flags.endEventBlocks as { structs: unknown[] }).structs.length).toBe(0);
    void p2;
  }, 120000);
});
