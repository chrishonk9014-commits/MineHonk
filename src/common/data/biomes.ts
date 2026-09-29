/**
 * Biome definitions. Colours follow the familiar Minecraft-like palette
 * (grass/foliage/water tints), expressed as explicit per-biome values.
 */
export type DimensionId = 'overworld' | 'nether' | 'end' | 'farlands';
export type TreeKind =
  | 'oak'
  | 'fancy_oak'
  | 'birch'
  | 'tall_birch'
  | 'spruce'
  | 'pine'
  | 'mega_spruce'
  | 'jungle'
  | 'mega_jungle'
  | 'jungle_bush'
  | 'acacia'
  | 'dark_oak'
  | 'swamp_oak'
  | 'mangrove'
  | 'cherry'
  | 'azalea'
  | 'huge_red_mushroom'
  | 'huge_brown_mushroom'
  | 'crimson_fungus'
  | 'warped_fungus'
  | 'null_tree'
  | 'chorus';

export interface SpawnEntry {
  mob: string;
  weight: number;
  min: number;
  max: number;
}

export interface BiomeDef {
  id: string;
  name: string;
  dimension: DimensionId;
  category: string;
  temperature: number;
  downfall: number;
  precipitation: 'rain' | 'snow' | 'none';
  grass: number;
  foliage: number;
  water: number;
  sky: number;
  fog: number;
  surface: { top: string; filler: string; underwater?: string; depth?: number };
  trees?: { kind: TreeKind; weight: number }[];
  /** Average number of trees per chunk. */
  treeDensity?: number;
  grassDensity?: number;
  flowers?: string[];
  flowerDensity?: number;
  spawns?: { creature?: SpawnEntry[]; monster?: SpawnEntry[]; water?: SpawnEntry[]; ambient?: SpawnEntry[] };
  /** Rare biomes appear only under special climate conditions. */
  rare?: boolean;
  ambience?: { particles?: string; mood?: string; music?: string };
}

const DEFAULT_MONSTERS: SpawnEntry[] = [
  { mob: 'zombie', weight: 95, min: 2, max: 4 },
  { mob: 'skeleton', weight: 100, min: 2, max: 4 },
  { mob: 'spider', weight: 100, min: 2, max: 3 },
  { mob: 'creeper', weight: 100, min: 1, max: 2 },
  { mob: 'enderman', weight: 10, min: 1, max: 2 },
  { mob: 'witch', weight: 5, min: 1, max: 1 },
];
const FARM: SpawnEntry[] = [
  { mob: 'sheep', weight: 12, min: 2, max: 4 },
  { mob: 'pig', weight: 10, min: 2, max: 4 },
  { mob: 'chicken', weight: 10, min: 2, max: 4 },
  { mob: 'cow', weight: 8, min: 2, max: 4 },
];
const OCEAN_WATER: SpawnEntry[] = [
  { mob: 'cod', weight: 10, min: 3, max: 6 },
  { mob: 'squid', weight: 4, min: 1, max: 4 },
];

const defs: BiomeDef[] = [];
function ow(d: Omit<BiomeDef, 'dimension' | 'sky' | 'fog'> & { sky?: number; fog?: number }): void {
  defs.push({
    dimension: 'overworld',
    sky: skyColor(d.temperature),
    fog: 0xc0d8ff,
    spawns: { creature: FARM, monster: DEFAULT_MONSTERS, ambient: [{ mob: 'bat', weight: 10, min: 8, max: 8 }] },
    ...d,
  });
}

/** Sky colour derived from temperature (warmer = paler), similar in spirit to Minecraft. */
function skyColor(t: number): number {
  const k = Math.max(-1, Math.min(1, t / 3));
  const h = 0.6222 - k * 0.05;
  const s = 0.5 + k * 0.1;
  const v = 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const tt = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = v; g = tt; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = tt; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = tt; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

const GRASS = { top: 'grass_block', filler: 'dirt', underwater: 'dirt', depth: 3 };
const TEMPERATE_FLOWERS = ['dandelion', 'poppy'];

// --- Oceans ------------------------------------------------------------
const oceanSpawns = { creature: [], monster: DEFAULT_MONSTERS, water: OCEAN_WATER };
ow({ id: 'ocean', name: 'Ocean', category: 'ocean', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4, surface: { top: 'gravel', filler: 'gravel', underwater: 'gravel', depth: 3 }, spawns: oceanSpawns });
ow({ id: 'deep_ocean', name: 'Deep Ocean', category: 'ocean', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4, surface: { top: 'gravel', filler: 'gravel', underwater: 'gravel', depth: 3 }, spawns: { ...oceanSpawns, monster: [...DEFAULT_MONSTERS, { mob: 'drowned', weight: 20, min: 1, max: 2 }] } });
ow({ id: 'warm_ocean', name: 'Warm Ocean', category: 'ocean', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x43d5ee, surface: { top: 'sand', filler: 'sand', underwater: 'sand', depth: 3 }, spawns: { ...oceanSpawns, water: [{ mob: 'tropical_fish', weight: 15, min: 4, max: 8 }, { mob: 'pufferfish', weight: 5, min: 1, max: 3 }] } });
ow({ id: 'lukewarm_ocean', name: 'Lukewarm Ocean', category: 'ocean', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x45adf2, surface: { top: 'sand', filler: 'sand', underwater: 'sand', depth: 3 }, spawns: oceanSpawns });
ow({ id: 'cold_ocean', name: 'Cold Ocean', category: 'ocean', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3d57d6, surface: { top: 'gravel', filler: 'gravel', underwater: 'gravel', depth: 3 }, spawns: { ...oceanSpawns, water: [{ mob: 'salmon', weight: 15, min: 1, max: 5 }, { mob: 'squid', weight: 3, min: 1, max: 4 }] } });
ow({ id: 'frozen_ocean', name: 'Frozen Ocean', category: 'ocean', temperature: 0, downfall: 0.5, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3938c9, surface: { top: 'gravel', filler: 'gravel', underwater: 'gravel', depth: 3 }, spawns: { creature: [{ mob: 'polar_bear', weight: 1, min: 1, max: 2 }], monster: DEFAULT_MONSTERS, water: [{ mob: 'salmon', weight: 15, min: 1, max: 5 }] } });
ow({ id: 'mushroom_fields', name: 'Mushroom Fields', category: 'mushroom', temperature: 0.9, downfall: 1, precipitation: 'rain', grass: 0x55c93f, foliage: 0x2bbb0f, water: 0x3f76e4, surface: { top: 'mycelium', filler: 'dirt', depth: 3 }, trees: [{ kind: 'huge_red_mushroom', weight: 1 }, { kind: 'huge_brown_mushroom', weight: 1 }], treeDensity: 0.4, spawns: { creature: [{ mob: 'mooshroom', weight: 8, min: 4, max: 8 }], monster: [] }, rare: true });

// --- Coasts / rivers ------------------------------------------------------
ow({ id: 'beach', name: 'Beach', category: 'beach', temperature: 0.8, downfall: 0.4, precipitation: 'rain', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, surface: { top: 'sand', filler: 'sand', underwater: 'sand', depth: 4 }, spawns: { creature: [{ mob: 'turtle', weight: 5, min: 2, max: 5 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'snowy_beach', name: 'Snowy Beach', category: 'beach', temperature: 0.05, downfall: 0.3, precipitation: 'snow', grass: 0x83b593, foliage: 0x64a278, water: 0x3d57d6, surface: { top: 'sand', filler: 'sand', underwater: 'sand', depth: 4 } });
ow({ id: 'stony_shore', name: 'Stony Shore', category: 'beach', temperature: 0.2, downfall: 0.3, precipitation: 'rain', grass: 0x8ab689, foliage: 0x6da36b, water: 0x3f76e4, surface: { top: 'stone', filler: 'stone', underwater: 'gravel', depth: 1 } });
ow({ id: 'river', name: 'River', category: 'river', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4, surface: { top: 'grass_block', filler: 'dirt', underwater: 'sand', depth: 3 }, spawns: { creature: [], monster: DEFAULT_MONSTERS, water: [{ mob: 'salmon', weight: 5, min: 1, max: 5 }, { mob: 'squid', weight: 2, min: 1, max: 4 }] } });
ow({ id: 'frozen_river', name: 'Frozen River', category: 'river', temperature: 0, downfall: 0.5, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3938c9, surface: { top: 'grass_block', filler: 'dirt', underwater: 'gravel', depth: 3 } });

// --- Temperate -------------------------------------------------------------
ow({ id: 'plains', name: 'Plains', category: 'plains', temperature: 0.8, downfall: 0.4, precipitation: 'rain', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'oak', weight: 9 }, { kind: 'fancy_oak', weight: 1 }], treeDensity: 0.05, grassDensity: 0.35, flowers: TEMPERATE_FLOWERS.concat(['azure_bluet', 'oxeye_daisy', 'cornflower', 'red_tulip', 'white_tulip']), flowerDensity: 0.02, spawns: { creature: [...FARM, { mob: 'horse', weight: 5, min: 2, max: 6 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'sunflower_plains', name: 'Sunflower Plains', category: 'plains', temperature: 0.8, downfall: 0.4, precipitation: 'rain', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'oak', weight: 1 }], treeDensity: 0.03, grassDensity: 0.4, flowers: ['sunflower', 'dandelion', 'poppy'], flowerDensity: 0.05, rare: true });
ow({ id: 'meadow', name: 'Meadow', category: 'mountain', temperature: 0.5, downfall: 0.8, precipitation: 'rain', grass: 0x83bb6d, foliage: 0x63a948, water: 0x0e4ecf, surface: GRASS, trees: [{ kind: 'birch', weight: 1 }, { kind: 'oak', weight: 1 }], treeDensity: 0.02, grassDensity: 0.6, flowers: ['dandelion', 'poppy', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower'], flowerDensity: 0.08, spawns: { creature: [{ mob: 'rabbit', weight: 2, min: 2, max: 6 }, { mob: 'sheep', weight: 2, min: 2, max: 4 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'cherry_grove', name: 'Cherry Grove', category: 'mountain', temperature: 0.5, downfall: 0.8, precipitation: 'rain', grass: 0xb6db61, foliage: 0xb6db61, water: 0x5db7ef, surface: GRASS, trees: [{ kind: 'cherry', weight: 1 }], treeDensity: 1.2, grassDensity: 0.4, flowers: ['pink_tulip', 'allium'], flowerDensity: 0.05, rare: true });
ow({ id: 'forest', name: 'Forest', category: 'forest', temperature: 0.7, downfall: 0.8, precipitation: 'rain', grass: 0x79c05a, foliage: 0x59ae30, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'oak', weight: 8 }, { kind: 'fancy_oak', weight: 1 }, { kind: 'birch', weight: 2 }], treeDensity: 8, grassDensity: 0.15, flowers: TEMPERATE_FLOWERS.concat(['lily_of_the_valley']), flowerDensity: 0.01, spawns: { creature: [...FARM, { mob: 'wolf', weight: 5, min: 4, max: 4 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'flower_forest', name: 'Flower Forest', category: 'forest', temperature: 0.7, downfall: 0.8, precipitation: 'rain', grass: 0x79c05a, foliage: 0x59ae30, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'oak', weight: 3 }, { kind: 'birch', weight: 1 }], treeDensity: 3, grassDensity: 0.1, flowers: ['dandelion', 'poppy', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'lilac', 'rose_bush', 'peony'], flowerDensity: 0.25, rare: true, spawns: { creature: [...FARM, { mob: 'rabbit', weight: 4, min: 2, max: 3 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'birch_forest', name: 'Birch Forest', category: 'forest', temperature: 0.6, downfall: 0.6, precipitation: 'rain', grass: 0x88bb67, foliage: 0x6ba941, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'birch', weight: 1 }], treeDensity: 8, grassDensity: 0.15, flowers: TEMPERATE_FLOWERS, flowerDensity: 0.01 });
ow({ id: 'old_growth_birch_forest', name: 'Old Growth Birch Forest', category: 'forest', temperature: 0.6, downfall: 0.6, precipitation: 'rain', grass: 0x88bb67, foliage: 0x6ba941, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'tall_birch', weight: 1 }], treeDensity: 8, grassDensity: 0.15, rare: true });
ow({ id: 'dark_forest', name: 'Dark Forest', category: 'forest', temperature: 0.7, downfall: 0.8, precipitation: 'rain', grass: 0x507a32, foliage: 0x59ae30, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'dark_oak', weight: 12 }, { kind: 'huge_red_mushroom', weight: 1 }, { kind: 'huge_brown_mushroom', weight: 1 }, { kind: 'oak', weight: 2 }], treeDensity: 14, grassDensity: 0.08, flowers: ['glowbell', 'poppy'], flowerDensity: 0.01, spawns: { creature: FARM, monster: [...DEFAULT_MONSTERS] } });
ow({ id: 'swamp', name: 'Swamp', category: 'swamp', temperature: 0.8, downfall: 0.9, precipitation: 'rain', grass: 0x6a7039, foliage: 0x6a7039, water: 0x617b64, surface: GRASS, trees: [{ kind: 'swamp_oak', weight: 1 }], treeDensity: 2, grassDensity: 0.2, flowers: ['blue_orchid'], flowerDensity: 0.02, spawns: { creature: [...FARM, { mob: 'frog', weight: 10, min: 2, max: 5 }], monster: [...DEFAULT_MONSTERS, { mob: 'slime', weight: 1, min: 1, max: 1 }, { mob: 'witch', weight: 10, min: 1, max: 1 }] } });
ow({ id: 'mangrove_swamp', name: 'Mangrove Swamp', category: 'swamp', temperature: 0.8, downfall: 0.9, precipitation: 'rain', grass: 0x6a7039, foliage: 0x8db127, water: 0x3a7a6a, surface: { top: 'mud', filler: 'mud', underwater: 'mud', depth: 4 }, trees: [{ kind: 'mangrove', weight: 1 }], treeDensity: 8, grassDensity: 0.1, spawns: { creature: [{ mob: 'frog', weight: 10, min: 2, max: 5 }], monster: [...DEFAULT_MONSTERS, { mob: 'slime', weight: 1, min: 1, max: 1 }] } });

// --- Cold -------------------------------------------------------------------
ow({ id: 'taiga', name: 'Taiga', category: 'taiga', temperature: 0.25, downfall: 0.8, precipitation: 'rain', grass: 0x86b783, foliage: 0x68a464, water: 0x287082, surface: GRASS, trees: [{ kind: 'spruce', weight: 2 }, { kind: 'pine', weight: 1 }], treeDensity: 7, grassDensity: 0.2, flowers: [], spawns: { creature: [...FARM, { mob: 'wolf', weight: 8, min: 4, max: 4 }, { mob: 'rabbit', weight: 4, min: 2, max: 3 }, { mob: 'fox', weight: 8, min: 2, max: 4 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'old_growth_spruce_taiga', name: 'Old Growth Spruce Taiga', category: 'taiga', temperature: 0.25, downfall: 0.8, precipitation: 'rain', grass: 0x86b87f, foliage: 0x68a55f, water: 0x3f76e4, surface: { top: 'podzol', filler: 'dirt', depth: 3 }, trees: [{ kind: 'mega_spruce', weight: 2 }, { kind: 'spruce', weight: 3 }], treeDensity: 8, grassDensity: 0.25, rare: true });
ow({ id: 'snowy_taiga', name: 'Snowy Taiga', category: 'taiga', temperature: -0.5, downfall: 0.4, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x205e83, surface: GRASS, trees: [{ kind: 'spruce', weight: 2 }, { kind: 'pine', weight: 1 }], treeDensity: 6, grassDensity: 0.1, spawns: { creature: [{ mob: 'wolf', weight: 8, min: 4, max: 4 }, { mob: 'rabbit', weight: 4, min: 2, max: 3 }, { mob: 'fox', weight: 8, min: 2, max: 4 }], monster: [...DEFAULT_MONSTERS, { mob: 'stray', weight: 40, min: 2, max: 4 }] } });
ow({ id: 'snowy_plains', name: 'Snowy Plains', category: 'icy', temperature: 0, downfall: 0.5, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'spruce', weight: 1 }], treeDensity: 0.1, grassDensity: 0.05, spawns: { creature: [{ mob: 'rabbit', weight: 10, min: 2, max: 3 }, { mob: 'polar_bear', weight: 1, min: 1, max: 2 }], monster: [...DEFAULT_MONSTERS.filter((m) => m.mob !== 'skeleton'), { mob: 'stray', weight: 80, min: 4, max: 4 }] } });
ow({ id: 'ice_spikes', name: 'Ice Spikes', category: 'icy', temperature: 0, downfall: 0.5, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3f76e4, surface: { top: 'snow_block', filler: 'dirt', depth: 3 }, rare: true, spawns: { creature: [{ mob: 'rabbit', weight: 10, min: 2, max: 3 }, { mob: 'polar_bear', weight: 1, min: 1, max: 2 }], monster: [{ mob: 'stray', weight: 80, min: 4, max: 4 }, ...DEFAULT_MONSTERS.filter((m) => m.mob !== 'skeleton')] } });
ow({ id: 'grove', name: 'Grove', category: 'mountain', temperature: -0.2, downfall: 0.8, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3f76e4, surface: { top: 'snow_block', filler: 'dirt', depth: 3 }, trees: [{ kind: 'spruce', weight: 1 }], treeDensity: 5, spawns: { creature: [{ mob: 'wolf', weight: 8, min: 4, max: 4 }, { mob: 'rabbit', weight: 4, min: 2, max: 3 }, { mob: 'fox', weight: 8, min: 2, max: 4 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'snowy_slopes', name: 'Snowy Slopes', category: 'mountain', temperature: -0.3, downfall: 0.9, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3f76e4, surface: { top: 'snow_block', filler: 'snow_block', depth: 2 }, spawns: { creature: [{ mob: 'goat', weight: 5, min: 1, max: 3 }, { mob: 'rabbit', weight: 4, min: 2, max: 3 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'frozen_peaks', name: 'Frozen Peaks', category: 'mountain', temperature: -0.7, downfall: 0.9, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3f76e4, surface: { top: 'packed_ice', filler: 'snow_block', depth: 2 }, spawns: { creature: [{ mob: 'goat', weight: 5, min: 1, max: 3 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'jagged_peaks', name: 'Jagged Peaks', category: 'mountain', temperature: -0.7, downfall: 0.9, precipitation: 'snow', grass: 0x80b497, foliage: 0x60a17b, water: 0x3f76e4, surface: { top: 'snow_block', filler: 'stone', depth: 1 }, spawns: { creature: [{ mob: 'goat', weight: 5, min: 1, max: 3 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'stony_peaks', name: 'Stony Peaks', category: 'mountain', temperature: 1, downfall: 0.3, precipitation: 'rain', grass: 0x9abe4b, foliage: 0x82ac1e, water: 0x3f76e4, surface: { top: 'stone', filler: 'stone', depth: 1 }, spawns: { creature: [], monster: DEFAULT_MONSTERS } });
ow({ id: 'windswept_hills', name: 'Windswept Hills', category: 'mountain', temperature: 0.2, downfall: 0.3, precipitation: 'rain', grass: 0x8ab689, foliage: 0x6da36b, water: 0x3f76e4, surface: GRASS, trees: [{ kind: 'spruce', weight: 2 }, { kind: 'oak', weight: 1 }], treeDensity: 0.4, grassDensity: 0.2, spawns: { creature: [...FARM, { mob: 'goat', weight: 3, min: 1, max: 3 }, { mob: 'sky_ray', weight: 1, min: 1, max: 1 }], monster: DEFAULT_MONSTERS } });

// --- Warm / dry ------------------------------------------------------------
ow({ id: 'desert', name: 'Desert', category: 'desert', temperature: 2, downfall: 0, precipitation: 'none', grass: 0xbfb755, foliage: 0xaea42a, water: 0x32a598, surface: { top: 'sand', filler: 'sand', underwater: 'sand', depth: 4 }, flowers: [], spawns: { creature: [{ mob: 'rabbit', weight: 4, min: 2, max: 3 }, { mob: 'camel', weight: 1, min: 1, max: 1 }], monster: [...DEFAULT_MONSTERS.filter((m) => m.mob !== 'zombie'), { mob: 'husk', weight: 80, min: 4, max: 4 }, { mob: 'zombie', weight: 19, min: 4, max: 4 }] } });
ow({ id: 'savanna', name: 'Savanna', category: 'savanna', temperature: 1.2, downfall: 0, precipitation: 'none', grass: 0xbfb755, foliage: 0xaea42a, water: 0x2c8b9c, surface: GRASS, trees: [{ kind: 'acacia', weight: 4 }, { kind: 'oak', weight: 1 }], treeDensity: 1, grassDensity: 0.5, spawns: { creature: [...FARM, { mob: 'horse', weight: 1, min: 2, max: 6 }, { mob: 'llama', weight: 8, min: 4, max: 4 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'savanna_plateau', name: 'Savanna Plateau', category: 'savanna', temperature: 1, downfall: 0, precipitation: 'none', grass: 0xbfb755, foliage: 0xaea42a, water: 0x2c8b9c, surface: GRASS, trees: [{ kind: 'acacia', weight: 4 }, { kind: 'oak', weight: 1 }], treeDensity: 1.5, grassDensity: 0.5 });
ow({ id: 'badlands', name: 'Badlands', category: 'mesa', temperature: 2, downfall: 0, precipitation: 'none', grass: 0x90814d, foliage: 0x9e814d, water: 0x3f76e4, surface: { top: 'red_sand', filler: 'terracotta', underwater: 'red_sand', depth: 3 }, flowers: [], spawns: { creature: [], monster: DEFAULT_MONSTERS } });
ow({ id: 'wooded_badlands', name: 'Wooded Badlands', category: 'mesa', temperature: 2, downfall: 0, precipitation: 'none', grass: 0x90814d, foliage: 0x9e814d, water: 0x3f76e4, surface: { top: 'coarse_dirt', filler: 'terracotta', depth: 3 }, trees: [{ kind: 'oak', weight: 1 }], treeDensity: 2, rare: true });
ow({ id: 'eroded_badlands', name: 'Eroded Badlands', category: 'mesa', temperature: 2, downfall: 0, precipitation: 'none', grass: 0x90814d, foliage: 0x9e814d, water: 0x3f76e4, surface: { top: 'red_sand', filler: 'terracotta', depth: 3 }, rare: true });
ow({ id: 'jungle', name: 'Jungle', category: 'jungle', temperature: 0.95, downfall: 0.9, precipitation: 'rain', grass: 0x59c93c, foliage: 0x30bb0b, water: 0x14a2c5, surface: GRASS, trees: [{ kind: 'jungle', weight: 4 }, { kind: 'mega_jungle', weight: 2 }, { kind: 'jungle_bush', weight: 5 }, { kind: 'fancy_oak', weight: 1 }], treeDensity: 18, grassDensity: 0.5, flowers: ['poppy', 'dandelion'], flowerDensity: 0.01, spawns: { creature: [...FARM, { mob: 'parrot', weight: 40, min: 1, max: 2 }, { mob: 'ocelot', weight: 2, min: 1, max: 3 }, { mob: 'panda', weight: 1, min: 1, max: 2 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'sparse_jungle', name: 'Sparse Jungle', category: 'jungle', temperature: 0.95, downfall: 0.8, precipitation: 'rain', grass: 0x64c73f, foliage: 0x3eb80f, water: 0x0d8ae3, surface: GRASS, trees: [{ kind: 'jungle', weight: 1 }, { kind: 'jungle_bush', weight: 2 }], treeDensity: 2, grassDensity: 0.5 });
ow({ id: 'bamboo_jungle', name: 'Bamboo Jungle', category: 'jungle', temperature: 0.95, downfall: 0.9, precipitation: 'rain', grass: 0x59c93c, foliage: 0x30bb0b, water: 0x14a2c5, surface: { top: 'podzol', filler: 'dirt', depth: 3 }, trees: [{ kind: 'jungle', weight: 1 }, { kind: 'jungle_bush', weight: 3 }], treeDensity: 4, grassDensity: 0.3, rare: true });

// --- Cave biomes (underground decoration) ---------------------------------------
ow({ id: 'lush_caves', name: 'Lush Caves', category: 'underground', temperature: 0.5, downfall: 0.5, precipitation: 'rain', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4, surface: GRASS, spawns: { water: [{ mob: 'axolotl', weight: 10, min: 4, max: 6 }], monster: DEFAULT_MONSTERS } });
ow({ id: 'dripstone_caves', name: 'Dripstone Caves', category: 'underground', temperature: 0.8, downfall: 0.4, precipitation: 'rain', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, surface: GRASS, spawns: { monster: [...DEFAULT_MONSTERS, { mob: 'drowned', weight: 95, min: 4, max: 4 }, { mob: 'cave_stalker', weight: 10, min: 1, max: 1 }] } });
ow({ id: 'deep_dark', name: 'Deep Dark', category: 'underground', temperature: 0.8, downfall: 0.4, precipitation: 'rain', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, surface: GRASS, rare: true, spawns: { creature: [], monster: [{ mob: 'cave_stalker', weight: 20, min: 1, max: 1 }] } });

// --- Nether ------------------------------------------------------------------
function nether(d: Omit<BiomeDef, 'dimension' | 'precipitation' | 'temperature' | 'downfall' | 'grass' | 'foliage' | 'water' | 'sky'>): void {
  defs.push({ dimension: 'nether', precipitation: 'none', temperature: 2, downfall: 0, grass: 0xbfb755, foliage: 0xaea42a, water: 0x3f76e4, sky: 0x000000, ...d });
}
nether({ id: 'nether_wastes', name: 'Nether Wastes', category: 'nether', fog: 0x330808, surface: { top: 'netherrack', filler: 'netherrack' }, spawns: { monster: [{ mob: 'ghast', weight: 50, min: 1, max: 1 }, { mob: 'zombified_piglin', weight: 100, min: 4, max: 4 }, { mob: 'magma_cube', weight: 2, min: 4, max: 4 }, { mob: 'enderman', weight: 1, min: 4, max: 4 }, { mob: 'piglin', weight: 15, min: 4, max: 4 }, { mob: 'ember_beast', weight: 3, min: 1, max: 1 }] }, ambience: { particles: 'ash', mood: 'nether' } });
nether({ id: 'crimson_forest', name: 'Crimson Forest', category: 'nether', fog: 0x330303, surface: { top: 'crimson_nylium', filler: 'netherrack' }, trees: [{ kind: 'crimson_fungus', weight: 1 }], treeDensity: 8, spawns: { monster: [{ mob: 'zombified_piglin', weight: 1, min: 2, max: 4 }, { mob: 'hoglin', weight: 9, min: 3, max: 4 }, { mob: 'piglin', weight: 5, min: 3, max: 4 }] }, ambience: { particles: 'crimson_spore' } });
nether({ id: 'warped_forest', name: 'Warped Forest', category: 'nether', fog: 0x1a051a, surface: { top: 'warped_nylium', filler: 'netherrack' }, trees: [{ kind: 'warped_fungus', weight: 1 }], treeDensity: 8, spawns: { monster: [{ mob: 'enderman', weight: 1, min: 4, max: 4 }] }, ambience: { particles: 'warped_spore' } });
nether({ id: 'soul_sand_valley', name: 'Soul Sand Valley', category: 'nether', fog: 0x1b4745, surface: { top: 'soul_sand', filler: 'soul_soil' }, spawns: { monster: [{ mob: 'skeleton', weight: 20, min: 5, max: 5 }, { mob: 'ghast', weight: 50, min: 1, max: 1 }, { mob: 'enderman', weight: 1, min: 4, max: 4 }] }, ambience: { particles: 'ash' } });
nether({ id: 'basalt_deltas', name: 'Basalt Deltas', category: 'nether', fog: 0x685f70, surface: { top: 'basalt', filler: 'blackstone' }, spawns: { monster: [{ mob: 'ghast', weight: 40, min: 1, max: 1 }, { mob: 'magma_cube', weight: 100, min: 2, max: 5 }, { mob: 'ember_beast', weight: 6, min: 1, max: 1 }] }, ambience: { particles: 'white_ash' } });
// Original Nether biome
nether({ id: 'ember_wastes', name: 'Ember Wastes', category: 'nether', fog: 0x4a1800, surface: { top: 'smoldering_netherrack', filler: 'netherrack' }, rare: true, spawns: { monster: [{ mob: 'ember_beast', weight: 30, min: 1, max: 2 }, { mob: 'magma_cube', weight: 20, min: 2, max: 4 }, { mob: 'blaze', weight: 5, min: 1, max: 2 }] }, ambience: { particles: 'ember' } });

// --- End ---------------------------------------------------------------------------
function end(d: Omit<BiomeDef, 'dimension' | 'precipitation' | 'temperature' | 'downfall' | 'grass' | 'foliage' | 'water' | 'sky' | 'fog'>): void {
  defs.push({ dimension: 'end', precipitation: 'none', temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4, sky: 0x000000, fog: 0x0a080c, ...d });
}
end({ id: 'the_end', name: 'The End', category: 'end', surface: { top: 'end_stone', filler: 'end_stone' }, spawns: { monster: [{ mob: 'enderman', weight: 10, min: 4, max: 4 }] } });
end({ id: 'end_highlands', name: 'End Highlands', category: 'end', surface: { top: 'end_stone', filler: 'end_stone' }, trees: [{ kind: 'chorus', weight: 1 }], treeDensity: 1, spawns: { monster: [{ mob: 'enderman', weight: 10, min: 4, max: 4 }, { mob: 'shulker', weight: 1, min: 1, max: 1 }] } });
end({ id: 'end_midlands', name: 'End Midlands', category: 'end', surface: { top: 'end_stone', filler: 'end_stone' }, spawns: { monster: [{ mob: 'enderman', weight: 10, min: 4, max: 4 }] } });
end({ id: 'small_end_islands', name: 'Small End Islands', category: 'end', surface: { top: 'end_stone', filler: 'end_stone' }, spawns: { monster: [{ mob: 'enderman', weight: 10, min: 4, max: 4 }] } });
end({ id: 'void_reach', name: 'Void Reach', category: 'end', surface: { top: 'end_stone', filler: 'end_stone' }, rare: true, spawns: { monster: [{ mob: 'enderman', weight: 6, min: 1, max: 2 }, { mob: 'void_wisp', weight: 4, min: 1, max: 3 }] } });

// --- Farlands ----------------------------------------------------------------------
function far(d: Omit<BiomeDef, 'dimension' | 'precipitation' | 'temperature' | 'downfall'>): void {
  defs.push({ dimension: 'farlands', precipitation: 'none', temperature: 0.4, downfall: 0.2, ...d });
}
const FAR_MONSTERS: SpawnEntry[] = [
  { mob: 'farlands_wanderer', weight: 40, min: 1, max: 2 },
  { mob: 'rift_walker', weight: 15, min: 1, max: 1 },
  { mob: 'glitch_zombie', weight: 60, min: 2, max: 4 },
  { mob: 'glitch_skeleton', weight: 40, min: 1, max: 3 },
];
far({ id: 'overflow_walls', name: 'Overflow Walls', category: 'farlands', grass: 0x4aa38a, foliage: 0x3f8f7a, water: 0x7a3fe4, sky: 0x8a9bb0, fog: 0x9aa7b8, surface: { top: 'far_grass_block', filler: 'far_dirt', depth: 3 }, trees: [{ kind: 'null_tree', weight: 1 }], treeDensity: 0.5, spawns: { monster: FAR_MONSTERS, creature: [{ mob: 'glitched_cow', weight: 5, min: 2, max: 3 }] }, ambience: { particles: 'glitch' } });
far({ id: 'stretched_plains', name: 'Stretched Plains', category: 'farlands', grass: 0x62b08e, foliage: 0x4a9f7a, water: 0x7a3fe4, sky: 0x9fb2c8, fog: 0xa9b8c9, surface: { top: 'far_grass_block', filler: 'far_dirt', depth: 3 }, trees: [{ kind: 'null_tree', weight: 1 }], treeDensity: 0.2, grassDensity: 0.3, spawns: { monster: FAR_MONSTERS, creature: [{ mob: 'glitched_cow', weight: 8, min: 2, max: 4 }, { mob: 'glitched_sheep', weight: 8, min: 2, max: 4 }] }, ambience: { particles: 'glitch' } });
far({ id: 'shattered_expanse', name: 'Shattered Expanse', category: 'farlands', grass: 0x557a7a, foliage: 0x4a6f6f, water: 0x7a3fe4, sky: 0x6c7584, fog: 0x7c8594, surface: { top: 'corrupted_stone', filler: 'farstone', depth: 2 }, spawns: { monster: [...FAR_MONSTERS, { mob: 'glitch_beast', weight: 2, min: 1, max: 1 }] }, ambience: { particles: 'glitch' } });
far({ id: 'static_fields', name: 'Static Fields', category: 'farlands', grass: 0x8a8a8a, foliage: 0x7a7a7a, water: 0x7a3fe4, sky: 0x5a5a5a, fog: 0x6a6a6a, surface: { top: 'static_block', filler: 'farstone', depth: 1 }, rare: true, spawns: { monster: [...FAR_MONSTERS, { mob: 'rift_walker', weight: 30, min: 1, max: 2 }] }, ambience: { particles: 'static' } });
far({ id: 'null_forest', name: 'Null Forest', category: 'farlands', grass: 0x2f6b62, foliage: 0x2a5f58, water: 0x7a3fe4, sky: 0x74849a, fog: 0x7c8ca2, surface: { top: 'far_grass_block', filler: 'far_dirt', depth: 3 }, trees: [{ kind: 'null_tree', weight: 1 }], treeDensity: 6, grassDensity: 0.3, spawns: { monster: FAR_MONSTERS }, ambience: { particles: 'glitch' } });

export const BIOME_DEFS: readonly BiomeDef[] = defs;
