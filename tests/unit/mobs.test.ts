import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S } from '../../src/common/registry/blocks';
import { Mob } from '../../src/server/entity/Mob';
import { itemById } from '../../src/common/registry/items';
import { stackOf } from '../../src/common/game/itemstack';
import { Projectile } from '../../src/server/entity/Projectile';

/** Builds a flat stone arena around the player so AI and physics are predictable. */
function arena(player: { dim: import('../../src/server/world/Dimension').Dimension; x: number; y: number; z: number }, r = 12): number {
  const cx = Math.floor(player.x);
  const cz = Math.floor(player.z);
  const y = Math.floor(player.y);
  for (let x = cx - r; x <= cx + r; x++)
    for (let z = cz - r; z <= cz + r; z++) {
      player.dim.setBlock(x, y - 1, z, S('stone'));
      for (let h = 0; h < 4; h++) player.dim.setBlock(x, y + h, z, 0);
    }
  return y;
}

describe('mobs and combat', () => {
  it('zombies path to the player and deal damage', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    player.spawnProtection = 0;
    server.level.dayTime = 18000;
    const z = server.mobs!.spawn(player.dim, 'zombie', player.x + 8, y, player.z + 3)!;
    z.held = null;
    const hp = player.health;
    for (let i = 0; i < 200 && player.health === hp; i++) tick(server, 1);
    expect(z.target).toBe(player);
    expect(player.health).toBeLessThan(hp);
  });

  it('player melee kills a cow and drops loot', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const cow = server.mobs!.spawn(player.dim, 'cow', player.x + 1.2, y, player.z)!;
    player.inventory.set(player.selectedSlot, stackOf('diamond_sword', 1));
    player.yaw = -Math.PI / 2;
    for (let i = 0; i < 6 && !cow.dead; i++) {
      tick(server, 15);
      server.handle(conn, { t: 'attack', id: cow.id });
    }
    expect(cow.dead).toBe(true);
    tick(server, 25);
    const drops = [...player.dim.entities.values()].filter((e) => e.type === 'item');
    expect(drops.length).toBeGreaterThan(0);
    expect(player.dim.entities.has(cow.id)).toBe(false);
  });

  it('skeletons shoot arrows that hurt', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player, 14);
    player.spawnProtection = 0;
    const sk = server.mobs!.spawn(player.dim, 'skeleton', player.x + 10, y, player.z)!;
    sk.held = { id: itemById.get('bow')!.num, count: 1 };
    sk.fireTicks = 0;
    server.level.dayTime = 18000;
    const hp = player.health;
    let arrows = 0;
    for (let i = 0; i < 300 && player.health === hp; i++) {
      tick(server, 1);
      arrows = Math.max(arrows, [...player.dim.entities.values()].filter((e) => e instanceof Projectile).length);
    }
    expect(arrows).toBeGreaterThan(0);
    expect(player.health).toBeLessThan(hp);
  });

  it('creepers explode and destroy blocks', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    player.spawnProtection = 0;
    const c = server.mobs!.spawn(player.dim, 'creeper', player.x + 2, y, player.z)!;
    const hp = player.health;
    for (let i = 0; i < 200 && !c.removed; i++) tick(server, 1);
    expect(c.removed).toBe(true);
    expect(player.health).toBeLessThan(hp);
    // crater in the stone floor
    let holes = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (player.dim.getState(Math.floor(c.x) + dx, y - 1, Math.floor(c.z) + dz) === 0) holes++;
    expect(holes).toBeGreaterThan(0);
  });

  it('animals breed when fed', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const a = server.mobs!.spawn(player.dim, 'cow', player.x + 2, y, player.z)!;
    const b = server.mobs!.spawn(player.dim, 'cow', player.x + 3, y, player.z + 1)!;
    player.inventory.set(player.selectedSlot, stackOf('wheat', 2));
    server.handle(conn, { t: 'interact', id: a.id, hand: 0 });
    server.handle(conn, { t: 'interact', id: b.id, hand: 0 });
    expect(a.loveTicks).toBeGreaterThan(0);
    let baby: Mob | undefined;
    for (let i = 0; i < 400 && !baby; i++) {
      tick(server, 1);
      baby = [...player.dim.entities.values()].find((e) => e instanceof Mob && e.baby) as Mob | undefined;
    }
    expect(baby).toBeTruthy();
  });

  it('persists mobs with their chunk', async () => {
    const { server, storage } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const s = server.mobs!.spawn(player.dim, 'sheep', player.x + 2, y, player.z, { persistent: true })!;
    s.data.color = 'blue';
    s.customName = 'Bluey';
    await server.saveAll();
    const saved = [...(storage as unknown as { chunks: Map<string, Uint8Array> }).chunks.keys()].length;
    expect(saved).toBeGreaterThan(0);
    const data = s.save()!;
    const back = server.mobs!.restore(player.dim, data) as Mob;
    expect(back.type).toBe('sheep');
    expect(back.data.color).toBe('blue');
    expect(back.customName).toBe('Bluey');
  });
});
