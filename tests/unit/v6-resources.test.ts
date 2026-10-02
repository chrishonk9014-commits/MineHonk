/**
 * V6 phase 2: the Expanded End's resources, spawning, saves and Admin Panel.
 *
 * - Phase 1 terrain is unchanged: generator 6 regenerates the recorded
 *   hashes, and generator 7 keeps every land shape (only surfaces, ores and
 *   plants differ).
 * - Ores are deterministic, only in their biomes inside the band, need the
 *   right pickaxe, and Ender Ore is never open to the air.
 * - Every recipe works; smithing keeps enchantments; the tier tables hold
 *   Ender Alloy; Ender Alloy comes back out of the void; the Void Pack keeps
 *   its contents on a death in the void, and only then.
 * - Natural spawning keeps to the Expanded End's biomes, its caps hold with
 *   three players together, and End Phantoms are rare.
 * - Mobs and items survive a save; a phase 1 save loads.
 * - The Admin Panel's tools work and award nothing; the advancements come in play.
 */
import { describe, it, expect } from 'vitest';
import { initItems, itemById, items } from '../../src/common/registry/items';
import { blockById, blockOf, S } from '../../src/common/registry/blocks';
import { seedFromString } from '../../src/common/math/rng';
import { Random } from '../../src/common/math/rng';
import { createGenerator } from '../../src/common/gen/generator';
import type { EndGenerator } from '../../src/common/gen/end';
import { arrivalLayout } from '../../src/common/gen/endExpansion';
import { EXPANSION_BIOMES, PHASE1_BIOME_IDS, surfaceOf } from '../../src/common/endExpansion/biomes';
import { inExpansion } from '../../src/common/endExpansion/region';
import { EXPANSION_MOBS, EXPANSION_MOB_CAPS, EXPANSION_SPAWNS } from '../../src/common/endExpansion/mobs';
import { ANCIENT_TOOLTIP, END_STONE_VARIANTS, endStoneForms, expansionGiveSets } from '../../src/common/endExpansion/resources';
import { biomeOf } from '../../src/common/registry/biomes';
import { canHarvest } from '../../src/common/game/mining';
import { computeBlockDrops } from '../../src/common/game/drops';
import { CRAFTING, RECIPE_TAGS } from '../../src/common/data/recipes';
import { TIERS, ARMOR_MATERIALS } from '../../src/common/data/items';
import { matchCrafting, smeltingFor, smithingResult, stonecutterOptions } from '../../src/common/game/crafting';
import { recipeBook } from '../../src/common/game/recipeBook';
import { stackOf, isAdminStack, type ItemStack } from '../../src/common/game/itemstack';
import { validateAdmin } from '../../src/common/game/admin';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import { Mob } from '../../src/server/entity/Mob';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { hashChunks } from './v3-regression.test';

initItems();

/** Recorded with generator 6 (phase 1) for seed 'v6-regression': 3x3 chunks around each point. */
const PHASE1_HASHES: Record<string, string> = {
  arrival: '46cdb8c8',
  b0: '62b64787@48,6867',
  b1: '3901e346@-364,6887',
  b2: 'b91dd89d@231,7727',
  b3: '7262ffe9@263,8567',
  b4: '9dba8afc@1409,8023',
  b5: '46cdb8c8@0,7200',
  b6: 'c8a4487d@-781,7981',
};

function endGen(version: number, seed = 'v6-regression'): EndGenerator {
  return createGenerator('end', seedFromString(seed), { version }) as EndGenerator;
}

function around(g: EndGenerator, x: number, z: number, r = 1): ReturnType<EndGenerator['generate']>[] {
  const out = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.push(g.generate((x >> 4) + dx, (z >> 4) + dz));
  return out;
}

const NEW_BLOCKS = new Set([
  ...END_STONE_VARIANTS.flatMap((v) => endStoneForms(v.id)),
  'end_crystal_cluster',
  'void_crystal_ore',
  'chorus_stalk',
  'ender_ore',
  'ancient_end_fragment',
  'astral_ore',
]);

describe('phase 1 terrain', () => {
  it('generator 6 still makes exactly the phase 1 Expanded End', () => {
    const g = endGen(6);
    const ex = g.terrain.expansion;
    const a = ex.arrival();
    expect(hashChunks(around(g, a.x, a.z))).toBe(PHASE1_HASHES.arrival);
    for (let i = 0; i < 7; i++) {
      const s = ex.findBiome(i, a.x, a.z)!;
      expect(`${hashChunks(around(g, s.x, s.z))}@${s.x},${s.z}`).toBe(PHASE1_HASHES['b' + i]);
    }
  }, 120000);

  it('generator 7 keeps every land shape: only surfaces, ores and plants differ', () => {
    const g6 = endGen(6).terrain.expansion;
    const g7 = endGen(7).terrain.expansion;
    const a = g7.arrival();
    expect(g6.arrival()).toEqual(a);
    const o6: number[] = [];
    const o7: number[] = [];
    const r = new Random(5);
    for (let i = 0; i < 4000; i++) {
      const x = Math.round(a.x + (r.next() - 0.5) * 6000);
      const z = Math.round(a.z + (r.next() - 0.5) * 6000);
      if (!inExpansion(x, z)) continue;
      expect(g7.biomeAt(x, z)).toBe(g6.biomeAt(x, z));
      const n6 = g6.spans(x, z, o6);
      const n7 = g7.spans(x, z, o7);
      expect(n7).toBe(n6);
      expect(o7.slice(0, n7 * 2)).toEqual(o6.slice(0, n6 * 2));
    }
  });

  it('renames the phase 1 biomes by slot (same numbers, so saved chunks keep their biomes)', () => {
    expect(EXPANSION_BIOMES.map((b) => b.name)).toEqual(['End Barrens', 'Shattered End', 'Astral End', 'End Highlands', 'End Crystal Fields', 'Chorus Forest', 'Void Wastes']);
    expect(Object.values(PHASE1_BIOME_IDS)).toEqual(EXPANSION_BIOMES.map((b) => b.id));
    // Generator 6 lays the phase 1 surfaces, generator 7 the new ones
    expect(surfaceOf(EXPANSION_BIOMES[0]!, 6).palette.top).toBe('pale_end_stone');
    expect(surfaceOf(EXPANSION_BIOMES[0]!, 7).palette.top).toBe('cracked_end_stone');
    expect(surfaceOf(EXPANSION_BIOMES[6]!, 6).ores).toEqual([]);
  });
});

describe('ores', () => {
  const g = endGen(7, 'v6-ores');
  const ex = g.terrain.expansion;
  const a = ex.arrival();
  /** Ore biome by block. */
  const ORE_BIOME: Record<string, string> = { void_crystal_ore: 'void_wastes', ender_ore: 'highlands', ancient_end_fragment: 'shattered_end', astral_ore: 'astral_end' };

  it('generate deterministically, only in their own biome, and Ender Ore is never open to the air', () => {
    const found: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const s = ex.findBiome(i, a.x, a.z)!;
      const chunks = around(g, s.x, s.z, 3);
      const again = around(endGen(7, 'v6-ores'), s.x, s.z, 3);
      expect(hashChunks(again)).toBe(hashChunks(chunks));
      for (const c of chunks)
        for (let y = 1; y < 250; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const id = blockOf(c.get(x, y, z)).id;
              const want = ORE_BIOME[id];
              if (!want) continue;
              found[id] = (found[id] ?? 0) + 1;
              const wx = (c.cx << 4) + x;
              const wz = (c.cz << 4) + z;
              expect(inExpansion(wx, wz)).toBe(true);
              expect(EXPANSION_BIOMES[ex.regionAt(wx, wz).biome]!.id).toBe(want);
              if (id === 'ender_ore')
                for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
                  const nx = x + dx;
                  const nz = z + dz;
                  if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
                  expect(c.get(nx, y + dy, nz)).not.toBe(0);
                }
            }
    }
    for (const id of Object.keys(ORE_BIOME)) expect(found[id] ?? 0).toBeGreaterThan(0);
  }, 240000);

  it('never generate (nor anything else new) outside the band: the main island and outer islands are untouched', () => {
    const chunks = [...around(g, 0, 0, 2), ...around(g, 1200, 300, 1), ...around(g, -2600, 1800, 1)];
    for (const c of chunks) for (let y = 1; y < 250; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(NEW_BLOCKS.has(blockOf(c.get(x, y, z)).id)).toBe(false);
  }, 120000);

  it('need the right pickaxe, and drop with Fortune and Silk Touch', () => {
    const tool = (id: string, ench?: Record<string, number>): ItemStack => ({ id: itemById.get(id)!.num, count: 1, ...(ench ? { tag: { ench } } : {}) });
    const harvest = (block: string, t: ItemStack | null): boolean => canHarvest(S(block), t);
    for (const v of END_STONE_VARIANTS) {
      expect(harvest(`${v.id}_end_stone`, tool('wooden_pickaxe'))).toBe(true);
      expect(harvest(`${v.id}_end_stone`, null)).toBe(false);
    }
    expect(harvest('end_crystal_cluster', tool('wooden_pickaxe'))).toBe(true);
    expect(harvest('void_crystal_ore', tool('iron_pickaxe'))).toBe(false);
    expect(harvest('void_crystal_ore', tool('diamond_pickaxe'))).toBe(true);
    expect(harvest('ancient_end_fragment', tool('iron_pickaxe'))).toBe(false);
    expect(harvest('ancient_end_fragment', tool('diamond_pickaxe'))).toBe(true);
    expect(harvest('ender_ore', tool('diamond_pickaxe'))).toBe(false);
    expect(harvest('ender_ore', tool('netherite_pickaxe'))).toBe(true);
    expect(harvest('astral_ore', tool('netherite_pickaxe'))).toBe(false);
    expect(harvest('astral_ore', tool('glitched_pickaxe'))).toBe(false);
    expect(harvest('astral_ore', tool('ender_alloy_pickaxe'))).toBe(true);
    // Ender Ore resists explosions like Ancient Debris
    expect(blockById.get('ender_ore')!.def.resistance).toBe(blockById.get('ancient_debris')!.def.resistance);
    const rng = new Random(3);
    const count = (block: string, t: ItemStack, item: string, n = 200): number[] => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push(computeBlockDrops(S(block), t, rng).items.filter((s) => items[s.id]!.id === item).reduce((k, s) => k + s.count, 0));
      return out;
    };
    const plain = count('end_crystal_cluster', tool('iron_pickaxe'), 'end_crystal_fragment');
    expect(Math.min(...plain)).toBe(2);
    expect(Math.max(...plain)).toBe(4);
    expect(Math.max(...count('end_crystal_cluster', tool('iron_pickaxe', { fortune: 3 }), 'end_crystal_fragment'))).toBeGreaterThan(4);
    expect(count('end_crystal_cluster', tool('iron_pickaxe', { silk_touch: 1 }), 'end_crystal_cluster', 5)).toEqual([1, 1, 1, 1, 1]);
    const shards = count('void_crystal_ore', tool('diamond_pickaxe'), 'void_shard');
    expect(Math.min(...shards)).toBe(1);
    expect(Math.max(...shards)).toBe(3);
    const dust = count('astral_ore', tool('ender_alloy_pickaxe'), 'astral_dust');
    expect(Math.min(...dust)).toBe(1);
    expect(Math.max(...dust)).toBe(2);
    expect(count('ender_ore', tool('netherite_pickaxe'), 'ender_ore', 5)).toEqual([1, 1, 1, 1, 1]);
    // One chorus plant in ten also gives a Chorus Fiber
    const fiber = count('chorus_plant', tool('iron_axe'), 'chorus_fiber', 2000).filter((n) => n > 0).length;
    expect(fiber).toBeGreaterThan(120);
    expect(fiber).toBeLessThan(290);
  });
});

describe('items and recipes', () => {
  /** A crafting grid for a recipe, each ingredient its first option. */
  function grid(r: (typeof CRAFTING)[number]): ItemStack[] {
    const opt = (ing: string): ItemStack => {
      if (!ing.startsWith('#')) return { id: itemById.get(ing)!.num, count: 1 };
      const tag = ing.slice(1);
      const id = RECIPE_TAGS[tag]?.[0] ?? items.find((it) => it.tags.has(tag))!.id;
      return { id: itemById.get(id)!.num, count: 1 };
    };
    const g: ItemStack[] = new Array(9).fill(null);
    if (r.type === 'shaped') r.pattern.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g[y * 3 + x] = opt(r.key[ch]!))));
    else r.ingredients.forEach((ing, i) => (g[i] = opt(ing)));
    return g;
  }

  it('every recipe for the new resources crafts what it says', () => {
    const ids = new Set(expansionGiveSets().flatMap((g) => g.items.map(([id]) => id)).concat(['end_crystal']));
    const list = CRAFTING.filter((r) => ids.has(r.result));
    expect(list.length).toBeGreaterThan(60);
    for (const r of list) {
      const m = matchCrafting(grid(r), 3, 3);
      expect(m && items[m.result]!.id, JSON.stringify(r)).toBe(r.result);
    }
    // The original End Crystal recipe is still there beside the new one
    expect(CRAFTING.filter((r) => r.result === 'end_crystal').length).toBe(2);
  });

  it('smelts, cuts and smiths (keeping enchantments)', () => {
    const num = (id: string): number => itemById.get(id)!.num;
    expect(items[smeltingFor(num('ender_ore'))!.resultNum]!.id).toBe('ender_scrap');
    expect(items[smeltingFor(num('raw_endling'))!.resultNum]!.id).toBe('cooked_endling');
    for (const v of END_STONE_VARIANTS) {
      const [natural, polished, bricks] = endStoneForms(v.id);
      const opts = stonecutterOptions(num(natural)).map((o) => items[o.result]!.id);
      for (const id of [polished, bricks, `${natural}_stairs`, `${natural}_slab`, `${natural}_wall`, `${bricks}_wall`]) expect(opts).toContain(id);
    }
    for (const piece of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots']) {
      const base: ItemStack = { id: num(`netherite_${piece}`), count: 1, damage: 5, tag: { ench: { unbreaking: 3 }, name: 'Mine' } };
      const r = smithingResult(base, stackOf('ender_alloy_ingot', 1));
      expect(items[r!]!.id).toBe(`ender_alloy_${piece}`);
    }
  });

  it('shows every new recipe in the Recipe Book (crafting, furnace, stonecutter, smithing, anvil)', () => {
    const book = recipeBook();
    const has = (id: string, station: string): boolean => book.some((e) => e.result.id === itemById.get(id)!.num && e.station === station);
    for (const id of ['crystal_lamp', 'crystal_glass', 'void_glass', 'chorus_planks', 'chorus_cloth', 'chorus_rope', 'ender_alloy_ingot', 'ancient_end_bricks', 'astral_shard', 'astral_lantern', 'astral_glass', 'void_leather', 'void_pack', 'polished_astral_end_stone']) expect(has(id, 'crafting'), id).toBe(true);
    expect(book.filter((e) => e.result.id === itemById.get('end_crystal')!.num && e.station === 'crafting').length).toBe(2);
    for (const id of ['ender_scrap', 'cooked_endling']) expect(has(id, 'furnace'), id).toBe(true);
    for (const id of ['dark_end_stone_bricks', 'cracked_end_stone_wall', 'ancient_end_bricks_stairs']) expect(has(id, 'stonecutter'), id).toBe(true);
    for (const piece of ['sword', 'pickaxe', 'helmet', 'boots']) expect(has(`ender_alloy_${piece}`, 'smithing'), piece).toBe(true);
    // Elytra: repaired with either membrane at the anvil
    expect(book.some((e) => e.station === 'anvil' && e.requirements.some((r) => r.options.includes(itemById.get('end_phantom_membrane')!.num)))).toBe(true);
  });

  it('puts Ender Alloy in the tier tables', () => {
    const t = TIERS.find((x) => x.id === 'ender_alloy')!;
    expect(t).toMatchObject({ level: 4, speed: 10, durability: 2500, enchantability: 18, bonus: 5, repair: 'ender_alloy_ingot', fireResistant: true, rarity: 'epic' });
    const a = ARMOR_MATERIALS.find((x) => x.id === 'ender_alloy')!;
    expect(a).toMatchObject({ mult: 42, def: [3, 8, 6, 3], toughness: 4, kb: 0.15, repair: 'ender_alloy_ingot', fireResistant: true, rarity: 'epic' });
    const pick = itemById.get('ender_alloy_pickaxe')!.def;
    expect(pick.tool).toMatchObject({ type: 'pickaxe', tier: 4, speed: 10, material: 'ender_alloy' });
    expect(pick).toMatchObject({ durability: 2500, enchantability: 18, fireResistant: true, rarity: 'epic', repair: 'ender_alloy_ingot' });
    const chest = itemById.get('ender_alloy_chestplate')!.def;
    expect(chest.armor).toMatchObject({ slot: 'chest', defense: 8, toughness: 4, knockbackRes: 0.15 });
    expect(chest.durability).toBe(16 * 42);
  });

  it('keeps the tooltips short, and repairs Elytra with an End Phantom Membrane', async () => {
    expect(itemById.get('ancient_end_fragment')!.def.tooltip).toBe(ANCIENT_TOOLTIP);
    expect(ANCIENT_TOOLTIP).toBe('Worked stone. Older than the cities.');
    const { server } = await makeServer({ seed: 'v6-anvil' });
    const elytra: ItemStack = { id: itemById.get('elytra')!.num, count: 1, damage: 300 };
    const r = server.workstations!.anvilResult(elytra, stackOf('end_phantom_membrane', 1), '');
    expect(r.stack && (r.stack.damage ?? 0)).toBeLessThan(300);
    expect(server.workstations!.anvilResult(elytra, stackOf('phantom_membrane', 1), '').stack).toBeTruthy();
  });
});

async function settle(server: GameServer, rounds = 40, cond?: () => boolean): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    if (cond?.()) return true;
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return cond ? cond() : true;
}

/** Players standing on the Expanded End's arrival platform. */
async function atArrival(server: GameServer, players: ServerPlayer[]): Promise<{ x: number; y: number; z: number }> {
  const gen = server.dim('end').generator as EndGenerator;
  const a = gen.terrain.expansion.arrival();
  const L = arrivalLayout(a);
  for (const p of players) server.changeDimension(p, 'end', L.stand.x + 0.5, L.stand.y, L.stand.z + 0.5);
  const end = server.dim('end');
  await settle(server, 400, () => [-32, 0, 32].every((dx) => [-32, 0, 32].every((dz) => end.isLoaded(a.x + dx, a.z + dz))));
  for (const p of players) {
    server.teleport(p, L.stand.x + 0.5, L.stand.y, L.stand.z + 0.5);
    p.spawnProtection = 0;
  }
  return L.stand;
}

describe('Ender Alloy and the Void Pack', () => {
  it('Ender Alloy dropped into the void comes back to safe ground; other items are lost', async () => {
    const { server } = await makeServer({ seed: 'v6-void' });
    const { player } = await join(server);
    const at = await atArrival(server, [player]);
    const end = server.dim('end');
    const drop = (id: string): ItemEntity => {
      const e = new ItemEntity(stackOf(id, 1));
      e.setPos(at.x + 0.5, -70, at.z + 0.5);
      end.addEntity(e);
      return e;
    };
    const alloy = drop('ender_alloy_ingot');
    const sword = drop('ender_alloy_sword');
    const plain = drop('diamond');
    tick(server, 3);
    expect(plain.removed).toBe(true);
    for (const e of [alloy, sword]) {
      expect(e.removed).toBe(false);
      expect(e.y).toBeGreaterThan(20);
      expect(server.endMobs!.safeSpot(end, Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), 0.5)).toBe(true);
    }
  }, 120000);

  it('keeps its contents on a death in the void, and only then', async () => {
    const { server } = await makeServer({ seed: 'v6-pack' });
    const { player } = await join(server);
    await atArrival(server, [player]);
    const packed = (): ItemStack => ({ ...stackOf('void_pack', 1), tag: { data: { items: [{ id: 'diamond', count: 5 }, null, { id: 'ender_pearl', count: 3 }] } } });
    player.inventory.set(3, packed());
    player.inventory.set(4, stackOf('iron_ingot', 10));
    server.interaction.survival.damage(player, 1000, { source: 'void', attacker: null });
    expect(player.dead).toBe(true);
    const kept = player.inventory.get(3)!;
    expect(items[kept.id]!.id).toBe('void_pack');
    expect((kept.tag!.data!.items as { id: string }[])[0]!.id).toBe('diamond');
    expect(player.inventory.get(4)).toBeNull();
    // Any other death: the pack is dropped like everything else
    (player as { dead: boolean }).dead = false;
    player.health = 20;
    player.inventory.set(3, packed());
    tick(server, 25);
    server.interaction.survival.damage(player, 1000, { source: 'mob', attacker: null });
    expect(player.dead).toBe(true);
    expect(player.inventory.get(3)).toBeNull();
  }, 120000);

  it('opens nine slots that live on the pack, and will not hold a pack', async () => {
    const { server, } = await makeServer({ seed: 'v6-pack2' });
    const { player, conn } = await join(server);
    player.selectedSlot = 0;
    player.inventory.set(0, stackOf('void_pack', 1));
    player.inventory.set(9, stackOf('diamond', 7));
    player.inventory.set(10, stackOf('void_pack', 1));
    server.interaction.hooks.useItem!(player, player.inventory.get(0)!, 0);
    const open = (conn as FakeConn).last('open_window')!;
    expect(open).toMatchObject({ kind: 'chest', title: 'Void Pack', size: 9 });
    const w = open.window;
    // Shift-click the diamonds in, try to put a pack in, and try to move the open pack
    server.handle(conn as FakeConn, { t: 'click', window: w, slot: 9, button: 0, mode: 'quick', seq: 1 });
    const pack = player.inventory.get(0)!;
    expect((pack.tag!.data!.items as { id: string; count: number }[])[0]).toMatchObject({ id: 'diamond', count: 7 });
    // Another pack never goes into the bag (shift-click moves it along the inventory instead)
    server.handle(conn as FakeConn, { t: 'click', window: w, slot: 10, button: 0, mode: 'quick', seq: 2 });
    const bag = player.inventory.get(0)!.tag!.data!.items as ({ id: string } | null)[];
    expect(bag.filter(Boolean).map((e) => e!.id)).toEqual(['diamond']);
    expect([...Array(36).keys()].filter((i) => player.inventory.get(i) && items[player.inventory.get(i)!.id]!.id === 'void_pack').length).toBe(2);
    server.handle(conn as FakeConn, { t: 'click', window: w, slot: 9 + 27, button: 0, mode: 'pickup', seq: 3 });
    expect(items[player.inventory.get(0)!.id]!.id).toBe('void_pack');
  }, 60000);
});

describe('natural spawning', () => {
  it('keeps to the Expanded End, its caps hold with three players together, and nothing new comes near the main island', async () => {
    const { server } = await makeServer({ seed: 'v6-spawn', difficulty: 'normal' });
    const ps = [(await join(server, 'A')).player, (await join(server, 'B')).player, (await join(server, 'C')).player];
    const at = await atArrival(server, ps);
    for (const p of ps) p.setGamemode('creative');
    server.level.rules.doMobSpawning = true;
    let phantoms = 0;
    const orig = server.endMobs!.onNaturalSpawn.bind(server.endMobs);
    server.endMobs!.onNaturalSpawn = (p, m) => {
      if (m.type === 'end_phantom') phantoms++;
      orig(p, m);
    };
    const end = server.dim('end');
    for (let i = 0; i < 4000; i++) {
      tick(server, 1);
      if (i % 200 !== 199) continue;
      const near = end.entitiesNear(at.x, at.y, at.z, 128, (e) => e instanceof Mob) as Mob[];
      for (const type of EXPANSION_MOBS) expect(near.filter((m) => m.type === type).length).toBeLessThanOrEqual(EXPANSION_MOB_CAPS[type]);
    }
    const mobs = [...end.entities.values()].filter((e) => e instanceof Mob && EXPANSION_MOBS.includes(e.type as never)) as Mob[];
    expect(mobs.length).toBeGreaterThan(0);
    for (const m of mobs) {
      expect(inExpansion(m.x, m.z)).toBe(true);
      const biome = biomeOf(end.getBiome(Math.floor(m.x), Math.floor(m.z))).id;
      const lists = EXPANSION_SPAWNS[biome];
      expect([...(lists?.creature ?? []), ...(lists?.monster ?? [])].some((e) => e.mob === m.type), `${m.type} in ${biome}`).toBe(true);
    }
    // Phantoms are rare: a few at most over a few minutes of play
    expect(phantoms).toBeLessThanOrEqual(1);
    // On the main island, nothing new spawns
    for (const m of mobs) m.remove();
    for (const p of ps) server.teleport(p, 0.5, 70, 30.5);
    await settle(server, 300, () => end.isLoaded(48, 48) && end.isLoaded(-48, -48));
    tick(server, 3000);
    const there = [...end.entities.values()].filter((e) => e instanceof Mob && EXPANSION_MOBS.includes(e.type as never));
    expect(there.length).toBe(0);
  }, 300000);
});

describe('saves', () => {
  it('keeps the new mobs and items through a save and reload', async () => {
    const storage = new MemoryStorage();
    const first = await makeServer({ seed: 'v6-save' }, storage);
    const { player } = await join(first.server, 'Saver', 'uuid-saver');
    const at = await atArrival(first.server, [player]);
    player.setGamemode('creative');
    const end = first.server.dim('end');
    for (const [i, type] of EXPANSION_MOBS.entries()) {
      const m = first.server.mobs!.spawn(end, type, at.x + 0.5 + i - 2, at.y + (type === 'end_phantom' ? 8 : 0), at.z - 3.5, { persistent: true })!;
      m.data.marker = type;
    }
    player.inventory.set(5, { ...stackOf('void_pack', 1), tag: { data: { items: [{ id: 'astral_dust', count: 4 }] } } });
    player.inventory.set(6, { ...stackOf('ender_alloy_sword', 1), tag: { ench: { sharpness: 5 } } });
    await first.server.stop();
    const server = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(server);
    server.level.rules.doMobSpawning = false;
    const back = (await join(server, 'Saver', 'uuid-saver')).player;
    await settle(server, 300, () => server.dim('end').isLoaded(at.x, at.z));
    expect(items[back.inventory.get(5)!.id]!.id).toBe('void_pack');
    expect((back.inventory.get(5)!.tag!.data!.items as { id: string }[])[0]!.id).toBe('astral_dust');
    expect(back.inventory.get(6)!.tag!.ench).toEqual({ sharpness: 5 });
    const restored = [...server.dim('end').entities.values()].filter((e) => e instanceof Mob) as Mob[];
    for (const type of EXPANSION_MOBS) expect(restored.some((m) => m.type === type && m.data.marker === type), type).toBe(true);
  }, 180000);

  it('loads a phase 1 save: its Expanded End generates as before, its visited biomes carry their new names', async () => {
    const storage = new MemoryStorage();
    const first = await makeServer({ seed: 'v6-phase1' }, storage);
    const { player } = await join(first.server, 'Old', 'uuid-old');
    player.visitedEndBiomes.add('pale_plains');
    await first.server.stop();
    (storage.level as { generatorVersion: number }).generatorVersion = 6;
    const server = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(server);
    expect(server.level.generatorVersion).toBe(6);
    const back = (await join(server, 'Old', 'uuid-old')).player;
    expect([...back.visitedEndBiomes]).toEqual(['end_barrens']);
    // Its Expanded End: phase 1 surfaces, no new ores or blocks
    const ex = (server.dim('end').generator as EndGenerator).terrain.expansion;
    expect(ex.version).toBe(6);
    const g = server.dim('end').generator as EndGenerator;
    const s = ex.findBiome(0, ex.arrival().x, ex.arrival().z)!;
    for (const c of around(g, s.x, s.z)) for (let y = 1; y < 200; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(NEW_BLOCKS.has(blockOf(c.get(x, y, z)).id)).toBe(false);
  }, 120000);
});

describe('V6 phase 2 Admin Panel', () => {
  it('validates the new requests', () => {
    expect(validateAdmin({ a: 'v6', op: 'give_set', set: 'ender_alloy_armor' })).toEqual({ a: 'v6', op: 'give_set', set: 'ender_alloy_armor' });
    expect(validateAdmin({ a: 'v6', op: 'give_set', set: 'nope' })).toBeNull();
    for (const op of ['kill_mobs', 'mob_spawning_on', 'mob_spawning_off']) expect(validateAdmin({ a: 'v6', op })).toEqual({ a: 'v6', op });
  });

  it('spawns, gives, removes and switches spawning, and none of it awards anything', async () => {
    const { server } = await makeServer({ seed: 'v6-admin2', cheats: true });
    const { player, conn } = await join(server, 'Op', 'uuid-op');
    await atArrival(server, [player]);
    let req = 1;
    const admin = (action: Record<string, unknown>): { ok: boolean; text: string; data?: unknown } => {
      const r = req++;
      server.handle(conn, { t: 'admin', req: r, action });
      return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? {}) as never;
    };
    for (const type of EXPANSION_MOBS) expect(admin({ a: 'spawn', mob: type, count: 2 }).ok).toBe(true);
    const end = server.dim('end');
    const spawned = [...end.entities.values()].filter((e) => e instanceof Mob && EXPANSION_MOBS.includes(e.type as never)) as Mob[];
    expect(spawned.length).toBe(10);
    for (const m of spawned) expect(m.admin).toBe(true);
    // Counts by biome in the status
    const st = admin({ a: 'v6', op: 'status' }).data as { mobs: { counts: Record<string, Record<string, number>>; spawning: boolean } };
    expect(Object.values(st.mobs.counts).reduce((n, row) => n + Object.values(row).reduce((a, b) => a + b, 0), 0)).toBe(10);
    // Killing cheat mobs never counts
    for (const m of spawned) m.hurt(1000, { source: 'player', attacker: player });
    tick(server, 2);
    for (const id of ['kill_end_phantom', 'chorus_beast', 'expansion_hunter', 'void_slip']) expect(player.achievements.has(id)).toBe(false);
    expect(player.expansionKills.size).toBe(0);
    // Every set: cheat items, none of which count when picked up, crafted or worn (after the panel's flood control refills)
    tick(server, 40);
    for (const g of expansionGiveSets()) expect(admin({ a: 'v6', op: 'give_set', set: g.id }).ok).toBe(true);
    for (let i = 0; i < player.inventory.size; i++) {
      const s = player.inventory.get(i);
      if (s) expect(isAdminStack(s)).toBe(true);
    }
    for (const [i, piece] of ['boots', 'leggings', 'chestplate', 'helmet'].entries()) player.inventory.set(36 + i, { ...stackOf(`ender_alloy_${piece}`, 1), tag: { admin: true } });
    for (const id of ['ender_scrap', 'ender_alloy_ingot', 'astral_dust']) server.interaction.onItemPickedUp(player, { ...stackOf(id, 1), tag: { admin: true } });
    tick(server, 40);
    for (const id of ['obtain_ender_scrap', 'obtain_ender_alloy', 'obtain_astral_dust', 'ender_alloy_armor']) expect(player.achievements.has(id)).toBe(false);
    // Remove, switch spawning off and on
    admin({ a: 'spawn', mob: 'void_stalker', count: 3 });
    const k = admin({ a: 'v6', op: 'kill_mobs' });
    expect(k.ok).toBe(true);
    expect([...end.entities.values()].filter((e) => e instanceof Mob && EXPANSION_MOBS.includes(e.type as never) && !e.removed).length).toBe(0);
    admin({ a: 'v6', op: 'mob_spawning_off' });
    expect(server.endMobs!.spawning).toBe(false);
    admin({ a: 'v6', op: 'mob_spawning_on' });
    expect(server.endMobs!.spawning).toBe(true);
  }, 120000);
});

describe('V6 phase 2 advancements', () => {
  it('come from play: resources picked up, crafted or worn, mobs fed and defeated', async () => {
    const { server } = await makeServer({ seed: 'v6-adv2' });
    const { player } = await join(server, 'Player', 'uuid-player');
    await atArrival(server, [player]);
    const it = server.interaction;
    it.onItemPickedUp(player, stackOf('ender_scrap', 1));
    it.onItemPickedUp(player, stackOf('ender_alloy_ingot', 1));
    it.onItemPickedUp(player, stackOf('astral_dust', 1));
    for (const id of ['obtain_ender_scrap', 'obtain_ender_alloy', 'obtain_astral_dust']) expect(player.achievements.has(id)).toBe(true);
    for (const [i, piece] of ['boots', 'leggings', 'chestplate', 'helmet'].entries()) player.inventory.set(36 + i, stackOf(`ender_alloy_${piece}`, 1));
    tick(server, 40);
    expect(player.achievements.has('ender_alloy_armor')).toBe(true);
    // Feed an Endling some chorus fruit
    const end = server.dim('end');
    const ling = server.mobs!.spawn(end, 'endling', player.x + 1.5, player.y, player.z)!;
    player.selectedSlot = 0;
    player.inventory.set(0, stackOf('chorus_fruit', 4));
    server.mobs!.interact(player, ling, 0);
    expect(player.achievements.has('feed_endling')).toBe(true);
    // Hunter: one of each kind, defeated in play
    for (const type of EXPANSION_MOBS) {
      const m = server.mobs!.spawn(end, type, player.x + 3, player.y + (type === 'end_phantom' ? 4 : 0), player.z)!;
      m.hurt(10000, { source: 'player', attacker: player });
      tick(server, 1);
    }
    expect(player.achievements.has('kill_end_phantom')).toBe(true);
    expect(player.achievements.has('chorus_beast')).toBe(true);
    expect(player.achievements.has('expansion_hunter')).toBe(true);
    // Only a stalker that slipped away and came back behind this player counts for "Back From the Edge"
    expect(player.achievements.has('void_slip')).toBe(false);
    const s = server.mobs!.spawn(end, 'void_stalker', player.x + 3, player.y, player.z)!;
    s.data.slipVictims = [player.uuid];
    s.hurt(10000, { source: 'player', attacker: player });
    expect(player.achievements.has('void_slip')).toBe(true);
  }, 120000);
});
