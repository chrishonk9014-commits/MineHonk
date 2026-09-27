/** Reusable seamless pattern generators for pixel-art textures. */
import { Tex, type RGB, mix, shade } from './canvas';

/** Seamless blotchy noise quantised into a palette (dark -> light). */
export function blotchy(t: Tex, pal: RGB[], smooth = 1, contrast = 1): Tex {
  const w = t.w;
  const h = t.h;
  let v = new Float32Array(w * h);
  for (let i = 0; i < v.length; i++) v[i] = t.rng.next();
  for (let s = 0; s < smooth; s++) {
    const nv = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = (x + dx + w) % w;
            const yy = (y + dy + h) % h;
            sum += v[yy * w + xx]! * (dx === 0 && dy === 0 ? 2 : 1);
          }
        }
        nv[y * w + x] = sum / 10;
      }
    }
    // mix back some fine detail so it doesn't get mushy
    for (let i = 0; i < nv.length; i++) nv[i] = nv[i]! * 0.8 + t.rng.next() * 0.2;
    v = nv;
  }
  // rank normalise
  const sorted = Array.from(v).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)]!;
  const hi = sorted[Math.floor(sorted.length * 0.98)]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = (v[y * w + x]! - lo) / (hi - lo || 1);
      n = 0.5 + (n - 0.5) * contrast;
      const k = Math.max(0, Math.min(pal.length - 1, Math.floor(n * pal.length)));
      t.set(x, y, pal[k]!);
    }
  }
  return t;
}

export interface CellInfo {
  cell: number;
  d1: number;
  d2: number;
  px: number;
  py: number;
}

/** Toroidal Voronoi cells: calls fn for every pixel with nearest point info. */
export function voronoi(t: Tex, count: number, fn: (x: number, y: number, c: CellInfo) => void, jitter = 1): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  // Stratified points for even distribution
  const grid = Math.ceil(Math.sqrt(count));
  const cw = t.w / grid;
  const ch = t.h / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      if (pts.length >= count) break;
      pts.push({ x: (gx + 0.5 + (t.rng.next() - 0.5) * jitter) * cw, y: (gy + 0.5 + (t.rng.next() - 0.5) * jitter) * ch });
    }
  }
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      let bpx = 0;
      let bpy = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x + 0.5 - (p.x + ox * t.w);
            const dy = y + 0.5 - (p.y + oy * t.h);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = i;
              bpx = p.x + ox * t.w;
              bpy = p.y + oy * t.h;
            } else if (d < d2) d2 = d;
          }
        }
      }
      fn(x, y, { cell: best, d1, d2, px: bpx, py: bpy });
    }
  }
  return pts;
}

/** Cobblestone-like rounded stones with mortar. */
export function stones(t: Tex, pal: RGB[], mortar: RGB, count = 9): Tex {
  const cellShade = new Map<number, number>();
  voronoi(t, count, (x, y, c) => {
    const edge = c.d2 - c.d1;
    if (edge < 0.75) {
      t.set(x, y, mortar);
      return;
    }
    if (!cellShade.has(c.cell)) cellShade.set(c.cell, t.rng.next());
    const base = cellShade.get(c.cell)!;
    // light from top-left
    const lx = (x + 0.5 - c.px) / 4;
    const ly = (y + 0.5 - c.py) / 4;
    let v = base * 0.45 + 0.45 - (lx + ly) * 0.16 + (t.rng.next() - 0.5) * 0.22;
    if (edge < 1.4) v -= 0.3;
    const k = Math.max(0, Math.min(pal.length - 1, Math.floor(v * pal.length)));
    t.set(x, y, pal[k]!);
  }, 0.9);
  return t;
}

/** Brick rows: rowH total height per row (incl. 1px mortar). */
export function bricks(t: Tex, brick: RGB[], mortar: RGB, brickW = 8, rowH = 4, offset = 4, mortarLight?: RGB): Tex {
  for (let y = 0; y < t.h; y++) {
    const row = Math.floor(y / rowH);
    const ry = y % rowH;
    const off = (row % 2) * offset;
    for (let x = 0; x < t.w; x++) {
      const bx = (x + off) % brickW;
      const brickIndex = Math.floor((x + off) / brickW) + row * 7;
      if (ry === rowH - 1 || bx === brickW - 1) {
        t.set(x, y, ry === rowH - 1 && mortarLight && t.rng.chance(0.3) ? mortarLight : mortar);
        continue;
      }
      const tone = (brickIndex * 2654435761) >>> 0;
      let k = 1 + (tone % (brick.length - 2));
      if (ry === 0) k = Math.min(brick.length - 1, k + 1);
      if (ry === rowH - 2 || bx === brickW - 2) k = Math.max(0, k - 1);
      if (t.rng.chance(0.15)) k = Math.max(0, Math.min(brick.length - 1, k + (t.rng.bool() ? 1 : -1)));
      t.set(x, y, brick[k]!);
    }
  }
  return t;
}

/** Beveled square tiles/blocks with highlight & shadow edges. */
export function tiles(t: Tex, pal: RGB[], size: number, offsetRows = 0, gap: RGB | null = null): Tex {
  blotchy(t, pal.slice(1, pal.length - 1), 1, 0.7);
  for (let y = 0; y < t.h; y++) {
    const row = Math.floor(y / size);
    const off = (row % 2) * offsetRows;
    for (let x = 0; x < t.w; x++) {
      const lx = (x + off) % size;
      const ly = y % size;
      if (gap && (lx === size - 1 || ly === size - 1)) {
        t.set(x, y, gap);
        continue;
      }
      if (lx === 0 || ly === 0) t.set(x, y, pal[pal.length - 1]!);
      else if (lx === size - 1 || ly === size - 1 || (gap && (lx === size - 2 || ly === size - 2))) t.set(x, y, pal[0]!);
    }
  }
  return t;
}

/** Concentric ring pattern (log tops). */
export function rings(t: Tex, ringA: RGB, ringB: RGB, center: RGB, border: RGB | null, borderInner?: RGB): Tex {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5);
      const dy = Math.abs(y - 7.5);
      const d = Math.max(dx, dy) * 0.7 + Math.sqrt(dx * dx + dy * dy) * 0.3;
      let c: RGB;
      if (d < 1.2) c = center;
      else c = Math.floor(d / 1.5 + t.rng.next() * 0.25) % 2 === 0 ? ringA : ringB;
      t.set(x, y, c);
    }
  }
  if (border) {
    for (let i = 0; i < 16; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, 15],
        [0, i],
        [15, i],
      ] as const) {
        t.set(x, y, t.rng.chance(0.3) ? shade(border, 0.85) : border);
      }
    }
    if (borderInner) {
      for (let i = 1; i < 15; i++) {
        for (const [x, y] of [
          [i, 1],
          [i, 14],
          [1, i],
          [14, i],
        ] as const) {
          if (t.rng.chance(0.5)) t.set(x, y, borderInner);
        }
      }
    }
  }
  return t;
}

/** Vertical bark/grain streaks. */
export function streaksV(t: Tex, pal: RGB[], darkLines = 3): Tex {
  for (let x = 0; x < 16; x++) {
    let k = t.rng.int(pal.length - 1) + 1;
    for (let y = 0; y < 16; y++) {
      if (t.rng.chance(0.25)) k = Math.max(1, Math.min(pal.length - 1, k + (t.rng.bool() ? 1 : -1)));
      t.set(x, y, pal[k]!);
    }
  }
  for (let i = 0; i < darkLines; i++) {
    const x = t.rng.int(16);
    const y0 = t.rng.int(16);
    const len = 3 + t.rng.int(8);
    for (let y = y0; y < y0 + len; y++) t.set(x, y % 16, pal[0]!);
  }
  return t;
}

/** Horizontal plank boards. */
export function planks(t: Tex, pal: RGB[]): Tex {
  // pal: [darkest seam, dark, mid, light, highlight]
  const boardH = 4;
  for (let b = 0; b < 4; b++) {
    const seamX = (b * 7 + 3 + t.rng.int(4)) % 16;
    for (let y = b * boardH; y < b * boardH + boardH; y++) {
      const ly = y - b * boardH;
      for (let x = 0; x < 16; x++) {
        let c: RGB;
        if (ly === boardH - 1) c = pal[0]!;
        else if (x === seamX) c = pal[1]!;
        else {
          const grain = t.rng.next();
          c = grain < 0.18 ? pal[1]! : grain < 0.8 ? pal[2]! : pal[3]!;
          if (ly === 0 && t.rng.chance(0.5)) c = pal[3]!;
        }
        t.set(x, y, c);
      }
    }
    // grain streaks
    for (let s = 0; s < 2; s++) {
      const gy = b * boardH + t.rng.int(3);
      const gx = t.rng.int(16);
      const gl = 3 + t.rng.int(6);
      for (let x = gx; x < gx + gl; x++) if (x % 16 !== seamX) t.set(x % 16, gy, pal[1]!);
    }
  }
  return t;
}

/** Leaves: clustered tones with transparent gaps (for cutout rendering). */
export function leaves(t: Tex, pal: RGB[], holeChance = 0.14): Tex {
  blotchy(t, pal, 1, 1.3);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (t.rng.chance(holeChance)) t.setAlpha(x, y, 0);
    }
  }
  // leaf highlights
  for (let i = 0; i < 18; i++) {
    const x = t.rng.int(16);
    const y = t.rng.int(16);
    if (t.alpha(x, y)) t.set(x, y, pal[pal.length - 1]!);
  }
  return t;
}

/** Ore spots over an existing base texture. */
export function oreSpots(t: Tex, light: RGB, dark: RGB, count = 5, mid?: RGB): Tex {
  const shapes = [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 0], [1, 0], [0, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  ];
  const placed: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    let ox = 0;
    let oy = 0;
    for (let tries = 0; tries < 30; tries++) {
      ox = 1 + t.rng.int(12);
      oy = 1 + t.rng.int(12);
      if (placed.every(([px, py]) => Math.abs(px - ox) + Math.abs(py - oy) > 5)) break;
    }
    placed.push([ox, oy]);
    const shape = t.rng.pick(shapes);
    const inShape = (x: number, y: number): boolean => shape.some(([dx, dy]) => ox + dx! === x && oy + dy! === y);
    for (const [dx, dy] of shape) {
      const x = ox + dx!;
      const y = oy + dy!;
      if (!inShape(x, y + 1)) t.set(x, y + 1, dark);
      if (!inShape(x + 1, y) && t.rng.chance(0.5)) t.set(x + 1, y, dark);
    }
    for (const [dx, dy] of shape) t.set(ox + dx!, oy + dy!, mid ?? light);
    const [hx, hy] = shape[0]!;
    t.set(ox + hx!, oy + hy!, light);
  }
  return t;
}

/** Soft wool-like texture with subtle diagonal fibres. */
export function wool(t: Tex, base: RGB): Tex {
  const pal = [shade(base, 0.86), shade(base, 0.93), base, shade(base, 1.06)];
  blotchy(t, pal, 1, 0.8);
  for (let i = 0; i < 26; i++) {
    const x = t.rng.int(16);
    const y = t.rng.int(16);
    t.set(x, y, shade(base, 0.82));
    t.set((x + 1) % 16, (y + 1) % 16, shade(base, 1.08));
  }
  return t;
}

export function frame(t: Tex, c: RGB, inset = 0): Tex {
  for (let i = inset; i < 16 - inset; i++) {
    t.set(i, inset, c);
    t.set(i, 15 - inset, c);
    t.set(inset, i, c);
    t.set(15 - inset, i, c);
  }
  return t;
}

export function bevel(t: Tex, light: RGB, dark: RGB, inset = 0): Tex {
  for (let i = inset; i < 16 - inset; i++) {
    t.set(i, inset, light);
    t.set(inset, i, light);
    t.set(i, 15 - inset, dark);
    t.set(15 - inset, i, dark);
  }
  return t;
}

export function hueShift(c: RGB, deg: number): RGB {
  const [r, g, b] = c.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + deg + 360) % 360;
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - C / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) [rr, gg, bb] = [C, X, 0];
  else if (h < 120) [rr, gg, bb] = [X, C, 0];
  else if (h < 180) [rr, gg, bb] = [0, C, X];
  else if (h < 240) [rr, gg, bb] = [0, X, C];
  else if (h < 300) [rr, gg, bb] = [X, 0, C];
  else [rr, gg, bb] = [C, 0, X];
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
}

export { mix, shade };
