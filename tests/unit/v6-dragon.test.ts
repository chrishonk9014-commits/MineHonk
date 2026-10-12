/**
 * V6 phase 5: the Dragon additions. The classic fight stays as it was (200
 * health, perching, the Voidbound and malware paths are covered by end-v3,
 * endgame and v55-herobrine); every new attack is shown before it lands, the
 * Edge Strike keeps away from everything that matters and its crater is put
 * back, the Wing Gust never throws anyone off the island, and the tuning
 * simulation holds: no fewer perches, damage up by 30% at most.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { EndGenerator, endPillars, exitPortalY } from '../../src/common/gen/end';
import { Random } from '../../src/common/math/rng';
import { DRAGON_X, DRAGON_TESTS } from '../../src/common/endExpansion/dragon';
import { STATE_BLOCK, blocks } from '../../src/common/registry/blocks';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { DamageInfo } from '../../src/server/systems/Survival';
import { simulate } from './v6-dragon-sim';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** The End with its island loaded (view distance 8: the island's edges too), the dragon up. */
async function endFight(seed: string, names = ['Tester']): Promise<{ server: GameServer; players: ServerPlayer[]; conns: FakeConn[]; y0: number }> {
  const { server } = await makeServer({ seed });
  const players: ServerPlayer[] = [];
  const conns: FakeConn[] = [];
  for (const n of names) {
    const { player, conn } = await join(server, n, 'uuid-' + n, 8);
    players.push(player);
    conns.push(conn);
    server.changeDimension(player, 'end', 0.5, 100, 20.5);
  }
  await settle(server, 30);
  const y0 = exitPortalY((players[0]!.dim.generator as EndGenerator).terrain);
  for (const p of players) {
    server.teleport(p, 0.5, y0 + 1, 20.5);
    p.spawnProtection = 0;
  }
  await settle(server, 120);
  expect(server.theEnd!.fight.dragon).toBeTruthy();
  server.theEnd!.fight.extras.rng = new Random(7);
  return { server, players, conns, y0 };
}

/** Records every hit a player takes (tick, source, amount). */
function hits(server: GameServer): { t: number; p: ServerPlayer; source: string; amount: number }[] {
  const out: { t: number; p: ServerPlayer; source: string; amount: number }[] = [];
  const s = server.interaction.survival;
  const orig = s.damage.bind(s);
  s.damage = (p: ServerPlayer, amount: number, info: DamageInfo): number => {
    out.push({ t: server.tickNo, p, source: info.source, amount });
    return orig(p, amount, info);
  };
  return out;
}

function groundY(server: GameServer, x: number, z: number, from: number): number {
  const dim = server.dim('end');
  for (let y = from + 12; y > from - 30; y--) if (dim.getState(Math.floor(x), y, Math.floor(z)) !== 0) return y + 1;
  return from;
}

function fxOf(conn: FakeConn, kind: string, since = 0): { m: Record<string, unknown>; i: number }[] {
  return conn.received.map((m, i) => ({ m: m as unknown as Record<string, unknown>, i })).filter((x) => x.i >= since && x.m.t === 'fx' && x.m.kind === kind);
}

describe('the Dragon additions keep the classic fight', () => {
  it('the dragon still has 200 health; every new move can be shown from the Admin Panel', async () => {
    const { server } = await endFight('dragon-x-hp');
    const f = server.theEnd!.fight;
    expect(f.dragon!.maxHealth).toBe(200);
    for (const t of DRAGON_TESTS) {
      const r = f.extras.test(t);
      expect(r.ok || /edge|line/i.test(r.text)).toBe(true);
      tick(server, 5);
    }
    expect(f.extras.test('nonsense').ok).toBe(false);
  }, 60000);
});

describe('every new attack is shown first and resolved when it lands', () => {
  it('Void Breath Wave: the path is drawn, the inhale lasts 30 ticks, then the breath lies along it', async () => {
    const { server, players, conns, y0 } = await endFight('dragon-x-wave');
    const p = players[0]!;
    const gy = groundY(server, 24.5, 0.5, y0);
    server.teleport(p, 24.5, gy, 0.5);
    const f = server.theEnd!.fight;
    f.setPhase('hold');
    const rec = hits(server);
    const before = conns[0]!.received.length;
    expect(f.extras.test('breath_wave').ok).toBe(true);
    const warnAt = server.tickNo;
    const warn = fxOf(conns[0]!, 'warn_beam', before);
    expect(warn.length).toBeGreaterThan(0);
    expect(Number(warn[0]!.m.ticks)).toBeGreaterThanOrEqual(DRAGON_X.breathInhale);
    expect(fxOf(conns[0]!, 'hack', before).some((x) => x.m.text === 'VOID BREATH WAVE')).toBe(true);
    for (let i = 0; i < 160; i++) {
      p.health = 20;
      server.teleport(p, 24.5, gy, 0.5);
      tick(server, 1);
    }
    const breath = rec.filter((h) => h.p === p && h.source === 'dragon_breath');
    expect(breath.length).toBeGreaterThan(0);
    expect(breath[0]!.t - warnAt).toBeGreaterThanOrEqual(24);
  }, 60000);

  it('Strafing Dive: a shadow line at least 24 ticks ahead, claws only on the line', async () => {
    const { server, players, conns, y0 } = await endFight('dragon-x-dive');
    const p = players[0]!;
    const gy = groundY(server, 18.5, 6.5, y0);
    server.teleport(p, 18.5, gy, 6.5);
    const f = server.theEnd!.fight;
    f.setPhase('hold');
    const rec = hits(server);
    const before = conns[0]!.received.length;
    const r = f.extras.test('strafing_dive');
    expect(r.ok).toBe(true);
    let warnAt = -1;
    for (let i = 0; i < 360 && f.phase === 'dive'; i++) {
      p.health = 20;
      server.teleport(p, 18.5, gy, 6.5);
      tick(server, 1);
      if (warnAt < 0 && fxOf(conns[0]!, 'warn_beam', before).length) warnAt = server.tickNo;
    }
    expect(warnAt).toBeGreaterThan(0);
    expect(fxOf(conns[0]!, 'hack', before).some((x) => x.m.text === 'STRAFING DIVE')).toBe(true);
    const claws = rec.filter((h) => h.p === p && h.amount === DRAGON_X.diveDamage);
    // Standing on the marked line, the pass finds them, and only after the warning
    expect(claws.length).toBe(1);
    expect(claws[0]!.t - warnAt).toBeGreaterThanOrEqual(DRAGON_X.diveWarn);
  }, 60000);

  it('Crystal Fury: a 30-tick charge line (32 with company), then 5 damage to whoever stayed on it', async () => {
    const { server, players, conns, y0 } = await endFight('dragon-x-fury', ['A', 'B']);
    const [a, b] = players as [ServerPlayer, ServerPlayer];
    const pillar = endPillars(server.level.seedNum)[0]!;
    const x = pillar.x - pillar.radius - 1.5;
    const gy = groundY(server, x, pillar.z + 0.5, y0);
    server.teleport(a, x, gy, pillar.z + 0.5);
    server.teleport(b, x - 3, gy, pillar.z + 0.5);
    const f = server.theEnd!.fight;
    const rec = hits(server);
    const before = conns[0]!.received.length;
    expect(f.extras.test('crystal_fury').ok).toBe(true);
    let chargedAt = -1;
    for (let i = 0; i < 80; i++) {
      for (const p of players) p.health = 20;
      server.teleport(a, x, gy, pillar.z + 0.5);
      tick(server, 1);
      const w = fxOf(conns[0]!, 'warn_beam', before).filter((m) => m.m.color === 0xff70e0);
      if (chargedAt < 0 && w.length) {
        chargedAt = server.tickNo;
        // Two players near each other: the longer warning
        expect(Number(w[0]!.m.ticks)).toBeGreaterThanOrEqual(32);
      }
    }
    expect(chargedAt).toBeGreaterThan(0);
    const shots = rec.filter((h) => h.p === a && h.source === 'magic' && h.amount === DRAGON_X.furyDamage);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]!.t - chargedAt).toBeGreaterThanOrEqual(32);
    void b;
  }, 60000);

  it('Wing Gust: it rears for 28 ticks first; Roar is only light and sound', async () => {
    const { server, players, conns, y0 } = await endFight('dragon-x-gust');
    const p = players[0]!;
    server.teleport(p, 6.5, groundY(server, 6.5, 0.5, y0), 0.5);
    const f = server.theEnd!.fight;
    const before = conns[0]!.received.length;
    // Down to the portal, then the gust (the test comes on landing)
    expect(f.extras.test('wing_gust').ok).toBe(true);
    let landed = false;
    for (let i = 0; i < 700 && !landed; i++) {
      p.health = 20;
      tick(server, 1);
      landed = f.phase === 'perch';
    }
    expect(landed).toBe(true);
    let rearAt = -1;
    let gustAt = -1;
    for (let i = 0; i < 80; i++) {
      p.health = 20;
      server.teleport(p, 6.5, groundY(server, 6.5, 0.5, y0), 0.5);
      tick(server, 1);
      if (rearAt < 0 && fxOf(conns[0]!, 'hack', before).some((x) => x.m.text === 'WING GUST')) rearAt = server.tickNo;
      // (the gust's own ring of light: the classic wing buffet also throws people back, with a hit)
      if (gustAt < 0 && fxOf(conns[0]!, 'shockwave', before).some((x) => x.m.r === DRAGON_X.gustRadius)) gustAt = server.tickNo;
    }
    expect(rearAt).toBeGreaterThan(0);
    expect(gustAt).toBeGreaterThan(0);
    expect(gustAt - rearAt).toBeGreaterThanOrEqual(DRAGON_X.gustRear);
    // The roar: a shake and a shockwave, no damage
    const rec = hits(server);
    const r0 = conns[0]!.received.length;
    expect(f.extras.test('roar').ok).toBe(true);
    tick(server, 2);
    expect(fxOf(conns[0]!, 'shake', r0).length).toBe(1);
    expect(rec.filter((h) => h.p === p).length).toBe(0);
  }, 60000);
});

describe('Edge Strike', () => {
  it('never comes near the pillars, the portals, the Nest entrance or the gateways', async () => {
    const { server } = await endFight('dragon-x-edge-sites');
    const x = server.theEnd!.fight.extras;
    const keep = x.protectedSpots();
    let found = 0;
    for (let i = 0; i < 40; i++) {
      const s = x.edgeSite();
      if (!s) continue;
      found++;
      for (const k of keep) expect(Math.hypot(s[0] + 0.5 - k.x, s[2] + 0.5 - k.z)).toBeGreaterThanOrEqual(DRAGON_X.edgeRadius + DRAGON_X.edgeKeepOut + k.r);
      // Away from the portal, out at the island's edge
      expect(Math.hypot(s[0], s[2])).toBeGreaterThan(24);
    }
    expect(found).toBeGreaterThan(0);
  }, 60000);

  it('slams after its warning, leaves loose stone that crumbles, saved until the fight ends, then put back', async () => {
    const { server, players, conns, y0 } = await endFight('dragon-x-edge');
    const p = players[0]!;
    const f = server.theEnd!.fight;
    f.setPhase('hold');
    const before = conns[0]!.received.length;
    expect(f.extras.test('edge_strike').ok).toBe(true);
    const edge = (f.extras as unknown as { edge: { x: number; y: number; z: number } | null }).edge!;
    expect(edge).toBeTruthy();
    const site = { ...edge };
    const dim = server.dim('end');
    const was = new Map<string, number>();
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -4; dy <= 2; dy++) was.set(`${site.x + dx},${site.y + dy},${site.z + dz}`, dim.getState(site.x + dx, site.y + dy, site.z + dz));
    // Stand at the edge of the mark (hit, thrown inwards)
    const rec = hits(server);
    let warnAt = -1;
    for (let i = 0; i < 400 && f.extras.pendingRestore() === 0; i++) {
      p.health = 20;
      server.teleport(p, site.x + 0.5, site.y + 1, site.z + 0.5);
      tick(server, 1);
      if (warnAt < 0 && fxOf(conns[0]!, 'warn_circle', before).some((x) => x.m.color === 0xff6a6a)) warnAt = server.tickNo;
    }
    expect(warnAt).toBeGreaterThan(0);
    expect(f.extras.pendingRestore()).toBeGreaterThan(0);
    const slam = rec.find((h) => h.p === p && h.amount === DRAGON_X.edgeDamage);
    expect(slam).toBeTruthy();
    expect(slam!.t - warnAt).toBeGreaterThanOrEqual(DRAGON_X.edgeWarn);
    // Saved in the level until put back
    expect((server.level.flags.dragonRestore as unknown[]).length).toBe(f.extras.pendingRestore());
    const ids = (): string[] => [...was.keys()].map((k) => blocks[STATE_BLOCK[dim.getState(...(k.split(',').map(Number) as [number, number, number]))]!]!.id);
    expect(ids().includes('loose_end_stone')).toBe(true);
    // ... it crumbles
    tick(server, 70);
    expect(ids().includes('loose_end_stone')).toBe(false);
    // The fight ends: every block is back
    f.extras.end();
    for (const [k, s] of was) expect(dim.getState(...(k.split(',').map(Number) as [number, number, number]))).toBe(s);
    expect(server.level.flags.dragonRestore).toBeUndefined();
  }, 60000);
});

describe('Wing Gust', () => {
  it('pushes at most 6 blocks, only as far as the island goes on 3 blocks beyond', async () => {
    const { server, players, y0 } = await endFight('dragon-x-gust-plan');
    const p = players[0]!;
    const x = server.theEnd!.fight.extras;
    const dim = server.dim('end');
    const solidBelow = (px: number, pz: number, py: number): boolean => {
      for (let y = Math.floor(py) + 2; y >= Math.floor(py) - 4; y--) if (dim.getState(Math.floor(px), y, Math.floor(pz)) !== 0) return true;
      return false;
    };
    for (const [px, pz] of [[3.5, 0.5], [0.5, 9.5], [-8.5, -4.5], [6.5, 6.5], [-2.5, 11]] as const) {
      server.teleport(p, px, groundY(server, px, pz, y0), pz);
      const plan = x.gustPlan([p], y0);
      expect(plan.length).toBe(1);
      const g = plan[0]!;
      expect(g.dist).toBeLessThanOrEqual(DRAGON_X.gustMax);
      for (let k = 0; k <= g.dist + 3; k += 0.5) expect(solidBelow(p.x + g.dir[0] * k, p.z + g.dir[1] * k, p.y)).toBe(true);
    }
    // A hole in the island just outside them: no push towards it at all
    server.teleport(p, 7.5, groundY(server, 7.5, 0.5, y0), 0.5);
    for (let xx = 9; xx <= 14; xx++) for (let zz = -3; zz <= 3; zz++) for (let y = y0 - 30; y <= y0 + 12; y++) dim.setBlock(xx, y, zz, 0);
    const g = x.gustPlan([p], y0)[0]!;
    expect(g.dist).toBeLessThan(1);
  }, 60000);
});

describe('the tuning simulation', () => {
  it('perches as often as before (or more) and telegraphed damage rises by 30% at most', async () => {
    let pb = 0;
    let pa = 0;
    let db = 0;
    let da = 0;
    for (const seed of [11, 22, 33]) {
      const brk = [1200, 2400, 3600];
      const a = await simulate({ seed: 'tune', rngSeed: seed, additions: false, ticks: 6000, spot: 24, breakCrystals: brk });
      const b = await simulate({ seed: 'tune', rngSeed: seed, additions: true, ticks: 6000, spot: 24, breakCrystals: brk });
      pb += a.perches;
      pa += b.perches;
      db += a.dpm;
      da += b.dpm;
    }
    expect(pa).toBeGreaterThanOrEqual(pb);
    expect(da).toBeLessThanOrEqual(db * 1.3);
  }, 300000);
});
