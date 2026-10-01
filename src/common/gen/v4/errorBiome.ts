/**
 * V4: the Error Biome. One chunk, very rarely, that failed to load: a flat
 * slab of black and purple ERROR blocks cut straight out of the terrain, with
 * blocks hanging in the air above it. Buried under it lies the Glitched
 * Structure: an entry hall, five stacked arenas and a reward vault, joined by
 * ladder shafts that firewalls keep shut until each stage is cleared.
 *
 * Placement: the world is split into cells of CELL x CELL chunks; each cell
 * picks one candidate chunk at least one chunk inside its edges (so two Error
 * chunks can never touch). Overworld candidates in water are skipped. The
 * Error Biome never generates in the End or the Farlands.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf } from '../../registry/blocks';
import { biomeNum } from '../../registry/biomes';
import type { Chunk } from '../../world/chunk';
import type { DimensionId } from '../../data/biomes';

/** Cell size in chunks for the overworld (roughly a third of candidates fall in water) and the Nether. */
export const ERROR_CELL: Record<'overworld' | 'nether', number> = { overworld: 58, nether: 71 };

/** Arenas in the Glitched Structure. */
export const GLITCH_STAGES = 5;
/** Height of one level (floor + five of air). */
export const LEVEL_H = 6;
/** Levels: vault, five arenas, entry hall; plus the roof. */
export const STRUCTURE_H = LEVEL_H * (GLITCH_STAGES + 2) + 1;

export interface ErrorChunk {
  cx: number;
  cz: number;
  /** Surface of the broken slab. */
  surface: number;
  /** Floor of the reward vault (bottom of the Glitched Structure). */
  base: number;
}

/** Candidate chunk of the cell containing chunk (cx, cz). */
export function cellCandidate(seed: number, dim: 'overworld' | 'nether', gx: number, gz: number): [number, number] {
  const cell = ERROR_CELL[dim];
  const r = new Random(hashInts(seed, gx, gz, dim === 'nether' ? 0xe7707 : 0xe7704));
  return [gx * cell + 1 + r.int(cell - 2), gz * cell + 1 + r.int(cell - 2)];
}

/** Floor y of an arena (stage 1..5), the vault (stage 6) or the entry hall (stage 0). */
export function levelFloor(e: ErrorChunk, stage: number): number {
  return e.base + LEVEL_H * (GLITCH_STAGES + 1 - stage);
}

/** Ladder shaft from level `stage` down into the next one: its column in the chunk (local x, z). */
export function shaftAt(stage: number): { lx: number; lz: number; wall: 'west' | 'east' } {
  return stage % 2 === 0 ? { lx: 1, lz: 7, wall: 'west' } : { lx: 14, lz: 7, wall: 'east' };
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------
let P: ReturnType<typeof pal> | undefined;
function pal() {
  return {
    error: S('error_block'),
    missing: S('missing_block'),
    nul: S('null_block'),
    corrupted: S('corrupted_stone'),
    glitch: S('glitch_block'),
    staticB: S('static_block'),
    firewall: S('glitch_firewall'),
    fractal: S('fractal_glass'),
    echoLamp: S('echo_lamp'),
    farBricks: S('farstone_bricks'),
    obsidian: S('crying_obsidian'),
    air: 0,
  };
}
function p(): ReturnType<typeof pal> {
  return (P ??= pal());
}

function roll(seed: number, x: number, y: number, z: number, salt: number): number {
  return (hashInts(seed, x, y, z, salt) >>> 0) % 1000;
}

/**
 * Rewrites a generated chunk as the Error Biome. `surfaceFloor` is where
 * nothing may be cut away below (the Nether keeps its lava sea's bedrock).
 */
export function buildErrorChunk(c: Chunk, e: ErrorChunk, seed: number, dim: DimensionId): void {
  const b = p();
  const x0 = c.cx << 4;
  const z0 = c.cz << 4;
  const top = e.base + STRUCTURE_H - 1;
  const errBiome = biomeNum('error_biome');
  c.biomes.fill(errBiome);
  c.blockEntities.clear();
  c.genEntities.length = 0;
  const set = (lx: number, y: number, lz: number, s: number): void => c.setRaw(lx, y, lz, s);
  // 1. The slab: filler from the structure's roof up to the surface, everything above cut away
  for (let lz = 0; lz < 16; lz++)
    for (let lx = 0; lx < 16; lx++) {
      const wx = x0 + lx;
      const wz = z0 + lz;
      for (let y = top + 1; y < e.surface; y++) {
        const r = roll(seed, wx, y, wz, 0xf111);
        set(lx, y, lz, r < 520 ? b.corrupted : r < 820 ? b.nul : r < 930 ? b.missing : b.error);
      }
      const r = roll(seed, wx, e.surface, wz, 0x5ace);
      // The surface: black and purple, with checkered patches where textures failed
      const patch = (hashInts(seed, wx >> 2, wz >> 2, 0x9a7c) >>> 0) % 7;
      set(lx, e.surface, lz, patch === 0 ? b.missing : patch === 1 && r < 500 ? b.nul : r < 30 ? b.glitch : b.error);
      const ceiling = dim === 'nether' ? Math.min(122, e.surface + 9) : 255;
      for (let y = e.surface + 1; y <= ceiling; y++) set(lx, y, lz, b.air);
    }
  // 2. Things that should not be there: blocks hanging in the air, a column that never finished loading
  const rng = new Random(hashInts(seed, c.cx, c.cz, 0xf10a7));
  const floaters = 4 + rng.int(4);
  for (let i = 0; i < floaters; i++) {
    const lx = 1 + rng.int(14);
    const lz = 1 + rng.int(14);
    const y = e.surface + 3 + rng.int(dim === 'nether' ? 5 : 11);
    const s = rng.pick([b.error, b.missing, b.missing, b.nul, b.glitch]);
    set(lx, y, lz, s);
    if (rng.chance(0.4)) set(lx, y - 1, lz, s);
  }
  const px = 2 + rng.int(12);
  const pz = 2 + rng.int(12);
  const ph = dim === 'nether' ? 7 : 10 + rng.int(8);
  for (let y = e.surface + 1; y <= e.surface + ph; y++) set(px, y, pz, y === e.surface + ph ? b.missing : b.nul);
  // A sliver of the slab that loaded one block too high
  const sx = rng.int(13);
  const sz = rng.int(13);
  for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) set(sx + dx, e.surface + 1, sz + dz, b.error);
  // 3. The Glitched Structure beneath
  buildStructure(c, e, seed);
  c.recount();
  c.recomputeHeightmap();
}

function buildStructure(c: Chunk, e: ErrorChunk, seed: number): void {
  const b = p();
  const x0 = c.cx << 4;
  const z0 = c.cz << 4;
  const set = (lx: number, y: number, lz: number, s: number): void => c.setRaw(lx, y, lz, s);
  const top = e.base + STRUCTURE_H - 1;
  // Shell and every slab between levels
  for (let y = e.base; y <= top; y++)
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wall = lx === 0 || lx === 15 || lz === 0 || lz === 15;
        const slab = (y - e.base) % LEVEL_H === 0;
        const wx = x0 + lx;
        const wz = z0 + lz;
        if (wall) {
          const stripe = (y - e.base) % LEVEL_H === 3 && (lx + lz) % 3 === 0;
          set(lx, y, lz, stripe ? b.error : roll(seed, wx, y, wz, 0x5e11) < 150 ? b.corrupted : b.nul);
        } else if (slab) {
          // Floors: a failed-texture checkerboard
          const check = ((lx >> 1) + (lz >> 1)) & 1;
          set(lx, y, lz, roll(seed, wx, y, wz, 0xf100) < 60 ? b.staticB : check ? b.nul : b.missing);
        } else set(lx, y, lz, b.air);
      }
  // Lights in every ceiling
  for (let s = 0; s <= GLITCH_STAGES + 1; s++) {
    const ceil = levelFloor(e, s) + LEVEL_H;
    for (const [lx, lz] of [
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
    ] as const)
      set(lx, ceil, lz, s === 0 ? b.glitch : b.echoLamp);
  }
  entryHall(c, e, seed);
  for (let s = 1; s <= GLITCH_STAGES; s++) arena(c, e, s, seed);
  vault(c, e);
  // Ladder shafts: the first is open, the others are shut by a firewall until the stage above is cleared
  for (let s = 0; s <= GLITCH_STAGES; s++) {
    const { lx, lz, wall } = shaftAt(s);
    const floor = levelFloor(e, s);
    const below = levelFloor(e, s + 1);
    const facing = wall === 'west' ? 'east' : 'west';
    for (let y = below + 1; y <= floor; y++) set(lx, y, lz, stateOf('ladder', { facing }));
    // Room to step off the ladder on the floor above
    set(lx, floor + 1, lz, b.air);
    set(lx, floor + 2, lz, b.air);
    if (s > 0) set(lx, floor, lz, b.firewall);
  }
}

/** The entry hall: rubble, broken corridors, and a hidden room behind a false wall. */
function entryHall(c: Chunk, e: ErrorChunk, seed: number): void {
  const b = p();
  const f = levelFloor(e, 0);
  const set = (lx: number, y: number, lz: number, s: number): void => c.setRaw(lx, y, lz, s);
  const rng = new Random(hashInts(seed, c.cx, c.cz, 0xe117));
  // Broken corridor walls: half-built segments that stop in mid-air
  for (let lx = 3; lx <= 12; lx++) {
    if (lx === 7 || lx === 8) continue;
    const h = 1 + rng.int(4);
    for (let y = 1; y <= h; y++) set(lx, f + y, 5, rng.chance(0.2) ? b.missing : b.farBricks);
    const h2 = 1 + rng.int(4);
    for (let y = 1; y <= h2; y++) set(lx, f + y, 10, rng.chance(0.2) ? b.missing : b.farBricks);
  }
  // Rubble
  for (let i = 0; i < 14; i++) {
    const lx = 2 + rng.int(12);
    const lz = 2 + rng.int(12);
    const s = rng.pick([b.corrupted, b.nul, b.staticB]);
    // The walkway down the middle stays clear
    if (lx !== 7 && lx !== 8) set(lx, f + 1, lz, s);
  }
  // A hidden room in the far corner, walled off with the same blocks as the shell
  for (let lx = 10; lx <= 14; lx++)
    for (let lz = 11; lz <= 14; lz++)
      for (let y = 1; y <= 4; y++) {
        const edge = lx === 10 || lz === 11;
        set(lx, f + y, lz, edge ? b.nul : b.air);
      }
  set(12, f + 1, 13, stateOf('chest', { facing: 'north' }));
  c.setBlockEntity(12, f + 1, 13, { type: 'chest', loot: 'chest/glitched_cache', lootSeed: hashInts(seed, c.cx, c.cz, 0xcac4e) });
  set(13, f + 1, 13, b.glitch);
  // Keep the way down to the first arena clear
  const { lx, lz } = shaftAt(0);
  for (let y = 1; y <= 4; y++) {
    set(lx, f + y, lz, b.air);
    set(lx + 1, f + y, lz, b.air);
  }
}

/** Each arena has its own layout of cover and wrongness. */
function arena(c: Chunk, e: ErrorChunk, stage: number, seed: number): void {
  const b = p();
  const f = levelFloor(e, stage);
  const set = (lx: number, y: number, lz: number, s: number): void => c.setRaw(lx, y, lz, s);
  const pillar = (lx: number, lz: number, h: number, s: number): void => {
    for (let y = 1; y <= h; y++) set(lx, f + y, lz, s);
  };
  switch (stage) {
    case 1:
      // Four broken pillars
      for (const [lx, lz] of [
        [4, 4],
        [11, 4],
        [4, 11],
        [11, 11],
      ] as const)
        pillar(lx, lz, 2 + ((lx + lz) % 3), b.corrupted);
      break;
    case 2:
      // Low walls to hide behind from arrows
      for (let lx = 3; lx <= 12; lx++) if (lx < 6 || lx > 9) {
        set(lx, f + 1, 4, b.nul);
        set(lx, f + 1, 11, b.nul);
      }
      pillar(7, 7, 5, b.missing);
      pillar(8, 8, 5, b.missing);
      break;
    case 3:
      // Blocks hanging in the air at impossible angles
      for (let i = 0; i < 12; i++) {
        const lx = 2 + ((i * 5 + seed) & 7) + (i & 3);
        const lz = 2 + ((i * 3 + (seed >> 3)) % 11);
        set(Math.min(13, lx), f + 3 + (i % 2), lz, i % 3 === 0 ? b.missing : b.fractal);
      }
      break;
    case 4:
      // A ring of static around the centre
      for (let lx = 5; lx <= 10; lx++)
        for (let lz = 5; lz <= 10; lz++) {
          const ring = lx === 5 || lx === 10 || lz === 5 || lz === 10;
          if (ring && (lx + lz) % 2 === 0) pillar(lx, lz, 2, b.staticB);
        }
      break;
    default:
      // The final arena: an open floor of ERROR, four glitch lights at the corners
      for (let lx = 1; lx <= 14; lx++) for (let lz = 1; lz <= 14; lz++) if ((lx + lz) % 4 === 0) set(lx, f, lz, b.error);
      for (const [lx, lz] of [
        [2, 2],
        [13, 2],
        [2, 13],
        [13, 13],
      ] as const)
        pillar(lx, lz, 1, b.glitch);
  }
}

/** The vault at the bottom: a chest on a raised floor. */
function vault(c: Chunk, e: ErrorChunk): void {
  const b = p();
  const f = levelFloor(e, GLITCH_STAGES + 1);
  const set = (lx: number, y: number, lz: number, s: number): void => c.setRaw(lx, y, lz, s);
  for (let lx = 5; lx <= 10; lx++) for (let lz = 5; lz <= 10; lz++) set(lx, f, lz, b.obsidian);
  for (let lx = 6; lx <= 9; lx++) for (let lz = 6; lz <= 9; lz++) set(lx, f + 1, lz, lx === 6 || lx === 9 || lz === 6 || lz === 9 ? b.glitch : b.air);
  set(7, f + 1, 7, stateOf('chest', { facing: 'south' }));
  c.setBlockEntity(7, f + 1, 7, { type: 'chest', loot: 'chest/glitched_vault', lootSeed: hashInts(c.cx, c.cz, 0x7a017) });
}

// ---------------------------------------------------------------------------
// Where the structure is: a pure function of the seed, the chunk and the terrain
// ---------------------------------------------------------------------------
/** Local positions inside an arena where the stage's glitched mobs appear. */
export function arenaSpawns(e: ErrorChunk, stage: number): { x: number; y: number; z: number }[] {
  const f = levelFloor(e, stage) + 1;
  const x0 = e.cx << 4;
  const z0 = e.cz << 4;
  return [
    [7.5, 3.5],
    [3.5, 7.5],
    [11.5, 7.5],
    [7.5, 11.5],
    [5.5, 12.5],
    [10.5, 2.5],
    [12.5, 12.5],
    [2.5, 3.5],
  ].map(([x, z]) => ({ x: x0 + x!, y: f, z: z0 + z! }));
}

/** Which level of the structure a position is in: 0 entry hall, 1..5 arenas, 6 vault; -1 outside. */
export function levelAt(e: ErrorChunk, x: number, y: number, z: number): number {
  if (Math.floor(x) >> 4 !== e.cx || Math.floor(z) >> 4 !== e.cz) return -1;
  const ry = Math.floor(y) - e.base;
  if (ry < 1 || ry >= STRUCTURE_H - 1) return -1;
  return GLITCH_STAGES + 1 - Math.floor((ry - 1) / LEVEL_H);
}

/** Nearest Error chunk to (x, z) given each cell's chunk (or null), ring by ring. */
export function nearestError(ofCell: (gx: number, gz: number) => ErrorChunk | null, cell: number, x: number, z: number, maxRings: number): ErrorChunk | null {
  const gcx = Math.floor((x >> 4) / cell);
  const gcz = Math.floor((z >> 4) / cell);
  let best: ErrorChunk | null = null;
  let bestD = Infinity;
  for (let ring = 0; ring <= maxRings; ring++) {
    for (let gx = gcx - ring; gx <= gcx + ring; gx++)
      for (let gz = gcz - ring; gz <= gcz + ring; gz++) {
        if (Math.max(Math.abs(gx - gcx), Math.abs(gz - gcz)) !== ring) continue;
        const e = ofCell(gx, gz);
        if (!e) continue;
        const d = ((e.cx << 4) + 8 - x) ** 2 + ((e.cz << 4) + 8 - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    if (best && (ring - 1) * cell * 16 > Math.sqrt(bestD)) break;
  }
  return best;
}

/** Where to point at for an Error chunk: its surface, or the Glitched Structure's entry hall. */
export function errorLocation(e: ErrorChunk | null, type: string): { x: number; y: number; z: number } | null {
  if (!e) return null;
  if (type === 'glitched_structure') return { x: (e.cx << 4) + 7, y: levelFloor(e, 0) + 1, z: (e.cz << 4) + 2 };
  return { x: (e.cx << 4) + 8, y: e.surface + 1, z: (e.cz << 4) + 8 };
}
