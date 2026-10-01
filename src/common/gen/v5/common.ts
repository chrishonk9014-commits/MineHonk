/** Small helpers shared by the generator 5 structures (bunkers, temples, the pyramid). */
import type { Builder } from '../structures/builder';
import type { Box } from '../structures/manager';

export type P3 = [number, number, number];

/** A local position as a world position. */
export const at = (b: Builder, x: number, y: number, z: number): P3 => [b.wx(x, z), b.oy + y, b.wz(x, z)];

/** The box holding some world positions. */
export function boxOfPts(ps: P3[]): Box {
  const xs = ps.map((p) => p[0]);
  const ys = ps.map((p) => p[1]);
  const zs = ps.map((p) => p[2]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), z0: Math.min(...zs), x1: Math.max(...xs), y1: Math.max(...ys), z1: Math.max(...zs) };
}

/** A local box (two corners) as a world box. */
export const localBox = (b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => boxOfPts([at(b, x0, y0, z0), at(b, x1, y1, z1)]);
