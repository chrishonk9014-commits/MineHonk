import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { EndGenerator, endPillars, exitPortalY, END_SPAWN } from '../../src/common/gen/end';
import { blockOf, S, stateOf } from '../../src/common/registry/blocks';
import { makeServer, join, tick } from '../helpers/testServer';
import { stackOf } from '../../src/common/game/itemstack';
import type { GameServer } from '../../src/server/GameServer';
import { EndCrystal, EnderEye } from '../../src/server/entity/EndEntities';
import type { Mob } from '../../src/server/entity/Mob';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

describe('end generation', () => {
  beforeAll(() => initItems());

  it('builds the main island, pillars with crystals and the exit portal', () => {
    const g = new EndGenerator(31337);
    const c0 = g.generate(0, 0);
    const y0 = exitPortalY(g.terrain);
    expect(blockOf(c0.get(0, y0 - 1, 0)).id).toBe('bedrock');
    expect(blockOf(c0.get(0, y0 + 3, 0)).id).toBe('bedrock');
    expect(blockOf(c0.get(2, y0, 0)).id).toBe('air');
    let crystals = 0;
    for (const p of endPillars(31337)) {
      const c = g.generate(p.x >> 4, p.z >> 4);
      expect(blockOf(c.get(p.x & 15, p.height, p.z & 15)).id).toBe('obsidian');
      expect(blockOf(c.get(p.x & 15, p.height + 1, p.z & 15)).id).toBe('bedrock');
      crystals += c.genEntities.filter((e) => e.type === 'end_crystal').length;
    }
    expect(crystals).toBe(10);
    // Void between the main island and the outer islands
    expect(g.terrain.column(500, 0)).toBeNull();
    let outer = 0;
    for (let x = 1200; x < 3000; x += 32) for (let z = -800; z < 800; z += 32) if (g.terrain.column(x, z)) outer++;
    expect(outer).toBeGreaterThan(50);
  });

  it('places end cities with loot and a ship on the outer islands', () => {
    const g = new EndGenerator(12345);
    const city = g.locate('end_city', 0, 0)!;
    expect(city).toBeTruthy();
    expect(Math.hypot(city.x, city.z)).toBeGreaterThan(1000);
    const loot = new Set<string>();
    let shulkers = 0;
    for (let cx = (city.x >> 4) - 2; cx <= (city.x >> 4) + 2; cx++)
      for (let cz = (city.z >> 4) - 2; cz <= (city.z >> 4) + 2; cz++) {
        const c = g.generate(cx, cz);
        for (const be of c.blockEntities.values()) if (be.type === 'chest') loot.add(String(be.loot));
        shulkers += c.genEntities.filter((e) => e.type === 'shulker').length;
      }
    expect(loot.has('chest/end_city')).toBe(true);
    expect(shulkers).toBeGreaterThan(1);
  });
});

describe('the end progression', () => {
  it('throws eyes of ender towards a stronghold and lights a completed frame', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    player.inventory.set(player.selectedSlot, stackOf('ender_eye', 16));
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    const eye = [...player.dim.entities.values()].find((e) => e instanceof EnderEye);
    expect(eye).toBeTruthy();
    expect(player.inventory.get(player.selectedSlot)?.count).toBe(15);
    // It flies towards the nearest stronghold
    const sh = player.dim.generator.locate!('stronghold', Math.floor(player.x), Math.floor(player.z))!;
    const before = Math.hypot(sh.x - eye!.x, sh.z - eye!.z);
    tick(server, 20);
    expect(Math.hypot(sh.x - eye!.x, sh.z - eye!.z)).toBeLessThan(before);

    // Portal frame ring around a 3x3 opening
    const dim = player.dim;
    const cx = Math.floor(player.x) + 4;
    const cz = Math.floor(player.z) + 4;
    const y = Math.floor(player.y);
    const ring: [number, number][] = [];
    for (let d = -1; d <= 1; d++) ring.push([cx + d, cz - 2], [cx + d, cz + 2], [cx - 2, cz + d], [cx + 2, cz + d]);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) dim.setBlock(cx + dx, y, cz + dz, 0);
    ring.forEach(([x, z], i) => dim.setBlock(x, y, z, stateOf('end_portal_frame', { eye: i !== 5 })));
    const [lx, lz] = ring[5]!;
    server.teleport(player, lx + 0.5, y + 1, lz + 2.5);
    server.handle(conn, { t: 'use_on', x: lx, y, z: lz, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.2, seq: 1 });
    expect(blockOf(dim.getState(cx, y, cz)).id).toBe('end_portal');
    expect(blockOf(dim.getState(cx + 1, y, cz - 1)).id).toBe('end_portal');
  });

  it('travels to the End, fights and defeats the dragon, and returns home', async () => {
    const { server } = await makeServer({ mode: 'survival' });
    const { player } = await join(server);
    const ow = player.dim;
    const x = Math.floor(player.x) + 3;
    const y = Math.floor(player.y);
    const z = Math.floor(player.z);
    ow.setBlock(x, y, z, S('end_portal'));
    server.teleport(player, x + 0.5, y, z + 0.5);
    player.portalCooldown = 0;
    tick(server, 2);
    expect(player.dim.id).toBe('end');
    await settle(server, 60);
    const end = player.dim;
    expect(blockOf(end.getState(END_SPAWN.x, END_SPAWN.y - 1, END_SPAWN.z)).id).toBe('obsidian');
    expect(Math.abs(player.x - (END_SPAWN.x + 0.5))).toBeLessThan(1);
    expect(player.achievements.has('enter_end')).toBe(true);

    // Walk to the centre so the island and its pillars load
    const gen = end.generator as EndGenerator;
    const y0 = exitPortalY(gen.terrain);
    server.teleport(player, 0.5, y0 + 1, 20.5);
    await settle(server, 80);
    const dragon = [...end.entities.values()].find((e) => e.type === 'ender_dragon') as Mob | undefined;
    expect(dragon).toBeTruthy();
    expect(server.theEnd!.fight.crystals().length).toBeGreaterThanOrEqual(8);
    const bosses = (player.conn as unknown as { of(t: string): { action: string }[] }).of('boss');
    expect(bosses.some((b) => b.action === 'add')).toBe(true);

    // Crystals explode when struck
    const crystal = server.theEnd!.fight.crystals()[0]!;
    server.mobs!.playerAttack(player, crystal);
    expect(crystal.removed).toBe(true);
    expect(server.theEnd!.fight.crystals().includes(crystal as EndCrystal)).toBe(false);

    // The dragon flies around
    const p0 = [dragon!.x, dragon!.y, dragon!.z];
    tick(server, 40);
    expect(Math.hypot(dragon!.x - p0[0]!, dragon!.y - p0[1]!, dragon!.z - p0[2]!)).toBeGreaterThan(5);

    // Defeat it
    player.spawnProtection = 100000;
    dragon!.hurt(10000, { source: 'mob', attacker: player });
    expect(dragon!.dead).toBe(true);
    tick(server, 205);
    expect(dragon!.removed).toBe(true);
    expect(server.level.flags.dragonKilled).toBe(true);
    expect(player.achievements.has('kill_dragon')).toBe(true);
    expect(blockOf(end.getState(2, y0, 0)).id).toBe('end_portal');
    expect(blockOf(end.getState(0, y0 + 4, 0)).id).toBe('dragon_egg');
    const drops = [...end.entities.values()].filter((e) => e.type === 'item').map((e) => (e as unknown as { stack: { id: number } }).stack?.id);
    expect(drops.length).toBeGreaterThan(0);
    // A gateway appears on the ring
    expect(server.level.flags.gateways).toBe(1);

    // Leave through the exit portal
    server.teleport(player, 2.5, y0, 0.5);
    player.portalCooldown = 0;
    tick(server, 2);
    expect(player.dim.id).toBe('overworld');
    void ow;
  });
});
