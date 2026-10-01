/** V4 fluids: mixing rules, flow across unloaded chunk borders, pending flow saved with the world. */
import { describe, it, expect } from 'vitest';
import { S, stateOf, blockOf, getProp, STATE_FLUID } from '../../src/common/registry/blocks';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { chunkIndex } from '../../src/common/world/constants';
import { makeServer, join, tick } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { Dimension } from '../../src/server/world/Dimension';

/** A walled stone floor high in the air, cleared above. */
function pad(dim: Dimension, x0: number, y0: number, z0: number, r = 6): void {
  for (let x = -r; x <= r; x++)
    for (let z = -r; z <= r; z++) {
      dim.setBlock(x0 + x, y0 - 1, z0 + z, S('stone'));
      for (let y = 0; y < 5; y++) dim.setBlock(x0 + x, y0 + y, z0 + z, Math.abs(x) === r || Math.abs(z) === r ? (y === 0 ? S('stone') : 0) : 0);
    }
}

async function world(opts: Parameters<typeof makeServer>[0] = {}, storage = new MemoryStorage()): Promise<{ server: GameServer; dim: Dimension; x: number; y: number; z: number }> {
  const { server } = await makeServer(opts, storage);
  const { player } = await join(server);
  const dim = player.dim;
  const x = Math.floor(player.x) + 2;
  const z = Math.floor(player.z) + 2;
  const y = Math.min(200, Math.floor(player.y) + 30);
  return { server, dim, x, y, z };
}

describe('V4 fluids', () => {
  it('water reaching lava: a lava source becomes obsidian, flowing lava cobblestone', async () => {
    const { server, dim, x, y, z } = await world();
    pad(dim, x, y, z);
    // A lava source with water poured beside it
    dim.setBlock(x, y, z, S('lava'));
    dim.setBlock(x + 1, y, z, S('water'));
    // Flowing lava (level 2) with water beside it
    dim.setBlock(x - 3, y, z + 3, stateOf('lava', { level: '2' }));
    dim.setBlock(x - 3, y, z + 4, S('stone'));
    dim.setBlock(x - 3, y, z + 2, S('water'));
    tick(server, 80);
    expect(dim.blockId(x, y, z)).toBe('obsidian');
    expect(dim.blockId(x - 3, y, z + 3)).toBe('cobblestone');
  });

  it('water pouring onto flowing lava makes cobblestone, lava pouring into water makes stone', async () => {
    const { server, dim, x, y, z } = await world();
    pad(dim, x, y, z);
    // Water held above flowing lava
    dim.setBlock(x, y, z, stateOf('lava', { level: '3' }));
    dim.setBlock(x, y + 1, z, S('water'));
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      dim.setBlock(x + dx, y, z + dz, S('stone'));
      dim.setBlock(x + dx, y + 1, z + dz, S('stone'));
    }
    // Lava falling into a water pool
    dim.setBlock(x + 3, y, z + 3, S('water'));
    dim.setBlock(x + 3, y + 2, z + 3, S('lava'));
    tick(server, 100);
    expect(dim.blockId(x, y, z)).toBe('cobblestone');
    expect(dim.blockId(x + 3, y, z + 3)).toBe('stone');
  });

  it('worlds made before V4 keep their old mixing rules', async () => {
    const { server, dim, x, y, z } = await world({ seed: 'old-rules' });
    server.level.generatorVersion = 3;
    pad(dim, x, y, z);
    dim.setBlock(x, y, z, stateOf('lava', { level: '3' }));
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      dim.setBlock(x + dx, y, z + dz, S('stone'));
      dim.setBlock(x + dx, y + 1, z + dz, S('stone'));
    }
    dim.setBlock(x, y + 1, z, S('water'));
    tick(server, 100);
    expect(dim.blockId(x, y, z)).toBe('stone');
  });

  it('fluids settle: a lake with lava beside it stops updating', async () => {
    const { server, dim, x, y, z } = await world();
    pad(dim, x, y, z, 7);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) dim.setBlock(x + dx, y, z + dz, S('water'));
    dim.setBlock(x + 4, y, z, S('lava'));
    dim.setBlock(x - 4, y + 2, z, S('lava'));
    tick(server, 600);
    // Nothing on the pad is still updating (natural waterfalls elsewhere in the world may be)
    const sched = (server.blockUpdates as unknown as { scheduled: Map<Dimension, Map<string, { x: number; y: number; z: number }>> }).scheduled.get(dim);
    const pending = [...(sched?.values() ?? [])].filter((t) => Math.abs(t.x - x) <= 7 && Math.abs(t.z - z) <= 7 && t.y >= y - 1 && t.y <= y + 4).length;
    expect(pending).toBe(0);
    // Nowhere do lava and water sit side by side
    for (let dx = -6; dx <= 6; dx++)
      for (let dz = -6; dz <= 6; dz++)
        for (let dy = 0; dy < 4; dy++) {
          const s = dim.getState(x + dx, y + dy, z + dz);
          if (STATE_FLUID[s] !== 2) continue;
          for (const [ax, ay, az] of [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
          ] as const)
            expect(STATE_FLUID[dim.getState(x + dx + ax, y + dy + ay, z + dz + az)]).not.toBe(1);
        }
  });

  it('flow waiting at an unloaded chunk carries on into it once it loads', async () => {
    const { server, dim } = await world({ seed: 'edge-flow' });
    // A loaded chunk whose east neighbour is not loaded
    let edge: { cx: number; cz: number } | null = null;
    for (const c of dim.chunks.values()) if (!dim.getChunk(c.cx + 1, c.cz) && dim.getChunk(c.cx - 1, c.cz)) edge = { cx: c.cx, cz: c.cz };
    expect(edge).toBeTruthy();
    const x = (edge!.cx << 4) + 15;
    const z = (edge!.cz << 4) + 8;
    const y = 220;
    // A stone shelf crossing the border, and a water source on the loaded side
    for (let dx = -3; dx <= 0; dx++) for (let dz = -1; dz <= 1; dz++) dim.setBlock(x + dx, y - 1, z + dz, S('stone'));
    dim.setBlock(x - 1, y, z, S('water'));
    tick(server, 40);
    expect(blockOf(dim.getState(x, y, z)).id).toBe('water');
    // Load the neighbour and let the flow resume into it
    dim.want(edge!.cx + 1, edge!.cz, 0, server.tickNo);
    for (let i = 0; i < 10 && !dim.getChunk(edge!.cx + 1, edge!.cz); i++) {
      await new Promise((r) => setTimeout(r, 0));
      dim.want(edge!.cx + 1, edge!.cz, 0, server.tickNo);
      tick(server, 1);
    }
    const n = dim.getChunk(edge!.cx + 1, edge!.cz)!;
    expect(n).toBeTruthy();
    for (let i = 0; i < 12; i++) {
      dim.want(edge!.cx + 1, edge!.cz, 0, server.tickNo);
      tick(server, 5);
    }
    expect(blockOf(dim.getState(x + 1, y, z)).id).toBe('water');
    expect(Number(getProp(dim.getState(x + 1, y, z), 'level'))).toBeGreaterThan(0);
  });

  it('water still spreading when the world is saved carries on after it is loaded again', async () => {
    const storage = new MemoryStorage();
    const first = await world({ seed: 'saved-flow' }, storage);
    pad(first.dim, first.x, first.y, first.z);
    first.dim.setBlock(first.x, first.y, first.z, S('water'));
    tick(first.server, 6);
    // Only the first ring has flowed so far
    expect(blockOf(first.dim.getState(first.x + 3, first.y, first.z)).id).not.toBe('water');
    await first.server.saveAll();
    const again = await world({ seed: 'saved-flow' }, storage);
    expect(again.x).toBe(first.x);
    tick(again.server, 120);
    expect(blockOf(again.dim.getState(first.x + 3, first.y, first.z)).id).toBe('water');
    expect(blockOf(again.dim.getState(first.x, first.y, first.z + 4)).id).toBe('water');
    void chunkIndex;
  });
});
