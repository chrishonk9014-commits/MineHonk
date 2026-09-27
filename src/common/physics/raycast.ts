/** Voxel ray traversal (Amanatides & Woo) with per-state selection shapes. */
import { AABB } from './aabb';
import { selectionShape, collisionShape } from './shapes';
import { STATE_FLUID } from '../registry/blocks';
import type { BlockAccess } from './movement';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  face: number;
  /** Exact hit point. */
  px: number;
  py: number;
  pz: number;
  dist: number;
  state: number;
}

const tmp = new AABB();

/**
 * Casts a ray and returns the first block whose selection shape is hit.
 * `fluids` controls whether fluid blocks are hit (for buckets).
 * `useCollision` uses collision shapes instead (for line-of-sight checks).
 */
export function raycastBlocks(
  world: BlockAccess,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  opts: { fluids?: boolean; useCollision?: boolean; skip?: (state: number) => boolean } = {},
): RayHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len;
  dy /= len;
  dz /= len;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / dx);
  const tDeltaY = Math.abs(1 / dy);
  const tDeltaZ = Math.abs(1 / dz);
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let t = 0;
  for (let i = 0; i < 512 && t <= maxDist; i++) {
    const s = world.getState(x, y, z);
    if (s !== 0 && !(opts.skip && opts.skip(s))) {
      const isFluid = STATE_FLUID[s] !== 0;
      if (isFluid && opts.fluids) {
        const h = tmp.set(x, y, z, x + 1, y + 1, z + 1).raycast(ox, oy, oz, dx, dy, dz);
        if (h && h.t <= maxDist) return { x, y, z, face: h.face, px: ox + dx * h.t, py: oy + dy * h.t, pz: oz + dz * h.t, dist: h.t, state: s };
      }
      const shape = opts.useCollision ? collisionShape(s) : selectionShape(s);
      let best: { t: number; face: number } | null = null;
      for (const b of shape) {
        tmp.set(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        const h = tmp.raycast(ox, oy, oz, dx, dy, dz);
        if (h && (!best || h.t < best.t)) best = h;
      }
      if (best && best.t <= maxDist) {
        return { x, y, z, face: best.face, px: ox + dx * best.t, py: oy + dy * best.t, pz: oz + dz * best.t, dist: best.t, state: s };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
