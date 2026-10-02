/**
 * V6 - The End Expansion: blocks of the Expansion Portal and of the
 * Expanded End's landscape.
 *
 * Appended after the V5.5 blocks so earlier block numbers never move.
 */
import type { BlockDef } from '../registry/blockTypes';

const BOOL = ['false', 'true'] as const;

export function expansionBlockDefs(): BlockDef[] {
  const tab = 'nature';
  return [
    // The Expansion Portal: an unbreakable frame (outside creative), dark until the Ender Dragon has been defeated
    { id: 'expansion_portal_frame', name: 'Expansion Portal Frame', hardness: -1, resistance: 3600000, sound: 'stone', model: 'cube', props: { lit: BOOL }, tex: { all: 'expansion_portal_frame', on: 'expansion_portal_frame_lit' }, light: 10, drops: 'none', creative: 'hidden', item: false, mapColor: 0x2b2440 },
    { id: 'expansion_portal', name: 'Expansion Portal', hardness: -1, sound: 'glass', model: 'portal', props: { axis: ['x', 'z'] }, tex: { all: 'expansion_portal' }, light: 11, collide: false, drops: 'none', item: false, creative: 'hidden', mapColor: 0x6fe3d0 },
    // The Expanded End's ground
    { id: 'pale_end_stone', name: 'Pale End Stone', hardness: 3, resistance: 9, sound: 'stone', model: 'cube', tex: { all: 'pale_end_stone' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0xe6e2cf, creative: tab },
    { id: 'voidstone', name: 'Voidstone', hardness: 3, resistance: 9, sound: 'stone', model: 'cube', tex: { all: 'voidstone' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x2a2038, creative: tab },
    { id: 'luminous_moss', name: 'Luminous Moss', hardness: 0.2, sound: 'moss', model: 'cube', tex: { all: 'luminous_moss' }, tool: 'hoe', light: 6, mapColor: 0x3fc8b4, creative: tab },
    { id: 'end_sand', name: 'End Sand', hardness: 0.5, sound: 'sand', model: 'cube', tex: { all: 'end_sand' }, tool: 'shovel', tags: ['sand'], mapColor: 0xd9c9a0, creative: tab },
    { id: 'prism_crystal', name: 'Prism Crystal', hardness: 1.5, sound: 'glass', model: 'cube', tex: { all: 'prism_crystal' }, layer: 'translucent', opacity: 2, light: 9, tool: 'pickaxe', mapColor: 0xf0c8f0, creative: tab },
    // Plants
    { id: 'pale_grass', name: 'Pale Grass', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'pale_grass' }, replaceable: true, place: 'needs_solid_below', drops: { item: 'none', silkTouch: true }, mapColor: 0xd8d6c0, creative: tab },
    { id: 'dune_reed', name: 'Dune Reed', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'dune_reed' }, replaceable: true, place: 'needs_solid_below', drops: { item: 'none', silkTouch: true }, mapColor: 0xb8a070, creative: tab },
    { id: 'mist_bloom', name: 'Mist Bloom', hardness: 0, sound: 'plant', model: 'cross', tex: { all: 'mist_bloom' }, place: 'needs_solid_below', light: 4, tags: ['flowers'], mapColor: 0xf4f4ff, creative: tab },
    { id: 'prism_cluster', name: 'Prism Cluster', hardness: 1, sound: 'glass', model: 'cross', tex: { all: 'prism_cluster' }, place: 'needs_solid_below', light: 7, tool: 'pickaxe', drops: { item: 'none', silkTouch: true }, mapColor: 0xf6d8ff, creative: tab },
    { id: 'void_vines', name: 'Void Vines', hardness: 0, sound: 'plant', model: 'hanging_plant', tex: { all: 'void_vines' }, replaceable: true, climbable: true, light: 3, drops: { item: 'none', silkTouch: true }, mapColor: 0x4a3a8a, creative: tab },
  ];
}
