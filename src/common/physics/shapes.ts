/**
 * Collision and selection shapes per block state, in block-local units (0..1).
 * Shapes are computed lazily and cached per state id.
 */
import { blocks, STATE_BLOCK, getProp, STATE_FULL_CUBE, blockCollides } from '../registry/blocks';

export type Box = readonly [number, number, number, number, number, number];
export type Shape = readonly Box[];

const FULL: Shape = [[0, 0, 0, 1, 1, 1]];
const EMPTY: Shape = [];
const px = (v: number): number => v / 16;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => [px(x0), px(y0), px(z0), px(x1), px(y1), px(z1)];

/** Rotates a box (defined facing north) around Y to the given facing. */
export function rotateBox(b: Box, facing: string): Box {
  const [x0, y0, z0, x1, y1, z1] = b;
  switch (facing) {
    case 'south':
      return [1 - x1, y0, 1 - z1, 1 - x0, y1, 1 - z0];
    case 'west':
      return [z0, y0, 1 - x1, z1, y1, 1 - x0];
    case 'east':
      return [1 - z1, y0, x0, 1 - z0, y1, x1];
    default:
      return b;
  }
}

/** Box of given thickness (pixels) lying against the given side of the block. */
export function edgeBox(side: string, thick: number, y0 = 0, y1 = 16, x0 = 0, x1 = 16): Box {
  return rotateBox(box(x0, y0, 0, x1, y1, thick), side);
}

let collisionCache: (Shape | undefined)[] = [];
let selectionCache: (Shape | undefined)[] = [];

export function collisionShape(state: number): Shape {
  if (STATE_FULL_CUBE[state]) return FULL;
  let s = collisionCache[state];
  if (s) return s;
  s = computeShape(state, true);
  collisionCache[state] = s;
  return s;
}

export function selectionShape(state: number): Shape {
  let s = selectionCache[state];
  if (s) return s;
  s = computeShape(state, false);
  selectionCache[state] = s;
  return s;
}

export function resetShapeCache(): void {
  collisionCache = [];
  selectionCache = [];
}

const b = (s: number): string => blocks[STATE_BLOCK[s]!]!.def.model;

function connections(state: number): string[] {
  return ['north', 'south', 'west', 'east'].filter((d) => getProp(state, d) === 'true');
}

function computeShape(state: number, collision: boolean): Shape {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const def = bt.def;
  const collides = blockCollides(def);
  if (collision && !collides) return EMPTY;
  const model = b(state);
  switch (model) {
    case 'none':
      return EMPTY;
    case 'liquid':
      return collision ? EMPTY : EMPTY;
    case 'cube':
    case 'column':
    case 'mushroom_block':
      if (def.id === 'honey_block' || def.id === 'soul_sand') return collision ? [box(0, 0, 0, 16, 14, 16)] : FULL;
      return FULL;
    case 'slab': {
      const t = getProp(state, 'type');
      if (t === 'double') return FULL;
      return t === 'top' ? [box(0, 8, 0, 16, 16, 16)] : [box(0, 0, 0, 16, 8, 16)];
    }
    case 'stairs':
      return stairShape(state);
    case 'fence': {
      const h = collision ? 24 : 16;
      const out: Box[] = [box(6, 0, 6, 10, h, 10)];
      for (const c of connections(state)) out.push(rotateBox(box(6, 0, 0, 10, h, 6), c));
      return out;
    }
    case 'wall': {
      const h = collision ? 24 : 16;
      const out: Box[] = [box(4, 0, 4, 12, h, 12)];
      for (const c of connections(state)) out.push(rotateBox(box(5, 0, 0, 11, collision ? 24 : 14, 4), c));
      return out;
    }
    case 'pane': {
      const out: Box[] = [box(7, 0, 7, 9, 16, 9)];
      for (const c of connections(state)) out.push(rotateBox(box(7, 0, 0, 9, 16, 7), c));
      return out;
    }
    case 'fence_gate': {
      const open = getProp(state, 'open') === 'true';
      const facing = getProp(state, 'facing')!;
      if (collision && open) return EMPTY;
      const along = facing === 'north' || facing === 'south';
      const h = collision ? 24 : 16;
      return along ? [box(0, 0, 6, 16, h, 10)] : [box(6, 0, 0, 10, h, 16)];
    }
    case 'door': {
      const facing = getProp(state, 'facing')!;
      const open = getProp(state, 'open') === 'true';
      const hinge = getProp(state, 'hinge');
      // Closed door occupies the side of the block the player faced when placing (the "facing" side)
      // Closed doors sit against the side nearest the placer (opposite of facing).
      let side = oppositeOf(facing);
      if (open) side = rotateFacing(side, hinge === 'left' ? 1 : -1);
      return [edgeBox(side, 3)];
    }
    case 'trapdoor': {
      const facing = getProp(state, 'facing')!;
      const open = getProp(state, 'open') === 'true';
      const half = getProp(state, 'half');
      if (open) return [edgeBox(oppositeOf(facing), 3)];
      return half === 'top' ? [box(0, 13, 0, 16, 16, 16)] : [box(0, 0, 0, 16, 3, 16)];
    }
    case 'carpet':
      return [box(0, 0, 0, 16, 1, 16)];
    case 'pressure_plate':
      return collision ? EMPTY : [box(1, 0, 1, 15, 1, 15)];
    case 'snow_layer': {
      const layers = parseInt(getProp(state, 'layers') ?? '1', 10);
      const h = collision ? (layers - 1) * 2 : layers * 2;
      return h <= 0 ? (collision ? EMPTY : [box(0, 0, 0, 16, 2, 16)]) : [box(0, 0, 0, 16, h, 16)];
    }
    case 'farmland':
    case 'path':
      return [box(0, 0, 0, 16, 15, 16)];
    case 'cactus':
      return collision ? [box(1, 0, 1, 15, 15, 15)] : [box(1, 0, 1, 15, 16, 15)];
    case 'chest':
      return [box(1, 0, 1, 15, 14, 15)];
    case 'bed':
      return [box(0, 0, 0, 16, 9, 16)];
    case 'lantern':
      return getProp(state, 'hanging') === 'true' ? [box(5, 1, 5, 11, 10, 11)] : [box(5, 0, 5, 11, 9, 11)];
    case 'enchanting_table':
      return [box(0, 0, 0, 16, 12, 16)];
    case 'anvil': {
      const f = getProp(state, 'facing')!;
      const ns = f === 'north' || f === 'south';
      return [box(2, 0, 2, 14, 4, 14), ns ? box(3, 4, 4, 13, 10, 12) : box(4, 4, 3, 12, 10, 13), ns ? box(0, 10, 3, 16, 16, 13) : box(3, 10, 0, 13, 16, 16)];
    }
    case 'end_portal_frame':
      return [box(0, 0, 0, 16, 13, 16)];
    case 'cauldron':
      return collision
        ? [box(0, 0, 0, 16, 4, 16), box(0, 0, 0, 2, 16, 16), box(14, 0, 0, 16, 16, 16), box(0, 0, 0, 16, 16, 2), box(0, 0, 14, 16, 16, 16)]
        : FULL;
    case 'ladder':
      return [edgeBox(oppositeOf(getProp(state, 'facing')!), 3)];
    case 'lily_pad':
      return [box(1, 0, 1, 15, 1.5, 15)];
    case 'chain':
    case 'rod': {
      const axis = getProp(state, 'axis') ?? axisOfFacing(getProp(state, 'facing') ?? 'up');
      if (def.id === 'bamboo') return [box(5, 0, 5, 11, 16, 11)];
      return axis === 'x' ? [box(0, 6.5, 6.5, 16, 9.5, 9.5)] : axis === 'z' ? [box(6.5, 6.5, 0, 9.5, 9.5, 16)] : [box(6.5, 0, 6.5, 9.5, 16, 9.5)];
    }
    case 'dripstone':
      return [box(5, 0, 5, 11, 16, 11)];
    case 'dragon_egg':
      return [box(1, 0, 1, 15, 16, 15)];
    case 'brewing_stand':
      return [box(1, 0, 1, 15, 2, 15), box(7, 2, 7, 9, 14, 9)];
    case 'campfire':
      return [box(0, 0, 0, 16, 7, 16)];
    case 'custom': {
      switch (def.id) {
        case 'scaffolding':
          return collision ? [box(0, 14, 0, 16, 16, 16)] : FULL;
        case 'cake': {
          const bites = parseInt(getProp(state, 'bites') ?? '0', 10);
          return [box(1 + bites * 2, 0, 1, 15, 8, 15)];
        }
        case 'flower_pot':
          return [box(5, 0, 5, 11, 6, 11)];
        case 'stonecutter':
          return [box(0, 0, 0, 16, 9, 16)];
        case 'sculk_sensor':
          return [box(0, 0, 0, 16, 8, 16)];
        case 'chorus_plant':
          return [box(3, 3, 3, 13, 13, 13)];
        case 'candle':
          return [box(4, 0, 4, 12, 7, 12)];
        case 'conduit':
          return [box(5, 5, 5, 11, 11, 11)];
        case 'sculk_shrieker':
          return [box(0, 0, 0, 16, 8, 16)];
        case 'cactus_flower':
          return collision ? EMPTY : [box(4, 0, 4, 12, 8, 12)];
        case 'ancient_urn':
          return [box(3, 0, 3, 13, 15, 13)];
        case 'bracket_fungus':
          return collision ? EMPTY : [edgeBox(oppositeOf(getProp(state, 'facing')!), 7, 5, 12, 2, 14)];
        case 'seashell':
          return collision ? EMPTY : [box(4, 0, 5, 12, 3, 11)];
        case 'big_dripleaf': {
          // The leaf gives way once it tilts all the way
          const tilt = getProp(state, 'tilt');
          if (collision && tilt === 'full') return EMPTY;
          return [box(0, 11, 0, 16, 15, 16)];
        }
        default:
          return FULL;
      }
    }
    // Non-colliding models: selection shapes only
    case 'cross':
    case 'crop':
    case 'double_plant':
      if (def.id === 'sweet_berry_bush') return [box(1, 0, 1, 15, 14, 15)];
      if (model === 'crop') {
        const age = parseInt(getProp(state, 'age') ?? '0', 10);
        const max = (def.data?.maxAge as number) ?? 7;
        return [box(0, 0, 0, 16, 2 + Math.round((age / max) * 12), 16)];
      }
      return [box(2, 0, 2, 14, 13, 14)];
    case 'torch':
      return [box(6, 0, 6, 10, 10, 10)];
    case 'wall_torch':
      return [edgeBox(oppositeOf(getProp(state, 'facing')!), 5, 3, 13, 5.5, 10.5)];
    case 'sign':
      return [box(4, 0, 4, 12, 16, 12)];
    case 'wall_sign':
      return [edgeBox(oppositeOf(getProp(state, 'facing')!), 2, 4.5, 12.5)];
    case 'button':
    case 'lever': {
      const face = getProp(state, 'face');
      const f = getProp(state, 'facing')!;
      if (face === 'floor') return [box(5, 0, 6, 11, 2, 10)];
      if (face === 'ceiling') return [box(5, 14, 6, 11, 16, 10)];
      return [edgeBox(oppositeOf(f), 2, 6, 10, 5, 11)];
    }
    case 'vine':
    case 'hanging_plant':
      return [box(1, 0, 1, 15, 16, 15)];
    case 'fire':
      return [box(0, 0, 0, 16, 1, 16)];
    case 'portal':
    case 'end_portal':
      return collision ? EMPTY : getProp(state, 'axis') === 'z' ? [box(6, 0, 0, 10, 16, 16)] : getProp(state, 'axis') === 'x' ? [box(0, 0, 6, 16, 16, 10)] : [box(0, 0, 0, 16, 12, 16)];
    default:
      return collides ? FULL : [box(2, 0, 2, 14, 14, 14)];
  }
}

function stairShape(state: number): Shape {
  const facing = getProp(state, 'facing')!;
  const half = getProp(state, 'half');
  const shape = getProp(state, 'shape');
  const top = half === 'top';
  const base: Box = top ? box(0, 8, 0, 16, 16, 16) : box(0, 0, 0, 16, 8, 16);
  const y0 = top ? 0 : 8;
  const y1 = top ? 8 : 16;
  // Step boxes defined for facing north (the high side is at the north/-Z edge)
  const out: Box[] = [base];
  switch (shape) {
    case 'inner_left':
      out.push(rotateBox(box(0, y0, 0, 16, y1, 8), facing), rotateBox(box(0, y0, 8, 8, y1, 16), facing));
      break;
    case 'inner_right':
      out.push(rotateBox(box(0, y0, 0, 16, y1, 8), facing), rotateBox(box(8, y0, 8, 16, y1, 16), facing));
      break;
    case 'outer_left':
      out.push(rotateBox(box(0, y0, 0, 8, y1, 8), facing));
      break;
    case 'outer_right':
      out.push(rotateBox(box(8, y0, 0, 16, y1, 8), facing));
      break;
    default:
      out.push(rotateBox(box(0, y0, 0, 16, y1, 8), facing));
  }
  return out;
}

export function oppositeOf(f: string): string {
  return f === 'north' ? 'south' : f === 'south' ? 'north' : f === 'west' ? 'east' : 'west';
}

/** Rotates a horizontal facing clockwise (+1) or counter-clockwise (-1). */
export function rotateFacing(f: string, dir: number): string {
  const order = ['north', 'east', 'south', 'west'];
  const i = order.indexOf(f);
  return order[(i + dir + 4) % 4]!;
}

function axisOfFacing(f: string): string {
  return f === 'up' || f === 'down' ? 'y' : f === 'north' || f === 'south' ? 'z' : 'x';
}
