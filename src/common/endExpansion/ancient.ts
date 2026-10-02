/**
 * V6 - The End Expansion, phase 3: the ancient End civilization's blocks
 * and items.
 *
 * - Ender Glyph Stone: walls of a made-up script (six glyph faces). It can't
 *   be read: using one only shows its glyphs.
 * - Broken portals: frames of Ancient End Bricks (cracked, pieces missing)
 *   around Dead Portal blocks, which are dim and still.
 * - Strange machines: Ancient Conduits, Cores and Lenses, all dormant.
 * - Sealed rooms: Ancient Ward Stone walls and vault doors no tool opens.
 * - The Dragon's Nest: Old Crystal Growths and Shell Fragments.
 * - The End Palace's own decorative blocks: Crystal Pillars and Astral Mosaic.
 *
 * Everything inert here is waiting for phase 4 (quests, power): using it
 * only says so (INERT_MESSAGES). Items: the six End Artifacts (collectibles
 * with one line of flavour each), the three ancient weapons, and the Ancient
 * Map (a compass needle towards one giant structure). Lore books are plain
 * books carrying a fragment of the lore pool (./lore.ts).
 *
 * All of it is appended after the earlier blocks and items, so no earlier
 * number moves.
 */
import type { BlockDef } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';
import type { BlockKit } from './resources';

/** Glyph faces of Ender Glyph Stone (its `glyph` property). */
export const GLYPH_FACES = 6;

/** What using an inert ancient block says (it does nothing else until phase 4). */
export const INERT_MESSAGES: Record<string, string> = {
  ancient_conduit: 'It has no power.',
  ancient_core: 'It has no power.',
  ancient_lens: 'It has no power.',
  ancient_vault_door: 'It is sealed. Something is missing.',
  crystal_vault_door: 'It is sealed. Something is missing.',
  ancient_ward_stone: 'It is sealed.',
  dead_portal: 'Something is missing.',
};

/** Tooltip of the inert blocks a later update brings to life. */
const DORMANT = 'Dormant.';

export function addAncientBlocks(k: BlockKit): void {
  const unbreakable = { hardness: -1, resistance: 3600000, drops: 'none' as const, creative: 'functional' };
  k.add({ id: 'ender_glyph_stone', name: 'Ender Glyph Stone', props: { glyph: ['0', '1', '2', '3', '4', '5'] }, texBy: 'glyph', hardness: 4, resistance: 12, sound: 'stone', model: 'cube', tex: { top: 'ender_glyph_stone_top', side: 'ender_glyph_stone' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x3e3550, creative: 'building' });
  k.add({ id: 'cracked_ancient_end_bricks', name: 'Cracked Ancient End Bricks', hardness: 4, resistance: 12, sound: 'stone', model: 'cube', tex: { all: 'cracked_ancient_end_bricks' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x8a7a5a, creative: 'building' });
  k.add({ id: 'chiseled_ancient_end_bricks', name: 'Chiseled Ancient End Bricks', hardness: 4, resistance: 12, sound: 'stone', model: 'cube', tex: { all: 'chiseled_ancient_end_bricks' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x9a8a68, creative: 'building' });
  // Sealed rooms: no tool, explosion or dragon opens them (phase 4 does)
  k.add({ id: 'ancient_ward_stone', name: 'Ancient Ward Stone', ...unbreakable, sound: 'stone', model: 'cube', tex: { all: 'ancient_ward_stone' }, mapColor: 0x6a5a48, data: { tooltip: 'It is sealed.' } });
  k.add({ id: 'ancient_vault_door', name: 'Ancient Vault Door', ...unbreakable, props: { facing: ['north', 'south', 'west', 'east'] }, sound: 'stone', model: 'cube', tex: { all: 'ancient_ward_stone', front: 'ancient_vault_door' }, mapColor: 0x6a5a48, data: { tooltip: 'It is sealed. Something is missing.' } });
  k.add({ id: 'crystal_vault_door', name: 'Crystal Vault Door', ...unbreakable, props: { facing: ['north', 'south', 'west', 'east'] }, sound: 'glass', model: 'cube', tex: { all: 'crystalline_end_stone_bricks', front: 'crystal_vault_door' }, light: 4, mapColor: 0xe4d8ee, data: { tooltip: 'It is sealed. Something is missing.' } });
  // Broken portals: their sheets are dead (dim and still); nothing passes through
  k.add({ id: 'dead_portal', name: 'Dead Portal', ...unbreakable, props: { axis: ['x', 'z'] }, sound: 'glass', model: 'portal', tex: { all: 'dead_portal' }, layer: 'translucent', light: 1, collide: false, mapColor: 0x2a2238, data: { tooltip: 'Something is missing.' } });
  // Strange machines (dormant until phase 4 powers them)
  k.add({ id: 'ancient_conduit', name: 'Ancient Conduit', props: { axis: ['y', 'x', 'z'] }, hardness: 5, resistance: 12, sound: 'metal', model: 'column', tex: { top: 'ancient_conduit_top', side: 'ancient_conduit' }, tool: 'pickaxe', harvestLevel: 3, requiresTool: true, mapColor: 0x5a5060, data: { tooltip: DORMANT }, creative: 'functional' });
  k.add({ id: 'ancient_core', name: 'Ancient Core', props: { lit: ['false', 'true'] }, hardness: 6, resistance: 12, sound: 'metal', model: 'cube', tex: { all: 'ancient_core', on: 'ancient_core_on' }, light: 2, tool: 'pickaxe', harvestLevel: 3, requiresTool: true, mapColor: 0x4a3a5a, data: { tooltip: DORMANT }, creative: 'functional' });
  k.add({ id: 'ancient_lens', name: 'Ancient Lens', props: { lit: ['false', 'true'] }, hardness: 1.5, sound: 'glass', model: 'cube', tex: { all: 'ancient_lens', on: 'ancient_lens_on' }, layer: 'translucent', light: 2, tool: 'pickaxe', harvestLevel: 3, requiresTool: true, mapColor: 0xb8d8ff, data: { tooltip: DORMANT }, creative: 'functional' });
  // The Dragon's Nest
  k.add({ id: 'old_crystal_growth', name: 'Old Crystal Growth', hardness: 1.5, sound: 'glass', model: 'cross', tex: { all: 'old_crystal_growth' }, light: 5, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, place: 'needs_solid_below', drops: { item: 'end_crystal_fragment', min: 1, max: 2, fortune: true, silkTouch: true }, mapColor: 0xa890c0, creative: 'nature' });
  k.add({ id: 'shell_fragments', name: 'Shell Fragments', hardness: 0.3, sound: 'bone', model: 'carpet', tex: { all: 'shell_fragments' }, layer: 'cutout', place: 'needs_solid_below', mapColor: 0xd8d0b8, creative: 'nature' });
  // The End Palace's own decoration (found there, never crafted)
  k.add({ id: 'crystal_pillar', name: 'Crystal Pillar', props: { axis: ['y', 'x', 'z'] }, hardness: 2, resistance: 9, sound: 'glass', model: 'column', tex: { top: 'crystal_pillar_top', side: 'crystal_pillar' }, light: 4, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0xf0e4ff, creative: 'building' });
  k.add({ id: 'astral_mosaic', name: 'Astral Mosaic', hardness: 2, resistance: 9, sound: 'stone', model: 'cube', tex: { all: 'astral_mosaic' }, light: 3, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x4a5ac8, creative: 'building' });
}

/** The six End Artifacts: collectibles, each with one line of flavour (some become quest objects in phase 4). */
export const END_ARTIFACTS: { id: string; name: string; line: string }[] = [
  { id: 'glyph_tablet', name: 'Glyph Tablet', line: 'The marks are cut deeper on one side.' },
  { id: 'cracked_ender_eye', name: 'Cracked Ender Eye', line: 'It still turns, very slowly, towards nothing.' },
  { id: 'old_crystal_lens', name: 'Old Crystal Lens', line: 'Ground by hand. Something bright was seen through it.' },
  { id: 'ancient_coin', name: 'Ancient Coin', line: 'Both faces are worn smooth.' },
  { id: 'ancient_key_shard', name: 'Ancient Key Shard', line: 'One piece of something that once opened.' },
  { id: 'dragon_scale_fragment', name: 'Dragon Scale Fragment', line: 'Too small to be from the dragon you know.' },
];
export const END_ARTIFACT_IDS = END_ARTIFACTS.map((a) => a.id);

/** The three ancient weapons, found only in ancient sites. */
export const ANCIENT_WEAPONS = ['ancient_blade', 'voidpiercer', 'shardstaff'] as const;
/** Armor points the Ancient Blade ignores. */
export const ANCIENT_BLADE_PIERCE = 2;
/** Blocks a Voidpiercer bolt flies before gravity takes it. */
export const VOIDPIERCER_STRAIGHT = 32;
/** Ticks between Shardstaff shots. */
export const SHARDSTAFF_COOLDOWN = 24;
/** A Shardstaff shard: speed (blocks per tick), life (ticks) and damage. */
export const SHARD = { speed: 0.8, life: 22, damage: 9 } as const;

/** The Ancient Map's tooltip (exactly this: it names nothing). */
export const ANCIENT_MAP_TOOLTIP = 'Marked: a place.';

export function ancientItemDefs(): ItemDef[] {
  return [
    ...END_ARTIFACTS.map((a): ItemDef => ({ id: a.id, name: a.name, maxStack: a.id === 'ancient_coin' ? 16 : 1, rarity: a.id === 'dragon_scale_fragment' ? 'epic' : 'rare', tags: ['end_artifacts'], tooltip: a.line, creative: 'materials' })),
    // Balanced against Ender Alloy: a little less raw damage, one property of its own
    { id: 'ancient_blade', name: 'Ancient Blade', maxStack: 1, durability: 1800, tool: { type: 'sword', tier: 4, speed: 1.5, material: 'ancient' }, weapon: { damage: 8, speed: 1.6 }, enchantability: 15, repair: 'ancient_fragment', rarity: 'epic', tags: ['weapons', 'swords', 'ancient_weapons'], tooltip: `Cuts through ${ANCIENT_BLADE_PIERCE} points of armor.`, creative: 'combat' },
    { id: 'voidpiercer', name: 'Voidpiercer', maxStack: 1, durability: 900, use: 'crossbow', enchantability: 12, repair: 'ancient_fragment', rarity: 'epic', tags: ['crossbows', 'ancient_weapons'], tooltip: `Its bolts fly straight for ${VOIDPIERCER_STRAIGHT} blocks.`, creative: 'combat' },
    { id: 'shardstaff', name: 'Shardstaff', maxStack: 1, durability: 600, use: 'shardstaff', enchantability: 10, repair: 'ancient_fragment', rarity: 'epic', tags: ['ancient_weapons'], tooltip: 'Fires a slow crystal shard at close range.', creative: 'combat' },
    { id: 'ancient_map', name: 'Ancient Map', maxStack: 1, use: 'ancient_map', rarity: 'rare', tooltip: ANCIENT_MAP_TOOLTIP, creative: 'tools' },
  ];
}

/** Every block of phase 3 (the Admin Panel's kits, tests). */
export const ANCIENT_BLOCK_IDS = ['ender_glyph_stone', 'cracked_ancient_end_bricks', 'chiseled_ancient_end_bricks', 'ancient_ward_stone', 'ancient_vault_door', 'crystal_vault_door', 'dead_portal', 'ancient_conduit', 'ancient_core', 'ancient_lens', 'old_crystal_growth', 'shell_fragments', 'crystal_pillar', 'astral_mosaic'] as const;

/** Whether a block def is unbreakable ancient stonework (never mined, blown up or moved). */
export function isSealed(def: BlockDef): boolean {
  return def.id === 'ancient_ward_stone' || def.id === 'ancient_vault_door' || def.id === 'crystal_vault_door' || def.id === 'dead_portal';
}
