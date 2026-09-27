/** Horizontal chunk size (blocks). */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
/** Vertical size of one chunk section. */
export const SECTION_SIZE = 16;
/** Total world height in blocks (y = 0 .. WORLD_HEIGHT-1). */
export const WORLD_HEIGHT = 256;
export const SECTIONS_PER_CHUNK = WORLD_HEIGHT / SECTION_SIZE;
export const SECTION_VOLUME = 4096;
export const SEA_LEVEL = 63;

/** Server simulation rate. */
export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Length of a full day in ticks (20 minutes). */
export const DAY_LENGTH = 24000;

/** Maximum distance a player may interact with blocks (survival). */
export const REACH_SURVIVAL = 4.5;
export const REACH_CREATIVE = 5.5;

/** Faces / directions. Order matters: used as array indices everywhere. */
export const enum Face {
  Down = 0,
  Up = 1,
  North = 2,
  South = 3,
  West = 4,
  East = 5,
}

export const FACE_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
export type FaceName = (typeof FACE_NAMES)[number];

export const FACE_DX = [0, 0, 0, 0, -1, 1] as const;
export const FACE_DY = [-1, 1, 0, 0, 0, 0] as const;
export const FACE_DZ = [0, 0, -1, 1, 0, 0] as const;
export const FACE_OPPOSITE = [1, 0, 3, 2, 5, 4] as const;

/** Horizontal facing names in rotation order (clockwise seen from above starting south). */
export const HORIZONTAL = ['south', 'west', 'north', 'east'] as const;
export type Horizontal = (typeof HORIZONTAL)[number];

export function faceFromName(n: string): number {
  const i = (FACE_NAMES as readonly string[]).indexOf(n);
  return i < 0 ? 0 : i;
}

/** Converts a yaw (radians, 0 = looking towards -Z/north) into a horizontal facing. */
export function yawToFacing(yaw: number): Horizontal {
  // yaw 0 faces north (-Z); increasing yaw turns left (towards -X / west).
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const q = Math.round(a / (Math.PI / 2)) & 3;
  return (['north', 'west', 'south', 'east'] as const)[q]!;
}

export function oppositeHorizontal(f: string): Horizontal {
  switch (f) {
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'west':
      return 'east';
    default:
      return 'west';
  }
}

export function horizontalToFace(f: string): number {
  return faceFromName(f);
}

export function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

const CI_OFF = 0x200000; // 2^21 chunks each side (~33.5M blocks)
const CI_MUL = 0x400000;
/** Packs chunk coordinates into a single safe integer key (supports +-2^21 chunks). */
export function chunkIndex(cx: number, cz: number): number {
  return (cx + CI_OFF) * CI_MUL + (cz + CI_OFF);
}

export function chunkIndexX(k: number): number {
  return Math.floor(k / CI_MUL) - CI_OFF;
}

export function chunkIndexZ(k: number): number {
  return (k % CI_MUL) - CI_OFF;
}

/** World border (blocks from origin) - keeps chunk keys and float precision safe. */
export const WORLD_BORDER = 30_000_000;

export function blockToChunk(v: number): number {
  return Math.floor(v) >> CHUNK_SHIFT;
}

/** Index of a block inside a 16x16x16 section. */
export function sectionIndex(x: number, y: number, z: number): number {
  return ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
}

export function posKey(x: number, y: number, z: number): string {
  return x + ',' + y + ',' + z;
}
