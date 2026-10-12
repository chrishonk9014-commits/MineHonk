/**
 * Cave biomes (V2): a 3D biome layer underground, independent of the surface
 * biome above (except that cold lands tend to have frozen caves beneath).
 *
 * The biome at a position is a pure function of (seed, x, y, z, surface
 * climate), so world generation, mob spawning and the server's ambience
 * messages always agree. World generation samples it once per 4x4x4 cell and
 * keeps the result in the proto chunk for decoration.
 */
import { Octave2, Octave3 } from '../../math/noise';
import { Random, hashInts } from '../../math/rng';

export const enum CaveBiome {
  None = 0,
  Caves = 1,
  Deep = 2,
  Lush = 3,
  Mushroom = 4,
  Crystal = 5,
  Dripstone = 6,
  Lava = 7,
  Frozen = 8,
  DeepDark = 9,
  /** V3: rare zones where the world failed to generate (see corrupted.ts). */
  Corrupted = 10,
}

export interface CaveBiomeInfo {
  id: string;
  name: string;
  /** Fog tint while inside (rgb hex). */
  fog: number;
  /** How far fog closes in (1 = normal cave, lower = thicker). */
  fogDensity: number;
  /** Ambient particle kind drifting in the air, if any. */
  particle?: string;
}

export const CAVE_BIOMES: readonly CaveBiomeInfo[] = [
  { id: 'none', name: 'Surface', fog: 0x000000, fogDensity: 1 },
  { id: 'caves', name: 'Caves', fog: 0x1a1c20, fogDensity: 1 },
  { id: 'deep_caves', name: 'Deep Caves', fog: 0x101216, fogDensity: 0.85 },
  { id: 'lush_caves', name: 'Lush Caves', fog: 0x1d3a1c, fogDensity: 0.95, particle: 'spore' },
  { id: 'mushroom_caves', name: 'Mushroom Caves', fog: 0x2a1a34, fogDensity: 0.8, particle: 'spore_glow' },
  { id: 'crystal_caves', name: 'Crystal Caves', fog: 0x281a3e, fogDensity: 1.1, particle: 'crystal_glint' },
  { id: 'dripstone_caves', name: 'Dripstone Caves', fog: 0x2a2218, fogDensity: 0.9, particle: 'dust' },
  { id: 'lava_caves', name: 'Lava Caves', fog: 0x3a120a, fogDensity: 0.75, particle: 'ember' },
  { id: 'frozen_caves', name: 'Frozen Caves', fog: 0x1c2a3a, fogDensity: 0.85, particle: 'snowflake' },
  { id: 'deep_dark', name: 'Deep Dark', fog: 0x05070a, fogDensity: 0.6, particle: 'sculk_soul' },
  { id: 'corrupted_caves', name: 'Corrupted Caves', fog: 0x1a0822, fogDensity: 0.8, particle: 'glitch' },
];

export const CAVE_BIOME_BY_ID = new Map(CAVE_BIOMES.map((b, i) => [b.id, i as CaveBiome]));

/** Deep dark and lava caves stay below these heights. */
export const DEEP_DARK_TOP = 34;
export const DEEP_TOP = 24;

export class CaveBiomeSource {
  private readonly a: Octave3;
  private readonly b: Octave3;
  private readonly dark: Octave2;
  private readonly lava: Octave2;
  private readonly jitter: Octave2;

  constructor(
    readonly seed: number,
    /** Generator version: V3 freezes the deep caves under cold lands too (lava only where it is geothermal). */
    readonly version = 2,
  ) {
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0xca7eb10));
    this.a = new Octave3(r(1), 2, 170, 64);
    this.b = new Octave3(r(2), 2, 210, 80);
    this.dark = new Octave2(r(3), 2, 380);
    this.lava = new Octave2(r(4), 2, 240);
    this.jitter = new Octave2(r(5), 1, 40);
  }

  /** Whether a column lies in a deep dark region (used to place Ancient Cities). */
  deepDarkStrength(x: number, z: number): number {
    return this.dark.sample(x, z);
  }

  /**
   * Cave biome at a position. `temperature` is the surface climate's
   * temperature for the column (cold lands get frozen caves).
   */
  at(x: number, y: number, z: number, temperature: number): CaveBiome {
    // Wobble the vertical boundaries a little so layers don't form flat planes
    const j = this.jitter.sample(x, z) * 5;
    const yy = y + j;
    if (yy < DEEP_DARK_TOP) {
      const d = this.dark.sample(x, z);
      if (d > 0.36) return CaveBiome.DeepDark;
    }
    if (yy < DEEP_TOP) {
      const l = this.lava.sample(x, z);
      if (this.version >= 3 && temperature < -0.4) return l > 0.55 ? CaveBiome.Lava : CaveBiome.Frozen;
      return l > 0.42 || (temperature > 0.75 && l > 0.2) ? CaveBiome.Lava : CaveBiome.Deep;
    }
    const a = this.a.sample(x, y, z);
    if (temperature < -0.4 && a > -0.25) return CaveBiome.Frozen;
    const b = this.b.sample(x, y, z);
    if (b > 0.36 && yy < 52) return CaveBiome.Crystal;
    if (a > 0.26) return b < -0.22 ? CaveBiome.Mushroom : CaveBiome.Lush;
    if (a < -0.3) return CaveBiome.Dripstone;
    return CaveBiome.Caves;
  }
}
