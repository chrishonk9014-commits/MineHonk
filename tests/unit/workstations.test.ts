import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { items } from '../../src/common/registry/items';

function place(player: { dim: import('../../src/server/world/Dimension').Dimension; x: number; y: number; z: number }, id: string, dx = 2): [number, number, number] {
  const x = Math.floor(player.x) + dx;
  const y = Math.floor(player.y);
  const z = Math.floor(player.z);
  player.dim.setBlock(x, y - 1, z, S('stone'));
  player.dim.setBlock(x, y, z, S(id));
  player.dim.setBlock(x, y + 1, z, 0);
  return [x, y, z];
}

describe('workstations', () => {
  it('enchants items at an enchanting table for levels and lapis', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    const [x, y, z] = place(player, 'enchanting_table');
    player.xpTotal = 5000;
    player.inventory.set(0, stackOf('diamond_sword', 1));
    player.inventory.set(1, stackOf('lapis_lazuli', 10));
    server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: 1 });
    const open = conn.last('open_window');
    expect(open?.kind).toBe('enchanting');
    const w = open!.window;
    // Move the sword (hotbar slot 0 -> window index 2 + 27) and lapis into the table
    server.handle(conn, { t: 'click', window: w, slot: 2 + 27, button: 0, mode: 'quick', seq: 1 });
    server.handle(conn, { t: 'click', window: w, slot: 2 + 28, button: 0, mode: 'quick', seq: 2 });
    const props = conn.of('window_prop').filter((m) => m.window === w).pop();
    const opts = (props?.value as { options: { cost: number; ok: boolean }[] }).options;
    expect(opts.length).toBe(3);
    const level = player.xpLevel().level;
    server.handle(conn, { t: 'enchant', option: 2 });
    const inv = conn.of('inventory').filter((m) => m.window === w).pop()!;
    const sword = inv.slots[0]!;
    expect(sword && Object.keys(sword.tag?.ench ?? {}).length).toBeGreaterThan(0);
    expect(inv.slots[1]?.count).toBe(7);
    expect(player.xpLevel().level).toBe(level - 3);
  });

  it('repairs tools on an anvil with materials', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const ws = server.workstations!;
    const pick = { ...stackOf('iron_pickaxe', 1), damage: 200 };
    const r = ws.anvilResult(pick, stackOf('iron_ingot', 3), '');
    expect(r.stack).toBeTruthy();
    expect(r.stack!.damage ?? 0).toBeLessThan(200);
    expect(r.material).toBeGreaterThan(0);
    const renamed = ws.anvilResult(stackOf('diamond_sword', 1), null, 'Honkblade');
    expect(renamed.stack?.tag?.name).toBe('Honkblade');
    expect(renamed.cost).toBe(1);
    const book = { ...stackOf('enchanted_book', 1), tag: { stored: { sharpness: 3 } } };
    const combo = ws.anvilResult({ ...stackOf('diamond_sword', 1), tag: { ench: { sharpness: 3 } } }, book, '');
    expect(combo.stack?.tag?.ench?.sharpness).toBe(4);
    void player;
  });

  it('brews potions and drinking applies effects', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    const [x, y, z] = place(player, 'brewing_stand');
    server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: 1 });
    const open = conn.last('open_window');
    expect(open?.kind).toBe('brewing');
    // Put items directly through the window slots (server side)
    const w = server.interaction.containers.windowOf(player);
    const water = { ...stackOf('potion', 1), tag: { potion: 'water' } };
    w.slots[0]!.set(water);
    w.slots[3]!.set(stackOf('nether_wart', 1));
    w.slots[4]!.set(stackOf('blaze_powder', 1));
    tick(server, 410);
    expect(w.slots[0]!.get()?.tag?.potion).toBe('awkward');
    w.slots[3]!.set(stackOf('sugar', 1));
    tick(server, 410);
    const swift = w.slots[0]!.get()!;
    expect(swift.tag?.potion).toBe('swiftness');
    // Drink it
    server.interaction.closeWindow(player, w.id);
    player.inventory.set(player.selectedSlot, swift);
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    tick(server, 40);
    expect(player.effects.has('speed')).toBe(true);
    expect(items[player.inventory.get(player.selectedSlot)!.id]!.id).toBe('glass_bottle');
  });
});
