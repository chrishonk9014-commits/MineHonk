/**
 * Seeded gradient noise (Perlin 2D/3D and Simplex 2D) plus fractal helpers.
 *
 * Implementations are written for speed: flat typed-array permutation tables,
 * no allocations in the hot path.
 */
import { Random } from './rng';

const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function dot(h: number, dx: number, dy: number, dz: number): number {
  const i = h * 3;
  return GRAD3[i]! * dx + GRAD3[i + 1]! * dy + GRAD3[i + 2]! * dz;
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

export class Perlin {
  private readonly perm = new Uint8Array(512);
  private readonly permMod16 = new Uint8Array(512);
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;

  constructor(rng: Random) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]!;
      this.permMod16[i] = this.perm[i]! & 15;
    }
    this.ox = rng.next() * 256;
    this.oy = rng.next() * 256;
    this.oz = rng.next() * 256;
  }

  noise3(x: number, y: number, z: number): number {
    x += this.ox;
    y += this.oy;
    z += this.oz;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const p = this.perm;
    const pm = this.permMod16;
    const A = p[X]! + Y;
    const AA = p[A]! + Z;
    const AB = p[A + 1]! + Z;
    const B = p[X + 1]! + Y;
    const BA = p[B]! + Z;
    const BB = p[B + 1]! + Z;
    return lerp(
      w,
      lerp(
        v,
        lerp(u, dot(pm[AA]!, x, y, z), dot(pm[BA]!, x - 1, y, z)),
        lerp(u, dot(pm[AB]!, x, y - 1, z), dot(pm[BB]!, x - 1, y - 1, z)),
      ),
      lerp(
        v,
        lerp(u, dot(pm[AA + 1]!, x, y, z - 1), dot(pm[BA + 1]!, x - 1, y, z - 1)),
        lerp(u, dot(pm[AB + 1]!, x, y - 1, z - 1), dot(pm[BB + 1]!, x - 1, y - 1, z - 1)),
      ),
    );
  }

  noise2(x: number, y: number): number {
    return this.noise3(x, y, 0.5);
  }
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD2 = new Float64Array([
  1, 0, -1, 0, 0, 1, 0, -1,
  0.7071067811865476, 0.7071067811865476, -0.7071067811865476, 0.7071067811865476,
  0.7071067811865476, -0.7071067811865476, -0.7071067811865476, -0.7071067811865476,
]);

/** 2D simplex noise, output roughly in [-1, 1]. */
export class Simplex2 {
  private readonly perm = new Uint8Array(512);
  private readonly ox: number;
  private readonly oy: number;

  constructor(rng: Random) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    this.ox = rng.next() * 1024;
    this.oy = rng.next() * 1024;
  }

  noise(xin: number, yin: number): number {
    xin += this.ox;
    yin += this.oy;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const p = this.perm;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = (p[ii + p[jj]!]! & 7) * 2;
      t0 *= t0;
      n += t0 * t0 * (GRAD2[gi]! * x0 + GRAD2[gi + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = (p[ii + i1 + p[jj + j1]!]! & 7) * 2;
      t1 *= t1;
      n += t1 * t1 * (GRAD2[gi]! * x1 + GRAD2[gi + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = (p[ii + 1 + p[jj + 1]!]! & 7) * 2;
      t2 *= t2;
      n += t2 * t2 * (GRAD2[gi]! * x2 + GRAD2[gi + 1]! * y2);
    }
    return 70 * n;
  }
}

/** Fractal (fBm) sum of simplex octaves; output normalised to about [-1, 1]. */
export class Octave2 {
  private readonly layers: Simplex2[] = [];
  private readonly norm: number;

  constructor(
    rng: Random,
    readonly octaves: number,
    readonly scale: number,
    readonly persistence = 0.5,
    readonly lacunarity = 2,
  ) {
    let amp = 1;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      this.layers.push(new Simplex2(rng));
      total += amp;
      amp *= persistence;
    }
    this.norm = 1 / total;
  }

  sample(x: number, z: number): number {
    let amp = 1;
    let freq = 1 / this.scale;
    let sum = 0;
    for (let i = 0; i < this.layers.length; i++) {
      sum += this.layers[i]!.noise(x * freq, z * freq) * amp;
      amp *= this.persistence;
      freq *= this.lacunarity;
    }
    return sum * this.norm;
  }

  /** Ridged variant: sharp crests, useful for mountain ranges and rivers. */
  ridged(x: number, z: number): number {
    let amp = 1;
    let freq = 1 / this.scale;
    let sum = 0;
    for (let i = 0; i < this.layers.length; i++) {
      const n = 1 - Math.abs(this.layers[i]!.noise(x * freq, z * freq));
      sum += n * n * amp;
      amp *= this.persistence;
      freq *= this.lacunarity;
    }
    return sum * this.norm;
  }
}

/** Fractal sum of 3D Perlin octaves; output normalised to about [-1, 1]. */
export class Octave3 {
  private readonly layers: Perlin[] = [];
  private readonly norm: number;

  constructor(
    rng: Random,
    readonly octaves: number,
    readonly scaleXZ: number,
    readonly scaleY: number,
    readonly persistence = 0.5,
  ) {
    let amp = 1;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      this.layers.push(new Perlin(rng));
      total += amp;
      amp *= persistence;
    }
    this.norm = 1 / total;
  }

  sample(x: number, y: number, z: number): number {
    let amp = 1;
    let fxz = 1 / this.scaleXZ;
    let fy = 1 / this.scaleY;
    let sum = 0;
    for (let i = 0; i < this.layers.length; i++) {
      sum += this.layers[i]!.noise3(x * fxz, y * fy, z * fxz) * amp;
      amp *= this.persistence;
      fxz *= 2;
      fy *= 2;
    }
    return sum * this.norm;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
