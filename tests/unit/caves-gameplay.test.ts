/** V2 cave gameplay: admin cave finder, admin Warden, cave spawning, cave advancements, Silent Stride. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { S, STATE_SOLID } from '../../src/common/registry/blocks';
import { itemById } from '../../src/common/registry/items';
import { newBody, stepMovement, type BlockAccess } from '../../src/common/physics/movement';
import { createGenerator } from '../../src/common/gen/generator';
import { seedFromString, Random } from '../../src/common/math/rng';
import { selectEnchantments } from '../../src/common/game/enchanting';
import { rollLoot } from '../../src/common/game/loot';
import { stackOf } from '../../src/common/game/itemstack';
import { Mob } from '../../src/server/entity/Mob';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

type Result = { req: number; ok: boolean; text: string; data?: Record<string, unknown> };
let reqNo = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): number {
  const req = reqNo++;
  server.handle(conn, { t: 'admin', req, action } as never);
  return req;
}
function result(conn: FakeConn, req: number): Result | undefined {
  return (conn.of('admin_result') as Result[]).filter((r) => r.req === req).pop();
}
async function settle(server: GameServer, cond: () => boolean, maxTicks = 4000): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (cond()) return true;
    tick(server, 1);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return cond();
}
const done = (conn: FakeConn, req: number) => (): boolean => result(conn, req)?.data?.teleported === true || result(conn, req)?.ok === false;

describe('admin cave finder', () => {
  it('lists cave features only for Caves Update worlds', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn } = await join(server);
    const req = admin(server, conn, { a: 'catalog' });
    const cat = result(conn, req)!.data as { caves?: Record<string, { id: string }[]>; structures: Record<string, string[]> };
    expect(cat.caves?.overworld?.map((c) => c.id)).toEqual(expect.arrayContaining(['deep_dark', 'lush_caves', 'mega_cavern', 'ravine']));
    expect(cat.caves?.nether).toBeUndefined();
    expect(cat.structures.overworld).toContain('ancient_city');
    expect(createGenerator('overworld', 1, { version: 1 }).caves).toBe(false);
    const bad = admin(server, conn, { a: 'locate_biome', dim: 'nether', biome: 'cave:deep_dark' });
    expect(result(conn, bad)!.ok).toBe(false);
  });

  it('teleports into the deep dark without granting cave advancements', async () => {
    const { server } = await makeServer({ cheats: true, seed: 'admin-deep-dark' });
    const { conn, player } = await join(server);
    const tp = admin(server, conn, { a: 'tp_biome', dim: 'overworld', biome: 'cave:deep_dark' });
    expect(await settle(server, done(conn, tp), 8000)).toBe(true);
    expect(result(conn, tp)!.ok).toBe(true);
    const bx = Math.floor(player.x);
    const by = Math.floor(player.y);
    const bz = Math.floor(player.z);
    expect(by).toBeLessThan(40);
    expect(server.overworld.generator.caveBiomeAt!(bx, by + 1, bz)).toBe(9);
    expect(STATE_SOLID[player.dim.getState(bx, by - 1, bz)]).toBe(1);
    expect(STATE_SOLID[player.dim.getState(bx, by, bz)]).toBe(0);
    tick(server, 40);
    // The client is told it is in the deep dark, but the visit doesn't count
    expect(conn.last('cave_biome')?.id).toBe(9);
    expect(player.achievements.has('enter_cave_biome')).toBe(false);
    expect(player.visitedCaveBiomes.size).toBe(0);
  });

  it('finds the nearest mega-cavern', async () => {
    const { server } = await makeServer({ cheats: true, seed: 'admin-mega' });
    const { conn } = await join(server);
    const req = admin(server, conn, { a: 'locate_biome', dim: 'overworld', biome: 'cave:mega_cavern' });
    expect(await settle(server, () => !!result(conn, req))).toBe(true);
    const r = result(conn, req)!;
    expect(r.ok).toBe(true);
    const d = r.data as { x: number; y: number; z: number; name: string };
    expect(d.name).toBe('Mega-Cavern');
    expect(server.overworld.generator.inMegaCavern!(d.x, d.y + 1, d.z)).toBe(true);
  });

  it('spawns an admin-marked Warden that emerges from the ground', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const req = admin(server, conn, { a: 'spawn', mob: 'warden', count: 1 });
    expect(result(conn, req)!.ok).toBe(true);
    const w = [...player.dim.entities.values()].find((e): e is Mob => e instanceof Mob && e.type === 'warden');
    expect(w).toBeDefined();
    expect(w!.admin).toBe(true);
    expect(w!.data.untouchable).toBe(true);
  });
});

describe('cave spawning', () => {
  it('cave biomes decide who lives underground, and nothing spawns in the deep dark', async () => {
    const { server } = await makeServer({ seed: 'cave-spawns' });
    const { player } = await join(server, 'Tester', 'uuid-t', 6);
    server.level.dayTime = 6000;
    const g = server.overworld.generator;
    const mobs = server.mobs as unknown as { trySpawnAround(p: ServerPlayer, cat: string): void };
    const all: { type: string; cb: number; y: number }[] = [];
    for (let i = 0; i < 9000 && all.length < 300; i++) {
      const before = new Set(player.dim.entities.values());
      mobs.trySpawnAround(player, ['monster', 'creature', 'water'][i % 3]!);
      for (const e of player.dim.entities.values()) {
        if (!(e instanceof Mob) || before.has(e)) continue;
        all.push({ type: e.type, cb: e.y < 60 ? g.caveBiomeAt!(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) : 0, y: e.y });
        e.dead = true;
        player.dim.removeEntity(e);
      }
    }
    const under = all.filter((m) => m.cb);
    expect(under.length).toBeGreaterThan(20);
    for (const m of under) {
      expect(m.cb).not.toBe(9);
      if (m.type === 'crystal_mite') expect(m.cb).toBe(5);
      if (m.type === 'sporeling') expect(m.cb).toBe(4);
      if (m.type === 'axolotl') expect(m.cb).toBe(3);
    }
    // No cave-only mob ever appears on the surface
    for (const m of all.filter((q) => !q.cb)) expect(['crystal_mite', 'sporeling', 'glow_squid']).not.toContain(m.type);
  });
});

describe('cave advancements', () => {
  it('walking into a cave biome grants Into the Depths', async () => {
    const { server } = await makeServer({ seed: 'cave-adv' });
    const { player } = await join(server);
    const g = server.overworld.generator;
    // Stand in an open cave spot found by the generator's own cave finder
    const it = (g as unknown as { caveSteps(k: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null> }).caveSteps('lush_caves', Math.floor(player.x), Math.floor(player.z));
    let r = it.next();
    while (!r.done) r = it.next();
    const spot = r.value!;
    expect(spot).toBeTruthy();
    player.dim.want(spot.x >> 4, spot.z >> 4, 1, server.tickNo);
    await (async () => {
      for (let i = 0; i < 200 && !player.dim.isLoaded(spot.x, spot.z); i++) {
        tick(server, 1);
        await new Promise((res) => setTimeout(res, 0));
      }
    })();
    server.teleport(player, spot.x + 0.5, spot.y, spot.z + 0.5);
    tick(server, 45);
    expect(player.caveBiome).toBe(3);
    expect(player.achievements.has('enter_cave_biome')).toBe(true);
    expect(player.visitedCaveBiomes.has(3)).toBe(true);
  });

  it('picking up a Silent Stride book grants its advancement; admin books do not', async () => {
    const { server } = await makeServer({ cheats: true });
    const { player, conn } = await join(server);
    const book = { ...stackOf('enchanted_book'), tag: { stored: { silent_stride: 2 } } };
    admin(server, conn, { a: 'give', item: 'enchanted_book', count: 1, enchant: 'silent_stride', level: 2 });
    expect(player.achievements.has('silent_stride')).toBe(false);
    server.interaction.onItemPickedUp(player, book);
    expect(player.achievements.has('silent_stride')).toBe(true);
  });
});

describe('Silent Stride', () => {
  const stone = (): number => S('stone');
  const w = (): BlockAccess => {
    const st = stone();
    return { getState: (_x, y) => (y < 64 ? st : 0), isLoaded: () => true };
  };
  const walk = (sneakSpeed?: number): number => {
    const world = w();
    const b = newBody(0.5, 64, 0.5);
    const opts = { flying: false, noClip: false, walkSpeed: 0.1, flySpeed: 0.05, sneakSpeed };
    for (let i = 0; i < 3; i++) stepMovement(world, b, { forward: 0, strafe: 0, jump: false, sneak: true, sprint: false, yaw: 0 }, opts, 1.62);
    const z0 = b.z;
    for (let i = 0; i < 60; i++) stepMovement(world, b, { forward: 1, strafe: 0, jump: false, sneak: true, sprint: false, yaw: 0 }, opts, 1.62);
    return Math.abs(b.z - z0);
  };

  it('lets a sneaking player move faster', () => {
    const plain = walk();
    const stride3 = walk(0.3 + 0.15 * 3);
    expect(stride3 / plain).toBeGreaterThan(2);
  });

  it('is never offered by the enchanting table or random loot, only by the Ancient City', () => {
    const rng = new Random(seedFromString('silent'));
    const legs = stackOf('diamond_leggings');
    for (let i = 0; i < 400; i++) expect(selectEnchantments(rng, legs, 30, true).silent_stride).toBeUndefined();
    let found = 0;
    for (let i = 0; i < 60; i++) {
      for (const s of rollLoot('chest/ancient_city_vault', { rng })) if (s.tag?.stored?.silent_stride || s.tag?.ench?.silent_stride) found++;
    }
    expect(found).toBeGreaterThan(0);
    expect(itemById.get('resonance_charm')).toBeDefined();
  });
});
