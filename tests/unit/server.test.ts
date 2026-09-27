import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, blocks, STATE_BLOCK } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { itemById } from '../../src/common/registry/items';
import { decodeChunk } from '../../src/common/world/chunk';
import { breakTicks } from '../../src/common/game/mining';

describe('game server', () => {
  it('welcomes a player and streams lit chunks', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    expect(conn.of('welcome')).toHaveLength(1);
    const chunks = conn.of('chunk');
    expect(chunks.length).toBeGreaterThan(9);
    const c = decodeChunk(chunks[0]!.data);
    expect(c.lightReady).toBe(true);
    // Safe spawn teleport lands the player on solid ground
    const tp = conn.last('teleport');
    expect(tp).toBeDefined();
    const below = player.dim.getState(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z));
    expect(below).not.toBe(0);
  });

  it('rejects impossible movement', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    const before = conn.of('teleport').length;
    const seq = 999999999;
    server.handle(conn, { t: 'move', x: player.x + 50, y: player.y, z: player.z, yaw: 0, pitch: 0, onGround: true, flying: false, sneak: false, sprint: false, seq });
    expect(conn.of('teleport').length).toBe(before + 1);
    expect(Math.abs(player.x - player.lastValidX)).toBeLessThan(1e-9);
  });

  it('mines blocks only after the required time and drops items', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    const x = Math.floor(player.x);
    const y = Math.floor(player.y) - 1;
    const z = Math.floor(player.z);
    const dim = player.dim;
    dim.setBlock(x, y, z, S('dirt'));
    player.body.onGround = true;
    // instant finish is rejected
    server.handle(conn, { t: 'dig', action: 'start', x, y, z, face: 1 });
    server.handle(conn, { t: 'dig', action: 'finish', x, y, z, face: 1 });
    expect(dim.getState(x, y, z)).toBe(S('dirt'));
    // proper timing succeeds
    const need = breakTicks(S('dirt'), { tool: null, onGround: true, underwater: false, aquaAffinity: false, haste: 0, fatigue: 0, creative: false });
    server.handle(conn, { t: 'dig', action: 'start', x, y, z, face: 1 });
    tick(server, need);
    server.handle(conn, { t: 'dig', action: 'finish', x, y, z, face: 1 });
    expect(dim.getState(x, y, z)).toBe(0);
    const items = [...dim.entities.values()].filter((e) => e.type === 'item');
    expect(items.length).toBe(1);
  });

  it('rejects digging out of reach', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    const x = Math.floor(player.x) + 20;
    const z = Math.floor(player.z);
    const y = player.dim.getHeight(x, z) - 1;
    const st = player.dim.getState(x, y, z);
    server.handle(conn, { t: 'dig', action: 'start', x, y, z, face: 1 });
    tick(server, 400);
    server.handle(conn, { t: 'dig', action: 'finish', x, y, z, face: 1 });
    expect(player.dim.getState(x, y, z)).toBe(st);
  });

  it('places blocks from inventory and consumes them', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    player.inventory.set(0, stackOf('cobblestone', 5));
    player.selectedSlot = 0;
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    const dim = player.dim;
    const y = Math.floor(player.y);
    dim.setBlock(x, y - 1, z, S('stone'));
    dim.setBlock(x, y, z, 0);
    dim.setBlock(x, y + 1, z, 0);
    server.handle(conn, { t: 'use_on', x, y: y - 1, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0.5, seq: 1 });
    expect(dim.getState(x, y, z)).toBe(S('cobblestone'));
    expect(player.inventory.get(0)?.count).toBe(4);
  });

  it('crafts planks through the inventory window', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    player.inventory.clear();
    player.inventory.set(9, stackOf('oak_log', 2));
    // player window: slot 0 result, 1-4 grid, 5-8 armor, 9-35 main (inventory 9..35)
    let seq = 1;
    server.handle(conn, { t: 'click', window: 0, slot: 9, button: 0, mode: 'pickup', seq: seq++ }); // pick up logs
    server.handle(conn, { t: 'click', window: 0, slot: 1, button: 1, mode: 'pickup', seq: seq++ }); // place one
    const inv = conn.last('inventory')!;
    expect(inv.slots[0]?.id).toBe(itemById.get('oak_planks')!.num);
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 0, mode: 'quick', seq: seq++ }); // shift-craft
    expect(player.inventory.count(itemById.get('oak_planks')!.num)).toBe(4);
  });

  it('applies fall damage validated server side', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    player.spawnProtection = 0;
    const hp = player.health;
    const gx = Math.floor(player.x);
    const gz = Math.floor(player.z);
    const ground = player.dim.getHeight(gx, gz);
    // Build a clear column to fall through
    let y = ground + 20;
    server.teleport(player, gx + 0.5, y, gz + 0.5);
    server.handle(conn, { t: 'move', x: gx + 0.5, y, z: gz + 0.5, yaw: 0, pitch: 0, onGround: false, flying: false, sneak: false, sprint: false, seq: player.teleportSeq });
    while (y > ground) {
      y = Math.max(ground, y - 1.5);
      server.handle(conn, { t: 'move', x: gx + 0.5, y, z: gz + 0.5, yaw: 0, pitch: 0, onGround: y === ground, flying: false, sneak: false, sprint: false, seq: player.teleportSeq + 1 });
      tick(server, 1);
    }
    expect(player.health).toBeLessThan(hp);
  });

  it('persists player inventory and world edits across restarts', async () => {
    const { server, storage } = await makeServer();
    const { player } = await join(server, 'Saver');
    player.inventory.set(3, stackOf('diamond', 7));
    const x = Math.floor(player.x) + 1;
    const y = Math.floor(player.y) + 3;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y, z, S('gold_block'));
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    const { player: p2 } = await join(s2, 'Saver');
    expect(p2.inventory.get(3)?.id).toBe(itemById.get('diamond')!.num);
    expect(p2.inventory.get(3)?.count).toBe(7);
    // chunk loaded from storage retains edit
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 0));
      tick(s2, 1);
    }
    expect(blocks[STATE_BLOCK[p2.dim.getState(x, y, z)]!]!.id).toBe('gold_block');
  });
});
