/**
 * Shapes of the engineering blocks that aren't plain cubes, in pixels (0..16).
 *
 * One list per block state, shared by collision/selection (physics/shapes.ts)
 * and the client mesher (render/models.ts), so what you see is what you hit.
 * Each box names the texture key it is drawn with.
 */
import { getProp } from '../registry/blocks';
import { COMPONENT_BY_ID } from './catalog';

export type V3 = [number, number, number];
export interface EngBox {
  from: V3;
  to: V3;
  /** Texture key in the block def (all, top, belt...). */
  tex: string;
  /** Texture key for the top/bottom faces, when different. */
  cap?: string;
}

const DIRS = ['north', 'south', 'west', 'east', 'up', 'down'] as const;

/** Rotates a box defined facing north around Y. */
function rot(b: EngBox, facing: string | undefined): EngBox {
  const [x0, y0, z0] = b.from;
  const [x1, y1, z1] = b.to;
  switch (facing) {
    case 'south':
      return { ...b, from: [16 - x1, y0, 16 - z1], to: [16 - x0, y1, 16 - z0] };
    case 'west':
      return { ...b, from: [z0, y0, 16 - x1], to: [z1, y1, 16 - x0] };
    case 'east':
      return { ...b, from: [16 - z1, y0, x0], to: [16 - z0, y1, x1] };
    default:
      return b;
  }
}

/** A core with arms toward each connected side. */
function conduit(state: number, lo: number, hi: number, core: number): EngBox[] {
  const c0 = 8 - core / 2;
  const c1 = 8 + core / 2;
  const out: EngBox[] = [{ from: [c0, c0, c0], to: [c1, c1, c1], tex: 'all' }];
  for (const d of DIRS) {
    if (getProp(state, d) !== 'true') continue;
    switch (d) {
      case 'north':
        out.push({ from: [lo, lo, 0], to: [hi, hi, c0], tex: 'all' });
        break;
      case 'south':
        out.push({ from: [lo, lo, c1], to: [hi, hi, 16], tex: 'all' });
        break;
      case 'west':
        out.push({ from: [0, lo, lo], to: [c0, hi, hi], tex: 'all' });
        break;
      case 'east':
        out.push({ from: [c1, lo, lo], to: [16, hi, hi], tex: 'all' });
        break;
      case 'up':
        out.push({ from: [lo, c1, lo], to: [hi, 16, hi], tex: 'all' });
        break;
      case 'down':
        out.push({ from: [lo, 0, lo], to: [hi, c0, hi], tex: 'all' });
        break;
    }
  }
  return out;
}

/** Boxes for an engineering block state, or null when it is a plain cube (or not engineering). */
export function engBoxes(id: string, state: number): EngBox[] | null {
  const c = COMPONENT_BY_ID.get(id);
  if (!c) return null;
  switch (c.kind) {
    case 'cable': {
      const t = c.id === 'copper_wire' ? 2 : c.id === 'insulated_cable' ? 4 : 6;
      return conduit(state, 8 - t / 2, 8 + t / 2, t + 2);
    }
    case 'data_cable':
      return conduit(state, 7, 9, 4);
    case 'item_pipe':
    case 'fluid_pipe':
      return conduit(state, 5, 11, 6);
    case 'peripheral': {
      const f = getProp(state, 'facing');
      switch (c.peripheral) {
        case 'keyboard':
          return [rot({ from: [1, 0, 5], to: [15, 2, 11], tex: 'all', cap: 'top' }, f)];
        case 'mouse':
          return [rot({ from: [6, 0, 6], to: [10, 2, 11], tex: 'all', cap: 'top' }, f)];
        case 'speaker':
          return [rot({ from: [4, 0, 5], to: [12, 12, 11], tex: 'all', cap: 'top' }, f)];
        default:
          return [{ from: [6, 0, 6], to: [10, 3, 10], tex: 'all', cap: 'top' }];
      }
    }
    case 'item_filter':
    case 'valve':
    case 'fluid_filter':
      return conduit(state, 5, 11, 10);
    case 'conveyor':
      return [{ from: [0, 0, 0], to: [16, 4, 16], tex: 'all', cap: 'top' }];
    case 'tank':
      return [{ from: [1, 0, 1], to: [15, 16, 15], tex: 'all', cap: 'top' }];
    case 'hopper': {
      const f = getProp(state, 'facing') ?? 'down';
      const out: EngBox[] = [
        { from: [0, 10, 0], to: [16, 16, 16], tex: 'all', cap: 'top' },
        { from: [4, 4, 4], to: [12, 10, 12], tex: 'all' },
      ];
      if (f === 'down') out.push({ from: [6, 0, 6], to: [10, 4, 10], tex: 'all' });
      else out.push(rot({ from: [6, 4, 0], to: [10, 8, 4], tex: 'all' }, f));
      return out;
    }
    case 'chute':
      return [{ from: [2, 0, 2], to: [14, 16, 14], tex: 'all' }];
    case 'signal':
      if (c.id === 'signal_cable') return [{ from: [0, 0, 0], to: [16, 1, 16], tex: 'all' }];
      if (c.id === 'warning_light')
        return [
          { from: [4, 0, 4], to: [12, 2, 12], tex: 'base' },
          { from: [5, 2, 5], to: [11, 8, 11], tex: 'all' },
        ];
      return [{ from: [0, 0, 0], to: [16, 2, 16], tex: 'all', cap: 'top' }];
    default:
      return null;
  }
}
