import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { NetherGenerator, NETHER_ROOF } from '../../src/common/gen/nether';
import { blockOf, S, getProp } from '../../src/common/registry/blocks';
import type { Chunk } from '../../src/common/world/chunk';
import { makeServer, join, tick } from '../helpers/testServer';
import { stackOf } from '../../src/common/game/itemstack';
import type { GameServer } from '../../src/server/GameServer';

function signature(c: Chunk): string {
  let h = 0;
  for (let y = 0; y < 128; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) h = (Math.imul(h, 31) + c.get(x, y, z)) | 0;
  return h + ':' + c.blockEntities.size;
}

function count(c: Chunk, id: string): number {
  let n = 0;
  for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (blockOf(c.get(x, y, z)).id === id) n++;
  return n;
}

describe('nether generation', () => {
  beforeAll(() => initItems());

  it('is sealed by bedrock, has a lava sea and decorates deterministically', () => {
    const a = new NetherGenerator(777);
    const b = new NetherGenerator(777);
    const c = a.generate(2, -3);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        expect(blockOf(c.get(x, 0, z)).id).toBe('bedrock');
        expect(blockOf(c.get(x, NETHER_ROOF, z)).id).toBe('bedrock');
        expect(c.get(x, NETHER_ROOF + 1, z)).toBe(0);
      }
    let lava = 0;
    for (let cx = -3; cx <= 3; cx++) lava += count(a.generate(cx, 0), 'lava');
    expect(lava).toBeGreaterThan(100);
    for (const [x, z] of [
      [3, -2],
      [1, -4],
      [2, -2],
      [3, -4],
    ])
      b.generate(x!, z!);
    expect(signature(b.generate(2, -3))).toBe(signature(c));
  });

  it('generates ores, glowstone and nether biomes', () => {
    const g = new NetherGenerator(4242);
    const totals = new Map<string, number>();
    for (let cx = -2; cx <= 2; cx++)
      for (let cz = -2; cz <= 2; cz++) {
        const c = g.generate(cx, cz);
        for (const id of ['nether_quartz_ore', 'nether_gold_ore', 'glowstone', 'netherrack']) totals.set(id, (totals.get(id) ?? 0) + count(c, id));
      }
    expect(totals.get('nether_quartz_ore')!).toBeGreaterThan(50);
    expect(totals.get('nether_gold_ore')!).toBeGreaterThan(10);
    expect(totals.get('glowstone')!).toBeGreaterThan(10);
    expect(totals.get('netherrack')!).toBeGreaterThan(100000);
  });

  it('builds fortresses with blaze spawners and bastions with loot', () => {
    const g = new NetherGenerator(99);
    const f = g.locate('nether_fortress', 0, 0)!;
    const bs = g.locate('bastion', 0, 0)!;
    expect(f).toBeTruthy();
    expect(bs).toBeTruthy();
    const scan = (s: { x: number; z: number }, r: number): { spawners: string[]; chests: number; bricks: number } => {
      const out = { spawners: [] as string[], chests: 0, bricks: 0 };
      for (let cx = (s.x >> 4) - r; cx <= (s.x >> 4) + r; cx++)
        for (let cz = (s.z >> 4) - r; cz <= (s.z >> 4) + r; cz++) {
          const c = g.generate(cx, cz);
          for (const be of c.blockEntities.values()) {
            if (be.type === 'spawner') out.spawners.push(String(be.mob));
            if (be.type === 'chest') out.chests++;
          }
          out.bricks += count(c, 'nether_bricks') + count(c, 'polished_blackstone_bricks');
        }
      return out;
    };
    const fr = scan(f, 5);
    expect(fr.spawners).toContain('blaze');
    expect(fr.bricks).toBeGreaterThan(500);
    expect(g.structureAt(f.x, f.y + 1, f.z)).toBe('nether_fortress');
    const br = scan(bs, 2);
    expect(br.chests).toBeGreaterThanOrEqual(3);
    expect(br.bricks).toBeGreaterThan(300);
  });
});

async function settle(server: GameServer, rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

describe('nether portals', () => {
  it('lights a frame, travels to the Nether at 1:8 and links back', async () => {
    const { server } = await makeServer({ mode: 'survival' });
    const { conn, player } = await join(server);
    const dim = player.dim;
    // Build a 4x5 obsidian frame on a platform next to the player
    const bx = Math.floor(player.x) + 2;
    const by = Math.floor(player.y) + 1;
    const bz = Math.floor(player.z);
    for (let i = -2; i <= 3; i++) for (let d = -2; d <= 2; d++) {
      dim.setBlock(bx + i, by - 2, bz + d, S('stone'));
      for (let h = -1; h < 5; h++) dim.setBlock(bx + i, by + h, bz + d, 0);
    }
    for (let i = -1; i <= 2; i++)
      for (let j = -1; j <= 3; j++) if (i === -1 || i === 2 || j === -1 || j === 3) dim.setBlock(bx + i, by + j, bz, S('obsidian'));
    // An incomplete frame does not light
    expect(server.portals!.light(dim, bx, by + 3, bz)).toBe(false);
    // Flint and steel on the bottom frame
    player.inventory.set(player.selectedSlot, stackOf('flint_and_steel', 1));
    server.teleport(player, bx + 0.5, by - 1, bz + 2.5);
    server.handle(conn, { t: 'use_on', x: bx, y: by - 1, z: bz, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1, seq: 1 });
    expect(blockOf(dim.getState(bx, by, bz)).id).toBe('nether_portal');
    expect(blockOf(dim.getState(bx + 1, by + 2, bz)).id).toBe('nether_portal');
    expect(getProp(dim.getState(bx, by, bz), 'axis')).toBe('x');
    expect(server.level.portals.length).toBe(1);

    // Stand inside: nothing happens before the delay, then travel
    server.teleport(player, bx + 1, by, bz + 0.5);
    player.portalCooldown = 0;
    tick(server, 40);
    expect(player.dim.id).toBe('overworld');
    tick(server, 45);
    expect(player.dim.id).toBe('nether');
    await settle(server, 60);
    // Arrival portal built near x/8, z/8
    const nx = Math.floor(player.x);
    const nz = Math.floor(player.z);
    expect(Math.abs(nx - Math.floor((bx + 1) / 8))).toBeLessThanOrEqual(18);
    expect(Math.abs(nz - Math.floor(bz / 8))).toBeLessThanOrEqual(18);
    expect(blockOf(player.dim.getState(nx, Math.floor(player.y), nz)).id).toBe('nether_portal');
    expect(server.level.portals.filter((r) => r.dim === 'nether').length).toBe(1);
    expect(player.achievements.has('enter_nether')).toBe(true);

    // Step out, step back in: returns to the original portal
    server.teleport(player, nx + 0.5, player.y, nz + 3.5);
    tick(server, 110);
    server.teleport(player, nx + 0.5, player.y, nz + 0.5);
    const inX = player.dim.getState(nx, Math.floor(player.y), nz);
    expect(blockOf(inX).id).toBe('nether_portal');
    tick(server, 85);
    await settle(server, 60);
    expect(player.dim.id).toBe('overworld');
    expect(Math.abs(player.x - (bx + 1))).toBeLessThan(2);
    expect(Math.abs(player.z - (bz + 0.5))).toBeLessThan(2);
  });

  it('collapses when the frame is broken', async () => {
    const { server } = await makeServer({ mode: 'survival' });
    const { player } = await join(server);
    const dim = player.dim;
    const x = Math.floor(player.x) + 3;
    const y = Math.floor(player.y) + 1;
    const z = Math.floor(player.z) + 3;
    const f = server.portals!.build(dim, x, y, z, 'z', 'nether');
    expect(f.width).toBe(2);
    expect(blockOf(dim.getState(x, y + 1, z + 1)).id).toBe('nether_portal');
    dim.setBlock(x, y - 1, z, 0);
    tick(server, 10);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) expect(dim.getState(x, y + j, z + i)).toBe(0);
  });
});
