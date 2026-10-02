/**
 * V6 - The End Expansion: where the Expanded End lies.
 *
 * The Expanded End is part of the End dimension ('end'), not a dimension of
 * its own: a ring far beyond the outer islands, reached through the
 * Expansion Portal on the main island. Everything here is plain geometry
 * shared by the generator, the server and the client.
 */

/** World generator version that first has the approach gap (V6 worlds). */
export const EXPANSION_GENERATOR = 6;
/**
 * Generator version from which the Expanded End has its phase 2 surfaces,
 * ores and plants. Worlds made by generator 6 keep their phase 1 Expanded End.
 */
export const EXPANSION_RESOURCES_GENERATOR = 7;

/**
 * V6 worlds: the outer islands thin out between these distances from (0, 0)
 * and stop, leaving open void up to the Expanded End. Older worlds keep their
 * outer islands everywhere outside the ring (their End generates as before).
 */
export const APPROACH_FADE_START = 4000;
export const APPROACH_FADE_END = 4600;

/** The Expanded End is the ring between these distances from (0, 0), in every world. */
export const EXPANSION_INNER = 6000;
export const EXPANSION_OUTER = 10000;
/** Open void just inside each edge of the ring before any land. */
export const EXPANSION_MARGIN = 400;

/** Size of the cells the biome regions are built from (blocks). */
export const REGION_CELL = 640;
/** How far region borders wander from straight lines (blocks). */
export const REGION_WARP = 150;

/** The Expansion Portal on the main island: the centre of its frame's base (y comes from the terrain). */
export const EXPANSION_PORTAL_SITE = { x: 0, z: 72 } as const;
/** Where the generator starts looking for the arrival island (the first open ground nearby). */
export const ARRIVAL_NOMINAL = { x: 0, z: 7200 } as const;

const IN2 = EXPANSION_INNER * EXPANSION_INNER;
const OUT2 = EXPANSION_OUTER * EXPANSION_OUTER;

/** True for columns inside the Expanded End's ring. */
export function inExpansion(x: number, z: number): boolean {
  const d2 = x * x + z * z;
  return d2 >= IN2 && d2 < OUT2;
}

/** True when any column of chunk (cx, cz) lies inside the ring. */
export function chunkInExpansion(cx: number, cz: number): boolean {
  const x0 = cx << 4;
  const z0 = cz << 4;
  const x1 = x0 + 15;
  const z1 = z0 + 15;
  // Nearest and farthest points of the chunk's square from the origin
  const nx = x0 > 0 ? x0 : x1 < 0 ? x1 : 0;
  const nz = z0 > 0 ? z0 : z1 < 0 ? z1 : 0;
  const fx = Math.max(Math.abs(x0), Math.abs(x1));
  const fz = Math.max(Math.abs(z0), Math.abs(z1));
  return nx * nx + nz * nz < OUT2 && fx * fx + fz * fz >= IN2;
}
