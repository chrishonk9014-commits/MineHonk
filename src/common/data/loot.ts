/**
 * Loot tables: blocks (crops), mobs, bosses and structure chests.
 * Structure tables are tuned so rare items stay rare.
 */
import type { LootTable, LootEntry } from '../game/loot';
import type { LoreSite } from '../endExpansion/lore';

const e = (item: string, weight: number, count: LootEntry['count'] = 1, extra: Partial<LootEntry> = {}): LootEntry => ({ item, weight, count, ...extra });
const none = (weight: number): LootEntry => ({ empty: true, weight });
const ench = (item: string, weight: number, levels: [number, number] = [20, 39], treasure = true): LootEntry => ({ item, weight, functions: [{ fn: 'enchant_levels', levels, treasure }] });
const book = (weight: number): LootEntry => ({ item: 'book', weight, functions: [{ fn: 'enchant_randomly', treasure: true }] });
// V6 phase 3: lore books (by a site's weights, or a fixed fragment), Ancient Maps, End Artifacts and the ancient weapons
const lore = (weight: number, site: LoreSite): LootEntry => ({ item: 'book', weight, functions: [{ fn: 'lore', site }] });
const loreOf = (id: string): LootEntry => ({ item: 'book', functions: [{ fn: 'lore', id }] });
const amap = (weight: number): LootEntry => ({ item: 'ancient_map', weight, functions: [{ fn: 'ancient_map' }] });
const worn = (item: string, weight: number): LootEntry => ({ item, weight, functions: [{ fn: 'damage', min: 0.15, max: 0.6 }] });
/** One roll that is usually nothing and sometimes an End Artifact (weights out of `of`). */
const artifacts = (of: number, w: Partial<Record<string, number>>): LootEntry[] => {
  const list = Object.entries(w).map(([id, n]) => e(id, n!));
  return [none(of - list.reduce((a, b) => a + (b.weight ?? 0), 0)), ...list];
};
const mob = (item: string, min: number, max: number, extra: Partial<LootEntry> = {}): LootEntry => ({ item, count: [min, max], functions: [{ fn: 'looting', min: 0, max: 1 }, ...(extra.functions ?? [])], ...extra });

const crop = (drop: string, seed: string, seedExtra = 3, extras: LootEntry[] = []): LootTable => ({
  pools: [
    { rolls: 1, entries: [{ item: drop, conditions: [{ c: 'max_age' }] }, { item: seed, conditions: [{ c: 'not_max_age' }] }] },
    { rolls: 1, conditions: [{ c: 'max_age' }], entries: [{ item: seed, count: 0, functions: [{ fn: 'fortune_binomial', extra: seedExtra, p: 0.5714 }] }] },
    ...(extras.length ? [{ rolls: 1, conditions: [{ c: 'max_age' as const }], entries: extras }] : []),
  ],
});

export const LOOT_TABLES: Record<string, LootTable> = {
  // --- Crops -------------------------------------------------------------
  crop_wheat: crop('wheat', 'wheat_seeds'),
  crop_carrots: { pools: [{ rolls: 1, entries: [{ item: 'carrot', count: 1, functions: [{ fn: 'fortune_binomial', extra: 3, p: 0.5714 }], conditions: [{ c: 'max_age' }] }, { item: 'carrot', conditions: [{ c: 'not_max_age' }] }] }] },
  crop_potatoes: {
    pools: [
      { rolls: 1, entries: [{ item: 'potato', count: 1, functions: [{ fn: 'fortune_binomial', extra: 3, p: 0.5714 }], conditions: [{ c: 'max_age' }] }, { item: 'potato', conditions: [{ c: 'not_max_age' }] }] },
      { rolls: 1, conditions: [{ c: 'max_age' }, { c: 'chance', chance: 0.02 }], entries: [{ item: 'poisonous_potato' }] },
    ],
  },
  crop_beetroots: crop('beetroot', 'beetroot_seeds'),
  crop_sunroot: crop('sunroot', 'sunroot_seeds', 2),
  crop_nether_wart: { pools: [{ rolls: 1, entries: [{ item: 'nether_wart', count: [2, 4], conditions: [{ c: 'max_age' }] }, { item: 'nether_wart', conditions: [{ c: 'not_max_age' }] }] }] },

  // --- Passive mobs ------------------------------------------------------------
  'mob/cow': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('leather', 0, 2)] }, { rolls: 1, entries: [mob('beef', 1, 3, { functions: [{ fn: 'smelt' }] })] }] },
  'mob/mooshroom': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('leather', 0, 2)] }, { rolls: 1, entries: [mob('beef', 1, 3, { functions: [{ fn: 'smelt' }] })] }] },
  'mob/pig': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('porkchop', 1, 3, { functions: [{ fn: 'smelt' }] })] }] },
  'mob/sheep': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('mutton', 1, 2, { functions: [{ fn: 'smelt' }] })] }] },
  'mob/chicken': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('feather', 0, 2)] }, { rolls: 1, entries: [mob('chicken', 1, 1, { functions: [{ fn: 'smelt' }] })] }] },
  'mob/rabbit': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('rabbit_hide', 0, 1)] }, { rolls: 1, entries: [mob('rabbit', 0, 1, { functions: [{ fn: 'smelt' }] })] }, { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.1, lootingBonus: 0.03 }], entries: [{ item: 'rabbit_foot' }] }] },
  'mob/horse': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('leather', 0, 2)] }] },
  'mob/goat': { xp: [1, 3], pools: [] },
  'mob/glow_squid': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('glow_ink_sac', 1, 3)] }] },
  'mob/crystal_mite': { xp: [2, 4], pools: [{ rolls: 1, entries: [mob('amethyst_shard', 0, 1)] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.15 }], entries: [{ item: 'lumen_shard' }] }] },
  'mob/sporeling': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('glowshroom', 0, 2)] }, { rolls: 1, entries: [{ item: 'red_mushroom', weight: 1 }, { item: 'brown_mushroom', weight: 1 }] }] },
  'mob/warden': { xp: [5, 5], pools: [{ rolls: 1, entries: [{ item: 'sculk_catalyst' }] }] },
  'mob/turtle': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('seagrass', 0, 2)] }] },
  'mob/parrot': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('feather', 1, 2)] }] },
  'mob/ocelot': { xp: [1, 3], pools: [] },
  'mob/panda': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('bamboo', 0, 2)] }] },
  'mob/llama': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('leather', 0, 2)] }] },
  'mob/camel': { xp: [1, 3], pools: [] },
  'mob/frog': { xp: [1, 3], pools: [] },
  'mob/axolotl': { xp: [1, 3], pools: [] },
  'mob/tropical_fish': { xp: [1, 3], pools: [{ rolls: 1, entries: [{ item: 'tropical_fish' }] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.05 }], entries: [{ item: 'bone_meal' }] }] },
  'mob/pufferfish': { xp: [1, 3], pools: [{ rolls: 1, entries: [{ item: 'pufferfish' }] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.05 }], entries: [{ item: 'bone_meal' }] }] },
  'mob/squid': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('ink_sac', 1, 3)] }] },
  'mob/cod': { xp: [1, 3], pools: [{ rolls: 1, entries: [{ item: 'cod', functions: [{ fn: 'smelt' }] }] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.05 }], entries: [{ item: 'bone_meal' }] }] },
  'mob/salmon': { xp: [1, 3], pools: [{ rolls: 1, entries: [{ item: 'salmon', functions: [{ fn: 'smelt' }] }] }] },
  'mob/fox': { xp: [1, 3], pools: [] },
  'mob/wolf': { xp: [1, 3], pools: [] },
  'mob/polar_bear': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('cod', 0, 2, { weight: 3 }), mob('salmon', 0, 2)] }] },
  'mob/bat': { xp: [0, 0], pools: [] },
  'mob/villager': { xp: [0, 0], pools: [] },
  'mob/glitched_cow': { xp: [2, 4], pools: [{ rolls: 1, entries: [mob('leather', 0, 2)] }, { rolls: 1, entries: [mob('beef', 1, 3, { functions: [{ fn: 'smelt' }] })] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.15 }], entries: [{ item: 'glitch_berry' }] }] },
  'mob/glitched_sheep': { xp: [2, 4], pools: [{ rolls: 1, entries: [mob('mutton', 1, 2, { functions: [{ fn: 'smelt' }] })] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.15 }], entries: [{ item: 'glitch_berry' }] }] },

  // --- Hostile mobs ---------------------------------------------------------------
  'mob/zombie': {
    xp: 5,
    pools: [
      { rolls: 1, entries: [mob('rotten_flesh', 0, 2)] },
      { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.025, lootingBonus: 0.01 }], entries: [e('iron_ingot', 1), e('carrot', 1), e('potato', 1)] },
    ],
  },
  'mob/husk': { xp: 5, pools: [{ rolls: 1, entries: [mob('rotten_flesh', 0, 2)] }] },
  'mob/drowned': { xp: 5, pools: [{ rolls: 1, entries: [mob('rotten_flesh', 0, 2)] }, { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.11, lootingBonus: 0.02 }], entries: [e('copper_ingot', 1)] }] },
  'mob/skeleton': { xp: 5, pools: [{ rolls: 1, entries: [mob('arrow', 0, 2)] }, { rolls: 1, entries: [mob('bone', 0, 2)] }] },
  'mob/stray': { xp: 5, pools: [{ rolls: 1, entries: [mob('arrow', 0, 2)] }, { rolls: 1, entries: [mob('bone', 0, 2)] }] },
  'mob/creeper': { xp: 5, pools: [{ rolls: 1, entries: [mob('gunpowder', 0, 2)] }] },
  'mob/spider': { xp: 5, pools: [{ rolls: 1, entries: [mob('string', 0, 2)] }, { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.33, lootingBonus: 0.1 }], entries: [e('spider_eye', 1)] }] },
  'mob/cave_spider': { xp: 5, pools: [{ rolls: 1, entries: [mob('string', 0, 2)] }] },
  'mob/enderman': { xp: 5, pools: [{ rolls: 1, entries: [mob('ender_pearl', 0, 1)] }] },
  'mob/witch': { xp: 5, pools: [{ rolls: [1, 3], entries: [e('glowstone_dust', 1, [0, 2]), e('sugar', 1, [0, 2]), e('redstone', 1, [0, 2]), e('spider_eye', 1, [0, 2]), e('glass_bottle', 1, [0, 2]), e('gunpowder', 1, [0, 2]), e('stick', 2, [0, 2])] }] },
  'mob/slime': { xp: [1, 4], pools: [{ rolls: 1, entries: [mob('slime_ball', 0, 2)] }] },
  'mob/magma_cube': { xp: [1, 4], pools: [{ rolls: 1, conditions: [{ c: 'chance', chance: 0.25 }], entries: [e('magma_cream', 1)] }] },
  'mob/blaze': { xp: 10, pools: [{ rolls: 1, conditions: [{ c: 'killed_by_player' }], entries: [mob('blaze_rod', 0, 1)] }] },
  'mob/ghast': { xp: 5, pools: [{ rolls: 1, entries: [mob('ghast_tear', 0, 1)] }, { rolls: 1, entries: [mob('gunpowder', 0, 2)] }] },
  'mob/zombified_piglin': { xp: 5, pools: [{ rolls: 1, entries: [mob('rotten_flesh', 0, 1)] }, { rolls: 1, entries: [mob('gold_nugget', 0, 1)] }, { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.025 }], entries: [e('gold_ingot', 1)] }] },
  'mob/piglin': { xp: 5, pools: [{ rolls: 1, conditions: [{ c: 'chance', chance: 0.085 }], entries: [e('golden_sword', 1, 1, { functions: [{ fn: 'damage', min: 0.1, max: 0.9 }] }), e('crossbow', 1, 1, { functions: [{ fn: 'damage', min: 0.1, max: 0.9 }] })] }] },
  'mob/hoglin': { xp: 5, pools: [{ rolls: 1, entries: [mob('porkchop', 2, 4, { functions: [{ fn: 'smelt' }] })] }, { rolls: 1, entries: [mob('leather', 0, 1)] }] },
  'mob/wither_skeleton': { xp: 5, pools: [{ rolls: 1, entries: [mob('coal', 0, 1)] }, { rolls: 1, entries: [mob('bone', 0, 2)] }] },
  'mob/shulker': { xp: 5, pools: [{ rolls: 1, conditions: [{ c: 'chance', chance: 0.5, lootingBonus: 0.0625 }], entries: [e('shulker_shell', 1)] }] },
  'mob/phantom': { xp: 5, pools: [{ rolls: 1, conditions: [{ c: 'killed_by_player' }], entries: [mob('phantom_membrane', 0, 1)] }] },
  // V6 phase 2: the Expanded End
  'mob/endling': { xp: [1, 3], pools: [{ rolls: 1, entries: [mob('raw_endling', 1, 2, { functions: [{ fn: 'smelt' }] })] }] },
  'mob/void_stalker': { xp: 8, pools: [{ rolls: 1, entries: [mob('void_shard', 0, 2)] }, { rolls: 1, entries: [{ item: 'void_stalker_hide', count: [0, 1] }] }] },
  'mob/chorus_beast': { xp: 15, pools: [{ rolls: 1, entries: [{ item: 'chorus_fiber', count: [3, 6] }] }, { rolls: 1, entries: [{ item: 'chorus_fruit', count: [2, 4] }] }] },
  'mob/end_crystal_mite': { xp: 3, pools: [{ rolls: 1, entries: [mob('end_crystal_fragment', 0, 1)] }] },
  'mob/end_phantom': { xp: 20, pools: [{ rolls: 1, entries: [mob('end_phantom_membrane', 1, 1)] }, { rolls: 1, entries: [{ item: 'astral_dust', count: [0, 1] }] }] },
  // V6 phase 3: the Guardian Constructs (built, not born: worked stone and crystal)
  'mob/guardian_sentinel': { xp: 12, pools: [{ rolls: 1, entries: [mob('ancient_fragment', 1, 2)] }, { rolls: 1, entries: [mob('end_crystal_fragment', 1, 3)] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.05 }], entries: [e('ender_scrap', 1)] }] },
  'mob/guardian_bulwark': { xp: 40, pools: [{ rolls: 1, entries: [mob('ancient_fragment', 2, 4)] }, { rolls: 1, entries: [mob('end_crystal_fragment', 2, 5)] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.15 }], entries: [e('ender_scrap', 1)] }] },
  'mob/silverfish': { xp: 5, pools: [] },
  'mob/pillager': { xp: 5, pools: [{ rolls: 1, entries: [mob('arrow', 0, 2)] }] },
  // Original mobs
  'mob/cave_stalker': { xp: 12, pools: [{ rolls: 1, entries: [mob('stalker_fang', 1, 2)] }, { rolls: 1, entries: [mob('stalker_steak', 0, 1)] }, { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.08 }], entries: [e('echo_shard', 1)] }] },
  'mob/sky_ray': { xp: 10, pools: [{ rolls: 1, entries: [mob('sky_ray_membrane', 1, 2)] }, { rolls: 1, entries: [mob('feather', 0, 3)] }] },
  'mob/ember_beast': { xp: 20, pools: [{ rolls: 1, entries: [mob('cinder', 1, 3)] }, { rolls: 1, conditions: [{ c: 'killed_by_player' }, { c: 'chance', chance: 0.2, lootingBonus: 0.05 }], entries: [e('ember_core', 1)] }, { rolls: 1, entries: [mob('ember_pepper', 0, 1)] }] },
  'mob/rift_walker': { xp: 15, pools: [{ rolls: 1, entries: [mob('rift_pearl', 0, 1)] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.3 }], entries: [e('data_fragment', 1)] }] },
  'mob/farlands_wanderer': { xp: 8, pools: [{ rolls: 1, entries: [mob('glitch_shard', 0, 1)] }, { rolls: 1, entries: [mob('rotten_flesh', 0, 2)] }] },
  'mob/glitch_zombie': { xp: 7, pools: [{ rolls: 1, entries: [mob('rotten_flesh', 0, 2)] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.1 }], entries: [e('glitch_shard', 1)] }] },
  'mob/glitch_skeleton': { xp: 7, pools: [{ rolls: 1, entries: [mob('bone', 0, 2)] }, { rolls: 1, entries: [mob('arrow', 0, 3)] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.1 }], entries: [e('glitch_shard', 1)] }] },
  'mob/void_wisp': { xp: 6, pools: [{ rolls: 1, entries: [mob('void_shard', 0, 2)] }] },
  'mob/glitch_beast': { xp: 120, pools: [{ rolls: 1, entries: [e('glitch_core', 1)] }, { rolls: 1, entries: [e('glitch_shard', 1, [4, 8])] }, { rolls: 1, entries: [e('raw_nullium', 1, [2, 4])] }, { rolls: 1, conditions: [{ c: 'chance', chance: 0.5 }], entries: [e('music_disc_overflow', 1)] }] },
  'mob/ender_dragon': { xp: 12000, pools: [{ rolls: 1, entries: [e('dragon_scale', 1, [3, 6])] }, { rolls: 1, entries: [e('dragon_breath', 1, [2, 4])] }] },
  'mob/wither': { xp: 50, pools: [{ rolls: 1, entries: [e('nether_star', 1)] }] },

  // --- Fishing (fish, junk, treasure; Luck of the Sea shifts towards treasure) ---
  'gameplay/fishing': {
    pools: [
      {
        rolls: 1,
        entries: [
          { table: 'gameplay/fishing/fish', weight: 85 },
          { table: 'gameplay/fishing/junk', weight: 10 },
          { table: 'gameplay/fishing/treasure', weight: 5 },
        ],
      },
    ],
  },
  'gameplay/fishing/fish': { pools: [{ rolls: 1, entries: [e('cod', 60), e('salmon', 25), e('tropical_fish', 2), e('pufferfish', 13)] }] },
  'gameplay/fishing/junk': {
    pools: [{ rolls: 1, entries: [e('lily_pad', 17), e('leather_boots', 10, 1, { functions: [{ fn: 'damage', min: 0, max: 0.9 }] }), e('leather', 10), e('bone', 10), e('potion', 10, 1, { functions: [{ fn: 'potion', potion: 'water' }] }), e('string', 5), e('fishing_rod', 2, 1, { functions: [{ fn: 'damage', min: 0, max: 0.9 }] }), e('bowl', 10), e('stick', 5), e('ink_sac', 10), e('rotten_flesh', 10)] }],
  },
  'gameplay/fishing/treasure': {
    pools: [{ rolls: 1, entries: [ench('bow', 1, [30, 30]), book(1), ench('fishing_rod', 1, [30, 30]), e('name_tag', 1), e('nautilus_shell', 1), e('saddle', 1), e('heart_of_the_sea', 0)] }],
  },

  // --- Structure chests -------------------------------------------------------------
  // V4: urns crack open to scatter whatever was stored in them
  'block/ancient_urn': {
    pools: [
      { rolls: 1, entries: [none(35), e('gold_nugget', 20, [2, 7]), e('emerald', 8, [1, 2]), e('bone', 12, [1, 3]), e('string', 10, [1, 3]), e('sunstone_shard', 6), e('iron_nugget', 12, [2, 8]), e('diamond', 1)] },
    ],
  },
  // V4: the Glitched Structure. Its reward is the existing Glitched gear: one tool and one
  // armor piece, picked and enchanted by the same loot functions as any other treasure.
  'quest/glitched_reward': {
    pools: [
      { rolls: 1, entries: ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'].map((t) => ench(`glitched_${t}`, t === 'hoe' ? 1 : 3, [20, 39])) },
      { rolls: 1, entries: ['helmet', 'chestplate', 'leggings', 'boots'].map((a) => ench(`glitched_${a}`, 1, [20, 39])) },
    ],
  },
  'chest/glitched_vault': {
    pools: [
      { rolls: 1, entries: [e('glitched_ingot', 1)] },
      { rolls: [3, 6], entries: [e('glitch_shard', 20, [3, 8]), e('data_fragment', 15, [2, 4]), e('nullium_ingot', 8, [1, 2]), e('experience_bottle', 12, [4, 10]), e('enchanted_golden_apple', 2), e('totem_of_undying', 2), book(8)] },
    ],
  },
  'chest/glitched_cache': {
    pools: [{ rolls: [2, 4], entries: [e('glitch_shard', 20, [1, 4]), e('data_fragment', 12, [1, 2]), e('missing_block', 10, [2, 6]), e('glitch_berry', 10, [1, 3]), e('ender_pearl', 6, [1, 2]), none(10)] }],
  },
  // V4 structures: each place has loot that fits it
  'chest/oasis': { pools: [{ rolls: [3, 6], entries: [e('cactus_fruit', 15, [2, 5]), e('bread', 10, [1, 3]), e('gold_nugget', 12, [3, 9]), e('sunstone_shard', 5, [1, 2]), e('leather', 10, [1, 3]), e('emerald', 6, [1, 2]), e('aloe_leaf', 10, [1, 3]), e('saddle', 3)] }] },
  'chest/sun_monument': {
    pools: [
      { rolls: 1, entries: [e('gold_block', 3), e('diamond', 3, [1, 3]), e('sunstone_shard', 5, [2, 5]), ench('golden_sword', 3, [20, 30])] },
      { rolls: [4, 7], entries: [e('gold_ingot', 20, [2, 6]), e('emerald', 12, [1, 4]), e('sunstone_shard', 10, [1, 3]), e('golden_apple', 6), e('enchanted_golden_apple', 1), book(8), e('bone', 12, [2, 5]), e('experience_bottle', 8, [2, 5])] },
    ],
  },
  'chest/buried_tomb': { pools: [{ rolls: [3, 6], entries: [e('gold_ingot', 12, [1, 4]), e('bone', 20, [2, 6]), e('rotten_flesh', 18, [2, 6]), e('emerald', 8, [1, 2]), e('diamond', 3), e('golden_apple', 4), e('sunstone_shard', 6, [1, 2]), book(6), e('name_tag', 4)] }] },
  'chest/ranger_tower': { pools: [{ rolls: [3, 6], entries: [e('arrow', 20, [4, 12]), e('bow', 6), e('spyglass', 4), e('compass', 4), e('bread', 14, [2, 4]), e('lingonberries', 10, [2, 6]), e('iron_ingot', 8, [1, 3]), e('leather_boots', 4), book(4)] }] },
  'chest/hunter_camp': { pools: [{ rolls: [3, 6], entries: [e('leather', 20, [2, 6]), e('rabbit_hide', 10, [1, 3]), e('cooked_mutton', 12, [1, 3]), e('cooked_beef', 10, [1, 3]), e('arrow', 12, [3, 10]), e('bow', 4), e('lingonberries', 10, [2, 5]), e('snowberries', 6, [2, 5]), e('iron_axe', 3), e('lead', 5)] }] },
  'chest/frozen_ruins': { pools: [{ rolls: [3, 6], entries: [e('snowberries', 14, [2, 6]), e('blue_ice', 6, [1, 3]), e('iron_ingot', 12, [1, 4]), e('emerald', 6, [1, 2]), e('diamond', 2), e('frosted_stone_bricks', 10, [3, 8]), ench('iron_sword', 4, [10, 25]), e('leather_chestplate', 4), book(5)] }] },
  'chest/jungle_shrine': {
    pools: [
      { rolls: 1, entries: [e('emerald', 6, [3, 6]), e('diamond', 3, [1, 2]), ench('diamond_axe', 1, [20, 30]), e('totem_of_undying', 1)] },
      { rolls: [3, 6], entries: [e('melon_seeds', 10, [2, 6]), e('jungle_orchid', 8, [1, 3]), e('gold_ingot', 12, [2, 5]), e('emerald', 8, [1, 3]), e('bamboo', 8, [3, 8]), e('golden_apple', 5), book(8), e('experience_bottle', 6, [2, 5])] },
    ],
  },
  'chest/swamp_shack': { pools: [{ rolls: [3, 6], entries: [e('glass_bottle', 12, [1, 4]), e('redstone', 10, [2, 6]), e('glowstone_dust', 8, [2, 5]), e('fermented_spider_eye', 6, [1, 2]), e('slime_ball', 8, [1, 3]), e('marsh_glowcap', 8, [1, 3]), e('peat', 10, [2, 6]), e('sugar', 8, [1, 4]), e('nether_wart', 4, [1, 3])] }] },
  'chest/stone_circle': { pools: [{ rolls: [3, 5], entries: [e('emerald', 10, [1, 3]), e('gold_ingot', 12, [1, 4]), e('amethyst_shard', 10, [2, 6]), e('diamond', 3, [1, 2]), e('experience_bottle', 8, [2, 5]), book(10), e('golden_apple', 4), e('ender_pearl', 5)] }] },
  'chest/lighthouse': { pools: [{ rolls: [3, 6], entries: [e('seashell', 12, [2, 6]), e('cod', 12, [2, 5]), e('salmon', 10, [2, 5]), e('fishing_rod', 5), e('compass', 5), e('iron_ingot', 8, [1, 3]), e('prismarine_shard', 6, [2, 5]), e('heart_of_the_sea', 1), e('spyglass', 4)] }] },
  'chest/mountain_lookout': { pools: [{ rolls: [3, 5], entries: [e('coal', 14, [3, 8]), e('iron_ingot', 12, [1, 4]), e('emerald', 6, [1, 2]), e('bread', 12, [1, 3]), e('spyglass', 4), e('edelweiss', 6, [1, 2]), e('feather', 6, [2, 5]), e('torch', 12, [4, 12]), book(4)] }] },
  'chest/prospector_camp': { pools: [{ rolls: [3, 6], entries: [e('raw_gold', 16, [2, 6]), e('gold_nugget', 14, [4, 12]), e('iron_pickaxe', 5), e('torch', 12, [6, 16]), e('bread', 10, [1, 3]), e('tnt', 4, [1, 2]), e('aloe_leaf', 8, [1, 3]), e('emerald', 5, [1, 2])] }] },
  // The bunker: the keycard is always in the barracks footlocker
  'chest/village_storehouse': { pools: [{ rolls: [3, 7], entries: [e('wheat', 20, [3, 10]), e('bread', 14, [1, 4]), e('potato', 12, [2, 6]), e('carrot', 12, [2, 6]), e('apple', 10, [1, 4]), e('coal', 10, [2, 6]), e('leather', 6, [1, 3]), e('emerald', 4, [1, 2]), e('bucket', 3)] }] },
  'chest/village_smithy': { pools: [{ rolls: [3, 6], entries: [e('iron_ingot', 16, [1, 5]), e('coal', 14, [2, 6]), e('iron_pickaxe', 5), e('iron_sword', 5), e('iron_helmet', 3), e('shield', 3), e('gold_ingot', 6, [1, 3]), e('diamond', 2), e('flint', 8, [1, 4])] }] },
  'chest/bunker_barracks': {
    pools: [
      { rolls: 1, entries: [e('bunker_keycard', 1)] },
      { rolls: [2, 4], entries: [e('bread', 12, [1, 3]), e('iron_ingot', 10, [1, 3]), e('arrow', 10, [4, 10]), e('leather_helmet', 4), e('iron_boots', 3), e('torch', 10, [3, 8]), e('redstone', 8, [2, 6])] },
    ],
  },
  'chest/bunker_vault': {
    pools: [
      { rolls: 1, entries: [e('diamond', 6, [2, 5]), ench('diamond_pickaxe', 2, [25, 39]), ench('diamond_chestplate', 2, [25, 39]), e('netherite_scrap', 1, [1, 2])] },
      { rolls: [4, 7], entries: [e('iron_ingot', 14, [3, 8]), e('gold_ingot', 10, [2, 6]), e('redstone_block', 6, [1, 3]), e('emerald', 8, [2, 5]), e('experience_bottle', 10, [4, 10]), e('golden_apple', 6, [1, 2]), e('totem_of_undying', 1), book(8), e('tnt', 4, [2, 4])] },
    ],
  },
  // Generator 5 bunkers: the keycard waits in the guard post's chest up top, not inside
  'chest/bunker_cache': {
    pools: [
      { rolls: 1, entries: [e('bunker_keycard', 1)] },
      { rolls: [2, 4], entries: [e('bread', 12, [1, 3]), e('torch', 12, [4, 10]), e('arrow', 8, [4, 10]), e('iron_ingot', 6, [1, 3]), e('compass', 3), e('cooked_beef', 8, [1, 3]), e('leather_helmet', 3)] },
    ],
  },
  'chest/bunker_locker': { pools: [{ rolls: [2, 5], entries: [e('bread', 12, [1, 3]), e('iron_ingot', 10, [1, 3]), e('arrow', 10, [4, 10]), e('leather_helmet', 4), e('iron_boots', 3), e('torch', 10, [3, 8]), e('redstone', 8, [2, 6]), e('paper', 8, [1, 4])] }] },
  'chest/bunker_storage': { pools: [{ rolls: [3, 6], entries: [e('bread', 14, [2, 5]), e('potato', 10, [2, 6]), e('coal', 12, [3, 8]), e('iron_ingot', 10, [2, 5]), e('redstone', 10, [3, 8]), e('bucket', 4), e('tnt', 3, [1, 2]), e('glass_bottle', 6, [1, 3])] }] },
  'chest/bunker_armory': {
    pools: [
      { rolls: 1, entries: [e('iron_sword', 6), e('crossbow', 5), e('shield', 5), ench('iron_chestplate', 2, [10, 25]), e('bow', 5)] },
      { rolls: [2, 4], entries: [e('arrow', 16, [6, 16]), e('iron_helmet', 5), e('iron_leggings', 4), e('iron_boots', 5), e('gunpowder', 8, [2, 5]), e('iron_ingot', 10, [2, 5])] },
    ],
  },
  'chest/bunker_lab': { pools: [{ rolls: [3, 5], entries: [e('glass_bottle', 14, [2, 5]), e('redstone', 12, [3, 8]), e('glowstone_dust', 10, [2, 6]), e('nether_wart', 6, [1, 3]), e('fermented_spider_eye', 6, [1, 2]), e('sugar', 8, [2, 5]), e('experience_bottle', 6, [2, 5]), e('ender_pearl', 3)] }] },
  // Temple trials: a supply chest by the entrance, the relic's hiding place, and each temple's prize
  'chest/temple_supplies': {
    pools: [
      { rolls: 1, entries: [e('flint_and_steel', 1)] },
      { rolls: [2, 4], entries: [e('torch', 14, [4, 12]), e('bread', 12, [1, 4]), e('arrow', 10, [4, 12]), e('cooked_beef', 8, [1, 3]), e('golden_carrot', 4, [1, 3])] },
    ],
  },
  'chest/temple_relic': {
    pools: [
      { rolls: 1, entries: [e('temple_relic', 1)] },
      { rolls: [1, 3], entries: [e('gold_nugget', 14, [3, 9]), e('emerald', 6, [1, 2]), e('bone', 10, [1, 4])] },
    ],
  },
  'chest/pyramid': {
    pools: [
      { rolls: [3, 6], entries: [e('gold_ingot', 16, [2, 6]), e('emerald', 10, [1, 4]), e('bone', 14, [2, 6]), e('sunstone_shard', 8, [1, 3]), e('golden_apple', 5), e('diamond', 3, [1, 2]), book(6), e('ancient_urn', 4)] },
    ],
  },
  'quest/temple_jungle_temple': {
    pools: [
      { rolls: 1, entries: [ench('diamond_sword', 3, [25, 39]), ench('diamond_axe', 2, [25, 39]), ench('bow', 3, [25, 39]), e('totem_of_undying', 2)] },
      { rolls: [3, 5], entries: [e('emerald', 12, [4, 10]), e('diamond', 8, [2, 4]), e('gold_block', 6, [1, 2]), e('golden_apple', 8, [1, 3]), e('enchanted_golden_apple', 1), e('experience_bottle', 10, [6, 12]), e('jungle_orchid', 6, [2, 4]), book(8)] },
    ],
  },
  'quest/temple_frost_temple': {
    pools: [
      { rolls: 1, entries: [ench('diamond_chestplate', 3, [25, 39]), ench('diamond_boots', 3, [25, 39]), ench('bow', 2, [25, 39]), e('totem_of_undying', 2)] },
      { rolls: [3, 5], entries: [e('diamond', 8, [2, 5]), e('blue_ice', 8, [4, 12]), e('emerald', 10, [3, 8]), e('golden_apple', 8, [1, 3]), e('enchanted_golden_apple', 1), e('experience_bottle', 10, [6, 12]), e('snowberries', 6, [4, 10]), book(8)] },
    ],
  },
  'quest/temple_swamp_temple': {
    pools: [
      { rolls: 1, entries: [ench('diamond_helmet', 3, [25, 39]), ench('trident', 1, [20, 35]), ench('diamond_sword', 3, [25, 39]), e('totem_of_undying', 2)] },
      { rolls: [3, 5], entries: [e('emerald', 12, [4, 10]), e('diamond', 8, [2, 4]), e('slime_ball', 8, [4, 10]), e('golden_apple', 8, [1, 3]), e('enchanted_golden_apple', 1), e('experience_bottle', 12, [6, 14]), e('marsh_glowcap', 6, [2, 6]), book(8)] },
    ],
  },
  'quest/temple_badlands_temple': {
    pools: [
      { rolls: 1, entries: [ench('diamond_pickaxe', 3, [25, 39]), ench('diamond_leggings', 3, [25, 39]), ench('crossbow', 2, [20, 35]), e('totem_of_undying', 2)] },
      { rolls: [3, 5], entries: [e('gold_block', 8, [1, 3]), e('diamond', 8, [2, 4]), e('emerald', 10, [3, 8]), e('golden_apple', 8, [1, 3]), e('enchanted_golden_apple', 1), e('experience_bottle', 10, [6, 12]), e('raw_gold', 8, [4, 10]), book(8)] },
    ],
  },
  'quest/temple_mountain_temple': {
    pools: [
      { rolls: 1, entries: [ench('diamond_pickaxe', 3, [25, 39]), ench('diamond_chestplate', 3, [25, 39]), e('netherite_scrap', 2, [1, 2]), e('totem_of_undying', 2)] },
      { rolls: [3, 5], entries: [e('diamond', 10, [2, 5]), e('iron_block', 8, [1, 3]), e('emerald', 10, [3, 8]), e('golden_apple', 8, [1, 3]), e('enchanted_golden_apple', 1), e('experience_bottle', 10, [6, 12]), e('amethyst_shard', 8, [4, 10]), book(8)] },
    ],
  },
  'quest/temple_desert_pyramid': {
    pools: [
      { rolls: 1, entries: [ench('golden_sword', 2, [30, 39]), ench('diamond_sword', 3, [30, 39]), ench('diamond_helmet', 3, [30, 39]), e('totem_of_undying', 3), e('netherite_scrap', 1, [1, 2])] },
      { rolls: [4, 6], entries: [e('gold_block', 10, [1, 4]), e('diamond', 8, [2, 5]), e('emerald', 10, [4, 10]), e('sunstone_shard', 8, [3, 6]), e('golden_apple', 8, [1, 3]), e('enchanted_golden_apple', 2), e('experience_bottle', 10, [8, 16]), book(10)] },
    ],
  },
  'chest/bonus': {
    pools: [
      { rolls: 1, entries: [e('stick', 1, [1, 12])] },
      { rolls: 1, entries: [e('oak_planks', 1, [1, 12])] },
      { rolls: 1, entries: [e('oak_log', 3, [1, 3]), e('spruce_log', 3, [1, 3]), e('birch_log', 3, [1, 3])] },
      { rolls: 1, entries: [e('wooden_axe', 3), e('stone_axe', 1)] },
      { rolls: 1, entries: [e('wooden_pickaxe', 3), e('stone_pickaxe', 1)] },
      { rolls: 3, entries: [e('apple', 5, [1, 2]), e('bread', 3, [1, 2]), e('salmon', 3, [1, 2])] },
    ],
  },
  'chest/dungeon': {
    pools: [
      { rolls: [1, 3], entries: [e('saddle', 20), e('golden_apple', 15), e('enchanted_golden_apple', 2), e('music_disc_meadow', 15), e('music_disc_deepcave', 15), e('name_tag', 20), e('golden_horse_armor', 0), e('iron_horse_armor', 0), book(10)] },
      { rolls: [1, 4], entries: [e('iron_ingot', 10, [1, 4]), e('gold_ingot', 5, [1, 4]), e('bread', 20), e('wheat', 20, [1, 4]), e('bucket', 10), e('redstone', 15, [1, 4]), e('coal', 15, [1, 4]), e('melon_seeds', 10, [2, 4]), e('pumpkin_seeds', 10, [2, 4]), e('beetroot_seeds', 10, [2, 4])] },
      { rolls: 3, entries: [e('bone', 10, [1, 8]), e('gunpowder', 10, [1, 8]), e('rotten_flesh', 10, [1, 8]), e('string', 10, [1, 8])] },
    ],
  },
  'chest/mineshaft': {
    pools: [
      { rolls: 1, entries: [e('golden_apple', 20), e('enchanted_golden_apple', 1), e('name_tag', 30), book(10), e('iron_pickaxe', 5), none(5)] },
      { rolls: [2, 4], entries: [e('iron_ingot', 10, [1, 5]), e('gold_ingot', 5, [1, 3]), e('redstone', 5, [4, 9]), e('lapis_lazuli', 5, [4, 9]), e('diamond', 3, [1, 2]), e('coal', 10, [3, 8]), e('bread', 15, [1, 3]), e('glow_berries', 15, [3, 6]), e('melon_seeds', 10, [2, 4]), e('pumpkin_seeds', 10, [2, 4]), e('beetroot_seeds', 10, [2, 4])] },
      { rolls: 3, entries: [e('torch', 15, [1, 16]), e('rail', 0), e('oak_planks', 5, [4, 12])] },
    ],
  },
  'chest/desert_temple': {
    pools: [
      { rolls: [2, 4], entries: [e('diamond', 5, [1, 3]), e('iron_ingot', 15, [1, 5]), e('gold_ingot', 15, [2, 7]), e('emerald', 15, [1, 3]), e('bone', 25, [4, 6]), e('spider_eye', 25, [1, 3]), e('rotten_flesh', 25, [3, 7]), e('saddle', 20), e('golden_apple', 20), e('enchanted_golden_apple', 2), book(20), none(15)] },
      { rolls: 4, entries: [e('bone', 10, [1, 8]), e('gunpowder', 10, [1, 8]), e('rotten_flesh', 10, [1, 8]), e('string', 10, [1, 8]), e('sand', 10, [1, 8]), e('sunstone_shard', 3, [1, 2])] },
    ],
  },
  'chest/jungle_temple': {
    pools: [{ rolls: [2, 6], entries: [e('diamond', 3, [1, 3]), e('iron_ingot', 10, [1, 5]), e('gold_ingot', 15, [2, 7]), e('emerald', 2, [1, 3]), e('bone', 20, [4, 6]), e('rotten_flesh', 16, [3, 7]), e('saddle', 3), book(1), e('bamboo', 15, [1, 3])] }],
  },
  'chest/village': {
    pools: [
      { rolls: [3, 8], entries: [e('honeycomb', 6, [1, 4]), e('iron_ingot', 10, [1, 5]), e('bread', 15, [1, 4]), e('apple', 15, [1, 5]), e('wheat', 10, [2, 8]), e('iron_pickaxe', 5), e('iron_sword', 5), e('iron_chestplate', 5), e('iron_helmet', 5), e('iron_leggings', 5), e('iron_boots', 5), e('obsidian', 5, [3, 7]), e('oak_sapling', 5, [3, 7]), e('emerald', 3, [1, 3]), e('potato', 10, [1, 7]), e('carrot', 10, [1, 7]), e('torch', 10, [2, 8])] },
    ],
  },
  'chest/stronghold_corridor': {
    pools: [
      { rolls: [2, 3], entries: [e('ender_pearl', 10), e('diamond', 3, [1, 3]), e('iron_ingot', 10, [1, 5]), e('gold_ingot', 5, [1, 3]), e('redstone', 5, [4, 9]), e('bread', 15, [1, 3]), e('apple', 15, [1, 3]), e('iron_pickaxe', 5), e('iron_sword', 5), e('iron_chestplate', 5), e('iron_helmet', 5), e('iron_leggings', 5), e('iron_boots', 5), e('golden_apple', 1), e('saddle', 1), ench('book', 1, [30, 30])] },
    ],
  },
  'chest/stronghold_library': {
    pools: [{ rolls: [2, 10], entries: [e('book', 20, [1, 3]), e('paper', 20, [2, 7]), e('compass', 1), ench('book', 10, [30, 30])] }],
  },
  'chest/nether_fortress': {
    pools: [{ rolls: [2, 4], entries: [e('diamond', 5, [1, 3]), e('iron_ingot', 5, [1, 5]), e('gold_ingot', 15, [1, 3]), e('golden_sword', 5), e('golden_chestplate', 5), e('flint_and_steel', 5), e('nether_wart', 5, [3, 7]), e('saddle', 10), e('obsidian', 2, [2, 4]), e('cinder', 6, [1, 3])] }],
  },
  'chest/bastion': {
    pools: [
      { rolls: 1, entries: [e('netherite_scrap', 4), e('ancient_debris', 2), e('netherite_ingot', 1), none(10)] },
      { rolls: [3, 5], entries: [e('gold_ingot', 20, [3, 9]), e('gold_block', 5, [1, 2]), e('crying_obsidian', 8, [3, 8]), e('golden_carrot', 10, [6, 17]), e('golden_apple', 5), ench('golden_axe', 6, [10, 30]), ench('diamond_pickaxe', 3, [20, 39]), e('arrow', 10, [10, 28]), e('magma_cream', 6, [2, 6]), e('ember_pepper', 5, [1, 3])] },
    ],
  },
  'chest/ruined_portal': {
    pools: [{ rolls: [4, 8], entries: [e('obsidian', 40, [1, 2]), e('flint', 40, [1, 4]), e('iron_nugget', 40, [9, 18]), e('flint_and_steel', 40), e('fire_charge', 40), e('golden_apple', 15), e('gold_nugget', 15, [4, 24]), e('golden_sword', 15), e('golden_axe', 15), e('golden_helmet', 15), e('golden_carrot', 15, [4, 12]), e('clock', 5), e('gold_ingot', 5, [2, 8]), e('enchanted_golden_apple', 1), e('gold_block', 1, [1, 2])] }],
  },
  'chest/end_city': {
    pools: [
      { rolls: [2, 6], entries: [e('diamond', 5, [2, 7]), e('iron_ingot', 10, [4, 8]), e('gold_ingot', 15, [2, 7]), e('emerald', 2, [2, 6]), e('beetroot_seeds', 5, [1, 10]), e('saddle', 3), ench('diamond_sword', 3), ench('diamond_boots', 3), ench('diamond_chestplate', 3), ench('diamond_leggings', 3), ench('diamond_helmet', 3), ench('diamond_pickaxe', 3), ench('diamond_shovel', 3), ench('iron_sword', 3), ench('iron_pickaxe', 3), e('void_shard', 4, [1, 3])] },
      { rolls: 1, conditions: [{ c: 'chance', chance: 0.12 }], entries: [e('elytra', 1)] },
    ],
  },
  'chest/end_ship': {
    pools: [
      { rolls: 1, entries: [e('elytra', 1)] },
      { rolls: [2, 5], entries: [e('diamond', 5, [2, 7]), e('gold_ingot', 15, [2, 7]), e('emerald', 2, [2, 6]), ench('diamond_sword', 3), ench('diamond_chestplate', 3), e('void_shard', 4, [1, 3]), e('ender_pearl', 6, [1, 3])] },
    ],
  },
  // --- V6 phase 3: the Expanded End's structures ------------------------------
  // End City 2.0 variants (Ender Alloy gear is rare everywhere, Ender Scrap uncommon)
  'chest/end_outpost': {
    pools: [
      { rolls: [3, 6], entries: [e('cooked_endling', 16, [2, 5]), e('arrow', 16, [4, 12]), e('void_shard', 10, [1, 3]), e('end_crystal_fragment', 12, [1, 4]), e('chorus_fruit', 8, [2, 5]), e('iron_ingot', 6, [1, 3]), e('ender_pearl', 4), e('spectral_arrow', 4, [2, 6]), lore(3, 'end_outpost')] },
    ],
  },
  'chest/end_settlement': {
    pools: [
      { rolls: [3, 6], entries: [e('chorus_fiber', 14, [3, 8]), e('chorus_planks', 10, [4, 12]), e('chorus_cloth', 8, [2, 6]), e('chorus_rope', 6, [2, 6]), e('chorus_fruit', 10, [2, 6]), e('end_stone_bricks', 8, [4, 12]), e('polished_cracked_end_stone', 5, [4, 10]), e('ender_glyph_stone', 4, [1, 3]), e('book', 8, [1, 3]), lore(8, 'end_settlement'), e('cooked_endling', 8, [1, 3])] },
    ],
  },
  'chest/end_ruins': {
    pools: [
      { rolls: [3, 6], entries: [e('ancient_fragment', 14, [1, 3]), e('cracked_ancient_end_bricks', 8, [2, 6]), e('ender_glyph_stone', 6, [1, 2]), lore(10, 'end_ruins'), worn('iron_sword', 5), worn('diamond_sword', 2), worn('iron_chestplate', 3), worn('crossbow', 3), worn('iron_pickaxe', 3), e('gold_ingot', 6, [1, 3]), e('void_shard', 6, [1, 2])] },
      { rolls: 1, entries: artifacts(100, { glyph_tablet: 4, ancient_coin: 4, ancient_key_shard: 2, cracked_ender_eye: 1 }) },
    ],
  },
  'chest/end_library': {
    pools: [
      { rolls: [4, 7], entries: [e('book', 14, [1, 4]), lore(18, 'end_library'), book(8), e('paper', 8, [2, 6]), amap(3), e('ender_glyph_stone', 4, [1, 2]), e('experience_bottle', 6, [1, 3]), e('ancient_fragment', 4, [1, 2]), e('bookshelf', 4, [1, 3])] },
      { rolls: 1, entries: artifacts(100, { glyph_tablet: 5, old_crystal_lens: 2, ancient_key_shard: 2 }) },
    ],
  },
  'chest/end_observatory': {
    pools: [
      { rolls: [3, 6], entries: [e('astral_dust', 14, [1, 3]), e('astral_shard', 3), lore(10, 'end_observatory'), amap(6), e('spyglass', 6), e('end_crystal_fragment', 8, [1, 3]), e('astral_glass', 6, [2, 6]), e('experience_bottle', 4, [1, 3])] },
      { rolls: 1, entries: artifacts(100, { old_crystal_lens: 5 }) },
    ],
  },
  'chest/end_shipyard': {
    pools: [
      // (Shipyards from before phase 4 have no ship chest of their own: their chests may hold the blueprint)
      { rolls: 1, conditions: [{ c: 'chance', chance: 0.4 }], entries: [e('void_skiff_blueprint', 1)] },
      { rolls: [3, 6], entries: [e('phantom_membrane', 10, [1, 3]), e('end_phantom_membrane', 4, [1, 2]), e('ender_scrap', 4), e('void_shard', 8, [1, 3]), e('chorus_rope', 10, [3, 8]), e('purpur_block', 10, [4, 12]), e('shulker_shell', 4), e('ender_pearl', 6, [1, 2]), e('firework_rocket', 6, [2, 6]), lore(4, 'end_shipyard')] },
    ],
  },
  // The one Shipyard chest that holds Elytra (about 15% of Shipyards have it: see the Shipyard plan)
  'chest/end_shipyard_elytra': { pools: [{ rolls: 1, entries: [e('elytra', 1)] }, { rolls: 1, entries: [e('void_skiff_blueprint', 1)] }, { rolls: 1, entries: [{ table: 'chest/end_shipyard' }] }] },
  // V6 phase 4: a finished ship's chest always holds the Void Skiff's blueprint
  'chest/end_shipyard_ship': { pools: [{ rolls: 1, entries: [e('void_skiff_blueprint', 1)] }, { rolls: 1, entries: [{ table: 'chest/end_shipyard' }] }] },
  'chest/end_metropolis': {
    pools: [
      { rolls: [4, 7], entries: [e('ender_scrap', 8, [1, 2]), e('astral_shard', 6, [1, 2]), e('diamond', 8, [1, 3]), e('emerald', 8, [2, 5]), e('gold_ingot', 10, [2, 6]), e('end_crystal_fragment', 8, [2, 5]), e('shulker_shell', 6), lore(8, 'end_metropolis'), ench('ender_alloy_sword', 1, [30, 39]), ench('ender_alloy_pickaxe', 1, [30, 39])] },
    ],
  },
  'chest/end_metropolis_vault': {
    pools: [
      { rolls: [5, 8], entries: [e('ender_scrap', 14, [1, 3]), e('astral_shard', 10, [1, 3]), e('netherite_ingot', 3), e('diamond', 10, [2, 5]), e('ancient_fragment', 8, [1, 3]), e('emerald', 8, [3, 8]), ench('ender_alloy_sword', 2, [30, 39]), ench('ender_alloy_helmet', 2, [30, 39]), ench('ender_alloy_chestplate', 2, [30, 39]), ench('ender_alloy_leggings', 2, [30, 39]), ench('ender_alloy_boots', 2, [30, 39]), lore(4, 'end_metropolis')] },
      { rolls: 1, entries: artifacts(100, { ancient_coin: 8, ancient_key_shard: 4 }) },
    ],
  },
  'chest/end_palace': {
    pools: [
      { rolls: [4, 7], entries: [e('crystal_glass', 10, [4, 12]), e('crystal_lamp', 8, [1, 4]), e('end_crystal_fragment', 12, [3, 8]), e('astral_shard', 8, [1, 3]), e('crystal_pillar', 6, [2, 6]), e('astral_mosaic', 6, [4, 12]), e('end_crystal', 3), e('gold_block', 3), lore(6, 'end_palace')] },
      { rolls: 1, entries: artifacts(100, { ancient_coin: 6, old_crystal_lens: 3, ancient_key_shard: 2 }) },
    ],
  },
  // The giant structures
  'chest/end_colossus': {
    pools: [
      { rolls: [3, 5], entries: [e('ancient_fragment', 14, [2, 5]), e('ender_glyph_stone', 6, [1, 3]), e('chiseled_ancient_end_bricks', 6, [2, 6]), lore(8, 'end_colossus'), e('void_shard', 6, [1, 3]), e('experience_bottle', 4, [1, 3])] },
      { rolls: 1, entries: artifacts(100, { glyph_tablet: 6, ancient_coin: 6, ancient_key_shard: 4, cracked_ender_eye: 3 }) },
    ],
  },
  // The weapon cache in the Colossus' head: one ancient weapon, always
  'chest/end_colossus_cache': {
    pools: [
      { rolls: 1, entries: [e('ancient_blade', 1), e('voidpiercer', 1), e('shardstaff', 1)] },
      { rolls: [2, 4], entries: [e('ancient_fragment', 10, [2, 4]), e('arrow', 8, [8, 16]), e('ender_scrap', 2), lore(4, 'end_colossus')] },
    ],
  },
  'chest/crystal_cathedral': {
    pools: [
      { rolls: [4, 8], entries: [e('end_crystal_fragment', 20, [4, 12]), e('end_crystal_cluster', 8, [1, 4]), e('crystal_glass', 8, [4, 10]), e('crystal_lamp', 6, [1, 3]), e('astral_dust', 4, [1, 2]), e('end_crystal', 3), lore(6, 'crystal_cathedral')] },
      { rolls: 1, entries: artifacts(100, { old_crystal_lens: 6, glyph_tablet: 2 }) },
    ],
  },
  'chest/void_observatory': {
    pools: [
      { rolls: [4, 7], entries: [e('astral_shard', 10, [1, 3]), e('astral_dust', 12, [2, 5]), amap(8), lore(12, 'void_observatory'), e('spyglass', 4), e('ancient_fragment', 6, [1, 3]), e('astral_glass', 4, [2, 6])] },
      { rolls: 1, entries: artifacts(100, { old_crystal_lens: 6, cracked_ender_eye: 3 }) },
    ],
  },
  'chest/end_fortress': {
    pools: [
      { rolls: [3, 6], entries: [e('cooked_endling', 10, [2, 5]), e('arrow', 12, [6, 16]), e('iron_ingot', 10, [2, 5]), e('void_shard', 8, [1, 3]), e('ancient_fragment', 8, [1, 3]), e('shield', 4), lore(6, 'end_fortress')] },
    ],
  },
  'chest/end_fortress_armory': {
    pools: [
      { rolls: [4, 7], entries: [e('ender_scrap', 6), e('netherite_scrap', 4), e('ancient_fragment', 10, [1, 3]), e('arrow', 12, [8, 20]), e('spectral_arrow', 6, [4, 10]), e('shield', 6), ench('diamond_sword', 4), ench('diamond_chestplate', 3), ench('ender_alloy_helmet', 1, [30, 39]), e('ancient_blade', 2), e('voidpiercer', 2), e('shardstaff', 2), lore(3, 'end_fortress')] },
    ],
  },
  'chest/fallen_city': {
    pools: [
      { rolls: [4, 8], entries: [lore(18, 'fallen_city'), e('ancient_fragment', 14, [2, 5]), e('ender_glyph_stone', 8, [1, 3]), e('book', 8, [1, 3]), e('purpur_block', 8, [4, 12]), worn('diamond_sword', 2), worn('iron_chestplate', 3), amap(4), e('gold_ingot', 6, [1, 4]), e('ancient_blade', 1), e('voidpiercer', 1), e('shardstaff', 1)] },
      { rolls: 1, entries: artifacts(100, { glyph_tablet: 8, ancient_coin: 8, ancient_key_shard: 5, cracked_ender_eye: 5, old_crystal_lens: 3 }) },
    ],
  },
  // V6 phase 4: what the quests open
  'chest/end_palace_vault': {
    pools: [
      { rolls: [4, 6], entries: [e('astral_shard', 12, [2, 4]), e('end_crystal_fragment', 10, [4, 10]), e('crystal_lamp', 6, [2, 4]), e('astral_mosaic', 6, [8, 16]), e('diamond', 6, [2, 5]), e('end_crystal', 4, [1, 2])] },
      { rolls: [1, 2], entries: [ench('ender_alloy_sword', 3, [30, 39]), ench('ender_alloy_helmet', 3, [30, 39]), ench('ender_alloy_chestplate', 3, [30, 39]), ench('ender_alloy_leggings', 3, [30, 39]), ench('ender_alloy_boots', 3, [30, 39]), ench('ender_alloy_pickaxe', 3, [30, 39])] },
      { rolls: 1, entries: artifacts(100, { old_crystal_lens: 20, ancient_coin: 20 }) },
    ],
  },
  'chest/end_fortress_keep': {
    pools: [
      { rolls: [3, 5], entries: [e('ender_scrap', 8, [1, 2]), e('netherite_scrap', 6), e('ancient_fragment', 12, [2, 5]), e('diamond', 6, [1, 3]), ench('diamond_sword', 4), ench('diamond_chestplate', 4), ench('ender_alloy_chestplate', 1, [30, 39]), lore(4, 'end_fortress')] },
      { rolls: 1, entries: [e('ancient_blade', 1), e('voidpiercer', 1), e('shardstaff', 1), none(3)] },
    ],
  },
  'chest/end_library_archive': {
    pools: [
      { rolls: [3, 5], entries: [lore(20, 'end_library'), book(8), amap(6), e('experience_bottle', 6, [2, 5]), e('ancient_fragment', 4, [1, 3])] },
      { rolls: 1, entries: artifacts(100, { glyph_tablet: 30, ancient_key_shard: 10, old_crystal_lens: 10 }) },
    ],
  },
  'chest/silent_hall': {
    pools: [
      { rolls: 1, entries: [e('silent_bell', 1)] },
      { rolls: [2, 4], entries: [lore(10, 'fallen_city'), e('ancient_fragment', 10, [2, 5]), e('ancient_coin', 6, [1, 4]), e('ender_glyph_stone', 4, [2, 4])] },
    ],
  },
  'chest/dragon_sanctum': {
    pools: [
      { rolls: 1, entries: [e('sanctum_dragon_scale', 1)] },
      // V6 phase 5: one of the Citadel Star Chart's pieces
      { rolls: 1, entries: [e('citadel_star_chart_piece', 1)] },
      { rolls: 1, entries: [loreOf('sanctum_seen')] },
      { rolls: [1, 3], entries: [e('dragon_scale_fragment', 6), e('ancient_fragment', 10, [2, 4]), e('end_crystal_fragment', 8, [3, 6])] },
    ],
  },
  // V6 phase 5: the events, the Void Citadel and the End Guardian
  'chest/storm_remnant': {
    pools: [
      { rolls: [3, 5], entries: [e('ancient_fragment', 14, [2, 5]), e('void_shard', 12, [1, 3]), e('end_crystal_fragment', 6, [2, 4]), e('astral_dust', 4, [1, 3]), e('ender_glyph_stone', 3, [1, 2])] },
      { rolls: 1, entries: artifacts(100, { ancient_coin: 8, glyph_tablet: 5, ancient_key_shard: 4, cracked_ender_eye: 3, old_crystal_lens: 3 }) },
    ],
  },
  'chest/eclipse_monolith': {
    pools: [
      { rolls: 1, entries: [lore(1, 'eclipse_monolith')] },
      { rolls: [2, 4], entries: [e('eclipse_shard', 1, [1, 2])] },
      { rolls: [1, 3], entries: [e('astral_shard', 8), e('astral_dust', 10, [2, 4]), e('end_crystal_fragment', 8, [2, 5]), e('ancient_fragment', 6, [1, 3])] },
    ],
  },
  'chest/citadel_library': {
    pools: [
      { rolls: 1, entries: [lore(1, 'void_citadel')] },
      { rolls: [2, 4], entries: [e('ancient_fragment', 12, [2, 5]), e('experience_bottle', 8, [2, 5]), book(6), e('ender_glyph_stone', 4, [1, 3]), e('astral_dust', 6, [2, 4])] },
    ],
  },
  'chest/citadel_vault': {
    pools: [
      { rolls: [1, 2], entries: [ench('ender_alloy_sword', 3, [30, 39]), ench('ender_alloy_helmet', 3, [30, 39]), ench('ender_alloy_chestplate', 3, [30, 39]), ench('ender_alloy_leggings', 3, [30, 39]), ench('ender_alloy_boots', 3, [30, 39]), ench('ender_alloy_pickaxe', 3, [30, 39])] },
      { rolls: [3, 5], entries: [e('astral_shard', 12, [1, 3]), e('eclipse_shard', 8, [1, 2]), e('ender_scrap', 6), e('diamond', 6, [2, 4]), e('ancient_fragment', 8, [2, 4])] },
      { rolls: 1, entries: [e('ancient_blade', 2), e('voidpiercer', 2), e('shardstaff', 2), none(6)] },
      { rolls: 1, entries: artifacts(100, { ancient_coin: 10, glyph_tablet: 8, old_crystal_lens: 6, ancient_key_shard: 6, cracked_ender_eye: 5 }) },
    ],
  },
  // The End Guardian's spoils besides its head, the Core, the Lance and the Veil (EndGuardian.ts)
  'chest/end_guardian': {
    pools: [
      { rolls: 1, entries: [ench('ender_alloy_sword', 3, [30, 39]), ench('ender_alloy_helmet', 3, [30, 39]), ench('ender_alloy_chestplate', 3, [30, 39]), ench('ender_alloy_leggings', 3, [30, 39]), ench('ender_alloy_boots', 3, [30, 39]), ench('ender_alloy_pickaxe', 3, [30, 39])] },
      { rolls: 1, entries: [e('astral_shard', 1, [3, 6])] },
      { rolls: 1, entries: [e('eclipse_shard', 1, [2, 4])] },
      { rolls: [1, 2], entries: [e('ender_scrap', 6, [1, 2]), e('ancient_fragment', 8, [3, 6]), e('experience_bottle', 6, [3, 6])] },
    ],
  },
  // The Dragon's Nest: rolled once per world (each chest once, shared by everyone)
  'chest/dragon_nest': {
    pools: [
      { rolls: [2, 4], entries: [e('dragon_scale_fragment', 10), e('ancient_fragment', 12, [2, 5]), e('end_crystal_fragment', 6, [2, 4]), e('ender_glyph_stone', 3, [1, 2])] },
      { rolls: 1, conditions: [{ c: 'chance', chance: 0.06 }], entries: [e('ancient_blade', 1), e('voidpiercer', 1), e('shardstaff', 1)] },
    ],
  },
  'chest/dragon_nest_a': { pools: [{ rolls: 1, entries: [{ table: 'chest/dragon_nest' }] }, { rolls: 1, entries: [{ item: 'ancient_map', functions: [{ fn: 'ancient_map' }] }] }, { rolls: 1, entries: [e('dragon_scale_fragment', 1)] }, { rolls: 1, entries: [loreOf('nest_many')] }, { rolls: 1, entries: [loreOf('nest_sealed')] }] },
  'chest/dragon_nest_b': { pools: [{ rolls: 1, entries: [{ table: 'chest/dragon_nest' }] }, { rolls: 1, entries: [loreOf('nest_counted')] }] },
  'chest/dragon_nest_c': { pools: [{ rolls: 1, entries: [{ table: 'chest/dragon_nest' }] }, { rolls: 1, entries: [loreOf('nest_visit')] }, { rolls: 1, entries: [loreOf('nest_first_fire')] }] },
  'chest/dragon_nest_d': { pools: [{ rolls: 1, entries: [{ table: 'chest/dragon_nest' }] }] },
  'chest/mansion': {
    pools: [{ rolls: [1, 3], entries: [e('lead', 20), e('golden_apple', 15), e('enchanted_golden_apple', 2), e('music_disc_meadow', 15), e('name_tag', 20), e('chainmail_chestplate', 10), e('diamond_hoe', 15), book(10), e('totem_of_undying', 3)] }, { rolls: [1, 4], entries: [e('iron_ingot', 10, [1, 4]), e('gold_ingot', 5, [1, 4]), e('bread', 20), e('wheat', 20, [1, 4]), e('bucket', 10), e('redstone', 15, [1, 4]), e('coal', 15, [1, 4])] }],
  },
  'chest/igloo': { pools: [{ rolls: [2, 8], entries: [e('apple', 15, [1, 3]), e('coal', 15, [1, 4]), e('gold_nugget', 10, [1, 3]), e('stone_axe', 2), e('rotten_flesh', 10), e('emerald', 1), e('wheat', 10, [2, 3])] }, { rolls: 1, entries: [e('golden_apple', 1)] }] },
  'chest/shipwreck': { pools: [{ rolls: [3, 6], entries: [e('iron_ingot', 90, [1, 5]), e('iron_nugget', 50, [1, 10]), e('emerald', 40, [1, 5]), e('diamond', 5), e('gold_ingot', 10, [1, 5]), e('gold_nugget', 50, [1, 10]), e('experience_bottle', 5), e('lapis_lazuli', 20, [1, 10]), e('paper', 20, [1, 12]), e('bread', 8, [1, 3])] }] },
  // --- V2 underground structures ------------------------------------------
  'chest/underground_ruins': {
    pools: [
      { rolls: 1, entries: [book(10), e('name_tag', 6), e('golden_apple', 4), e('lantern', 6), none(8)] },
      { rolls: [3, 6], entries: [e('iron_ingot', 12, [1, 4]), e('gold_ingot', 6, [1, 3]), e('emerald', 4, [1, 3]), e('bone', 10, [2, 6]), e('candle', 8, [1, 3]), e('lumen_shard', 6, [1, 4]), e('amethyst_shard', 6, [1, 4]), e('coal', 10, [2, 6]), e('bread', 8, [1, 3])] },
    ],
  },
  'chest/buried_temple': {
    pools: [
      { rolls: 1, entries: [e('golden_apple', 15), e('enchanted_golden_apple', 2), book(20), e('diamond', 8, [1, 3]), e('music_disc_deepcave', 3), e('echo_shard', 3, [1, 2]), none(10)] },
      { rolls: [3, 6], entries: [e('gold_ingot', 15, [2, 6]), e('emerald', 10, [1, 4]), e('lapis_lazuli', 10, [3, 9]), e('redstone', 8, [3, 9]), e('bone', 12, [2, 5]), e('rotten_flesh', 8, [2, 5]), e('iron_ingot', 10, [1, 4]), e('candle', 6, [1, 4])] },
    ],
  },
  'chest/hidden_chamber': {
    pools: [
      { rolls: 1, entries: [e('diamond', 6, [1, 3]), book(10), e('name_tag', 5), e('compass', 4), e('clock', 4), e('recovery_compass', 1)] },
      { rolls: [2, 5], entries: [e('emerald', 10, [1, 5]), e('gold_ingot', 10, [2, 5]), e('iron_ingot', 12, [2, 6]), e('lumen_shard', 8, [2, 5]), e('experience_bottle', 6, [1, 3]), e('ender_pearl', 4, [1, 2])] },
    ],
  },
  'chest/treasure_room': {
    pools: [
      { rolls: 1, entries: [e('enchanted_golden_apple', 3), e('totem_of_undying', 2), e('netherite_scrap', 3, [1, 2]), ench('diamond_pickaxe', 4, [25, 39]), book(6)] },
      { rolls: [4, 8], entries: [e('gold_ingot', 20, [3, 8]), e('emerald', 15, [2, 6]), e('diamond', 10, [1, 4]), e('gold_block', 4), e('iron_ingot', 10, [3, 8]), e('golden_carrot', 8, [2, 6]), e('experience_bottle', 6, [2, 5])] },
    ],
  },
  'chest/abandoned_lab': {
    pools: [
      {
        rolls: [3, 6],
        entries: [
          e('redstone', 14, [4, 12]),
          e('glowstone_dust', 10, [3, 8]),
          e('potion', 6, 1, { functions: [{ fn: 'potion', potion: 'healing' }] }),
          e('potion', 5, 1, { functions: [{ fn: 'potion', potion: 'night_vision' }] }),
          e('potion', 5, 1, { functions: [{ fn: 'potion', potion: 'swiftness' }] }),
          e('lumen_shard', 8, [2, 6]),
          e('glass_bottle', 8, [2, 6]),
          e('nether_wart', 5, [1, 4]),
          e('blaze_powder', 3, [1, 3]),
          e('spider_eye', 6, [1, 3]),
          e('fermented_spider_eye', 4, [1, 2]),
          e('ender_pearl', 3),
          e('experience_bottle', 5, [1, 4]),
        ],
      },
    ],
  },
  'chest/cave_shrine': {
    pools: [
      { rolls: 1, entries: [book(8), e('golden_carrot', 6, [2, 5]), e('experience_bottle', 5, [2, 4]), e('echo_shard', 1)] },
      { rolls: [2, 4], entries: [e('amethyst_shard', 10, [2, 6]), e('lumen_shard', 10, [2, 6]), e('glow_berries', 8, [3, 8]), e('candle', 8, [1, 4]), e('glowstone_dust', 5, [2, 5])] },
    ],
  },
  'chest/monster_chamber': {
    pools: [
      { rolls: [1, 2], entries: [e('saddle', 12), e('golden_apple', 10), e('music_disc_ember', 4), e('music_disc_drift', 4), e('name_tag', 12), book(10), ench('iron_sword', 6, [10, 25])] },
      { rolls: [2, 5], entries: [e('iron_ingot', 10, [1, 4]), e('gold_ingot', 6, [1, 4]), e('bread', 16), e('wheat', 12, [1, 4]), e('coal', 10, [1, 4]), e('redstone', 10, [1, 4])] },
      { rolls: 3, entries: [e('bone', 10, [1, 8]), e('gunpowder', 10, [1, 8]), e('rotten_flesh', 10, [1, 8]), e('string', 10, [1, 8])] },
    ],
  },
  // --- Ancient City -------------------------------------------------------
  'chest/ancient_city': {
    pools: [
      {
        rolls: [5, 10],
        entries: [
          e('enchanted_golden_apple', 1),
          e('disc_fragment', 3, [1, 3]),
          e('music_disc_echo', 2),
          e('compass', 2),
          e('sculk_catalyst', 2),
          e('name_tag', 2),
          ench('diamond_hoe', 2, [30, 50]),
          ench('diamond_leggings', 2, [30, 50]),
          e('book', 3, 1, { functions: [{ fn: 'set_enchant', id: 'silent_stride', levels: [1, 3] }] }),
          e('book', 3, 1, { functions: [{ fn: 'enchant_levels', levels: [30, 50], treasure: true }] }),
          e('sculk', 3, [4, 10]),
          e('sculk_sensor', 3, [1, 3]),
          e('candle', 3, [1, 4]),
          e('amethyst_shard', 3, [1, 15]),
          e('experience_bottle', 3, [1, 3]),
          e('glow_berries', 3, [1, 15]),
          ench('iron_leggings', 4, [20, 39]),
          e('echo_shard', 4, [1, 3]),
          e('potion', 5, 1, { functions: [{ fn: 'potion', potion: 'regeneration' }] }),
          e('bone', 5, [1, 15]),
          e('soul_torch', 5, [1, 15]),
          e('coal', 7, [6, 15]),
        ],
      },
    ],
  },
  'chest/ancient_city_ice': {
    pools: [
      { rolls: [4, 10], entries: [e('baked_potato', 1, [1, 10]), e('bread', 1, [1, 10]), e('golden_carrot', 1, [1, 4]), e('packed_ice', 2, [2, 6]), e('snowball', 2, [2, 6])] },
    ],
  },
  /** The sealed vault under the gate: the city's unique reward. */
  'chest/ancient_city_vault': {
    pools: [
      { rolls: 1, entries: [e('resonance_charm', 1)] },
      { rolls: 1, entries: [e('music_disc_hollow', 1), e('disc_fragment', 2, [3, 5])] },
      { rolls: [2, 4], entries: [e('echo_shard', 4, [2, 4]), e('book', 3, 1, { functions: [{ fn: 'set_enchant', id: 'silent_stride', levels: [2, 3] }] }), e('diamond', 3, [3, 6]), e('experience_bottle', 3, [3, 6])] },
    ],
  },
  'chest/buried_treasure': { pools: [{ rolls: 1, entries: [e('heart_of_the_sea', 1)] }, { rolls: [5, 8], entries: [e('iron_ingot', 20, [1, 4]), e('gold_ingot', 10, [1, 4]), e('tnt', 5, [1, 2]), e('emerald', 5, [4, 8]), e('diamond', 5, [1, 2]), e('prismarine_crystals', 5, [1, 5]), e('cooked_cod', 5, [2, 4])] }] },
  'chest/pillager_outpost': { pools: [{ rolls: [2, 3], entries: [e('wheat', 7, [3, 5]), e('carrot', 5, [3, 5]), e('potato', 5, [2, 5])] }, { rolls: [1, 3], entries: [e('dark_oak_log', 1, [2, 3]), e('experience_bottle', 1), e('string', 4, [1, 6]), e('arrow', 4, [2, 7]), e('tripwire_hook', 0), e('iron_ingot', 3, [1, 3]), book(1)] }, { rolls: [0, 1], entries: [e('crossbow', 1)] }] },
  'chest/ocean_ruin': { pools: [{ rolls: [2, 5], entries: [e('coal', 10, [1, 4]), e('wheat', 10, [2, 3]), e('gold_nugget', 10, [1, 3]), e('emerald', 5), e('iron_ingot', 5), book(5), e('heart_of_the_sea', 1)] }] },
  'chest/witch_hut': {
    pools: [
      { rolls: [2, 5], entries: [e('glowstone_dust', 10, [1, 3]), e('redstone', 10, [1, 3]), e('spider_eye', 10, [1, 2]), e('sugar', 10, [1, 3]), e('glass_bottle', 10, [1, 3]), e('fermented_spider_eye', 3)] },
      // V3: every hut keeps one
      { rolls: 1, entries: [e('mysterious_potion', 1)] },
      // V5.5: and the book that draws where it leads
      { rolls: 1, entries: [e('witch_grimoire', 1)] },
    ],
  },
  // Original structures
  'chest/sky_shrine': { pools: [{ rolls: [3, 6], entries: [e('feather', 20, [3, 8]), e('sky_ray_membrane', 8, [1, 2]), e('diamond', 4, [1, 2]), e('emerald', 8, [1, 4]), e('golden_apple', 6), ench('iron_boots', 6, [15, 30]), book(6), e('ender_pearl', 6, [1, 2])] }] },
  'chest/overgrown_ruin': { pools: [{ rolls: [3, 7], entries: [e('honeycomb', 10, [1, 5]), e('candle', 6, [1, 3]), e('bone', 20, [1, 6]), e('iron_nugget', 20, [3, 12]), e('emerald', 8, [1, 3]), e('sunroot_seeds', 12, [2, 5]), e('glowbell', 10, [1, 3]), e('golden_carrot', 6, [1, 4]), book(4), e('gold_ingot', 8, [1, 3])] }] },
  'chest/stalker_den': { pools: [{ rolls: [3, 6], entries: [e('bone', 25, [2, 8]), e('stalker_fang', 10, [1, 3]), e('iron_ingot', 15, [2, 5]), e('diamond', 6, [1, 3]), e('echo_shard', 3, [1, 2]), ench('iron_sword', 5, [15, 30]), e('music_disc_deepcave', 2)] }] },
  'chest/ember_forge': { pools: [{ rolls: [3, 6], entries: [e('cinder', 25, [2, 6]), e('ember_core', 4), e('netherite_scrap', 3), e('gold_ingot', 20, [2, 6]), e('blaze_rod', 10, [1, 3]), ench('golden_sword', 6, [20, 30]), e('ember_pepper', 15, [2, 5])] }] },
  'chest/farlands_ruin': {
    pools: [
      { rolls: [3, 6], entries: [e('glitch_shard', 25, [1, 4]), e('data_fragment', 15, [1, 2]), e('raw_nullium', 10, [1, 3]), e('glitch_berry', 20, [2, 6]), e('diamond', 8, [2, 5]), e('netherite_scrap', 4), e('rift_pearl', 6), book(8)] },
      { rolls: 1, conditions: [{ c: 'chance', chance: 0.08 }], entries: [e('music_disc_overflow', 1)] },
    ],
  },
  // V3: ruins in the corrupted caves
  'chest/corrupted_cache': {
    pools: [
      { rolls: [3, 6], entries: [e('glitch_shard', 20, [1, 3]), e('data_fragment', 15, [1, 2]), e('diamond', 10, [1, 3]), e('gold_ingot', 15, [2, 6]), e('redstone', 15, [4, 12]), e('emerald', 10, [1, 4]), e('ender_pearl', 10, [1, 2]), book(10)] },
      { rolls: 1, conditions: [{ c: 'chance', chance: 0.25 }], entries: [e('farlands_compass', 1)] },
      { rolls: 1, conditions: [{ c: 'chance', chance: 0.06 }], entries: [e('music_disc_overflow', 1)] },
    ],
  },
  'chest/farlands_vault': {
    pools: [
      { rolls: 1, entries: [e('glitched_ingot', 1, [1, 2])] },
      { rolls: [4, 8], entries: [e('glitch_shard', 20, [3, 8]), e('nullium_ingot', 10, [1, 3]), e('data_fragment', 20, [2, 4]), e('enchanted_golden_apple', 3), e('totem_of_undying', 3), ench('netherite_sword', 3, [30, 50]), ench('netherite_pickaxe', 3, [30, 50])] },
    ],
  },
};
