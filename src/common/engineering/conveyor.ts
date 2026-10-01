/**
 * Conveyors move whatever stands on them. This is shared physics: the client
 * applies it to its own player, the server to mobs and dropped items, so
 * riding a belt looks and feels the same everywhere.
 */
import { blocks, STATE_BLOCK, getProp } from '../registry/blocks';

/** Belt surface height above the block's floor. */
export const BELT_TOP = 4 / 16;

let SPEED: Float32Array | null = null;

/** Belt speed (blocks per tick) per block number; 0 for anything that isn't a conveyor. */
function speedOf(blockNum: number): number {
  if (!SPEED || SPEED.length !== blocks.length) {
    SPEED = new Float32Array(blocks.length);
    for (const bt of blocks) {
      if (bt.id === 'conveyor') SPEED[bt.num] = 2 / 20;
      else if (bt.id === 'express_conveyor') SPEED[bt.num] = 5 / 20;
    }
  }
  return SPEED[blockNum] ?? 0;
}

export const FACING_VEC: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

export interface BeltContact {
  x: number;
  y: number;
  z: number;
  state: number;
  /** Push for this tick (blocks). */
  px: number;
  pz: number;
}

/**
 * The belt under a body standing on it, and how far it pushes this tick:
 * along the belt, plus a gentle pull to the belt's middle line.
 */
export function beltUnder(world: { getState(x: number, y: number, z: number): number }, bx: number, by: number, bz: number): BeltContact | null {
  const x = Math.floor(bx);
  const z = Math.floor(bz);
  const y = Math.floor(by - 0.05);
  const s = world.getState(x, y, z);
  const speed = speedOf(STATE_BLOCK[s]!);
  if (!speed) return null;
  // Only bodies resting on the belt (not jumping over it)
  if (by - y > BELT_TOP + 0.15) return null;
  const [fx, fz] = FACING_VEC[getProp(s, 'facing') ?? 'north'] ?? [0, -1];
  const cx = x + 0.5 - bx;
  const cz = z + 0.5 - bz;
  // Pull towards the middle across the belt
  const px = fx * speed + (fx === 0 ? cx * 0.15 : 0);
  const pz = fz * speed + (fz === 0 ? cz * 0.15 : 0);
  return { x, y, z, state: s, px, pz };
}
