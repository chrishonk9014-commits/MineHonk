/** Blocks and materials that were dead ends in V1: candles, pots, cauldrons, shulker boxes, conduits, stems, signs. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, getProp, withProp, STATE_LIGHT } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { stackOf } from '../../src/common/game/itemstack';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import { matchCrafting } from '../../src/common/game/crafting';
import { BREWING } from '../../src/common/data/potions';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { GameServer } from '../../src/server/GameServer';

function arena(player: ServerPlayer, r = 8): number {
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

let seq = 1;
function useOn(server: GameServer, conn: Parameters<GameServer['handle']>[0], x: number, y: number, z: number, face = 1): void {
  server.handle(conn, { t: 'use_on', x, y, z, face, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0.5, seq: seq++ });
}

describe('candles', () => {
  it('stack up to four, light with flint and steel and go out by hand', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y, z, S('candle'));
    player.inventory.set(player.selectedSlot, stackOf('candle', 3));
    for (let i = 0; i < 3; i++) useOn(server, conn, x, y, z);
    let st = player.dim.getState(x, y, z);
    expect(getProp(st, 'candles')).toBe('4');
    expect(player.inventory.get(player.selectedSlot)).toBeNull();
    expect(STATE_LIGHT[st]).toBe(0);
    player.inventory.set(player.selectedSlot, stackOf('flint_and_steel', 1));
    useOn(server, conn, x, y, z);
    st = player.dim.getState(x, y, z);
    expect(getProp(st, 'lit')).toBe('true');
    expect(STATE_LIGHT[st]).toBe(12);
    expect(player.inventory.get(player.selectedSlot)!.damage).toBe(1);
    player.inventory.set(player.selectedSlot, null);
    useOn(server, conn, x, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'lit')).toBe('false');
  });
});

describe('cauldron and flower pot', () => {
  it('a cauldron is filled from a bucket and emptied into bottles', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y, z, S('cauldron'));
    player.inventory.set(player.selectedSlot, stackOf('water_bucket', 1));
    useOn(server, conn, x, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'level')).toBe('3');
    expect(items[player.inventory.get(player.selectedSlot)!.id]!.id).toBe('bucket');
    player.inventory.set(player.selectedSlot, stackOf('glass_bottle', 1));
    useOn(server, conn, x, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'level')).toBe('2');
    const bottle = player.inventory.get(player.selectedSlot)!;
    expect(items[bottle.id]!.id).toBe('potion');
    expect(bottle.tag?.potion).toBe('water');
  });

  it('a flower pot takes a flower and gives it back, and drops it when broken', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y, z, S('flower_pot'));
    player.inventory.set(player.selectedSlot, stackOf('poppy', 2));
    useOn(server, conn, x, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'plant')).toBe('poppy');
    expect(player.inventory.get(player.selectedSlot)!.count).toBe(1);
    // Something that does not fit in a pot is refused
    player.inventory.set(player.selectedSlot, stackOf('stone', 1));
    player.dim.setBlock(x, y, z, S('flower_pot'));
    useOn(server, conn, x, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'plant')).toBe('none');
    player.dim.setBlock(x, y, z, withProp(S('flower_pot'), 'plant', 'cornflower'));
    server.mining.breakBlock(player, x, y, z, player.dim.getState(x, y, z));
    const dropped = [...player.dim.entities.values()].filter((e): e is ItemEntity => e instanceof ItemEntity).map((e) => items[e.stack.id]!.id);
    expect(dropped).toContain('flower_pot');
    expect(dropped).toContain('cornflower');
  });
});

describe('shulker box', () => {
  it('keeps its contents when broken and placed again', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    player.inventory.set(player.selectedSlot, stackOf('shulker_box', 1));
    useOn(server, conn, x, y - 1, z);
    expect(player.dim.blockId(x, y, z)).toBe('shulker_box');
    server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0.5, seq: seq++, sneaking: false } as never);
    const w = server.interaction.containers.windowOf(player);
    expect(w.title).toBe('Shulker Box');
    w.slots[0]!.set(stackOf('diamond', 5));
    // No shulker boxes inside shulker boxes
    expect(w.slots[1]!.mayPlace!(stackOf('shulker_box', 1))).toBe(false);
    server.interaction.closeWindow(player, w.id);
    server.mining.breakBlock(player, x, y, z, player.dim.getState(x, y, z));
    // (only what dropped where the box stood: a chicken nearby may lay an egg meanwhile)
    const drops = [...player.dim.entities.values()].filter((e): e is ItemEntity => e instanceof ItemEntity && Math.hypot(e.x - (x + 0.5), e.z - (z + 0.5)) < 2);
    expect(drops.length).toBe(1);
    const box = drops[0]!.stack;
    expect(items[box.id]!.id).toBe('shulker_box');
    const packed = box.tag!.data!.items as { id: string; count: number }[];
    expect(packed[0]!.count).toBe(5);
    // Place it again: the diamonds are still inside
    player.inventory.set(player.selectedSlot, box);
    useOn(server, conn, x, y - 1, z);
    const be = player.dim.getBlockEntity(x, y, z)!;
    expect((be.items as ({ count: number } | null)[])[0]!.count).toBe(5);
  });
});

describe('conduit', () => {
  it('under water inside a prismarine frame it lets divers breathe', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player, 10);
    const cx = Math.floor(player.x);
    const cy = y + 3;
    const cz = Math.floor(player.z) + 3;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) player.dim.setBlock(cx + dx, cy + dy, cz + dz, S('water'));
    player.dim.setBlock(cx, cy, cz, S('conduit'));
    server.gadgets!.addConduit(player.dim, cx, cy, cz);
    // One vertical ring of prismarine (16 blocks)
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) if (Math.abs(a) === 2 || Math.abs(b) === 2) player.dim.setBlock(cx + a, cy + b, cz, S('prismarine'));
    expect(server.gadgets!.conduitFrame(player.dim, cx, cy, cz)).toBe(16);
    player.setPos(cx + 0.5, cy + 1, cz + 3.5);
    tick(server, 81);
    expect(player.effects.has('water_breathing')).toBe(true);
  });
});

describe('stems, signs, rift pearl and new recipes', () => {
  it('melon and pumpkin seeds plant stems that set fruit when ripe', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y - 1, z, S('farmland'));
    player.inventory.set(player.selectedSlot, stackOf('melon_seeds', 1));
    useOn(server, conn, x, y - 1, z);
    expect(player.dim.blockId(x, y, z)).toBe('melon_stem');
    player.dim.setBlock(x, y, z, withProp(S('melon_stem'), 'age', 7));
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) player.dim.setBlock(x + dx, y - 1, z + dz, S('dirt'));
    const bu = server.blockUpdates as unknown as { randomTick(d: unknown, x: number, y: number, z: number, st: number): void };
    for (let i = 0; i < 400 && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => player.dim.blockId(x + dx!, y, z + dz!) === 'melon'); i++) bu.randomTick(player.dim, x, y, z, player.dim.getState(x, y, z));
    expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => player.dim.blockId(x + dx!, y, z + dz!) === 'melon')).toBe(true);
  });

  it('glow ink makes sign text glow and a plain ink sac undoes it', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 2;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y, z, S('sign'));
    player.dim.setBlockEntity(x, y, z, { type: 'sign', lines: ['hello', '', '', ''] });
    player.inventory.set(player.selectedSlot, stackOf('glow_ink_sac', 1));
    useOn(server, conn, x, y, z);
    expect(player.dim.getBlockEntity(x, y, z)!.glow).toBe(true);
    expect(conn.last('block_entity')!.data!.glow).toBe(true);
    expect(player.inventory.get(player.selectedSlot)).toBeNull();
    player.inventory.set(player.selectedSlot, stackOf('ink_sac', 1));
    useOn(server, conn, x, y, z);
    expect(player.dim.getBlockEntity(x, y, z)!.glow).toBeUndefined();
    expect(player.dim.getBlockEntity(x, y, z)!.lines).toEqual(['hello', '', '', '']);
  });

  it('a rift pearl blinks the player forward, stopping at walls', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player, 30);
    const z0 = player.z;
    player.yaw = 0;
    player.pitch = 0;
    for (let x = -3; x <= 3; x++) for (let h = 0; h < 5; h++) player.dim.setBlock(Math.floor(player.x) + x, y + h, Math.floor(z0) - 12, S('stone'));
    player.inventory.set(player.selectedSlot, stackOf('rift_pearl', 2));
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(player.z).toBeLessThan(z0 - 8);
    expect(player.z).toBeGreaterThan(Math.floor(z0) - 11);
    expect(player.inventory.get(player.selectedSlot)!.count).toBe(1);
    // Cooling down: a second use right away does nothing
    const z1 = player.z;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(player.z).toBe(z1);
  });

  it('new recipes and brews exist for items that had no source', () => {
    const grid = (ids: (string | null)[]) => ids.map((i) => (i ? stackOf(i, 1) : null));
    const r = matchCrafting(grid(['string', null, null, 'honeycomb', null, null, null, null, null]), 3, 3);
    expect(r && items[r.result]!.id).toBe('candle');
    expect(BREWING.dragon_scale!.awkward).toBe('resilience');
    expect(itemById.get('melon_seeds')!.def.block).toBe('melon_stem');
  });
});

describe('cave blocks', () => {
  it('a big dripleaf tips under a player and drops them, then springs back', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x);
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y, z, S('big_dripleaf'));
    player.setPos(x + 0.5, y + 15 / 16, z + 0.5);
    tick(server, 6);
    expect(getProp(player.dim.getState(x, y, z), 'tilt')).toBe('partial');
    tick(server, 12);
    expect(getProp(player.dim.getState(x, y, z), 'tilt')).toBe('full');
    player.setPos(x + 3.5, y, z + 0.5);
    tick(server, 62);
    expect(getProp(player.dim.getState(x, y, z), 'tilt')).toBe('none');
  });

  it('budding amethyst grows buds that ripen into clusters', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const x = Math.floor(player.x) + 3;
    const z = Math.floor(player.z);
    player.dim.setBlock(x, y + 1, z, S('budding_amethyst'));
    const bu = server.blockUpdates as unknown as { randomTick(d: unknown, x: number, y: number, z: number, st: number): void };
    const ids = (): string[] => [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].map(([dx, dy, dz]) => player.dim.blockId(x + dx!, y + 1 + dy!, z + dz!));
    for (let i = 0; i < 600 && !ids().includes('amethyst_cluster'); i++) bu.randomTick(player.dim, x, y + 1, z, player.dim.getState(x, y + 1, z));
    expect(ids()).toContain('amethyst_cluster');
  });
});
