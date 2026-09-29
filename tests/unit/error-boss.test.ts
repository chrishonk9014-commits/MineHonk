/** V3: The Error's arena and fight: telegraphed attacks, phases, exposure, reset and the ERROR DEFEATED ending. */
import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf } from '../../src/common/registry/blocks';
import { FarlandsGenerator } from '../../src/common/gen/farlands';
import { ARENA_R } from '../../src/common/gen/farlandsArena';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { ErrorFight } from '../../src/server/systems/ErrorBoss';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';

async function settle(server: GameServer, rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** A player standing on the nearest arena, with the fight woken and The Error formed. */
async function arenaFight(name = 'Hero'): Promise<{ server: GameServer; conn: FakeConn; player: ServerPlayer; f: ErrorFight }> {
  const { server } = await makeServer({ seed: 'error-arena', mode: 'survival' });
  const { conn, player } = await join(server, name);
  const far = server.dim('farlands');
  const a = far.generator.locate!('error_arena', 0, 0)!;
  server.changeDimension(player, 'farlands', a.x + 10.5, a.y, a.z + 0.5);
  await settle(server, 120);
  player.abilities.survivalStats = true;
  // Keep the hero alive and still through the long fight
  const heal = (): void => {
    player.health = player.maxHealth;
  };
  for (let i = 0; i < 160 && !server.errorBoss!.fight?.boss; i++) {
    server.teleport(player, a.x + 10.5, a.y, a.z + 0.5);
    heal();
    tick(server, 1);
  }
  const f = server.errorBoss!.fight!;
  expect(f).toBeTruthy();
  for (let i = 0; i < 80 && f.state === 'intro'; i++) {
    heal();
    tick(server, 1);
  }
  return { server, conn, player, f };
}

describe('The Error arena', () => {
  beforeAll(() => initItems());

  it('floats over a chasm cut to the void, with bridges out to the rim (V3 worlds only)', () => {
    const g = new FarlandsGenerator(4242);
    const a = g.arenas!.nearest(0, 0)!;
    const at = (x: number, y: number, z: number): string => blockOf(g.generate(x >> 4, z >> 4).get(x & 15, y, z & 15)).id;
    expect(at(a.x + 5, a.y - 1, a.z + 3)).not.toBe('air');
    expect(at(a.x + 5, a.y, a.z + 3)).toBe('air');
    // Straight down to nothing between the platform and the rim
    const b = a.bridges[0]!;
    const side = b.a + Math.PI / 2;
    const cx = Math.round(a.x + Math.cos(side) * 45);
    const cz = Math.round(a.z + Math.sin(side) * 45);
    let solid = 0;
    for (let y = 0; y < 256; y++) if (at(cx, y, cz) !== 'air') solid++;
    expect(solid).toBeLessThan(8);
    // A bridge leads out
    const bx = Math.round(a.x + Math.cos(b.a) * 40);
    const bz = Math.round(a.z + Math.sin(b.a) * 40);
    let bridge = false;
    for (let y = 30; y < 200; y++) if (at(bx, y, bz) === 'farstone_bricks' || at(bx, y, bz) === 'missing_block') bridge = true;
    expect(bridge).toBe(true);
    expect(g.locate('error_arena', 0, 0)).toEqual({ x: a.x, y: a.y, z: a.z });
    expect(new FarlandsGenerator(4242, { version: 2 }).arenas).toBeNull();
  }, 60000);
});

describe('The Error', () => {
  beforeAll(() => initItems());

  it('forms when someone steps onto its arena, with health for the players there', async () => {
    const { server, f } = await arenaFight();
    expect(f.state).toBe('fight');
    expect(f.boss!.type).toBe('the_error');
    expect(f.boss!.maxHealth).toBe(600);
    expect(Math.hypot(f.boss!.x - f.arena.x - 0.5, f.boss!.z - f.arena.z - 0.5)).toBeLessThan(1);
    expect(f.arena.r).toBe(ARENA_R);
    void server;
  }, 60000);

  it('telegraphs every attack and only hits players who stay put', async () => {
    const { server, conn, player, f } = await arenaFight();
    const eb = server.errorBoss!;
    const boss = f.boss!;
    const x0 = player.x;
    const z0 = player.z;
    f.cooldown = 10_000;
    const run = (ticks: number, move?: () => void): number => {
      const before = player.health;
      let lost = 0;
      for (let i = 0; i < ticks; i++) {
        move?.();
        // Teleports grant a moment of spawn protection; the fight must be real
        player.spawnProtection = 0;
        const h = player.health;
        tick(server, 1);
        lost += Math.max(0, h - player.health);
        player.health = player.maxHealth;
      }
      void before;
      return lost;
    };
    const tele = eb.telegraph(1);
    expect(tele).toBeGreaterThanOrEqual(20);
    // The Farlands' own corruption would add stray hurts: a Potion of Stability keeps it off
    server.interaction.survival.addEffect(player, 'stability', 0, 100_000);

    // Falling blocks: warned with a circle first
    conn.received.length = 0;
    eb.attack(f, 'blocks', [player], tele);
    expect(conn.received.some((m) => m.t === 'fx' && m.kind === 'warn_circle')).toBe(true);
    expect(run(tele + 10)).toBeGreaterThan(0);
    conn.received.length = 0;
    eb.attack(f, 'blocks', [player], tele);
    expect(run(tele + 10, () => server.teleport(player, x0 + 9, player.y, z0 + 9))).toBe(0);

    // The laser: a tracking beam, then it locks; stepping aside after the lock dodges it
    server.teleport(player, x0, player.y, z0);
    conn.received.length = 0;
    eb.attack(f, 'laser', [player], tele);
    expect(conn.received.some((m) => m.t === 'fx' && m.kind === 'warn_beam')).toBe(true);
    run(18);
    expect(run(tele + 2, () => server.teleport(player, x0, player.y, z0 + 6))).toBe(0);
    server.teleport(player, x0, player.y, z0);
    eb.attack(f, 'laser', [player], tele);
    expect(run(tele + 20)).toBeGreaterThan(0);

    // The player glitch: leave the circle and nothing happens
    conn.received.length = 0;
    eb.attack(f, 'glitch', [player], tele);
    run(tele + 12, () => server.teleport(player, x0 + 8, player.y, z0));
    expect(conn.received.some((m) => m.t === 'fx' && m.kind === 'player_glitch')).toBe(false);
    server.teleport(player, x0, player.y, z0);
    eb.attack(f, 'glitch', [player], tele);
    run(tele + 12);
    expect(conn.received.some((m) => m.t === 'fx' && m.kind === 'player_glitch')).toBe(true);
    // Impaired, but only for a while
    expect(player.effects.has('slowness')).toBe(true);
    run(120);
    expect(player.effects.has('slowness')).toBe(false);
    void boss;
  }, 90000);

  it('takes little damage until its core is exposed, and changes phase at 75%', async () => {
    const { server, player, f } = await arenaFight();
    const boss = f.boss!;
    boss.invulnerableTicks = 0;
    const dealt = boss.hurt(40, { source: 'player', attacker: player });
    expect(dealt).toBeCloseTo(10 * (1 - Math.min(20, Math.max(boss.armor / 5, boss.armor - 10 / 2)) / 25), 3);
    f.state = 'exposed';
    f.t = 5;
    boss.invulnerableTicks = 0;
    const full = boss.hurt(40, { source: 'player', attacker: player });
    expect(full).toBeGreaterThan(dealt * 3);
    f.state = 'fight';
    boss.health = boss.maxHealth * 0.7;
    tick(server, 1);
    expect(f.phase).toBe(2);
    expect(f.state).toBe('transition');
    boss.invulnerableTicks = 0;
    expect(boss.hurt(40, { source: 'player', attacker: player })).toBe(0);
  }, 60000);

  it('resets and restores its arena when everyone leaves', async () => {
    const { server, player, f } = await arenaFight();
    const eb = server.errorBoss!;
    f.phase = 2;
    eb.attack(f, 'hole', [player], eb.telegraph(1));
    expect(f.restore.size).toBeGreaterThan(0);
    const [key, st] = [...f.restore][0]!;
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    tick(server, 60);
    expect(f.dim.getState(x, y, z)).toBe(0);
    server.changeDimension(player, 'overworld', 0.5, 100, 0.5);
    await settle(server, 230);
    expect(eb.fight).toBeNull();
    expect(f.boss!.removed).toBe(true);
    // Put back as soon as its chunk is loaded again (it may have unloaded meanwhile)
    server.changeDimension(player, 'farlands', x + 0.5, y + 1, z + 3.5);
    await settle(server, 80);
    expect(f.dim.getState(x, y, z)).toBe(st);
    expect((server.level.flags as Record<string, unknown>).errorRestore).toBeUndefined();
  }, 60000);

  it('comes apart, stabilises the Farlands and gives ERROR DEFEATED', async () => {
    const { server, conn, player, f } = await arenaFight();
    const boss = f.boss!;
    boss.invulnerableTicks = 0;
    f.state = 'exposed';
    f.t = 5;
    conn.received.length = 0;
    boss.hurt(10_000, { source: 'player', attacker: player });
    expect(f.state).toBe('dying');
    for (let i = 0; i < 300; i++) {
      player.health = player.maxHealth;
      tick(server, 1);
    }
    expect(server.errorBoss!.fight).toBeNull();
    expect(boss.removed).toBe(true);
    const kinds = conn.received.filter((m) => m.t === 'fx').map((m) => (m as { kind: string }).kind);
    expect(kinds).toContain('boss_death');
    expect(kinds).toContain('stabilize');
    const card = conn.received.find((m) => m.t === 'ending');
    expect(card && (card as { id: string }).id).toBe('error_defeated');
    expect(player.achievements.has('defeat_error')).toBe(true);
    expect(server.endings!.state.errorDefeated).toBe(true);
    // Defeated for good: stepping onto the arena again wakes nothing
    tick(server, 60);
    expect(server.errorBoss!.fight).toBeNull();
  }, 90000);

  it('an Admin Panel Error is no advancement', async () => {
    const { server } = await makeServer({ seed: 'error-admin', mode: 'survival' });
    const { player } = await join(server);
    await settle(server, 20);
    const m = server.mobs!.spawn(player.dim, 'the_error', player.x + 8, player.y, player.z, { reason: 'boss' })!;
    m.admin = true;
    tick(server, 25);
    const f = server.errorBoss!.fight!;
    expect(f.boss).toBe(m);
    expect(f.arena.natural).toBe(false);
    f.state = 'exposed';
    m.invulnerableTicks = 0;
    m.hurt(10_000, { source: 'player', attacker: player });
    for (let i = 0; i < 300; i++) {
      player.health = player.maxHealth;
      tick(server, 1);
    }
    expect(player.achievements.has('defeat_error')).toBe(false);
    expect(server.endings!.state.errorDefeated).toBe(false);
    // Even a cheat win leaves the arena calm until the Admin Panel resets it
    expect(server.level.flags.errorCalm).toBe(true);
  }, 60000);

  it('scales for a group: more health, longer warnings, and the ending for everyone there', async () => {
    const { server } = await makeServer({ seed: 'error-arena', mode: 'survival' });
    const { conn: c1, player: p1 } = await join(server, 'One');
    const { conn: c2, player: p2 } = await join(server, 'Two');
    const a = server.dim('farlands').generator.locate!('error_arena', 0, 0)!;
    for (const [p, dz] of [
      [p1, 0],
      [p2, 3],
    ] as const)
      server.changeDimension(p, 'farlands', a.x + 10.5, a.y, a.z + 0.5 + dz);
    await settle(server, 120);
    for (let i = 0; i < 200 && server.errorBoss!.fight?.state !== 'fight'; i++) {
      server.teleport(p1, a.x + 10.5, a.y, a.z + 0.5);
      server.teleport(p2, a.x + 10.5, a.y, a.z + 3.5);
      p1.health = p1.maxHealth;
      p2.health = p2.maxHealth;
      tick(server, 1);
    }
    const f = server.errorBoss!.fight!;
    expect(f.state).toBe('fight');
    expect(f.boss!.maxHealth).toBe(960);
    expect(server.errorBoss!.telegraph(2)).toBeGreaterThan(server.errorBoss!.telegraph(1));
    // Both see the boss bar
    expect(c1.of('boss').length).toBeGreaterThan(0);
    expect(c2.of('boss').length).toBeGreaterThan(0);
    f.state = 'exposed';
    f.boss!.invulnerableTicks = 0;
    f.boss!.hurt(10_000, { source: 'player', attacker: p1 });
    for (let i = 0; i < 300; i++) {
      p1.health = p1.maxHealth;
      p2.health = p2.maxHealth;
      tick(server, 1);
    }
    for (const [c, p] of [
      [c1, p1],
      [c2, p2],
    ] as const) {
      expect(c.of('ending').some((m) => (m as { id: string }).id === 'error_defeated')).toBe(true);
      expect(p.achievements.has('defeat_error')).toBe(true);
    }
  }, 90000);

  it('does not keep re-forming under a creative player, and stays gone once beaten', async () => {
    const { server } = await makeServer({ seed: 'error-arena', mode: 'creative' });
    const { player } = await join(server, 'Builder');
    const a = server.dim('farlands').generator.locate!('error_arena', 0, 0)!;
    server.changeDimension(player, 'farlands', a.x + 10.5, a.y, a.z + 0.5);
    await settle(server, 120);
    const eb = server.errorBoss!;
    const stay = (n: number): void => {
      for (let i = 0; i < n; i++) {
        server.teleport(player, a.x + 10.5, a.y, a.z + 0.5);
        tick(server, 1);
      }
    };
    stay(200);
    const boss = eb.fight!.boss!;
    expect(boss).toBeTruthy();
    // Well past the reset delay: still the same Error, not a fresh one
    stay(400);
    expect(eb.fight?.boss).toBe(boss);
    expect(boss.removed).toBe(false);
    // Beaten (a creative world's own players are not cheating): it stays beaten
    eb.fight!.state = 'exposed';
    boss.invulnerableTicks = 0;
    boss.hurt(100_000, { source: 'player', attacker: player });
    stay(300);
    expect(eb.fight).toBeNull();
    expect(server.endings!.state.errorDefeated).toBe(true);
    stay(200);
    expect(eb.fight).toBeNull();
    let errors = 0;
    for (const e of server.dim('farlands').entities.values()) if (e.type === 'the_error') errors++;
    expect(errors).toBe(0);
  }, 90000);
});
