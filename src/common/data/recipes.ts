/**
 * Recipe data. Ingredients are item ids or tags prefixed with '#'.
 * Families (wood types, colours, stone variants, tool/armor tiers) are
 * generated in loops.
 */
import { WOOD_TYPES, COLORS } from './blocks';

export interface ShapedRecipe {
  type: 'shaped';
  pattern: string[];
  key: Record<string, string>;
  result: string;
  count?: number;
}
export interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: string[];
  result: string;
  count?: number;
}
export interface SmeltRecipe {
  input: string;
  result: string;
  xp: number;
  /** Which stations accept it: furnace always; blast for ores, smoker for food. */
  kind: 'ore' | 'food' | 'misc';
}
export interface StonecutRecipe {
  input: string;
  result: string;
  count: number;
}
export interface SmithRecipe {
  base: string;
  addition: string;
  result: string;
}

export const CRAFTING: (ShapedRecipe | ShapelessRecipe)[] = [];
export const SMELTING: SmeltRecipe[] = [];
export const STONECUTTING: StonecutRecipe[] = [];
export const SMITHING: SmithRecipe[] = [];

const shaped = (result: string, count: number, pattern: string[], key: Record<string, string>): void => {
  CRAFTING.push({ type: 'shaped', pattern, key, result, count });
};
const shapeless = (result: string, count: number, ...ingredients: string[]): void => {
  CRAFTING.push({ type: 'shapeless', ingredients, result, count });
};
const smelt = (input: string, result: string, xp: number, kind: SmeltRecipe['kind'] = 'misc'): void => {
  SMELTING.push({ input, result, xp, kind });
};
const cut = (input: string, result: string, count = 1): void => {
  STONECUTTING.push({ input, result, count });
};

// ---------------------------------------------------------------- tags
export const RECIPE_TAGS: Record<string, string[]> = {
  stone_crafting: ['cobblestone', 'cobbled_deepslate', 'blackstone'],
  coals: ['coal', 'charcoal'],
  sand_any: ['sand', 'red_sand'],
  mushrooms_any: ['brown_mushroom', 'red_mushroom'],
  small_flowers_any: [],
};

// ---------------------------------------------------------------- wood
for (const w of [...WOOD_TYPES, 'crimson', 'warped', 'null']) {
  const nether = w === 'crimson' || w === 'warped';
  const log = nether ? `${w}_stem` : `${w}_log`;
  const wood = nether ? `${w}_hyphae` : `${w}_wood`;
  const planks = `${w}_planks`;
  shapeless(planks, 4, `#${w}_logs`);
  shaped(wood, 3, ['LL', 'LL'], { L: log });
  shaped(`stripped_${wood}`, 3, ['LL', 'LL'], { L: `stripped_${log}` });
  shaped(`${w}_stairs`, 4, ['P  ', 'PP ', 'PPP'], { P: planks });
  shaped(`${w}_slab`, 6, ['PPP'], { P: planks });
  shaped(`${w}_fence`, 3, ['PSP', 'PSP'], { P: planks, S: 'stick' });
  shaped(`${w}_fence_gate`, 1, ['SPS', 'SPS'], { P: planks, S: 'stick' });
  shaped(`${w}_door`, 3, ['PP', 'PP', 'PP'], { P: planks });
  shaped(`${w}_trapdoor`, 2, ['PPP', 'PPP'], { P: planks });
  shapeless(`${w}_button`, 1, planks);
  shaped(`${w}_pressure_plate`, 1, ['PP'], { P: planks });
  smelt(log, 'charcoal', 0.15);
  smelt(wood, 'charcoal', 0.15);
}
shaped('stick', 4, ['P', 'P'], { P: '#planks' });
shaped('crafting_table', 1, ['PP', 'PP'], { P: '#planks' });
shaped('chest', 1, ['PPP', 'P P', 'PPP'], { P: '#planks' });
shaped('barrel', 1, ['PSP', 'P P', 'PSP'], { P: '#planks', S: '#wooden_slabs' });
shaped('bowl', 4, ['P P', ' P '], { P: '#planks' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('sign', 3, ['PPP', 'PPP', ' S '], { P: '#planks', S: 'stick' });
shaped('bookshelf', 1, ['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' });
shaped('composter', 1, ['S S', 'S S', 'SSS'], { S: '#wooden_slabs' });
shaped('jukebox', 1, ['PPP', 'PDP', 'PPP'], { P: '#planks', D: 'diamond' });
shaped('note_block', 1, ['PPP', 'PRP', 'PPP'], { P: '#planks', R: 'redstone' });
shaped('smithing_table', 1, ['II', 'PP', 'PP'], { I: 'iron_ingot', P: '#planks' });
shaped('trapped_chest', 1, ['C', 'S'], { C: 'chest', S: 'string' });
shaped('campfire', 1, [' S ', 'SCS', 'LLL'], { S: 'stick', C: '#coals', L: '#logs' });
shaped('scaffolding', 6, ['BSB', 'B B', 'B B'], { B: 'bamboo', S: 'string' });

// ---------------------------------------------------------------- tools & armor
const TOOL_MATS: [string, string][] = [
  ['wooden', '#planks'],
  ['stone', '#stone_crafting'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [tier, m] of TOOL_MATS) {
  shaped(`${tier}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: m, S: 'stick' });
  shaped(`${tier}_axe`, 1, ['MM', 'MS', ' S'], { M: m, S: 'stick' });
  shaped(`${tier}_shovel`, 1, ['M', 'S', 'S'], { M: m, S: 'stick' });
  shaped(`${tier}_hoe`, 1, ['MM', ' S', ' S'], { M: m, S: 'stick' });
  shaped(`${tier}_sword`, 1, ['M', 'M', 'S'], { M: m, S: 'stick' });
}
const ARMOR_MATS: [string, string][] = [
  ['leather', 'leather'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [tier, m] of ARMOR_MATS) {
  shaped(`${tier}_helmet`, 1, ['MMM', 'M M'], { M: m });
  shaped(`${tier}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M: m });
  shaped(`${tier}_leggings`, 1, ['MMM', 'M M', 'M M'], { M: m });
  shaped(`${tier}_boots`, 1, ['M M', 'M M'], { M: m });
}
for (const piece of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots']) {
  SMITHING.push({ base: `diamond_${piece}`, addition: 'netherite_ingot', result: `netherite_${piece}` });
  SMITHING.push({ base: `netherite_${piece}`, addition: 'glitched_ingot', result: `glitched_${piece}` });
}
shaped('bow', 1, [' SX', 'S X', ' SX'], { S: 'stick', X: 'string' });
shaped('crossbow', 1, ['SIS', 'XTX', ' S '], { S: 'stick', I: 'iron_ingot', X: 'string', T: 'flint_and_steel' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('spectral_arrow', 2, [' G ', 'GAG', ' G '], { G: 'glowstone_dust', A: 'arrow' });
shaped('shield', 1, ['PIP', 'PPP', ' P '], { P: '#planks', I: 'iron_ingot' });
shaped('fishing_rod', 1, ['  S', ' SX', 'S X'], { S: 'stick', X: 'string' });
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, 'iron_ingot', 'flint');
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
shaped('compass', 1, [' I ', 'IRI', ' I '], { I: 'iron_ingot', R: 'redstone' });
shaped('clock', 1, [' G ', 'GRG', ' G '], { G: 'gold_ingot', R: 'redstone' });
shaped('spyglass', 1, [' A ', ' C ', ' C '], { A: 'amethyst_shard', C: 'copper_ingot' });
shaped('lead', 2, ['XX ', 'XB ', '  X'], { X: 'string', B: 'slime_ball' });
shapeless('fire_charge', 3, 'gunpowder', 'blaze_powder', '#coals');
shaped('firework_rocket', 3, ['P', 'G'], { P: 'paper', G: 'gunpowder' });
shaped('turtle_helmet', 1, ['SSS', 'S S'], { S: 'scute' });

// ---------------------------------------------------------------- functional
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: '#stone_crafting' });
shaped('smoker', 1, [' L ', 'LFL', ' L '], { L: '#logs', F: 'furnace' });
shaped('blast_furnace', 1, ['III', 'IFI', 'SSS'], { I: 'iron_ingot', F: 'furnace', S: 'smooth_stone' });
shaped('stonecutter', 1, [' I ', 'SSS'], { I: 'iron_ingot', S: 'stone' });
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });
shaped('soul_torch', 4, ['C', 'S', 'O'], { C: '#coals', S: 'stick', O: '#soul_fire_base' });
shaped('lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'torch' });
shaped('soul_lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'soul_torch' });
shaped('chain', 1, ['N', 'I', 'N'], { N: 'iron_nugget', I: 'iron_ingot' });
shaped('iron_bars', 16, ['III', 'III'], { I: 'iron_ingot' });
shaped('iron_door', 3, ['II', 'II', 'II'], { I: 'iron_ingot' });
shaped('iron_trapdoor', 1, ['II', 'II'], { I: 'iron_ingot' });
shaped('cauldron', 1, ['I I', 'I I', 'III'], { I: 'iron_ingot' });
shaped('anvil', 1, ['BBB', ' I ', 'III'], { B: 'iron_block', I: 'iron_ingot' });
shaped('enchanting_table', 1, [' B ', 'DOD', 'OOO'], { B: 'book', D: 'diamond', O: 'obsidian' });
shaped('brewing_stand', 1, [' B ', 'CCC'], { B: 'blaze_rod', C: '#stone_crafting' });
shaped('beacon', 1, ['GGG', 'GSG', 'OOO'], { G: 'glass', S: 'nether_star', O: 'obsidian' });
shaped('respawn_anchor', 1, ['CCC', 'GGG', 'CCC'], { C: 'crying_obsidian', G: 'glowstone' });
shaped('lodestone', 1, ['SSS', 'SNS', 'SSS'], { S: 'chiseled_stone_bricks', N: 'netherite_ingot' });
shaped('ender_chest', 1, ['OOO', 'OEO', 'OOO'], { O: 'obsidian', E: 'ender_eye' });
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: '#sand_any' });
shaped('lever', 1, ['S', 'C'], { S: 'stick', C: 'cobblestone' });
shapeless('stone_button', 1, 'stone');
shaped('stone_pressure_plate', 1, ['SS'], { S: 'stone' });
shaped('end_rod', 4, ['B', 'P'], { B: 'blaze_rod', P: 'chorus_fruit' });
shaped('flower_pot', 1, ['B B', ' B '], { B: 'brick' });
shaped('glass_bottle', 3, ['G G', ' G '], { G: 'glass' });
shaped('paper', 3, ['SSS'], { S: 'sugar_cane' });
shapeless('book', 1, 'paper', 'paper', 'paper', 'leather');
shapeless('ender_eye', 1, 'ender_pearl', 'blaze_powder');
shaped('end_crystal', 1, ['GGG', 'GEG', 'GTG'], { G: 'glass', E: 'ender_eye', T: 'ghast_tear' });
shapeless('blaze_powder', 2, 'blaze_rod');
shapeless('magma_cream', 1, 'blaze_powder', 'slime_ball');
shapeless('fermented_spider_eye', 1, 'spider_eye', 'brown_mushroom', 'sugar');
shaped('glistering_melon_slice', 1, ['NNN', 'NMN', 'NNN'], { N: 'gold_nugget', M: 'melon_slice' });
shaped('golden_carrot', 1, ['NNN', 'NCN', 'NNN'], { N: 'gold_nugget', C: 'carrot' });
shaped('golden_apple', 1, ['III', 'IAI', 'III'], { I: 'gold_ingot', A: 'apple' });
shapeless('bone_meal', 3, 'bone');
shaped('bone_block', 1, ['BBB', 'BBB', 'BBB'], { B: 'bone_meal' });
shapeless('bone_meal', 9, 'bone_block');
shaped('slime_block', 1, ['SSS', 'SSS', 'SSS'], { S: 'slime_ball' });
shapeless('slime_ball', 9, 'slime_block');
shaped('honey_block', 1, ['HH', 'HH'], { H: 'honey_bottle' });
shaped('hay_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'wheat' });
shapeless('wheat', 9, 'hay_block');
shaped('dried_kelp_block', 1, ['KKK', 'KKK', 'KKK'], { K: 'dried_kelp' });
shapeless('dried_kelp', 9, 'dried_kelp_block');
shaped('melon', 1, ['MMM', 'MMM', 'MMM'], { M: 'melon_slice' });
shapeless('melon_seeds', 1, 'melon_slice');
shapeless('pumpkin_seeds', 4, 'pumpkin');
shapeless('sugar', 1, 'sugar_cane');
shapeless('sugar', 1, 'honey_bottle');
shaped('carved_pumpkin', 1, ['P'], { P: 'pumpkin' });
shapeless('jack_o_lantern', 1, 'carved_pumpkin', 'torch');
shapeless('sunroot_seeds', 2, 'sunroot');

// ---------------------------------------------------------------- food
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('cookie', 8, ['WSW'], { W: 'wheat', S: 'sugar' });
shaped('cake', 1, ['MMM', 'SES', 'WWW'], { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' });
shapeless('pumpkin_pie', 1, 'pumpkin', 'sugar', 'egg');
shapeless('mushroom_stew', 1, 'brown_mushroom', 'red_mushroom', 'bowl');
shapeless('beetroot_soup', 1, 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'bowl');
shapeless('rabbit_stew', 1, 'cooked_rabbit', 'carrot', 'baked_potato', '#mushrooms_any', 'bowl');

// ---------------------------------------------------------------- storage blocks
const storage: [string, string][] = [
  ['iron_block', 'iron_ingot'],
  ['gold_block', 'gold_ingot'],
  ['diamond_block', 'diamond'],
  ['emerald_block', 'emerald'],
  ['lapis_block', 'lapis_lazuli'],
  ['redstone_block', 'redstone'],
  ['coal_block', 'coal'],
  ['copper_block', 'copper_ingot'],
  ['raw_iron_block', 'raw_iron'],
  ['raw_gold_block', 'raw_gold'],
  ['raw_copper_block', 'raw_copper'],
  ['netherite_block', 'netherite_ingot'],
];
for (const [block, item] of storage) {
  shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: item });
  shapeless(item, 9, block);
}
shaped('sunstone_block', 1, ['XX', 'XX'], { X: 'sunstone_shard' });
shapeless('sunstone_shard', 4, 'sunstone_block');
shaped('glitched_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'glitched_ingot' });
shapeless('glitched_ingot', 9, 'glitched_block');
shaped('iron_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'iron_nugget' });
shapeless('iron_nugget', 9, 'iron_ingot');
shaped('gold_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'gold_nugget' });
shapeless('gold_nugget', 9, 'gold_ingot');
shapeless('netherite_ingot', 1, 'netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'gold_ingot', 'gold_ingot', 'gold_ingot', 'gold_ingot');
shapeless('glitched_ingot', 1, 'glitch_shard', 'glitch_shard', 'glitch_shard', 'glitch_shard', 'nullium_ingot', 'nullium_ingot', 'nullium_ingot', 'nullium_ingot', 'netherite_ingot');
shaped('farlands_compass', 1, ['PEP', 'ECE', 'PEP'], { P: 'ender_pearl', E: 'echo_shard', C: 'compass' });
shapeless('farlands_compass', 1, 'compass', 'corrupted_eye');
shaped('echo_lamp', 1, [' D ', 'DGD', ' D '], { D: 'data_fragment', G: 'glowstone' });

// ---------------------------------------------------------------- building
const stoneFams: [string, string][] = [
  ['cobblestone', 'cobblestone'],
  ['stone', 'stone'],
  ['stone_bricks', 'stone_bricks'],
  ['mossy_cobblestone', 'mossy_cobblestone'],
  ['mossy_stone_bricks', 'mossy_stone_bricks'],
  ['smooth_stone', 'smooth_stone'],
  ['bricks', 'bricks'],
  ['sandstone', 'sandstone'],
  ['red_sandstone', 'red_sandstone'],
  ['granite', 'granite'],
  ['diorite', 'diorite'],
  ['andesite', 'andesite'],
  ['polished_granite', 'polished_granite'],
  ['polished_diorite', 'polished_diorite'],
  ['polished_andesite', 'polished_andesite'],
  ['cobbled_deepslate', 'cobbled_deepslate'],
  ['deepslate_bricks', 'deepslate_bricks'],
  ['deepslate_tiles', 'deepslate_tiles'],
  ['polished_deepslate', 'polished_deepslate'],
  ['mud_bricks', 'mud_bricks'],
  ['prismarine', 'prismarine'],
  ['prismarine_bricks', 'prismarine_bricks'],
  ['dark_prismarine', 'dark_prismarine'],
  ['blackstone', 'blackstone'],
  ['polished_blackstone_bricks', 'polished_blackstone_bricks'],
  ['nether_bricks', 'nether_bricks'],
  ['red_nether_bricks', 'red_nether_bricks'],
  ['quartz_block', 'quartz_block'],
  ['end_stone_bricks', 'end_stone_bricks'],
  ['purpur_block', 'purpur_block'],
];
const WALLS = new Set(['cobblestone', 'stone_bricks', 'mossy_cobblestone', 'mossy_stone_bricks', 'bricks', 'sandstone', 'red_sandstone', 'granite', 'diorite', 'andesite', 'cobbled_deepslate', 'deepslate_bricks', 'deepslate_tiles', 'polished_deepslate', 'mud_bricks', 'prismarine', 'blackstone', 'polished_blackstone_bricks', 'nether_bricks', 'red_nether_bricks', 'end_stone_bricks']);
for (const [fam, base] of stoneFams) {
  shaped(`${fam}_stairs`, 4, ['B  ', 'BB ', 'BBB'], { B: base });
  shaped(`${fam}_slab`, 6, ['BBB'], { B: base });
  cut(base, `${fam}_stairs`, 1);
  cut(base, `${fam}_slab`, 2);
  if (WALLS.has(fam)) {
    shaped(`${fam}_wall`, 6, ['BBB', 'BBB'], { B: base });
    cut(base, `${fam}_wall`, 1);
  }
}
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
cut('stone', 'stone_bricks');
shaped('chiseled_stone_bricks', 1, ['S', 'S'], { S: 'stone_bricks_slab' });
cut('stone', 'chiseled_stone_bricks');
shapeless('mossy_stone_bricks', 1, 'stone_bricks', 'vine');
shapeless('mossy_stone_bricks', 1, 'stone_bricks', 'moss_block');
shapeless('mossy_cobblestone', 1, 'cobblestone', 'vine');
shapeless('mossy_cobblestone', 1, 'cobblestone', 'moss_block');
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' });
shaped('nether_bricks', 1, ['BB', 'BB'], { B: 'nether_brick' });
shaped('red_nether_bricks', 1, ['NW', 'WN'], { N: 'nether_brick', W: 'nether_wart' });
shaped('nether_brick_fence', 6, ['BNB', 'BNB'], { B: 'nether_bricks', N: 'nether_brick' });
shaped('quartz_block', 1, ['QQ', 'QQ'], { Q: 'quartz' });
shaped('quartz_bricks', 4, ['QQ', 'QQ'], { Q: 'quartz_block' });
shaped('quartz_pillar', 2, ['Q', 'Q'], { Q: 'quartz_block' });
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('red_sandstone', 1, ['SS', 'SS'], { S: 'red_sand' });
shaped('cut_sandstone', 4, ['SS', 'SS'], { S: 'sandstone' });
shaped('cut_red_sandstone', 4, ['SS', 'SS'], { S: 'red_sandstone' });
shaped('chiseled_sandstone', 1, ['S', 'S'], { S: 'sandstone_slab' });
shaped('chiseled_red_sandstone', 1, ['S', 'S'], { S: 'red_sandstone_slab' });
for (const s of ['granite', 'diorite', 'andesite']) {
  shaped(`polished_${s}`, 4, ['SS', 'SS'], { S: s });
  cut(s, `polished_${s}`);
}
shapeless('granite', 1, 'diorite', 'quartz');
shaped('diorite', 2, ['CQ', 'QC'], { C: 'cobblestone', Q: 'quartz' });
shapeless('andesite', 2, 'diorite', 'cobblestone');
shaped('polished_deepslate', 4, ['SS', 'SS'], { S: 'cobbled_deepslate' });
shaped('deepslate_bricks', 4, ['SS', 'SS'], { S: 'polished_deepslate' });
shaped('deepslate_tiles', 4, ['SS', 'SS'], { S: 'deepslate_bricks' });
shaped('chiseled_deepslate', 1, ['S', 'S'], { S: 'cobbled_deepslate_slab' });
shaped('polished_blackstone', 4, ['SS', 'SS'], { S: 'blackstone' });
shaped('polished_blackstone_bricks', 4, ['SS', 'SS'], { S: 'polished_blackstone' });
shaped('polished_basalt', 4, ['SS', 'SS'], { S: 'basalt' });
shaped('end_stone_bricks', 4, ['SS', 'SS'], { S: 'end_stone' });
shaped('purpur_pillar', 1, ['S', 'S'], { S: 'purpur_block_slab' });
shaped('prismarine', 1, ['SS', 'SS'], { S: 'prismarine_shard' });
shaped('prismarine_bricks', 1, ['SSS', 'SSS', 'SSS'], { S: 'prismarine_shard' });
shaped('dark_prismarine', 1, ['SSS', 'SIS', 'SSS'], { S: 'prismarine_shard', I: 'ink_sac' });
shaped('sea_lantern', 1, ['SCS', 'CCC', 'SCS'], { S: 'prismarine_shard', C: 'prismarine_crystals' });
shaped('glowstone', 1, ['GG', 'GG'], { G: 'glowstone_dust' });
shaped('snow_block', 1, ['SS', 'SS'], { S: 'snowball' });
shaped('snow', 6, ['SSS'], { S: 'snow_block' });
shaped('clay', 1, ['CC', 'CC'], { C: 'clay_ball' });
shapeless('packed_mud', 1, 'mud', 'wheat');
shaped('mud_bricks', 4, ['MM', 'MM'], { M: 'packed_mud' });
shaped('farstone_bricks', 4, ['SS', 'SS'], { S: 'farstone' });
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' });
shaped('packed_ice', 1, ['III', 'III', 'III'], { I: 'ice' });
shaped('blue_ice', 1, ['III', 'III', 'III'], { I: 'packed_ice' });
shaped('amethyst_block', 1, ['AA', 'AA'], { A: 'amethyst_shard' });
shaped('tinted_glass', 2, [' A ', 'AGA', ' A '], { A: 'amethyst_shard', G: 'glass' });
shaped('moss_carpet', 3, ['MM'], { M: 'moss_block' });
shaped('nether_wart_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'nether_wart' });
shaped('smooth_quartz', 4, ['QQ', 'QQ'], { Q: 'quartz_block' });

// ---------------------------------------------------------------- colours
const FLOWER_DYES: [string, string, number][] = [
  ['dandelion', 'yellow_dye', 1],
  ['poppy', 'red_dye', 1],
  ['blue_orchid', 'light_blue_dye', 1],
  ['allium', 'magenta_dye', 1],
  ['azure_bluet', 'light_gray_dye', 1],
  ['red_tulip', 'red_dye', 1],
  ['orange_tulip', 'orange_dye', 1],
  ['white_tulip', 'light_gray_dye', 1],
  ['pink_tulip', 'pink_dye', 1],
  ['oxeye_daisy', 'light_gray_dye', 1],
  ['cornflower', 'blue_dye', 1],
  ['lily_of_the_valley', 'white_dye', 1],
  ['wither_rose', 'black_dye', 1],
  ['glowbell', 'cyan_dye', 2],
  ['sunflower', 'yellow_dye', 2],
  ['lilac', 'magenta_dye', 2],
  ['rose_bush', 'red_dye', 2],
  ['peony', 'pink_dye', 2],
  ['bone_meal', 'white_dye', 1],
  ['ink_sac', 'black_dye', 1],
  ['lapis_lazuli', 'blue_dye', 1],
  ['beetroot', 'red_dye', 1],
];
for (const [src, dye, n] of FLOWER_DYES) shapeless(dye, n, src);
shapeless('orange_dye', 2, 'red_dye', 'yellow_dye');
shapeless('lime_dye', 2, 'green_dye', 'white_dye');
shapeless('pink_dye', 2, 'red_dye', 'white_dye');
shapeless('gray_dye', 2, 'black_dye', 'white_dye');
shapeless('light_gray_dye', 2, 'gray_dye', 'white_dye');
shapeless('cyan_dye', 2, 'blue_dye', 'green_dye');
shapeless('purple_dye', 2, 'blue_dye', 'red_dye');
shapeless('magenta_dye', 2, 'purple_dye', 'pink_dye');
shapeless('light_blue_dye', 2, 'blue_dye', 'white_dye');
shapeless('brown_dye', 1, 'dirt', 'black_dye', 'yellow_dye');
for (const c of COLORS) {
  shaped(`${c}_carpet`, 3, ['WW'], { W: `${c}_wool` });
  shaped(`${c}_bed`, 1, ['WWW', 'PPP'], { W: `${c}_wool`, P: '#planks' });
  shaped(`${c}_stained_glass`, 8, ['GGG', 'GDG', 'GGG'], { G: 'glass', D: `${c}_dye` });
  shaped(`${c}_terracotta`, 8, ['TTT', 'TDT', 'TTT'], { T: 'terracotta', D: `${c}_dye` });
  shaped(`${c}_concrete`, 8, ['SSG', 'SGG', 'DSG'], { S: '#sand_any', G: 'gravel', D: `${c}_dye` });
  if (c !== 'white') shapeless(`${c}_wool`, 1, 'white_wool', `${c}_dye`);
}
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' });

// ---------------------------------------------------------------- smelting
smelt('raw_iron', 'iron_ingot', 0.7, 'ore');
smelt('iron_ore', 'iron_ingot', 0.7, 'ore');
smelt('deepslate_iron_ore', 'iron_ingot', 0.7, 'ore');
smelt('raw_gold', 'gold_ingot', 1, 'ore');
smelt('gold_ore', 'gold_ingot', 1, 'ore');
smelt('deepslate_gold_ore', 'gold_ingot', 1, 'ore');
smelt('nether_gold_ore', 'gold_ingot', 1, 'ore');
smelt('raw_copper', 'copper_ingot', 0.7, 'ore');
smelt('copper_ore', 'copper_ingot', 0.7, 'ore');
smelt('deepslate_copper_ore', 'copper_ingot', 0.7, 'ore');
smelt('coal_ore', 'coal', 0.1, 'ore');
smelt('deepslate_coal_ore', 'coal', 0.1, 'ore');
smelt('diamond_ore', 'diamond', 1, 'ore');
smelt('deepslate_diamond_ore', 'diamond', 1, 'ore');
smelt('emerald_ore', 'emerald', 1, 'ore');
smelt('deepslate_emerald_ore', 'emerald', 1, 'ore');
smelt('lapis_ore', 'lapis_lazuli', 0.2, 'ore');
smelt('deepslate_lapis_ore', 'lapis_lazuli', 0.2, 'ore');
smelt('redstone_ore', 'redstone', 0.7, 'ore');
smelt('deepslate_redstone_ore', 'redstone', 0.7, 'ore');
smelt('nether_quartz_ore', 'quartz', 0.2, 'ore');
smelt('ancient_debris', 'netherite_scrap', 2, 'ore');
smelt('sunstone_ore', 'sunstone_shard', 0.8, 'ore');
smelt('cinder_ore', 'cinder', 0.8, 'ore');
smelt('raw_nullium', 'nullium_ingot', 2, 'ore');
smelt('null_ore', 'nullium_ingot', 2, 'ore');
smelt('glitch_ore', 'glitch_shard', 2, 'ore');
for (const [a, b] of [
  ['iron_pickaxe', 'iron_nugget'],
  ['iron_sword', 'iron_nugget'],
  ['iron_axe', 'iron_nugget'],
  ['iron_shovel', 'iron_nugget'],
  ['golden_pickaxe', 'gold_nugget'],
  ['golden_sword', 'gold_nugget'],
] as const) smelt(a, b, 0.1, 'ore');
smelt('sand', 'glass', 0.1);
smelt('red_sand', 'glass', 0.1);
smelt('cobblestone', 'stone', 0.1);
smelt('stone', 'smooth_stone', 0.1);
smelt('cobbled_deepslate', 'deepslate', 0.1);
smelt('clay_ball', 'brick', 0.3);
smelt('clay', 'terracotta', 0.35);
smelt('netherrack', 'nether_brick', 0.1);
smelt('stone_bricks', 'cracked_stone_bricks', 0.1);
smelt('deepslate_bricks', 'cracked_deepslate_bricks', 0.1);
smelt('nether_bricks', 'cracked_nether_bricks', 0.1);
smelt('polished_blackstone_bricks', 'cracked_polished_blackstone_bricks', 0.1);
smelt('sandstone', 'smooth_sandstone', 0.1);
smelt('red_sandstone', 'smooth_red_sandstone', 0.1);
smelt('quartz_block', 'smooth_quartz', 0.1);
smelt('basalt', 'smooth_basalt', 0.1);
smelt('cactus', 'green_dye', 1);
smelt('kelp', 'dried_kelp', 0.1, 'food');
smelt('wet_sponge', 'sponge', 0.15);
smelt('chorus_fruit', 'purpur_block', 0.1);
smelt('farstone', 'corrupted_stone', 0.1);
for (const [a, b] of [
  ['beef', 'cooked_beef'],
  ['porkchop', 'cooked_porkchop'],
  ['chicken', 'cooked_chicken'],
  ['mutton', 'cooked_mutton'],
  ['rabbit', 'cooked_rabbit'],
  ['cod', 'cooked_cod'],
  ['salmon', 'cooked_salmon'],
  ['potato', 'baked_potato'],
  ['sunroot', 'roasted_sunroot'],
] as const) smelt(a, b, 0.35, 'food');

/** Furnace fuel values not derivable from item defs (ticks). */
export const EXTRA_FUEL: Record<string, number> = {
  bamboo: 50,
  scaffolding: 50,
  crafting_table: 300,
  chest: 300,
  bookshelf: 300,
  barrel: 300,
  jukebox: 300,
  note_block: 300,
  composter: 300,
  ladder: 300,
  dried_kelp_block: 4000,
  blaze_rod: 2400,
};
