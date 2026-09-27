/**
 * Overworld climate model ("multi-noise"): continentalness, erosion,
 * peaks & valleys, temperature, humidity, rivers and rare-variant noise.
 * Produces a smooth 2D base height and chooses a biome per column.
 *
 * Every height modifier is a continuous function of the climate values so
 * biome borders never create cliffs/seams.
 */
import { Octave2, clamp, smoothstep, lerpN } from '../math/noise';
import { Random, hashInts } from '../math/rng';
import { SEA_LEVEL } from '../world/constants';
import { biomeNum } from '../registry/biomes';

export interface Climate {
  c: number;
  e: number;
  w: number;
  pv: number;
  t: number;
  h: number;
  v: number;
  river: number;
  mountain: number;
  swamp: number;
  plateau: number;
  land: number;
  height: number;
  /** Amplitude of 3D overhang noise for this column. */
  amp: number;
}

export function newClimate(): Climate {
  return { c: 0, e: 0, w: 0, pv: 0, t: 0, h: 0, v: 0, river: 1, mountain: 0, swamp: 0, plateau: 0, land: 0, height: 64, amp: 2 };
}

const NORM = 2.7;
const n = (v: number): number => clamp(v * NORM, -1, 1);

/** Piecewise-linear spline evaluation. */
function spline(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    if (x <= x1) {
      const [x0, y0] = pts[i - 1]!;
      const t = (x - x0) / (x1 - x0);
      // smooth the segment a little
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * (t * 0.5 + s * 0.5);
    }
  }
  return pts[pts.length - 1]![1];
}

const CONTINENT: readonly (readonly [number, number])[] = [
  [-1, 26],
  [-0.8, 32],
  [-0.6, 42],
  [-0.48, 52],
  [-0.38, 58],
  [-0.3, 62],
  [-0.22, 65],
  [-0.05, 68],
  [0.3, 72],
  [0.7, 80],
  [1, 88],
];

export class OverworldClimate {
  private readonly cont: Octave2;
  private readonly ero: Octave2;
  private readonly weird: Octave2;
  private readonly temp: Octave2;
  private readonly humid: Octave2;
  private readonly riverN: Octave2;
  private readonly detail: Octave2;
  private readonly variant: Octave2;
  private readonly plateauN: Octave2;

  constructor(readonly seed: number) {
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0x0c11a7e));
    this.cont = new Octave2(r(1), 6, 1500);
    this.ero = new Octave2(r(2), 5, 750);
    this.weird = new Octave2(r(3), 4, 480);
    this.temp = new Octave2(r(4), 4, 1300);
    this.humid = new Octave2(r(5), 4, 1000);
    this.riverN = new Octave2(r(6), 4, 900);
    this.detail = new Octave2(r(7), 4, 70);
    this.variant = new Octave2(r(8), 2, 350);
    this.plateauN = new Octave2(r(9), 3, 260);
  }

  sample(x: number, z: number, out: Climate): Climate {
    const c = n(this.cont.sample(x, z)) * 1.05 + 0.08;
    const e = n(this.ero.sample(x, z));
    const w = n(this.weird.sample(x, z));
    const t = n(this.temp.sample(x, z));
    const h = n(this.humid.sample(x, z));
    const v = n(this.variant.sample(x, z));
    const pv = 1 - Math.abs(3 * Math.abs(w) - 2);
    out.c = c;
    out.e = e;
    out.w = w;
    out.t = t;
    out.h = h;
    out.v = v;
    out.pv = pv;

    const land = smoothstep(-0.32, -0.12, c);
    out.land = land;
    let height = spline(c, CONTINENT);

    // Mountains: low erosion inland, shaped by peaks & valleys.
    const mountain = land * smoothstep(-0.05, -0.7, e) * smoothstep(-0.2, 0.25, c);
    out.mountain = mountain;
    const peak = smoothstep(-0.5, 1, pv);
    height += mountain * (22 + 118 * peak * peak);

    // Rolling hills everywhere on land, damped where erosion is high.
    const d = n(this.detail.sample(x, z));
    const hillAmp = 2 + 9 * smoothstep(0.7, -0.2, e) * (1 - mountain * 0.5);
    height += d * hillAmp * land;
    // Valleys
    height -= smoothstep(-0.3, -0.9, pv) * 6 * land * (1 - mountain);

    // Hot plateaus (savanna plateaus, badland mesas): terraced uplift.
    const plateau = land * smoothstep(0.25, 0.55, t) * smoothstep(0.1, 0.5, n(this.plateauN.sample(x, z))) * (1 - mountain);
    out.plateau = plateau;
    if (plateau > 0.01) {
      const lift = 28 * plateau;
      const raw = height + lift;
      const step = 7;
      const base = Math.floor(raw / step) * step;
      const frac = (raw - base) / step;
      const terraced = base + step * smoothstep(0.35, 0.65, frac);
      height = lerpN(height, terraced, Math.min(1, plateau * 1.6));
    }

    // Swamps: wet, flat, low areas pull the terrain towards sea level.
    const swamp = land * smoothstep(0.3, 0.6, h) * smoothstep(0.15, 0.5, e) * smoothstep(-0.5, -0.2, t) * (1 - mountain);
    out.swamp = swamp;
    if (swamp > 0) height = lerpN(height, SEA_LEVEL + 0.5 + d * 1.5, smoothstep(0, 0.6, swamp));

    // Rivers carve towards sea level, fading out in high mountains.
    const rv = Math.abs(n(this.riverN.sample(x, z)));
    const riverStrength = land * (1 - smoothstep(0.25, 0.65, mountain)) * (1 - plateau * 0.7);
    const bank = smoothstep(0.02, 0.13, rv);
    out.river = 1 - (1 - bank) * riverStrength;
    if (riverStrength > 0) {
      const bed = SEA_LEVEL - 4 + bank * 4;
      height = lerpN(height, Math.min(height, bed + (height - bed) * bank), riverStrength);
    }

    out.height = height;
    out.amp = 1.5 + 24 * mountain * (0.4 + 0.6 * peak) + 5 * plateau + 3 * land * smoothstep(0.2, -0.6, e);
    return out;
  }

  /** Chooses a biome for a column given its climate, final surface height and slope. */
  biomeAt(cl: Climate, surface: number, slope: number): number {
    const { c, t, h, v, w, mountain, river, swamp, plateau } = cl;
    // Oceans
    if (surface < SEA_LEVEL - 4 && c < -0.28) {
      if (c < -0.86 && w > 0.72 && surface > SEA_LEVEL - 12) return B.mushroom_fields;
      if (t < -0.45) return B.frozen_ocean;
      if (t < -0.15) return B.cold_ocean;
      if (t > 0.55) return B.warm_ocean;
      if (t > 0.25) return B.lukewarm_ocean;
      return c < -0.62 ? B.deep_ocean : B.ocean;
    }
    if (c < -0.88 && w > 0.72) return B.mushroom_fields;
    // Rivers
    if (river < 0.45 && surface <= SEA_LEVEL + 1) return t < -0.45 ? B.frozen_river : B.river;
    // Coasts
    if (surface <= SEA_LEVEL + 2 && c < -0.1 && swamp < 0.4) {
      if (slope > 3 || mountain > 0.25) return B.stony_shore;
      return t < -0.45 ? B.snowy_beach : B.beach;
    }
    // High mountains
    if (surface > 165 || (mountain > 0.45 && surface > 130)) {
      if (surface > 175) {
        if (t < 0.3) return w > 0 ? B.jagged_peaks : B.frozen_peaks;
        return B.stony_peaks;
      }
      if (t < 0.1) return B.snowy_slopes;
      return h > 0.3 ? B.grove : B.stony_peaks;
    }
    if (mountain > 0.25 && surface > 100) {
      if (t < -0.35) return B.grove;
      if (v > 0.55 && t > -0.1 && t < 0.4) return B.cherry_grove;
      if (h > 0.05 && t < 0.45) return B.meadow;
      return B.windswept_hills;
    }
    // Swamps
    if (swamp > 0.5 && surface < SEA_LEVEL + 5) return t > 0.35 ? B.mangrove_swamp : B.swamp;
    // Temperature bands
    if (t < -0.45) {
      if (h < 0) return v > 0.62 ? B.ice_spikes : B.snowy_plains;
      return B.snowy_taiga;
    }
    if (t < -0.15) {
      if (h < -0.35) return B.plains;
      if (h < 0.15) return B.taiga;
      return v > 0.45 ? B.old_growth_spruce_taiga : B.taiga;
    }
    if (t < 0.22) {
      if (h < -0.35) return v > 0.55 ? B.sunflower_plains : B.plains;
      if (h < -0.05) return v > 0.55 ? B.flower_forest : B.forest;
      if (h < 0.25) return v > 0.6 ? B.old_growth_birch_forest : B.birch_forest;
      return B.dark_forest;
    }
    if (t < 0.55) {
      if (h < -0.25) return plateau > 0.35 ? B.savanna_plateau : B.savanna;
      if (h < 0.1) return h < -0.1 ? B.plains : B.forest;
      if (h < 0.4) return B.sparse_jungle;
      return v > 0.55 ? B.bamboo_jungle : B.jungle;
    }
    if (h < 0) {
      if (plateau > 0.3 || cl.e < -0.35) {
        if (v > 0.5) return B.wooded_badlands;
        if (v < -0.55) return B.eroded_badlands;
        return B.badlands;
      }
      return B.desert;
    }
    if (h < 0.3) return plateau > 0.35 ? B.savanna_plateau : B.savanna;
    return v > 0.55 ? B.bamboo_jungle : B.jungle;
  }
}

/** Numeric biome ids, resolved lazily. */
export const B = new Proxy({} as Record<string, number>, {
  get(cache, key: string) {
    if (!(key in cache)) cache[key] = biomeNum(key);
    return cache[key];
  },
}) as Record<
  | 'ocean'
  | 'deep_ocean'
  | 'warm_ocean'
  | 'lukewarm_ocean'
  | 'cold_ocean'
  | 'frozen_ocean'
  | 'mushroom_fields'
  | 'beach'
  | 'snowy_beach'
  | 'stony_shore'
  | 'river'
  | 'frozen_river'
  | 'plains'
  | 'sunflower_plains'
  | 'meadow'
  | 'cherry_grove'
  | 'forest'
  | 'flower_forest'
  | 'birch_forest'
  | 'old_growth_birch_forest'
  | 'dark_forest'
  | 'swamp'
  | 'mangrove_swamp'
  | 'taiga'
  | 'old_growth_spruce_taiga'
  | 'snowy_taiga'
  | 'snowy_plains'
  | 'ice_spikes'
  | 'grove'
  | 'snowy_slopes'
  | 'frozen_peaks'
  | 'jagged_peaks'
  | 'stony_peaks'
  | 'windswept_hills'
  | 'desert'
  | 'savanna'
  | 'savanna_plateau'
  | 'badlands'
  | 'wooded_badlands'
  | 'eroded_badlands'
  | 'jungle'
  | 'sparse_jungle'
  | 'bamboo_jungle'
  | 'lush_caves'
  | 'dripstone_caves'
  | 'deep_dark',
  number
>;
