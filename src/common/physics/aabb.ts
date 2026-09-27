/** Axis aligned bounding box utilities (mutable, allocation-light). */
export class AABB {
  constructor(
    public minX = 0,
    public minY = 0,
    public minZ = 0,
    public maxX = 0,
    public maxY = 0,
    public maxZ = 0,
  ) {}

  static of(x: number, y: number, z: number, w: number, h: number): AABB {
    return new AABB(x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2);
  }

  set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): this {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    return this;
  }

  copy(o: AABB): this {
    return this.set(o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ);
  }

  clone(): AABB {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }

  offset(dx: number, dy: number, dz: number): this {
    this.minX += dx;
    this.maxX += dx;
    this.minY += dy;
    this.maxY += dy;
    this.minZ += dz;
    this.maxZ += dz;
    return this;
  }

  expand(dx: number, dy: number, dz: number): this {
    if (dx < 0) this.minX += dx;
    else this.maxX += dx;
    if (dy < 0) this.minY += dy;
    else this.maxY += dy;
    if (dz < 0) this.minZ += dz;
    else this.maxZ += dz;
    return this;
  }

  grow(v: number): this {
    this.minX -= v;
    this.minY -= v;
    this.minZ -= v;
    this.maxX += v;
    this.maxY += v;
    this.maxZ += v;
    return this;
  }

  intersects(o: AABB): boolean {
    return this.minX < o.maxX && this.maxX > o.minX && this.minY < o.maxY && this.maxY > o.minY && this.minZ < o.maxZ && this.maxZ > o.minZ;
  }

  contains(x: number, y: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY && z >= this.minZ && z <= this.maxZ;
  }

  /** Clips movement along X against `o`. */
  clipX(o: AABB, dx: number): number {
    if (o.maxY <= this.minY || o.minY >= this.maxY || o.maxZ <= this.minZ || o.minZ >= this.maxZ) return dx;
    if (dx > 0 && o.maxX <= this.minX) {
      const d = this.minX - o.maxX;
      if (d < dx) dx = d;
    } else if (dx < 0 && o.minX >= this.maxX) {
      const d = this.maxX - o.minX;
      if (d > dx) dx = d;
    }
    return dx;
  }

  clipY(o: AABB, dy: number): number {
    if (o.maxX <= this.minX || o.minX >= this.maxX || o.maxZ <= this.minZ || o.minZ >= this.maxZ) return dy;
    if (dy > 0 && o.maxY <= this.minY) {
      const d = this.minY - o.maxY;
      if (d < dy) dy = d;
    } else if (dy < 0 && o.minY >= this.maxY) {
      const d = this.maxY - o.minY;
      if (d > dy) dy = d;
    }
    return dy;
  }

  clipZ(o: AABB, dz: number): number {
    if (o.maxX <= this.minX || o.minX >= this.maxX || o.maxY <= this.minY || o.minY >= this.maxY) return dz;
    if (dz > 0 && o.maxZ <= this.minZ) {
      const d = this.minZ - o.maxZ;
      if (d < dz) dz = d;
    } else if (dz < 0 && o.minZ >= this.maxZ) {
      const d = this.maxZ - o.minZ;
      if (d > dz) dz = d;
    }
    return dz;
  }

  /** Ray intersection; returns distance t (in ray units) and face, or null. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { t: number; face: number } | null {
    let tmin = -Infinity;
    let tmax = Infinity;
    let face = -1;
    const axes: [number, number, number, number, number, number][] = [
      [ox, dx, this.minX, this.maxX, 4, 5],
      [oy, dy, this.minY, this.maxY, 0, 1],
      [oz, dz, this.minZ, this.maxZ, 2, 3],
    ];
    for (const [o, d, mn, mx, fneg, fpos] of axes) {
      if (Math.abs(d) < 1e-12) {
        if (o < mn || o > mx) return null;
        continue;
      }
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      let f1 = fneg;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        f1 = fpos;
      }
      if (t1 > tmin) {
        tmin = t1;
        face = f1;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return { t: Math.max(0, tmin), face };
  }
}
