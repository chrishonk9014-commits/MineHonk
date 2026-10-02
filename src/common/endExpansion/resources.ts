/**
 * V6 - The End Expansion, phase 2: the Expanded End's resources.
 *
 * Blocks (end stone variants, ores, crystal, chorus wood, the ancient
 * fragments, astral blocks) and the items that come from them or from the
 * expansion's mobs. Ender Alloy's tools and armor are rows of the tier
 * tables in ../data/items.ts; recipes are in ./recipes.ts and drops in
 * ../data/loot.ts. Everything here is appended after the earlier blocks and
 * items, so no earlier number moves.
 */
import type { BlockDef, SoundGroup } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';
import type { WoodSetOptions } from '../data/blocks';

/** The block helpers of ../data/blocks.ts, handed over so the expansion uses the same builders. */
export interface BlockKit {
  add(d: BlockDef): BlockDef;
  family(base: string, tex: string, hardness: number, sound: SoundGroup, withWall: boolean, o?: Partial<BlockDef>): void;
  woodSet(w: string, opts: WoodSetOptions): void;
}

/** The four end stone variants and the biome each one covers (newly generated chunks only). */
export const END_STONE_VARIANTS = [
  { id: 'cracked', name: 'Cracked', biome: 'end_barrens', light: 0, map: 0xc8c493 },
  { id: 'dark', name: 'Dark', biome: 'void_wastes', light: 0, map: 0x3a3546 },
  { id: 'crystalline', name: 'Crystalline', biome: 'end_crystal_fields', light: 0, map: 0xe4d8ee },
  { id: 'astral', name: 'Astral', biome: 'astral_end', light: 6, map: 0x5a6ad8 },
] as const;

/** The three forms of each end stone variant (each with stairs, a slab and a wall). */
export function endStoneForms(v: string): [natural: string, polished: string, bricks: string] {
  return [`${v}_end_stone`, `polished_${v}_end_stone`, `${v}_end_stone_bricks`];
}

/** The Ancient End Fragment's tooltip (exactly this, and no more). */
export const ANCIENT_TOOLTIP = 'Worked stone. Older than the cities.';
/** Tooltip of a resource whose uses come in a later update. */
const LATER = 'Has more uses in a later update.';

export function addExpansionResourceBlocks(k: BlockKit): void {
  const stone = (id: string, name: string, o: Partial<BlockDef> = {}): BlockDef =>
    k.add({ id, name, hardness: 3, resistance: 9, sound: 'stone', model: 'cube', tex: { all: id }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, ...o });
  // End stone variants: the natural stone, polished and bricks, each with stairs, a slab and a wall
  for (const v of END_STONE_VARIANTS) {
    const [natural, polished, bricks] = endStoneForms(v.id);
    const glow = v.light ? { light: v.light } : {};
    stone(natural, `${v.name} End Stone`, { ...glow, mapColor: v.map, tags: ['end_stone_variant'], creative: 'nature' });
    stone(polished, `Polished ${v.name} End Stone`, { ...glow, mapColor: v.map, creative: 'building' });
    stone(bricks, `${v.name} End Stone Bricks`, { ...glow, mapColor: v.map, creative: 'building' });
    for (const f of [natural, polished, bricks]) k.family(f, f, 3, 'stone', true, { ...glow, resistance: 9, creative: 'building' });
  }
  // End Crystal Fields: clusters on the crystal formations, and what is made from their fragments
  k.add({ id: 'end_crystal_cluster', name: 'End Crystal Cluster', hardness: 1.5, sound: 'glass', model: 'cross', tex: { all: 'end_crystal_cluster' }, light: 10, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, place: 'needs_solid_below', drops: { item: 'end_crystal_fragment', min: 2, max: 4, fortune: true, silkTouch: true }, mapColor: 0xf2d6ff, creative: 'nature' });
  k.add({ id: 'crystal_lamp', name: 'Crystal Lamp', hardness: 0.3, sound: 'glass', model: 'cube', tex: { all: 'crystal_lamp' }, light: 15, mapColor: 0xf6e8ff, creative: 'functional' });
  k.add({ id: 'crystal_glass', name: 'Crystal Glass', hardness: 0.3, sound: 'glass', model: 'cube', tex: { all: 'crystal_glass' }, layer: 'translucent', light: 3, drops: { item: 'none', silkTouch: true }, tags: ['glass'], creative: 'building' });
  // Void Wastes: void crystal grown into the dark end stone
  k.add({ id: 'void_crystal_ore', name: 'Void Crystal Ore', hardness: 4.5, resistance: 9, sound: 'stone', model: 'cube', tex: { all: 'void_crystal_ore' }, light: 3, tool: 'pickaxe', harvestLevel: 3, requiresTool: true, drops: { item: 'void_shard', min: 1, max: 3, fortune: true, silkTouch: true, xp: [3, 7] }, tags: ['ore'], mapColor: 0x6a3ad0, creative: 'nature' });
  k.add({ id: 'void_glass', name: 'Void Glass', hardness: 0.3, sound: 'glass', model: 'cube', tex: { all: 'void_glass' }, layer: 'translucent', drops: { item: 'none', silkTouch: true }, tags: ['glass'], creative: 'building' });
  // Chorus Forest: the giant chorus trees' wood, and cloth and rope from chorus fiber
  k.woodSet('chorus', { stem: 'chorus_stalk', leaves: false, sapling: false, mapColor: 0x8a5a9a });
  k.add({ id: 'chorus_cloth', name: 'Chorus Cloth', hardness: 0.8, sound: 'wool', model: 'cube', tex: { all: 'chorus_cloth' }, tool: 'shears', flammable: true, mapColor: 0xb48ac8, creative: 'building' });
  k.add({ id: 'chorus_rope', name: 'Chorus Rope', hardness: 0.4, sound: 'wool', model: 'chain', props: { axis: ['y', 'x', 'z'] }, tex: { all: 'chorus_rope' }, climbable: true, flammable: true, data: { tooltip: LATER }, creative: 'building' });
  // End Highlands: Ender Ore, deep inside the continents
  k.add({ id: 'ender_ore', name: 'Ender Ore', hardness: 30, resistance: 1200, sound: 'metal', model: 'cube', tex: { top: 'ender_ore_top', side: 'ender_ore_side' }, tool: 'pickaxe', harvestLevel: 4, requiresTool: true, tags: ['ore'], mapColor: 0x1f4a44, creative: 'nature' });
  // Shattered End: worked stone buried in the debris
  k.add({ id: 'ancient_end_fragment', name: 'Ancient End Fragment', hardness: 6, resistance: 12, sound: 'stone', model: 'cube', tex: { all: 'ancient_end_fragment' }, tool: 'pickaxe', harvestLevel: 3, requiresTool: true, drops: { item: 'ancient_fragment', min: 1, max: 2, silkTouch: true }, data: { tooltip: ANCIENT_TOOLTIP }, mapColor: 0x8a7a5a, creative: 'nature' });
  stone('ancient_end_bricks', 'Ancient End Bricks', { hardness: 4, resistance: 12, mapColor: 0x9a8a68, creative: 'building' });
  k.family('ancient_end_bricks', 'ancient_end_bricks', 4, 'stone', true, { resistance: 12, creative: 'building' });
  // Astral End: Astral Ore (an Ender Alloy pickaxe only) and what astral shards make
  k.add({ id: 'astral_ore', name: 'Astral Ore', hardness: 5, resistance: 12, sound: 'stone', model: 'cube', tex: { all: 'astral_ore' }, light: 9, tool: 'pickaxe', harvestLevel: 4, harvestMaterial: 'ender_alloy', requiresTool: true, drops: { item: 'astral_dust', min: 1, max: 2, fortune: true, silkTouch: true, xp: [4, 9] }, tags: ['ore'], mapColor: 0x9ab0ff, creative: 'nature' });
  k.add({ id: 'astral_lantern', name: 'Astral Lantern', hardness: 3.5, sound: 'metal', model: 'lantern', props: { hanging: ['false', 'true'] }, tex: { all: 'astral_lantern' }, light: 15, tool: 'pickaxe', creative: 'functional' });
  k.add({ id: 'astral_glass', name: 'Astral Glass', hardness: 0.3, sound: 'glass', model: 'cube', tex: { all: 'astral_glass' }, layer: 'translucent', light: 5, drops: { item: 'none', silkTouch: true }, tags: ['glass'], creative: 'building' });
}

/** Ender Alloy items (ingot and gear): dropped into the void, they come back to safe ground. */
export function isEnderAlloy(id: string): boolean {
  return id.startsWith('ender_alloy_');
}

/** Items of the expansion's resources and mobs (Ender Alloy gear comes from the tier tables). */
export function expansionItemDefs(): ItemDef[] {
  const mat = (id: string, name: string, o: Partial<ItemDef> = {}): ItemDef => ({ id, name, creative: 'materials', ...o });
  return [
    mat('end_crystal_fragment', 'End Crystal Fragment', { tooltip: LATER }),
    mat('chorus_fiber', 'Chorus Fiber'),
    mat('ender_scrap', 'Ender Scrap', { fireResistant: true, rarity: 'uncommon' }),
    mat('ender_alloy_ingot', 'Ender Alloy Ingot', { fireResistant: true, rarity: 'epic' }),
    mat('ancient_fragment', 'Ancient Fragment', { rarity: 'uncommon', tooltip: ANCIENT_TOOLTIP }),
    mat('astral_dust', 'Astral Dust', { rarity: 'rare' }),
    mat('astral_shard', 'Astral Shard', { rarity: 'rare', tooltip: LATER }),
    mat('void_stalker_hide', 'Void Stalker Hide'),
    mat('void_leather', 'Void Leather', { rarity: 'uncommon' }),
    mat('end_phantom_membrane', 'End Phantom Membrane', { rarity: 'uncommon', tags: ['membranes'], tooltip: 'Repairs Elytra. Has more uses in a later update.' }),
    { id: 'void_pack', name: 'Void Pack', maxStack: 1, use: 'void_pack', rarity: 'uncommon', creative: 'tools', tooltip: 'Holds 9 stacks. Its contents survive a death in the void.' },
    { id: 'raw_endling', name: 'Raw Endling', creative: 'food', food: { hunger: 2, saturation: 1.2 } },
    { id: 'cooked_endling', name: 'Cooked Endling', creative: 'food', food: { hunger: 6, saturation: 7.2 } },
  ];
}

/** The Admin Panel's End Expansion kits: every resource, block set, tool and armor piece (always cheat items). */
export interface GiveSet {
  id: string;
  name: string;
  items: [id: string, count: number][];
}

export function expansionGiveSets(): GiveSet[] {
  const fam = (b: string): [string, number][] => [b, `${b}_stairs`, `${b}_slab`, `${b}_wall`].map((id) => [id, 64] as [string, number]);
  const gear = (pieces: string[]): [string, number][] => pieces.map((pc) => [`ender_alloy_${pc}`, 1] as [string, number]);
  return [
    ...END_STONE_VARIANTS.map((v) => ({ id: `stone_${v.id}`, name: `${v.name} End Stone`, items: endStoneForms(v.id).flatMap(fam) })),
    {
      id: 'chorus_wood',
      name: 'Chorus wood',
      items: [
        ['chorus_stalk', 64],
        ['stripped_chorus_stalk', 64],
        ['chorus_planks', 64],
        ['chorus_stairs', 64],
        ['chorus_slab', 64],
        ['chorus_fence', 64],
        ['chorus_fence_gate', 16],
        ['chorus_door', 16],
        ['chorus_trapdoor', 16],
        ['chorus_button', 16],
        ['chorus_pressure_plate', 16],
        ['chorus_fiber', 64],
        ['chorus_cloth', 64],
        ['chorus_rope', 64],
      ],
    },
    { id: 'crystal', name: 'End Crystal', items: [['end_crystal_cluster', 16], ['end_crystal_fragment', 64], ['crystal_lamp', 16], ['crystal_glass', 64]] },
    { id: 'void', name: 'Void', items: [['void_crystal_ore', 16], ['void_shard', 64], ['void_glass', 64], ['void_stalker_hide', 16], ['void_leather', 16], ['void_pack', 1]] },
    { id: 'ancient', name: 'Ancient', items: [['ancient_end_fragment', 16], ['ancient_fragment', 64], ...fam('ancient_end_bricks')] },
    { id: 'astral', name: 'Astral', items: [['astral_ore', 16], ['astral_dust', 64], ['astral_shard', 16], ['astral_lantern', 16], ['astral_glass', 64]] },
    { id: 'ender_alloy', name: 'Ender Alloy', items: [['ender_ore', 16], ['ender_scrap', 16], ['ender_alloy_ingot', 16]] },
    { id: 'ender_alloy_tools', name: 'Ender Alloy tools', items: gear(['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) },
    { id: 'ender_alloy_armor', name: 'Ender Alloy armor', items: gear(['helmet', 'chestplate', 'leggings', 'boots']) },
    { id: 'end_food', name: 'Food and membranes', items: [['raw_endling', 16], ['cooked_endling', 16], ['end_phantom_membrane', 16]] },
    // Phase 3: the ancient civilization (an Ancient Map is tied to the nearest giant structure when given)
    { id: 'artifacts', name: 'End Artifacts', items: [['glyph_tablet', 1], ['cracked_ender_eye', 1], ['old_crystal_lens', 1], ['ancient_coin', 1], ['ancient_key_shard', 1], ['dragon_scale_fragment', 1]] },
    { id: 'ancient_weapons', name: 'Ancient weapons', items: [['ancient_blade', 1], ['voidpiercer', 1], ['shardstaff', 1], ['arrow', 64]] },
    { id: 'ancient_map', name: 'Ancient Map', items: [['ancient_map', 1]] },
    {
      id: 'ancient_blocks',
      name: 'Ancient blocks',
      items: [
        ['ender_glyph_stone', 64],
        ['cracked_ancient_end_bricks', 64],
        ['chiseled_ancient_end_bricks', 64],
        ['ancient_conduit', 16],
        ['ancient_core', 4],
        ['ancient_lens', 16],
        ['old_crystal_growth', 16],
        ['shell_fragments', 16],
        ['crystal_pillar', 64],
        ['astral_mosaic', 64],
      ],
    },
    // Phase 4: End engineering, transport, the quests' items and the Elytra modules
    {
      id: 'end_machines',
      name: 'End machines and transport',
      items: [
        ['crystal_generator', 2],
        ['void_collector', 2],
        ['restored_ancient_core', 1],
        ['void_cell', 2],
        ['end_processor', 1],
        ['crystal_grower', 1],
        ['crystalline_end_stone', 8],
        ['end_crystal_fragment', 64],
        ['insulated_cable', 64],
        ['engineering_book', 1],
        ['teleport_node', 4],
        ['ender_bridge_projector', 2],
        ['ender_rail', 64],
        ['rail', 64],
        ['powered_rail', 32],
        ['minecart', 2],
        ['void_skiff', 1],
        ['void_skiff_blueprint', 1],
        ['void_shard', 64],
        ['lever', 4],
      ],
    },
    {
      id: 'elytra_modules',
      name: 'Elytra and modules',
      items: [
        ['elytra', 1],
        ['reinforced_module', 1],
        ['thrust_module', 1],
        ['hover_module', 1],
        ['burst_module', 1],
        ['sanctum_dragon_scale', 1],
        ['ender_blink_module', 1],
        ['shears', 1],
        ['smithing_table', 1],
        ['firework_rocket', 64],
      ],
    },
    {
      id: 'quest_items',
      name: 'Quest items',
      items: [
        ['ancient_key', 1],
        ['silent_bell', 1],
        ['sanctum_dragon_scale', 1],
        ['ancient_key_shard', 4],
        ['dragon_scale_fragment', 4],
        ['ancient_fragment', 64],
        ['ancient_end_bricks', 64],
        ['end_crystal', 8],
        ['astral_shard', 8],
      ],
    },
  ];
}
