/**
 * V6 phase 5: the Void Citadel. One per world, chosen from the seed in the
 * Void Wastes (an old world skips any site with a chunk already made); built
 * through the generator; six floors (every kind at least once) each sealed
 * until its objective is done; Citadel Stone that cannot be broken; anchors
 * that set the respawn point; and progress kept with the world.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { CITADEL, FLOOR_KINDS, citadelCandidates, citadelChunks, citadelFloorAt, planCitadel, type CitadelPlan, type FloorSpec } from '../../src/common/endExpansion/citadel';
import { EXPANSION_BIOMES } from '../../src/common/endExpansion/biomes';
import { EndGenerator } from '../../src/common/gen/end';
import { S, STATE_BLOCK, STATE_SOLID, blocks, blockById, getProp } from '../../src/common/registry/blocks';
import { Mob } from '../../src/server/entity/Mob';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

async function citadelWorld(seed: string, storage = new MemoryStorage()): Promise<{ server: GameServer; plan: CitadelPlan }> {
  const { server } = await makeServer({ seed }, storage);
  await server.citadel!.ready;
  const plan = server.citadel!.plan!;
  expect(plan).toBeTruthy();
  return { server, plan };
}

/** A player standing at a place in the Citadel, its chunks loaded. */
async function standAt(server: GameServer, at: [number, number, number], name = 'Tester', mode: 'creative' | 'survival' = 'creative'): Promise<ServerPlayer> {
  let p = [...server.players.values()].find((q) => q.name === name);
  if (!p) p = (await join(server, name, 'uuid-' + name, 3)).player;
  p.gamemode = mode;
  server.changeDimension(p, 'end', at[0] + 0.5, at[1], at[2] + 0.5);
  await settle(server, 150);
  server.teleport(p, at[0] + 0.5, at[1], at[2] + 0.5);
  p.spawnProtection = 0;
  await settle(server, 10);
  return p;
}

const idAt = (server: GameServer, x: number, y: number, z: number): string => blocks[STATE_BLOCK[server.dim('end').getState(x, y, z)]!]!.id;
const doorShut = (server: GameServer, f: FloorSpec): boolean => f.door.every(([x, y, z]) => idAt(server, x, y, z) === 'citadel_door');
const doorOpen = (server: GameServer, f: FloorSpec): boolean => f.door.every(([x, y, z]) => idAt(server, x, y, z) === 'air');
const floorOf = (plan: CitadelPlan, kind: string): FloorSpec => plan.floors.find((f) => f.kind === kind)!;

describe('placement', () => {
  it('one per world, from the seed, in the Void Wastes of the deep band', async () => {
    const a = await citadelWorld('citadel-place');
    const b = await citadelWorld('citadel-place');
    expect([a.plan.x, a.plan.z]).toEqual([b.plan.x, b.plan.z]);
    expect(a.server.level.flags.citadel).toBeTruthy();
    const d = Math.hypot(a.plan.x, a.plan.z);
    expect(d).toBeGreaterThanOrEqual(CITADEL.minR - 1);
    expect(d).toBeLessThanOrEqual(CITADEL.maxR + 1);
    const ex = (a.server.dim('end').generator as EndGenerator).terrain.expansion;
    expect(EXPANSION_BIOMES[ex.regionAt(a.plan.x, a.plan.z).biome]!.id).toBe('void_wastes');
    // Every kind of floor at least once, six floors
    expect(a.plan.floors.length).toBe(6);
    for (const k of FLOOR_KINDS) expect(a.plan.floors.some((f) => f.kind === k)).toBe(true);
    // The plan is pure: the same seed and site, the same blocks
    const again = planCitadel(a.server.level.seedNum, { x: a.plan.x, z: a.plan.z });
    for (let i = 0; i < 400; i++) {
      const x = a.plan.x - 20 + ((i * 7) % 41);
      const z = a.plan.z - 20 + ((i * 13) % 41);
      const y = 20 + ((i * 11) % 110);
      expect(again.blockAt(x, y, z)).toBe(a.plan.blockAt(x, y, z));
    }
  }, 120000);

  it('an old world skips a site where any chunk already exists, and never overwrites one', async () => {
    const first = await citadelWorld('citadel-old');
    const site = [first.plan.x, first.plan.z];
    // The same seed, but a chunk inside that footprint was made before (an older version's world)
    const storage = new MemoryStorage();
    const [cx, cz] = citadelChunks({ x: site[0]!, z: site[1]! })[3]!;
    storage.chunks.set(`end:${cx}:${cz}`, new Uint8Array([1, 2, 3]));
    const second = await citadelWorld('citadel-old', storage);
    expect([second.plan.x, second.plan.z]).not.toEqual(site);
    for (const [x, z] of citadelChunks({ x: second.plan.x, z: second.plan.z })) expect(storage.chunks.has(`end:${x}:${z}`)).toBe(false);
    // ... it is still a candidate further along the seed's list
    const cands = [...citadelCandidates(second.server.level.seedNum)].slice(0, CITADEL.maxCandidates);
    expect(cands.some((c) => c.x === second.plan.x && c.z === second.plan.z)).toBe(true);
  }, 120000);

  it('worlds made before the Expanded End get no Citadel (their End stays classic)', async () => {
    const { makeServerAt } = await import('../helpers/testServer');
    const { EXPANSION_GENERATOR } = await import('../../src/common/endExpansion/region');
    const { server } = await makeServerAt(EXPANSION_GENERATOR - 1, { seed: 'citadel-classic' });
    await server.citadel!.ready;
    expect(server.citadel!.plan).toBeNull();
    expect(server.level.flags.citadel === undefined || (server.level.flags.citadel as { site: unknown }).site === null).toBe(true);
  }, 60000);
});

describe('the structure', () => {
  it('is built where the plan says, in unbreakable Citadel Stone; the doors are sealed; a title once', async () => {
    const { server, plan } = await citadelWorld('citadel-build');
    const p = await standAt(server, [plan.entrance[0] + 3, plan.entrance[1], plan.entrance[2] + 3], 'Tester', 'survival');
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const x = plan.x - 18 + ((i * 7) % 37);
      const z = plan.z - 18 + ((i * 11) % 37);
      const y = plan.floors[0]!.y + ((i * 5) % 12);
      if (!server.dim('end').isLoaded(x, z)) continue;
      const want = plan.blockAt(x, y, z);
      if (want === null) continue;
      expect(server.dim('end').getState(x, y, z)).toBe(want);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    for (const id of ['citadel_stone', 'citadel_bricks', 'citadel_pillar', 'citadel_tiles', 'citadel_door', 'citadel_glass']) expect(blockById.get(id)!.def.hardness).toBe(-1);
    // A title once, the advancement
    await settle(server, 20);
    const titles = (p.conn as unknown as { received: { t: string; text?: string }[] }).received.filter((m) => m.t === 'title' && m.text === 'THE VOID CITADEL');
    expect(titles.length).toBe(1);
    expect(p.achievements.has('find_void_citadel')).toBe(true);
    await standAt(server, plan.floors[0]!.anchor.map((v, i) => (i === 1 ? v + 1 : v)) as [number, number, number], 'Tester', 'survival');
    expect(doorShut(server, plan.floors[0]!)).toBe(true);
  }, 120000);
});

describe('every kind of floor can be solved, and its door opens only then', () => {
  it('Glyph Lock: a wrong key resets the lock and wakes a Sentinel; the mural order opens it', async () => {
    const { server, plan } = await citadelWorld('citadel-glyph');
    const f = floorOf(plan, 'glyph');
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    const c = server.citadel!;
    const press = (g: number): void => {
      const k = f.keys!.find((q) => q.glyph === g)!;
      c.useBlock(p, k.at[0], k.at[1], k.at[2], server.dim('end').getState(...k.at));
    };
    const wrong = [0, 1, 2, 3, 4, 5, 6, 7].find((g) => g !== f.sequence![0])!;
    press(f.sequence![0]!);
    press(wrong);
    const sentinels = (): number => server.dim('end').entitiesNear(f.sentinelAt![0], f.sentinelAt![1], f.sentinelAt![2], 24).filter((e) => e instanceof Mob && e.type === 'guardian_sentinel').length;
    expect(sentinels()).toBeGreaterThan(0);
    expect(f.keys!.every((k) => idAt(server, ...k.at) === 'citadel_glyph_key')).toBe(true);
    expect(doorShut(server, f)).toBe(true);
    for (const g of f.sequence!.slice(0, -1)) press(g);
    expect(doorShut(server, f)).toBe(true);
    press(f.sequence![f.sequence!.length - 1]!);
    expect(doorOpen(server, f)).toBe(true);
    expect(c.state.floors[f.index]!.done).toBe(true);
    expect(p.achievements.has('clear_citadel_glyph')).toBe(true);
  }, 120000);

  it('Crystal Sequence: watch, then repeat (4-7 steps)', async () => {
    const { server, plan } = await citadelWorld('citadel-crystal');
    const f = floorOf(plan, 'crystal');
    expect(f.pattern!.length).toBeGreaterThanOrEqual(4);
    expect(f.pattern!.length).toBeLessThanOrEqual(7);
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    const c = server.citadel!;
    const dim = server.dim('end');
    const use = (at: [number, number, number]): boolean => c.useBlock(p, at[0], at[1], at[2], dim.getState(...at));
    // Pressing before watching: nothing
    use(f.pedestals![f.pattern![0]!]!);
    expect(c.state.floors[f.index]!.done).toBe(false);
    use(f.beacon!);
    // The pedestals light in the pattern's order
    const seen: number[] = [];
    let lit = -1;
    for (let i = 0; i < f.pattern!.length * 20 + 12; i++) {
      tick(server, 1);
      const now = f.pedestals!.findIndex((at) => getProp(dim.getState(...at), 'lit') === 'true');
      if (now >= 0 && now !== lit) seen.push(now);
      lit = now;
    }
    expect(seen.slice(0, f.pattern!.length)).toEqual(f.pattern);
    for (const i of f.pattern!) use(f.pedestals![i]!);
    expect(doorOpen(server, f)).toBe(true);
  }, 120000);

  it('Combat: the hall cleared (Constructs and every Void Stalker out of the rifts, each rift marked first)', async () => {
    const { server, plan } = await citadelWorld('citadel-combat');
    const f = floorOf(plan, 'combat');
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    const dim = server.dim('end');
    const conn = p.conn as unknown as { received: { t: string; kind?: string; ticks?: number }[] };
    let stalkers = 0;
    for (let i = 0; i < 2400 && !server.citadel!.state.floors[f.index]!.done; i++) {
      tick(server, 1);
      for (const e of dim.entitiesNear(plan.x, f.y + 4, plan.z, 30)) {
        if (!(e instanceof Mob) || e.dead || e.data.citadelFloor !== f.index) continue;
        if (e.type === 'void_stalker') stalkers++;
        e.hurt(e.health + 1000, { source: 'player', attacker: p });
      }
      if (i < 50) expect(doorShut(server, f)).toBe(true);
    }
    expect(server.citadel!.state.floors[f.index]!.done).toBe(true);
    expect(stalkers).toBe(f.stalkers);
    expect(conn.received.filter((m) => m.t === 'fx' && m.kind === 'warn_circle' && (m.ticks ?? 0) >= 24).length).toBeGreaterThanOrEqual(f.stalkers!);
    expect(doorOpen(server, f)).toBe(true);
  }, 180000);

  it('Parkour: a route exists from the start to the far landing (a search over the plan), and reaching it opens the door', async () => {
    const { server, plan } = await citadelWorld('citadel-parkour');
    const f = floorOf(plan, 'parkour');
    const Y = f.y;
    // Walkable: a solid block at the route's level with two free blocks above (bridges and every place a mover goes count)
    const solid = (x: number, y: number, z: number): boolean => {
      const s = plan.blockAt(x, y, z);
      return s !== null && !!STATE_SOLID[s];
    };
    const free = (x: number, y: number, z: number): boolean => !solid(x, y, z) && (plan.blockAt(x, y, z) === null || blocks[STATE_BLOCK[plan.blockAt(x, y, z)!]!]!.id !== 'citadel_door');
    const walk = new Set<string>();
    for (let x = plan.x - 28; x <= plan.x + 28; x++)
      for (let z = plan.z - 28; z <= plan.z + 28; z++) {
        const bridge = f.bridges!.some((b) => b.cells.some((c) => c[0] === x && c[2] === z));
        if ((solid(x, Y, z) || bridge) && free(x, Y + 1, z) && free(x, Y + 2, z)) walk.add(`${x},${z}`);
      }
    for (const mv of f.movers!) for (let o = 0; o <= mv.length; o++) for (const c of mv.cells) walk.add(mv.axis === 'x' ? `${c[0] + o * mv.dir},${c[2]}` : `${c[0]},${c[2] + o * mv.dir}`);
    const start = `${f.start![0]},${f.start![2]}`;
    expect(walk.has(start)).toBe(true);
    const cells = [...walk].map((k) => k.split(',').map(Number) as [number, number]);
    const seen = new Set([start]);
    const queue = [f.start![0] + ',' + f.start![2]];
    let reached = false;
    while (queue.length) {
      const [x, z] = queue.shift()!.split(',').map(Number) as [number, number];
      if (x >= f.finish!.x0 && x <= f.finish!.x1 && z >= f.finish!.z0 && z <= f.finish!.z1) {
        reached = true;
        break;
      }
      for (const [nx, nz] of cells) {
        const k = `${nx},${nz}`;
        if (seen.has(k)) continue;
        // A jump of up to three blocks of gap (generous: a running jump clears four)
        if (Math.hypot(nx - x, nz - z) > 4.01) continue;
        seen.add(k);
        queue.push(k);
      }
    }
    expect(reached).toBe(true);
    // The way out over the void is real void (a fall still kills)
    for (let y = Y - 1; y > 0; y--) expect(plan.blockAt(f.start![0], y, f.start![2] + 3) ?? 0).toBe(0);
    // Reaching the landing opens the door
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    expect(doorShut(server, f)).toBe(true);
    server.teleport(p, (f.finish!.x0 + f.finish!.x1) / 2 + 0.5, Y + 1, (f.finish!.z0 + f.finish!.z1) / 2 + 0.5);
    await settle(server, 10);
    expect(doorOpen(server, f)).toBe(true);
  }, 180000);

  it('Engineering: the socket checks every lever combination against the rule; only a right circuit opens it', async () => {
    const { server, plan } = await citadelWorld('citadel-eng');
    const f = floorOf(plan, 'engineering');
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    const c = server.citadel!;
    const dim = server.dim('end');
    // A dark socket refuses
    c.useBlock(p, f.socket![0], f.socket![1], f.socket![2], dim.getState(...f.socket!));
    expect(c.state.floors[f.index]!.done).toBe(false);
    // Bridge the broken conduits with the player's own cable: the core's power reaches the socket
    const at = (cx: number, cz: number): [number, number, number] => [plan.x + f.m * cx, f.y + 1, plan.z + f.m * cz];
    const path: [number, number, number][] = [];
    for (let cx = -7; cx <= 9; cx++) path.push(at(cx, 6));
    for (let cz = 7; cz <= 11; cz++) path.push(at(9, cz));
    path.push(at(10, 11));
    let bridged = 0;
    for (const q of path)
      if (idAt(server, ...q) === 'air') {
        dim.setBlock(q[0], q[1], q[2], S('insulated_cable'));
        bridged++;
      }
    expect(bridged).toBeGreaterThan(0);
    const be = (): { powered?: boolean } | undefined => server.engineering!.node(dim, ...f.socket!)?.be() as { powered?: boolean } | undefined;
    for (let i = 0; i < 200 && !be()?.powered; i++) tick(server, 1);
    expect(be()?.powered).toBe(true);
    const on = (i: number): boolean => getProp(dim.getState(...f.levers![i]!), 'powered') === 'true';
    const power = server.power!;
    const orig = power.powered.bind(power);
    const socketAt = (x: number, y: number, z: number): boolean => x === f.socket![0] && y === f.socket![1] && z === f.socket![2];
    // A wrong circuit (always a signal) is rejected...
    power.powered = (d, x, y, z) => (socketAt(x, y, z) ? true : orig(d, x, y, z));
    c.useBlock(p, f.socket![0], f.socket![1], f.socket![2], dim.getState(...f.socket!));
    tick(server, 200);
    if (!f.rule!.table.every(Boolean)) expect(c.state.floors[f.index]!.done).toBe(false);
    // ... the rule's own circuit (as the player's gates would give it) is accepted after all eight combinations
    power.powered = (d, x, y, z) => (socketAt(x, y, z) ? f.rule!.table[(on(0) ? 1 : 0) | (on(1) ? 2 : 0) | (on(2) ? 4 : 0)]! : orig(d, x, y, z));
    c.useBlock(p, f.socket![0], f.socket![1], f.socket![2], dim.getState(...f.socket!));
    for (let i = 0; i < 200 && !c.state.floors[f.index]!.done; i++) tick(server, 1);
    expect(c.state.floors[f.index]!.done).toBe(true);
    expect(doorOpen(server, f)).toBe(true);
    power.powered = orig;
  }, 120000);
});

describe('anchors, the void and saved progress', () => {
  it('a Citadel Anchor sets the respawn point; the void still kills', async () => {
    const { server, plan } = await citadelWorld('citadel-anchor');
    const f = plan.floors[1]!;
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m], 'Tester', 'survival');
    server.citadel!.useBlock(p, f.anchor[0], f.anchor[1], f.anchor[2], server.dim('end').getState(...f.anchor));
    expect(p.spawnPoint?.block).toEqual(f.anchor);
    // Out over the void and down
    server.teleport(p, plan.x + 40.5, -70, plan.z + 0.5);
    for (let i = 0; i < 80 && !p.dead; i++) tick(server, 1);
    expect(p.dead).toBe(true);
    server.interaction.respawn(p);
    await settle(server, 40);
    expect(p.dim.id).toBe('end');
    expect(Math.hypot(p.x - (f.anchor[0] + 0.5), p.z - (f.anchor[2] + 0.5))).toBeLessThan(3);
    expect(citadelFloorAt(plan, p.x, p.y, p.z)).toBe(1);
  }, 120000);

  it('floors done stay done (and their doors open) after a save and reload; the Admin Panel can reset them', async () => {
    const storage = new MemoryStorage();
    const { server, plan } = await citadelWorld('citadel-save', storage);
    const f = plan.floors[0]!;
    const p = await standAt(server, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    server.citadel!.solve(p);
    expect(doorOpen(server, f)).toBe(true);
    await server.stop();
    const s2 = (await citadelWorld('citadel-save', storage)).server;
    expect(s2.citadel!.state.floors[0]!.done).toBe(true);
    expect([s2.citadel!.plan!.x, s2.citadel!.plan!.z]).toEqual([plan.x, plan.z]);
    await standAt(s2, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
    await settle(s2, 60);
    expect(doorOpen(s2, f)).toBe(true);
    s2.citadel!.reset();
    expect(doorShut(s2, f)).toBe(true);
    expect(s2.citadel!.state.floors[0]!.done).toBe(false);
  }, 180000);
});

describe('together', () => {
  it('Constructs grow tougher with more players on the floor; one player\'s key counts for all', async () => {
    const { server, plan } = await citadelWorld('citadel-mp');
    const f = floorOf(plan, 'combat');
    const at: [number, number, number] = [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m];
    const a = await standAt(server, at, 'A');
    const mobs = (): Mob[] => server.dim('end').entitiesNear(plan.x, f.y + 4, plan.z, 30).filter((e) => e instanceof Mob && !e.dead && e.data.citadelFloor === f.index && e.type !== 'void_stalker') as Mob[];
    await settle(server, 30);
    const solo = mobs()[0]!;
    expect(solo).toBeTruthy();
    const hp1 = solo.maxHealth;
    await standAt(server, at, 'B');
    await standAt(server, at, 'C');
    await settle(server, 30);
    expect(solo.maxHealth).toBeGreaterThan(hp1 * 1.9);
    void a;
    // The glyph floor: B starts it, C finishes it, the door opens for everyone
    const g = floorOf(plan, 'glyph');
    const gat: [number, number, number] = [g.anchor[0] + g.m, g.anchor[1] + 1, g.anchor[2] + g.m];
    const b = await standAt(server, gat, 'B');
    const c = await standAt(server, gat, 'C');
    const dim = server.dim('end');
    g.sequence!.forEach((gl, i) => {
      const k = g.keys!.find((q) => q.glyph === gl)!;
      server.citadel!.useBlock(i % 2 ? c : b, k.at[0], k.at[1], k.at[2], dim.getState(...k.at));
    });
    expect(doorOpen(server, g)).toBe(true);
  }, 240000);
});
