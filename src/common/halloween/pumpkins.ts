/**
 * V7 - The Halloween Update: a pumpkin for every dimension.
 *
 * Each is one ordinary block (a lit, carved pumpkin that faces the player who
 * places it and drops itself), never a structure, tree or landmark:
 *  - Hallow Pumpkin (the Overworld): the classic orange jack o'lantern;
 *  - Ember Pumpkin (the Nether): charred rind, glowing cracks, a fiery face;
 *  - Ender Pumpkin (the End and the Expanded End): pale, alien, many-eyed;
 *  - Glitched Pumpkin (the Farlands): corrupted, its face tearing;
 *  - Data Pumpkin (inside the computer): a screen of a face on a circuit rind.
 *
 * While Halloween is on in a world (see season.ts), a few are scattered on
 * the surface of each dimension as chunks are generated for the first time:
 * at most one in a chunk, in one chunk in 20 to 24, on natural ground
 * with open air above, never in a structure. Where they go is a pure
 * function of the world's seed, the dimension and the chunk, and the pass
 * only ever adds a pumpkin into air, so generation itself (and every world
 * generation hash) is untouched. The server saves the chunks they land in,
 * so they stay after the season.
 */
import type { DimensionId } from '../data/biomes';
import type { Chunk } from '../world/chunk';
import { DIMENSION_PUMPKINS, PUMPKIN_FACING, type DimensionPumpkin } from './blocks';
import { STATE_BLOCK, stateOf } from '../registry/blocks';
import { hashInts, Random } from '../math/rng';

export { DIMENSION_PUMPKINS, PUMPKIN_IDS, pumpkinBlockDefs, type DimensionPumpkin } from './blocks';

/** Which pumpkin grows in a dimension. */
export function pumpkinFor(dim: DimensionId): DimensionPumpkin {
  return DIMENSION_PUMPKINS.find((p) => p.dim === dim)!;
}

/** Chance that a newly generated chunk gets a pumpkin. */
/** Rarer where the land fills more of each chunk (the Nether's caverns, the End's islands, the Farlands). */
export const PUMPKIN_CHUNK_CHANCE: Record<DimensionId, number> = { overworld: 1 / 20, nether: 1 / 24, end: 1 / 24, farlands: 1 / 24, computer: 1 / 20 };

/** Natural ground each dimension's pumpkins sit on (never planks, bricks, roofs or paths). */
export const PUMPKIN_GROUND: Record<DimensionId, readonly string[]> = {
  overworld: ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'moss_block', 'sand', 'red_sand', 'snow_block', 'peat'],
  nether: ['netherrack', 'crimson_nylium', 'warped_nylium', 'soul_sand', 'soul_soil', 'basalt', 'blackstone'],
  end: ['end_stone', 'cracked_end_stone', 'pale_end_stone', 'dark_end_stone', 'crystalline_end_stone', 'astral_end_stone', 'voidstone', 'end_sand', 'luminous_moss'],
  farlands: ['far_grass_block', 'far_dirt', 'stretched_sand', 'farstone'],
  computer: ['grass_block', 'dirt', 'sand', 'digital_grass_block', 'digital_dirt'],
};

const DIM_SALT: Record<DimensionId, number> = { overworld: 1, nether: 2, end: 3, farlands: 4, computer: 5 };
const SALT = 0x7a110e;
/** Columns tried before a chunk gives up (leaves, water and plants are not ground). */
const ATTEMPTS = 8;
/** The Nether's caverns: floors searched between the lava sea and the roof. */
const NETHER_MIN_Y = 33;
const NETHER_MAX_Y = 118;

let groundCache: Map<DimensionId, Set<number>> | null = null;

/** Block numbers of each dimension's ground. */
function groundOf(dim: DimensionId): Set<number> {
  groundCache ??= new Map();
  let s = groundCache.get(dim);
  if (!s) {
    s = new Set();
    for (const id of PUMPKIN_GROUND[dim]) s.add(STATE_BLOCK[stateOf(id)]!);
    groundCache.set(dim, s);
  }
  return s;
}

export interface PumpkinSpot {
  x: number;
  y: number;
  z: number;
  /** The pumpkin's block state (with its facing). */
  state: number;
}

/**
 * Where a newly generated chunk's pumpkin goes, if it gets one (world
 * coordinates). Reads the chunk only. `structureAt` (the dimension
 * generator's) keeps pumpkins out of structures.
 */
export function pumpkinSpot(c: Chunk, dim: DimensionId, worldSeed: number, structureAt?: (x: number, y: number, z: number) => string | null): PumpkinSpot | null {
  const rng = new Random(hashInts(worldSeed >>> 0, SALT, DIM_SALT[dim], c.cx, c.cz));
  if (!rng.chance(PUMPKIN_CHUNK_CHANCE[dim])) return null;
  const ground = groundOf(dim);
  const isGround = (st: number): boolean => ground.has(STATE_BLOCK[st]!);
  const pumpkin = pumpkinFor(dim).id;
  for (let i = 0; i < ATTEMPTS; i++) {
    const lx = rng.int(16);
    const lz = rng.int(16);
    const facing = rng.pick(PUMPKIN_FACING);
    let y = -1;
    if (dim === 'nether') {
      // The floors of the caverns: ground with two blocks of air above it
      const floors: number[] = [];
      for (let yy = NETHER_MIN_Y; yy <= NETHER_MAX_Y; yy++) if (c.get(lx, yy, lz) === 0 && c.get(lx, yy + 1, lz) === 0 && isGround(c.get(lx, yy - 1, lz))) floors.push(yy);
      if (floors.length) y = floors[rng.int(floors.length)]!;
    } else {
      const h = c.getHeight(lx, lz);
      if (h > 1 && h < 254 && c.get(lx, h, lz) === 0 && isGround(c.get(lx, h - 1, lz))) y = h;
    }
    if (y < 0) continue;
    const wx = (c.cx << 4) + lx;
    const wz = (c.cz << 4) + lz;
    if (structureAt?.(wx, y, wz) || structureAt?.(wx, y - 1, wz)) continue;
    return { x: wx, y, z: wz, state: stateOf(pumpkin, { facing }) };
  }
  return null;
}

/** Adds a newly generated chunk's pumpkin, if it gets one; returns where it went. */
export function decoratePumpkins(c: Chunk, dim: DimensionId, worldSeed: number, structureAt?: (x: number, y: number, z: number) => string | null): PumpkinSpot | null {
  const s = pumpkinSpot(c, dim, worldSeed, structureAt);
  // Only ever into air
  if (!s || c.get(s.x & 15, s.y, s.z & 15) !== 0) return null;
  c.set(s.x & 15, s.y, s.z & 15, s.state);
  return s;
}
