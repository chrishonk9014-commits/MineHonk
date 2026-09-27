/**
 * Minimal RGBA pixel canvas used by the procedural pixel-art painters.
 * All painters are deterministic (seeded by texture name).
 */
import { Random, hashString } from '../../src/common/math/rng';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** Alpha value marking a texel as biome-tinted (see chunk shader). */
export const TINT_ALPHA = 254;

export function hex(c: number | string): RGB {
  const v = typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

export function shade(c: RGB, f: number): RGB {
  return [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
}

export function add(c: RGB, d: number): RGB {
  return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function gray(v: number): RGB {
  return [v, v, v];
}

/** Builds an n-step ramp from dark to light around a base colour. */
export function ramp(base: RGB, n = 5, spread = 0.35): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    out.push(shade(base, 1 + t * spread * 2));
  }
  return out;
}

export class Tex {
  readonly data: Uint8ClampedArray;
  readonly rng: Random;

  constructor(
    readonly w = 16,
    readonly h = 16,
    seedName = 'tex',
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.rng = new Random(hashString(seedName));
  }

  set(x: number, y: number, c: RGB | RGBA, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c.length === 4 ? c[3] : a;
  }

  get(x: number, y: number): RGBA {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3]!;
  }

  setAlpha(x: number, y: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[(y * this.w + x) * 4 + 3] = a;
  }

  fill(c: RGB, a = 255): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a);
    return this;
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 255): this {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
    return this;
  }

  /** Per-pixel random pick from a palette with weights. */
  noise(pal: RGB[], weights?: number[]): this {
    const w = weights ?? pal.map(() => 1);
    const total = w.reduce((s, v) => s + v, 0);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let r = this.rng.next() * total;
        let k = 0;
        while (k < pal.length - 1 && (r -= w[k]!) >= 0) k++;
        this.set(x, y, pal[k]!);
      }
    }
    return this;
  }

  /** Scatter `count` clumps of colour c with given size. */
  clumps(c: RGB, count: number, size = 2, a = 255): this {
    for (let i = 0; i < count; i++) {
      const cx = this.rng.int(this.w);
      const cy = this.rng.int(this.h);
      const n = 1 + this.rng.int(size);
      let x = cx;
      let y = cy;
      for (let k = 0; k < n; k++) {
        this.set(((x % this.w) + this.w) % this.w, ((y % this.h) + this.h) % this.h, c, a);
        if (this.rng.bool()) x += this.rng.bool() ? 1 : -1;
        else y += this.rng.bool() ? 1 : -1;
      }
    }
    return this;
  }

  speckle(c: RGB, chance: number, a = 255): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.rng.chance(chance)) this.set(x, y, c, a);
    return this;
  }

  /** Multiplies all texels by f (brightness). */
  scale(f: number): this {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = this.data[i]! * f;
      this.data[i + 1] = this.data[i + 1]! * f;
      this.data[i + 2] = this.data[i + 2]! * f;
    }
    return this;
  }

  /** Converts to grayscale (keeps relative brightness) so it can be biome tinted. */
  toTintable(brightness = 1.0): this {
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] === 0) continue;
      const l = (this.data[i]! * 0.3 + this.data[i + 1]! * 0.59 + this.data[i + 2]! * 0.11) * brightness;
      this.data[i] = l;
      this.data[i + 1] = l;
      this.data[i + 2] = l;
      this.data[i + 3] = TINT_ALPHA;
    }
    return this;
  }

  /** Draws another texture on top (alpha > 0 pixels only). */
  over(o: Tex, dx = 0, dy = 0): this {
    for (let y = 0; y < o.h; y++) {
      for (let x = 0; x < o.w; x++) {
        const i = (y * o.w + x) * 4;
        const a = o.data[i + 3]!;
        if (a === 0) continue;
        this.set(x + dx, y + dy, [o.data[i]!, o.data[i + 1]!, o.data[i + 2]!, a]);
      }
    }
    return this;
  }

  copy(): Tex {
    const t = new Tex(this.w, this.h, 'copy');
    t.data.set(this.data);
    return t;
  }

  /** Recolours every pixel through fn. */
  map(fn: (c: RGBA, x: number, y: number) => RGBA | null): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const r = fn(this.get(x, y), x, y);
        if (r) this.set(x, y, r);
      }
    }
    return this;
  }

  flipX(): this {
    const c = this.copy();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c.get(this.w - 1 - x, y));
    return this;
  }

  rotate90(): this {
    const c = this.copy();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c.get(y, this.w - 1 - x));
    return this;
  }

  /** Adds a 1px darker outline around opaque shapes (item sprites). */
  outline(c: RGB): this {
    const src = this.copy();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.alpha(x, y) !== 0) continue;
        if (src.alpha(x - 1, y) || src.alpha(x + 1, y) || src.alpha(x, y - 1) || src.alpha(x, y + 1)) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Paints an ASCII mask using a palette map. '.' / ' ' = transparent. */
  mask(rows: string[], pal: Record<string, RGB | RGBA>, ox = 0, oy = 0): this {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]!;
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!;
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c) this.set(x + ox, y + oy, c);
      }
    }
    return this;
  }
}
