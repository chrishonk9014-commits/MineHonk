/**
 * Trilinear interpolation of a coarse 3D noise grid covering one chunk.
 * Cells are cellW x cellH x cellW blocks. Sampling the expensive noise only at
 * grid corners and interpolating is what keeps chunk generation fast.
 */
export class NoiseGrid {
  readonly nx: number;
  readonly ny: number;
  readonly data: Float32Array;

  constructor(
    readonly cellW: number,
    readonly cellH: number,
    readonly height: number,
  ) {
    this.nx = 16 / cellW + 1;
    this.ny = Math.ceil(height / cellH) + 1;
    this.data = new Float32Array(this.nx * this.nx * this.ny);
  }

  /** Fills grid samples; rows outside [yMin, yMax] get `outside` without evaluating fn. */
  fill(bx: number, bz: number, yMin: number, yMax: number, fn: (x: number, y: number, z: number) => number, outside = -1): void {
    const { nx, ny, cellW, cellH, data } = this;
    for (let gy = 0; gy < ny; gy++) {
      const y = gy * cellH;
      const inRange = y >= yMin - cellH && y <= yMax + cellH;
      for (let gz = 0; gz < nx; gz++) {
        for (let gx = 0; gx < nx; gx++) {
          data[(gy * nx + gz) * nx + gx] = inRange ? fn(bx + gx * cellW, y, bz + gz * cellW) : outside;
        }
      }
    }
  }

  /**
   * Expands to per-block values: out[(y * 16 + z) * 16 + x] for y in [0, height)
   * (only up to about `maxY` when given; rows above are left as they were).
   */
  expand(out: Float32Array, maxY = Infinity): void {
    const { nx, ny, cellW, cellH, data, height } = this;
    const cells = nx - 1;
    for (let gy = 0; gy < ny - 1; gy++) {
      if (gy * cellH > maxY) break;
      for (let gz = 0; gz < cells; gz++) {
        for (let gx = 0; gx < cells; gx++) {
          const i000 = (gy * nx + gz) * nx + gx;
          const i001 = i000 + 1;
          const i010 = i000 + nx;
          const i011 = i010 + 1;
          const i100 = i000 + nx * nx;
          const i101 = i100 + 1;
          const i110 = i100 + nx;
          const i111 = i110 + 1;
          const v000 = data[i000]!;
          const v001 = data[i001]!;
          const v010 = data[i010]!;
          const v011 = data[i011]!;
          const v100 = data[i100]!;
          const v101 = data[i101]!;
          const v110 = data[i110]!;
          const v111 = data[i111]!;
          for (let dy = 0; dy < cellH; dy++) {
            const y = gy * cellH + dy;
            if (y >= height) break;
            const ty = dy / cellH;
            const a00 = v000 + (v100 - v000) * ty;
            const a01 = v001 + (v101 - v001) * ty;
            const a10 = v010 + (v110 - v010) * ty;
            const a11 = v011 + (v111 - v011) * ty;
            for (let dz = 0; dz < cellW; dz++) {
              const tz = dz / cellW;
              const b0 = a00 + (a10 - a00) * tz;
              const b1 = a01 + (a11 - a01) * tz;
              const z = gz * cellW + dz;
              const row = (y * 16 + z) * 16 + gx * cellW;
              for (let dx = 0; dx < cellW; dx++) {
                out[row + dx] = b0 + (b1 - b0) * (dx / cellW);
              }
            }
          }
        }
      }
    }
  }
}
