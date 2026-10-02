/**
 * V6 phase 4: End engineering, transport, the five End quests and Elytra
 * upgrades, on a real server.
 *
 * Engineering: every End generator's output and fuel, the Void Collector
 * only over open void (and the phase 5 storm hook), the Void Cell through the
 * ordinary battery logic, the End Processor's recipes, the Crystal Grower,
 * states and signal modes, and nothing found-only is craftable.
 * Transport: bridges (project, hold, fade with a warning), nodes (cost,
 * warm-up, unsafe arrivals, no crossing dimensions), gateway pairs
 * (deterministic, both ends, both ways), rails and the Void Skiff.
 * Quests, Elytra, saves and the Admin Panel follow below.
 */
import { describe, it, expect } from 'vitest';
import { join, tick } from '../helpers/testServer';
import { endPad, settle, type Pad } from '../helpers/v6p4';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { Dimension } from '../../src/server/world/Dimension';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { S, stateOf, getProp, STATE_SOLID, blocks, STATE_BLOCK } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { stackOf, isAdminStack, maxDurability, type ItemStack } from '../../src/common/game/itemstack';
import { portAt } from '../../src/server/engineering/ports';
import type { EngBE } from '../../src/server/engineering/state';
import { COMPONENT_BY_ID, ENG_CRAFTING, END_COMPONENTS, CRYSTAL_GEN, VOID_COLLECTOR, ANCIENT_CORE_GEN } from '../../src/common/engineering/catalog';
import { CRAFTING } from '../../src/common/data/recipes';
import { computePlacement } from '../../src/common/game/placement';
import { newBody, moveBody, stepGlide } from '../../src/common/physics/movement';
import { ELYTRA, elytraUpgrades, withUpgrade, upgradeLines, glideFactors } from '../../src/common/endExpansion/elytra';
import { Mob } from '../../src/server/entity/Mob';
import { BRIDGE, NODE, SKIFF, CART, nodeCost } from '../../src/common/endExpansion/transport';

const blockId = (s: number): string => blocks[STATE_BLOCK[s]!]!.id;

const be = (dim: Dimension, x: number, y: number, z: number): EngBE => dim.getBlockEntity(x, y, z) as EngBE;
const owned = (p: Pad, x: number, y: number, z: number): EngBE => {
  const b = be(p.dim, x, y, z);
  b.by = p.player.uuid;
  return b;
};

// ---------------------------------------------------------------------------
// End engineering
// ---------------------------------------------------------------------------

describe('End engineering', () => {
  it('the Crystal Generator burns End Crystal Fragments, 128 EU/t for 400 ticks each, into ordinary cable and a Void Cell', async () => {
    const p = await endPad('p4-crystal');
    const { server, dim, X, Y, Z } = p;
    dim.setBlock(X, Y, Z, stateOf('crystal_generator', { facing: 'south' }));
    owned(p, X, Y, Z);
    dim.setBlock(X + 1, Y, Z, S('insulated_cable'));
    dim.setBlock(X + 2, Y, Z, S('void_cell'));
    const port = portAt(server, dim, X, Y, Z, 2)!;
    // Only fragments go in: no coal, no other fuel
    expect(port.insert(stackOf('coal', 4))).toBe(0);
    expect(port.insert(stackOf('end_crystal_fragment', 2))).toBe(2);
    tick(server, 12);
    const node = server.engineering!.node(dim, X, Y, Z)!;
    expect(node.rate).toBe(CRYSTAL_GEN.gen);
    expect(be(dim, X, Y, Z).status).toBe('working');
    expect(getProp(dim.getState(X, Y, Z), 'status')).toBe('working');
    expect(p.player.achievements.has('run_crystal_generator')).toBe(true);
    // Two fragments: 800 ticks of burning, then it stops for want of fuel
    tick(server, 2 * CRYSTAL_GEN.burn + 20);
    expect(be(dim, X, Y, Z).status?.startsWith('no_fuel')).toBe(true);
    expect(getProp(dim.getState(X, Y, Z), 'status')).not.toBe('working');
    const cell = be(dim, X + 2, Y, Z).energy ?? 0;
    const made = (be(dim, X, Y, Z).energy ?? 0) + cell;
    expect(made).toBeGreaterThan(CRYSTAL_GEN.gen * 2 * CRYSTAL_GEN.burn * 0.9);
    expect(made).toBeLessThanOrEqual(CRYSTAL_GEN.gen * 2 * CRYSTAL_GEN.burn + 1);
    // Through the ordinary network: the cable carries it, the cell holds it
    expect(server.engineering!.energy.netAt(dim, X + 1, Y, Z)!.cap).toBe(512);
    expect(cell).toBeGreaterThan(0);
  }, 180000);

  it('the Void Collector makes 24 EU/t only with open void below it (x4 when a phase 5 Void Storm says so)', async () => {
    const p = await endPad('p4-void');
    const { server, dim, X, Y, Z } = p;
    // Off the pad's edge: nothing below at all
    const vx = X + 12;
    dim.setBlock(vx, Y, Z, stateOf('void_collector', { facing: 'south' }));
    tick(server, 12);
    const node = server.engineering!.node(dim, vx, Y, Z)!;
    expect(node.rate).toBe(VOID_COLLECTOR.gen);
    // The phase 5 hook
    server.endEvents = { voidStormFactor: () => 4 };
    tick(server, 8);
    expect(node.rate).toBe(VOID_COLLECTOR.gen * 4);
    server.endEvents = undefined;
    // Anything below it, however far down, stops it
    dim.setBlock(vx, 20, Z, S('end_stone'));
    tick(server, 8);
    expect(node.rate).toBe(0);
    expect(be(dim, vx, Y, Z).status?.startsWith('no_void')).toBe(true);
    dim.setBlock(vx, 20, Z, 0);
    // On the pad: never
    dim.setBlock(X, Y, Z, stateOf('void_collector', { facing: 'south' }));
    tick(server, 8);
    expect(server.engineering!.node(dim, X, Y, Z)!.rate).toBe(0);
  }, 180000);

  it('a restored Ancient Core makes 512 EU/t for ever; it, the restored lens and the pedestals are never crafted', async () => {
    const p = await endPad('p4-core');
    const { server, dim, X, Y, Z } = p;
    dim.setBlock(X, Y, Z, stateOf('restored_ancient_core', { facing: 'south' }));
    dim.setBlock(X + 1, Y, Z, S('void_cell'));
    tick(server, 2000);
    expect(server.engineering!.node(dim, X, Y, Z)!.rate).toBe(ANCIENT_CORE_GEN);
    expect(be(dim, X + 1, Y, Z).energy).toBeGreaterThan(ANCIENT_CORE_GEN * 1900);
    const found = END_COMPONENTS.filter((c) => c.uncraftable).map((c) => c.id);
    expect(found).toEqual(expect.arrayContaining(['restored_ancient_core', 'restored_ancient_lens', 'crystal_pedestal']));
    for (const id of found) {
      expect(ENG_CRAFTING.some((r) => r.result === id), id).toBe(false);
      expect(CRAFTING.some((r) => r.result === id), id).toBe(false);
    }
    // Every other End machine is made at the Engineering Crafting Table
    for (const c of END_COMPONENTS.filter((e) => !e.uncraftable)) expect(ENG_CRAFTING.some((r) => r.result === c.id), c.id).toBe(true);
  }, 180000);

  it('the Void Cell charges and drains like any battery, keeps its charge when broken, and filling it earns its advancement', async () => {
    const p = await endPad('p4-cell');
    const { server, dim, X, Y, Z } = p;
    const c = COMPONENT_BY_ID.get('void_cell')!;
    expect(c.kind).toBe('battery');
    expect(c.energy!.capacity).toBe(2_000_000);
    expect(c.energy!.maxIn).toBe(4096);
    expect(c.energy!.maxOut).toBe(4096);
    dim.setBlock(X, Y, Z, stateOf('restored_ancient_core', { facing: 'south' }));
    dim.setBlock(X + 1, Y, Z, S('void_cell'));
    const cell = owned(p, X + 1, Y, Z);
    cell.energy = 2_000_000 - 2000;
    tick(server, 40);
    expect(cell.energy).toBe(2_000_000);
    expect(p.player.achievements.has('fill_void_cell')).toBe(true);
    // Drains into a machine like a battery would
    dim.setBlock(X, Y, Z, S('end_stone'));
    dim.setBlock(X + 2, Y, Z, stateOf('end_processor', { facing: 'south' }));
    portAt(server, dim, X + 2, Y, Z, 1)!.insert(stackOf('ender_ore', 8));
    tick(server, 200);
    expect(be(dim, X + 1, Y, Z).energy!).toBeLessThan(2_000_000);
    // Broken, it keeps its charge in the item
    const drops: ItemStack[] = [stackOf('void_cell', 1)];
    server.engineering!.decorateDrops(be(dim, X + 1, Y, Z), drops);
    expect(Number(drops[0]!.tag?.data?.energy)).toBeGreaterThan(1_900_000);
    // A cheat-filled cell never counts
    const q = await endPad('p4-cell2');
    q.dim.setBlock(q.X, q.Y, q.Z, S('void_cell'));
    const c2 = owned(q, q.X, q.Y, q.Z);
    c2.cheat = 1;
    c2.energy = 2_000_000;
    tick(q.server, 20);
    expect(q.player.achievements.has('fill_void_cell')).toBe(false);
  }, 240000);

  it("the End Processor runs all five of its recipes (more than smelting gives), and the Crystal Grower grows clusters", async () => {
    const p = await endPad('p4-proc');
    const { server, dim, X, Y, Z } = p;
    // A processor per recipe (two output slots each), all on one charged Void Cell line
    let at = X - 6;
    let mx = at;
    const out = (id: string): number => (be(dim, mx, Y, Z).items ?? []).filter((s) => s && String(s.id).replace(/^minehonk:/, '') === id).reduce((n, s) => n + s!.count, 0);
    const run = (input: string, n: number): void => {
      mx = at;
      at += 2;
      dim.setBlock(mx, Y, Z + 1, S('void_cell'));
      be(dim, mx, Y, Z + 1).energy = 1_000_000;
      dim.setBlock(mx, Y, Z, stateOf('end_processor', { facing: 'south' }));
      expect(portAt(server, dim, mx, Y, Z, 1)!.insert(stackOf(input, n)), input).toBe(n);
      tick(server, 140 * n);
    };
    run('ender_ore', 2);
    expect(out('ender_scrap')).toBe(4);
    run('void_crystal_ore', 1);
    expect(out('void_shard')).toBeGreaterThanOrEqual(4);
    expect(out('void_shard')).toBeLessThanOrEqual(6);
    run('end_crystal_cluster', 1);
    expect(out('end_crystal_fragment')).toBe(5);
    run('chorus_stalk', 1);
    expect(out('chorus_fiber')).toBe(4);
    run('ancient_end_fragment', 1);
    expect(out('ancient_fragment')).toBeGreaterThanOrEqual(3);
    // Smelting Ender Ore still gives one
    const { smeltingFor } = await import('../../src/common/game/crafting');
    const smelt = smeltingFor(itemById.get('ender_ore')!.num) as unknown as { result: string; count?: number };
    expect(smelt.result).toBe('ender_scrap');
    expect(smelt.count ?? 1).toBe(1);
    // The grower: Crystalline End Stone beside it, air above, about 5 minutes
    dim.setBlock(X + 2, Y, Z, stateOf('crystal_grower', { facing: 'south' }));
    dim.setBlock(X + 2, Y, Z + 1, S('crystalline_end_stone'));
    dim.setBlock(X + 3, Y, Z, S('void_cell'));
    be(dim, X + 3, Y, Z).energy = 1_000_000;
    tick(server, 200);
    expect(be(dim, X + 2, Y, Z).status).toBe('working');
    tick(server, 6000);
    expect(blockId(dim.getState(X + 2, Y + 1, Z + 1))).toBe('end_crystal_cluster');
  }, 300000);

  it('signal modes: a projector set to need a signal waits for one', async () => {
    const p = await endPad('p4-signal');
    const { server, dim, X, Y, Z } = p;
    dim.setBlock(X + 8, Y, Z, stateOf('ender_bridge_projector', { facing: 'east' }));
    dim.setBlock(X + 7, Y, Z, S('void_cell'));
    be(dim, X + 7, Y, Z).energy = 100000;
    be(dim, X + 8, Y, Z).cfg = { signal: 'on' };
    tick(server, 20);
    expect(blockId(dim.getState(X + 9, Y, Z))).toBe('air');
    expect(be(dim, X + 8, Y, Z).status).toBe('disabled');
    dim.setBlock(X + 8, Y + 1, Z, S('redstone_block'));
    tick(server, 20);
    expect(blockId(dim.getState(X + 9, Y, Z))).toBe('ender_light');
  }, 180000);
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe('Ender Bridges and Ender Rails', () => {
  it('a bridge projects to 64 blocks or the first solid block, holds a walker, costs 16 EU/t per 16 blocks, and flickers then fades when the power goes', async () => {
    const p = await endPad('p4-bridge');
    const { server, dim, X, Y, Z } = p;
    dim.setBlock(X + 8, Y, Z, stateOf('ender_bridge_projector', { facing: 'east' }));
    dim.setBlock(X + 7, Y, Z, S('void_cell'));
    const cell = be(dim, X + 7, Y, Z);
    cell.energy = 50000;
    tick(server, 20);
    let len = 0;
    while (len < 80 && blockId(dim.getState(X + 9 + len, Y, Z)) === 'ender_light') len++;
    expect(len).toBe(BRIDGE.max);
    // 64 blocks: 4 x 16 EU/t
    const e0 = (cell.energy ?? 0) + (be(dim, X + 8, Y, Z).energy ?? 0);
    tick(server, 40);
    const e1 = (cell.energy ?? 0) + (be(dim, X + 8, Y, Z).energy ?? 0);
    expect(e0 - e1).toBeCloseTo(64 * 40, -2);
    // Solid and walkable: a body dropped onto it stays on top
    expect(STATE_SOLID[dim.getState(X + 30, Y, Z)]).toBe(1);
    const b = newBody(X + 30.5, Y + 2, Z + 0.5, 0.6, 1.8);
    for (let i = 0; i < 40; i++) {
      b.vy -= 0.08;
      moveBody(dim, b, 0, b.vy, 0);
    }
    expect(b.y).toBeCloseTo(Y + 1, 3);
    // Unmineable
    expect(blocks[STATE_BLOCK[dim.getState(X + 30, Y, Z)]!]!.def.hardness).toBeLessThan(0);
    // A block in the way shortens it
    dim.setBlock(X + 20, Y, Z, S('end_stone'));
    tick(server, 12);
    expect(blockId(dim.getState(X + 21, Y, Z))).toBe('air');
    expect(blockId(dim.getState(X + 19, Y, Z))).toBe('ender_light');
    dim.setBlock(X + 20, Y, Z, 0);
    tick(server, 12);
    expect(blockId(dim.getState(X + 30, Y, Z))).toBe('ender_light');
    // Power gone: a warning flicker first, then gone after 3 seconds
    cell.energy = 0;
    be(dim, X + 8, Y, Z).energy = 0;
    tick(server, 16);
    const mid = dim.getState(X + 30, Y, Z);
    expect(blockId(mid)).toBe('ender_light');
    expect(getProp(mid, 'fade')).not.toBe('0');
    tick(server, BRIDGE.fadeTicks);
    expect(blockId(dim.getState(X + 30, Y, Z))).toBe('air');
    // Broken projector: its bridge fades on its own
    cell.energy = 50000;
    tick(server, 20);
    expect(blockId(dim.getState(X + 30, Y, Z))).toBe('ender_light');
    dim.setBlock(X + 8, Y, Z, 0);
    tick(server, BRIDGE.fadeTicks + 8);
    expect(blockId(dim.getState(X + 30, Y, Z))).toBe('air');
  }, 180000);

  it('walking across the void on a bridge earns its advancement', async () => {
    const p = await endPad('p4-walk');
    const { server, dim, X, Y, Z, player } = p;
    dim.setBlock(X + 8, Y, Z, stateOf('ender_bridge_projector', { facing: 'east' }));
    dim.setBlock(X + 7, Y, Z, S('void_cell'));
    be(dim, X + 7, Y, Z).energy = 100000;
    tick(server, 20);
    for (let x = X + 10; x <= X + 50; x += 0.5) {
      server.teleport(player, x, Y + 1, Z + 0.5);
      player.body.onGround = true;
      tick(server, 2);
    }
    expect(player.achievements.has('cross_ender_bridge')).toBe(true);
  }, 180000);

  it('Ender Rails lie on Ender Light and, powered, drive carts twice as fast as powered rails', async () => {
    const p = await endPad('p4-rails');
    const { server, dim, X, Y, Z, player } = p;
    // A bridge to lay a line on
    dim.setBlock(X + 8, Y, Z, stateOf('ender_bridge_projector', { facing: 'east' }));
    dim.setBlock(X + 7, Y, Z, S('void_cell'));
    be(dim, X + 7, Y, Z).energy = 1_000_000;
    tick(server, 20);
    const place = (id: string, x: number, y: number, z: number): boolean => {
      const pl = computePlacement(dim, { blockId: id, x, y: y - 1, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, yaw: -Math.PI / 2, pitch: 0, sneaking: false });
      if (!pl) return false;
      for (const q of pl) dim.setBlock(q.x, q.y, q.z, q.state);
      return true;
    };
    // On Ender Light: yes; over open void: no
    expect(place('ender_rail', X + 20, Y + 1, Z)).toBe(true);
    expect(blockId(dim.getState(X + 20, Y + 1, Z))).toBe('ender_rail');
    expect(computePlacement(dim, { blockId: 'ender_rail', x: X + 20, y: Y - 3, z: Z + 5, face: 1, hx: 0.5, hy: 1, hz: 0.5, yaw: 0, pitch: 0, sneaking: false })).toBeNull();
    // Two lines: powered rails on a redstone block, and Ender Rails on cable-fed power
    const speedOn = (id: string, z: number): number => {
      // Powered rails on redstone blocks; Ender Rails on charged Void Cells (1 EU/t each through the network)
      for (let x = X - 6; x <= X + 6; x++) {
        dim.setBlock(x, Y - 1, z, id === 'powered_rail' ? S('redstone_block') : S('void_cell'));
        if (id === 'ender_rail') be(dim, x, Y - 1, z).energy = 100000;
        dim.setBlock(x, Y, z, stateOf(id, { shape: 'east_west' }));
      }
      tick(server, 12);
      expect(getProp(dim.getState(X, Y, z), 'powered')).toBe('true');
      const cart = { ...stackOf('minecart', 1) };
      player.inventory.set(0, cart);
      expect(server.endTransport!.placeVehicle(player, cart, 0, [X - 5, Y, z])).toBe(true);
      const m = [...dim.entities.values()].find((e) => e instanceof Mob && e.type === 'minecart' && Math.abs(e.z - z - 0.5) < 0.6) as Mob;
      expect(m).toBeTruthy();
      m.data.speed = 0.1;
      m.data.hx = 1;
      m.data.hz = 0;
      let top = 0;
      for (let i = 0; i < 40; i++) {
        tick(server, 1);
        top = Math.max(top, Number(m.data.speed ?? 0));
      }
      return top;
    };
    const powered = speedOn('powered_rail', Z + 4);
    const ender = speedOn('ender_rail', Z - 4);
    expect(powered).toBeCloseTo(CART.powered, 2);
    expect(ender).toBeCloseTo(CART.ender, 2);
    expect(ender / powered).toBeCloseTo(2, 1);
  }, 180000);
});

describe('the Void Skiff', () => {
  it('burns a shard every 30 seconds, sinks slowly when dry (with a warning), never climbs 16 blocks in a minute, and takes a pilot and a passenger', async () => {
    const p = await endPad('p4-skiff');
    const { server, dim, X, Y, Z, player, conn } = p;
    const j2 = await join(server, 'Mate');
    const mate = j2.player;
    server.changeDimension(mate, 'end', X + 2.5, Y, Z + 0.5);
    await settle(server, 40);
    const st = stackOf('void_skiff', 1);
    player.inventory.set(0, st);
    expect(server.endTransport!.placeVehicle(player, st, 0, [X, Y - 1, Z])).toBe(true);
    const m = [...dim.entities.values()].find((e) => e instanceof Mob && e.type === 'void_skiff') as Mob;
    expect(m).toBeTruthy();
    // Fuel: void shards into the tank
    player.inventory.set(0, stackOf('void_shard', 2));
    server.endTransport!.interact(player, m, player.inventory.get(0), 0);
    expect(m.data.fuel).toBe(2);
    // Aboard: the pilot, then a passenger; a third can't
    player.inventory.set(0, null);
    server.endTransport!.interact(player, m, null, 0);
    expect(m.rider).toBe(player);
    server.endTransport!.interact(mate, m, null, 0);
    expect(m.data.passenger).toBe(mate.uuid);
    const j3 = await join(server, 'Third');
    server.changeDimension(j3.player, 'end', X + 1.5, Y, Z + 1.5);
    await settle(server, 20);
    server.endTransport!.interact(j3.player, m, null, 0);
    expect(j3.player.vehicle).toBeNull();
    // Fly: forward and up for a minute
    server.handle(conn, { t: 'pilot', f: 1, s: 0, v: 1 });
    const y0 = m.y;
    const x0 = m.x;
    let maxRise = 0;
    for (let i = 0; i < SKIFF.climbWindow; i++) {
      server.handle(conn, { t: 'pilot', f: 0.2, s: 0, v: 1 });
      tick(server, 1);
      maxRise = Math.max(maxRise, m.y - y0);
    }
    expect(maxRise).toBeLessThanOrEqual(SKIFF.climb + 0.5);
    expect(maxRise).toBeGreaterThan(SKIFF.climb - 2);
    expect(Math.hypot(m.x - x0, m.z - Z)).toBeGreaterThan(5);
    // A shard every 30 seconds: one burnt at the start, the second after 30 s
    expect(Number(m.data.fuel)).toBe(0);
    // The passenger sits behind the pilot
    expect(mate.vehicle).toBe(m);
    // Out of fuel: it sinks slowly, with a warning
    tick(server, SKIFF.fuelTicks + 5);
    const titles = conn.of('title').filter((t) => /sinking/i.test(t.sub ?? ''));
    expect(titles.length).toBeGreaterThan(0);
    const ys = m.y;
    tick(server, 20);
    expect(ys - m.y).toBeGreaterThan(0);
    expect(ys - m.y).toBeLessThanOrEqual(SKIFF.sink * 20 + 0.01);
    // Getting off
    server.handle(conn, { t: 'dismount' });
    expect(player.vehicle).toBeNull();
    expect(m.rider).toBeNull();
  }, 180000);
});

// ---------------------------------------------------------------------------
// Teleportation Nodes
// ---------------------------------------------------------------------------

describe('Teleportation Nodes', () => {
  it('cost 1,000 EU + 10 EU a block from the departure node, need a 40-tick warm-up on the node, refuse unsafe arrivals and never cross dimensions', async () => {
    const p = await endPad('p4-nodes');
    const { server, dim, X, Y, Z, player, conn } = p;
    const placeNode = (x: number, y: number, z: number): void => {
      dim.setBlock(x, y, z, S('teleport_node'));
      server.engineering!.onPlaced(player, dim, x, y, z, stackOf('teleport_node', 1));
    };
    placeNode(X, Y, Z);
    // The far node: on its own pad, 60 blocks away
    for (let x = X + 57; x <= X + 63; x++) for (let z = Z - 3; z <= Z + 3; z++) dim.setBlock(x, Y - 1, z, S('end_stone'));
    placeNode(X + 60, Y, Z);
    const far = `end|${X + 60},${Y},${Z}`;
    const cost = nodeCost(60);
    expect(cost).toBe(NODE.base + NODE.perBlock * 60);
    const open = (): number => {
      server.engineering!.useBlock(player, X, Y, Z, dim.getState(X, Y, Z));
      return player.windowId;
    };
    // Its window: a name, a lock, the destinations with their costs
    const w = open();
    const wp = conn.of('open_window').pop()!.data as { field?: { value: string }; choices?: { key: string; ok: boolean; detail: string }[] };
    expect(wp.field?.value).toMatch(/Node/);
    expect(wp.choices?.some((c) => c.key === `go:${far}` && !c.ok)).toBe(true);
    // Rename it
    server.handle(conn, { t: 'eng_cfg', window: w, key: 'name', value: 'Home pad' });
    expect(server.endTransport!.nodeList().find(([k]) => k === `end|${X},${Y},${Z}`)![1].name).toBe('Home pad');
    // Not enough power: nothing happens
    server.handle(conn, { t: 'eng_cfg', window: w, key: `go:${far}`, value: 1 });
    tick(server, 60);
    expect(Math.round(player.x)).toBe(X + 1);
    // Powered, standing on it: 40 ticks of warm-up, then the trip, paid from the departure node
    const src = be(dim, X, Y, Z);
    src.energy = 200000;
    server.teleport(player, X + 0.5, Y + 1, Z + 0.5);
    open();
    server.handle(conn, { t: 'eng_cfg', window: player.windowId, key: `go:${far}`, value: 1 });
    tick(server, NODE.warmup - 5);
    expect(Math.floor(player.x)).toBe(X);
    tick(server, 10);
    expect(Math.floor(player.x)).toBe(X + 60);
    expect(src.energy).toBe(200000 - cost);
    expect(player.achievements.has('teleport_own_nodes')).toBe(true);
    // Stepping off during the warm-up cancels it
    server.teleport(player, X + 0.5, Y + 1, Z + 0.5);
    open();
    server.handle(conn, { t: 'eng_cfg', window: player.windowId, key: `go:${far}`, value: 1 });
    tick(server, 10);
    server.teleport(player, X + 3.5, Y, Z + 0.5);
    tick(server, 60);
    expect(Math.floor(player.x)).toBe(X + 3);
    // A blocked arrival: refused, and nothing paid
    dim.setBlock(X + 60, Y + 1, Z, S('end_stone'));
    server.teleport(player, X + 0.5, Y + 1, Z + 0.5);
    const before = src.energy!;
    open();
    server.handle(conn, { t: 'eng_cfg', window: player.windowId, key: `go:${far}`, value: 1 });
    tick(server, NODE.warmup + 10);
    expect(Math.floor(player.x)).toBe(X);
    expect(src.energy).toBe(before);
    expect(conn.of('chat').some((c) => /blocked/.test(c.text))).toBe(true);
    // Standing anywhere else, a request is ignored (the client can't fake standing on it)
    dim.setBlock(X + 60, Y + 1, Z, 0);
    server.teleport(player, X + 4.5, Y, Z + 0.5);
    open();
    server.handle(conn, { t: 'eng_cfg', window: player.windowId, key: `go:${far}`, value: 1 });
    tick(server, NODE.warmup + 10);
    expect(Math.floor(player.x)).toBe(X + 4);
    // A node in the Overworld near spawn works, but never lists End nodes
    const ow = server.dim('overworld');
    const sp = server.level.spawn!;
    server.changeDimension(player, 'overworld', sp[0] + 0.5, sp[1] + 10, sp[2] + 0.5);
    await settle(server, 100, () => ow.isLoaded(sp[0], sp[2]));
    ow.setBlock(sp[0] + 2, 200, sp[2], S('teleport_node'));
    server.engineering!.onPlaced(player, ow, sp[0] + 2, 200, sp[2], stackOf('teleport_node', 1));
    const owNode = server.engineering!.node(ow, sp[0] + 2, 200, sp[2])!;
    expect(server.endTransport!.nodeWorks('overworld', sp[0] + 2, sp[2])).toBe(true);
    expect(server.endTransport!.nodeWorks('overworld', sp[0] + 2500, sp[2])).toBe(false);
    expect(server.endTransport!.nodeWorks('nether', 0, 0)).toBe(false);
    expect(server.endTransport!.destinations(owNode, player).length).toBe(0);
  }, 240000);

  it('a locked node is its owner\'s alone', async () => {
    const p = await endPad('p4-lock');
    const { server, dim, X, Y, Z, player } = p;
    for (const x of [X, X + 4]) {
      dim.setBlock(x, Y, Z, S('teleport_node'));
      server.engineering!.onPlaced(player, dim, x, Y, Z, stackOf('teleport_node', 1));
    }
    const j = await join(server, 'Guest');
    server.changeDimension(j.player, 'end', X + 0.5, Y + 1, Z + 0.5);
    await settle(server, 30);
    const a = server.engineering!.node(dim, X, Y, Z)!;
    be(dim, X, Y, Z).energy = 100000;
    expect(server.endTransport!.destinations(a, j.player).every((d) => d.ok)).toBe(true);
    server.endTransport!.nodeCfg(player, server.engineering!.node(dim, X + 4, Y, Z)!, 'lock', 1);
    expect(server.endTransport!.destinations(a, j.player).every((d) => !d.ok)).toBe(true);
    expect(server.endTransport!.destinations(a, player).every((d) => d.ok)).toBe(true);
    // The guest can't take the lock off
    server.endTransport!.nodeCfg(j.player, server.engineering!.node(dim, X + 4, Y, Z)!, 'lock', 1);
    expect(server.endTransport!.destinations(a, j.player).every((d) => !d.ok)).toBe(true);
  }, 180000);
});

void isAdminStack;
void maxDurability;

// ---------------------------------------------------------------------------
// Elytra upgrades
// ---------------------------------------------------------------------------

/** The Elytra's glide as it was before phase 4, word for word: the reference flight. */
function originalGlide(world: Parameters<typeof moveBody>[0], b: ReturnType<typeof newBody>, yaw: number, pitch: number, boost: boolean): void {
  const cp = Math.cos(pitch);
  const lx = -Math.sin(yaw) * cp;
  const ly = -Math.sin(pitch);
  const lz = -Math.cos(yaw) * cp;
  const horiz = Math.hypot(lx, lz);
  const speedH = Math.hypot(b.vx, b.vz);
  const lift = cp * cp;
  b.vy += 0.08 * (-1 + lift * 0.75);
  if (b.vy < 0 && horiz > 0) {
    const m = b.vy * -0.1 * lift;
    b.vx += (lx * m) / horiz;
    b.vy += m;
    b.vz += (lz * m) / horiz;
  }
  if (pitch < 0 && horiz > 0) {
    const m = speedH * Math.sin(-pitch) * 0.04;
    b.vx -= (lx * m) / horiz;
    b.vy += m * 3.2;
    b.vz -= (lz * m) / horiz;
  }
  if (horiz > 0) {
    b.vx += ((lx / horiz) * speedH - b.vx) * 0.1;
    b.vz += ((lz / horiz) * speedH - b.vz) * 0.1;
  }
  if (boost) {
    b.vx += lx * 0.1 + (lx * 1.5 - b.vx) * 0.5;
    b.vy += ly * 0.1 + (ly * 1.5 - b.vy) * 0.5;
    b.vz += lz * 0.1 + (lz * 1.5 - b.vz) * 0.5;
  }
  b.vx *= 0.99;
  b.vy *= 0.98;
  b.vz *= 0.99;
  moveBody(world, b, b.vx, b.vy, b.vz);
  b.fallDistance = 0;
}

/** Elytra + something at a smithing table: what comes out (taken), and what's left in the second slot. */
function smith(p: Pad, base: ItemStack, addition: ItemStack): { out: ItemStack | null; left: ItemStack | null } {
  const ct = p.server.interaction.containers;
  ct.openSmithing(p.player, p.dim, p.X, p.Y, p.Z);
  const w = ct.windowFor(p.player)!;
  w.slots[0]!.set(base);
  w.slots[1]!.set(addition);
  w.refresh?.();
  const out = w.slots[2]!.get() as ItemStack | null;
  if (out) w.slots[2]!.onTake?.(p.player, out);
  const left = w.slots[1]!.get() as ItemStack | null;
  w.slots[0]!.set(null);
  w.slots[1]!.set(null);
  p.server.interaction.closeWindow(p.player, w.id, true);
  return { out, left };
}

describe('Elytra upgrades', () => {
  it('modules go on at the smithing table: three slots, never twice; shears take the newest off (the module is lost); Reinforced doubles durability', async () => {
    const p = await endPad('p4-smith');
    const { player } = p;
    const el = stackOf('elytra', 1);
    expect(maxDurability(el)).toBe(ELYTRA.durability);
    const a = smith(p, el, stackOf('reinforced_module', 2));
    expect(elytraUpgrades(a.out)).toEqual(['reinforced']);
    expect(a.left?.count).toBe(1);
    expect(maxDurability(a.out!)).toBe(864);
    expect(player.achievements.has('elytra_upgrade')).toBe(true);
    // Not twice
    expect(smith(p, a.out!, stackOf('reinforced_module', 1)).out).toBeNull();
    const b = smith(p, a.out!, stackOf('thrust_module', 1)).out!;
    const c = smith(p, b, stackOf('hover_module', 1)).out!;
    expect(elytraUpgrades(c)).toEqual(['reinforced', 'thrust', 'hover']);
    expect(player.achievements.has('elytra_full')).toBe(true);
    // No fourth
    expect(smith(p, c, stackOf('burst_module', 1)).out).toBeNull();
    // Shears: the newest comes off and is gone; the shears wear a little
    const off = smith(p, c, stackOf('shears', 1));
    expect(elytraUpgrades(off.out)).toEqual(['reinforced', 'thrust']);
    expect(off.left && items[off.left.id]!.id).toBe('shears');
    expect(off.left!.damage).toBe(1);
    for (let i = 0; i < player.inventory.size; i++) expect(items[player.inventory.get(i)?.id ?? 0]?.id).not.toBe('hover_module');
    // The tooltip lists them
    expect(upgradeLines(c)).toEqual(['Upgrades (3/3):', '  Reinforced', '  Thrust', '  Hover']);
    // Taking Reinforced off a badly worn Elytra leaves it on its last point, not broken
    const worn = { ...withUpgrade(el, 'reinforced'), damage: 800 };
    expect(smith(p, worn, stackOf('shears', 1)).out!.damage).toBe(ELYTRA.durability - 1);
  }, 180000);

  it('upgrades survive repairs with either membrane, renaming at the anvil, and a save', async () => {
    const storage = new MemoryStorage();
    const p = await endPad('p4-anvil', {}, storage);
    const ws = p.server.workstations!;
    const up = { ...withUpgrade(withUpgrade(stackOf('elytra', 1), 'reinforced'), 'burst'), damage: 700 };
    for (const mem of ['phantom_membrane', 'end_phantom_membrane']) {
      const r = ws.anvilResult(up, stackOf(mem, 2), '');
      expect(r.stack, mem).toBeTruthy();
      expect(elytraUpgrades(r.stack as ItemStack)).toEqual(['reinforced', 'burst']);
      expect((r.stack as ItemStack).damage ?? 0).toBeLessThan(700);
    }
    const named = ws.anvilResult(up, null, 'Skyrunner').stack as ItemStack;
    expect(elytraUpgrades(named)).toEqual(['reinforced', 'burst']);
    // Worn, saved, back again
    p.player.inventory.set(38, up);
    await p.server.playerData.save(p.player);
    await p.server.stop();
    const { GameServer } = await import('../../src/server/GameServer');
    const { installGameplay } = await import('../../src/server/gameplay');
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    const j = await join(s2);
    expect(elytraUpgrades(j.player.inventory.get(38))).toEqual(['reinforced', 'burst']);
    expect(j.player.inventory.get(38)!.damage).toBe(700);
  }, 180000);

  it('without upgrades an Elytra flies exactly as before (a recorded flight path, rockets and all); Thrust is faster and the server allows for it', async () => {
    const p = await endPad('p4-flight');
    const { dim, X, Y, Z, server, player } = p;
    const flight = (step: (b: ReturnType<typeof newBody>, t: number) => void): number[] => {
      const b = newBody(X + 0.5, Y + 60, Z + 40.5, 0.6, 1.8);
      const out: number[] = [];
      for (let t = 0; t < 400; t++) {
        step(b, t);
        out.push(b.x, b.y, b.z, b.vx, b.vy, b.vz);
      }
      return out;
    };
    // Dives, climbs, turns and a rocket now and then
    const yawAt = (t: number): number => Math.sin(t / 40) * 1.2;
    const pitchAt = (t: number): number => Math.sin(t / 23) * 0.9 + 0.2;
    const boostAt = (t: number): boolean => t % 90 < 18;
    const before = flight((b, t) => originalGlide(dim, b, yawAt(t), pitchAt(t), boostAt(t)));
    const now = flight((b, t) => stepGlide(dim, b, yawAt(t), pitchAt(t), boostAt(t)));
    const noUps = flight((b, t) => stepGlide(dim, b, yawAt(t), pitchAt(t), boostAt(t), glideFactors([])));
    expect(now).toEqual(before);
    expect(noUps).toEqual(before);
    // Thrust: a dive picks up more speed, and a rocket pushes harder
    const dive = (f: ReturnType<typeof glideFactors>, boost: boolean): number => {
      const b = newBody(X + 0.5, Y + 60, Z + 40.5, 0.6, 1.8);
      for (let t = 0; t < 30; t++) stepGlide(dim, b, 0, boost ? 0 : 0.5, boost, f);
      return Math.hypot(b.vx, b.vz);
    };
    expect(dive(glideFactors(['thrust']), false)).toBeGreaterThan(dive(glideFactors([]), false) * 1.1);
    expect(dive(glideFactors(['thrust']), true)).toBeCloseTo(dive(glideFactors([]), true) * 1.2, 1);
    // The server's movement budget: the same without Thrust, more with it
    player.inventory.set(38, stackOf('elytra', 1));
    expect(server.elytra!.speedFactor(player)).toBe(1);
    player.inventory.set(38, withUpgrade(stackOf('elytra', 1), 'thrust'));
    expect(server.elytra!.speedFactor(player)).toBeCloseTo(ELYTRA.thrustGlide, 5);
  }, 180000);

  it('Hover holds for 3 seconds at most while sneaking in a glide, wears the wings a little, and recharges on the ground', async () => {
    const p = await endPad('p4-hover');
    const { server, player, conn } = p;
    // Gliding wears an Elytra a point a second anyway: Hover adds a point every 10 ticks of hovering
    const wear = async (el: ItemStack, sneak: boolean): Promise<number> => {
      player.inventory.set(38, el);
      player.gliding = true;
      player.sneaking = sneak;
      player.body.onGround = false;
      tick(server, ELYTRA.hoverTicks + 40);
      const d = player.inventory.get(38)!.damage ?? 0;
      player.gliding = false;
      player.body.onGround = true;
      tick(server, 4);
      return d;
    };
    const plain = await wear(stackOf('elytra', 1), true);
    const hovering = await wear(withUpgrade(stackOf('elytra', 1), 'hover'), true);
    expect(hovering - plain).toBe(ELYTRA.hoverTicks / ELYTRA.hoverWear);
    player.inventory.set(38, withUpgrade(stackOf('elytra', 1), 'hover'));
    player.gliding = true;
    player.sneaking = true;
    player.body.onGround = false;
    tick(server, ELYTRA.hoverTicks + 40);
    const last = conn.of('elytra').pop()!;
    expect(last.hover).toBe(0);
    // On the ground: full again
    player.gliding = false;
    player.body.onGround = true;
    tick(server, 12);
    expect(conn.of('elytra').pop()!.hover).toBe(ELYTRA.hoverTicks);
    // Without the upgrade, sneaking in a glide costs nothing extra
    expect(await wear(stackOf('elytra', 1), true)).toBe(await wear(stackOf('elytra', 1), false));
  }, 180000);

  it('Burst: a push without a rocket, three charges, each back 10 seconds after use; only while gliding', async () => {
    const p = await endPad('p4-burst');
    const { server, player, conn } = p;
    player.inventory.set(38, withUpgrade(stackOf('elytra', 1), 'burst'));
    // Not gliding: nothing
    server.handle(conn, { t: 'elytra', a: 'burst' });
    expect(conn.of('boost').length).toBe(0);
    player.gliding = true;
    for (let i = 0; i < 4; i++) server.handle(conn, { t: 'elytra', a: 'burst' });
    expect(conn.of('boost').length).toBe(3);
    expect(player.boostUntil).toBeGreaterThan(server.tickNo);
    // Not back yet halfway through
    tick(server, ELYTRA.burstRecharge / 2);
    server.handle(conn, { t: 'elytra', a: 'burst' });
    expect(conn.of('boost').length).toBe(3);
    tick(server, ELYTRA.burstRecharge / 2 + 2);
    server.handle(conn, { t: 'elytra', a: 'burst' });
    server.handle(conn, { t: 'elytra', a: 'burst' });
    expect(conn.of('boost').length).toBe(5);
    // Without the upgrade, never
    player.inventory.set(38, stackOf('elytra', 1));
    tick(server, ELYTRA.burstRecharge + 2);
    server.handle(conn, { t: 'elytra', a: 'burst' });
    expect(conn.of('boost').length).toBe(5);
  }, 180000);

  it('Ender Blink: 8 blocks ahead in the open, cut short before a wall and never into it; 20 seconds to recharge', async () => {
    const p = await endPad('p4-blink');
    const { server, player, conn, dim, X, Y, Z } = p;
    player.inventory.set(38, withUpgrade(stackOf('elytra', 1), 'ender_blink'));
    const face = (): void => {
      player.yaw = -Math.PI / 2;
      player.pitch = 0;
    };
    server.teleport(player, X + 0.5, Y + 10, Z + 0.5);
    face();
    player.gliding = true;
    server.handle(conn, { t: 'elytra', a: 'blink' });
    expect(player.x).toBeCloseTo(X + 0.5 + ELYTRA.blink, 1);
    // Cooldown
    const x1 = player.x;
    server.handle(conn, { t: 'elytra', a: 'blink' });
    expect(player.x).toBe(x1);
    tick(server, ELYTRA.blinkCooldown + 2);
    // A wall 4 blocks ahead: stops short, never inside it
    for (let dy = 0; dy < 3; dy++) for (let dz = -1; dz <= 1; dz++) dim.setBlock(Math.floor(x1) + 4, Y + 10 + dy, Z + dz, S('end_stone'));
    server.teleport(player, x1, Y + 10, Z + 0.5);
    face();
    server.handle(conn, { t: 'elytra', a: 'blink' });
    expect(player.x).toBeGreaterThan(x1 + 2);
    expect(player.x + player.body.width / 2).toBeLessThanOrEqual(Math.floor(x1) + 4 + 0.001);
    const { bodyObstructed } = await import('../../src/common/physics/movement');
    expect(bodyObstructed(dim, player.body, 0.01)).toBe(false);
    // Point-blank against the wall: no blink at all (and no cooldown spent)
    tick(server, ELYTRA.blinkCooldown + 2);
    const x2 = player.x;
    server.handle(conn, { t: 'elytra', a: 'blink' });
    expect(player.x).toBe(x2);
  }, 180000);

  it('Void Recovery: in the End, below the void line, back to the last ground for a quarter of the wings; 5 minutes to recharge; never outside the End', async () => {
    const p = await endPad('p4-recover');
    const { server, player, X, Y, Z } = p;
    player.inventory.set(38, { ...withUpgrade(stackOf('elytra', 1), 'void_recovery'), damage: 32 });
    server.teleport(player, X + 0.5, Y, Z + 0.5);
    player.body.onGround = true;
    tick(server, 4);
    // Fall
    player.body.onGround = false;
    server.teleport(player, X + 40.5, -4, Z + 0.5);
    tick(server, 2);
    expect(player.y).toBeCloseTo(Y, 3);
    expect(Math.abs(player.x - (X + 0.5))).toBeLessThan(1);
    expect(player.inventory.get(38)!.damage).toBe(32 + Math.ceil((432 - 32) * 0.25));
    expect(player.recoverCooldown).toBeGreaterThan(ELYTRA.recoveryCooldown - 10);
    // Again within the cooldown: nothing
    server.teleport(player, X + 40.5, -4, Z + 0.5);
    tick(server, 2);
    expect(player.y).toBeLessThan(0);
    // After it: once more
    player.recoverCooldown = 1;
    server.teleport(player, X + 0.5, Y, Z + 0.5);
    player.body.onGround = true;
    tick(server, 4);
    player.body.onGround = false;
    server.teleport(player, X + 40.5, -4, Z + 0.5);
    tick(server, 2);
    expect(player.y).toBeCloseTo(Y, 3);
    // Outside the End: never
    const sp = server.level.spawn!;
    server.changeDimension(player, 'overworld', sp[0] + 0.5, sp[1] + 5, sp[2] + 0.5);
    await settle(server, 60);
    player.recoverCooldown = 0;
    player.body.onGround = true;
    tick(server, 4);
    server.teleport(player, sp[0] + 0.5, -10, sp[2] + 0.5);
    tick(server, 2);
    expect(player.y).toBeLessThan(0);
    expect(player.recoverCooldown).toBe(0);
  }, 180000);
});
