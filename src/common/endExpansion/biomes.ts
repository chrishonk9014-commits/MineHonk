/**
 * V6 - The End Expansion: the seven biomes of the Expanded End.
 *
 * Each entry carries everything the game needs about a biome: its name and
 * description, the shape of its land, its surface palette and landscape
 * features, and its atmosphere (sky tint, fog colour and density, ambient
 * particles and sound bed). The generator, the server, the client and the
 * Admin Panel all read this one table.
 */

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
  kind: 'plant' | 'patch' | 'spire' | 'cluster' | 'growth' | 'hanging';
  block: string;
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
  /** Ambient particles drifting around the player: colour, motion, how many (0..1), and whether they glow. */
  particles?: { color: number; motion: 'rise' | 'fall' | 'float'; rate: number; glow?: boolean };
  /** Ambient sound bed (a looping synth recipe in src/client/audio/synth.ts). */
  bed: string;
  /** Surface palette: top block, the blocks under it (to `depth`), and the core. */
  palette: { top: string; under: string; core: string; depth: number };
  terrain: TerrainStyle;
  features: FeatureSpec[];
  /** Map colour of the biome (minimap and admin). */
  mapColor: number;
}

export const EXPANSION_BIOMES: readonly ExpansionBiome[] = [
  {
    id: 'pale_plains',
    name: 'Pale Plains',
    description: 'Wide, flat islands of pale end stone, scattered with tufts of pale grass.',
    sky: 0x3b3552,
    fog: 0x6e6888,
    fogDensity: 0.12,
    particles: { color: 0xe8e4ff, motion: 'float', rate: 0.15 },
    bed: 'pale_plains',
    palette: { top: 'pale_end_stone', under: 'pale_end_stone', core: 'end_stone', depth: 2 },
    terrain: { scale: 240, cover: 0.62, base: 62, rise: 6, relief: 3, reliefScale: 70, depth: 30 },
    features: [
      { kind: 'plant', block: 'pale_grass', perChunk: 12, reach: 0 },
      { kind: 'patch', block: 'pale_grass', perChunk: 3, size: 3, reach: 3 },
      { kind: 'cluster', block: 'pale_end_stone', perChunk: 0.3, size: 2, reach: 3 },
    ],
    mapColor: 0xe6e2cf,
  },
  {
    id: 'shattered_spires',
    name: 'Shattered Spires',
    description: 'Tall, narrow islands of dark voidstone, broken into sheer stepped cliffs and needle-like spires.',
    sky: 0x24123a,
    fog: 0x3a1f52,
    fogDensity: 0.3,
    particles: { color: 0x9a6ad8, motion: 'rise', rate: 0.25, glow: true },
    bed: 'shattered_spires',
    palette: { top: 'voidstone', under: 'voidstone', core: 'voidstone', depth: 6 },
    terrain: { scale: 90, cover: 0.42, base: 72, rise: 40, relief: 4, reliefScale: 30, depth: 70, terrace: 5, ridges: 22, ridgeScale: 60 },
    features: [
      { kind: 'spire', block: 'voidstone', perChunk: 1.2, height: 10, size: 2, reach: 1 },
      { kind: 'spire', block: 'voidstone', perChunk: 2, height: 5, size: 1, reach: 0 },
    ],
    mapColor: 0x2a2038,
  },
  {
    id: 'floating_archipelago',
    name: 'Floating Archipelago',
    description: 'Strings of small islands hanging in the air at many heights, their tops covered in glowing moss.',
    sky: 0x0f2f36,
    fog: 0x1d4a50,
    fogDensity: 0.18,
    particles: { color: 0x6fe3d0, motion: 'rise', rate: 0.35, glow: true },
    bed: 'floating_archipelago',
    palette: { top: 'luminous_moss', under: 'end_stone', core: 'end_stone', depth: 2 },
    terrain: { scale: 80, cover: 0.36, base: 56, rise: 10, relief: 3, reliefScale: 30, depth: 20, chains: { lift: 28, wave: 20, density: 0.34, thickness: 10, scale: 120 } },
    features: [{ kind: 'plant', block: 'pale_grass', perChunk: 4, reach: 0 }],
    mapColor: 0x3fc8b4,
  },
  {
    id: 'hollow_isles',
    name: 'Hollow Isles',
    description: 'Thick islands hollowed out by wide caves, with vines hanging from the cave roofs.',
    sky: 0x0c1430,
    fog: 0x18244a,
    fogDensity: 0.4,
    particles: { color: 0x5a7aff, motion: 'fall', rate: 0.2, glow: true },
    bed: 'hollow_isles',
    palette: { top: 'end_stone', under: 'end_stone', core: 'voidstone', depth: 3 },
    terrain: { scale: 200, cover: 0.55, base: 74, rise: 14, relief: 4, reliefScale: 50, depth: 56, caves: 0.6, caveScale: 46 },
    features: [
      { kind: 'hanging', block: 'void_vines', perChunk: 26, height: 7, reach: 0 },
      { kind: 'cluster', block: 'voidstone', perChunk: 0.4, size: 2, reach: 3 },
    ],
    mapColor: 0x3c3a5a,
  },
  {
    id: 'crystal_fields',
    name: 'Crystal Fields',
    description: 'Rolling islands where clusters and spikes of glowing crystal grow from the ground.',
    sky: 0x3a2440,
    fog: 0x6a4a72,
    fogDensity: 0.15,
    particles: { color: 0xffe8ff, motion: 'float', rate: 0.3, glow: true },
    bed: 'crystal_fields',
    palette: { top: 'end_stone', under: 'end_stone', core: 'end_stone', depth: 3 },
    terrain: { scale: 150, cover: 0.55, base: 66, rise: 12, relief: 6, reliefScale: 40, depth: 40 },
    features: [
      { kind: 'spire', block: 'prism_crystal', perChunk: 1.4, height: 4, size: 1, tip: 'prism_cluster', reach: 0 },
      { kind: 'cluster', block: 'prism_crystal', perChunk: 0.6, size: 1, reach: 2 },
      { kind: 'plant', block: 'prism_cluster', perChunk: 9, reach: 0 },
    ],
    mapColor: 0xf0c8f0,
  },
  {
    id: 'dune_isles',
    name: 'Dune Isles',
    description: 'Large islands of soft end sand shaped into low dunes, under a dusty sky.',
    sky: 0x3a2c22,
    fog: 0x7a6248,
    fogDensity: 0.5,
    particles: { color: 0xd8c49a, motion: 'float', rate: 0.6 },
    bed: 'dune_isles',
    palette: { top: 'end_sand', under: 'end_sand', core: 'end_stone', depth: 4 },
    terrain: { scale: 320, cover: 0.62, base: 62, rise: 16, relief: 7, reliefScale: 55, depth: 45 },
    features: [
      { kind: 'plant', block: 'dune_reed', perChunk: 5, reach: 0 },
      { kind: 'patch', block: 'dune_reed', perChunk: 1, size: 3, reach: 3 },
    ],
    mapColor: 0xd9c9a0,
  },
  {
    id: 'mist_hollows',
    name: 'Mist Hollows',
    description: 'Low, scattered islands lost in thick white mist.',
    sky: 0x8a8e9c,
    fog: 0xc8ccd8,
    fogDensity: 0.85,
    particles: { color: 0xf0f4ff, motion: 'float', rate: 0.7 },
    bed: 'mist_hollows',
    palette: { top: 'pale_end_stone', under: 'end_stone', core: 'end_stone', depth: 2 },
    terrain: { scale: 60, cover: 0.4, base: 52, rise: 6, relief: 2, reliefScale: 30, depth: 16 },
    features: [
      { kind: 'plant', block: 'mist_bloom', perChunk: 5, reach: 0 },
      { kind: 'plant', block: 'pale_grass', perChunk: 6, reach: 0 },
    ],
    mapColor: 0xc8ccd8,
  },
];

export const EXPANSION_BIOME_IDS: readonly string[] = EXPANSION_BIOMES.map((b) => b.id);

export function expansionBiomeIndex(id: string): number {
  return EXPANSION_BIOME_IDS.indexOf(id);
}

export function expansionBiome(id: string): ExpansionBiome | undefined {
  return EXPANSION_BIOMES.find((b) => b.id === id);
}
