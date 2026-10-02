/**
 * Item definitions (data-driven). Block items are generated automatically
 * from block definitions by the item registry; this file lists everything
 * else plus overrides.
 */
import type { ItemDef } from '../registry/itemTypes';
import type { ToolType } from '../registry/blockTypes';
import { COLORS } from './blocks';
import { engineeringItemDefs } from '../engineering/catalog';
import { expansionItemDefs } from '../endExpansion/resources';
import { ancientItemDefs } from '../endExpansion/ancient';

const defs: ItemDef[] = [];
const add = (d: ItemDef): ItemDef => {
  defs.push(d);
  return d;
};
const title = (id: string): string =>
  id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
const mat = (id: string, o: Partial<ItemDef> = {}): ItemDef => add({ id, name: o.name ?? title(id), creative: 'materials', ...o });

// ---------------------------------------------------------------------------
// Tool tiers
// ---------------------------------------------------------------------------
export interface Tier {
  id: string;
  name: string;
  level: number;
  speed: number;
  durability: number;
  enchantability: number;
  bonus: number;
  repair: string;
  fireResistant?: boolean;
  rarity?: ItemDef['rarity'];
}
export const TIERS: Tier[] = [
  { id: 'wooden', name: 'Wooden', level: 0, speed: 2, durability: 59, enchantability: 15, bonus: 0, repair: 'planks' },
  { id: 'stone', name: 'Stone', level: 1, speed: 4, durability: 131, enchantability: 5, bonus: 1, repair: 'cobblestone' },
  { id: 'iron', name: 'Iron', level: 2, speed: 6, durability: 250, enchantability: 14, bonus: 2, repair: 'iron_ingot' },
  { id: 'golden', name: 'Golden', level: 0, speed: 12, durability: 32, enchantability: 22, bonus: 0, repair: 'gold_ingot' },
  { id: 'diamond', name: 'Diamond', level: 3, speed: 8, durability: 1561, enchantability: 10, bonus: 3, repair: 'diamond' },
  { id: 'netherite', name: 'Netherite', level: 4, speed: 9, durability: 2031, enchantability: 15, bonus: 4, repair: 'netherite_ingot', fireResistant: true, rarity: 'rare' },
  { id: 'glitched', name: 'Glitched', level: 5, speed: 12, durability: 3333, enchantability: 18, bonus: 5, repair: 'glitched_ingot', fireResistant: true, rarity: 'glitched' },
  // V6 (the End Expansion): netherite upgraded at a smithing table with an Ender Alloy Ingot
  { id: 'ender_alloy', name: 'Ender Alloy', level: 4, speed: 10, durability: 2500, enchantability: 18, bonus: 5, repair: 'ender_alloy_ingot', fireResistant: true, rarity: 'epic' },
];

const SWORD_DMG = [4, 5, 6, 4, 7, 8, 10, 9];
const AXE_DMG = [7, 9, 9, 7, 9, 10, 12, 11];
const AXE_SPD = [0.8, 0.8, 0.9, 1.0, 1.0, 1.0, 1.1, 1.0];
const PICK_DMG = [2, 3, 4, 2, 5, 6, 7, 7];
const SHOVEL_DMG = [2.5, 3.5, 4.5, 2.5, 5.5, 6.5, 7.5, 7.5];
const HOE_SPD = [1, 2, 3, 1, 4, 4, 4, 4];

TIERS.forEach((t, i) => {
  const common = {
    durability: t.durability,
    maxStack: 1,
    enchantability: t.enchantability,
    repair: t.repair,
    fireResistant: t.fireResistant,
    rarity: t.rarity,
    creative: 'tools',
  };
  const tool = (type: ToolType, dmg: number, spd: number): ItemDef =>
    add({
      id: `${t.id}_${type}`,
      name: `${t.name} ${title(type)}`,
      tool: { type, tier: t.level, speed: t.speed, material: t.id },
      weapon: { damage: dmg, speed: spd },
      use: type === 'hoe' ? 'hoe' : type === 'shovel' ? 'shovel' : type === 'axe' ? 'axe' : undefined,
      tags: ['tools', type + 's'],
      ...common,
    });
  add({
    id: `${t.id}_sword`,
    name: `${t.name} Sword`,
    tool: { type: 'sword', tier: t.level, speed: 1.5, material: t.id },
    weapon: { damage: SWORD_DMG[i]!, speed: 1.6 },
    tags: ['weapons', 'swords'],
    ...common,
    creative: 'combat',
  });
  tool('pickaxe', PICK_DMG[i]!, 1.2);
  tool('axe', AXE_DMG[i]!, AXE_SPD[i]!);
  tool('shovel', SHOVEL_DMG[i]!, 1.0);
  tool('hoe', 1, HOE_SPD[i]!);
});

// ---------------------------------------------------------------------------
// Armor
// ---------------------------------------------------------------------------
interface ArmorMat {
  id: string;
  name: string;
  mult: number;
  def: [number, number, number, number];
  toughness?: number;
  kb?: number;
  ench: number;
  repair: string;
  fireResistant?: boolean;
  rarity?: ItemDef['rarity'];
}
export const ARMOR_MATERIALS: ArmorMat[] = [
  { id: 'leather', name: 'Leather', mult: 5, def: [1, 3, 2, 1], ench: 15, repair: 'leather' },
  { id: 'chainmail', name: 'Chainmail', mult: 15, def: [2, 5, 4, 1], ench: 12, repair: 'iron_ingot' },
  { id: 'iron', name: 'Iron', mult: 15, def: [2, 6, 5, 2], ench: 9, repair: 'iron_ingot' },
  { id: 'golden', name: 'Golden', mult: 7, def: [2, 5, 3, 1], ench: 25, repair: 'gold_ingot' },
  { id: 'diamond', name: 'Diamond', mult: 33, def: [3, 8, 6, 3], toughness: 2, ench: 10, repair: 'diamond' },
  { id: 'netherite', name: 'Netherite', mult: 37, def: [3, 8, 6, 3], toughness: 3, kb: 0.1, ench: 15, repair: 'netherite_ingot', fireResistant: true, rarity: 'rare' },
  { id: 'glitched', name: 'Glitched', mult: 42, def: [4, 9, 7, 4], toughness: 4, kb: 0.15, ench: 18, repair: 'glitched_ingot', fireResistant: true, rarity: 'glitched' },
  { id: 'ender_alloy', name: 'Ender Alloy', mult: 42, def: [3, 8, 6, 3], toughness: 4, kb: 0.15, ench: 18, repair: 'ender_alloy_ingot', fireResistant: true, rarity: 'epic' },
];
const ARMOR_PIECES = [
  { slot: 'head', piece: 'helmet', base: 11 },
  { slot: 'chest', piece: 'chestplate', base: 16 },
  { slot: 'legs', piece: 'leggings', base: 15 },
  { slot: 'feet', piece: 'boots', base: 13 },
] as const;
for (const m of ARMOR_MATERIALS) {
  ARMOR_PIECES.forEach((p, i) => {
    add({
      id: `${m.id}_${p.piece}`,
      name: `${m.name} ${title(p.piece)}`,
      maxStack: 1,
      durability: p.base * m.mult,
      armor: { slot: p.slot, defense: m.def[i]!, toughness: m.toughness, knockbackRes: m.kb, material: m.id },
      enchantability: m.ench,
      repair: m.repair,
      fireResistant: m.fireResistant,
      rarity: m.rarity,
      creative: 'combat',
      tags: ['armor'],
    });
  });
}
add({ id: 'turtle_helmet', name: 'Turtle Shell', maxStack: 1, durability: 275, armor: { slot: 'head', defense: 2, material: 'turtle' }, enchantability: 9, creative: 'combat', tags: ['armor'] });
// (repaired with either membrane: a phantom's, or a V6 End Phantom's)
add({ id: 'elytra', name: 'Elytra', maxStack: 1, durability: 432, armor: { slot: 'chest', defense: 0, material: 'elytra' }, use: 'elytra', rarity: 'epic', creative: 'combat', repair: 'membranes' });

// ---------------------------------------------------------------------------
// Combat & utility
// ---------------------------------------------------------------------------
add({ id: 'bow', name: 'Bow', maxStack: 1, durability: 384, use: 'bow', enchantability: 1, creative: 'combat', weapon: { damage: 1, speed: 4 } });
add({ id: 'crossbow', name: 'Crossbow', maxStack: 1, durability: 465, use: 'crossbow', enchantability: 1, creative: 'combat' });
add({ id: 'arrow', name: 'Arrow', creative: 'combat', tags: ['arrows'] });
add({ id: 'spectral_arrow', name: 'Spectral Arrow', creative: 'combat', tags: ['arrows'] });
add({ id: 'shield', name: 'Shield', maxStack: 1, durability: 336, use: 'shield', creative: 'combat', repair: 'planks' });
add({ id: 'trident', name: 'Trident', maxStack: 1, durability: 250, use: 'trident', weapon: { damage: 9, speed: 1.1 }, rarity: 'rare', creative: 'combat' });
add({ id: 'totem_of_undying', name: 'Totem of Undying', maxStack: 1, use: 'totem', rarity: 'uncommon', creative: 'combat' });
add({ id: 'flint_and_steel', name: 'Flint and Steel', maxStack: 1, durability: 64, use: 'flint_and_steel', creative: 'tools' });
add({ id: 'fire_charge', name: 'Fire Charge', use: 'fire_charge', creative: 'tools' });
add({ id: 'shears', name: 'Shears', maxStack: 1, durability: 238, use: 'shears', tool: { type: 'shears', tier: 2, speed: 5 }, creative: 'tools' });
add({ id: 'fishing_rod', name: 'Fishing Rod', maxStack: 1, durability: 64, use: 'fishing_rod', creative: 'tools' });
add({ id: 'carrot_on_a_stick', name: 'Carrot on a Stick', maxStack: 1, durability: 25, use: 'carrot_on_a_stick', creative: 'tools' });
add({ id: 'bucket', name: 'Bucket', maxStack: 16, use: 'bucket', creative: 'tools' });
add({ id: 'water_bucket', name: 'Water Bucket', maxStack: 1, use: 'water_bucket', creative: 'tools' });
add({ id: 'lava_bucket', name: 'Lava Bucket', maxStack: 1, use: 'lava_bucket', fuel: 20000, creative: 'tools' });
add({ id: 'milk_bucket', name: 'Milk Bucket', maxStack: 1, use: 'milk_bucket', food: { hunger: 0, saturation: 0, alwaysEdible: true, special: 'milk', remainder: 'bucket' }, creative: 'food' });
add({ id: 'compass', name: 'Compass', use: 'compass', creative: 'tools' });
add({ id: 'recovery_compass', name: 'Recovery Compass', use: 'recovery_compass', rarity: 'uncommon', creative: 'tools' });
add({ id: 'clock', name: 'Clock', use: 'clock', creative: 'tools' });
add({ id: 'spyglass', name: 'Spyglass', maxStack: 1, use: 'spyglass', creative: 'tools' });
add({ id: 'ender_pearl', name: 'Ender Pearl', maxStack: 16, use: 'ender_pearl', creative: 'tools' });
add({ id: 'ender_eye', name: 'Eye of Ender', use: 'ender_eye', creative: 'tools' });
add({ id: 'end_crystal', name: 'End Crystal', creative: 'tools', rarity: 'rare' });
add({ id: 'snowball', name: 'Snowball', maxStack: 16, use: 'snowball', creative: 'combat' });
add({ id: 'egg', name: 'Egg', maxStack: 16, use: 'egg', creative: 'materials' });
add({ id: 'bone_meal', name: 'Bone Meal', use: 'bone_meal', creative: 'materials' });
add({ id: 'glass_bottle', name: 'Glass Bottle', use: 'glass_bottle', creative: 'brewing' });
add({ id: 'potion', name: 'Potion', maxStack: 1, use: 'potion', creative: 'brewing' });
add({ id: 'splash_potion', name: 'Splash Potion', maxStack: 1, use: 'splash_potion', creative: 'brewing' });
// V3: found only in witch's huts. What it does is left for the player to find out.
add({ id: 'mysterious_potion', name: 'Mysterious Potion', maxStack: 1, rarity: 'glitched', glint: true, creative: 'brewing' });
add({ id: 'experience_bottle', name: "Bottle o' Enchanting", use: 'experience_bottle', rarity: 'uncommon', glint: true, creative: 'tools' });
add({ id: 'enchanted_book', name: 'Enchanted Book', maxStack: 1, rarity: 'uncommon', glint: true, creative: 'tools' });
add({ id: 'name_tag', name: 'Name Tag', creative: 'tools' });
add({ id: 'saddle', name: 'Saddle', maxStack: 1, creative: 'tools' });
add({ id: 'lead', name: 'Lead', creative: 'tools' });
add({ id: 'firework_rocket', name: 'Firework Rocket', use: 'firework', creative: 'tools' });
/** Music discs: each plays its own procedurally composed piece in a jukebox. */
export const MUSIC_DISCS: [string, string][] = [
  ['meadow', 'Meadow'],
  ['deepcave', 'Deep Cave'],
  ['overflow', 'Overflow'],
  ['ember', 'Ember'],
  ['drift', 'Drift'],
  ['skyward', 'Skyward'],
  ['echo', 'Echo'],
  ['hollow', 'Hollow'],
];
for (const [track, title] of MUSIC_DISCS) {
  add({ id: 'music_disc_' + track, name: `Music Disc - ${title}`, maxStack: 1, use: 'music_disc', rarity: 'rare', creative: 'tools', data: { track } });
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
mat('stick', { fuel: 100 });
mat('coal', { fuel: 1600 });
mat('charcoal', { fuel: 1600 });
mat('raw_iron');
mat('iron_ingot');
mat('iron_nugget');
mat('raw_gold');
mat('gold_ingot');
mat('gold_nugget');
mat('raw_copper');
mat('copper_ingot');
mat('diamond');
mat('emerald');
mat('lapis_lazuli');
// V5: redstone dust is a material now; Signal Cable replaces placing it as wire (old wire keeps working)
mat('redstone');
mat('quartz', { name: 'Nether Quartz' });
mat('amethyst_shard');
mat('netherite_scrap', { fireResistant: true });
mat('netherite_ingot', { fireResistant: true, rarity: 'rare' });
mat('flint');
mat('clay_ball');
mat('brick');
mat('nether_brick');
mat('leather');
mat('rabbit_hide');
mat('feather');
mat('string');
mat('bone');
mat('gunpowder');
mat('slime_ball');
mat('blaze_rod', { fuel: 2400 });
mat('blaze_powder');
mat('ghast_tear');
mat('magma_cream');
mat('nether_star', { rarity: 'epic', glint: true });
mat('glowstone_dust');
mat('prismarine_shard');
mat('prismarine_crystals');
mat('paper');
mat('book');
mat('sugar');
mat('wheat');
mat('ink_sac');
mat('lumen_shard', { name: 'Lumen Shard' });
// Ancient City finds
mat('disc_fragment', { name: 'Disc Fragment', rarity: 'uncommon' });
add({ id: 'resonance_charm', name: 'Resonance Charm', maxStack: 1, rarity: 'epic', creative: 'tools' });
mat('glow_ink_sac');
mat('phantom_membrane', { tags: ['membranes'] });
mat('rabbit_foot');
mat('spider_eye', { food: { hunger: 2, saturation: 3.2, effects: [{ effect: 'poison', duration: 100 }] }, creative: 'food' });
mat('fermented_spider_eye');
mat('glistering_melon_slice');
mat('dragon_breath', { rarity: 'uncommon' });
mat('echo_shard', { rarity: 'uncommon' });
mat('shulker_shell');
mat('scute');
mat('nautilus_shell');
mat('heart_of_the_sea', { rarity: 'uncommon' });
mat('honeycomb');
mat('bowl', { fuel: 100 });
mat('dragon_scale', { rarity: 'epic', name: 'Dragon Scale' });
for (const c of COLORS) mat(c + '_dye', { tags: ['dyes'] });

// Seeds (place crops)
add({ id: 'wheat_seeds', name: 'Wheat Seeds', block: 'wheat', creative: 'nature', tags: ['seeds'] });
add({ id: 'beetroot_seeds', name: 'Beetroot Seeds', block: 'beetroots', creative: 'nature', tags: ['seeds'] });
add({ id: 'pumpkin_seeds', name: 'Pumpkin Seeds', block: 'pumpkin_stem', creative: 'nature', tags: ['seeds'] });
add({ id: 'melon_seeds', name: 'Melon Seeds', block: 'melon_stem', creative: 'nature', tags: ['seeds'] });
add({ id: 'sunroot_seeds', name: 'Sunroot Seeds', block: 'sunroot', creative: 'nature', tags: ['seeds'] });
add({ id: 'nether_wart', name: 'Nether Wart', block: 'nether_wart', creative: 'nature' });
add({ id: 'sign', name: 'Sign', maxStack: 16, block: 'sign', wallBlock: 'wall_sign', creative: 'functional', fuel: 200 });
add({ id: 'kelp', name: 'Kelp', block: 'kelp', creative: 'nature' });
add({ id: 'sugar_cane', name: 'Sugar Cane', block: 'sugar_cane', creative: 'nature' });
add({ id: 'torch', name: 'Torch', block: 'torch', wallBlock: 'wall_torch', creative: 'functional' });
add({ id: 'soul_torch', name: 'Soul Torch', block: 'soul_torch', wallBlock: 'soul_wall_torch', creative: 'functional' });
add({ id: 'redstone_torch', name: 'Redstone Torch', block: 'redstone_torch', wallBlock: 'redstone_wall_torch', creative: 'redstone' });

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------
const food = (id: string, hunger: number, sat: number, o: Partial<ItemDef> = {}, f: Partial<ItemDef['food']> = {}): ItemDef =>
  add({ id, name: o.name ?? title(id), creative: 'food', ...o, food: { hunger, saturation: sat, ...f } });
food('apple', 4, 2.4);
food('golden_apple', 4, 9.6, { rarity: 'rare' }, { alwaysEdible: true, effects: [{ effect: 'regeneration', duration: 100, amplifier: 1 }, { effect: 'absorption', duration: 2400 }] });
food('enchanted_golden_apple', 4, 9.6, { rarity: 'epic', glint: true }, { alwaysEdible: true, effects: [{ effect: 'regeneration', duration: 400, amplifier: 1 }, { effect: 'absorption', duration: 2400, amplifier: 3 }, { effect: 'resistance', duration: 6000 }, { effect: 'fire_resistance', duration: 6000 }] });
food('bread', 5, 6);
food('cookie', 2, 0.4);
food('carrot', 3, 3.6, { block: 'carrots' });
food('golden_carrot', 6, 14.4);
food('potato', 1, 0.6, { block: 'potatoes' });
food('baked_potato', 5, 6);
food('poisonous_potato', 2, 1.2, {}, { effects: [{ effect: 'poison', duration: 100, chance: 0.6 }] });
food('beetroot', 1, 1.2);
food('beetroot_soup', 6, 7.2, { maxStack: 1 }, { remainder: 'bowl' });
food('mushroom_stew', 6, 7.2, { maxStack: 1 }, { remainder: 'bowl' });
food('rabbit_stew', 10, 12, { maxStack: 1 }, { remainder: 'bowl' });
food('melon_slice', 2, 1.2);
food('pumpkin_pie', 8, 4.8);
food('sweet_berries', 2, 0.4, { block: 'sweet_berry_bush' });
food('glow_berries', 2, 0.4, { block: 'cave_vines' });
food('dried_kelp', 1, 0.6, {}, { eatTime: 16 });
food('chorus_fruit', 4, 2.4, {}, { alwaysEdible: true, special: 'chorus_teleport' });
food('honey_bottle', 6, 1.2, { maxStack: 16 }, { alwaysEdible: true, remainder: 'glass_bottle' });
food('beef', 3, 1.8);
food('cooked_beef', 8, 12.8, { name: 'Steak' });
food('porkchop', 3, 1.8, { name: 'Raw Porkchop' });
food('cooked_porkchop', 8, 12.8);
food('mutton', 2, 1.2, { name: 'Raw Mutton' });
food('cooked_mutton', 6, 9.6);
food('chicken', 2, 1.2, { name: 'Raw Chicken' }, { effects: [{ effect: 'hunger', duration: 600, chance: 0.3 }] });
food('cooked_chicken', 6, 7.2);
food('rabbit', 3, 1.8, { name: 'Raw Rabbit' });
food('cooked_rabbit', 5, 6);
food('cod', 2, 0.4, { name: 'Raw Cod' });
food('cooked_cod', 5, 6);
food('salmon', 2, 0.4, { name: 'Raw Salmon' });
food('cooked_salmon', 6, 9.6);
food('tropical_fish', 1, 0.2);
food('pufferfish', 1, 0.2, {}, { effects: [{ effect: 'poison', duration: 1200, amplifier: 1 }, { effect: 'hunger', duration: 300, amplifier: 2 }, { effect: 'nausea', duration: 300 }] });
food('rotten_flesh', 4, 0.8, {}, { effects: [{ effect: 'hunger', duration: 600, chance: 0.8 }] });
// Original foods
food('sunroot', 4, 4.8, {}, { effects: [{ effect: 'regeneration', duration: 60 }] });
food('roasted_sunroot', 7, 10);
food('ember_pepper', 3, 2.0, { name: 'Ember Pepper' }, { alwaysEdible: true, effects: [{ effect: 'fire_resistance', duration: 1200 }] });
food('glitch_berry', 3, 3, { rarity: 'uncommon' }, { alwaysEdible: true, special: 'chorus_teleport' });
food('stalker_steak', 9, 10, { name: 'Cave Stalker Steak' }, { effects: [{ effect: 'night_vision', duration: 1200 }] });

// ---------------------------------------------------------------------------
// Original / dimension materials
// ---------------------------------------------------------------------------
mat('sunstone_shard', { name: 'Sunstone Shard', rarity: 'uncommon' });
mat('cinder', { name: 'Cinder', fuel: 3200 });
mat('ember_core', { name: 'Ember Core', rarity: 'rare', fireResistant: true });
mat('void_shard', { name: 'Void Shard', rarity: 'uncommon' });
mat('glitch_shard', { name: 'Glitch Shard', rarity: 'glitched' });
mat('raw_nullium', { name: 'Raw Nullium', rarity: 'uncommon' });
mat('nullium_ingot', { name: 'Nullium Ingot', rarity: 'rare' });
mat('glitched_ingot', { name: 'Glitched Ingot', rarity: 'glitched', fireResistant: true });
mat('data_fragment', { name: 'Data Fragment', rarity: 'rare' });
mat('stalker_fang', { name: 'Stalker Fang' });
mat('sky_ray_membrane', { name: 'Sky Ray Membrane' });
mat('glitch_core', { name: 'Glitch Core', rarity: 'glitched', glint: true });
mat('corrupted_eye', { name: 'Corrupted Eye', rarity: 'glitched' });
add({ id: 'rift_pearl', name: 'Rift Pearl', maxStack: 16, use: 'rift_pearl', rarity: 'rare', creative: 'tools' });
add({ id: 'farlands_compass', name: 'Farlands Compass', maxStack: 1, use: 'farlands_compass', rarity: 'glitched', creative: 'tools', glint: true });

// ---------------------------------------------------------------------------
// V4 - The World Update: biome foods and the bunker keycard
// ---------------------------------------------------------------------------
food('cactus_fruit', 3, 1.8, { name: 'Cactus Fruit' });
food('snowberries', 2, 1.2, { name: 'Snowberries' }, { eatTime: 16 });
food('lingonberries', 2, 1.2, { name: 'Lingonberries' }, { eatTime: 16 });
food('aloe_leaf', 1, 1, { name: 'Aloe Leaf' }, { alwaysEdible: true, eatTime: 16, effects: [{ effect: 'regeneration', duration: 100 }] });
add({ id: 'bunker_keycard', name: 'Bunker Keycard', maxStack: 1, rarity: 'uncommon', creative: 'tools' });
add({ id: 'temple_relic', name: 'Temple Relic', maxStack: 1, rarity: 'rare', creative: 'tools' });

// V5 - The Engineering Update: materials, components, upgrades and the Engineering Book
for (const d of engineeringItemDefs()) add(d);

// V5.5 - The Digital Corruption Update: an old book in every witch's hut, full of drawings that should not make sense yet
add({ id: 'witch_grimoire', name: "Witch's Grimoire", maxStack: 1, use: 'grimoire', rarity: 'rare', creative: 'tools' });

// V6 - The End Expansion, phase 2: the Expanded End's materials, food and the Void Pack
for (const d of expansionItemDefs()) add(d);

// V6 - The End Expansion, phase 3: End Artifacts, the ancient weapons and the Ancient Map
for (const d of ancientItemDefs()) add(d);

export const ITEM_DEFS: readonly ItemDef[] = defs;
