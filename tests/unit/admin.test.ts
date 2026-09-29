/**
 * Admin Panel: authorisation, every admin tool, structure/biome teleports,
 * and the rule that cheats never progress advancements (directly or through
 * a chain of events) while normal play still does.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, FakeConn, hello } from '../helpers/testServer';
import { items, itemById } from '../../src/common/registry/items';
import { stackOf, isAdminStack, type ItemStack } from '../../src/common/game/itemstack';
import { S, STATE_SOLID, STATE_FLUID } from '../../src/common/registry/blocks';
import { Mob } from '../../src/server/entity/Mob';
import { biomeOf } from '../../src/common/registry/biomes';
import { MemoryStorage } from '../../src/server/storage/Storage';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { validateC2S } from '../../src/common/net/validate';

type Result = { req: number; ok: boolean; text: string; data?: Record<string, unknown> };

let reqNo = 1;
/** Sends an admin request through the real message path (validation + authorisation). */
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): number {
  const req = reqNo++;
  server.handle(conn, { t: 'admin', req, action });
  return req;
}
function result(conn: FakeConn, req: number): Result | undefined {
  return (conn.of('admin_result') as Result[]).filter((r) => r.req === req).pop();
}
async function settle(server: GameServer, cond: () => boolean, maxTicks = 2000): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (cond()) return true;
    tick(server, 1);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return cond();
}
function countItem(p: ServerPlayer, id: string): number {
  const num = itemById.get(id)!.num;
  let n = 0;
  for (let i = 0; i < 41; i++) if (p.inventory.get(i)?.id === num) n += p.inventory.get(i)!.count;
  return n;
}
function flat(p: ServerPlayer, r = 6): number {
  const y = Math.floor(p.y);
  for (let x = Math.floor(p.x) - r; x <= Math.floor(p.x) + r; x++)
    for (let z = Math.floor(p.z) - r; z <= Math.floor(p.z) + r; z++) {
      p.dim.setBlock(x, y - 1, z, S('stone'));
      for (let h = 0; h < 4; h++) p.dim.setBlock(x, y + h, z, 0);
    }
  return y;
}

describe('admin authorisation', () => {
  it('is unavailable when cheats are off', async () => {
    const { server } = await makeServer({ cheats: false });
    const { conn, player } = await join(server);
    const req = admin(server, conn, { a: 'give', item: 'diamond', count: 5 });
    expect(result(conn, req)).toMatchObject({ ok: false });
    expect(countItem(player, 'diamond')).toBe(0);
    expect(conn.last('welcome')!.world.admin).toBe(false);
  });

  it('lets the owner of a world with cheats use it', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    expect(conn.last('welcome')!.world.admin).toBe(true);
    const req = admin(server, conn, { a: 'give', item: 'diamond', count: 5 });
    expect(result(conn, req)).toMatchObject({ ok: true });
    expect(countItem(player, 'diamond')).toBe(5);
  });

  it('refuses builders and visitors in multiplayer, allows operators', async () => {
    const { server } = await makeServer({ cheats: true });
    server.level.owner = 'uuid-Owner';
    const owner = await join(server, 'Owner');
    const builder = await join(server, 'Builder');
    const visitor = await join(server, 'Visitor');
    server.level.roles['uuid-Visitor'] = 'visitor';
    for (const who of [builder, visitor]) {
      for (const action of [
        { a: 'give', item: 'diamond_block', count: 64 },
        { a: 'spawn', mob: 'zombie', count: 3 },
        { a: 'gamemode', mode: 'creative' },
        { a: 'weather', kind: 'thunder' },
        { a: 'time', value: 18000 },
        { a: 'tp_structure', dim: 'overworld', structure: 'village' },
        { a: 'xp', mode: 'set', levels: 50 },
        { a: 'set_cheats', on: false },
      ]) {
        const req = admin(server, who.conn, action);
        expect(result(who.conn, req)!.ok).toBe(false);
      }
      expect(countItem(who.player, 'diamond_block')).toBe(0);
      expect(who.player.gamemode).toBe('survival');
      expect(who.player.xpTotal).toBe(0);
    }
    expect(server.level.raining).toBe(false);
    expect(server.level.cheats).toBe(true);
    // Operators may use it
    server.level.operators.push('uuid-Builder');
    const req = admin(server, builder.conn, { a: 'give', item: 'diamond', count: 1 });
    expect(result(builder.conn, req)!.ok).toBe(true);
    // Only the owner changes the cheats setting
    const off = admin(server, builder.conn, { a: 'set_cheats', on: false });
    expect(result(builder.conn, off)!.ok).toBe(false);
    const off2 = admin(server, owner.conn, { a: 'set_cheats', on: false });
    expect(result(owner.conn, off2)!.ok).toBe(true);
    expect(server.level.cheats).toBe(false);
  });

  it('rejects forged or malformed requests before they reach the game', () => {
    expect(validateC2S({ t: 'admin', req: 1, action: { a: 'give', item: 'diamond', count: 99999 } })).toBeNull();
    expect(validateC2S({ t: 'admin', req: 1, action: { a: 'give', item: '../../etc', count: 1 } })).toBeNull();
    expect(validateC2S({ t: 'admin', req: 1, action: { a: 'teleport', x: 0, y: 0, z: 0 } })).toBeNull();
    expect(validateC2S({ t: 'admin', req: 1, action: { a: 'gamemode', mode: 'hardcore' } })).toBeNull();
    expect(validateC2S({ t: 'admin', req: 1, action: { a: 'spawn', mob: 'zombie', count: 5000 } })).toBeNull();
    expect(validateC2S({ t: 'admin', req: 'x', action: { a: 'perf' } })).toBeNull();
    expect(validateC2S({ t: 'admin', req: 1, action: { a: 'perf' } })).not.toBeNull();
  });
});

describe('admin tools', () => {
  it('can give every registered item, with stacks split correctly', async () => {
    const { server } = await makeServer({ cheats: true, mode: 'creative' });
    const { player } = await join(server);
    const failed: string[] = [];
    for (const it of items) {
      if (it.num === 0) continue;
      player.inventory.clear();
      const out = server.admin.give(player, it.id, 1);
      const got = player.inventory.slots.some((s) => s && s.id === it.num && isAdminStack(s));
      if (!out.ok || !got) failed.push(it.id);
    }
    expect(failed).toEqual([]);
    // Quantities above a stack
    player.inventory.clear();
    server.admin.give(player, 'dirt', 200);
    expect(countItem(player, 'dirt')).toBe(200);
    expect(player.inventory.slots.filter((s) => s && s.id === itemById.get('dirt')!.num).map((s) => s!.count).sort((a, b) => b - a)).toEqual([64, 64, 64, 8]);
    // Unstackable items fill slots one by one
    player.inventory.clear();
    server.admin.give(player, 'diamond_sword', 3);
    expect(countItem(player, 'diamond_sword')).toBe(3);
  });

  it('gives potions, enchanted books and enchanted gear with their properties', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    admin(server, conn, { a: 'give', item: 'potion', count: 2, potion: 'strong_healing' });
    admin(server, conn, { a: 'give', item: 'enchanted_book', count: 1, enchant: 'sharpness', level: 5 });
    admin(server, conn, { a: 'give', item: 'diamond_pickaxe', count: 1, enchant: 'efficiency', level: 5 });
    const find = (id: string): ItemStack => player.inventory.slots.find((s) => s && s.id === itemById.get(id)!.num)!;
    expect(find('potion').tag).toMatchObject({ potion: 'strong_healing', admin: true });
    expect(find('potion').count).toBe(1); // potions don't stack
    expect(find('enchanted_book').tag).toMatchObject({ stored: { sharpness: 5 } });
    expect(find('diamond_pickaxe').tag).toMatchObject({ ench: { efficiency: 5 } });
    expect(find('diamond_pickaxe').damage ?? 0).toBe(0);
  });

  it('spawns any registered mob, marked as admin-spawned', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    flat(player, 10);
    const req = admin(server, conn, { a: 'spawn', mob: 'zombie', count: 4 });
    expect(result(conn, req)).toMatchObject({ ok: true });
    const zombies = [...player.dim.entities.values()].filter((e): e is Mob => e instanceof Mob && e.type === 'zombie');
    expect(zombies).toHaveLength(4);
    expect(zombies.every((z) => z.admin)).toBe(true);
    // Survives a save/load round trip
    const saved = zombies[0]!.save()!;
    expect(Mob.restore(saved)!.admin).toBe(true);
    const bad = admin(server, conn, { a: 'spawn', mob: 'not_a_mob', count: 1 });
    expect(result(conn, bad)!.ok).toBe(false);
  });

  it('changes game mode, time, weather, difficulty, pvp, health, hunger, XP, flight and clears inventories', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const ok = (action: Record<string, unknown>) => expect(result(conn, admin(server, conn, action))!.ok).toBe(true);
    ok({ a: 'gamemode', mode: 'creative' });
    expect(player.gamemode).toBe('creative');
    expect(conn.last('gamemode')!.mode).toBe('creative');
    ok({ a: 'gamemode', mode: 'survival' });
    ok({ a: 'time', value: 18000 });
    expect(server.level.dayTime).toBe(18000);
    ok({ a: 'weather', kind: 'thunder' });
    expect(server.level.thundering).toBe(true);
    ok({ a: 'difficulty', value: 'hard' });
    expect(server.level.difficulty).toBe('hard');
    ok({ a: 'pvp', on: false });
    expect(server.level.pvp).toBe(false);
    ok({ a: 'health', value: 5 });
    expect(player.health).toBe(5);
    ok({ a: 'hunger', value: 3 });
    expect(player.food).toBe(3);
    ok({ a: 'heal' });
    expect(player.health).toBe(20);
    expect(player.food).toBe(20);
    ok({ a: 'xp', mode: 'set', levels: 12 });
    expect(player.xpLevel().level).toBe(12);
    ok({ a: 'xp', mode: 'add', levels: 3 });
    expect(player.xpLevel().level).toBe(15);
    ok({ a: 'flight', on: true });
    expect(player.abilities.mayFly).toBe(true);
    ok({ a: 'flight', on: false });
    expect(player.abilities.mayFly).toBe(false);
    player.inventory.add(stackOf('dirt', 10));
    ok({ a: 'clear_inventory' });
    expect(player.inventory.slots.every((s) => !s)).toBe(true);
    const perf = result(conn, admin(server, conn, { a: 'perf' }))!;
    expect(perf.data).toMatchObject({ tps: expect.any(Number), chunks: expect.any(Number) });
    const cat = result(conn, admin(server, conn, { a: 'catalog' }))!.data as { structures: Record<string, string[]>; biomes: Record<string, unknown[]> };
    expect(cat.structures.overworld).toContain('village');
    expect(cat.structures.nether).toContain('nether_fortress');
    expect(cat.structures.end).toContain('end_city');
    expect(cat.structures.farlands!.length).toBeGreaterThan(0);
    expect(cat.biomes.nether!.length).toBeGreaterThan(0);
  });

  it('removes nearby mobs without killing them', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const y = flat(player, 10);
    for (let i = 0; i < 5; i++) server.mobs!.spawn(player.dim, i % 2 ? 'zombie' : 'cow', player.x + 3 + i, y, player.z);
    const r = result(conn, admin(server, conn, { a: 'clear_mobs', radius: 32, hostileOnly: true }))!;
    expect(r.text).toContain('Removed 2');
    const left = [...player.dim.entitiesNear(player.x, player.y, player.z, 32)].filter((e): e is Mob => e instanceof Mob);
    expect(left.filter((m) => m.type === 'zombie')).toHaveLength(0);
    expect(left.filter((m) => m.type === 'cow')).toHaveLength(3);
  });
});

describe('structure and biome teleport', () => {
  it('finds the nearest village without coordinates and lands safely', async () => {
    const { server } = await makeServer({ cheats: true, seed: 'admin-tp' });
    const { conn, player } = await join(server);
    const loc = admin(server, conn, { a: 'locate_structure', dim: 'overworld', structure: 'village' });
    expect(await settle(server, () => !!result(conn, loc))).toBe(true);
    const found = result(conn, loc)!;
    expect(found.ok).toBe(true);
    expect(found.data).toMatchObject({ name: 'Village', dim: 'overworld', distance: expect.any(Number) });
    const tp = admin(server, conn, { a: 'tp_structure', dim: 'overworld', structure: 'village' });
    expect(await settle(server, () => result(conn, tp)?.data?.teleported === true || result(conn, tp)?.ok === false, 4000)).toBe(true);
    expect(result(conn, tp)!.ok).toBe(true);
    const d = found.data as { x: number; z: number };
    expect(Math.hypot(player.x - d.x, player.z - d.z)).toBeLessThan(40);
    // Safe: feet and head in air, solid floor, no fluids
    const bx = Math.floor(player.x);
    const by = Math.floor(player.y);
    const bz = Math.floor(player.z);
    expect(STATE_SOLID[player.dim.getState(bx, by - 1, bz)]).toBe(1);
    expect(STATE_SOLID[player.dim.getState(bx, by, bz)]).toBe(0);
    expect(STATE_SOLID[player.dim.getState(bx, by + 1, bz)]).toBe(0);
    expect(STATE_FLUID[player.dim.getState(bx, by, bz)]).toBe(0);
    // Standing in the village does not grant the discovery advancement
    tick(server, 80);
    expect(player.achievements.has('find_village')).toBe(false);
  });

  it('teleports to structures in other dimensions without entering them', async () => {
    const { server } = await makeServer({ cheats: true, seed: 'admin-tp-2' });
    const { conn, player } = await join(server);
    const tp = admin(server, conn, { a: 'tp_structure', dim: 'nether', structure: 'nether_fortress' });
    expect(await settle(server, () => result(conn, tp)?.data?.teleported === true || result(conn, tp)?.ok === false, 6000)).toBe(true);
    expect(result(conn, tp)!.ok).toBe(true);
    expect(player.dim.id).toBe('nether');
    tick(server, 80);
    expect(player.achievements.has('enter_nether')).toBe(false);
    expect(player.achievements.has('find_fortress')).toBe(false);
    // Wrong dimension for a structure is refused
    const bad = admin(server, conn, { a: 'locate_structure', dim: 'end', structure: 'village' });
    expect(result(conn, bad)!.ok).toBe(false);
  });

  it('finds the nearest biome and lands inside it', async () => {
    const { server } = await makeServer({ cheats: true, seed: 'admin-biome' });
    const { conn, player } = await join(server);
    const here = biomeOf(server.overworld.generator.biomeAt(Math.floor(player.x), Math.floor(player.z))).id;
    const target = here === 'desert' ? 'forest' : 'desert';
    const tp = admin(server, conn, { a: 'tp_biome', dim: 'overworld', biome: target });
    expect(await settle(server, () => result(conn, tp)?.data?.teleported === true || result(conn, tp)?.ok === false, 6000)).toBe(true);
    expect(result(conn, tp)!.ok).toBe(true);
    const c = player.dim.chunks.get(((Math.floor(player.x) >> 4) + 0) * 0 + 0) ?? null;
    void c;
    const b = biomeOf(player.dim.getBiome(Math.floor(player.x), Math.floor(player.z))).id;
    expect(b).toBe(target);
  });
});

describe('advancements and cheats', () => {
  it('admin-given items never progress advancements, even when used', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const y = flat(player, 6);
    admin(server, conn, { a: 'give', item: 'diamond_pickaxe', count: 1 });
    admin(server, conn, { a: 'give', item: 'oak_planks', count: 8 });
    admin(server, conn, { a: 'give', item: 'diamond', count: 3 });
    expect(player.achievements.size).toBe(0);
    // Mine stone with the cheat pickaxe: no Stone Age / Getting Wood
    player.selectedSlot = player.inventory.slots.findIndex((s) => s?.id === itemById.get('diamond_pickaxe')!.num);
    const sx = Math.floor(player.x) + 1;
    const sz = Math.floor(player.z);
    player.dim.setBlock(sx, y, sz, S('stone'));
    server.mining.breakBlock(player, sx, y, sz, S('stone'));
    tick(server, 40);
    expect(player.achievements.has('stone_age')).toBe(false);
    expect(player.achievements.has('mine_block')).toBe(false);
    // The cobblestone it dropped is cheat-made too
    const cobble = player.inventory.slots.find((s) => s?.id === itemById.get('cobblestone')!.num);
    if (cobble) expect(isAdminStack(cobble)).toBe(true);
    // Craft a table from cheat planks: no Benchmarking, and the table is cheat-made
    const w = server.interaction.containers.windowOf(player);
    const planks = player.inventory.slots.findIndex((s) => s?.id === itemById.get('oak_planks')!.num);
    const inv = player.inventory;
    const grid = (server.interaction.containers as unknown as { playerCraft: Map<ServerPlayer, { set(i: number, s: ItemStack | null): void }> }).playerCraft.get(player)!;
    for (let i = 0; i < 4; i++) grid.set(i, stackOf('oak_planks', 1, { tag: { admin: true } }));
    inv.set(planks, null);
    w.refresh?.();
    const res = w.slots[0]!.get()!;
    expect(res.id).toBe(itemById.get('crafting_table')!.num);
    expect(isAdminStack(res)).toBe(true);
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 0, mode: 'quick', seq: 1 });
    expect(player.achievements.has('craft_table')).toBe(false);
  });

  it('normal gameplay in a cheats world still awards advancements', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const y = flat(player, 6);
    player.inventory.set(0, stackOf('stone_pickaxe', 1));
    player.selectedSlot = 0;
    const sx = Math.floor(player.x) + 1;
    const sz = Math.floor(player.z);
    player.dim.setBlock(sx, y, sz, S('stone'));
    server.mining.breakBlock(player, sx, y, sz, S('stone'));
    expect(player.achievements.has('mine_block')).toBe(true);
    expect(player.achievements.has('stone_age')).toBe(true);
    // Crafting a table from real planks
    const grid = (server.interaction.containers as unknown as { playerCraft: Map<ServerPlayer, { set(i: number, s: ItemStack | null): void }> }).playerCraft.get(player)!;
    for (let i = 0; i < 4; i++) grid.set(i, stackOf('oak_planks', 1));
    const w = server.interaction.containers.windowOf(player);
    w.refresh?.();
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 0, mode: 'quick', seq: 1 });
    expect(player.achievements.has('craft_table')).toBe(true);
    // Using the Admin Panel does not switch the advancement system off
    admin(server, conn, { a: 'give', item: 'dirt', count: 1 });
    const zombie = server.mobs!.spawn(player.dim, 'zombie', player.x + 2, y, player.z)!;
    zombie.hurt(1000, { source: 'player', attacker: player });
    expect(player.achievements.has('kill_mob')).toBe(true);
  });

  it('kills of admin-spawned mobs and dragons do not count', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    flat(player, 10);
    admin(server, conn, { a: 'spawn', mob: 'zombie', count: 1 });
    admin(server, conn, { a: 'spawn', mob: 'cave_stalker', count: 1 });
    const spawned = [...player.dim.entities.values()].filter((e): e is Mob => e instanceof Mob && e.admin);
    expect(spawned).toHaveLength(2);
    const spots = spawned.map((m) => [m.x, m.y, m.z] as const);
    for (const m of spawned) m.hurt(1000, { source: 'player', attacker: player });
    tick(server, 30);
    expect(player.achievements.has('kill_mob')).toBe(false);
    expect(player.achievements.has('kill_stalker')).toBe(false);
    // Their loot is cheat-made (lying where they died, or already picked up)
    const near = (e: { x: number; z: number }) => spots.some(([x, , z]) => Math.hypot(e.x - x, e.z - z) < 3);
    for (const e of player.dim.entities.values()) if (e.type === 'item' && near(e)) expect(isAdminStack((e as unknown as { stack: ItemStack }).stack)).toBe(true);
    for (const st of player.inventory.slots) if (st) expect(isAdminStack(st)).toBe(true);
    // An admin-spawned Ender Dragon in the End
    server.admin.moveTo(player, 'end', 0, 80, 40);
    await settle(server, () => player.dim.isLoaded(0, 0), 400);
    // The natural dragon has been beaten already; a cheat brings a new one
    const fight = server.theEnd!.fight;
    const natural = await settle(server, () => !!fight.dragon, 200);
    if (natural && fight.dragon) {
      fight.dragon.remove();
      fight.dragon = null;
    }
    server.level.flags.dragonKilled = true;
    server.level.flags.dragonAlive = false;
    const busy = admin(server, conn, { a: 'spawn', mob: 'ender_dragon', count: 1 });
    const r = busy;
    expect(result(conn, r)).toMatchObject({ ok: true });
    const dragon = server.theEnd!.fight.dragon!;
    expect(dragon.admin).toBe(true);
    dragon.hurt(100000, { source: 'player', attacker: player });
    tick(server, 260);
    expect(player.achievements.has('kill_dragon')).toBe(false);
    expect(player.achievements.has('enter_end')).toBe(false);
    // V3: no dragon kill drops a Corrupted Eye (only the secret ending gives one)
    const eye = [...player.dim.entities.values()].find((e) => e.type === 'item' && (e as unknown as { stack: ItemStack }).stack.id === itemById.get('corrupted_eye')!.num);
    const carried = player.inventory.slots.find((s) => s?.id === itemById.get('corrupted_eye')!.num);
    expect(eye || carried).toBeFalsy();
    // Its loot is cheat-made
    for (const e of player.dim.entities.values()) if (e.type === 'item') expect(isAdminStack((e as unknown as { stack: ItemStack }).stack)).toBe(true);
    // The world records the kill as a cheat, never as Ending 1 for anyone
    expect(server.level.endings.dragonDeath).toBe('cheat');
    expect(player.endings.has('dragon')).toBe(false);
  });

  it('cheat experience never counts for Experienced', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    admin(server, conn, { a: 'xp', mode: 'set', levels: 35 });
    expect(player.xpLevel().level).toBe(35);
    expect(player.achievements.has('level_30')).toBe(false);
    // Earning a little more legitimately still doesn't reach 30 legit levels
    server.interaction.survival.giveXp(player, 50);
    expect(player.achievements.has('level_30')).toBe(false);
    // A player who earns it all in play gets it
    const other = await join(server, 'Earner');
    server.interaction.survival.giveXp(other.player, 1400);
    expect(other.player.achievements.has('level_30')).toBe(true);
  });

  it('cheat teleports and game modes are advancement-neutral, normal travel is not', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    admin(server, conn, { a: 'gamemode', mode: 'creative' });
    expect(player.cheat.mode).toBe(true);
    // Items taken from the creative menu while in a cheat mode are cheat-made
    server.handle(conn, { t: 'creative_set', slot: 36, item: { id: itemById.get('diamond')!.num, count: 5 } });
    expect(isAdminStack(player.inventory.get(0))).toBe(true);
    admin(server, conn, { a: 'gamemode', mode: 'survival' });
    expect(player.cheat.mode).toBe(false);
    // Dimension travel by cheat
    server.admin.moveTo(player, 'nether', 0, 70, 0);
    expect(player.achievements.has('enter_nether')).toBe(false);
    expect(player.cheat.visit).toBe('nether');
    // Normal travel (a portal) counts again and ends the cheat visit
    server.changeDimension(player, 'overworld', 0, 90, 0);
    expect(player.cheat.visit).toBe(null);
    server.changeDimension(player, 'nether', 0, 70, 0);
    expect(player.achievements.has('enter_nether')).toBe(true);
  });

  it('blocks placed from cheat items stay cheat-made, including what grows or forms from them', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const y = flat(player, 8);
    // Cheat lava and water form cheat obsidian
    const x0 = Math.floor(player.x) + 3;
    const z0 = Math.floor(player.z);
    // A ring of stone keeps the fluids in place
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) player.dim.setBlock(x0 + dx!, y, z0 + dz!, S('stone'));
    player.dim.setBlock(x0, y, z0, S('lava'));
    server.admin.setBlockMark(player.dim, x0, y, z0, true);
    player.dim.setBlock(x0, y + 1, z0, S('water'));
    tick(server, 60);
    expect(player.dim.blockId(x0, y, z0)).toBe('obsidian');
    expect(server.admin.blockMarked(player.dim, x0, y, z0)).toBe(true);
    player.inventory.set(0, stackOf('diamond_pickaxe', 1));
    player.selectedSlot = 0;
    server.mining.breakBlock(player, x0, y, z0, S('obsidian'));
    tick(server, 30);
    expect(player.achievements.has('form_obsidian')).toBe(false);
    void conn;
  });

  it('keeps cheat bookkeeping across save and load', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ cheats: true }, storage);
    const { conn, player } = await join(server);
    admin(server, conn, { a: 'xp', mode: 'set', levels: 20 });
    server.admin.moveTo(player, 'overworld', player.x + 500, 100, player.z);
    server.admin.setBlockMark(player.dim, 10, 60, 10, true);
    await server.saveAll();
    const data = await storage.readPlayer(player.uuid);
    expect((data as { cheat: { xp: number; zones: unknown[] } }).cheat.xp).toBeGreaterThan(0);
    expect((data as { cheat: { zones: unknown[] } }).cheat.zones.length).toBe(1);
    const { server: again } = await makeServer({}, storage);
    expect(again.admin.blockMarked(again.overworld, 10, 60, 10)).toBe(true);
    void hello;
  });
});

describe('admin endgame (V3)', () => {
  it('teleports to a glitched portal and a corrupted cave, and lights the portal without advancements', async () => {
    const { server } = await makeServer({ cheats: true, seed: 'corrupt-1' });
    const { conn, player } = await join(server);
    const tp = admin(server, conn, { a: 'tp_structure', dim: 'overworld', structure: 'glitched_portal' });
    expect(await settle(server, () => result(conn, tp)?.data?.teleported === true || result(conn, tp)?.ok === false, 8000)).toBe(true);
    expect(result(conn, tp)!.ok).toBe(true);
    const loc = server.overworld.generator.locate!('glitched_portal', 0, 0)!;
    expect(Math.hypot(player.x - loc.x, player.z - loc.z)).toBeLessThan(12);
    tick(server, 60);
    // An admin Corrupted Eye opens the portal but earns nothing and grants no Farlands access
    admin(server, conn, { a: 'give', item: 'corrupted_eye', count: 1 });
    player.selectedSlot = player.inventory.slots.findIndex((s) => s?.id === itemById.get('corrupted_eye')!.num);
    const g = server.overworld.generator as import('../../src/common/gen/generator').OverworldGenerator;
    const p = g.terrain.corrupted!.nearest(0, 0, true)!.portal!;
    const bx = p.x + (p.axis === 'x' ? 1 : 0);
    const bz = p.z + (p.axis === 'z' ? 1 : 0);
    server.handle(conn, { t: 'use_on', x: bx, y: p.y - 1, z: bz, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.2, seq: 1 });
    expect(player.dim.blockId(bx, p.y + 1, bz)).toBe('far_portal');
    expect(server.endings!.state.farlandsAccess).toBe(false);
    expect(player.achievements.has('find_far_portal')).toBe(false);
    tick(server, 100);
    expect(player.achievements.has('find_corrupted_cave')).toBe(false);

    const cave = admin(server, conn, { a: 'tp_biome', dim: 'overworld', biome: 'cave:corrupted_caves' });
    expect(await settle(server, () => result(conn, cave)?.data?.teleported === true || result(conn, cave)?.ok === false, 8000)).toBe(true);
    expect(result(conn, cave)!.ok).toBe(true);
    expect(server.overworld.generator.caveBiomeAt!(Math.floor(player.x), Math.floor(player.y + 1), Math.floor(player.z))).toBe(10);
    tick(server, 60);
    expect(player.achievements.size).toBe(0);
  }, 90000);

  it('forces and resets endings as cheats', async () => {
    const { server } = await makeServer({ cheats: true });
    const { conn, player } = await join(server);
    const f = admin(server, conn, { a: 'endgame', op: 'force_ending', id: 'error_defeated' });
    expect(result(conn, f)!.ok).toBe(true);
    expect(server.endings!.state.errorDefeated).toBe(true);
    expect(server.endings!.state.forced).toContain('error_defeated');
    expect(server.endings!.state.reached.error_defeated).toBeUndefined();
    expect(player.endings.has('error_defeated')).toBe(false);
    expect(conn.of('ending').length).toBe(1);
    const r = admin(server, conn, { a: 'endgame', op: 'reset_endings' });
    expect(result(conn, r)!.ok).toBe(true);
    expect(server.endings!.state.errorDefeated).toBe(false);
    expect(server.endings!.state.forced).toEqual([]);
    const st = admin(server, conn, { a: 'endgame', op: 'status' });
    expect(result(conn, st)!.data).toMatchObject({ dragonDeath: null, errorDefeated: false });
    expect(admin(server, conn, { a: 'endgame', op: 'nope' })).toBeGreaterThan(0);
    expect(player.achievements.size).toBe(0);
  });
});
