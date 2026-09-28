import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, blocks, STATE_BLOCK, stateToString } from '../../src/common/registry/blocks';
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
    // Only the drop near the block (chickens elsewhere may lay eggs)
    const items = [...dim.entities.values()].filter((e) => e.type === 'item' && Math.abs(e.x - x - 0.5) < 2 && Math.abs(e.z - z - 0.5) < 2 && Math.abs(e.y - y) < 3);
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

describe('fluids', () => {
  it('a deep pool keeps its sources and settles instead of flickering', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const dim = player.dim;
    const x0 = Math.floor(player.x) + 3;
    const z0 = Math.floor(player.z) + 3;
    const y0 = Math.floor(player.y) + 10;
    const water = S('water');
    // A stone basin, 3 deep, filled with sources
    for (let x = -1; x <= 5; x++)
      for (let z = -1; z <= 5; z++)
        for (let y = -1; y <= 3; y++) {
          const wall = x < 0 || x > 4 || z < 0 || z > 4 || y < 0;
          dim.setBlock(x0 + x, y0 + y, z0 + z, wall ? S('stone') : y < 3 ? water : 0);
        }
    // Filling the basin scheduled a fluid tick for every cell
    tick(server, 60);
    let changes = 0;
    const set = dim.setBlock.bind(dim);
    dim.setBlock = ((x: number, y: number, z: number, s: number, o?: object) => {
      const inPool = x >= x0 - 1 && x <= x0 + 5 && z >= z0 - 1 && z <= z0 + 5 && y >= y0 - 1 && y <= y0 + 3;
      if (inPool && dim.getState(x, y, z) !== s) changes++;
      return set(x, y, z, s, o);
    }) as typeof dim.setBlock;
    tick(server, 100);
    dim.setBlock = set;
    expect(changes).toBe(0);
    for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) for (let y = 0; y < 3; y++) expect(dim.getState(x0 + x, y0 + y, z0 + z)).toBe(water);
  });

  it('water still falls off a ledge and spreads along the floor', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const dim = player.dim;
    const x0 = Math.floor(player.x) + 3;
    const z0 = Math.floor(player.z) + 3;
    const y0 = Math.floor(player.y) + 10;
    for (let x = -6; x <= 6; x++)
      for (let z = -6; z <= 6; z++) {
        dim.setBlock(x0 + x, y0 - 1, z0 + z, S('stone'));
        for (let y = 0; y < 6; y++) dim.setBlock(x0 + x, y0 + y, z0 + z, 0);
      }
    dim.setBlock(x0, y0 + 3, z0, S('stone'));
    dim.setBlock(x0, y0 + 4, z0, S('water'));
    tick(server, 200);
    const level = (x: number, y: number, z: number): number => {
      const st = dim.getState(x0 + x, y0 + y, z0 + z);
      return STATE_BLOCK[st] === STATE_BLOCK[S('water')] ? Number(/level=(\d+)/.exec(stateToString(st))?.[1] ?? 0) : -1;
    };
    expect(level(0, 4, 0)).toBe(0); // the source stays
    expect(level(1, 3, 0)).toBeGreaterThanOrEqual(8); // falling down the side of the ledge
    expect(level(1, 0, 0)).toBeGreaterThanOrEqual(8); // reached the floor
    const floor = level(3, 0, 0);
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(8); // and flows outwards along it
  });
});
