/**
 * V6 phase 2: the Expanded End's five mobs on a real server, on the arrival
 * island. Every attack is telegraphed (24 ticks, 32 with other players near)
 * before it lands, hits never throw anyone into the void, mobs never walk
 * off islands, the Void Stalker's void slip always ends behind a player on
 * safe ground (or with it gone), Endlings scatter from stalkers, Chorus
 * Beasts anger at broken chorus and calm down, mites swarm out of mined
 * clusters and burrow back, and End Phantoms dive and get stunned.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { EndGenerator } from '../../src/common/gen/end';
import { arrivalLayout } from '../../src/common/gen/endExpansion';
import { Mob, overVoid } from '../../src/server/entity/Mob';
import { S } from '../../src/common/registry/blocks';
import { lookDir } from '../../src/server/systems/Interaction';
import { TELEGRAPH_TICKS, TELEGRAPH_TICKS_CROWD } from '../../src/common/endExpansion/combat';

async function settle(server: GameServer, rounds = 40, cond?: () => boolean): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    if (cond?.()) return true;
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return cond ? cond() : true;
}

interface World {
  server: GameServer;
  players: ServerPlayer[];
  /** The arrival platform's standing spot. */
  at: { x: number; y: number; z: number };
  /** Centre of the arrival island. */
  centre: { x: number; z: number };
}

/** A server with `n` players on the Expanded End's arrival island (in survival, nothing protecting them). */
async function onIsland(n = 1, seed = 'v6-mobs'): Promise<World> {
  const { server } = await makeServer({ seed });
  const players: ServerPlayer[] = [];
  for (let i = 0; i < n; i++) players.push((await join(server, 'P' + i)).player);
  const gen = server.dim('end').generator as EndGenerator;
  const a = gen.terrain.expansion.arrival();
  const L = arrivalLayout(a);
  for (const p of players) server.changeDimension(p, 'end', L.stand.x + 0.5, L.stand.y, L.stand.z + 0.5);
  const end = server.dim('end');
  await settle(server, 400, () => [-48, 0, 48].every((dx) => [-48, 0, 48].every((dz) => end.isLoaded(a.x + dx, a.z + dz))));
  for (const p of players) {
    server.teleport(p, L.stand.x + 0.5, L.stand.y, L.stand.z + 0.5, 0, 0);
    p.spawnProtection = 0;
  }
  return { server, players, at: L.stand, centre: { x: a.x, z: a.z } };
}

function spawn(w: World, type: string, dx: number, dz: number): Mob {
  const m = w.server.mobs!.spawn(w.server.dim('end'), type, w.at.x + 0.5 + dx, w.at.y, w.at.z + 0.5 + dz)!;
  expect(m).toBeTruthy();
  return m;
}

/** Runs until `done` or the limit; returns the tick it happened, or -1. */
function until(w: World, limit: number, done: () => boolean, each?: () => void): number {
  for (let i = 0; i < limit; i++) {
    tick(w.server, 1);
    each?.();
    if (done()) return w.server.tickNo;
  }
  return -1;
}

/** Ticks from the start of an attack's telegraph (the mob's `tele`) to the first damage it deals. */
function telegraphToHit(w: World, m: Mob, kind: string, victim: ServerPlayer, limit = 400): { tele: number; hit: number } {
  const hp = victim.health;
  let tele = -1;
  const hit = until(
    w,
    limit,
    () => victim.health < hp,
    () => {
      if (tele < 0 && m.data.tele === kind) tele = w.server.tickNo;
    },
  );
  return { tele, hit };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('telegraphs', () => {
  it('a Void Stalker crouches for 24 ticks before its lunge lands (32 with another player near)', async () => {
    const w = await onIsland(2);
    const [p, q] = w.players;
    // The second player far away: a lone fight
    w.server.teleport(q!, w.centre.x + 0.5, w.at.y + 30, w.centre.z + 200);
    const m = spawn(w, 'void_stalker', 0, -5);
    m.target = p!;
    const a = telegraphToHit(w, m, 'lunge', p!);
    expect(a.tele).toBeGreaterThan(0);
    expect(a.hit - a.tele).toBeGreaterThanOrEqual(TELEGRAPH_TICKS);
    // Both players together: the crouch lasts longer
    m.remove();
    p!.health = 20;
    w.server.teleport(q!, w.at.x + 2.5, w.at.y, w.at.z + 0.5);
    tick(w.server, 5);
    const m2 = spawn(w, 'void_stalker', 0, -5);
    m2.target = p!;
    const b = telegraphToHit(w, m2, 'lunge', p!);
    expect(b.tele).toBeGreaterThan(0);
    expect(b.hit - b.tele).toBeGreaterThanOrEqual(TELEGRAPH_TICKS_CROWD);
  }, 120000);

  it("a Chorus Beast rears for at least 28 ticks before its slam, and shows its throw's arc before the chorus flies", async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    const beast = spawn(w, 'chorus_beast', 0, -3.5);
    w.server.endMobs!.angerBeast(beast, p);
    const slam = telegraphToHit(w, beast, 'slam', p);
    expect(slam.tele).toBeGreaterThan(0);
    expect(slam.hit - slam.tele).toBeGreaterThanOrEqual(28);
    // The throw: a player well away gets the arc first, then the hit (and is shifted onto safe ground)
    beast.remove();
    p.health = 20;
    tick(w.server, 40);
    const b2 = spawn(w, 'chorus_beast', 0, -10);
    w.server.endMobs!.angerBeast(b2, p);
    const arcs: number[] = [];
    const conn = (p as unknown as { conn: { received: { t: string; kind?: string }[] } }).conn;
    const before = conn.received.length;
    const fromX = p.x;
    const fromZ = p.z;
    const thr = telegraphToHit(w, b2, 'throw', p);
    for (const msg of conn.received.slice(before)) if (msg.t === 'fx' && msg.kind === 'warn_arc') arcs.push(1);
    expect(thr.tele).toBeGreaterThan(0);
    expect(arcs.length).toBeGreaterThan(0);
    expect(thr.hit - thr.tele).toBeGreaterThanOrEqual(TELEGRAPH_TICKS);
    tick(w.server, 2);
    const moved = Math.hypot(p.x - fromX, p.z - fromZ);
    expect(moved).toBeGreaterThanOrEqual(1);
    expect(overVoid(p.dim, p.x, p.y, p.z)).toBe(false);
  }, 120000);

  it('an End Crystal Mite rears before it bites, and an End Phantom shows its dive line for 30 ticks', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    const mite = spawn(w, 'end_crystal_mite', 0, -2);
    mite.target = p;
    const bite = telegraphToHit(w, mite, 'bite', p);
    expect(bite.tele).toBeGreaterThan(0);
    expect(bite.hit - bite.tele).toBeGreaterThanOrEqual(TELEGRAPH_TICKS);
    mite.remove();
    p.health = 20;
    const ph = w.server.mobs!.spawn(p.dim, 'end_phantom', p.x + 6, p.y + 14, p.z)!;
    ph.target = p;
    const dive = telegraphToHit(w, ph, 'dive', p, 800);
    expect(dive.tele).toBeGreaterThan(0);
    expect(dive.hit - dive.tele).toBeGreaterThanOrEqual(30);
  }, 120000);
});

describe('the Void Stalker', () => {
  it('slips into the void below half health and always climbs back behind a player, on safe ground, after a telegraph', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    // Keep the player out of the fight itself: we only watch where it comes back
    p.abilities.invulnerable = true;
    for (let trial = 0; trial < 3; trial++) {
      const m = spawn(w, 'void_stalker', trial - 1, -6);
      m.target = p;
      p.yaw = trial * 2.1;
      m.hurt(m.health - m.maxHealth / 2 + 2, { source: 'mob', attacker: p });
      const gone = until(w, 400, () => m.data.slip === 'gone');
      expect(gone).toBeGreaterThan(0);
      expect(m.data.untouchable).toBe(true);
      let riseStart = -1;
      const landed = until(
        w,
        400,
        () => !m.data.slip,
        () => {
          if (riseStart < 0 && m.data.slip === 'rise') riseStart = w.server.tickNo;
        },
      );
      expect(riseStart).toBeGreaterThan(0);
      expect(landed - riseStart).toBeGreaterThanOrEqual(TELEGRAPH_TICKS);
      expect(m.removed).toBe(false);
      // On safe ground, behind the player
      expect(w.server.endMobs!.safeSpot(m.dim, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z), 1)).toBe(true);
      const [lx, , lz] = lookDir(p.yaw, 0);
      expect((m.x - p.x) * lx + (m.z - p.z) * lz).toBeLessThan(0);
      expect(Math.hypot(m.x - p.x, m.z - p.z)).toBeLessThan(5);
      m.remove();
      tick(w.server, 2);
    }
  }, 180000);

  it('slips away when a player looks straight at it for three seconds', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    p.abilities.invulnerable = true;
    const m = spawn(w, 'void_stalker', 0, -8);
    m.noAi = true;
    const look = (): void => {
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = -Math.atan2(m.y + 1.2 - (p.y + p.eyeHeight), Math.hypot(dx, dz));
    };
    // Glances don't count
    for (let i = 0; i < 40; i++) {
      look();
      tick(w.server, 1);
    }
    p.yaw += 1.5;
    tick(w.server, 4);
    expect(m.data.wantSlip).toBeUndefined();
    m.noAi = false;
    const t = until(w, 200, () => !!m.data.wantSlip || !!m.data.slipping || !!m.data.slip, look);
    expect(t).toBeGreaterThan(0);
  }, 120000);

  it('is gone for good when it slips with nobody to come back to', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    const m = spawn(w, 'void_stalker', 0, -6);
    m.target = p;
    m.hurt(m.health - m.maxHealth / 2 + 2, { source: 'mob', attacker: p });
    expect(until(w, 400, () => m.data.slip === 'gone')).toBeGreaterThan(0);
    // The only player leaves the End
    w.server.changeDimension(p, 'overworld', 0.5, 100, 0.5);
    expect(until(w, 800, () => m.removed)).toBeGreaterThan(0);
  }, 120000);
});

describe('mobs and the void', () => {
  it('never walk off the island over a long run', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    // A creative player keeps the chunks loaded but is nobody's target
    p.setGamemode('creative');
    const mobs: Mob[] = [];
    for (const type of ['endling', 'void_stalker', 'chorus_beast', 'end_crystal_mite'])
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        mobs.push(spawn(w, type, Math.cos(a) * 6, Math.sin(a) * 6 + 2));
      }
    let worstFall = 0;
    let lowest = Infinity;
    for (let i = 0; i < 3000; i++) {
      tick(w.server, 1);
      // Make them restless: walk targets in every direction, many of them out over the void
      if (i % 100 === 0)
        for (const m of mobs) {
          if (m.dead) continue;
          const a = Math.random() * Math.PI * 2;
          m.wantPos = { x: m.x + Math.cos(a) * 30, y: m.y, z: m.z + Math.sin(a) * 30, speed: 1.3 };
        }
      for (const m of mobs) {
        worstFall = Math.max(worstFall, m.body.fallDistance);
        lowest = Math.min(lowest, m.y);
      }
    }
    const footing = (m: Mob): boolean => {
      const h = m.body.width / 2 - 0.05;
      return [
        [0, 0],
        [-h, -h],
        [h, -h],
        [-h, h],
        [h, h],
      ].some(([dx, dz]) => !overVoid(m.dim, m.x + dx!, m.y, m.z + dz!));
    };
    for (const m of mobs) {
      expect(m.dead).toBe(false);
      expect(footing(m)).toBe(true);
    }
    // Stepping down a ledge onto lower land is fine; nobody ever dropped into the void
    expect(worstFall).toBeLessThan(16);
    expect(lowest).toBeGreaterThan(20);
  }, 240000);

  it('never knock a player into the void: hits at the edge come without knockback towards it', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    // Stand the player at the island's edge, a beast between them and the island's middle
    const edge = w.server.endMobs!.findEdge(spawn(w, 'endling', 0, 0))!;
    expect(edge).toBeTruthy();
    w.server.teleport(p, edge.x, edge.y, edge.z);
    tick(w.server, 2);
    const beast = w.server.mobs!.spawn(p.dim, 'chorus_beast', edge.x - edge.dx * 3, edge.y, edge.z - edge.dz * 3)!;
    w.server.endMobs!.angerBeast(beast, p);
    p.abilities.invulnerable = false;
    p.health = 20;
    const hp = p.health;
    until(w, 300, () => p.health < hp);
    expect(p.health).toBeLessThan(hp);
    tick(w.server, 30);
    expect(p.dead).toBe(false);
    expect(p.y).toBeGreaterThan(w.at.y - 3);
  }, 120000);
});

describe('the other mobs', () => {
  it('Endlings chirp and blink away when a Void Stalker comes within 16 blocks', async () => {
    const w = await onIsland();
    const lings = [spawn(w, 'endling', 2, -2), spawn(w, 'endling', -2, -2), spawn(w, 'endling', 0, -3)];
    tick(w.server, 20);
    const at = lings.map((l) => [l.x, l.z]);
    const stalker = spawn(w, 'void_stalker', 0, -9);
    stalker.noAi = true;
    tick(w.server, 25);
    const moved = lings.filter((l, i) => Math.hypot(l.x - at[i]![0]!, l.z - at[i]![1]!) > 2.5);
    expect(moved.length).toBe(3);
    for (const l of lings) expect(overVoid(l.dim, l.x, l.y, l.z)).toBe(false);
  }, 120000);

  it('a Chorus Beast turns on a player who breaks chorus within 8 blocks, and calms down 30 seconds after losing them', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    const end = p.dim;
    const beast = spawn(w, 'chorus_beast', 0, -6);
    beast.noAi = true;
    const x = w.at.x + 2;
    const z = w.at.z - 2;
    end.setBlock(x, w.at.y, z, S('chorus_plant'));
    expect(w.server.endMobs!.isAngryAt(beast, p)).toBe(false);
    w.server.mining.breakBlock(p, x, w.at.y, z, end.getState(x, w.at.y, z));
    expect(w.server.endMobs!.isAngryAt(beast, p)).toBe(true);
    // Out of its reach for good (but near enough that it doesn't despawn): it calms down, and the player gets "Gentle Giant"
    beast.persistenceRequired = true;
    w.server.teleport(p, beast.x + 30.5, w.at.y + 20, beast.z + 0.5);
    p.abilities.invulnerable = true;
    beast.noAi = false;
    const calm = until(w, 1200, () => !w.server.endMobs!.isAngryAt(beast, p));
    expect(calm).toBeGreaterThan(0);
    expect(p.achievements.has('chorus_beast')).toBe(true);
  }, 120000);

  it('mites swarm out of a mined End Crystal Cluster, all join in when one is hit, and burrow back afterwards', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    const end = p.dim;
    const x = w.at.x + 3;
    const z = w.at.z - 3;
    end.setBlock(x, w.at.y, z, S('end_crystal_cluster'));
    end.setBlock(x - 6, w.at.y, z, S('end_crystal_cluster'));
    p.inventory.set(p.selectedSlot, { id: (await import('../../src/common/registry/items')).itemById.get('iron_pickaxe')!.num, count: 1 });
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    w.server.mining.breakBlock(p, x, w.at.y, z, end.getState(x, w.at.y, z));
    vi.restoreAllMocks();
    const mites = end.entitiesNear(x + 0.5, w.at.y, z + 0.5, 3, (e) => e.type === 'end_crystal_mite') as Mob[];
    expect(mites.length).toBeGreaterThanOrEqual(2);
    expect(mites.length).toBeLessThanOrEqual(4);
    for (const m of mites) expect(m.target).toBe(p);
    expect(p.achievements.has('mine_crystal_cluster')).toBe(true);
    // One is hit: the others (and any mite within 12 blocks) take the attacker as their target
    const other = spawn(w, 'end_crystal_mite', 6, -10);
    expect(other.target).toBeNull();
    mites[0]!.hurt(1, { source: 'player', attacker: p });
    expect(other.target).toBe(p);
    // The player goes: with nothing to fight, the released mites burrow into the other cluster
    w.server.changeDimension(p, 'overworld', 0.5, 100, 0.5);
    const p2 = (await join(w.server, 'Watcher')).player;
    w.server.changeDimension(p2, 'end', w.at.x + 0.5, w.at.y, w.at.z + 12.5);
    p2.setGamemode('creative');
    for (const m of mites) m.target = null;
    until(w, 1200, () => mites.every((m) => m.removed || m.dead));
    expect(mites.filter((m) => m.removed && !m.dead).length).toBeGreaterThan(0);
  }, 180000);

  it('an End Phantom hit while diving is stunned for two seconds', async () => {
    const w = await onIsland();
    const p = w.players[0]!;
    p.abilities.invulnerable = true;
    const ph = w.server.mobs!.spawn(p.dim, 'end_phantom', p.x + 6, p.y + 14, p.z)!;
    ph.target = p;
    expect(until(w, 600, () => !!ph.data.diving)).toBeGreaterThan(0);
    ph.hurt(2, { source: 'player', attacker: p });
    expect(ph.data.diving).toBeUndefined();
    const stunned = w.server.tickNo;
    expect(Number(ph.data.stunUntil) - stunned).toBe(40);
    expect(ph.data.stun).toBe(true);
    until(w, 60, () => !ph.data.stun);
    expect(w.server.tickNo - stunned).toBeGreaterThanOrEqual(40);
  }, 120000);
});
