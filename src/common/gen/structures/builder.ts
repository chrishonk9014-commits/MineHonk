/**
 * Structure building helpers: a rotated local coordinate frame over a
 * clipped DecorView, plus palette-based block placement. Structures are
 * authored facing north (towards -Z) in local space and rotated by the
 * builder, including directional block properties.
 */
import type { DecorView } from '../decorate/view';
import { S, stateOf, getProp, withProp, hasProp, STATE_SOLID, STATE_FLUID, STATE_REPLACEABLE } from '../../registry/blocks';
import type { Random } from '../../math/rng';
import type { BlockEntityData } from '../../world/chunk';

export type Rotation = 0 | 1 | 2 | 3;
const FACINGS = ['north', 'east', 'south', 'west'] as const;

/** Rotates a horizontal facing name clockwise `rot` quarter turns. */
export function rotateFacing(f: string, rot: Rotation): string {
  const i = FACINGS.indexOf(f as (typeof FACINGS)[number]);
  if (i < 0) return f;
  return FACINGS[(i + rot) & 3]!;
}

/** Rotates a block state's directional properties. */
export function rotateState(state: number, rot: Rotation): number {
  if (rot === 0 || state === 0) return state;
  let s = state;
  const f = getProp(s, 'facing');
  if (f && FACINGS.includes(f as (typeof FACINGS)[number])) s = withProp(s, 'facing', rotateFacing(f, rot));
  const axis = getProp(s, 'axis');
  if (axis && (rot & 1) === 1 && axis !== 'y') s = withProp(s, 'axis', axis === 'x' ? 'z' : 'x');
  // Multi-face blocks (fences/panes/vines) — rotate booleans
  if (hasProp(s, 'north') && hasProp(s, 'east')) {
    const vals = FACINGS.map((d) => getProp(s, d));
    for (let i = 0; i < 4; i++) s = withProp(s, FACINGS[(i + rot) & 3]!, vals[i]!);
  }
  return s;
}

export class Builder {
  constructor(
    readonly v: DecorView,
    /** World position of local (0,0,0). */
    readonly ox: number,
    readonly oy: number,
    readonly oz: number,
    readonly rot: Rotation,
    /** Local footprint size, used to keep rotations inside the same box. */
    readonly sx: number,
    readonly sz: number,
  ) {}

  /** Local -> world XZ. */
  wx(x: number, z: number): number {
    switch (this.rot) {
      case 0:
        return this.ox + x;
      case 1:
        return this.ox + (this.sz - 1 - z);
      case 2:
        return this.ox + (this.sx - 1 - x);
      default:
        return this.ox + z;
    }
  }

  wz(x: number, z: number): number {
    switch (this.rot) {
      case 0:
        return this.oz + z;
      case 1:
        return this.oz + x;
      case 2:
        return this.oz + (this.sz - 1 - z);
      default:
        return this.oz + (this.sx - 1 - x);
    }
  }

  set(x: number, y: number, z: number, state: number): void {
    this.v.set(this.wx(x, z), this.oy + y, this.wz(x, z), rotateState(state, this.rot));
  }

  get(x: number, y: number, z: number): number {
    return this.v.get(this.wx(x, z), this.oy + y, this.wz(x, z));
  }

  proto(x: number, y: number, z: number): number {
    return this.v.proto(this.wx(x, z), this.oy + y, this.wz(x, z));
  }

  blockEntity(x: number, y: number, z: number, data: BlockEntityData): void {
    this.v.setBlockEntity(this.wx(x, z), this.oy + y, this.wz(x, z), data);
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number): void {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, state);
  }

  /** Hollow box: walls/floor/ceiling of `wall`, interior of `inside`. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: number, inside: number | null = 0): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
          if (edge) this.set(x, y, z, wall);
          else if (inside !== null) this.set(x, y, z, inside);
        }
  }

  /** Replaces only air/replaceable blocks. */
  fillAir(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const s = this.get(x, y, z);
          if (s === 0 || STATE_REPLACEABLE[s]) this.set(x, y, z, state);
        }
  }

  /** Extends a foundation column of `state` down to solid ground. */
  foundation(x: number, z: number, y: number, state: number, max = 24): void {
    for (let d = 0; d < max; d++) {
      const s = this.get(x, y - d, z);
      if (d > 0 && STATE_SOLID[s] && !STATE_FLUID[s]) break;
      this.set(x, y - d, z, state);
    }
  }

  /** Clears everything above a footprint up to `height`. */
  clearAbove(x0: number, z0: number, x1: number, z1: number, y: number, height: number): void {
    for (let yy = y; yy < y + height; yy++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, yy, z, 0);
  }

  chest(x: number, y: number, z: number, facing: string, loot: string, seed: number): void {
    this.set(x, y, z, stateOf('chest', { facing }));
    this.blockEntity(x, y, z, { type: 'chest', loot, lootSeed: seed });
  }

  spawner(x: number, y: number, z: number, mob: string): void {
    this.set(x, y, z, S('spawner'));
    this.blockEntity(x, y, z, { type: 'spawner', mob, delay: 20 });
  }
}

/** Randomly swaps a block for weathered variants (cracked/mossy) when available. */
export function weathered(rng: Random, base: string, cracked?: string, mossy?: string, chance = 0.2): number {
  const r = rng.next();
  if (mossy && r < chance / 2) return S(mossy);
  if (cracked && r < chance) return S(cracked);
  return S(base);
}

export { S, stateOf };
