/** Redstone power: levers, buttons, plates, dust, torches, lamps and doors. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, stateOf, getProp } from '../../src/common/registry/blocks';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { GameServer } from '../../src/server/GameServer';
import type { FakeConn } from '../helpers/testServer';

async function setup(): Promise<{ server: GameServer; player: ServerPlayer; conn: FakeConn; x: number; y: number; z: number }> {
  const { server } = await makeServer();
  const { player, conn } = await join(server);
  const x = Math.floor(player.x) + 3;
  const z = Math.floor(player.z) + 3;
  const y = Math.floor(player.y) + 10;
  for (let dx = -6; dx <= 6; dx++)
    for (let dz = -6; dz <= 6; dz++) {
      player.dim.setBlock(x + dx, y - 1, z + dz, S('stone'));
      for (let h = 0; h < 4; h++) player.dim.setBlock(x + dx, y + h, z + dz, 0);
    }
  player.setPos(x - 2 + 0.5, y, z + 0.5);
  player.dim.updateBucket(player);
  return { server, player, conn, x, y, z };
}

const use = (server: GameServer, conn: FakeConn, x: number, y: number, z: number): void => server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0.5, seq: Math.floor(Math.random() * 1e6) });

describe('redstone', () => {
  it('a lever next to a lamp lights it', async () => {
    const { server, player, conn, x, y, z } = await setup();
    player.dim.setBlock(x, y, z, S('redstone_lamp'));
    player.dim.setBlock(x + 1, y, z, stateOf('lever', { face: 'floor', facing: 'north' }));
    use(server, conn, x + 1, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'lit')).toBe('true');
    use(server, conn, x + 1, y, z);
    expect(getProp(player.dim.getState(x, y, z), 'lit')).toBe('false');
  });

  it('dust carries power along a line and loses one level per block', async () => {
    const { server, player, conn, x, y, z } = await setup();
    const dim = player.dim;
    dim.setBlock(x, y, z, stateOf('lever', { face: 'floor', facing: 'north' }));
    for (let i = 1; i <= 5; i++) dim.setBlock(x, y, z + i, S('redstone_wire'));
    dim.setBlock(x, y, z + 6, S('redstone_lamp'));
    use(server, conn, x, y, z);
    expect(getProp(dim.getState(x, y, z + 1), 'power')).toBe('15');
    expect(getProp(dim.getState(x, y, z + 5), 'power')).toBe('11');
    expect(getProp(dim.getState(x, y, z + 6), 'lit')).toBe('true');
    use(server, conn, x, y, z);
    expect(getProp(dim.getState(x, y, z + 3), 'power')).toBe('0');
    expect(getProp(dim.getState(x, y, z + 6), 'lit')).toBe('false');
  });

  it('a button opens an iron door, which closes again when the button pops out', async () => {
    const { server, player, conn, x, y, z } = await setup();
    const dim = player.dim;
    dim.setBlock(x, y, z, stateOf('iron_door', { half: 'lower', facing: 'north' }));
    dim.setBlock(x, y + 1, z, stateOf('iron_door', { half: 'upper', facing: 'north' }));
    dim.setBlock(x + 1, y, z, S('stone'));
    dim.setBlock(x + 1, y + 1, z, stateOf('stone_button', { face: 'wall', facing: 'east' }));
    use(server, conn, x + 1, y + 1, z);
    expect(getProp(dim.getState(x, y, z), 'open')).toBe('true');
    expect(getProp(dim.getState(x, y + 1, z), 'open')).toBe('true');
    tick(server, 25);
    expect(getProp(dim.getState(x, y, z), 'open')).toBe('false');
  });

  it('a redstone torch turns off when the block it hangs on is powered', async () => {
    const { server, player, conn, x, y, z } = await setup();
    const dim = player.dim;
    dim.setBlock(x, y, z, S('stone'));
    dim.setBlock(x, y + 1, z, S('redstone_torch'));
    dim.setBlock(x + 1, y, z, stateOf('lever', { face: 'wall', facing: 'east' }));
    expect(getProp(dim.getState(x, y + 1, z), 'lit')).toBe('true');
    use(server, conn, x + 1, y, z);
    tick(server, 4);
    expect(getProp(dim.getState(x, y + 1, z), 'lit')).toBe('false');
  });

  it('pressure plates power while something stands on them', async () => {
    const { server, player, x, y, z } = await setup();
    const dim = player.dim;
    dim.setBlock(x, y, z, S('stone_pressure_plate'));
    dim.setBlock(x + 1, y, z, S('redstone_lamp'));
    const cow = server.mobs!.spawn(dim, 'cow', x + 0.5, y, z + 0.5)!;
    cow.noAi = true;
    tick(server, 4);
    expect(getProp(dim.getState(x, y, z), 'powered')).toBe('true');
    expect(getProp(dim.getState(x + 1, y, z), 'lit')).toBe('true');
    cow.setPos(x + 4.5, y, z + 4.5);
    dim.updateBucket(cow);
    tick(server, 30);
    expect(getProp(dim.getState(x, y, z), 'powered')).toBe('false');
    expect(getProp(dim.getState(x + 1, y, z), 'lit')).toBe('false');
  });
});
