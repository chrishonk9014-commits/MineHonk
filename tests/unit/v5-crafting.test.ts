/** V5: the Engineering Crafting Table and Book, machine windows, admin cheats, advancements and multiplayer. */
import { describe, it, expect } from 'vitest';
import { S, stateOf } from '../../src/common/registry/blocks';
import { itemById } from '../../src/common/registry/items';
import { stackOf, isAdminStack } from '../../src/common/game/itemstack';
import { engRecipes, matchCrafting, recipes } from '../../src/common/game/crafting';
import { MemoryStorage } from '../../src/server/storage/Storage';
import type { GameServer } from '../../src/server/GameServer';
import { portAt } from '../../src/server/engineering/ports';
import type { EngBE } from '../../src/server/engineering/state';
import type { Dimension } from '../../src/server/world/Dimension';
import { guideEntries, CHAPTERS } from '../../src/common/engineering/guide';
import { COMPONENTS, ENG_MATERIALS } from '../../src/common/engineering/catalog';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';

const num = (id: string): number => itemById.get(id)!.num;
const be = (dim: Dimension, x: number, y: number, z: number): EngBE => dim.getBlockEntity(x, y, z) as EngBE;

async function setup(opts: Record<string, unknown> = {}): Promise<{ server: GameServer; conn: FakeConn; player: Awaited<ReturnType<typeof join>>['player']; dim: Dimension; X: number; Y: number; Z: number }> {
  const { server } = await makeServer({ seed: 'eng-craft', ...opts }, new MemoryStorage());
  const { conn, player } = await join(server);
  const dim = player.dim;
  const X = Math.floor(player.x) + 1;
  const Y = Math.floor(player.y);
  const Z = Math.floor(player.z) + 1;
  for (let x = X - 1; x <= X + 4; x++) for (let z = Z - 1; z <= Z + 2; z++) {
    dim.setBlock(x, Y - 1, z, S('stone'));
    for (let y = Y; y <= Y + 2; y++) dim.setBlock(x, y, z, 0);
  }
  return { server, conn, player, dim, X, Y, Z };
}

const use = (server: GameServer, conn: FakeConn, x: number, y: number, z: number): void => server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: 1 });

describe('V5 crafting and windows', () => {
  it('engineering items are only made at the Engineering Crafting Table; the book fills its grid', async () => {
    const { server, conn, player, dim, X, Y, Z } = await setup();
    // The crusher recipe never matches at a normal table
    const crusher = engRecipes().find((r) => r.result === num('crusher'))!;
    const grid: (ReturnType<typeof stackOf> | null)[] = new Array(9).fill(null);
    for (let y = 0; y < crusher.height; y++) for (let x = 0; x < crusher.width; x++) {
      const cell = crusher.cells[y * crusher.width + x];
      if (cell) grid[y * 3 + x] = { id: [...cell][0]!, count: 1 };
    }
    expect(matchCrafting(grid, 3, 3, recipes())).toBeNull();
    expect(matchCrafting(grid, 3, 3, engRecipes())?.result).toBe(num('crusher'));
    // Using the book's Craft without a table open does nothing but explain
    for (let i = 0; i < 9; i++) if (grid[i]) player.inventory.add({ ...grid[i]!, count: 1 });
    const before = JSON.stringify(player.inventory.slots);
    server.handle(conn, { t: 'eng_fill', recipe: crusher.index, all: false });
    expect(JSON.stringify(player.inventory.slots)).toBe(before);
    expect(conn.of('chat').some((m) => m.text.includes('Engineering Crafting Table'))).toBe(true);
    // Open the table by using it
    dim.setBlock(X, Y, Z, S('engineering_table'));
    player.selectedSlot = 8;
    player.inventory.set(36 + 8, null);
    use(server, conn, X, Y, Z);
    const w = server.interaction.containers.windowOf(player);
    expect(w.kind).toBe('eng_crafting');
    // The book fills the grid from the inventory; the result is a crusher
    server.handle(conn, { t: 'eng_fill', recipe: crusher.index, all: false });
    w.refresh?.();
    expect(w.slots[0]!.get()?.id).toBe(num('crusher'));
    // Take it: the ingredients are used up, nothing duplicated
    server.handle(conn, { t: 'click', window: w.id, slot: 0, button: 0, mode: 'quick', seq: 2 });
    expect(player.inventory.slots.filter((s) => s?.id === num('crusher')).length).toBe(1);
    for (let i = 1; i <= 9; i++) expect(w.slots[i]!.get()).toBeNull();
  }, 60000);

  it('machine windows describe the machine and their settings change it', async () => {
    const { server, conn, player, dim, X, Y, Z } = await setup({ seed: 'eng-win' });
    dim.setBlock(X, Y, Z, stateOf('crusher', { facing: 'south' }));
    player.selectedSlot = 8;
    player.inventory.set(36 + 8, null);
    use(server, conn, X, Y, Z);
    const w = server.interaction.containers.windowOf(player);
    expect(w.kind).toBe('machine');
    const open = conn.last('open_window')!;
    expect(open.size).toBe(1 + 2 + 4);
    const props = open.data as { layout: { input: number; output: number; upgrades: number }; energyMax: number; buttons: { key: string }[] };
    expect(props.layout).toMatchObject({ input: 1, output: 2, upgrades: 4 });
    expect(props.energyMax).toBe(3200);
    expect(props.buttons.map((b) => b.key)).toEqual(['signal', 'enabled', 'eject']);
    // Switch it off from the window
    server.handle(conn, { t: 'eng_cfg', window: w.id, key: 'enabled', value: 1 });
    expect(be(dim, X, Y, Z).cfg?.enabled).toBe(false);
    tick(server, 8);
    const prop = conn.of('window_prop').pop()!;
    expect((prop.value as { buttons: { key: string; on?: boolean }[] }).buttons.find((b) => b.key === 'enabled')?.on).toBe(false);
    // Only upgrades go in upgrade slots
    expect(w.slots[3]!.mayPlace(stackOf('dirt', 1))).toBe(false);
    expect(w.slots[3]!.mayPlace(stackOf('speed_upgrade', 1))).toBe(true);
    expect(w.slots[0]!.mayPlace(stackOf('dirt', 1))).toBe(false);
    expect(w.slots[0]!.mayPlace(stackOf('raw_iron', 1))).toBe(true);
  }, 60000);

  it('the placer earns engineering advancements; admin-filled machines never do', async () => {
    const { server, conn, player, dim, X, Y, Z } = await setup({ seed: 'eng-adv', cheats: true });
    // Legit: placed by the player, powered by a battery they charged
    dim.setBlock(X, Y, Z, S('battery'));
    server.engineering!.onPlaced(player, dim, X, Y, Z, stackOf('battery', 1));
    dim.setBlock(X + 1, Y, Z, stateOf('crusher', { facing: 'south' }));
    server.engineering!.onPlaced(player, dim, X + 1, Y, Z, stackOf('crusher', 1));
    be(dim, X, Y, Z).energy = 20000;
    portAt(server, dim, X + 1, Y, Z, 1)!.insert(stackOf('raw_iron', 1));
    tick(server, 200);
    expect(player.achievements.has('first_machine')).toBe(true);
    // Cheat: a second player's machine filled by the Admin Panel
    const { conn: c2, player: p2 } = await join(server, 'Other');
    p2.setPos(X + 3.5, Y, Z + 0.5);
    dim.setBlock(X + 3, Y, Z, stateOf('electric_furnace', { facing: 'south' }));
    server.engineering!.onPlaced(p2, dim, X + 3, Y, Z, stackOf('electric_furnace', 1));
    server.handle(conn, { t: 'admin', req: 1, action: { a: 'v5', op: 'fill_energy' } });
    expect(be(dim, X + 3, Y, Z).cheat).toBe(true);
    portAt(server, dim, X + 3, Y, Z, 1)!.insert(stackOf('iron_dust', 2));
    tick(server, 300);
    expect(be(dim, X + 3, Y, Z).items!.some((s) => s?.id === 'iron_ingot' && !!s.tag?.admin)).toBe(true);
    expect(p2.achievements.has('first_machine')).toBe(false);
    void c2;
  }, 60000);

  it('admin kits are cheat-marked and the stress test builds 250 working machines', async () => {
    const { server, conn, player } = await setup({ seed: 'eng-admin', cheats: true });
    server.handle(conn, { t: 'admin', req: 1, action: { a: 'v5', op: 'kit_basic' } });
    const book = player.inventory.slots.find((s) => s?.id === num('engineering_book'));
    expect(book && isAdminStack(book)).toBe(true);
    server.handle(conn, { t: 'admin', req: 2, action: { a: 'v5', op: 'stress_test' } });
    tick(server, 40);
    const t0 = performance.now();
    tick(server, 100);
    const ms = (performance.now() - t0) / 100;
    expect(ms).toBeLessThan(25);
    const furnaces = [...server.engineering!.nodes.values()].filter((n) => n.c.id === 'electric_furnace');
    expect(furnaces.length).toBe(250);
    expect(furnaces.filter((n) => n.be()?.status === 'working').length).toBe(250);
    const res = conn.of('admin_result' as never) as unknown as { req: number; ok: boolean }[];
    expect(res.find((r) => r.req === 2)?.ok).toBe(true);
  }, 120000);

  it('visitors can look but not change machine settings', async () => {
    const { server, conn, dim, X, Y, Z, player } = await setup({ seed: 'eng-mp' });
    dim.setBlock(X, Y, Z, stateOf('crusher', { facing: 'south' }));
    const { conn: c2, player: p2 } = await join(server, 'Visitor');
    p2.setPos(player.x, player.y, player.z);
    (server as unknown as { roleOf(p: unknown): string }).roleOf = (pl: unknown) => (pl === p2 ? 'visitor' : 'owner');
    p2.selectedSlot = 8;
    p2.inventory.set(36 + 8, null);
    server.engineering!.windows.openFor(p2, server.engineering!.node(dim, X, Y, Z)!);
    const w = server.interaction.containers.windowOf(p2);
    server.handle(c2, { t: 'eng_cfg', window: w.id, key: 'enabled', value: 1 });
    expect(be(dim, X, Y, Z).cfg?.enabled).not.toBe(false);
    void conn;
  }, 60000);
});

describe('V5 Engineering Book', () => {
  it('has a guide chapter with steps for every topic and an entry for every component and material', () => {
    const ids = new Set(guideEntries().map((e) => e.id));
    for (const c of COMPONENTS) expect(ids.has(c.id), c.id).toBe(true);
    for (const m of ENG_MATERIALS) expect(ids.has(m), m).toBe(true);
    for (const ch of CHAPTERS) expect(ch.steps.length).toBeGreaterThanOrEqual(3);
    for (const e of guideEntries()) expect(CHAPTERS.some((c) => c.id === e.chapter), e.id).toBe(true);
    // Every component can be made at the Engineering Crafting Table (or, for the table itself, a normal one)
    for (const c of COMPONENTS) {
      const n = num(c.id);
      expect(engRecipes().some((r) => r.result === n) || recipes().some((r) => r.result === n), c.id).toBe(true);
    }
  });
});
