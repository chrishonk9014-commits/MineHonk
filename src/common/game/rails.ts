/**
 * V6 phase 4: rails (the plain rail, the powered rail and the Ender Rail).
 *
 * A rail's `shape` joins it to its neighbours: straight along an axis,
 * sloping up towards a neighbour one block higher, or (plain rails only)
 * turning between two sides. Shared by placement (so the client predicts
 * it), neighbour updates and the minecart's physics on the server.
 */
import { blocks, STATE_BLOCK, getProp, withProp, hasProp } from '../registry/blocks';
import type { RailShape } from '../endExpansion/transport';

interface Reader {
  getState(x: number, y: number, z: number): number;
}

/** Horizontal steps of the four sides. */
export const SIDE: Record<'north' | 'south' | 'west' | 'east', [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
type Side = keyof typeof SIDE;

export function isRail(state: number): boolean {
  return blocks[STATE_BLOCK[state]!]!.def.model === 'rail';
}

/** Only the plain rail turns corners. */
function curves(state: number): boolean {
  return blocks[STATE_BLOCK[state]!]!.id === 'rail';
}

/**
 * The two ends of a rail: the side each leaves by, and whether that end is
 * a block higher (ascending shapes).
 */
export function railEnds(shape: string): [{ side: Side; up: boolean }, { side: Side; up: boolean }] {
  switch (shape) {
    case 'east_west':
      return [
        { side: 'west', up: false },
        { side: 'east', up: false },
      ];
    case 'ascending_north':
      return [
        { side: 'south', up: false },
        { side: 'north', up: true },
      ];
    case 'ascending_south':
      return [
        { side: 'north', up: false },
        { side: 'south', up: true },
      ];
    case 'ascending_east':
      return [
        { side: 'west', up: false },
        { side: 'east', up: true },
      ];
    case 'ascending_west':
      return [
        { side: 'east', up: false },
        { side: 'west', up: true },
      ];
    case 'south_east':
      return [
        { side: 'south', up: false },
        { side: 'east', up: false },
      ];
    case 'south_west':
      return [
        { side: 'south', up: false },
        { side: 'west', up: false },
      ];
    case 'north_west':
      return [
        { side: 'north', up: false },
        { side: 'west', up: false },
      ];
    case 'north_east':
      return [
        { side: 'north', up: false },
        { side: 'east', up: false },
      ];
    default:
      return [
        { side: 'north', up: false },
        { side: 'south', up: false },
      ];
  }
}

/** How a neighbouring rail sits on one side: level, a block up, a block down, or none. */
function neighbour(w: Reader, x: number, y: number, z: number, side: Side): 'flat' | 'up' | 'down' | null {
  const [dx, dz] = SIDE[side];
  if (isRail(w.getState(x + dx, y, z + dz))) return 'flat';
  if (isRail(w.getState(x + dx, y + 1, z + dz))) return 'up';
  if (isRail(w.getState(x + dx, y - 1, z + dz))) return 'down';
  return null;
}

/** The shape a rail takes from the rails around it (unchanged when nothing decides it). */
export function railShape(w: Reader, x: number, y: number, z: number, state: number): number {
  if (!hasProp(state, 'shape')) return state;
  const n = neighbour(w, x, y, z, 'north');
  const s = neighbour(w, x, y, z, 'south');
  const e = neighbour(w, x, y, z, 'east');
  const wv = neighbour(w, x, y, z, 'west');
  const ns = !!n || !!s;
  const ew = !!e || !!wv;
  let shape: RailShape | null = null;
  const straight = (axis: 'ns' | 'ew'): RailShape => (axis === 'ns' ? (n === 'up' ? 'ascending_north' : s === 'up' ? 'ascending_south' : 'north_south') : e === 'up' ? 'ascending_east' : wv === 'up' ? 'ascending_west' : 'east_west');
  if (n && s) shape = straight('ns');
  else if (e && wv) shape = straight('ew');
  else if (ns && ew && curves(state) && (n ?? s) !== 'up' && (e ?? wv) !== 'up') shape = `${n ? 'north' : 'south'}_${e ? 'east' : 'west'}` as RailShape;
  else if (ns) shape = straight('ns');
  else if (ew) shape = straight('ew');
  if (!shape) return state;
  const cur = getProp(state, 'shape');
  // A rail already joined at both ends stays as it is
  if (cur && cur !== shape) {
    const [a, b] = railEnds(cur);
    const joined = (end: { side: Side }): boolean => !!neighbour(w, x, y, z, end.side);
    if (joined(a) && joined(b)) return state;
  }
  try {
    return withProp(state, 'shape', shape);
  } catch {
    return state;
  }
}
