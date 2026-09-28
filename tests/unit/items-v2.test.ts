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

import { stepGlide, newBody } from '../../src/common/physics/movement';
import { FishingBobber } from '../../src/server/entity/FishingBobber';
import { Firework } from '../../src/server/entity/Firework';

describe('elytra', () => {
  it('glides far forward for little height', () => {
    const air = { getState: () => 0 };
    const b = newBody(0, 200, 0);
    b.vz = -0.5;
    for (let i = 0; i < 100; i++) stepGlide(air, b, 0, 0.15, false);
    const fell = 200 - b.y;
    const went = -b.z;
    expect(went).toBeGreaterThan(fell * 2);
    expect(fell).toBeGreaterThan(0);
  });

  it('a rocket speeds the glider up', () => {
    const air = { getState: () => 0 };
    const a = newBody(0, 200, 0);
    const b = newBody(0, 200, 0);
    for (let i = 0; i < 20; i++) {
      stepGlide(air, a, 0, 0, false);
      stepGlide(air, b, 0, 0, true);
    }
    expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(Math.hypot(a.vx, a.vz) + 0.5);
  });

  it('the server accepts gliding only with a working Elytra and lets rockets boost it', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    arena(player);
    const move = (glide: boolean) => server.handle(conn, { t: 'move', x: player.x, y: player.y + 2, z: player.z, yaw: 0, pitch: 0, onGround: false, flying: false, sneak: false, sprint: false, seq: player.teleportSeq + 1, glide });
    move(true);
    expect(player.gliding).toBe(false);
    player.inventory.set(38, stackOf('elytra', 1));
    move(true);
    expect(player.gliding).toBe(true);
    expect(player.meta().glide).toBe(true);
    player.inventory.set(0, stackOf('firework_rocket', 3));
    player.selectedSlot = 0;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(conn.of('boost').length).toBe(1);
    expect(player.inventory.get(0)!.count).toBe(2);
    // Worn out: stays at its last point and stops flying
    player.inventory.set(38, stackOf('elytra', 1, { damage: itemById.get('elytra')!.def.durability! - 1 }));
    move(true);
    expect(player.gliding).toBe(false);
  });
});

describe('fireworks', () => {
  it('launch from a block and burst', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    player.inventory.set(player.selectedSlot, stackOf('firework_rocket', 2));
    server.handle(conn, { t: 'use_on', x: Math.floor(player.x) + 1, y: y - 1, z: Math.floor(player.z), face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0.5, seq: 1 });
    const f = [...player.dim.entities.values()].find((e) => e instanceof Firework) as Firework;
    expect(f).toBeTruthy();
    expect(player.inventory.get(player.selectedSlot)!.count).toBe(1);
    const y0 = f.y;
    tick(server, 60);
    expect(f.removed).toBe(true);
    expect(conn.of('particles').some((m) => m.kind === 'firework')).toBe(true);
    expect(f.y).toBeGreaterThan(y0 + 5);
  });
});

describe('fishing', () => {
  it('casts into water, waits for a bite and reels in a catch', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player, 10);
    // A pool in front of the player
    for (let x = -3; x <= 3; x++) for (let z = -8; z <= -3; z++) {
      player.dim.setBlock(Math.floor(player.x) + x, y - 1, Math.floor(player.z) + z, S('water'));
      player.dim.setBlock(Math.floor(player.x) + x, y - 2, Math.floor(player.z) + z, S('water'));
      player.dim.setBlock(Math.floor(player.x) + x, y - 3, Math.floor(player.z) + z, S('stone'));
    }
    player.inventory.set(player.selectedSlot, stackOf('fishing_rod', 1));
    player.yaw = 0;
    player.pitch = 0.3;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    const b = server.gadgets!.bobberOf(player)!;
    expect(b).toBeInstanceOf(FishingBobber);
    for (let i = 0; i < 60; i++) tick(server, 1);
    expect(b.state).toBe('floating');
    // Skip the wait: a fish bites now
    b.wait = 1;
    for (let i = 0; i < 3 && !b.biting; i++) tick(server, 1);
    expect(b.biting).toBe(true);
    const before = [...player.dim.entities.values()].filter((e) => e.type === 'item').length;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(b.removed).toBe(true);
    const after = [...player.dim.entities.values()].filter((e) => e.type === 'item').length;
    expect(after).toBeGreaterThan(before);
    expect(player.inventory.get(player.selectedSlot)!.damage).toBe(1);
  });
});
