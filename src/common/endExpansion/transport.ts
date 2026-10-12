/**
 * V6 - The End Expansion, phase 4: getting about the Expanded End.
 *
 * Plain data shared by the server, the client, the tests and the docs:
 *
 * - Ender Bridges: the Ender Bridge Projector (an engineering block, see
 *   ../engineering/catalog.ts) lays a bridge of Ender Light;
 * - Teleportation Nodes: player-built pads linked by name (same dimension
 *   only), paid for in EU;
 * - Ancient Gateways: repaired broken portals, linked in seed-determined
 *   pairs (./quests.ts);
 * - rails and minecarts (MineHonk had none: the plain rail, the powered rail
 *   and the Ender Rail share one system);
 * - the Void Skiff, a slow flying boat for crossing the void.
 *
 * Elytra and firework rockets are untouched: they stay the fastest way to
 * reach somewhere new. Nodes and gateways only join places already reached.
 */
import type { BlockDef } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';

/** Ender Bridge: longest bridge, EU/t per started 16 blocks, ticks a bridge takes to fade. */
export const BRIDGE = { max: 64, euPer16: 16, fadeTicks: 60 } as const;

/** Teleportation Nodes: cost (EU) and warm-up (ticks); Overworld nodes work within `overworldRange` of spawn. */
export const NODE = { base: 1000, perBlock: 10, warmup: 40, overworldRange: 2000, nameMax: 24 } as const;

/** EU a trip between two nodes costs. */
export function nodeCost(dist: number): number {
  return NODE.base + Math.ceil(NODE.perBlock * dist);
}

/**
 * Minecarts (blocks per tick): a powered rail drives them to `powered`, a
 * powered Ender Rail to twice that.
 */
export const CART = { powered: 0.4, ender: 0.8, push: 0.06, enderPush: 0.12, friction: 0.997, brake: 0.5, slope: 0.0078, max: 0.8 } as const;

/**
 * The Void Skiff (blocks and ticks): it hovers `hover` blocks over whatever
 * is below (or holds its height over open void) and moves at 1.5x a
 * player's walking speed. It climbs and sinks slowly and can never be more
 * than `climb` blocks above the lowest it was in the last minute. A void
 * shard keeps it up for 30 seconds; empty, it sinks slowly.
 */
export const SKIFF = { speed: 0.215 * 1.5, vSpeed: 0.06, hover: 3, climb: 16, climbWindow: 1200, fuelTicks: 600, sink: 0.04, tank: 16, width: 1.6, height: 0.9 } as const;
/** Void Recovery's and the gateways' "end of the world": below this a falling player is lost. */
export const VOID_LINE = 0;

const BOOL = ['false', 'true'] as const;
/** Rail shapes: straight along an axis, sloping up towards a side, or turning between two sides. */
export const RAIL_SHAPES = ['north_south', 'east_west', 'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west', 'south_east', 'south_west', 'north_west', 'north_east'] as const;
export type RailShape = (typeof RAIL_SHAPES)[number];
export const RAIL_STRAIGHT_SHAPES = RAIL_SHAPES.slice(0, 6);

/** Blocks of the phase 4 transport (appended after the End engineering blocks). */
export function transportBlockDefs(): BlockDef[] {
  return [
    // A bridge's surface: solid underfoot, never mined, it flickers (fade 1-3) before it goes
    { id: 'ender_light', name: 'Ender Light', hardness: -1, resistance: 3600000, sound: 'glass', model: 'cube', props: { fade: ['0', '1', '2', '3'] }, tex: { all: 'ender_light' }, layer: 'translucent', opacity: 0, light: 9, drops: 'none', creative: 'hidden', item: false, mapColor: 0xb070ff },
    // A repaired broken portal: an ancient gateway to its pair
    { id: 'ancient_gateway', name: 'Ancient Gateway', hardness: -1, resistance: 3600000, sound: 'glass', model: 'portal', props: { axis: ['x', 'z'] }, tex: { all: 'ancient_gateway' }, layer: 'translucent', light: 11, collide: false, drops: 'none', creative: 'hidden', item: false, mapColor: 0x8a6aff },
    // Rails
    { id: 'rail', name: 'Rail', hardness: 0.7, sound: 'metal', model: 'rail', props: { shape: RAIL_SHAPES }, tex: { all: 'rail', corner: 'rail_corner' }, layer: 'cutout', collide: false, opacity: 0, tool: 'pickaxe', place: 'needs_solid_below', tags: ['rails'], creative: 'redstone' },
    { id: 'powered_rail', name: 'Powered Rail', hardness: 0.7, sound: 'metal', model: 'rail', props: { shape: RAIL_STRAIGHT_SHAPES, powered: BOOL }, tex: { all: 'powered_rail', on: 'powered_rail_on' }, layer: 'cutout', collide: false, opacity: 0, tool: 'pickaxe', place: 'needs_solid_below', tags: ['rails', 'redstone'], creative: 'redstone' },
  ];
}

export function transportItemDefs(): ItemDef[] {
  return [
    { id: 'minecart', name: 'Minecart', maxStack: 1, use: 'vehicle', creative: 'tools' },
    { id: 'void_skiff', name: 'Void Skiff', maxStack: 1, use: 'vehicle', rarity: 'rare', creative: 'tools', tooltip: 'A flying boat for two. Fuel it with Void Shards (one every 30 seconds).' },
    { id: 'void_skiff_blueprint', name: 'Void Skiff Blueprint', maxStack: 1, use: 'blueprint', rarity: 'rare', creative: 'tools', tooltip: 'Use it to learn the Void Skiff recipe.' },
  ];
}

/** Recipes a player has to learn first (from a blueprint) before they can craft them. */
export const LOCKED_RECIPES: Record<string, string> = { void_skiff: 'void_skiff_blueprint' };
