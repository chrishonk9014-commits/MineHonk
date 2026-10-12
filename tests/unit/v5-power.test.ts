/** V5: power networks, generators, batteries, machines, saving, and signals that control them. */
import { describe, it, expect } from 'vitest';
import { S, stateOf, getProp } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { stackOf, type ItemStack } from '../../src/common/game/itemstack';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import { portAt } from '../../src/server/engineering/ports';
import type { EngBE } from '../../src/server/engineering/state';
import type { Dimension } from '../../src/server/world/Dimension';
import { makeServer, join, tick } from '../helpers/testServer';

/** A stone pad high in the sky next to the player (so terrain never gets in the way). */
async function pad(seed = 'eng-power'): Promise<{ server: GameServer; storage: MemoryStorage; dim: Dimension; X: number; Y: number; Z: number; player: Awaited<ReturnType<typeof join>>['player'] }> {
  const storage = new MemoryStorage();
  const { server } = await makeServer({ seed }, storage);
  const { player } = await join(server);
  const dim = player.dim;
  const X = Math.floor(player.x) + 2;
  const Y = 170;
  const Z = Math.floor(player.z);
  for (let x = X - 2; x <= X + 12; x++) for (let z = Z - 3; z <= Z + 3; z++) dim.setBlock(x, Y - 1, z, S('stone'));
  return { server, storage, dim, X, Y, Z, player };
}

const be = (dim: Dimension, x: number, y: number, z: number): EngBE => dim.getBlockEntity(x, y, z) as EngBE;
const count = (dim: Dimension, x: number, y: number, z: number, id: string): number => {
  const items_ = be(dim, x, y, z).items ?? [];
  return items_.filter((s) => s?.id === id).reduce((a, s) => a + (s?.count ?? 0), 0);
};

describe('V5 power', () => {
  it('a water wheel makes energy that flows through wire into a battery and a crusher, which crushes ore', async () => {
    const { server, dim, X, Y, Z } = await pad();
    // Water on two sides of the wheel, walled in
    dim.setBlock(X, Y, Z, stateOf('water_wheel', { facing: 'south' }));
    for (const z of [Z - 1, Z + 1]) {
      dim.setBlock(X, Y, z, S('water'));
      for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
        [0, z < Z ? -1 : 1],
      ])
        dim.setBlock(X + dx!, Y, z + dz!, S('stone'));
    }
    dim.setBlock(X + 1, Y, Z, S('copper_wire'));
    dim.setBlock(X + 2, Y, Z, S('battery'));
    dim.setBlock(X + 3, Y, Z, S('copper_wire'));
    dim.setBlock(X + 4, Y, Z, stateOf('crusher', { facing: 'south' }));
    // The wire took its shape from what it touches
    const w = dim.getState(X + 1, Y, Z);
    expect(getProp(w, 'west')).toBe('true');
    expect(getProp(w, 'east')).toBe('true');
    expect(getProp(w, 'north')).toBe('false');
    tick(server, 200);
    const wheel = be(dim, X, Y, Z);
    expect(wheel.status).toBe('working');
    expect(server.engineering!.node(dim, X, Y, Z)!.rate).toBe(4);
    const battery = be(dim, X + 2, Y, Z);
    // The crusher fills its own buffer first, then the battery takes the rest
    expect((battery.energy ?? 0) + (be(dim, X + 4, Y, Z).energy ?? 0)).toBeGreaterThan(0);
    // Crushing: two dusts per raw ore
    const port = portAt(server, dim, X + 4, Y, Z, 1)!;
    expect(port.insert(stackOf('raw_iron', 3))).toBe(3);
    expect(port.insert(stackOf('dirt', 1))).toBe(0);
    battery.energy = 20000;
    tick(server, 1000);
    expect(count(dim, X + 4, Y, Z, 'iron_dust')).toBe(6);
    expect(be(dim, X + 4, Y, Z).items![0]).toBeNull();
    expect(be(dim, X + 4, Y, Z).status?.startsWith('no_input')).toBe(true);
    // The network adds up: what the crusher used came out of the wheel and the battery
    const net = server.engineering!.energy.netAt(dim, X + 2, Y, Z)!;
    expect(net.cap).toBe(64);
    expect(net.devices.length).toBe(3);
  }, 120000);

  it('shares out by need, keeps within the weakest cable, and never makes energy out of nothing', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-cap');
    dim.setBlock(X, Y, Z, S('battery_bank'));
    dim.setBlock(X + 1, Y, Z, S('copper_wire'));
    dim.setBlock(X + 2, Y, Z, S('battery_bank'));
    be(dim, X, Y, Z).energy = 100000;
    // Both banks are batteries: batteries don't feed each other
    tick(server, 40);
    expect(be(dim, X, Y, Z).energy).toBeCloseTo(100000, 3);
    // A machine that wants power: it takes it from the bank, through 64 EU/t of wire
    dim.setBlock(X + 2, Y, Z, stateOf('compressor', { facing: 'south' }));
    tick(server, 8);
    const before = be(dim, X, Y, Z).energy! + (be(dim, X + 2, Y, Z).energy ?? 0);
    tick(server, 40);
    const comp = be(dim, X + 2, Y, Z).energy!;
    expect(comp).toBeGreaterThan(0);
    expect(comp).toBeLessThanOrEqual(64 * 60);
    const after = be(dim, X, Y, Z).energy! + comp;
    expect(after).toBeCloseTo(before, 3);
    // Swap the wire for insulated cable: the limit rises
    dim.setBlock(X + 1, Y, Z, S('insulated_cable'));
    tick(server, 8);
    expect(server.engineering!.energy.netAt(dim, X, Y, Z)!.cap).toBe(512);
  }, 120000);

  it('keeps energy, items and progress through a save, without duplicating anything', async () => {
    const { server, storage, dim, X, Y, Z } = await pad('eng-save');
    dim.setBlock(X, Y, Z, S('battery'));
    dim.setBlock(X + 1, Y, Z, stateOf('electric_furnace', { facing: 'south' }));
    be(dim, X, Y, Z).energy = 15000;
    portAt(server, dim, X + 1, Y, Z, 1)!.insert(stackOf('iron_dust', 10));
    tick(server, 300);
    const ingots = count(dim, X + 1, Y, Z, 'iron_ingot');
    const dusts = count(dim, X + 1, Y, Z, 'iron_dust');
    expect(ingots).toBeGreaterThan(0);
    expect(ingots + dusts).toBe(10);
    const energy = be(dim, X, Y, Z).energy!;
    await server.stop();
    const again = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(again);
    const { player } = await join(again);
    const d2 = player.dim;
    for (let i = 0; i < 40 && !d2.isLoaded(X, Z); i++) tick(again, 1);
    const b2 = d2.getBlockEntity(X, Y, Z) as EngBE;
    // The furnace may have run a few steps while the world loaded back in: never more energy, never much less
    expect(b2.energy).toBeLessThanOrEqual(energy);
    expect(b2.energy).toBeGreaterThan(energy - 1000);
    expect(count(d2, X + 1, Y, Z, 'iron_ingot') + count(d2, X + 1, Y, Z, 'iron_dust')).toBe(10);
    // ...and it carries on where it left off
    tick(again, 800);
    expect(count(d2, X + 1, Y, Z, 'iron_ingot')).toBe(10);
    expect(again.engineering!.node(d2, X + 1, Y, Z)).toBeTruthy();
  }, 120000);

  it('breaking a battery keeps its charge in the item; placing it back restores it', async () => {
    const { server, dim, X, Y, Z, player } = await pad('eng-drop');
    dim.setBlock(X, Y, Z, S('battery'));
    be(dim, X, Y, Z).energy = 12345;
    const drops: ItemStack[] = [stackOf('battery', 1)];
    server.engineering!.decorateDrops(dim.getBlockEntity(X, Y, Z), drops);
    expect(drops[0]!.tag?.data?.energy).toBe(12345);
    dim.setBlock(X, Y, Z, 0);
    dim.setBlock(X, Y, Z, S('battery'));
    server.engineering!.onPlaced(player, dim, X, Y, Z, drops[0]!);
    expect(be(dim, X, Y, Z).energy).toBe(12345);
  }, 60000);

  it('conveyors carry items into the machine they point into', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-belt');
    dim.setBlock(X, Y, Z, S('battery'));
    dim.setBlock(X + 1, Y, Z, stateOf('crusher', { facing: 'south' }));
    be(dim, X, Y, Z).energy = 20000;
    for (let x = X + 2; x <= X + 5; x++) dim.setBlock(x, Y, Z, stateOf('conveyor', { facing: 'west' }));
    const e = new ItemEntity(stackOf('raw_copper', 4));
    e.setPos(X + 5.5, Y + 0.3, Z + 0.5);
    dim.addEntity(e);
    tick(server, 120);
    expect(e.removed).toBe(true);
    tick(server, 600);
    expect(count(dim, X + 1, Y, Z, 'copper_dust')).toBe(8);
    expect(be(dim, X + 1, Y, Z).auto).toBe(1);
  }, 120000);

  it('signals control machines: a level sensor turns a backup generator on when the battery runs low', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-signal');
    // battery <- level sensor (reads it from behind, signals out of its front) -> steam generator
    dim.setBlock(X, Y, Z, S('battery'));
    dim.setBlock(X + 1, Y, Z, stateOf('level_sensor', { facing: 'east' }));
    dim.setBlock(X + 2, Y, Z, stateOf('steam_generator', { facing: 'south' }));
    const sensor = be(dim, X + 1, Y, Z);
    sensor.cfg = { mode: 'below', threshold: 50 };
    const gen = be(dim, X + 2, Y, Z);
    gen.cfg = { signal: 'on' };
    gen.fluid = { id: 'water', amount: 8000 };
    portAt(server, dim, X + 2, Y, Z, 2)!.insert(stackOf('coal', 4));
    be(dim, X, Y, Z).energy = 15000;
    tick(server, 20);
    expect(be(dim, X + 1, Y, Z).out).toBe(0);
    expect(be(dim, X + 2, Y, Z).status).toBe('disabled');
    be(dim, X, Y, Z).energy = 2000;
    tick(server, 20);
    expect(be(dim, X + 1, Y, Z).out).toBe(15);
    expect(server.power!.powered(dim, X + 2, Y, Z)).toBe(true);
    expect(be(dim, X + 2, Y, Z).status).toBe('working');
    // It is cabled only by touching the sensor, so give it its own battery
    dim.setBlock(X + 3, Y, Z, S('battery'));
    tick(server, 100);
    expect(be(dim, X + 3, Y, Z).energy).toBeGreaterThan(0);
  }, 120000);

  it('logic gates combine signals, and timers pulse', async () => {
    const { server, dim, X, Y, Z } = await pad('eng-logic');
    // Two levers into an AND gate facing east; a warning light at its front
    dim.setBlock(X + 1, Y, Z, stateOf('logic_gate', { facing: 'east', mode: 'and' }));
    dim.setBlock(X + 1, Y, Z - 1, stateOf('lever', { face: 'floor', facing: 'north', powered: 'false' }));
    dim.setBlock(X + 1, Y, Z + 1, stateOf('lever', { face: 'floor', facing: 'north', powered: 'false' }));
    dim.setBlock(X + 2, Y, Z, stateOf('warning_light', { lit: 'false' }));
    const lit = (): string => getProp(dim.getState(X + 2, Y, Z), 'lit')!;
    tick(server, 6);
    expect(lit()).toBe('false');
    dim.setBlock(X + 1, Y, Z - 1, stateOf('lever', { face: 'floor', facing: 'north', powered: 'true' }));
    tick(server, 6);
    expect(lit()).toBe('false');
    dim.setBlock(X + 1, Y, Z + 1, stateOf('lever', { face: 'floor', facing: 'north', powered: 'true' }));
    tick(server, 6);
    expect(lit()).toBe('true');
    // A timer pulses on its period
    dim.setBlock(X + 6, Y, Z, stateOf('timer', { facing: 'north' }));
    (dim.getBlockEntity(X + 6, Y, Z) as EngBE).cfg = { period: 20 };
    let pulses = 0;
    let was = false;
    for (let i = 0; i < 100; i++) {
      tick(server, 1);
      const on = getProp(dim.getState(X + 6, Y, Z), 'lit') === 'true';
      if (on && !was) pulses++;
      was = on;
    }
    expect(pulses).toBe(5);
  }, 120000);
});

void itemById;
void items;
