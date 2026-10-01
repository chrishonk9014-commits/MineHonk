import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { FarlandsGenerator } from '../../src/common/gen/farlands';
import { blockOf, S } from '../../src/common/registry/blocks';
import type { Chunk } from '../../src/common/world/chunk';
import { makeServer, join, tick } from '../helpers/testServer';
import { stackOf } from '../../src/common/game/itemstack';
import type { GameServer } from '../../src/server/GameServer';

function signature(c: Chunk): string {
  let h = 0;
  for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) h = (Math.imul(h, 31) + c.get(x, y, z)) | 0;
  return h + ':' + c.blockEntities.size;
}

function count(c: Chunk, id: string): number {
  let n = 0;
  for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (blockOf(c.get(x, y, z)).id === id) n++;
  return n;
}

async function settle(server: GameServer, rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

describe('farlands generation', () => {
  beforeAll(() => initItems());

  it('decorates deterministically and holds glitch ores', () => {
    const a = new FarlandsGenerator(5150);
    const b = new FarlandsGenerator(5150);
    const sig = signature(a.generate(1, 1));
    for (const [x, z] of [
      [2, 2],
      [0, 1],
      [2, 0],
    ])
      b.generate(x!, z!);
    expect(signature(b.generate(1, 1))).toBe(sig);
    let glitch = 0;
    let nul = 0;
    for (let cx = -3; cx <= 3; cx++)
      for (let cz = -3; cz <= 3; cz++) {
        const c = a.generate(cx, cz);
        glitch += count(c, 'glitch_ore');
        nul += count(c, 'null_ore');
      }
    expect(glitch).toBeGreaterThan(10);
    expect(nul).toBeGreaterThan(0);
  });

  it('raises overflow walls far above the plains', () => {
    const g = new FarlandsGenerator(12345);
    let wx = NaN;
    let wz = NaN;
    search: for (let x = -2000; x < 2000; x += 64)
      for (let z = -2000; z < 2000; z += 64)
        if (g.terrain.wallWeight(x, z) > 0.95) {
          wx = x;
          wz = z;
          break search;
        }
    expect(Number.isFinite(wx)).toBe(true);
    let tall = 0;
    let overflow = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = g.generate((wx >> 4) + dx, (wz >> 4) + dz);
        overflow += count(c, 'overflow_stone');
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (c.getHeight(x, z) > 130) tall++;
      }
    expect(tall).toBeGreaterThan(100);
    expect(overflow).toBeGreaterThan(50);
  });

  it('places data spires and vaults with loot', () => {
    const g = new FarlandsGenerator(777);
    for (const [type, loot] of [
      ['data_spire', 'chest/farlands_ruin'],
      ['farlands_vault', 'chest/farlands_vault'],
    ] as const) {
      const s = g.locate(type, 0, 0)!;
      expect(s).toBeTruthy();
      const found = new Set<string>();
      for (let cx = (s.x >> 4) - 1; cx <= (s.x >> 4) + 1; cx++) for (let cz = (s.z >> 4) - 1; cz <= (s.z >> 4) + 1; cz++) for (const be of g.generate(cx, cz).blockEntities.values()) if (be.type === 'chest') found.add(String(be.loot));
      expect(found.has(loot)).toBe(true);
    }
  });
});

describe('farlands progression', () => {
  it('awakens a far portal with a corrupted eye and travels both ways', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    const dim = player.dim;
    const bx = Math.floor(player.x) + 2;
    const by = Math.floor(player.y) + 1;
    const bz = Math.floor(player.z);
    for (let i = -2; i <= 6; i++) for (let d = -2; d <= 2; d++) {
      dim.setBlock(bx + i, by - 2, bz + d, S('stone'));
      for (let h = -1; h < 7; h++) dim.setBlock(bx + i, by + h, bz + d, 0);
    }
    // Frame like the glitched ruin's: 3 wide, 5 tall interior
    const frame = S('far_portal_frame');
    for (let i = -1; i <= 3; i++) {
      dim.setBlock(bx + i, by - 1, bz, frame);
      dim.setBlock(bx + i, by + 5, bz, frame);
    }
    for (let j = 0; j < 5; j++) {
      dim.setBlock(bx - 1, by + j, bz, frame);
      dim.setBlock(bx + 3, by + j, bz, frame);
    }
    player.inventory.set(player.selectedSlot, stackOf('corrupted_eye', 1));
    server.teleport(player, bx + 1.5, by - 1, bz + 2.5);
    server.handle(conn, { t: 'use_on', x: bx + 1, y: by - 1, z: bz, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.2, seq: 1 });
    expect(blockOf(dim.getState(bx + 1, by + 2, bz)).id).toBe('far_portal');
    expect(player.inventory.get(player.selectedSlot)).toBeFalsy();
    expect(player.achievements.has('find_far_portal')).toBe(true);

    server.teleport(player, bx + 1.5, by, bz + 0.5);
    player.portalCooldown = 0;
    tick(server, 65);
    expect(player.dim.id).toBe('farlands');
    await settle(server, 80);
    expect(blockOf(player.dim.getState(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z))).id).toBe('far_portal');
    expect(player.achievements.has('enter_farlands')).toBe(true);

    // Back out: step off, step in again
    const fx = player.x;
    const fy = player.y;
    const fz = player.z;
    server.teleport(player, fx, fy, fz + 3);
    tick(server, 110);
    server.teleport(player, fx, fy, fz);
    tick(server, 65);
    await settle(server, 80);
    expect(player.dim.id).toBe('overworld');
    expect(Math.abs(player.x - (bx + 1))).toBeLessThan(3);
  });

  it('corrupts unprotected players; stability protects', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    server.changeDimension(player, 'farlands', 0.5, 120, 0.5);
    (player as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
    await settle(server, 60);
    server.farlands!.rng = { chance: () => true, next: () => 0.5 };
    player.spawnProtection = 0;
    server.interaction.survival.addEffect(player, 'stability', 0, 100000);
    tick(server, 220);
    expect(player.effects.has('nausea')).toBe(false);
    player.effects.delete('stability');
    tick(server, 220);
    expect(player.effects.has('nausea')).toBe(true);
  });

  it('points the farlands compass at a glitched portal (a glitched ruin in older worlds)', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    player.inventory.set(player.selectedSlot, stackOf('farlands_compass', 1));
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(conn.of('chat').map((m) => m.text).find((t) => t.includes('glitched portal'))).toBeTruthy();
    // Worlds made before V3 still have their portals in the surface ruins
    server.level.generatorVersion = 2;
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(conn.of('chat').map((m) => m.text).find((t) => t.includes('glitched ruin'))).toBeTruthy();
  }, 30000);
});
