/**
 * V6 - The End Expansion: the seven biomes of the Expanded End.
 *
 * Each entry carries everything the game needs about a biome: its name and
 * description, the shape of its land, its surface palette, landscape
 * features and ores, and its atmosphere (sky tint, fog colour and density,
 * ambient particles and sound bed). The generator, the server, the client
 * and the Admin Panel all read this one table.
 *
 * Phase 2 gave the biomes their final names and, from generator 7 on, their
 * own stone, ores and plants. A world made by generator 6 (phase 1) keeps
 * generating its Expanded End exactly as before (`phase1` below): the same
 * biome slots, land shapes and surfaces under the new names.
 */
import type { TreeKind } from '../data/biomes';
import { EXPANSION_RESOURCES_GENERATOR } from './region';

/** How a biome's land is shaped (see ExpansionTerrain.spans). */
export interface TerrainStyle {
  /** Noise scale of the island field in blocks: bigger means larger islands. */
  scale: number;
  /** 0..1: how much of the region is land. */
  cover: number;
  /** Surface height of small islands, and how much higher the centres of large ones rise. */
  base: number;
  rise: number;
  /** Hills on the surface: height and noise scale. */
  relief: number;
  reliefScale: number;
  /** Depth of a large island's underside. */
  depth: number;
  /** Steps the surface into ledges this many blocks tall (cliffs); 0 for smooth. */
  terrace?: number;
  /** Ridged crests added on top (height), and their noise scale. */
  ridges?: number;
  ridgeScale?: number;
  /** Strings of small islands floating above the land. */
  chains?: { lift: number; wave: number; density: number; thickness: number; scale: number };
  /** 0..1: how much of thick land is cut through by a band of caves; and their noise scale. */
  caves?: number;
  caveScale?: number;
}

/** A landscape feature (never a structure). */
export interface FeatureSpec {
  kind: 'plant' | 'patch' | 'spire' | 'cluster' | 'growth' | 'hanging' | 'tree';
  block: string;
  /** Tree: which generated tree or large plant (src/common/gen/features/trees.ts). */
  tree?: TreeKind;
  /** Average attempts per chunk. */
  perChunk: number;
  size?: number;
  height?: number;
  /** Block on top of a spire, or the cap of a growth. */
  tip?: string;
  cap?: string;
  /** How far the feature can reach from its origin (for chunk clipping). */
  reach?: number;
  /** Patch: replace the ground instead of covering it. */
  replaceGround?: boolean;
  /** May stand on any ground, not only the biome's top block. */
  onAnyGround?: boolean;
}

/** Veins of an ore inside a biome's land (generator 7 on). */
export interface OreSpec {
  block: string;
  /** Blocks a vein may replace. */
  in: string[];
  /** Average veins per chunk. */
  perChunk: number;
  /** Most blocks in one vein. */
  size: number;
  /** How far below the column's top surface a vein starts. */
  minDepth: number;
  maxDepth: number;
  /** Every block of the vein is closed in by solid blocks on all six sides (never open to air or sky). */
  enclosed?: boolean;
}

/** Surface palette: top block, the blocks under it (to `depth`), and the core. */
export interface Palette {
  top: string;
  under: string;
  core: string;
  depth: number;
}

export interface ExpansionBiome {
  /** Registry id (also the biome's id in /locate, the Admin Panel and saves). */
  id: string;
  name: string;
  description: string;
  /** Sky tint and fog colour (blended across borders on the client). */
  sky: number;
  fog: number;
  /** 0 = clear air, 1 = thick fog. */
  fogDensity: number;
  /** Ambient light (0..1; the classic End's is 0.2): how bright the biome's ground looks. */
  light: number;
  /** Ambient particles drifting around the player: colour, motion, how many (0..1), and whether they glow. */
  particles?: { color: number; motion: 'rise' | 'fall' | 'float'; rate: number; glow?: boolean };
  /** Ambient sound bed (a looping synth recipe in src/client/audio/synth.ts). */
  bed: string;
  /** Surface palette, features and ores of worlds made by generator 7 on. */
  palette: Palette;
  terrain: TerrainStyle;
  features: FeatureSpec[];
  ores: OreSpec[];
  /** How generator 6 worlds (phase 1) lay this biome's surface: kept so their chunks regenerate unchanged. */
  phase1: { palette: Palette; features: FeatureSpec[] };
  /** Map colour of the biome (minimap and admin). */
  mapColor: number;
}

export const EXPANSION_BIOMES: readonly ExpansionBiome[] = [
  {
    id: 'end_barrens',
    name: 'End Barrens',
    description: 'Wide, flat islands of cracked end stone, strewn with boulders.',
    sky: 0x3b3552,
    fog: 0x6e6888,
    fogDensity: 0.12,
    light: 0.62,
    particles: { color: 0xe8e4ff, motion: 'float', rate: 0.15 },
    bed: 'end_barrens',
    palette: { top: 'cracked_end_stone', under: 'cracked_end_stone', core: 'end_stone', depth: 2 },
    terrain: { scale: 240, cover: 0.62, base: 62, rise: 6, relief: 3, reliefScale: 70, depth: 30 },
    features: [
      { kind: 'cluster', block: 'cracked_end_stone', perChunk: 0.5, size: 2, reach: 3 },
      { kind: 'patch', block: 'end_stone', perChunk: 1.5, size: 3, reach: 3, replaceGround: true },
      { kind: 'plant', block: 'pale_grass', perChunk: 2, reach: 0 },
    ],
    ores: [],
    phase1: {
      palette: { top: 'pale_end_stone', under: 'pale_end_stone', core: 'end_stone', depth: 2 },
      features: [
        { kind: 'plant', block: 'pale_grass', perChunk: 12, reach: 0 },
        { kind: 'patch', block: 'pale_grass', perChunk: 3, size: 3, reach: 3 },
        { kind: 'cluster', block: 'pale_end_stone', perChunk: 0.3, size: 2, reach: 3 },
      ],
    },
    mapColor: 0xc8c493,
  },
  {
    id: 'shattered_end',
    name: 'Shattered End',
    description: 'Tall, narrow islands of dark voidstone, broken into sheer stepped cliffs and needle-like spires.',
    sky: 0x24123a,
    fog: 0x3a1f52,
    fogDensity: 0.3,
    light: 0.42,
    particles: { color: 0x9a6ad8, motion: 'rise', rate: 0.25, glow: true },
    bed: 'shattered_end',
    palette: { top: 'voidstone', under: 'voidstone', core: 'voidstone', depth: 6 },
    terrain: { scale: 90, cover: 0.42, base: 72, rise: 40, relief: 4, reliefScale: 30, depth: 70, terrace: 5, ridges: 22, ridgeScale: 60 },
    features: [
      { kind: 'spire', block: 'voidstone', perChunk: 1.2, height: 10, size: 2, reach: 1 },
      { kind: 'spire', block: 'voidstone', perChunk: 2, height: 5, size: 1, reach: 0 },
      // Debris: broken blocks heaped on the ledges
      { kind: 'cluster', block: 'cracked_end_stone', perChunk: 0.6, size: 1, reach: 2 },
    ],
    ores: [{ block: 'ancient_end_fragment', in: ['voidstone', 'cracked_end_stone'], perChunk: 0.45, size: 2, minDepth: 1, maxDepth: 5 }],
    phase1: {
      palette: { top: 'voidstone', under: 'voidstone', core: 'voidstone', depth: 6 },
      features: [
        { kind: 'spire', block: 'voidstone', perChunk: 1.2, height: 10, size: 2, reach: 1 },
        { kind: 'spire', block: 'voidstone', perChunk: 2, height: 5, size: 1, reach: 0 },
      ],
    },
    mapColor: 0x2a2038,
  },
  {
    id: 'astral_end',
    name: 'Astral End',
    description: 'Strings of small islands hanging at many heights, their stone glowing with a cold light.',
    sky: 0x101a40,
    fog: 0x1e2a66,
    fogDensity: 0.18,
    light: 0.48,
    particles: { color: 0x9ab0ff, motion: 'rise', rate: 0.35, glow: true },
    bed: 'astral_end',
    palette: { top: 'astral_end_stone', under: 'end_stone', core: 'end_stone', depth: 2 },
    terrain: { scale: 80, cover: 0.34, base: 56, rise: 10, relief: 3, reliefScale: 30, depth: 18, chains: { lift: 28, wave: 20, density: 0.27, thickness: 8, scale: 120 } },
    features: [{ kind: 'patch', block: 'luminous_moss', perChunk: 0.8, size: 2, reach: 2, replaceGround: true }],
    ores: [{ block: 'astral_ore', in: ['end_stone', 'astral_end_stone'], perChunk: 0.12, size: 2, minDepth: 2, maxDepth: 10 }],
    phase1: {
      palette: { top: 'luminous_moss', under: 'end_stone', core: 'end_stone', depth: 2 },
      features: [{ kind: 'plant', block: 'pale_grass', perChunk: 4, reach: 0 }],
    },
    mapColor: 0x5a6ad8,
  },
  {
    id: 'highlands',
    name: 'End Highlands',
    description: 'Thick, high continents of end stone, hollowed out by wide caves with vines hanging from their roofs.',
    sky: 0x0c1430,
    fog: 0x18244a,
    fogDensity: 0.35,
    light: 0.34,
    particles: { color: 0x5a7aff, motion: 'fall', rate: 0.2, glow: true },
    bed: 'highlands',
    palette: { top: 'end_stone', under: 'end_stone', core: 'voidstone', depth: 3 },
    terrain: { scale: 200, cover: 0.55, base: 74, rise: 14, relief: 4, reliefScale: 50, depth: 46, caves: 0.5, caveScale: 46 },
    features: [
      { kind: 'hanging', block: 'void_vines', perChunk: 10, height: 6, reach: 0 },
      { kind: 'cluster', block: 'voidstone', perChunk: 0.4, size: 2, reach: 3 },
      { kind: 'tree', block: 'chorus_plant', tree: 'chorus', perChunk: 0.4, reach: 4 },
    ],
    ores: [{ block: 'ender_ore', in: ['voidstone'], perChunk: 0.35, size: 3, minDepth: 12, maxDepth: 36, enclosed: true }],
    phase1: {
      palette: { top: 'end_stone', under: 'end_stone', core: 'voidstone', depth: 3 },
      features: [
        { kind: 'hanging', block: 'void_vines', perChunk: 10, height: 6, reach: 0 },
        { kind: 'cluster', block: 'voidstone', perChunk: 0.4, size: 2, reach: 3 },
      ],
    },
    mapColor: 0x3c3a5a,
  },
  {
    id: 'end_crystal_fields',
    name: 'End Crystal Fields',
    description: 'Rolling islands of sparkling stone where formations of glowing crystal grow from the ground.',
    sky: 0x3a2440,
    fog: 0x6a4a72,
    fogDensity: 0.15,
    light: 0.52,
    particles: { color: 0xffe8ff, motion: 'float', rate: 0.3, glow: true },
    bed: 'end_crystal_fields',
    palette: { top: 'crystalline_end_stone', under: 'crystalline_end_stone', core: 'end_stone', depth: 3 },
    terrain: { scale: 150, cover: 0.55, base: 66, rise: 12, relief: 6, reliefScale: 40, depth: 40 },
    features: [
      // Formations: crystal spires tipped with clusters, and clusters growing around them
      { kind: 'spire', block: 'prism_crystal', perChunk: 1, height: 4, size: 1, tip: 'end_crystal_cluster', reach: 0 },
      { kind: 'cluster', block: 'prism_crystal', perChunk: 0.4, size: 1, reach: 2 },
      { kind: 'plant', block: 'end_crystal_cluster', perChunk: 1.5, reach: 0 },
      { kind: 'plant', block: 'prism_cluster', perChunk: 4, reach: 0 },
    ],
    ores: [],
    phase1: {
      palette: { top: 'end_stone', under: 'end_stone', core: 'end_stone', depth: 3 },
      features: [
        { kind: 'spire', block: 'prism_crystal', perChunk: 1, height: 4, size: 1, tip: 'prism_cluster', reach: 0 },
        { kind: 'cluster', block: 'prism_crystal', perChunk: 0.4, size: 1, reach: 2 },
        { kind: 'plant', block: 'prism_cluster', perChunk: 6, reach: 0 },
      ],
    },
    mapColor: 0xf0c8f0,
  },
  {
    id: 'chorus_forest',
    name: 'Chorus Forest',
    description: 'Large islands overgrown with chorus plants, under the branches of giant chorus trees.',
    sky: 0x2c1838,
    fog: 0x5a3a6a,
    fogDensity: 0.32,
    light: 0.56,
    particles: { color: 0xe0b8f4, motion: 'float', rate: 0.4 },
    bed: 'chorus_forest',
    palette: { top: 'end_stone', under: 'end_stone', core: 'end_stone', depth: 4 },
    terrain: { scale: 320, cover: 0.62, base: 62, rise: 16, relief: 7, reliefScale: 55, depth: 45 },
    features: [
      { kind: 'tree', block: 'chorus_stalk', tree: 'giant_chorus', perChunk: 0.3, reach: 8 },
      { kind: 'tree', block: 'chorus_plant', tree: 'chorus', perChunk: 2.5, reach: 4 },
    ],
    ores: [],
    phase1: {
      palette: { top: 'end_sand', under: 'end_sand', core: 'end_stone', depth: 4 },
      features: [
        { kind: 'plant', block: 'dune_reed', perChunk: 5, reach: 0 },
        { kind: 'patch', block: 'dune_reed', perChunk: 1, size: 3, reach: 3 },
      ],
    },
    mapColor: 0x9a6aa8,
  },
  {
    id: 'void_wastes',
    name: 'Void Wastes',
    description: 'Low, scattered islands of dark end stone, half lost in a dark haze.',
    sky: 0x0c0a14,
    fog: 0x1c1628,
    fogDensity: 0.6,
    light: 0.36,
    particles: { color: 0x7a4ae0, motion: 'fall', rate: 0.45, glow: true },
    bed: 'void_wastes',
    palette: { top: 'dark_end_stone', under: 'dark_end_stone', core: 'end_stone', depth: 4 },
    terrain: { scale: 60, cover: 0.4, base: 52, rise: 6, relief: 2, reliefScale: 30, depth: 16 },
    features: [{ kind: 'plant', block: 'void_crystal', perChunk: 0.5, reach: 0 }],
    ores: [{ block: 'void_crystal_ore', in: ['dark_end_stone'], perChunk: 1.2, size: 4, minDepth: 1, maxDepth: 4 }],
    phase1: {
      palette: { top: 'pale_end_stone', under: 'end_stone', core: 'end_stone', depth: 2 },
      features: [
        { kind: 'plant', block: 'mist_bloom', perChunk: 5, reach: 0 },
        { kind: 'plant', block: 'pale_grass', perChunk: 6, reach: 0 },
      ],
    },
    mapColor: 0x3a3546,
  },
];

/** Phase 1 ids of the biomes (same slots), for saves made before phase 2 renamed them. */
export const PHASE1_BIOME_IDS: Readonly<Record<string, string>> = {
  pale_plains: 'end_barrens',
  shattered_spires: 'shattered_end',
  floating_archipelago: 'astral_end',
  hollow_isles: 'highlands',
  crystal_fields: 'end_crystal_fields',
  dune_isles: 'chorus_forest',
  mist_hollows: 'void_wastes',
};

/** A biome's surface palette and features in a world made by this generator version. */
export function surfaceOf(b: ExpansionBiome, version: number): { palette: Palette; features: FeatureSpec[]; ores: OreSpec[] } {
  return version >= EXPANSION_RESOURCES_GENERATOR ? b : { ...b.phase1, ores: [] };
}

export const EXPANSION_BIOME_IDS: readonly string[] = EXPANSION_BIOMES.map((b) => b.id);

export function expansionBiomeIndex(id: string): number {
  return EXPANSION_BIOME_IDS.indexOf(id);
}

export function expansionBiome(id: string): ExpansionBiome | undefined {
  return EXPANSION_BIOMES.find((b) => b.id === id);
}
