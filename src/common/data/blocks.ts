/**
 * Block definitions (data-driven).
 *
 * Textures are referenced by name; the asset pipeline (tools/gen-assets.ts)
 * produces one 16x16 PNG per texture name and packs them into the atlas.
 */
import type { BlockDef, SoundGroup, TintKind } from '../registry/blockTypes';
import { engineeringBlockDefs, endEngineeringBlockDefs } from '../engineering/catalog';
import { digitalBlockDefs } from '../digital/blocks';
import { expansionBlockDefs } from '../endExpansion/blocks';
import { addExpansionResourceBlocks } from '../endExpansion/resources';
import { addAncientBlocks } from '../endExpansion/ancient';
import { transportBlockDefs } from '../endExpansion/transport';
import { questBlockDefs } from '../endExpansion/quests';
import { eventBlockDefs } from '../endExpansion/events';
import { citadelBlockDefs } from '../endExpansion/citadel';

const defs: BlockDef[] = [];
const add = (d: BlockDef): BlockDef => {
  defs.push(d);
  return d;
};

export const FACING4 = ['north', 'south', 'west', 'east'] as const;
export const BOOL = ['false', 'true'] as const;
const AXIS = ['y', 'x', 'z'] as const;
export const COLORS = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;
export type DyeColor = (typeof COLORS)[number];

const title = (id: string): string =>
  id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

interface Opt extends Partial<BlockDef> {}

function cube(id: string, hardness: number, sound: SoundGroup, o: Opt = {}): BlockDef {
  return add({ id, name: o.name ?? title(id), hardness, sound, model: 'cube', tex: { all: id }, ...o });
}

function stoneLike(id: string, hardness = 1.5, o: Opt = {}): BlockDef {
  return cube(id, hardness, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, resistance: 6, ...o });
}

function column(id: string, hardness: number, sound: SoundGroup, o: Opt = {}): BlockDef {
  return add({
    id,
    name: o.name ?? title(id),
    hardness,
    sound,
    model: 'column',
    props: { axis: AXIS },
    tex: { top: id + '_top', side: id },
    ...o,
  });
}

function slab(id: string, name: string, tex: string, hardness: number, sound: SoundGroup, o: Opt = {}): BlockDef {
  return add({
    id,
    name,
    hardness,
    sound,
    model: 'slab',
    props: { type: ['bottom', 'top', 'double'] },
    tex: { all: tex },
    layer: 'opaque',
    opacity: 0,
    tags: ['slab'],
    ...o,
  });
}

function stairs(id: string, name: string, tex: string, hardness: number, sound: SoundGroup, o: Opt = {}): BlockDef {
  return add({
    id,
    name,
    hardness,
    sound,
    model: 'stairs',
    props: {
      facing: FACING4,
      half: ['bottom', 'top'],
      shape: ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'],
    },
    tex: { all: tex },
    layer: 'opaque',
    tags: ['stairs'],
    ...o,
  });
}

function wall(id: string, name: string, tex: string, hardness: number, o: Opt = {}): BlockDef {
  return add({
    id,
    name,
    hardness,
    sound: 'stone',
    model: 'wall',
    props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL, up: BOOL },
    defaults: { up: 'true' },
    tex: { all: tex },
    tool: 'pickaxe',
    harvestLevel: 0,
    requiresTool: true,
    tags: ['wall'],
    ...o,
  });
}

/** Adds stairs, slab and (optionally) wall variants for a material block. */
function family(base: string, tex: string, hardness: number, sound: SoundGroup, withWall: boolean, o: Opt = {}): void {
  const baseName = title(base.replace(/s$/, '').replace(/_block$/, ''));
  const pick: Opt = sound === 'wood' ? { tool: 'axe', flammable: true } : { tool: 'pickaxe', harvestLevel: 0, requiresTool: true };
  stairs(base + '_stairs', baseName + ' Stairs', tex, hardness, sound, { ...pick, ...o });
  slab(base + '_slab', baseName + ' Slab', tex, hardness, sound, { ...pick, ...o });
  if (withWall) wall(base + '_wall', baseName + ' Wall', tex, hardness, { ...o });
}

// ---------------------------------------------------------------------------
// Air & technical
// ---------------------------------------------------------------------------
add({ id: 'air', name: 'Air', hardness: 0, sound: 'none', model: 'none', tex: {}, collide: false, replaceable: true, item: false, creative: 'hidden' });
add({ id: 'cave_air', name: 'Cave Air', hardness: 0, sound: 'none', model: 'none', tex: {}, collide: false, replaceable: true, item: false, creative: 'hidden' });
add({ id: 'barrier', name: 'Barrier', hardness: -1, resistance: 3600000, sound: 'stone', model: 'none', tex: { particle: 'barrier' }, collide: true, creative: 'hidden', layer: 'invisible' });

// ---------------------------------------------------------------------------
// Natural stone
// ---------------------------------------------------------------------------
stoneLike('stone', 1.5, { drops: { item: 'cobblestone', silkTouch: true }, tags: ['base_stone', 'stone_like'], mapColor: 0x707070 });
stoneLike('granite', 1.5, { tags: ['base_stone'] });
stoneLike('polished_granite', 1.5);
stoneLike('diorite', 1.5, { tags: ['base_stone'] });
stoneLike('polished_diorite', 1.5);
stoneLike('andesite', 1.5, { tags: ['base_stone'] });
stoneLike('polished_andesite', 1.5);
stoneLike('tuff', 1.5, { tags: ['base_stone'] });
stoneLike('calcite', 0.75);
add({
  id: 'deepslate',
  name: 'Deepslate',
  hardness: 3,
  resistance: 6,
  sound: 'deepslate',
  model: 'column',
  props: { axis: AXIS },
  tex: { top: 'deepslate_top', side: 'deepslate' },
  tool: 'pickaxe',
  harvestLevel: 0,
  requiresTool: true,
  drops: { item: 'cobbled_deepslate', silkTouch: true },
  tags: ['base_stone', 'deepslate_like'],
  mapColor: 0x464648,
});
stoneLike('cobbled_deepslate', 3.5, { sound: 'deepslate' });
stoneLike('polished_deepslate', 3.5, { sound: 'deepslate' });
stoneLike('deepslate_bricks', 3.5, { sound: 'deepslate' });
stoneLike('cracked_deepslate_bricks', 3.5, { sound: 'deepslate' });
stoneLike('deepslate_tiles', 3.5, { sound: 'deepslate' });
stoneLike('chiseled_deepslate', 3.5, { sound: 'deepslate' });
stoneLike('cobblestone', 2, { tags: ['stone_crafting'] });
stoneLike('mossy_cobblestone', 2);
stoneLike('smooth_stone', 2);
stoneLike('stone_bricks', 1.5, { tags: ['stone_bricks'] });
stoneLike('mossy_stone_bricks', 1.5);
stoneLike('cracked_stone_bricks', 1.5);
stoneLike('chiseled_stone_bricks', 1.5);
stoneLike('bricks', 2, { mapColor: 0x965a4a });
stoneLike('mud_bricks', 1.5, { sound: 'mud' });
add({ id: 'bedrock', name: 'Bedrock', hardness: -1, resistance: 3600000, sound: 'stone', model: 'cube', tex: { all: 'bedrock' }, drops: 'none', creative: 'building' });
stoneLike('obsidian', 50, { harvestLevel: 3, resistance: 1200, mapColor: 0x14121e });
stoneLike('crying_obsidian', 50, { harvestLevel: 3, resistance: 1200, light: 10 });
cube('dripstone_block', 1.5, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true });
add({
  id: 'pointed_dripstone',
  name: 'Pointed Dripstone',
  hardness: 1.5,
  sound: 'stone',
  model: 'dripstone',
  props: { vertical_direction: ['up', 'down'], thickness: ['tip', 'frustum', 'middle', 'base'] },
  tex: { all: 'pointed_dripstone' },
  tool: 'pickaxe',
  collide: true,
  contactDamage: 0,
});
cube('amethyst_block', 1.5, 'glass', { tool: 'pickaxe' });
// Crystal caves: budding blocks grow buds; lumen crystals are an original glowing crystal
cube('budding_amethyst', 1.5, 'glass', { tool: 'pickaxe', drops: 'none', randomTicks: true });
add({ id: 'amethyst_bud', name: 'Amethyst Bud', hardness: 1.5, sound: 'glass', model: 'cross', tex: { all: 'amethyst_bud' }, light: 2, tool: 'pickaxe', drops: { item: 'none', silkTouch: true } });
add({ id: 'lumen_crystal', name: 'Lumen Crystal', hardness: 1, sound: 'glass', model: 'cross', tex: { all: 'lumen_crystal' }, light: 12, tool: 'pickaxe', drops: { item: 'lumen_shard', min: 1, max: 3, fortune: true, silkTouch: true } });
// Frozen caves: icicles hang like dripstone and break when something lands on them
add({ id: 'icicle', name: 'Icicle', hardness: 0.5, sound: 'glass', model: 'dripstone', props: { vertical_direction: ['up', 'down'], thickness: ['tip', 'frustum', 'middle', 'base'] }, tex: { all: 'icicle' }, layer: 'translucent', collide: true, drops: { item: 'none', silkTouch: true } });
add({ id: 'amethyst_cluster', name: 'Amethyst Cluster', hardness: 1.5, sound: 'glass', model: 'cross', tex: { all: 'amethyst_cluster' }, light: 5, tool: 'pickaxe', drops: { item: 'amethyst_shard', min: 2, max: 4 } });

// ---------------------------------------------------------------------------
// Soil, sand, snow
// ---------------------------------------------------------------------------
add({
  id: 'grass_block',
  name: 'Grass Block',
  hardness: 0.6,
  sound: 'grass',
  model: 'cube',
  props: { snowy: BOOL },
  tex: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt', overlay: 'grass_block_side_overlay' },
  tool: 'shovel',
  tint: 'grass',
  drops: { item: 'dirt', silkTouch: true },
  tags: ['dirt', 'soil'],
  randomTicks: true,
  mapColor: 0x5d9e3a,
});
cube('dirt', 0.5, 'gravel', { tool: 'shovel', tags: ['dirt', 'soil'], mapColor: 0x866043 });
cube('coarse_dirt', 0.5, 'gravel', { tool: 'shovel', tags: ['dirt', 'soil'] });
cube('rooted_dirt', 0.5, 'gravel', { tool: 'shovel', tags: ['dirt', 'soil'] });
add({ id: 'podzol', name: 'Podzol', hardness: 0.5, sound: 'gravel', model: 'cube', props: { snowy: BOOL }, tex: { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' }, tool: 'shovel', drops: { item: 'dirt', silkTouch: true }, tags: ['dirt', 'soil'] });
add({ id: 'mycelium', name: 'Mycelium', hardness: 0.6, sound: 'grass', model: 'cube', props: { snowy: BOOL }, tex: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }, tool: 'shovel', drops: { item: 'dirt', silkTouch: true }, tags: ['dirt', 'soil'], randomTicks: true });
add({ id: 'dirt_path', name: 'Dirt Path', hardness: 0.65, sound: 'grass', model: 'path', tex: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' }, tool: 'shovel', drops: { item: 'dirt' }, layer: 'cutout' });
add({
  id: 'farmland',
  name: 'Farmland',
  hardness: 0.6,
  sound: 'gravel',
  model: 'farmland',
  props: { moisture: ['0', '1', '2', '3', '4', '5', '6', '7'] },
  tex: { top: 'farmland', side: 'dirt', bottom: 'dirt', top_moist: 'farmland_moist' },
  tool: 'shovel',
  drops: { item: 'dirt' },
  randomTicks: true,
  layer: 'cutout',
});
cube('mud', 0.5, 'mud', { tool: 'shovel', speedFactor: 0.8 });
cube('packed_mud', 1, 'mud', { tool: 'pickaxe' });
cube('clay', 0.6, 'gravel', { tool: 'shovel', drops: { item: 'clay_ball', min: 4, max: 4, silkTouch: true } });
cube('gravel', 0.6, 'gravel', { tool: 'shovel', gravity: true, drops: { item: 'gravel', extra: [{ item: 'flint', chance: 0.1 }] } });
cube('sand', 0.5, 'sand', { tool: 'shovel', gravity: true, tags: ['sand'], mapColor: 0xdbd3a0 });
cube('red_sand', 0.5, 'sand', { tool: 'shovel', gravity: true, tags: ['sand'] });
cube('suspicious_sand', 0.25, 'sand', { tool: 'shovel', gravity: true, drops: 'none' });
for (const s of ['sandstone', 'red_sandstone']) {
  add({ id: s, name: title(s), hardness: 0.8, sound: 'stone', model: 'cube', tex: { top: s + '_top', side: s, bottom: s + '_bottom' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true });
  add({ id: 'cut_' + s, name: 'Cut ' + title(s), hardness: 0.8, sound: 'stone', model: 'cube', tex: { top: s + '_top', side: 'cut_' + s, bottom: s + '_top' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true });
  add({ id: 'chiseled_' + s, name: 'Chiseled ' + title(s), hardness: 0.8, sound: 'stone', model: 'cube', tex: { top: s + '_top', side: 'chiseled_' + s, bottom: s + '_top' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true });
  stoneLike('smooth_' + s, 2, { tex: { all: s + '_top' } });
}
add({
  id: 'snow',
  name: 'Snow',
  hardness: 0.1,
  sound: 'snow',
  model: 'snow_layer',
  props: { layers: ['1', '2', '3', '4', '5', '6', '7', '8'] },
  tex: { all: 'snow' },
  tool: 'shovel',
  requiresTool: true,
  harvestLevel: 0,
  drops: { item: 'snowball' },
  replaceable: true,
  layer: 'cutout',
  randomTicks: true,
});
cube('snow_block', 0.2, 'snow', { tool: 'shovel', requiresTool: true, harvestLevel: 0, drops: { item: 'snowball', min: 4, max: 4 } });
cube('powder_snow', 0.25, 'snow', { tool: 'shovel', collide: false, speedFactor: 0.3, drops: 'none', layer: 'cutout' });
cube('ice', 0.5, 'glass', { tool: 'pickaxe', slipperiness: 0.98, layer: 'translucent', opacity: 2, drops: 'none', randomTicks: true, mapColor: 0xa0a0ff });
cube('packed_ice', 0.5, 'glass', { tool: 'pickaxe', slipperiness: 0.98, drops: { item: 'packed_ice', silkTouch: true } });
cube('blue_ice', 2.8, 'glass', { tool: 'pickaxe', slipperiness: 0.989, light: 0 });
cube('moss_block', 0.1, 'moss', { tool: 'hoe', tags: ['dirt', 'soil'] });
add({ id: 'moss_carpet', name: 'Moss Carpet', hardness: 0.1, sound: 'moss', model: 'carpet', tex: { all: 'moss_block' }, tool: 'hoe', place: 'needs_solid_below' });
cube('bone_block', 2, 'bone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tex: { top: 'bone_block_top', side: 'bone_block_side' } });

// Terracotta
cube('terracotta', 1.25, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x985e43 });
for (const c of COLORS) {
  cube(c + '_terracotta', 1.25, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tags: ['terracotta'] });
}

// ---------------------------------------------------------------------------
// Fluids
// ---------------------------------------------------------------------------
const LEVELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'] as const;
add({
  id: 'water',
  name: 'Water',
  hardness: 100,
  sound: 'liquid',
  model: 'liquid',
  props: { level: LEVELS },
  tex: { still: 'water_still', flow: 'water_flow', particle: 'water_still' },
  fluid: 'water',
  replaceable: true,
  collide: false,
  opacity: 2,
  tint: 'water',
  drops: 'none',
  item: false,
  creative: 'hidden',
  layer: 'translucent',
  mapColor: 0x3f76e4,
});
add({
  id: 'lava',
  name: 'Lava',
  hardness: 100,
  sound: 'liquid',
  model: 'liquid',
  props: { level: LEVELS },
  tex: { still: 'lava_still', flow: 'lava_flow', particle: 'lava_still' },
  fluid: 'lava',
  replaceable: true,
  collide: false,
  light: 15,
  opacity: 15,
  drops: 'none',
  item: false,
  creative: 'hidden',
  layer: 'opaque',
  mapColor: 0xd96415,
});

// ---------------------------------------------------------------------------
// Ores
// ---------------------------------------------------------------------------
interface OreSpec {
  id: string;
  level: number;
  drop: string;
  min?: number;
  max?: number;
  xp?: [number, number];
  fortune?: boolean;
}
const ORES: OreSpec[] = [
  { id: 'coal', level: 0, drop: 'coal', xp: [0, 2], fortune: true },
  { id: 'iron', level: 1, drop: 'raw_iron', fortune: true },
  { id: 'copper', level: 1, drop: 'raw_copper', min: 2, max: 5, fortune: true },
  { id: 'gold', level: 2, drop: 'raw_gold', fortune: true },
  { id: 'redstone', level: 2, drop: 'redstone', min: 4, max: 5, xp: [1, 5], fortune: true },
  { id: 'lapis', level: 1, drop: 'lapis_lazuli', min: 4, max: 9, xp: [2, 5], fortune: true },
  { id: 'diamond', level: 2, drop: 'diamond', xp: [3, 7], fortune: true },
  { id: 'emerald', level: 2, drop: 'emerald', xp: [3, 7], fortune: true },
];
for (const o of ORES) {
  for (const deep of [false, true]) {
    const id = (deep ? 'deepslate_' : '') + o.id + '_ore';
    const d: BlockDef = {
      id,
      name: title(id),
      hardness: deep ? 4.5 : 3,
      resistance: 3,
      sound: deep ? 'deepslate' : 'stone',
      model: 'cube',
      tex: { all: id },
      tool: 'pickaxe',
      harvestLevel: o.level,
      requiresTool: true,
      drops: { item: o.drop, min: o.min ?? 1, max: o.max ?? 1, silkTouch: true, fortune: o.fortune, xp: o.xp },
      tags: ['ore', o.id + '_ores'],
    };
    if (o.id === 'redstone') {
      d.props = { lit: BOOL };
      d.randomTicks = true;
    }
    add(d);
  }
}
stoneLike('nether_gold_ore', 3, { sound: 'netherrack', drops: { item: 'gold_nugget', min: 2, max: 6, xp: [0, 1], silkTouch: true, fortune: true }, tags: ['ore'] });
stoneLike('nether_quartz_ore', 3, { sound: 'netherrack', drops: { item: 'quartz', xp: [2, 5], silkTouch: true, fortune: true }, tags: ['ore'] });
add({
  id: 'ancient_debris',
  name: 'Ancient Debris',
  hardness: 30,
  resistance: 1200,
  sound: 'metal',
  model: 'cube',
  tex: { top: 'ancient_debris_top', side: 'ancient_debris_side' },
  tool: 'pickaxe',
  harvestLevel: 3,
  requiresTool: true,
  tags: ['ore'],
});
// Original ore: sunstone – found in badlands/desert deep layers; emits faint light
stoneLike('sunstone_ore', 3, { harvestLevel: 2, light: 4, drops: { item: 'sunstone_shard', min: 1, max: 2, xp: [2, 4], silkTouch: true, fortune: true }, tags: ['ore'] });

// Storage blocks
for (const [id, lvl] of [
  ['coal_block', 0],
  ['iron_block', 1],
  ['gold_block', 2],
  ['diamond_block', 2],
  ['emerald_block', 2],
  ['lapis_block', 1],
  ['redstone_block', 0],
  ['copper_block', 1],
  ['raw_iron_block', 1],
  ['raw_gold_block', 2],
  ['raw_copper_block', 1],
  ['netherite_block', 3],
  ['sunstone_block', 2],
  ['glitched_block', 4],
] as const) {
  stoneLike(id, id === 'netherite_block' ? 50 : 5, {
    sound: id === 'coal_block' ? 'stone' : 'metal',
    harvestLevel: lvl,
    tags: ['storage'],
    light: id === 'sunstone_block' ? 12 : id === 'glitched_block' ? 7 : 0,
    flammable: id === 'coal_block',
  });
}

// ---------------------------------------------------------------------------
// Wood
// ---------------------------------------------------------------------------
export const WOOD_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'] as const;
export type WoodType = (typeof WOOD_TYPES)[number];
const LEAF_TINT: Record<WoodType, TintKind> = {
  oak: 'foliage',
  spruce: 'spruce',
  birch: 'birch',
  jungle: 'foliage',
  acacia: 'foliage',
  dark_oak: 'foliage',
  mangrove: 'foliage',
  cherry: 'none',
};
const SAPLING_DROP_CHANCE = 0.05;

export interface WoodSetOptions {
  nether?: boolean;
  leaves?: boolean;
  tint?: TintKind;
  sapling?: boolean;
  /** The log's id when it is not `<w>_log` (V6 chorus stalks); such a set has no bark-covered "wood" blocks. */
  stem?: string;
  /** Creative tab of the whole set. */
  creative?: string;
  mapColor?: number;
}

function woodSet(w: string, opts: WoodSetOptions = {}): void {
  const nether = !!opts.nether;
  const log = opts.stem ?? (nether ? w + '_stem' : w + '_log');
  const wood = opts.stem ? null : nether ? w + '_hyphae' : w + '_wood';
  const sound: SoundGroup = nether ? 'nylium' : 'wood';
  const woodProps: Opt = { tool: 'axe', flammable: !nether, ...(opts.creative ? { creative: opts.creative } : {}) };
  column(log, 2, sound, { ...woodProps, tex: { top: log + '_top', side: log }, tags: ['logs', w + '_logs'], mapColor: opts.mapColor ?? 0x6b5132 });
  if (wood) column(wood, 2, sound, { ...woodProps, tex: { top: log, side: log }, tags: ['logs', w + '_logs'] });
  column('stripped_' + log, 2, sound, { ...woodProps, tex: { top: 'stripped_' + log + '_top', side: 'stripped_' + log }, tags: ['logs', w + '_logs'] });
  if (wood) column('stripped_' + wood, 2, sound, { ...woodProps, tex: { top: 'stripped_' + log, side: 'stripped_' + log }, tags: ['logs', w + '_logs'] });
  cube(w + '_planks', 2, sound, { ...woodProps, tags: ['planks'], mapColor: 0x9c7f4e });
  family(w + '_planks', w + '_planks', 2, sound, false, woodProps);
  // rename stairs/slab ids to be natural ("oak_stairs")
  const st = defs[defs.length - 2]!;
  const sl = defs[defs.length - 1]!;
  st.id = w + '_stairs';
  st.name = title(w) + ' Stairs';
  sl.id = w + '_slab';
  sl.name = title(w) + ' Slab';
  st.tags = ['stairs', 'wooden_stairs'];
  sl.tags = ['slab', 'wooden_slabs'];
  add({
    id: w + '_fence',
    name: title(w) + ' Fence',
    hardness: 2,
    sound,
    model: 'fence',
    props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL },
    tex: { all: w + '_planks' },
    ...woodProps,
    tags: ['fences', 'wooden_fences'],
  });
  add({
    id: w + '_fence_gate',
    name: title(w) + ' Fence Gate',
    hardness: 2,
    sound,
    model: 'fence_gate',
    props: { facing: FACING4, open: BOOL, in_wall: BOOL },
    tex: { all: w + '_planks' },
    ...woodProps,
    interact: 'fence_gate',
    tags: ['fence_gates'],
  });
  add({
    id: w + '_door',
    name: title(w) + ' Door',
    hardness: 3,
    sound,
    model: 'door',
    props: { facing: FACING4, half: ['lower', 'upper'], open: BOOL, hinge: ['left', 'right'] },
    tex: { top: w + '_door_top', bottom: w + '_door_bottom', particle: w + '_door_bottom' },
    ...woodProps,
    interact: 'door',
    tags: ['doors', 'wooden_doors'],
    item: true,
  });
  add({
    id: w + '_trapdoor',
    name: title(w) + ' Trapdoor',
    hardness: 3,
    sound,
    model: 'trapdoor',
    props: { facing: FACING4, half: ['bottom', 'top'], open: BOOL },
    tex: { all: w + '_trapdoor' },
    ...woodProps,
    interact: 'trapdoor',
    tags: ['trapdoors'],
  });
  add({
    id: w + '_button',
    name: title(w) + ' Button',
    hardness: 0.5,
    sound,
    model: 'button',
    props: { face: ['floor', 'wall', 'ceiling'], facing: FACING4, powered: BOOL },
    tex: { all: w + '_planks' },
    interact: 'button',
    tags: ['buttons'],
  });
  add({
    id: w + '_pressure_plate',
    name: title(w) + ' Pressure Plate',
    hardness: 0.5,
    sound,
    model: 'pressure_plate',
    props: { powered: BOOL },
    tex: { all: w + '_planks' },
    place: 'needs_solid_below',
  });
  if (opts.leaves !== false && !nether) {
    add({
      id: w + '_leaves',
      name: title(w) + ' Leaves',
      hardness: 0.2,
      sound: 'grass',
      model: 'cube',
      props: { distance: ['1', '2', '3', '4', '5', '6', '7'], persistent: BOOL },
      defaults: { distance: '7', persistent: 'true' },
      tex: { all: w + '_leaves' },
      layer: 'cutout',
      opacity: 1,
      tint: opts.tint ?? 'foliage',
      tool: 'hoe',
      flammable: true,
      randomTicks: true,
      drops: {
        item: 'none',
        silkTouch: true,
        extra: [
          { item: w + '_sapling', chance: w === 'jungle' ? 0.025 : SAPLING_DROP_CHANCE },
          { item: 'stick', chance: 0.02, min: 1, max: 2 },
          ...(w === 'oak' || w === 'dark_oak' ? [{ item: 'apple', chance: 0.005 }] : []),
        ],
      },
      tags: ['leaves'],
      mapColor: 0x3f7e1e,
    });
  }
  if (opts.sapling !== false && !nether) {
    add({
      id: w + '_sapling',
      name: title(w) + ' Sapling',
      hardness: 0,
      sound: 'plant',
      model: 'cross',
      props: { stage: ['0', '1'] },
      tex: { all: w + '_sapling' },
      place: 'needs_soil',
      randomTicks: true,
      tags: ['saplings'],
    });
  }
}
for (const w of WOOD_TYPES) woodSet(w, { tint: LEAF_TINT[w] });
woodSet('crimson', { nether: true });
woodSet('warped', { nether: true });
// Farlands wood (original)
woodSet('null', { tint: 'none' });

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------
function plant(id: string, o: Opt = {}): BlockDef {
  return add({
    id,
    name: o.name ?? title(id),
    hardness: 0,
    sound: 'plant',
    model: 'cross',
    tex: { all: id },
    replaceable: false,
    place: 'needs_soil',
    flammable: true,
    ...o,
  });
}
plant('short_grass', { replaceable: true, tint: 'grass', drops: { item: 'none', extra: [{ item: 'wheat_seeds', chance: 0.125 }], silkTouch: true } });
plant('fern', { replaceable: true, tint: 'grass', drops: { item: 'none', extra: [{ item: 'wheat_seeds', chance: 0.125 }], silkTouch: true } });
plant('dead_bush', { replaceable: true, place: 'needs_sand', drops: { item: 'stick', min: 0, max: 2 } });
for (const f of [
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'glowbell', // original: faintly glowing flower in dark forests
]) {
  plant(f, { tags: ['flowers', 'small_flowers'], light: f === 'glowbell' ? 7 : 0 });
}
for (const f of ['tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony']) {
  add({
    id: f,
    name: title(f),
    hardness: 0,
    sound: 'plant',
    model: 'double_plant',
    props: { half: ['lower', 'upper'] },
    tex: { bottom: f + '_bottom', top: f + '_top' },
    tint: f === 'tall_grass' || f === 'large_fern' ? 'grass' : 'none',
    replaceable: f === 'tall_grass' || f === 'large_fern',
    place: 'needs_soil',
    flammable: true,
    tags: f === 'tall_grass' || f === 'large_fern' ? [] : ['flowers'],
    drops: f === 'tall_grass' || f === 'large_fern' ? { item: 'none', extra: [{ item: 'wheat_seeds', chance: 0.125 }] } : undefined,
  });
}
plant('brown_mushroom', { place: 'standing', light: 1, tags: ['mushrooms'] });
plant('red_mushroom', { place: 'standing', tags: ['mushrooms'] });
plant('crimson_fungus', { place: 'needs_nylium' });
plant('warped_fungus', { place: 'needs_nylium' });
plant('crimson_roots', { place: 'needs_nylium', replaceable: true });
plant('warped_roots', { place: 'needs_nylium', replaceable: true });
plant('nether_sprouts', { place: 'needs_nylium', replaceable: true });
for (const m of ['brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem']) {
  add({ id: m, name: title(m), hardness: 0.2, sound: 'wood', model: 'cube', tex: { all: m, inside: 'mushroom_block_inside' }, tool: 'axe', drops: m === 'mushroom_stem' ? 'none' : { item: m.replace('_block', ''), min: 0, max: 2, silkTouch: true } });
}
add({ id: 'lily_pad', name: 'Lily Pad', hardness: 0, sound: 'plant', model: 'lily_pad', tex: { all: 'lily_pad' }, tint: 'lily', place: 'needs_water_surface' });
add({
  id: 'vine',
  name: 'Vines',
  hardness: 0.2,
  sound: 'plant',
  model: 'vine',
  props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL, up: BOOL },
  tex: { all: 'vine' },
  tint: 'foliage',
  climbable: true,
  replaceable: true,
  tool: 'shears',
  drops: { item: 'none', silkTouch: true },
  randomTicks: true,
  flammable: true,
});
add({ id: 'glow_lichen', name: 'Glow Lichen', hardness: 0.2, sound: 'plant', model: 'vine', props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL, up: BOOL, down: BOOL }, tex: { all: 'glow_lichen' }, light: 7, replaceable: true, drops: { item: 'none', silkTouch: true } });
add({ id: 'sugar_cane', name: 'Sugar Cane', hardness: 0, sound: 'plant', model: 'cross', props: { age: LEVELS }, tex: { all: 'sugar_cane' }, tint: 'grass', randomTicks: true, place: 'standing', drops: { item: 'sugar_cane' } });
add({ id: 'cactus', name: 'Cactus', hardness: 0.4, sound: 'wool', model: 'cactus', props: { age: LEVELS }, tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_bottom' }, randomTicks: true, contactDamage: 1, place: 'needs_sand' });
add({ id: 'bamboo', name: 'Bamboo', hardness: 1, sound: 'wood', model: 'rod', props: { age: ['0', '1'] }, tex: { all: 'bamboo_stalk', top: 'bamboo_top' }, tool: 'axe', randomTicks: true, place: 'standing' });
add({ id: 'seagrass', name: 'Seagrass', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'seagrass' }, replaceable: true, drops: { item: 'none', silkTouch: true }, fluid: 'water', opacity: 2 });
add({ id: 'kelp', name: 'Kelp', hardness: 0, sound: 'plant', model: 'cross', props: { age: ['0', '1'] }, tex: { all: 'kelp' }, fluid: 'water', opacity: 2, drops: { item: 'kelp' }, randomTicks: true });
add({ id: 'sweet_berry_bush', name: 'Sweet Berry Bush', hardness: 0, sound: 'plant', model: 'cross', props: { age: ['0', '1', '2', '3'] }, tex: { all: 'sweet_berry_bush' }, randomTicks: true, speedFactor: 0.8, drops: { item: 'sweet_berries' }, place: 'needs_soil', item: false });
add({ id: 'azalea', name: 'Azalea', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'azalea' }, place: 'needs_soil' });
add({ id: 'cave_vines', name: 'Cave Vines', hardness: 0, sound: 'plant', model: 'hanging_plant', props: { berries: BOOL }, tex: { all: 'cave_vines', lit: 'cave_vines_lit' }, climbable: true, drops: { item: 'glow_berries', min: 0, max: 1 }, item: false });
add({ id: 'hanging_roots', name: 'Hanging Roots', hardness: 0, sound: 'plant', model: 'hanging_plant', tex: { all: 'hanging_roots' }, replaceable: true, drops: { item: 'none', silkTouch: true } });
// Lush caves: dripleaves grow out of water-side clay and moss
add({ id: 'big_dripleaf', name: 'Big Dripleaf', hardness: 0.1, sound: 'plant', model: 'custom', props: { facing: FACING4, tilt: ['none', 'partial', 'full'] }, tex: { top: 'big_dripleaf_top', side: 'big_dripleaf_side', stem: 'big_dripleaf_stem' }, collide: true, layer: 'cutout', tool: 'axe', place: 'needs_solid_below' });
add({ id: 'big_dripleaf_stem', name: 'Big Dripleaf Stem', hardness: 0.1, sound: 'plant', model: 'cross', tex: { all: 'big_dripleaf_stem' }, drops: { item: 'big_dripleaf' }, item: false });
add({ id: 'small_dripleaf', name: 'Small Dripleaf', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'small_dripleaf' }, place: 'needs_solid_below', drops: { item: 'none', silkTouch: true } });
// Mushroom caves (original): glowing mushrooms, small and giant
add({ id: 'glowshroom', name: 'Glowshroom', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'glowshroom' }, light: 10, place: 'needs_solid_below' });
cube('glowshroom_block', 0.2, 'wood', { light: 13, tool: 'axe', drops: { item: 'glowshroom', min: 0, max: 2, silkTouch: true } });
add({ id: 'spore_blossom', name: 'Spore Blossom', hardness: 0, sound: 'plant', model: 'hanging_plant', tex: { all: 'spore_blossom' }, light: 0 });
add({ id: 'weeping_vines', name: 'Weeping Vines', hardness: 0, sound: 'plant', model: 'hanging_plant', tex: { all: 'weeping_vines' }, climbable: true });
add({ id: 'twisting_vines', name: 'Twisting Vines', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'twisting_vines' }, climbable: true });
add({ id: 'cobweb', name: 'Cobweb', hardness: 4, sound: 'wool', model: 'cross', tex: { all: 'cobweb' }, tool: 'sword', speedFactor: 0.05, collide: false, drops: { item: 'string', silkTouch: true }, opacity: 1 });
add({ id: 'pumpkin', name: 'Pumpkin', hardness: 1, sound: 'wood', model: 'cube', tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, tool: 'axe' });
add({ id: 'carved_pumpkin', name: 'Carved Pumpkin', hardness: 1, sound: 'wood', model: 'cube', props: { facing: FACING4 }, tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin' }, tool: 'axe' });
add({ id: 'jack_o_lantern', name: "Jack o'Lantern", hardness: 1, sound: 'wood', model: 'cube', props: { facing: FACING4 }, tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, tool: 'axe', light: 15 });
add({ id: 'melon', name: 'Melon', hardness: 1, sound: 'wood', model: 'cube', tex: { top: 'melon_top', side: 'melon_side' }, tool: 'axe', drops: { item: 'melon_slice', min: 3, max: 7, silkTouch: true } });
cube('hay_block', 0.5, 'grass', { tool: 'hoe', tex: { top: 'hay_block_top', side: 'hay_block_side' } });
add({ id: 'hay_bale', name: 'Hay Bale', hardness: 0.5, sound: 'grass', model: 'column', props: { axis: AXIS }, tex: { top: 'hay_block_top', side: 'hay_block_side' }, tool: 'hoe', creative: 'hidden', item: false });

// Crops
function crop(id: string, stages: number, drop: string, seed: string, o: Opt = {}): void {
  const ages = Array.from({ length: stages }, (_, i) => String(i));
  add({
    id,
    name: title(id),
    hardness: 0,
    sound: 'crop',
    model: 'crop',
    props: { age: ages },
    tex: { all: id + '_stage' },
    place: 'needs_farmland',
    randomTicks: true,
    drops: { table: 'crop_' + id },
    item: false,
    data: { maxAge: stages - 1, drop, seed },
    ...o,
  });
}
crop('wheat', 8, 'wheat', 'wheat_seeds');
crop('carrots', 4, 'carrot', 'carrot');
crop('potatoes', 4, 'potato', 'potato');
crop('beetroots', 4, 'beetroot', 'beetroot_seeds');
crop('sunroot', 4, 'sunroot', 'sunroot_seeds'); // original crop
// Stems grow for 8 stages, then set a melon or pumpkin on free ground beside them
crop('melon_stem', 8, 'melon_seeds', 'melon_seeds', { tex: { all: 'stem_stage' }, drops: { item: 'melon_seeds' }, data: { maxAge: 7, drop: 'melon_seeds', seed: 'melon_seeds', fruit: 'melon' } });
crop('pumpkin_stem', 8, 'pumpkin_seeds', 'pumpkin_seeds', { tex: { all: 'stem_stage' }, drops: { item: 'pumpkin_seeds' }, data: { maxAge: 7, drop: 'pumpkin_seeds', seed: 'pumpkin_seeds', fruit: 'pumpkin' } });
add({ id: 'nether_wart', name: 'Nether Wart', hardness: 0, sound: 'crop', model: 'crop', props: { age: ['0', '1', '2', '3'] }, tex: { all: 'nether_wart_stage' }, place: 'needs_soul_sand', randomTicks: true, drops: { table: 'crop_nether_wart' }, item: false, data: { maxAge: 3, drop: 'nether_wart', seed: 'nether_wart' } });

// ---------------------------------------------------------------------------
// Glass, wool, decoration
// ---------------------------------------------------------------------------
cube('glass', 0.3, 'glass', { layer: 'cutout', drops: { item: 'none', silkTouch: true }, tags: ['glass'] });
add({ id: 'glass_pane', name: 'Glass Pane', hardness: 0.3, sound: 'glass', model: 'pane', props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL }, tex: { all: 'glass', edge: 'glass_pane_top' }, layer: 'cutout', drops: { item: 'none', silkTouch: true } });
add({ id: 'iron_bars', name: 'Iron Bars', hardness: 5, sound: 'metal', model: 'pane', props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL }, tex: { all: 'iron_bars', edge: 'iron_bars' }, layer: 'cutout', tool: 'pickaxe', harvestLevel: 0, requiresTool: true });
cube('tinted_glass', 0.3, 'glass', { layer: 'translucent', opacity: 15 });
for (const c of COLORS) {
  cube(c + '_wool', 0.8, 'wool', { tool: 'shears', flammable: true, tags: ['wool'] });
  add({ id: c + '_carpet', name: title(c) + ' Carpet', hardness: 0.1, sound: 'wool', model: 'carpet', tex: { all: c + '_wool' }, flammable: true, tags: ['carpets'], place: 'needs_solid_below' });
  cube(c + '_stained_glass', 0.3, 'glass', { layer: 'translucent', drops: { item: 'none', silkTouch: true }, tags: ['stained_glass'] });
  cube(c + '_concrete', 1.8, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tags: ['concrete'] });
  add({
    id: c + '_bed',
    name: title(c) + ' Bed',
    hardness: 0.2,
    sound: 'wood',
    model: 'bed',
    props: { facing: FACING4, part: ['foot', 'head'], occupied: BOOL },
    tex: { all: c + '_wool', particle: c + '_wool' },
    interact: 'bed',
    tags: ['beds'],
    data: { color: c },
  });
}
cube('bookshelf', 1.5, 'wood', { tool: 'axe', tex: { top: 'oak_planks', side: 'bookshelf' }, drops: { item: 'book', min: 3, max: 3, silkTouch: true }, flammable: true });
cube('sponge', 0.6, 'grass', { tool: 'hoe' });
cube('wet_sponge', 0.6, 'grass', { tool: 'hoe' });
cube('slime_block', 0, 'mud', { layer: 'translucent', data: { bounce: true } });
cube('honey_block', 0, 'mud', { layer: 'translucent', speedFactor: 0.4 });
cube('sea_lantern', 0.3, 'glass', { light: 15, drops: { item: 'prismarine_crystals', min: 2, max: 3, silkTouch: true } });
cube('glowstone', 0.3, 'glass', { light: 15, drops: { item: 'glowstone_dust', min: 2, max: 4, silkTouch: true, fortune: true } });
cube('shroomlight', 1, 'nylium', { light: 15, tool: 'hoe' });
add({ id: 'tnt', name: 'TNT', hardness: 0, sound: 'grass', model: 'cube', props: { unstable: BOOL }, tex: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, flammable: true });
add({ id: 'ladder', name: 'Ladder', hardness: 0.4, sound: 'wood', model: 'ladder', props: { facing: FACING4 }, tex: { all: 'ladder' }, climbable: true, tool: 'axe', place: 'wall' });
add({ id: 'scaffolding', name: 'Scaffolding', hardness: 0, sound: 'wood', model: 'custom', tex: { top: 'scaffolding_top', side: 'scaffolding_side', bottom: 'scaffolding_bottom' }, climbable: true, collide: true });
add({ id: 'chain', name: 'Chain', hardness: 5, sound: 'metal', model: 'chain', props: { axis: AXIS }, tex: { all: 'chain' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true });

// Light sources
add({ id: 'torch', name: 'Torch', hardness: 0, sound: 'wood', model: 'torch', tex: { all: 'torch' }, light: 14, place: 'needs_solid_below', drops: { item: 'torch' } });
add({ id: 'wall_torch', name: 'Wall Torch', hardness: 0, sound: 'wood', model: 'wall_torch', props: { facing: FACING4 }, tex: { all: 'torch' }, light: 14, drops: { item: 'torch' }, item: false, creative: 'hidden' });
add({ id: 'soul_torch', name: 'Soul Torch', hardness: 0, sound: 'wood', model: 'torch', tex: { all: 'soul_torch' }, light: 10, place: 'needs_solid_below', drops: { item: 'soul_torch' } });
add({ id: 'soul_wall_torch', name: 'Soul Wall Torch', hardness: 0, sound: 'wood', model: 'wall_torch', props: { facing: FACING4 }, tex: { all: 'soul_torch' }, light: 10, drops: { item: 'soul_torch' }, item: false, creative: 'hidden' });
add({ id: 'lantern', name: 'Lantern', hardness: 3.5, sound: 'metal', model: 'lantern', props: { hanging: BOOL }, tex: { all: 'lantern' }, light: 15, tool: 'pickaxe' });
add({ id: 'soul_lantern', name: 'Soul Lantern', hardness: 3.5, sound: 'metal', model: 'lantern', props: { hanging: BOOL }, tex: { all: 'soul_lantern' }, light: 10, tool: 'pickaxe' });
add({ id: 'end_rod', name: 'End Rod', hardness: 0, sound: 'wood', model: 'rod', props: { facing: ['up', 'down', 'north', 'south', 'west', 'east'] }, tex: { all: 'end_rod' }, light: 14 });
add({ id: 'campfire', name: 'Campfire', hardness: 2, sound: 'wood', model: 'campfire', props: { lit: BOOL, facing: FACING4 }, defaults: { lit: 'true' }, tex: { log: 'campfire_log', fire: 'campfire_fire' }, light: 15, contactDamage: 1, tool: 'axe', entity: 'campfire', drops: { item: 'charcoal', min: 2, max: 2, silkTouch: true } });
add({ id: 'fire', name: 'Fire', hardness: 0, sound: 'none', model: 'fire', props: { age: LEVELS }, tex: { all: 'fire' }, light: 15, contactDamage: 1, replaceable: true, drops: 'none', item: false, creative: 'hidden', randomTicks: true });
add({ id: 'soul_fire', name: 'Soul Fire', hardness: 0, sound: 'none', model: 'fire', tex: { all: 'soul_fire' }, light: 10, contactDamage: 2, replaceable: true, drops: 'none', item: false, creative: 'hidden' });

// ---------------------------------------------------------------------------
// Functional blocks
// ---------------------------------------------------------------------------
add({ id: 'crafting_table', name: 'Crafting Table', hardness: 2.5, sound: 'wood', model: 'cube', tex: { top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front', bottom: 'oak_planks' }, tool: 'axe', interact: 'crafting', flammable: true });
for (const f of ['furnace', 'blast_furnace', 'smoker']) {
  add({
    id: f,
    name: title(f),
    hardness: 3.5,
    sound: 'stone',
    model: 'cube',
    props: { facing: FACING4, lit: BOOL },
    tex: { top: f + '_top', side: f + '_side', front: f + '_front', front_lit: f + '_front_on', bottom: f + '_top' },
    tool: 'pickaxe',
    harvestLevel: 0,
    requiresTool: true,
    entity: 'furnace',
    interact: f === 'furnace' ? 'furnace' : f === 'blast_furnace' ? 'blast_furnace' : 'smoker',
  });
}
add({ id: 'chest', name: 'Chest', hardness: 2.5, sound: 'wood', model: 'chest', props: { facing: FACING4, type: ['single', 'left', 'right'] }, tex: { all: 'chest', particle: 'oak_planks' }, tool: 'axe', entity: 'chest', interact: 'chest', flammable: true });
add({ id: 'trapped_chest', name: 'Trapped Chest', hardness: 2.5, sound: 'wood', model: 'chest', props: { facing: FACING4, type: ['single', 'left', 'right'] }, tex: { all: 'trapped_chest', particle: 'oak_planks' }, tool: 'axe', entity: 'chest', interact: 'chest' });
add({ id: 'ender_chest', name: 'Ender Chest', hardness: 22.5, resistance: 600, sound: 'stone', model: 'chest', props: { facing: FACING4 }, tex: { all: 'ender_chest', particle: 'obsidian' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, entity: 'ender_chest', interact: 'ender_chest', light: 7, drops: { item: 'obsidian', min: 8, max: 8, silkTouch: true } });
add({ id: 'barrel', name: 'Barrel', hardness: 2.5, sound: 'wood', model: 'cube', props: { facing: ['up', 'down', 'north', 'south', 'west', 'east'], open: BOOL }, tex: { top: 'barrel_top', side: 'barrel_side', bottom: 'barrel_bottom' }, tool: 'axe', entity: 'barrel', interact: 'barrel' });
add({ id: 'enchanting_table', name: 'Enchanting Table', hardness: 5, resistance: 1200, sound: 'stone', model: 'enchanting_table', tex: { top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'enchanting_table_bottom' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, light: 7, entity: 'enchanting_table', interact: 'enchanting' });
for (const a of ['anvil', 'chipped_anvil', 'damaged_anvil']) {
  add({ id: a, name: title(a), hardness: 5, resistance: 1200, sound: 'metal', model: 'anvil', props: { facing: FACING4 }, tex: { all: 'anvil', top: a + '_top' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, gravity: true, interact: 'anvil', tags: ['anvil'] });
}
add({ id: 'brewing_stand', name: 'Brewing Stand', hardness: 0.5, sound: 'metal', model: 'brewing_stand', tex: { all: 'brewing_stand', base: 'brewing_stand_base' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, light: 1, entity: 'brewing_stand', interact: 'brewing' });
add({ id: 'smithing_table', name: 'Smithing Table', hardness: 2.5, sound: 'wood', model: 'cube', tex: { top: 'smithing_table_top', side: 'smithing_table_side', front: 'smithing_table_front', bottom: 'smithing_table_bottom' }, tool: 'axe', interact: 'smithing' });
add({ id: 'stonecutter', name: 'Stonecutter', hardness: 3.5, sound: 'stone', model: 'custom', props: { facing: FACING4 }, tex: { top: 'stonecutter_top', side: 'stonecutter_side', bottom: 'stonecutter_bottom' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, interact: 'stonecutter', collide: true, layer: 'cutout' });
add({ id: 'cauldron', name: 'Cauldron', hardness: 2, sound: 'metal', model: 'cauldron', props: { level: ['0', '1', '2', '3'] }, tex: { all: 'cauldron_side', top: 'cauldron_top', inner: 'cauldron_inner' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, interact: 'cauldron' });
add({ id: 'composter', name: 'Composter', hardness: 0.6, sound: 'wood', model: 'cauldron', props: { level: ['0', '1', '2', '3', '4', '5', '6', '7', '8'] }, tex: { all: 'composter_side', top: 'composter_top', inner: 'composter_bottom' }, tool: 'axe', interact: 'composter' });
add({ id: 'jukebox', name: 'Jukebox', hardness: 2, sound: 'wood', model: 'cube', props: { has_record: BOOL }, tex: { top: 'jukebox_top', side: 'jukebox_side' }, tool: 'axe', entity: 'jukebox', interact: 'jukebox' });
add({ id: 'note_block', name: 'Note Block', hardness: 0.8, sound: 'wood', model: 'cube', tex: { all: 'note_block' }, tool: 'axe', interact: 'note_block' });
add({ id: 'sign', name: 'Sign', hardness: 1, sound: 'wood', model: 'sign', props: { rotation: LEVELS }, tex: { all: 'oak_planks' }, tool: 'axe', entity: 'sign', interact: 'sign', drops: { item: 'sign' } });
add({ id: 'wall_sign', name: 'Wall Sign', hardness: 1, sound: 'wood', model: 'wall_sign', props: { facing: FACING4 }, tex: { all: 'oak_planks' }, tool: 'axe', entity: 'sign', interact: 'sign', drops: { item: 'sign' }, item: false, creative: 'hidden' });
add({ id: 'lever', name: 'Lever', hardness: 0.5, sound: 'wood', model: 'lever', props: { face: ['floor', 'wall', 'ceiling'], facing: FACING4, powered: BOOL }, tex: { all: 'lever', base: 'cobblestone' }, interact: 'lever' });
add({ id: 'stone_button', name: 'Stone Button', hardness: 0.5, sound: 'stone', model: 'button', props: { face: ['floor', 'wall', 'ceiling'], facing: FACING4, powered: BOOL }, tex: { all: 'stone' }, interact: 'button' });
// Redstone: dust carries power (0-15) between sources and the things it switches
const WIRE_SIDE = ['none', 'side', 'up'] as const;
add({ id: 'redstone_wire', name: 'Redstone Dust', hardness: 0, sound: 'stone', model: 'custom', props: { north: WIRE_SIDE, south: WIRE_SIDE, west: WIRE_SIDE, east: WIRE_SIDE, power: LEVELS }, tex: { all: 'redstone_dust_line', dot: 'redstone_dust_dot', on: 'redstone_dust_line_on', on_dot: 'redstone_dust_dot_on', particle: 'redstone_dust_dot' }, collide: false, layer: 'cutout', place: 'needs_solid_below', drops: { item: 'redstone' }, item: false, creative: 'hidden', tags: ['redstone'] });
add({ id: 'redstone_torch', name: 'Redstone Torch', hardness: 0, sound: 'wood', model: 'torch', props: { lit: BOOL }, defaults: { lit: 'true' }, tex: { all: 'redstone_torch', off: 'redstone_torch_off' }, light: 7, place: 'needs_solid_below', drops: { item: 'redstone_torch' }, tags: ['redstone'] });
add({ id: 'redstone_wall_torch', name: 'Redstone Wall Torch', hardness: 0, sound: 'wood', model: 'wall_torch', props: { facing: FACING4, lit: BOOL }, defaults: { lit: 'true' }, tex: { all: 'redstone_torch', off: 'redstone_torch_off' }, light: 7, drops: { item: 'redstone_torch' }, item: false, creative: 'hidden', tags: ['redstone'] });
add({ id: 'redstone_lamp', name: 'Redstone Lamp', hardness: 0.3, sound: 'glass', model: 'cube', props: { lit: BOOL }, tex: { all: 'redstone_lamp', on: 'redstone_lamp_on' }, light: 15, tags: ['redstone'] });
add({ id: 'stone_pressure_plate', name: 'Stone Pressure Plate', hardness: 0.5, sound: 'stone', model: 'pressure_plate', props: { powered: BOOL }, tex: { all: 'stone' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, place: 'needs_solid_below' });
add({ id: 'iron_door', name: 'Iron Door', hardness: 5, sound: 'metal', model: 'door', props: { facing: FACING4, half: ['lower', 'upper'], open: BOOL, hinge: ['left', 'right'] }, tex: { top: 'iron_door_top', bottom: 'iron_door_bottom', particle: 'iron_door_bottom' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tags: ['doors'] });
add({ id: 'iron_trapdoor', name: 'Iron Trapdoor', hardness: 5, sound: 'metal', model: 'trapdoor', props: { facing: FACING4, half: ['bottom', 'top'], open: BOOL }, tex: { all: 'iron_trapdoor' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tags: ['trapdoors'] });
add({ id: 'spawner', name: 'Monster Spawner', hardness: 5, sound: 'metal', model: 'cube', tex: { all: 'spawner' }, layer: 'cutout', tool: 'pickaxe', harvestLevel: 0, requiresTool: true, entity: 'spawner', drops: { item: 'none', xp: [15, 43] }, creative: 'hidden' });
add({ id: 'bell', name: 'Bell', hardness: 5, sound: 'metal', model: 'lantern', props: { hanging: BOOL }, tex: { all: 'bell' }, tool: 'pickaxe', interact: 'bell' });
add({ id: 'beacon', name: 'Beacon', hardness: 3, sound: 'glass', model: 'cube', tex: { all: 'beacon' }, light: 15, layer: 'cutout', interact: 'beacon', entity: 'beacon' });
add({ id: 'respawn_anchor', name: 'Respawn Anchor', hardness: 50, sound: 'stone', model: 'cube', props: { charges: ['0', '1', '2', '3', '4'] }, tex: { top: 'respawn_anchor_top', side: 'respawn_anchor_side', bottom: 'respawn_anchor_bottom' }, tool: 'pickaxe', harvestLevel: 3, requiresTool: true, interact: 'respawn_anchor' });
add({ id: 'lodestone', name: 'Lodestone', hardness: 3.5, sound: 'stone', model: 'cube', tex: { top: 'lodestone_top', side: 'lodestone_side' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true });
add({ id: 'cake', name: 'Cake', hardness: 0.5, sound: 'wool', model: 'custom', props: { bites: ['0', '1', '2', '3', '4', '5', '6'] }, tex: { top: 'cake_top', side: 'cake_side', bottom: 'cake_bottom', inner: 'cake_inner' }, interact: 'cake', drops: 'none', collide: true, layer: 'cutout' });
// Candles: up to four on one block, lit with flint and steel
add({ id: 'candle', name: 'Candle', hardness: 0.1, sound: 'wool', model: 'custom', props: { candles: ['1', '2', '3', '4'], lit: BOOL }, tex: { all: 'candle', lit: 'candle_lit' }, light: 12, collide: true, layer: 'cutout', place: 'needs_solid_below', interact: 'candle' });
cube('honeycomb_block', 0.6, 'wool', { tex: { all: 'honeycomb_block' } });
// Froglights: what a frog makes of a small magma cube, a colour for each kind of frog
for (const f of ['ochre', 'verdant', 'pearlescent']) add({ id: `${f}_froglight`, name: `${f[0]!.toUpperCase()}${f.slice(1)} Froglight`, hardness: 0.3, sound: 'wool', model: 'column', props: { axis: ['x', 'y', 'z'] }, defaults: { axis: 'y' }, tex: { top: `${f}_froglight_top`, side: `${f}_froglight_side` }, light: 15 });
// Portable storage: keeps its contents when broken
add({ id: 'shulker_box', name: 'Shulker Box', hardness: 2, sound: 'stone', model: 'cube', props: { facing: ['up', 'down', 'north', 'south', 'west', 'east'] }, defaults: { facing: 'up' }, tex: { top: 'shulker_box_top', side: 'shulker_box_side', bottom: 'shulker_box_bottom' }, tool: 'pickaxe', entity: 'barrel', interact: 'barrel', drops: 'none' });
// Conduit: in water inside a prismarine frame it lets divers breathe and see
add({ id: 'conduit', name: 'Conduit', hardness: 3, sound: 'glass', model: 'custom', tex: { all: 'conduit' }, light: 15, collide: true, layer: 'cutout', tool: 'pickaxe', entity: 'conduit' });
/** Plants a flower pot can hold. */
export const POTTABLE = ['none', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'red_mushroom', 'brown_mushroom', 'fern', 'dead_bush', 'glowbell'] as const;
add({ id: 'flower_pot', name: 'Flower Pot', hardness: 0, sound: 'stone', model: 'custom', props: { plant: POTTABLE }, tex: { all: 'flower_pot' }, collide: true, layer: 'cutout', interact: 'flower_pot' });

// Stairs / slabs / walls for stone materials
family('cobblestone', 'cobblestone', 2, 'stone', true);
family('stone', 'stone', 1.5, 'stone', false);
family('stone_bricks', 'stone_bricks', 1.5, 'stone', true);
family('mossy_cobblestone', 'mossy_cobblestone', 2, 'stone', true);
family('mossy_stone_bricks', 'mossy_stone_bricks', 1.5, 'stone', true);
family('smooth_stone', 'smooth_stone', 2, 'stone', false);
family('bricks', 'bricks', 2, 'stone', true);
family('sandstone', 'sandstone', 0.8, 'stone', true);
family('red_sandstone', 'red_sandstone', 0.8, 'stone', true);
family('granite', 'granite', 1.5, 'stone', true);
family('diorite', 'diorite', 1.5, 'stone', true);
family('andesite', 'andesite', 1.5, 'stone', true);
family('polished_granite', 'polished_granite', 1.5, 'stone', false);
family('polished_diorite', 'polished_diorite', 1.5, 'stone', false);
family('polished_andesite', 'polished_andesite', 1.5, 'stone', false);
family('cobbled_deepslate', 'cobbled_deepslate', 3.5, 'deepslate', true);
family('deepslate_bricks', 'deepslate_bricks', 3.5, 'deepslate', true);
family('deepslate_tiles', 'deepslate_tiles', 3.5, 'deepslate', true);
family('polished_deepslate', 'polished_deepslate', 3.5, 'deepslate', true);
family('mud_bricks', 'mud_bricks', 1.5, 'mud', true);

// ---------------------------------------------------------------------------
// Ocean
// ---------------------------------------------------------------------------
stoneLike('prismarine', 1.5);
stoneLike('prismarine_bricks', 1.5);
stoneLike('dark_prismarine', 1.5);
family('prismarine', 'prismarine', 1.5, 'stone', true);
family('prismarine_bricks', 'prismarine_bricks', 1.5, 'stone', false);
family('dark_prismarine', 'dark_prismarine', 1.5, 'stone', false);
for (const c of ['tube', 'brain', 'bubble', 'fire', 'horn']) {
  stoneLike(c + '_coral_block', 1.5, { tags: ['coral_blocks'] });
  add({ id: c + '_coral', name: title(c) + ' Coral', hardness: 0, sound: 'plant', model: 'cross', tex: { all: c + '_coral' }, fluid: 'water', opacity: 2, drops: { item: 'none', silkTouch: true } });
}
cube('dried_kelp_block', 0.5, 'grass', { tool: 'hoe', tex: { top: 'dried_kelp_top', side: 'dried_kelp_side' } });

// ---------------------------------------------------------------------------
// Nether
// ---------------------------------------------------------------------------
cube('netherrack', 0.4, 'netherrack', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tags: ['base_nether'], mapColor: 0x6f3634 });
add({ id: 'crimson_nylium', name: 'Crimson Nylium', hardness: 0.4, sound: 'nylium', model: 'cube', tex: { top: 'crimson_nylium', side: 'crimson_nylium_side', bottom: 'netherrack' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, drops: { item: 'netherrack', silkTouch: true }, tags: ['nylium'] });
add({ id: 'warped_nylium', name: 'Warped Nylium', hardness: 0.4, sound: 'nylium', model: 'cube', tex: { top: 'warped_nylium', side: 'warped_nylium_side', bottom: 'netherrack' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, drops: { item: 'netherrack', silkTouch: true }, tags: ['nylium'] });
cube('soul_sand', 0.5, 'soul', { tool: 'shovel', speedFactor: 0.4, tags: ['soul_fire_base'] });
cube('soul_soil', 0.5, 'soul', { tool: 'shovel', tags: ['soul_fire_base'] });
column('basalt', 1.25, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tex: { top: 'basalt_top', side: 'basalt_side' } });
column('polished_basalt', 1.25, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tex: { top: 'polished_basalt_top', side: 'polished_basalt_side' } });
stoneLike('smooth_basalt', 1.25);
stoneLike('blackstone', 1.5, { tex: { top: 'blackstone_top', side: 'blackstone' } });
stoneLike('polished_blackstone', 2);
stoneLike('polished_blackstone_bricks', 1.5);
stoneLike('cracked_polished_blackstone_bricks', 1.5);
stoneLike('chiseled_polished_blackstone', 1.5);
stoneLike('gilded_blackstone', 1.5, { drops: { item: 'gilded_blackstone', extra: [{ item: 'gold_nugget', chance: 0.1, min: 2, max: 5 }] } });
family('blackstone', 'blackstone', 1.5, 'stone', true);
family('polished_blackstone_bricks', 'polished_blackstone_bricks', 1.5, 'stone', true);
cube('magma_block', 0.5, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, light: 3, contactDamage: 1 });
stoneLike('nether_bricks', 2, { tags: ['nether_bricks'] });
stoneLike('red_nether_bricks', 2);
stoneLike('cracked_nether_bricks', 2);
stoneLike('chiseled_nether_bricks', 2);
family('nether_bricks', 'nether_bricks', 2, 'stone', true);
family('red_nether_bricks', 'red_nether_bricks', 2, 'stone', true);
add({ id: 'nether_brick_fence', name: 'Nether Brick Fence', hardness: 2, sound: 'stone', model: 'fence', props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL }, tex: { all: 'nether_bricks' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tags: ['fences'] });
cube('nether_wart_block', 1, 'nylium', { tool: 'hoe' });
cube('warped_wart_block', 1, 'nylium', { tool: 'hoe' });
stoneLike('quartz_block', 0.8, { tex: { top: 'quartz_block_top', side: 'quartz_block_side', bottom: 'quartz_block_bottom' } });
stoneLike('quartz_bricks', 0.8);
stoneLike('smooth_quartz', 2, { tex: { all: 'quartz_block_bottom' } });
column('quartz_pillar', 0.8, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tex: { top: 'quartz_pillar_top', side: 'quartz_pillar' } });
family('quartz_block', 'quartz_block_side', 0.8, 'stone', false);
add({ id: 'nether_portal', name: 'Nether Portal', hardness: -1, sound: 'glass', model: 'portal', props: { axis: ['x', 'z'] }, tex: { all: 'nether_portal' }, light: 11, collide: false, drops: 'none', item: false, creative: 'hidden' });
// Original: smoldering netherrack left behind by Ember Beasts
cube('smoldering_netherrack', 0.6, 'netherrack', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, light: 6, contactDamage: 1, randomTicks: true, drops: { item: 'netherrack' } });
// Original: cinder ore – Nether ore that drops cinder, used for fire resistance brews and blaze-like gear
stoneLike('cinder_ore', 3, { sound: 'netherrack', light: 3, harvestLevel: 2, drops: { item: 'cinder', min: 1, max: 3, xp: [2, 5], silkTouch: true, fortune: true }, tags: ['ore'] });

// ---------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------
stoneLike('end_stone', 3, { resistance: 9, mapColor: 0xdbde9e });
stoneLike('end_stone_bricks', 3);
family('end_stone_bricks', 'end_stone_bricks', 3, 'stone', true);
stoneLike('purpur_block', 1.5);
column('purpur_pillar', 1.5, 'stone', { tool: 'pickaxe', harvestLevel: 0, requiresTool: true, tex: { top: 'purpur_pillar_top', side: 'purpur_pillar' } });
family('purpur_block', 'purpur_block', 1.5, 'stone', false);
// (V6: one in ten chorus plants also gives a Chorus Fiber)
add({ id: 'chorus_plant', name: 'Chorus Plant', hardness: 0.4, sound: 'wood', model: 'custom', props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL, up: BOOL, down: BOOL }, tex: { all: 'chorus_plant' }, tool: 'axe', drops: { item: 'chorus_fruit', min: 0, max: 1, extra: [{ item: 'chorus_fiber', chance: 0.1 }] }, collide: true, layer: 'cutout' });
add({ id: 'chorus_flower', name: 'Chorus Flower', hardness: 0.4, sound: 'wood', model: 'cube', props: { age: ['0', '1', '2', '3', '4', '5'] }, tex: { all: 'chorus_flower' }, tool: 'axe', randomTicks: true, layer: 'cutout' });
add({ id: 'end_portal', name: 'End Portal', hardness: -1, sound: 'none', model: 'end_portal', tex: { all: 'end_portal' }, light: 15, collide: false, drops: 'none', item: false, creative: 'hidden', layer: 'opaque', entity: 'end_portal' });
add({ id: 'end_gateway', name: 'End Gateway', hardness: -1, sound: 'none', model: 'cube', tex: { all: 'end_portal' }, light: 15, collide: false, drops: 'none', item: false, creative: 'hidden', layer: 'opaque' });
add({ id: 'end_portal_frame', name: 'End Portal Frame', hardness: -1, resistance: 3600000, sound: 'glass', model: 'end_portal_frame', props: { facing: FACING4, eye: BOOL }, tex: { top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'end_stone', eye: 'end_portal_frame_eye' }, drops: 'none', creative: 'building' });
add({ id: 'dragon_egg', name: 'Dragon Egg', hardness: 3, sound: 'stone', model: 'dragon_egg', tex: { all: 'dragon_egg' }, gravity: true, light: 1 });
// Original: voidshard crystal clusters on outer End islands
add({ id: 'void_crystal', name: 'Void Crystal', hardness: 2, sound: 'glass', model: 'cross', tex: { all: 'void_crystal' }, light: 9, tool: 'pickaxe', drops: { item: 'void_shard', min: 1, max: 2 } });

// ---------------------------------------------------------------------------
// Farlands (original)
// ---------------------------------------------------------------------------
add({ id: 'far_grass_block', name: 'Farlands Grass', hardness: 0.6, sound: 'grass', model: 'cube', tex: { top: 'far_grass_block_top', side: 'far_grass_block_side', bottom: 'far_dirt' }, tool: 'shovel', drops: { item: 'far_dirt', silkTouch: true }, tags: ['dirt', 'soil'], mapColor: 0x4a9a8a });
cube('far_dirt', 0.5, 'gravel', { tool: 'shovel', tags: ['dirt', 'soil'] });
stoneLike('farstone', 2, { sound: 'glitch', tags: ['base_farlands'], mapColor: 0x5a5a6e });
stoneLike('farstone_bricks', 2, { sound: 'glitch' });
stoneLike('corrupted_stone', 2.5, { sound: 'glitch', tags: ['base_farlands'] });
cube('glitch_block', 1.5, 'glitch', { tool: 'pickaxe', light: 6, mapColor: 0xff00ff });
add({ id: 'static_block', name: 'Static', hardness: 1, sound: 'glitch', model: 'cube', tex: { all: 'static_block' }, tool: 'pickaxe', light: 3 });
cube('overflow_stone', 60, 'glitch', { tool: 'pickaxe', harvestLevel: 4, requiresTool: true, resistance: 3600, name: 'Overflow Stone' });
stoneLike('glitch_ore', 6, { sound: 'glitch', harvestLevel: 4, light: 5, drops: { item: 'glitch_shard', min: 1, max: 2, xp: [5, 10], silkTouch: true, fortune: true }, tags: ['ore'] });
stoneLike('null_ore', 8, { sound: 'glitch', harvestLevel: 4, drops: { item: 'raw_nullium', xp: [4, 8], silkTouch: true, fortune: true }, tags: ['ore'] });
cube('fractal_glass', 0.5, 'glass', { layer: 'translucent', light: 4, drops: { item: 'none', silkTouch: true } });
cube('echo_lamp', 0.5, 'glass', { light: 15 });
add({ id: 'far_portal', name: 'Farlands Portal', hardness: -1, sound: 'glass', model: 'portal', props: { axis: ['x', 'z'] }, tex: { all: 'far_portal' }, light: 12, collide: false, drops: 'none', item: false, creative: 'hidden' });
cube('far_portal_frame', -1, 'glitch', { resistance: 3600000, name: 'Corrupted Bedrock', drops: 'none', creative: 'building' });
// V3: the Glitched Portal's broken frame (a Corrupted Eye sits in its socket) and the black of the void
add({ id: 'glitched_portal_frame', name: 'Glitched Portal Frame', hardness: -1, resistance: 3600000, sound: 'glitch', model: 'cube', props: { part: ['frame', 'cracked', 'socket', 'eye'] }, tex: { all: 'glitched_portal_frame', cracked: 'glitched_portal_frame_cracked', socket: 'glitched_portal_frame_socket', eye: 'glitched_portal_frame_eye' }, light: 4, drops: 'none', creative: 'building', mapColor: 0x2a0a3a });
cube('null_block', 30, 'glitch', { tool: 'pickaxe', harvestLevel: 3, requiresTool: true, resistance: 1200, name: 'Null', mapColor: 0x000000 });
add({ id: 'data_crystal', name: 'Data Crystal', hardness: 3, sound: 'glass', model: 'cross', tex: { all: 'data_crystal' }, light: 11, tool: 'pickaxe', drops: { item: 'data_fragment' } });
cube('stretched_sand', 0.5, 'sand', { tool: 'shovel', gravity: false, name: 'Stretched Sand' });
cube('missing_block', 1, 'glitch', { tool: 'pickaxe', name: 'Missing Block' });
add({ id: 'far_tall_grass', name: 'Warped Tallgrass', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'far_tall_grass' }, replaceable: true, place: 'needs_soil', drops: { item: 'none', silkTouch: true } });

// Sculk (deep dark)
cube('sculk', 0.2, 'moss', { tool: 'hoe', drops: { item: 'sculk', xp: [1, 1], silkTouch: true } });
add({ id: 'sculk_vein', name: 'Sculk Vein', hardness: 0.2, sound: 'moss', model: 'vine', props: { north: BOOL, south: BOOL, west: BOOL, east: BOOL, up: BOOL, down: BOOL }, tex: { all: 'sculk_vein' }, replaceable: true, drops: { item: 'none', silkTouch: true } });
add({ id: 'sculk_sensor', name: 'Sculk Sensor', hardness: 1.5, sound: 'moss', model: 'custom', props: { phase: ['inactive', 'active', 'cooldown'] }, tex: { top: 'sculk_sensor_top', side: 'sculk_sensor_side', bottom: 'sculk_sensor_bottom', on: 'sculk_sensor_top_active' }, light: 1, tool: 'hoe', collide: true, layer: 'cutout', drops: { item: 'sculk_sensor', xp: [1, 1], silkTouch: false } });
// Sensors switch between phases when they hear a vibration; shriekers call the Warden
add({ id: 'sculk_shrieker', name: 'Sculk Shrieker', hardness: 3, sound: 'moss', model: 'custom', props: { can_summon: BOOL, shrieking: BOOL }, tex: { top: 'sculk_shrieker_top', side: 'sculk_shrieker_side', bottom: 'sculk_shrieker_bottom', inner: 'sculk_shrieker_inner' }, tool: 'hoe', collide: true, layer: 'cutout', drops: { item: 'none', xp: [5, 5], silkTouch: true } });
add({ id: 'sculk_catalyst', name: 'Sculk Catalyst', hardness: 3, sound: 'moss', model: 'cube', props: { bloom: BOOL }, tex: { top: 'sculk_catalyst_top', side: 'sculk_catalyst_side', bottom: 'sculk_catalyst_bottom', on: 'sculk_catalyst_top_bloom' }, light: 6, tool: 'hoe', drops: { item: 'none', xp: [5, 5], silkTouch: true } });
stoneLike('reinforced_deepslate', 55, { harvestLevel: 99, drops: 'none', sound: 'deepslate', tex: { top: 'reinforced_deepslate_top', side: 'reinforced_deepslate_side', bottom: 'reinforced_deepslate_bottom' } });

// ---------------------------------------------------------------------------
// V4 - The World Update: biome plants and materials, bunker machinery and the
// Error Biome. Only V4 worlds generate these; every one can also be placed.
// ---------------------------------------------------------------------------
// Desert and badlands
plant('desert_marigold', { place: 'needs_sand', tags: ['flowers', 'small_flowers'] });
plant('desert_scrub', { place: 'needs_sand', replaceable: true, drops: { item: 'stick', min: 0, max: 1 } });
add({ id: 'cactus_flower', name: 'Cactus Flower', hardness: 0, sound: 'plant', model: 'custom', tex: { all: 'cactus_flower' }, place: 'standing', collide: false, flammable: true, drops: { item: 'cactus_fruit', min: 1, max: 2, silkTouch: true }, tags: ['flowers'] });
plant('aloe_vera', { place: 'needs_sand', drops: { item: 'aloe_leaf', min: 1, max: 2, silkTouch: true } });
add({ id: 'ancient_urn', name: 'Ancient Urn', hardness: 0.6, sound: 'stone', model: 'custom', tex: { all: 'ancient_urn', top: 'ancient_urn_top' }, tool: 'pickaxe', drops: { table: 'block/ancient_urn', silkTouch: true }, creative: 'decoration' });
// Forests
add({ id: 'leaf_litter', name: 'Leaf Litter', hardness: 0.1, sound: 'grass', model: 'carpet', tex: { all: 'leaf_litter' }, layer: 'cutout', replaceable: true, place: 'needs_solid_below', flammable: true, drops: { item: 'none', silkTouch: true } });
add({ id: 'bracket_fungus', name: 'Bracket Fungus', hardness: 0.2, sound: 'wood', model: 'custom', props: { facing: FACING4 }, tex: { all: 'bracket_fungus', top: 'bracket_fungus_top' }, tool: 'axe', collide: false, flammable: true });
plant('shadowcap', { place: 'standing', light: 6, tags: ['mushrooms'] });
// Snow and mountains
plant('frostbloom', { light: 4, tags: ['flowers', 'small_flowers'] });
plant('snowberry_bush', { drops: { item: 'snowberries', min: 1, max: 3, silkTouch: true }, speedFactor: 0.8 });
stoneLike('frosted_stone_bricks', 1.5, { slipperiness: 0.8 });
plant('edelweiss', { tags: ['flowers', 'small_flowers'] });
// Jungle
plant('jungle_orchid', { tags: ['flowers', 'small_flowers'] });
add({ id: 'hanging_moss', name: 'Hanging Moss', hardness: 0, sound: 'plant', model: 'hanging_plant', tex: { all: 'hanging_moss' }, replaceable: true, flammable: true, drops: { item: 'none', silkTouch: true } });
// Swamps
add({ id: 'cattail', name: 'Cattail', hardness: 0, sound: 'plant', model: 'double_plant', props: { half: ['lower', 'upper'] }, tex: { bottom: 'cattail_bottom', top: 'cattail_top' }, place: 'needs_soil', flammable: true });
plant('marsh_glowcap', { place: 'standing', light: 9, tags: ['mushrooms'] });
cube('peat', 0.6, 'mud', { tool: 'shovel', tags: ['dirt'], data: { fuel: 1200 }, mapColor: 0x3a2a1c });
// Plains, taiga, savanna, beaches and cherry groves
add({ id: 'clover', name: 'Clover', hardness: 0, sound: 'grass', model: 'carpet', tex: { all: 'clover' }, tint: 'grass', layer: 'cutout', replaceable: true, place: 'needs_solid_below', flammable: true, drops: { item: 'none', silkTouch: true } });
plant('buttercup', { tags: ['flowers', 'small_flowers'] });
plant('lingonberry_bush', { drops: { item: 'lingonberries', min: 1, max: 3, silkTouch: true }, speedFactor: 0.8 });
cube('termite_mound', 0.8, 'gravel', { tool: 'shovel', mapColor: 0xa8683a });
plant('beach_grass', { place: 'needs_sand', replaceable: true, drops: { item: 'none', silkTouch: true } });
add({ id: 'seashell', name: 'Seashell', hardness: 0, sound: 'bone', model: 'custom', tex: { all: 'seashell' }, place: 'needs_solid_below', collide: false });
add({ id: 'cherry_petals', name: 'Cherry Petals', hardness: 0, sound: 'grass', model: 'carpet', tex: { all: 'cherry_petals' }, layer: 'cutout', replaceable: true, place: 'needs_solid_below', flammable: true, drops: { item: 'none', silkTouch: true } });
// Bunkers: a keycard opens the security doors, the generators power the vault
add({ id: 'keycard_reader', name: 'Keycard Reader', hardness: -1, resistance: 3600000, sound: 'metal', model: 'cube', props: { facing: FACING4, lit: BOOL }, tex: { all: 'bunker_panel', front: 'keycard_reader', front_lit: 'keycard_reader_on' }, interact: 'keycard_reader', drops: 'none', creative: 'hidden', item: false });
add({ id: 'bunker_generator', name: 'Bunker Generator', hardness: -1, resistance: 3600000, sound: 'metal', model: 'cube', props: { facing: FACING4, lit: BOOL }, tex: { all: 'bunker_panel', top: 'bunker_generator_top', front: 'bunker_generator', front_lit: 'bunker_generator_on' }, interact: 'bunker_generator', drops: 'none', creative: 'hidden', item: false });
stoneLike('bunker_plating', 50, { resistance: 1200, harvestLevel: 3, sound: 'metal', mapColor: 0x5a5f5a });
add({ id: 'bunker_blast_door', name: 'Blast Door', hardness: -1, resistance: 3600000, sound: 'metal', model: 'cube', tex: { all: 'bunker_blast_door' }, drops: 'none', creative: 'hidden', item: false });
// The Error Biome: an unloaded chunk, and the firewalls between the Glitched Structure's stages
add({ id: 'error_block', name: 'ERROR', hardness: 2, resistance: 12, sound: 'glitch', model: 'cube', tex: { all: 'error_block' }, tool: 'pickaxe', light: 2, drops: { item: 'glitch_shard', min: 0, max: 1, silkTouch: true }, mapColor: 0x7a00ff });
add({ id: 'glitch_firewall', name: 'Firewall', hardness: -1, resistance: 3600000, sound: 'glitch', model: 'cube', tex: { all: 'glitch_firewall' }, layer: 'translucent', opacity: 0, light: 10, drops: 'none', creative: 'hidden', item: false });
// Temple trials (generator 5): altars to awaken and the seals between a temple's chambers
add({ id: 'temple_altar', name: 'Temple Altar', hardness: -1, resistance: 3600000, sound: 'stone', model: 'cube', props: { lit: BOOL }, tex: { all: 'temple_altar', on: 'temple_altar_lit' }, light: 12, interact: 'temple_altar', drops: 'none', creative: 'hidden', item: false });
add({ id: 'temple_seal', name: 'Temple Seal', hardness: -1, resistance: 3600000, sound: 'stone', model: 'cube', tex: { all: 'temple_seal' }, light: 4, drops: 'none', creative: 'hidden', item: false, mapColor: 0x8a6d3b });

// V5 - The Engineering Update: machines, power, transport, fluids, signals and factory blocks
for (const d of engineeringBlockDefs()) add(d);

// V5.5 - The Digital Corruption Update: the computer world and Herobrine's cave
for (const d of digitalBlockDefs()) add(d);

// V6 - The End Expansion: the Expansion Portal and the Expanded End's landscape
for (const d of expansionBlockDefs()) add(d);
// V6, phase 2: the Expanded End's stone, ores, crystal, chorus wood and astral blocks
addExpansionResourceBlocks({ add, family, woodSet });
// V6 - The End Expansion, phase 3: the ancient civilization's stone, machines, seals and the Dragon's Nest
addAncientBlocks({ add, family, woodSet });
// V6 - The End Expansion, phase 4: End engineering, transport (Ender Light, ancient gateways, rails) and the quests' blocks
for (const d of endEngineeringBlockDefs()) add(d);
for (const d of transportBlockDefs()) add(d);
for (const d of questBlockDefs()) add(d);
// V6 phase 5: the End's events, the Void Citadel and the End Guardian's arena
for (const d of eventBlockDefs()) add(d);
for (const d of citadelBlockDefs()) add(d);

export const BLOCK_DEFS: readonly BlockDef[] = defs;
