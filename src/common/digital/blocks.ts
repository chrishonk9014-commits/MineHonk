/**
 * V5.5: blocks of the computer world (the seed where Herobrine was first
 * found, as it is inside the machine) and of Herobrine's cave: familiar
 * blocks gone digital, broken chunks, server towers, cables, screens of
 * static, tesla coils and the core he plugged himself into.
 *
 * Appended after the engineering blocks so earlier block numbers never move.
 */
import type { BlockDef } from '../registry/blockTypes';

const FACING4 = ['north', 'south', 'west', 'east'] as const;

export function digitalBlockDefs(): BlockDef[] {
  const tab = 'digital';
  return [
    // Familiar blocks, rendered by a machine
    { id: 'digital_grass_block', name: 'Digital Grass Block', hardness: 0.6, sound: 'grass', model: 'cube', tex: { top: 'digital_grass_top', side: 'digital_grass_side', bottom: 'digital_dirt' }, tool: 'shovel', mapColor: 0x3ad07a, creative: tab },
    { id: 'digital_dirt', name: 'Digital Dirt', hardness: 0.5, sound: 'gravel', model: 'cube', tex: { all: 'digital_dirt' }, tool: 'shovel', mapColor: 0x6a4a3a, creative: tab },
    { id: 'digital_stone', name: 'Digital Stone', hardness: 1.5, resistance: 6, sound: 'stone', model: 'cube', tex: { all: 'digital_stone' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, mapColor: 0x7a8a96, creative: tab },
    { id: 'digital_log', name: 'Digital Log', hardness: 2, sound: 'wood', model: 'column', props: { axis: ['y', 'x', 'z'] }, tex: { top: 'digital_log_top', side: 'digital_log' }, tool: 'axe', mapColor: 0x5a3a2a, creative: tab },
    { id: 'digital_leaves', name: 'Digital Leaves', hardness: 0.2, sound: 'grass', model: 'cube', tex: { all: 'digital_leaves' }, layer: 'cutout', opacity: 1, tool: 'hoe', mapColor: 0x2a9a5a, creative: tab },
    // Circuitry in the rock, raw data, the edges of broken chunks
    { id: 'circuit_stone', name: 'Circuit Stone', hardness: 2, resistance: 6, sound: 'stone', model: 'cube', tex: { all: 'circuit_stone' }, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, light: 3, mapColor: 0x3a4a5a, creative: tab },
    { id: 'data_block', name: 'Data Block', hardness: 1.2, sound: 'glass', model: 'cube', tex: { all: 'data_block' }, tool: 'pickaxe', light: 10, drops: { item: 'data_fragment', min: 1, max: 2, silkTouch: true }, mapColor: 0x30d8e8, creative: tab },
    { id: 'wireframe_block', name: 'Wireframe', hardness: 0.8, sound: 'glass', model: 'cube', tex: { all: 'wireframe_block' }, layer: 'cutout', opacity: 0, tool: 'pickaxe', light: 4, mapColor: 0x40f0a0, creative: tab },
    // Machinery
    { id: 'server_tower', name: 'Server Tower', hardness: 4, resistance: 12, sound: 'metal', model: 'cube', props: { facing: FACING4 }, tex: { all: 'server_tower_side', top: 'server_tower_top', front: 'server_tower_front' }, tool: 'pickaxe', harvestLevel: 1, requiresTool: true, light: 5, mapColor: 0x2a2e34, creative: tab },
    { id: 'cable_bundle', name: 'Cable Bundle', hardness: 1.5, sound: 'wool', model: 'column', props: { axis: ['y', 'x', 'z'] }, tex: { top: 'cable_bundle_top', side: 'cable_bundle' }, tool: 'axe', mapColor: 0x1a1a1e, creative: tab },
    { id: 'static_screen', name: 'Static Screen', hardness: 1.5, sound: 'glass', model: 'cube', props: { facing: FACING4 }, tex: { all: 'server_tower_side', front: 'static_screen' }, tool: 'pickaxe', light: 7, mapColor: 0x9a9aa0, creative: tab },
    { id: 'giant_hard_drive', name: 'Giant Hard Drive', hardness: 4, resistance: 12, sound: 'metal', model: 'cube', tex: { top: 'giant_hard_drive_top', side: 'giant_hard_drive_side', bottom: 'giant_hard_drive_side' }, tool: 'pickaxe', harvestLevel: 1, requiresTool: true, mapColor: 0x8a929c, creative: tab },
    { id: 'tesla_coil', name: 'Tesla Coil', hardness: 4, resistance: 12, sound: 'metal', model: 'cube', tex: { top: 'tesla_coil_top', side: 'tesla_coil_side', bottom: 'machine_bottom' }, tool: 'pickaxe', harvestLevel: 1, requiresTool: true, light: 9, mapColor: 0x4ab8ff, creative: tab },
    { id: 'old_terminal', name: 'Old Terminal', hardness: 3, resistance: 12, sound: 'metal', model: 'cube', props: { facing: FACING4 }, tex: { all: 'old_terminal_side', top: 'old_terminal_top', front: 'old_terminal_front' }, tool: 'pickaxe', light: 6, interact: 'terminal', mapColor: 0xb8b090, creative: tab },
    // The machine at the heart of the cave (never broken)
    { id: 'herobrine_core', name: 'Core', hardness: -1, resistance: 3600000, sound: 'metal', model: 'cube', tex: { all: 'herobrine_core_side', top: 'herobrine_core_top' }, light: 12, drops: 'none', creative: 'hidden', item: false, mapColor: 0xd8f0ff },
  ];
}
