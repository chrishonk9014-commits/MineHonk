/** View direction helpers shared by targeting and camera code. */

/** Unit look vector; yaw 0 faces -Z, positive pitch looks down. */
export function lookDirection(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Ray/AABB slab test. Returns the entry distance or null when missed. */
export function rayBox(o: [number, number, number], d: [number, number, number], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  const lo = [x0, y0, z0];
  const hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    const oi = o[i]!;
    const di = d[i]!;
    if (Math.abs(di) < 1e-9) {
      if (oi < lo[i]! || oi > hi[i]!) return null;
      continue;
    }
    let t1 = (lo[i]! - oi) / di;
    let t2 = (hi[i]! - oi) / di;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(0, tmin);
}
