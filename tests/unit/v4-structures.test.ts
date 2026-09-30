/** V4 structures: every biome's structures generate, never overlap, and their puzzles and the bunker work. */
import { describe, it, expect } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { blockOf, getProp, withProp, stateOf } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { seedFromString } from '../../src/common/math/rng';
import { OverworldGenerator } from '../../src/common/gen/generator';
import type { Start, QuestSpec } from '../../src/common/gen/structures/manager';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { makeServer, join, tick } from '../helpers/testServer';

initItems();

const V4_TYPES = ['desert_oasis', 'sun_monument', 'buried_tomb', 'ranger_tower', 'hunter_camp', 'frozen_ruins', 'jungle_shrine', 'swamp_shack', 'stone_circle', 'lighthouse', 'mountain_lookout', 'prospector_camp', 'bunker'];

async function settle(server: GameServer, rounds = 80): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** A player legitimately standing at a structure, its chunks loaded. */
async function visit(type: string): Promise<{ server: GameServer; player: ServerPlayer; s: Start }> {
  const { server } = await makeServer({ seed: 'v4-quests' });
  const { player } = await join(server);
  const g = server.overworld.generator as OverworldGenerator;
  const loc = g.locate(type, 0, 0)!;
  expect(loc, type).toBeTruthy();
  const s = g.structures.startsFor(loc.x >> 4, loc.z >> 4).find((t) => t.type === type)!;
  server.teleport(player, s.x + 0.5, 200, s.z + 0.5);
  await settle(server, 120);
  return { server, player, s };
}

describe('V4 structures', () => {
  it('each generates with its landmark blocks', () => {
    const gen = new OverworldGenerator(seedFromString('v4-quests'));
    const expect1: Record<string, string> = { sun_monument: 'lever', jungle_shrine: 'campfire', bunker: 'keycard_reader', lighthouse: 'sea_lantern', buried_tomb: 'ancient_urn', desert_oasis: 'jungle_log', stone_circle: 'chiseled_stone_bricks', swamp_shack: 'brewing_stand', frozen_ruins: 'blue_ice', hunter_camp: 'campfire', ranger_tower: 'ladder', mountain_lookout: 'ladder', prospector_camp: 'ladder' };
    for (const type of V4_TYPES) {
      const loc = gen.locate(type, 0, 0);
      expect(loc, type).toBeTruthy();
      const s = gen.structures.startsFor(loc!.x >> 4, loc!.z >> 4).find((t) => t.type === type)!;
      const b = s.bounds;
      let found = 0;
      let chests = 0;
      for (let cx = b.x0 >> 4; cx <= b.x1 >> 4; cx++)
        for (let cz = b.z0 >> 4; cz <= b.z1 >> 4; cz++) {
          const c = gen.generate(cx, cz);
          for (let y = Math.max(0, b.y0); y <= Math.min(255, b.y1); y++)
            for (let z = 0; z < 16; z++)
              for (let x = 0; x < 16; x++) {
                const id = blockOf(c.get(x, y, z)).id;
                if (id === expect1[type]) found++;
                if (id === 'chest') chests++;
              }
        }
      expect(found, type).toBeGreaterThan(0);
      expect(chests, type).toBeGreaterThan(0);
    }
  }, 240000);

  it('never overlap each other, and temples turn up more often than in V3', () => {
    const seed = seedFromString('v4-spacing');
    const v4 = new OverworldGenerator(seed);
    const v3 = new OverworldGenerator(seed, { version: 3 });
    const starts: Start[] = [];
    const seen = new Set<string>();
    for (let cx = -60; cx <= 60; cx += 3)
      for (let cz = -60; cz <= 60; cz += 3)
        for (const s of v4.structures.startsFor(cx, cz)) {
          const k = s.type + s.x + ',' + s.z;
          if (!seen.has(k)) {
            seen.add(k);
            starts.push(s);
          }
        }
    const surface = starts.filter((s) => s.bounds.y1 > 60 && s.type !== 'mineshaft' && s.type !== 'stronghold');
    for (let i = 0; i < surface.length; i++)
      for (let j = i + 1; j < surface.length; j++) {
        const a = surface[i]!.bounds;
        const b = surface[j]!.bounds;
        const hit = a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0 && a.y0 <= b.y1 && a.y1 >= b.y0;
        expect(hit, `${surface[i]!.type} and ${surface[j]!.type}`).toBe(false);
      }
    // Starts per chunk over the same area of the world
    const count = (g: OverworldGenerator, type: string): number => {
      const t = g.structures.types.find((q) => q.id === type)!;
      const R = Math.ceil(1200 / t.spacing);
      let n = 0;
      for (let rx = -R; rx < R; rx++) for (let rz = -R; rz < R; rz++) if ((g.structures as unknown as { startAt(t: unknown, rx: number, rz: number): Start | null }).startAt(t, rx, rz)) n++;
      return n / (2 * R * t.spacing) ** 2;
    };
    const types = ['desert_temple', 'jungle_temple', 'witch_hut', 'igloo', 'pillager_outpost'];
    const sum = (g: OverworldGenerator): number => types.reduce((a, t) => a + count(g, t), 0);
    expect(sum(v4)).toBeGreaterThan(sum(v3));
  }, 240000);

  it('the sun monument opens when every lever matches its glyph', async () => {
    const { server, player, s } = await visit('sun_monument');
    const q = s.quest as Extract<QuestSpec, { kind: 'levers' }>;
    const dim = player.dim;
    const door = q.door[0]!;
    expect(dim.blockId(...door)).toBe('sandstone');
    // A wrong combination first
    for (const l of q.levers) dim.setBlock(...l.at, withProp(dim.getState(...l.at), 'powered', l.on ? 'false' : 'true'));
    tick(server, 2);
    expect(dim.blockId(...door)).toBe('sandstone');
    for (const l of q.levers) dim.setBlock(...l.at, withProp(dim.getState(...l.at), 'powered', l.on ? 'true' : 'false'));
    tick(server, 2);
    expect(dim.blockId(...door)).toBe('air');
    expect(player.achievements.has('solve_puzzle')).toBe(true);
  }, 120000);

  it('the jungle shrine opens when all four braziers burn', async () => {
    const { server, player, s } = await visit('jungle_shrine');
    const q = s.quest as Extract<QuestSpec, { kind: 'braziers' }>;
    const dim = player.dim;
    expect(dim.blockId(...q.door[0]!)).toBe('chiseled_stone_bricks');
    q.braziers.forEach((b, i) => {
      if (i < 3) dim.setBlock(...b, stateOf('campfire', { lit: 'true' }));
    });
    tick(server, 2);
    expect(dim.blockId(...q.door[0]!)).toBe('chiseled_stone_bricks');
    dim.setBlock(...q.braziers[3]!, stateOf('campfire', { lit: 'true' }));
    tick(server, 2);
    expect(dim.blockId(...q.door[0]!)).toBe('air');
  }, 120000);

  it('the bunker: keycard, security doors, both generators, the blast door and the vault', async () => {
    const { server, player, s } = await visit('bunker');
    const q = s.quest as Extract<QuestSpec, { kind: 'bunker' }>;
    const dim = player.dim;
    const use = (p: [number, number, number]): void => {
      server.structureQuests!.useBlock(player, ...p, dim.getState(...p));
    };
    // The keycard waits in the barracks footlocker
    expect(dim.blockId(...q.reader)).toBe('keycard_reader');
    server.teleport(player, q.reader[0] + 0.5, q.reader[1] - 1, q.reader[2] - 1.5);
    tick(server, 25);
    expect(player.achievements.has('find_bunker')).toBe(true);
    // Generators refuse before security is down, the reader refuses without a card
    use(q.generators[0]!);
    expect(getProp(dim.getState(...q.generators[0]!), 'lit')).toBe('false');
    use(q.reader);
    expect(getProp(dim.getState(...q.doors[0]!), 'open')).toBe('false');
    player.inventory.set(player.selectedSlot, stackOf('bunker_keycard', 1));
    use(q.reader);
    expect(getProp(dim.getState(...q.doors[0]!), 'open')).toBe('true');
    use(q.generators[0]!);
    expect(dim.blockId(...q.blast[0]!)).toBe('bunker_blast_door');
    use(q.generators[1]!);
    for (const b of q.blast) expect(dim.blockId(...b)).toBe('air');
    // Into the vault
    server.teleport(player, q.vault[0] + 0.5, q.vault[1], q.vault[2] - 1.5);
    tick(server, 25);
    const rec = server.level.quests.bunker[`bunker:${s.x},${s.y},${s.z}`]!;
    expect(rec.done).toBe(true);
    expect(player.achievements.has('bunker_quest')).toBe(true);
  }, 120000);

  it('villages are planned settlements: a plaza, roads, homes, civic buildings and villagers', () => {
    const gen = new OverworldGenerator(seedFromString('beta'));
    const loc = gen.locate('village', 0, 0)!;
    const v = gen.structures.startsFor(loc.x >> 4, loc.z >> 4).find((t) => t.type === 'village')!;
    expect(v.pieces.length).toBeGreaterThan(15);
    const counts = new Map<string, number>();
    const b = v.bounds;
    for (let cx = b.x0 >> 4; cx <= b.x1 >> 4; cx++)
      for (let cz = b.z0 >> 4; cz <= b.z1 >> 4; cz++) {
        const c = gen.generate(cx, cz);
        for (let y = 50; y < 130; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const id = blockOf(c.get(x, y, z)).id;
              counts.set(id, (counts.get(id) ?? 0) + 1);
            }
      }
    const n = (id: string): number => counts.get(id) ?? 0;
    expect(n('bell')).toBeGreaterThan(0);
    expect(n('dirt_path')).toBeGreaterThan(80);
    expect([...counts.keys()].filter((k) => k.endsWith('_bed')).reduce((a, k) => a + n(k), 0)).toBeGreaterThanOrEqual(6);
    expect(n('lantern')).toBeGreaterThan(4);
    expect(n('chest')).toBeGreaterThanOrEqual(3);
    const villagers = v.entities!.filter((e) => e.type === 'villager');
    expect(villagers.length).toBeGreaterThanOrEqual(4);
    expect(new Set(villagers.map((e) => e.data?.profession)).size).toBeGreaterThan(2);
  }, 120000);
});
