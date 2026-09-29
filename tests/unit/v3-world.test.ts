/** V3 world: corrupted caves, glitched portals, powder snow ice caves and powder snow physics. */
import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf, getProp, S } from '../../src/common/registry/blocks';
import { seedFromString } from '../../src/common/math/rng';
import { OverworldGenerator } from '../../src/common/gen/generator';
import { CaveBiome } from '../../src/common/gen/caves/caveBiomes';
import { newBody, stepMovement, type BlockAccess } from '../../src/common/physics/movement';
import { stackOf } from '../../src/common/game/itemstack';
import type { Chunk } from '../../src/common/world/chunk';
import type { GameServer } from '../../src/server/GameServer';
import { makeServer, join, tick } from '../helpers/testServer';

function sig(chunks: Chunk[]): string {
  let h = 0;
  for (const c of chunks) for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) h = (Math.imul(h, 31) + c.get(x, y, z)) | 0;
  return String(h);
}

async function settle(server: GameServer, rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

describe('V3 generation', () => {
  beforeAll(() => initItems());

  it('corrupted caves generate the same in any order, with a working glitched portal frame', () => {
    const seed = seedFromString('corrupt-1');
    const a = new OverworldGenerator(seed);
    const zone = a.terrain.corrupted!.nearest(0, 0, true)!;
    expect(zone).toBeTruthy();
    const cx = zone.x >> 4;
    const cz = zone.z >> 4;
    const coords: [number, number][] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) coords.push([cx + dx, cz + dz]);
    const ra = coords.map(([x, z]) => a.generate(x, z));
    const b = new OverworldGenerator(seed);
    const rb = [...coords].reverse().map(([x, z]) => b.generate(x, z)).reverse();
    expect(sig(ra)).toBe(sig(rb));

    // The biome, the corrupted blocks and the portal frame
    expect(a.caveBiomeAt(zone.x, zone.y, zone.z)).toBe(CaveBiome.Corrupted);
    const p = zone.portal!;
    const at = (i: number, j: number): string => {
      const x = p.x + (p.axis === 'x' ? i : 0);
      const z = p.z + (p.axis === 'z' ? i : 0);
      return blockOf(a.generate(x >> 4, z >> 4).get(x & 15, p.y + j, z & 15)).id;
    };
    for (let j = 0; j < 4; j++) {
      expect(at(-1, j)).toBe('glitched_portal_frame');
      expect(at(3, j)).toBe('glitched_portal_frame');
      for (let i = 0; i < 3; i++) expect(at(i, j)).toBe('cave_air');
    }
    for (let i = 0; i < 3; i++) {
      expect(at(i, -1)).toBe('glitched_portal_frame');
      expect(at(i, 4)).toBe('glitched_portal_frame');
    }
    const loc = a.locate('glitched_portal', 0, 0)!;
    expect(Math.hypot(loc.x - p.x, loc.z - p.z)).toBeLessThan(6);
  }, 60000);

  it('frozen caves trade lava for powder snow in new worlds only', () => {
    const seed = seedFromString('v2-regression');
    const v3 = new OverworldGenerator(seed);
    const v2 = new OverworldGenerator(seed, { version: 2 });
    const count = (g: OverworldGenerator, id: string): number => {
      let n = 0;
      for (let cz = 6; cz <= 8; cz++)
        for (let cx = 6; cx <= 8; cx++) {
          const c = g.generate(cx, cz);
          for (let y = 1; y < 70; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (blockOf(c.get(x, y, z)).id === id) n++;
        }
      return n;
    };
    expect(v3.caveBiomeAt(112, 36, 112)).toBe(CaveBiome.Frozen);
    expect(count(v3, 'powder_snow')).toBeGreaterThan(count(v2, 'powder_snow'));
  }, 60000);
});

/** A flat world: stone below y=60, a 3x3x6 powder snow pit at the origin. */
function pitWorld(): BlockAccess {
  const stone = S('stone');
  const powder = S('powder_snow');
  return {
    getState(x: number, y: number, z: number): number {
      if (y >= 60) return 0;
      if (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y >= 54) return powder;
      return stone;
    },
  };
}

describe('powder snow', () => {
  beforeAll(() => initItems());
  const input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0 };
  const ab = { flying: false, noClip: false, walkSpeed: 0.1, flySpeed: 0.05 };

  it('swallows a player slowly, and they can climb back out', () => {
    const w = pitWorld();
    const b = newBody(0.5, 60, 0.5);
    for (let i = 0; i < 20; i++) stepMovement(w, b, input, ab, 1.62);
    expect(b.inPowder).toBe(true);
    // Sinking, not falling: about a block a second
    expect(b.y).toBeGreaterThan(58);
    expect(b.y).toBeLessThan(60);
    for (let i = 0; i < 120; i++) stepMovement(w, b, input, ab, 1.62);
    expect(b.headInPowder).toBe(true);
    expect(b.fallDistance).toBe(0);
    // Hold jump to climb
    for (let i = 0; i < 120 && b.y < 59.9; i++) stepMovement(w, b, { ...input, jump: true }, ab, 1.62);
    expect(b.y).toBeGreaterThan(59.5);
  });

  it('holds up leather boots', () => {
    const w = pitWorld();
    const b = newBody(0.5, 60, 0.5);
    for (let i = 0; i < 40; i++) stepMovement(w, b, input, { ...ab, powderWalk: true }, 1.62);
    expect(b.y).toBeCloseTo(60, 3);
    expect(b.onGround).toBe(true);
    expect(b.inPowder).toBe(false);
    // Sneaking lets you sink in on purpose
    for (let i = 0; i < 40; i++) stepMovement(w, b, { ...input, sneak: true }, { ...ab, powderWalk: true }, 1.62);
    expect(b.y).toBeLessThan(59.5);
  });

  it('freezes and smothers a buried player, and leather keeps the cold out', async () => {
    const { server } = await makeServer({ mode: 'survival' });
    const { player } = await join(server);
    await settle(server, 30);
    const dim = player.dim;
    const x = Math.floor(player.x);
    const z = Math.floor(player.z);
    const y = 200;
    for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) dim.setBlock(x + dx, y + dy, z + dz, dy === -1 ? S('stone') : S('powder_snow'));
    server.teleport(player, x + 0.5, y, z + 0.5);
    player.abilities.survivalStats = true;
    const air0 = player.air;
    tick(server, 60);
    expect(player.freezeTicks).toBe(140);
    expect(player.air).toBeLessThan(air0);
    expect(player.statsPacket().freeze).toBe(1);
    // Out in the open it thaws
    for (let dy = 0; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) dim.setBlock(x + dx, y + dy, z + dz, 0);
    tick(server, 80);
    expect(player.freezeTicks).toBe(0);
    // Full leather: no freezing even when in it (the head stays above)
    for (const [slot, id] of [
      [36, 'leather_boots'],
      [37, 'leather_leggings'],
      [38, 'leather_chestplate'],
      [39, 'leather_helmet'],
    ] as const)
      player.inventory.set(slot, stackOf(id, 1));
    dim.setBlock(x, y, z, S('powder_snow'));
    tick(server, 40);
    expect(player.body.inPowder).toBe(true);
    expect(player.freezeTicks).toBe(0);
  }, 30000);
});

describe('glitched portal', () => {
  beforeAll(() => initItems());

  it('wakes with a Corrupted Eye, keeps the Eye and opens the Farlands', async () => {
    const { server } = await makeServer({ seed: 'corrupt-1', mode: 'survival', cheats: false });
    const { conn, player } = await join(server);
    const gen = server.overworld.generator as OverworldGenerator;
    const zone = gen.terrain.corrupted!.nearest(0, 0, true)!;
    const p = zone.portal!;
    const stand = gen.locate('glitched_portal', 0, 0)!;
    server.teleport(player, stand.x + 0.5, stand.y, stand.z + 0.5);
    await settle(server, 120);
    const bottom = { x: p.x + (p.axis === 'x' ? 1 : 0), y: p.y - 1, z: p.z + (p.axis === 'z' ? 1 : 0) };
    expect(player.dim.blockId(bottom.x, bottom.y, bottom.z)).toBe('glitched_portal_frame');
    player.inventory.set(player.selectedSlot, stackOf('corrupted_eye', 1));
    conn.received.length = 0;
    server.handle(conn, { t: 'use_on', x: bottom.x, y: bottom.y, z: bottom.z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.2, seq: 1 });
    expect(player.dim.blockId(bottom.x, p.y + 1, bottom.z)).toBe('far_portal');
    const top = player.dim.getState(bottom.x, p.y + 4, bottom.z);
    expect(getProp(top, 'part')).toBe('eye');
    expect(player.inventory.get(player.selectedSlot)).toBeFalsy();
    expect(server.endings!.state.farlandsAccess).toBe(true);
    expect(player.achievements.has('find_far_portal')).toBe(true);
    expect(conn.received.some((m) => m.t === 'fx' && m.kind === 'portal_on')).toBe(true);
  }, 60000);
});
