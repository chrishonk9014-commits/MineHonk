/** Items that did nothing in V1 and work now (shield, trident, spectral arrows, ...). */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S } from '../../src/common/registry/blocks';
import { itemById } from '../../src/common/registry/items';
import { stackOf } from '../../src/common/game/itemstack';
import { Projectile } from '../../src/server/entity/Projectile';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

/** Flat stone floor with open air around the player. */
function arena(player: ServerPlayer, r = 12): number {
  const cx = Math.floor(player.x);
  const cz = Math.floor(player.z);
  const y = Math.floor(player.y);
  for (let x = cx - r; x <= cx + r; x++)
    for (let z = cz - r; z <= cz + r; z++) {
      player.dim.setBlock(x, y - 1, z, S('stone'));
      for (let h = 0; h < 5; h++) player.dim.setBlock(x, y + h, z, 0);
    }
  return y;
}

describe('shield', () => {
  it('a raised shield stops a hit from the front but not from behind', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    arena(player);
    player.spawnProtection = 0;
    player.inventory.set(40, stackOf('shield', 1));
    player.yaw = 0; // facing north (-Z)
    server.handle(conn, { t: 'use', hand: 1, action: 'start' });
    tick(server, 6);
    const zombie = server.mobs!.spawn(player.dim, 'zombie', player.x, player.y, player.z - 1.5)!;
    const hp = player.health;
    server.mobs!.meleeAttack(zombie, player);
    expect(player.health).toBe(hp);
    expect(player.inventory.get(40)!.damage ?? 0).toBeGreaterThan(0);
    // From behind the shield does nothing
    zombie.setPos(player.x, player.y, player.z + 1.5);
    player.hurtCooldown = 0;
    server.mobs!.meleeAttack(zombie, player);
    expect(player.health).toBeLessThan(hp);
  });

  it('an axe knocks the shield aside for a while', async () => {
    const { server } = await makeServer({ pvp: true });
    const a = await join(server, 'Axer');
    const b = await join(server, 'Blocker');
    arena(b.player);
    b.player.spawnProtection = 0;
    b.player.setPos(a.player.x, a.player.y, a.player.z - 2);
    b.player.yaw = Math.PI; // facing south, towards the attacker
    b.player.inventory.set(40, stackOf('shield', 1));
    server.handle(b.conn, { t: 'use', hand: 1, action: 'start' });
    tick(server, 30);
    a.player.yaw = 0;
    a.player.inventory.set(a.player.selectedSlot, stackOf('iron_axe', 1));
    server.handle(a.conn, { t: 'attack', id: b.player.id });
    expect(b.player.shieldDownUntil).toBeGreaterThan(server.tickNo);
    expect(b.conn.of('cooldown').length).toBe(1);
    expect(server.interaction.isUsing(b.player)).toBeUndefined();
  });
});

describe('trident', () => {
  it('can be thrown, hits, and is picked up again', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player, 16);
    player.inventory.set(player.selectedSlot, stackOf('trident', 1));
    player.yaw = 0;
    player.pitch = 0;
    const cow = server.mobs!.spawn(player.dim, 'cow', player.x, y, player.z - 6)!;
    cow.noAi = true;
    const hp = cow.health;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    tick(server, 15);
    server.handle(conn, { t: 'use', hand: 0, action: 'release' });
    expect(player.inventory.get(player.selectedSlot)).toBeNull();
    const thrown = [...player.dim.entities.values()].find((e) => e instanceof Projectile && e.kind === 'trident') as Projectile;
    expect(thrown?.item).toBeTruthy();
    for (let i = 0; i < 40 && !thrown.stuck; i++) tick(server, 1);
    expect(cow.health).toBeLessThan(hp);
    // Walk to it and pick it up
    player.setPos(thrown.x, y, thrown.z);
    player.dim.updateBucket(player);
    tick(server, 2);
    let back = false;
    for (let i = 0; i < 36; i++) if (player.inventory.get(i)?.id === itemById.get('trident')!.num) back = true;
    expect(back).toBe(true);
  });

  it('a Loyalty trident flies back to its thrower', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    arena(player, 16);
    player.inventory.set(player.selectedSlot, stackOf('trident', 1, { tag: { ench: { loyalty: 3 } } }));
    player.yaw = 0;
    player.pitch = -0.2;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    tick(server, 12);
    server.handle(conn, { t: 'use', hand: 0, action: 'release' });
    expect(player.inventory.get(player.selectedSlot)).toBeNull();
    tick(server, 200);
    let back = false;
    for (let i = 0; i < 36; i++) if (player.inventory.get(i)?.id === itemById.get('trident')!.num) back = true;
    expect(back).toBe(true);
  });

  it('stuck tridents are saved with the chunk', async () => {
    const pr = new Projectile('trident');
    pr.item = stackOf('trident', 1);
    pr.stuck = true;
    pr.setPos(10, 70, 10);
    const saved = pr.save();
    expect(saved).toBeTruthy();
    const back = Projectile.restoreTrident(saved!);
    expect(back?.item?.id).toBe(itemById.get('trident')!.num);
  });
});

describe('spectral arrows', () => {
  it('are shot from a bow and make the target glow', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player, 16);
    player.inventory.set(player.selectedSlot, stackOf('bow', 1));
    player.inventory.set(40, stackOf('spectral_arrow', 4));
    player.yaw = 0;
    player.pitch = 0;
    const cow = server.mobs!.spawn(player.dim, 'cow', player.x, y, player.z - 5)!;
    cow.noAi = true;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    tick(server, 25);
    server.handle(conn, { t: 'use', hand: 0, action: 'release' });
    expect(player.inventory.get(40)!.count).toBe(3);
    tick(server, 20);
    expect(cow.meta().glowing).toBe(true);
  });
});
