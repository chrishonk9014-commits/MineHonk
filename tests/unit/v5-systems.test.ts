/** V5: item transport, fluids, multiblocks, automation, control rooms, and many machines at once. */
import { describe, it, expect } from 'vitest';
import { S, stateOf, getProp } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { items } from '../../src/common/registry/items';
import { MemoryStorage } from '../../src/server/storage/Storage';
import type { GameServer } from '../../src/server/GameServer';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import { portAt } from '../../src/server/engineering/ports';
import type { EngBE } from '../../src/server/engineering/state';
import type { Dimension } from '../../src/server/world/Dimension';
import { makeServer, join, tick } from '../helpers/testServer';

async function pad(seed: string, size = 12): Promise<{ server: GameServer; dim: Dimension; X: number; Y: number; Z: number }> {
  const { server } = await makeServer({ seed }, new MemoryStorage());
  const { player } = await join(server);
  const dim = player.dim;
  const X = Math.floor(player.x) + 2;
  const Y = 170;
  const Z = Math.floor(player.z);
  for (let x = X - 3; x <= X + size; x++) for (let z = Z - 4; z <= Z + 4; z++) dim.setBlock(x, Y - 1, z, S('stone'));
  return { server, dim, X, Y, Z };
}

const be = (dim: Dimension, x: number, y: number, z: number): EngBE => dim.getBlockEntity(x, y, z) as EngBE;
describe('V5 systems', () => {
  it('an extractor pulls from a chest through pipes and a filter into the right chest', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-items');
    dim.setBlock(X, Y, Z, S('chest'));
    dim.setBlock(X + 1, Y, Z, stateOf('item_extractor', { facing: 'west' }));
    dim.setBlock(X + 2, Y, Z, S('item_pipe'));
    dim.setBlock(X + 3, Y, Z, S('item_pipe'));
    // Branch north through a filter that only lets cobblestone through; the end of the line takes the rest
    dim.setBlock(X + 3, Y, Z - 1, S('item_filter'));
    dim.setBlock(X + 3, Y, Z - 2, S('chest'));
    dim.setBlock(X + 4, Y, Z, S('item_pipe'));
    dim.setBlock(X + 5, Y, Z, S('chest'));
    be(dim, X + 3, Y, Z - 1).ghost = [stackOf('cobblestone', 1)] as never;
    be(dim, X + 1, Y, Z).energy = 400;
    const src = portAt(server, dim, X, Y, Z, 5)!;
    expect(src.insert(stackOf('cobblestone', 10))).toBe(10);
    expect(src.insert(stackOf('dirt', 6))).toBe(6);
    // The pipe took its arms from what it touches
    expect(getProp(dim.getState(X + 2, Y, Z), 'west')).toBe('true');
    expect(getProp(dim.getState(X + 2, Y, Z), 'north')).toBe('false');
    let left = 16;
    for (let i = 0; i < 100 && left > 0; i++) {
      tick(server, 20);
      be(dim, X + 1, Y, Z).energy = 400;
      left = [...src.contents().values()].reduce((a, b) => a + b, 0);
    }
    expect(left).toBe(0);
    const north = portAt(server, dim, X + 3, Y, Z - 2, 0)!.contents();
    const east = portAt(server, dim, X + 5, Y, Z, 0)!.contents();
    const sum = (m: Map<unknown, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
    // Dirt never passes the filter; cobblestone goes to whichever is nearer and open (here: both are 3 away)
    expect(sum(north) + sum(east)).toBe(16);
    // Only cobblestone made it north
    expect([...north.keys()].every((k) => items[k]!.id === 'cobblestone')).toBe(true);
    expect(sum(east)).toBeGreaterThanOrEqual(6);
    expect(be(dim, X + 1, Y, Z).status).not.toBe('no_power');
  }, 120000);

  it('hoppers pull from above and push where they point; a signal locks them', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-hopper');
    dim.setBlock(X, Y + 1, Z, S('chest'));
    dim.setBlock(X, Y, Z, stateOf('hopper', { facing: 'east' }));
    dim.setBlock(X + 1, Y, Z, S('barrel'));
    portAt(server, dim, X, Y + 1, Z, 0)!.insert(stackOf('iron_ingot', 5));
    tick(server, 200);
    const sum = (x: number, y: number): number => [...portAt(server, dim, x, y, Z, 0)!.contents().values()].reduce((a, b) => a + b, 0);
    expect(sum(X + 1, Y)).toBe(5);
    // A lever next to it holds it
    dim.setBlock(X - 1, Y, Z, stateOf('lever', { face: 'floor', facing: 'north', powered: 'true' }));
    tick(server, 4);
    portAt(server, dim, X, Y + 1, Z, 0)!.insert(stackOf('iron_ingot', 3));
    tick(server, 200);
    expect(sum(X + 1, Y)).toBe(5);
    expect(sum(X, Y + 1)).toBe(3);
  }, 120000);

  it('a pump fills a tank through pipes from a water pool, which refills', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-fluid');
    // A 2x2 water pool in a stone basin, pump on its east side
    for (let x = X - 2; x <= X - 1; x++)
      for (let z = Z; z <= Z + 1; z++) {
        dim.setBlock(x, Y - 2, z, S('stone'));
        dim.setBlock(x, Y - 1, z, S('water'));
      }
    for (let x = X - 3; x <= X; x++) for (const z of [Z - 1, Z + 2]) dim.setBlock(x, Y - 1, z, S('stone'));
    dim.setBlock(X - 3, Y - 1, Z, S('stone'));
    dim.setBlock(X - 3, Y - 1, Z + 1, S('stone'));
    dim.setBlock(X, Y - 1, Z, S('pump'));
    dim.setBlock(X, Y - 1, Z + 1, S('stone'));
    dim.setBlock(X + 1, Y - 1, Z, S('fluid_pipe'));
    dim.setBlock(X + 2, Y - 1, Z, S('fluid_tank'));
    dim.setBlock(X, Y, Z, S('battery'));
    be(dim, X, Y, Z).energy = 20000;
    tick(server, 400);
    const tank = be(dim, X + 2, Y - 1, Z);
    expect(tank.fluid?.id).toBe('water');
    expect(tank.fluid!.amount).toBeGreaterThanOrEqual(5000);
    // The tank shows how full it is
    expect(getProp(dim.getState(X + 2, Y - 1, Z), 'fluid')).toBe('water');
    expect(Number(getProp(dim.getState(X + 2, Y - 1, Z), 'level'))).toBeGreaterThan(0);
  }, 120000);

  it('an industrial furnace forms from casing, says what is missing, and smelts in parallel', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-multi');
    const y0 = Y + 1;
    // Controller facing south at (X, y0, Z); the body is behind it (north)
    dim.setBlock(X, y0, Z, stateOf('industrial_furnace', { facing: 'south' }));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = 0; dz <= 2; dz++) {
          if (dx === 0 && dy === 0 && dz <= 1) continue;
          if (dx === 1 && dy === 1 && dz === 2) continue; // leave one out
          dim.setBlock(X + dx, y0 + dy, Z - dz, S('machine_casing'));
        }
    // Its energy comes from a battery next to it
    dim.setBlock(X - 2, y0, Z, S('battery_bank'));
    dim.setBlock(X - 1, y0, Z, S('machine_casing'));
    dim.setBlock(X - 2, y0, Z + 1, S('insulated_cable'));
    dim.setBlock(X - 1, y0, Z + 1, S('insulated_cable'));
    dim.setBlock(X, y0, Z + 1, S('insulated_cable'));
    be(dim, X - 2, y0, Z).energy = 200000;
    tick(server, 60);
    const ctl = be(dim, X, y0, Z);
    expect(ctl.formed).toBe(false);
    expect(ctl.status?.startsWith('incomplete')).toBe(true);
    expect(ctl.missing).toContain(`${X + 1}, ${y0 + 1}, ${Z - 2}`);
    dim.setBlock(X + 1, y0 + 1, Z - 2, S('industrial_glass'));
    tick(server, 60);
    expect(be(dim, X, y0, Z).formed).toBe(true);
    const port = portAt(server, dim, X, y0, Z, 1)!;
    expect(port.insert(stackOf('iron_dust', 32))).toBe(32);
    tick(server, 600);
    expect(be(dim, X, y0, Z).items!.filter((s) => s?.id === 'iron_ingot').reduce((a, s) => a + s!.count, 0)).toBe(32);
  }, 120000);

  it('a mining drill digs below it with the pickaxe it is given, into its own inventory', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-drill');
    // A column of stone below the drill
    for (let y = Y - 4; y <= Y - 1; y++) for (let x = X - 1; x <= X + 1; x++) for (let z = Z - 1; z <= Z + 1; z++) dim.setBlock(x, y, z, S('stone'));
    dim.setBlock(X, Y, Z, stateOf('mining_drill', { facing: 'south' }));
    dim.setBlock(X + 1, Y, Z, S('battery_bank'));
    be(dim, X + 1, Y, Z).energy = 200000;
    // No tool, no work
    tick(server, 40);
    expect(be(dim, X, Y, Z).status?.startsWith('no_tool')).toBe(true);
    const port = portAt(server, dim, X, Y, Z, 1)!;
    expect(port.insert(stackOf('iron_pickaxe', 1))).toBe(1);
    tick(server, 40 * 12);
    const cobble = be(dim, X, Y, Z).items!.filter((s) => s?.id === 'cobblestone').reduce((a, s) => a + s!.count, 0);
    expect(cobble).toBeGreaterThanOrEqual(9);
    expect(dim.getState(X, Y - 1, Z)).toBe(0);
    // ...and the stone it dug is gone, not duplicated
    let left = 0;
    for (let x = X - 1; x <= X + 1; x++) for (let z = Z - 1; z <= Z + 1; z++) for (let y = Y - 4; y <= Y - 1; y++) if (dim.getState(x, y, z) === S('stone')) left++;
    expect(left + cobble).toBe(36);
  }, 120000);

  it('monitors show the network and a control panel switches machines', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-control');
    dim.setBlock(X, Y, Z, S('battery_bank'));
    be(dim, X, Y, Z).energy = 100000;
    for (let i = 1; i <= 6; i++) dim.setBlock(X + i, Y, Z, S('insulated_cable'));
    for (let i = 1; i <= 3; i++) dim.setBlock(X + i * 2, Y, Z + 1, stateOf('electric_furnace', { facing: 'south' }));
    dim.setBlock(X + 1, Y, Z - 1, stateOf('monitor', { facing: 'south' }));
    dim.setBlock(X + 3, Y, Z - 1, stateOf('control_panel', { facing: 'south' }));
    tick(server, 60);
    const mon = be(dim, X + 1, Y, Z - 1);
    expect((mon.lines as string[] | undefined)?.[0]).toMatch(/^POWER/);
    expect(mon.status).toBe('working');
    // Turn everything off from the panel
    const eng = server.engineering!;
    const panel = eng.node(dim, X + 3, Y, Z - 1)!;
    eng.control.panelCommand(null as never, panel, 'all_off');
    expect(be(dim, X + 2, Y, Z + 1).cfg?.enabled).toBe(false);
    portAt(server, dim, X + 2, Y, Z + 1, 1)!.insert(stackOf('iron_dust', 2));
    tick(server, 200);
    expect(be(dim, X + 2, Y, Z + 1).items!.some((s) => s?.id === 'iron_ingot')).toBe(false);
    eng.control.panelCommand(null as never, panel, `toggle:${X + 2},${Y},${Z + 1}`);
    tick(server, 300);
    expect(be(dim, X + 2, Y, Z + 1).items!.some((s) => s?.id === 'iron_ingot')).toBe(true);
  }, 120000);

  it('runs 260 working machines without slowing the server down', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-perf', 40);
    // 13 rows of 20, each its own network: an energy cell feeding a line of furnaces through cable
    let n = 0;
    for (let row = 0; row < 13; row++) {
      const y = Y + row * 2;
      dim.setBlock(X - 1, y, Z, S('energy_cell'));
      be(dim, X - 1, y, Z).energy = 2_000_000;
      for (let i = 0; i < 20; i++) {
        dim.setBlock(X + i, y, Z, S('insulated_cable'));
        dim.setBlock(X + i, y, Z + 1, stateOf('electric_furnace', { facing: 'south' }));
        portAt(server, dim, X + i, y, Z + 1, 1)!.insert(stackOf('iron_dust', 64));
        n++;
      }
    }
    expect(n).toBe(260);
    tick(server, 40);
    const t0 = performance.now();
    tick(server, 200);
    const ms = (performance.now() - t0) / 200;
    // Generous for slow CI machines; a tick has 50 ms
    expect(ms).toBeLessThan(25);
    let working = 0;
    for (let row = 0; row < 13; row++) for (let i = 0; i < 20; i++) if (be(dim, X + i, Y + row * 2, Z + 1).status === 'working') working++;
    expect(working).toBe(260);
  }, 180000);

  it('items on a conveyor ride it and drop off into a hopper', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-belt2');
    for (let x = X; x <= X + 3; x++) dim.setBlock(x, Y, Z, stateOf('conveyor', { facing: 'east' }));
    dim.setBlock(X + 4, Y, Z, stateOf('hopper', { facing: 'down' }));
    dim.setBlock(X + 4, Y - 1, Z, S('chest'));
    const e = new ItemEntity(stackOf('apple', 3));
    e.setPos(X + 0.5, Y + 0.3, Z + 0.5);
    dim.addEntity(e);
    tick(server, 200);
    expect(e.removed).toBe(true);
    expect([...portAt(server, dim, X + 4, Y - 1, Z, 0)!.contents().values()].reduce((a, b) => a + b, 0)).toBe(3);
  }, 120000);

  it('machines push results out of the back: crusher -> conveyor -> furnace -> chest', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-chain');
    dim.setBlock(X, Y, Z, S('battery_bank'));
    be(dim, X, Y, Z).energy = 200000;
    for (let x = X; x <= X + 5; x++) dim.setBlock(x, Y, Z + 1, S('insulated_cable'));
    dim.setBlock(X + 1, Y, Z, stateOf('crusher', { facing: 'west' }));
    dim.setBlock(X + 2, Y, Z, stateOf('conveyor', { facing: 'east' }));
    dim.setBlock(X + 3, Y, Z, stateOf('conveyor', { facing: 'east' }));
    dim.setBlock(X + 4, Y, Z, stateOf('electric_furnace', { facing: 'west' }));
    dim.setBlock(X + 5, Y, Z, S('chest'));
    portAt(server, dim, X + 1, Y, Z, 1)!.insert(stackOf('raw_iron', 2));
    tick(server, 1200);
    const chest = portAt(server, dim, X + 5, Y, Z, 4)!.contents();
    expect([...chest.entries()].map(([k, c]) => `${items[k]!.id}:${c}`)).toEqual(['iron_ingot:4']);
    // Nothing is left anywhere along the line
    expect(be(dim, X + 1, Y, Z).items!.every((s) => !s)).toBe(true);
    expect(be(dim, X + 4, Y, Z).items!.every((s) => !s)).toBe(true);
    // The furnace was fed by automation
    expect(be(dim, X + 4, Y, Z).auto).toBe(1);
  }, 120000);
});
