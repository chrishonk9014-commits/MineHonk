/**
 * V6 phase 5: the End Guardian. 1,000 health and 400 more for each extra
 * player; three phases whose every attack is named and shown first; core
 * windows that take half as much again; an arena whose dropped tiles come
 * back (with the lower floor under every one of them); a reset when everyone
 * leaves; a re-forming after seven days; the Guardian Core on each player's
 * first defeat; a victory title and never an ending.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { CITADEL, type CitadelPlan } from '../../src/common/endExpansion/citadel';
import { GUARDIAN } from '../../src/common/endExpansion/guardian';
import { DAY } from '../../src/common/endExpansion/events';
import { S, STATE_BLOCK, STATE_SOLID, blocks, getProp } from '../../src/common/registry/blocks';
import { stackOf, itemIdOf } from '../../src/common/game/itemstack';
import { Mob } from '../../src/server/entity/Mob';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { DamageInfo } from '../../src/server/systems/Survival';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

async function arenaWorld(seed: string, storage = new MemoryStorage()): Promise<{ server: GameServer; plan: CitadelPlan }> {
  const { server } = await makeServer({ seed }, storage);
  await server.citadel!.ready;
  return { server, plan: server.citadel!.plan! };
}

/** Players standing on the arena (its chunks loaded). */
async function inArena(server: GameServer, plan: CitadelPlan, names: string[], mode: 'survival' | 'creative' = 'survival'): Promise<ServerPlayer[]> {
  const out: ServerPlayer[] = [];
  const [cx, cy, cz] = plan.arena.center;
  for (const [i, n] of names.entries()) {
    const { player } = await join(server, n, 'uuid-' + n, 3);
    server.changeDimension(player, 'end', cx + 4.5 + i, cy, cz + 4.5);
    out.push(player);
  }
  await settle(server, 160);
  for (const [i, p] of out.entries()) {
    server.teleport(p, cx + 4.5 + i, cy, cz + 4.5);
    p.gamemode = mode;
    p.spawnProtection = 0;
  }
  await settle(server, 5);
  return out;
}

const idAt = (server: GameServer, x: number, y: number, z: number): string => blocks[STATE_BLOCK[server.dim('end').getState(x, y, z)]!]!.id;

function floorCells(plan: CitadelPlan): [number, number, number][] {
  const out: [number, number, number][] = [];
  const [cx, , cz] = plan.arena.center;
  for (let x = cx - plan.arena.radius; x <= cx + plan.arena.radius; x++) for (let z = cz - plan.arena.radius; z <= cz + plan.arena.radius; z++) if (Math.hypot(x - cx, z - cz) <= plan.arena.radius) out.push([x, plan.arena.y, z]);
  return out;
}

describe('the arena', () => {
  it('has a lower floor under every tile of the platform, and stairs back up', async () => {
    const { plan } = await arenaWorld('guardian-arena');
    for (const [x, , z] of floorCells(plan)) {
      expect(blocks[STATE_BLOCK[plan.blockAt(x, plan.arena.y, z)!]!]!.id).toBe('guardian_floor');
      const low = plan.blockAt(x, plan.arena.low, z);
      expect(low !== null && STATE_SOLID[low]).toBeTruthy();
      // Nothing in between to land on awkwardly: a clean drop of the gap's height
      for (let y = plan.arena.low + 1; y < plan.arena.y; y++) expect(plan.blockAt(x, y, z) ?? 0).toBe(0);
    }
    // Stairs: steps rising one at a time from the lower floor to the platform's height
    const X = plan.x;
    const Z = plan.z;
    for (let i = 0; i < 8; i++) expect(blocks[STATE_BLOCK[plan.blockAt(X + 15, CITADEL.arenaLow + 1 + i, Z + 8 - i)!]!]!.id).toBe('citadel_tiles');
    // The altar starts charged
    expect(getProp(plan.blockAt(...plan.arena.altar)!, 'charged')).toBe('true');
  }, 60000);
});

describe('the fight', () => {
  it('1,000 health (+400 per extra player), armor 16, never knocked back; it wakes at the charged altar', async () => {
    const { server, plan } = await arenaWorld('guardian-hp');
    const [a] = await inArena(server, plan, ['A', 'B', 'C']);
    const g = server.guardian!;
    const altar = plan.arena.altar;
    server.citadel!.useBlock(a!, altar[0], altar[1], altar[2], server.dim('end').getState(...altar));
    expect(g.fight).toBeTruthy();
    const m = g.fight!.boss;
    expect(m.maxHealth).toBe(GUARDIAN.health + 2 * GUARDIAN.perPlayer);
    expect(m.def.armor).toBe(16);
    expect(m.def.knockbackRes).toBe(1);
  }, 120000);

  it('every attack of every phase is named and shown at least 24 ticks before it hits; phases at 66% and 33%', async () => {
    const { server, plan } = await arenaWorld('guardian-phases');
    const [p] = await inArena(server, plan, ['Solo']);
    const g = server.guardian!;
    expect(g.begin(p!, false)).toBe(true);
    const conn = p!.conn as unknown as { received: { t: string; kind?: string; text?: string; ticks?: number }[] };
    const hits: number[] = [];
    const s = server.interaction.survival;
    const orig = s.damage.bind(s);
    s.damage = (q: ServerPlayer, n: number, info: DamageInfo): number => {
      if (info.source === 'guardian' && q === p) hits.push(server.tickNo);
      return orig(q, n, info);
    };
    const warns: number[] = [];
    let seen = conn.received.length;
    const banners = new Set<string>();
    const run = (ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        p!.health = 20;
        p!.dead = false;
        // Standing still in the open (no dodging)
        server.teleport(p!, plan.arena.center[0] + 4.5, plan.arena.y + 1, plan.arena.center[2] + 4.5);
        tick(server, 1);
        for (const m of conn.received.slice(seen)) {
          if (m.t !== 'fx') continue;
          if (m.kind === 'warn_beam' || m.kind === 'warn_cracks' || m.kind === 'warn_circle') warns.push(server.tickNo);
          if (m.kind === 'hack' && m.text) banners.add(m.text);
        }
        seen = conn.received.length;
      }
    };
    const m = g.fight!.boss;
    run(900);
    expect(g.fight!.phase).toBe(1);
    m.health = m.maxHealth * 0.6;
    run(900);
    expect(g.fight!.phase).toBe(2);
    m.health = m.maxHealth * 0.3;
    run(1200);
    expect(g.fight!.phase).toBe(3);
    for (const name of ['VOID SHIFT', 'CORE EXPOSED', 'CRYSTAL LANCE', 'GROUND FRACTURE', 'CRYSTAL SHIELD']) expect(banners.has(name)).toBe(true);
    expect([...banners].some((b) => b === 'COLLAPSE' || b === 'JUMP OR DUCK')).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(warns.some((w) => h - w >= 24)).toBe(true);
  }, 180000);

  it('core windows: after every fourth attack it kneels and takes half as much again; the shield halves it', async () => {
    const { server, plan } = await arenaWorld('guardian-core');
    const [p] = await inArena(server, plan, ['Solo']);
    const g = server.guardian!;
    g.begin(p!, false);
    const f = g.fight!;
    const m = f.boss;
    let exposed = false;
    for (let i = 0; i < 1500 && !exposed; i++) {
      p!.health = 20;
      tick(server, 1);
      exposed = f.state === 'exposed';
    }
    expect(exposed).toBe(true);
    expect(g.scaleDamage(m, 10, { source: 'player', attacker: p! })).toBeCloseTo(10 * GUARDIAN.exposedFactor);
    tick(server, GUARDIAN.windowTicks + 2);
    expect(f.state).toBe('fight');
    expect(g.scaleDamage(m, 10, { source: 'player', attacker: p! })).toBeCloseTo(10);
    // Phase 2's pylons: half damage until they are broken
    m.health = m.maxHealth * 0.6;
    for (let i = 0; i < 60 && !f.pylons.length; i++) tick(server, 1);
    expect(f.pylons.length).toBe(4);
    for (let i = 0; i < 50 && f.state !== 'fight'; i++) tick(server, 1);
    expect(g.scaleDamage(m, 10, { source: 'player', attacker: p! })).toBeCloseTo(10 * GUARDIAN.shieldFactor);
    for (const pm of f.pylons) pm.hurt(1000, { source: 'player', attacker: p! });
    tick(server, 2);
    expect(g.scaleDamage(m, 10, { source: 'player', attacker: p! })).toBeCloseTo(10);
  }, 180000);

  it('a Ground Fracture drops its tiles for three seconds, then they come back', async () => {
    const { server, plan } = await arenaWorld('guardian-fracture');
    const [p] = await inArena(server, plan, ['Solo']);
    const g = server.guardian!;
    g.rng = { next: () => 0.3, int: (n: number) => (n === 4 ? 1 : 0), chance: () => false };
    g.begin(p!, false);
    const cells = floorCells(plan);
    let dropped = false;
    for (let i = 0; i < 600 && !dropped; i++) {
      p!.health = 20;
      tick(server, 1);
      dropped = cells.some((c) => idAt(server, ...c) === 'air');
    }
    expect(dropped).toBe(true);
    expect((server.level.flags.guardianRestore as unknown[]).length).toBeGreaterThan(0);
    tick(server, GUARDIAN.fractureDrop + 5);
    expect(cells.filter((c) => idAt(server, ...c) === 'air').length).toBeLessThan(cells.length);
    // Ended: every tile back, nothing left to restore
    g.reset();
    expect(cells.every((c) => idAt(server, ...c) === 'guardian_floor')).toBe(true);
    expect(server.level.flags.guardianRestore).toBeUndefined();
  }, 120000);

  it('resets a minute after everyone has gone (the arena back, the altar still charged)', async () => {
    const { server, plan } = await arenaWorld('guardian-abandon');
    const [p] = await inArena(server, plan, ['Solo']);
    const g = server.guardian!;
    g.begin(p!, false);
    tick(server, 200);
    server.teleport(p!, plan.x + 0.5, CITADEL.islandTop + 1, plan.z + 0.5);
    tick(server, GUARDIAN.resetTicks + 20);
    expect(g.fight).toBeNull();
    expect(g.state.charged).toBe(true);
    expect(floorCells(plan).every((c) => idAt(server, ...c) === 'guardian_floor')).toBe(true);
    expect(server.dim('end').entitiesNear(plan.arena.center[0], plan.arena.y, plan.arena.center[2], 30).some((e) => e instanceof Mob && e.type === 'end_guardian' && !e.removed)).toBe(false);
  }, 120000);
});

describe('its defeat', () => {
  it('a victory title, never an ending; the Core on each player\'s first defeat only; it re-forms after seven days for four shards', async () => {
    const { server, plan } = await arenaWorld('guardian-defeat');
    const [p] = await inArena(server, plan, ['Solo']);
    const g = server.guardian!;
    const endingsBefore = JSON.stringify(server.endings?.state ?? {});
    const kill = (): void => {
      const f = g.fight!;
      for (let i = 0; i < 80 && f.state !== 'fight'; i++) tick(server, 1);
      f.boss.hurt(f.boss.health * 4, { source: 'player', attacker: p! });
      tick(server, 70);
    };
    expect(g.begin(p!, false)).toBe(true);
    kill();
    expect(g.fight).toBeNull();
    const conn = p!.conn as unknown as { received: { t: string; text?: string }[] };
    expect(conn.received.some((m) => m.t === 'title' && m.text === 'THE END GUARDIAN HAS FALLEN')).toBe(true);
    expect(p!.achievements.has('defeat_end_guardian')).toBe(true);
    expect(p!.achievements.has('guardian_no_final_lance')).toBe(true);
    expect(JSON.stringify(server.endings?.state ?? {})).toBe(endingsBefore);
    const count = (id: string): number => {
      let n = 0;
      for (let i = 0; i < p!.inventory.size; i++) {
        const s = p!.inventory.get(i);
        if (s && itemIdOf(s) === id) n += s.count;
      }
      return n;
    };
    expect(count('guardian_core')).toBe(1);
    expect(count('end_guardian_head')).toBe(1);
    // The altar is spent; it re-forms only after seven days
    const altar = plan.arena.altar;
    const dim = server.dim('end');
    expect(getProp(dim.getState(...altar), 'charged')).toBe('false');
    server.citadel!.useBlock(p!, altar[0], altar[1], altar[2], dim.getState(...altar));
    expect(g.fight).toBeNull();
    server.level.time += GUARDIAN.respawnDays * DAY;
    // Four shards, one at a time
    p!.selectedSlot = 8;
    p!.inventory.set(8, stackOf('eclipse_shard', 4));
    for (let i = 0; i < 3; i++) server.citadel!.useBlock(p!, altar[0], altar[1], altar[2], dim.getState(...altar));
    expect(g.fight).toBeNull();
    server.citadel!.useBlock(p!, altar[0], altar[1], altar[2], dim.getState(...altar));
    expect(g.fight).toBeTruthy();
    // A second defeat: the Core only by its 25% chance (here: not)
    g.rng = { next: () => 0.99, int: () => 0, chance: () => false };
    kill();
    expect(g.fight).toBeNull();
    expect(g.state.defeats).toBe(2);
    expect(count('guardian_core')).toBe(1);
    expect(count('end_guardian_head')).toBe(2);
  }, 180000);

  it('a forced defeat (Admin Panel) gives nothing; a fight is never saved: a restart leaves the altar charged', async () => {
    const storage = new MemoryStorage();
    const { server, plan } = await arenaWorld('guardian-save', storage);
    const [p] = await inArena(server, plan, ['Solo']);
    const g = server.guardian!;
    g.begin(p!, true);
    tick(server, 80);
    g.forceDefeat();
    tick(server, 70);
    expect(p!.achievements.has('defeat_end_guardian')).toBe(false);
    for (let i = 0; i < p!.inventory.size; i++) expect(p!.inventory.get(i) && itemIdOf(p!.inventory.get(i)!) === 'guardian_core').toBeFalsy();
    // Mid-fight restart
    g.reset();
    g.begin(p!, false);
    tick(server, 300);
    await server.stop();
    const { GameServer } = await import('../../src/server/GameServer');
    const { installGameplay } = await import('../../src/server/gameplay');
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    s2.level.rules.doMobSpawning = false;
    await s2.citadel!.ready;
    expect(s2.guardian!.fight).toBeNull();
    expect(s2.guardian!.state.charged).toBe(true);
    const { player: p2 } = await join(s2, 'Solo', 'uuid-Solo', 3);
    await settle(s2, 160);
    expect(s2.dim('end').entitiesNear(plan.arena.center[0], plan.arena.y, plan.arena.center[2], 30).some((e) => e instanceof Mob && e.type === 'end_guardian')).toBe(false);
    expect(floorCells(plan).every((c) => !s2.dim('end').isLoaded(c[0], c[2]) || blocks[STATE_BLOCK[s2.dim('end').getState(...c)]!]!.id === 'guardian_floor')).toBe(true);
    void p2;
    void S;
  }, 180000);
});
