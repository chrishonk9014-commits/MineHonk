/** Natural terrain, stone family, ores, storage blocks, liquids. */
import { Tex, type RGB, hex, shade, mix, gray, TINT_ALPHA } from './canvas';
import { blotchy, voronoi, stones, bricks, tiles, oreSpots, bevel, frame } from './patterns';
import type { PainterRegistry } from './registry';

export const STONE_PAL: RGB[] = [hex(0x686868), hex(0x747474), hex(0x7f7f7f), hex(0x898989), hex(0x939393)];
export const DEEPSLATE_PAL: RGB[] = [hex(0x2f2f35), hex(0x3a3a40), hex(0x46464c), hex(0x505056), hex(0x5c5c62)];
export const DIRT_PAL: RGB[] = [hex(0x5d412b), hex(0x6f4f35), hex(0x866043), hex(0x93694a), hex(0xa27756)];
export const NETHERRACK_PAL: RGB[] = [hex(0x4e1d1d), hex(0x62272a), hex(0x723232), hex(0x823c3c), hex(0x944848)];
export const SAND_PAL: RGB[] = [hex(0xc9b98a), hex(0xd6c794), hex(0xdbcfa0), hex(0xe2d6ab), hex(0xe9e0bd)];

export function stone(t: Tex): Tex {
  blotchy(t, STONE_PAL, 2, 1.1);
  // a few crisp darker flecks
  t.clumps(STONE_PAL[0]!, 7, 3);
  t.clumps(STONE_PAL[4]!, 4, 2);
  return t;
}

export function deepslate(t: Tex): Tex {
  // horizontal layered look
  blotchy(t, DEEPSLATE_PAL, 1, 1);
  for (let i = 0; i < 9; i++) {
    const y = t.rng.int(16);
    const x0 = t.rng.int(16);
    const len = 3 + t.rng.int(6);
    for (let x = x0; x < x0 + len; x++) t.set(x % 16, y, DEEPSLATE_PAL[0]!);
    for (let x = x0 + 1; x < x0 + len - 1; x++) t.set(x % 16, (y + 1) % 16, DEEPSLATE_PAL[4]!);
  }
  return t;
}

export function dirt(t: Tex, pal = DIRT_PAL): Tex {
  blotchy(t, pal.slice(1, 4), 1, 1);
  t.speckle(pal[0]!, 0.07);
  t.speckle(pal[4]!, 0.05);
  return t;
}

function grassTopGray(t: Tex, lo = 0x8a, hi = 0xc4): Tex {
  const pal = [gray(lo), gray(lo + ((hi - lo) >> 2)), gray(lo + ((hi - lo) >> 1)), gray(hi - ((hi - lo) >> 3)), gray(hi)];
  blotchy(t, pal, 1, 1.25);
  t.speckle(gray(lo - 12), 0.05);
  t.toTintable();
  return t;
}

/** Grass side: dirt with a ragged grass fringe marked as tinted. */
function grassSide(t: Tex, topPal: RGB[] | null, dirtPal = DIRT_PAL, tint = true): Tex {
  dirt(t, dirtPal);
  const depth: number[] = [];
  for (let x = 0; x < 16; x++) depth.push(2 + t.rng.int(3) - (x % 5 === 0 ? 1 : 0));
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < depth[x]!; y++) {
      if (tint) {
        const g = y === depth[x]! - 1 ? 0x96 : t.rng.chance(0.3) ? 0xb4 : 0xa6;
        t.set(x, y, [g, g, g, TINT_ALPHA]);
      } else if (topPal) {
        t.set(x, y, topPal[t.rng.int(topPal.length)]!);
      }
    }
    // occasional drip
    if (t.rng.chance(0.2)) {
      const y = depth[x]!;
      if (tint) t.set(x, y, [0x8c, 0x8c, 0x8c, TINT_ALPHA]);
      else if (topPal) t.set(x, y, topPal[0]!);
    }
  }
  return t;
}

function sand(t: Tex, pal: RGB[]): Tex {
  blotchy(t, pal.slice(1, 4), 1, 0.9);
  t.speckle(pal[0]!, 0.08);
  t.speckle(pal[4]!, 0.08);
  return t;
}

function gravel(t: Tex): Tex {
  const cols = [hex(0x847f7f), hex(0x9a9493), hex(0x6f6a6a), hex(0xa7a19f), hex(0x7a6f6a)];
  const shades = new Map<number, RGB>();
  voronoi(t, 22, (x, y, c) => {
    if (!shades.has(c.cell)) shades.set(c.cell, cols[t.rng.int(cols.length)]!);
    const base = shades.get(c.cell)!;
    const e = c.d2 - c.d1;
    t.set(x, y, e < 0.6 ? hex(0x5a5554) : c.d1 < 1 ? shade(base, 1.1) : base);
  });
  return t;
}

function ice(t: Tex, base: RGB, alpha: number, cracks = 6): Tex {
  const pal = [shade(base, 0.9), base, shade(base, 1.05)];
  blotchy(t, pal, 2, 0.6);
  for (let i = 0; i < cracks; i++) {
    let x = t.rng.int(16);
    let y = t.rng.int(16);
    const len = 3 + t.rng.int(5);
    const dx = t.rng.bool() ? 1 : -1;
    for (let k = 0; k < len; k++) {
      t.set(x & 15, y & 15, shade(base, 1.18));
      x += t.rng.chance(0.6) ? dx : 0;
      y += 1;
    }
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.setAlpha(x, y, alpha);
  return t;
}

/** Polished stone: smooth fill with bevel border. */
function polished(t: Tex, pal: RGB[]): Tex {
  blotchy(t, pal.slice(1, 4), 2, 0.5);
  bevel(t, pal[4]!, pal[0]!, 0);
  return t;
}

function smoothStone(t: Tex): Tex {
  blotchy(t, [hex(0x9a9a9a), hex(0xa0a0a0), hex(0xa6a6a6)], 2, 0.6);
  frame(t, hex(0x8a8a8a));
  return t;
}

function stoneBricks(t: Tex, pal: RGB[], mortar: RGB, variant: 'normal' | 'mossy' | 'cracked' | 'chiseled' = 'normal'): Tex {
  blotchy(t, pal.slice(1, 4), 1, 0.7);
  // rows of 8px, bricks 16 and 8 wide alternating
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const row = y >> 3;
      const ly = y & 7;
      const off = row === 1 ? 8 : 0;
      const lx = (x + off) & 15;
      if (ly === 7 || lx === 15) t.set(x, y, mortar);
      else if (ly === 0 || lx === 0) t.set(x, y, pal[4]!);
      else if (ly === 6 || lx === 14) t.set(x, y, pal[0]!);
    }
  }
  if (variant === 'mossy') {
    const moss = [hex(0x4d6b2b), hex(0x5d7e33), hex(0x6a8f3a)];
    for (let i = 0; i < 9; i++) {
      const x0 = t.rng.int(16);
      const y0 = t.rng.int(16);
      for (let k = 0; k < 5 + t.rng.int(5); k++) t.set((x0 + t.rng.int(4)) & 15, (y0 + t.rng.int(3)) & 15, t.rng.pick(moss));
    }
  } else if (variant === 'cracked') {
    for (let i = 0; i < 3; i++) {
      let x = t.rng.int(16);
      let y = t.rng.int(16);
      for (let k = 0; k < 7; k++) {
        t.set(x & 15, y & 15, mortar);
        x += t.rng.int(3) - 1;
        y += 1;
      }
    }
  } else if (variant === 'chiseled') {
    blotchy(t, pal.slice(1, 4), 1, 0.7);
    bevel(t, pal[4]!, pal[0]!, 0);
    bevel(t, pal[0]!, pal[4]!, 3);
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) if (x === 5 || x === 10 || y === 5 || y === 10) t.set(x, y, pal[0]!);
    t.rect(7, 7, 2, 2, pal[4]!);
  }
  return t;
}

function cobble(t: Tex, pal = STONE_PAL, mortar = hex(0x5a5a5a)): Tex {
  return stones(t, [shade(pal[0]!, 0.9), pal[1]!, pal[2]!, pal[3]!, pal[4]!, shade(pal[4]!, 1.1)], mortar, 12);
}

function bedrock(t: Tex): Tex {
  const pal = [hex(0x222222), hex(0x3a3a3a), hex(0x575757), hex(0x7a7a7a), hex(0x9a9a9a)];
  blotchy(t, pal, 1, 1.6);
  return t;
}

function obsidian(t: Tex, crying = false): Tex {
  blotchy(t, [hex(0x0f0b18), hex(0x150f22), hex(0x1d1630), hex(0x271e3f)], 1, 1);
  for (let i = 0; i < 7; i++) {
    const x = t.rng.int(14);
    const y = t.rng.int(16);
    const len = 2 + t.rng.int(3);
    for (let k = 0; k < len; k++) t.set(x + k, y, k === 0 ? hex(0x3b2b5c) : hex(0x2f2249));
  }
  if (crying) {
    for (let i = 0; i < 6; i++) {
      const x = t.rng.int(16);
      const y = t.rng.int(12);
      for (let k = 0; k < 3; k++) t.set(x, y + k, k === 0 ? hex(0xc58bff) : hex(0x8e2fe6));
    }
  }
  return t;
}

function metalBlock(t: Tex, base: RGB, style: 'plate' | 'gem' | 'grid' | 'dust' = 'plate'): Tex {
  const pal = [shade(base, 0.7), shade(base, 0.85), base, shade(base, 1.1), shade(base, 1.25)];
  if (style === 'dust') {
    blotchy(t, pal, 1, 1.2);
    frame(t, pal[0]!);
    return t;
  }
  blotchy(t, [pal[1]!, pal[2]!, pal[2]!, pal[3]!], 2, 0.6);
  bevel(t, pal[4]!, pal[0]!, 0);
  if (style === 'plate') {
    bevel(t, pal[1]!, pal[3]!, 1);
    for (let i = 3; i < 13; i += 1) {
      if (t.rng.chance(0.25)) t.set(i, 4 + t.rng.int(8), pal[4]!);
    }
    // rivets
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) t.set(x, y, pal[0]!);
  } else if (style === 'gem') {
    for (let y = 2; y < 14; y++) {
      for (let x = 2; x < 14; x++) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        if (d < 3) t.set(x, y, pal[4]!);
        else if (d < 5 && (x + y) % 3 === 0) t.set(x, y, pal[3]!);
      }
    }
    bevel(t, pal[3]!, pal[1]!, 2);
  } else {
    for (let i = 0; i < 16; i += 4) {
      for (let k = 0; k < 16; k++) {
        t.set(i, k, pal[1]!);
        t.set(k, i, pal[1]!);
      }
    }
    bevel(t, pal[4]!, pal[0]!, 0);
  }
  return t;
}

function rawBlock(t: Tex, light: RGB, dark: RGB): Tex {
  const pal = [shade(dark, 0.8), dark, mix(dark, light, 0.5), light, shade(light, 1.15)];
  stones(t, pal, shade(dark, 0.6), 8);
  return t;
}

function terracotta(t: Tex, base: RGB): Tex {
  const pal = [shade(base, 0.92), shade(base, 0.97), base, shade(base, 1.03)];
  blotchy(t, pal, 2, 0.7);
  t.speckle(shade(base, 0.88), 0.03);
  return t;
}

function waterFrame(t: Tex, f: number, flow: boolean): void {
  // Grayscale waves (tinted in shader by biome water colour).
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const phase = (f / 32) * Math.PI * 2;
      let v: number;
      if (flow) {
        const s = (y - f) & 15;
        v = Math.sin(((x + s) / 16) * Math.PI * 4 + Math.sin(s * 0.8) * 0.5) * 0.5 + Math.sin(((s * 2) / 16) * Math.PI * 2) * 0.3;
      } else {
        v =
          Math.sin((x / 16) * Math.PI * 2 * 2 + phase + Math.sin((y / 16) * Math.PI * 2 + phase) * 0.8) * 0.45 +
          Math.sin((y / 16) * Math.PI * 2 * 3 - phase + Math.cos((x / 16) * Math.PI * 2) * 0.6) * 0.35;
      }
      const g = Math.round(0xb4 + v * 22 + (t.rng.next() - 0.5) * 6);
      t.set(x, y, [g, g, g, 176]);
    }
  }
}

function lavaFrame(t: Tex, f: number, flow: boolean): void {
  const pal = [hex(0xb13a06), hex(0xcf4f0a), hex(0xe8741a), hex(0xf6a33b), hex(0xfcd26a)];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const p = (f / 20) * Math.PI * 2;
      const yy = flow ? y - f * 0.8 : y;
      const v =
        Math.sin((x / 16) * Math.PI * 4 + Math.sin((yy / 16) * Math.PI * 2 + p) * 1.5) * 0.4 +
        Math.sin((yy / 16) * Math.PI * 4 + Math.cos((x / 16) * Math.PI * 2 - p) * 1.5) * 0.4 +
        Math.sin(((x + yy) / 16) * Math.PI * 2 + p) * 0.2;
      const k = Math.max(0, Math.min(4, Math.floor((v + 1) * 2.5)));
      t.set(x, y, pal[k]!);
    }
  }
}

function clay(t: Tex): Tex {
  blotchy(t, [hex(0x9197a3), hex(0x9aa0ac), hex(0xa1a7b3), hex(0xa8aebb)], 2, 0.8);
  return t;
}

function snow(t: Tex): Tex {
  blotchy(t, [hex(0xe9f2f2), hex(0xf3fafa), hex(0xfbffff), hex(0xffffff)], 1, 0.8);
  t.speckle(hex(0xdce8ec), 0.04);
  return t;
}

function mycelium(t: Tex): Tex {
  blotchy(t, [hex(0x5f5061), hex(0x6f6070), hex(0x7b6b7a), hex(0x8a7a88)], 1, 1.1);
  t.speckle(hex(0xa89aa8), 0.06);
  return t;
}

function podzol(t: Tex): Tex {
  blotchy(t, [hex(0x5a3d1d), hex(0x6a4a24), hex(0x7a5530), hex(0x8e6438)], 1, 1.1);
  t.speckle(hex(0x9c7a4a), 0.06);
  t.speckle(hex(0x3f2a13), 0.05);
  return t;
}

function mud(t: Tex): Tex {
  blotchy(t, [hex(0x2f2a2c), hex(0x3a3436), hex(0x433c3e), hex(0x4d4648)], 2, 0.9);
  t.speckle(hex(0x57504f), 0.05);
  return t;
}

function moss(t: Tex): Tex {
  blotchy(t, [hex(0x455e23), hex(0x566f2b), hex(0x5f7c30), hex(0x6c8b37), hex(0x7b9b40)], 1, 1.2);
  return t;
}

function andesiteLike(t: Tex, pal: RGB[], specks: RGB[]): Tex {
  blotchy(t, pal, 1, 1);
  for (const s of specks) t.clumps(s, 6, 3);
  return t;
}

export function registerNatural(r: PainterRegistry): void {
  r.add('stone', (t) => stone(t));
  r.add('granite', (t) => andesiteLike(t, [hex(0x8e6352), hex(0x9a6b58), hex(0xa4735f), hex(0xb07e69)], [hex(0x7a5244), hex(0xc39180)]));
  r.add('polished_granite', (t) => polished(t, [hex(0x7f5647), hex(0x94675a), hex(0x9f6f5e), hex(0xa97765), hex(0xbd8a77)]));
  r.add('diorite', (t) => andesiteLike(t, [hex(0xb8b8b8), hex(0xc4c4c4), hex(0xcccccc), hex(0xd6d6d6)], [hex(0x8c8c8c), hex(0xeeeeee)]));
  r.add('polished_diorite', (t) => polished(t, [hex(0xa6a6a6), hex(0xbfbfc0), hex(0xc8c8c9), hex(0xd2d2d3), hex(0xe3e3e4)]));
  r.add('andesite', (t) => andesiteLike(t, [hex(0x7e7e80), hex(0x858587), hex(0x8b8b8d), hex(0x939395)], [hex(0x6b6b6d), hex(0xa4a4a6)]));
  r.add('polished_andesite', (t) => polished(t, [hex(0x6f7072), hex(0x7f8083), hex(0x86888a), hex(0x8e9092), hex(0x9c9ea0)]));
  r.add('tuff', (t) => andesiteLike(t, [hex(0x5c5e57), hex(0x65675f), hex(0x6c6e66), hex(0x75776f)], [hex(0x4b4d47), hex(0x86887f)]));
  r.add('calcite', (t) => andesiteLike(t, [hex(0xd6d8d6), hex(0xdfe1df), hex(0xe5e7e5), hex(0xeceeec)], [hex(0xc2c4c2)]));
  r.add('deepslate', (t) => deepslate(t));
  r.add('deepslate_top', (t) => {
    blotchy(t, DEEPSLATE_PAL, 2, 1);
    for (let i = 0; i < 16; i++) t.set(i, i, DEEPSLATE_PAL[1]!);
  });
  r.add('cobbled_deepslate', (t) => cobble(t, DEEPSLATE_PAL, hex(0x222226)));
  r.add('polished_deepslate', (t) => polished(t, DEEPSLATE_PAL));
  r.add('deepslate_bricks', (t) => bricks(t, DEEPSLATE_PAL, hex(0x1e1e22), 8, 4, 4));
  r.add('cracked_deepslate_bricks', (t) => {
    bricks(t, DEEPSLATE_PAL, hex(0x1e1e22), 8, 4, 4);
    for (let i = 0; i < 3; i++) {
      let x = t.rng.int(16);
      for (let y = t.rng.int(8); y < 16; y += 1) {
        t.set(x & 15, y, hex(0x1e1e22));
        x += t.rng.int(3) - 1;
      }
    }
  });
  r.add('deepslate_tiles', (t) => tiles(t, DEEPSLATE_PAL, 4, 0, hex(0x1c1c20)));
  r.add('chiseled_deepslate', (t) => stoneBricks(t, DEEPSLATE_PAL, hex(0x1e1e22), 'chiseled'));
  r.add('reinforced_deepslate_side', (t) => {
    deepslate(t);
    frame(t, hex(0x6b6b58));
    for (let i = 0; i < 16; i += 5) for (let k = 0; k < 16; k++) t.set(i, k, hex(0x55554a));
  });
  r.add('reinforced_deepslate_top', (t) => {
    deepslate(t);
    frame(t, hex(0x6b6b58));
    t.rect(5, 5, 6, 6, hex(0x3a3a2f));
  });
  r.add('reinforced_deepslate_bottom', (t) => {
    deepslate(t);
    frame(t, hex(0x6b6b58));
  });
  r.add('cobblestone', (t) => cobble(t));
  r.add('mossy_cobblestone', (t) => {
    cobble(t);
    const moss = [hex(0x4d6b2b), hex(0x5d7e33), hex(0x6a8f3a), hex(0x456024)];
    for (let i = 0; i < 12; i++) {
      const x0 = t.rng.int(16);
      const y0 = t.rng.int(16);
      for (let k = 0; k < 6; k++) t.set((x0 + t.rng.int(4)) & 15, (y0 + t.rng.int(4)) & 15, t.rng.pick(moss));
    }
  });
  r.add('smooth_stone', (t) => smoothStone(t));
  r.add('stone_bricks', (t) => stoneBricks(t, STONE_PAL, hex(0x565656)));
  r.add('mossy_stone_bricks', (t) => stoneBricks(t, STONE_PAL, hex(0x565656), 'mossy'));
  r.add('cracked_stone_bricks', (t) => stoneBricks(t, STONE_PAL, hex(0x565656), 'cracked'));
  r.add('chiseled_stone_bricks', (t) => stoneBricks(t, STONE_PAL, hex(0x565656), 'chiseled'));
  r.add('bricks', (t) => bricks(t, [hex(0x7a3b2d), hex(0x8c4535), hex(0x96503f), hex(0xa55a47), hex(0xb36a55)], hex(0x9d9690), 8, 4, 4, hex(0xb2aca6)));
  r.add('mud_bricks', (t) => bricks(t, [hex(0x7f6650), hex(0x89705a), hex(0x957b63), hex(0x9f866d), hex(0xab9279)], hex(0x6e5845), 8, 4, 4));
  r.add('packed_mud', (t) => {
    blotchy(t, [hex(0x8a6b50), hex(0x957559), hex(0x9e7e61), hex(0xa8876a)], 1, 0.9);
    t.speckle(hex(0xb8a080), 0.06);
  });
  r.add('bedrock', (t) => bedrock(t));
  r.add('obsidian', (t) => obsidian(t));
  r.add('crying_obsidian', (t) => obsidian(t, true));
  r.add('dripstone_block', (t) => {
    blotchy(t, [hex(0x7b5f51), hex(0x866858), hex(0x8f7161), hex(0x9a7b6a)], 1, 1);
    for (let y = 0; y < 16; y += 3) for (let x = 0; x < 16; x++) if (t.rng.chance(0.4)) t.set(x, y, hex(0x6d5347));
  });
  r.add('pointed_dripstone', (t) => {
    t.clear();
    const c = [hex(0x6d5347), hex(0x866858), hex(0x9a7b6a)];
    for (let y = 0; y < 16; y++) {
      const w = Math.max(1, Math.round((16 - y) / 4));
      for (let x = 8 - w; x < 8 + w; x++) t.set(x, y, c[(x + y) % 3]!);
    }
  });
  r.add('amethyst_block', (t) => {
    blotchy(t, [hex(0x5c3f99), hex(0x7a55c1), hex(0x8d68d4), hex(0xa583e8), hex(0xc6a8ff)], 1, 1.3);
  });
  r.add('amethyst_cluster', (t) => {
    t.clear();
    const c = [hex(0x7a55c1), hex(0xa583e8), hex(0xe0ccff)];
    for (const [x0, h] of [[4, 10], [7, 14], [10, 9], [12, 6]] as const) {
      for (let y = 16 - h; y < 16; y++) {
        t.set(x0, y, c[1]!);
        t.set(x0 + 1, y, c[0]!);
      }
      t.set(x0, 16 - h, c[2]!);
    }
  });

  // Soils
  r.add('dirt', (t) => dirt(t));
  r.add('coarse_dirt', (t) => {
    dirt(t);
    t.clumps(hex(0x4a3322), 10, 3);
    t.clumps(hex(0x9d8568), 8, 2);
  });
  r.add('rooted_dirt', (t) => {
    dirt(t);
    for (let i = 0; i < 5; i++) {
      let x = t.rng.int(16);
      for (let y = t.rng.int(8); y < 16; y++) {
        t.set(x & 15, y, hex(0xa37b52));
        if (t.rng.chance(0.4)) x += t.rng.bool() ? 1 : -1;
      }
    }
  });
  r.add('grass_block_top', (t) => grassTopGray(t));
  r.add('grass_block_side', (t) => grassSide(t, null));
  r.add('grass_block_snow', (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) {
      const d = 3 + t.rng.int(3);
      for (let y = 0; y < d; y++) t.set(x, y, y === d - 1 ? hex(0xdfe9ec) : hex(0xf5fbfb));
    }
  });
  r.add('grass_block_side_overlay', (t) => {
    t.clear();
    for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) t.set(x, y, [0xa0, 0xa0, 0xa0, TINT_ALPHA]);
  });
  r.add('podzol_top', (t) => podzol(t));
  r.add('podzol_side', (t) => grassSide(t, [hex(0x6a4a24), hex(0x7a5530), hex(0x5a3d1d)], DIRT_PAL, false));
  r.add('mycelium_top', (t) => mycelium(t));
  r.add('mycelium_side', (t) => grassSide(t, [hex(0x6f6070), hex(0x7b6b7a), hex(0x8a7a88)], DIRT_PAL, false));
  r.add('dirt_path_top', (t) => {
    blotchy(t, [hex(0x8c6b3c), hex(0x9a7746), hex(0xa7824d), hex(0xb38d57)], 1, 1);
  });
  r.add('dirt_path_side', (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, [0, 0, 0, 0]);
      t.set(x, 1, hex(0x9a7746));
      if (t.rng.chance(0.5)) t.set(x, 2, hex(0x8c6b3c));
    }
  });
  r.add('farmland', (t) => {
    dirt(t);
    for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x4f3726));
    for (let y = 2; y < 16; y += 4) for (let x = 0; x < 16; x++) if (t.rng.chance(0.5)) t.set(x, y, hex(0x96704f));
  });
  r.add('farmland_moist', (t) => {
    dirt(t, DIRT_PAL.map((c) => shade(c, 0.62)));
    for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x2b1e14));
  });
  r.add('mud', (t) => mud(t));
  r.add('clay', (t) => clay(t));
  r.add('gravel', (t) => gravel(t));
  r.add('sand', (t) => sand(t, SAND_PAL));
  r.add('red_sand', (t) => sand(t, [hex(0x9e4d1a), hex(0xa9551e), hex(0xb35d22), hex(0xbd6628), hex(0xc87231)]));
  r.add('suspicious_sand', (t) => {
    sand(t, SAND_PAL);
    t.clumps(hex(0xb8a870), 6, 3);
  });
  const sandstonePal = [hex(0xc8b686), hex(0xd4c396), hex(0xdccda0), hex(0xe2d4a9), hex(0xe9ddb6)];
  const redSandstonePal = [hex(0x9e4f1d), hex(0xa85822), hex(0xb26027), hex(0xba682d), hex(0xc47336)];
  for (const [prefix, pal] of [
    ['sandstone', sandstonePal],
    ['red_sandstone', redSandstonePal],
  ] as const) {
    r.add(prefix, (t) => {
      blotchy(t, pal.slice(1, 4), 1, 0.6);
      for (let x = 0; x < 16; x++) {
        t.set(x, 0, pal[4]!);
        t.set(x, 3, pal[0]!);
        t.set(x, 4, pal[4]!);
        if (t.rng.chance(0.5)) t.set(x, 10, pal[1]!);
        t.set(x, 15, pal[0]!);
      }
    });
    r.add(prefix + '_top', (t) => {
      blotchy(t, pal.slice(1, 5), 1, 0.6);
    });
    r.add(prefix + '_bottom', (t) => {
      blotchy(t, pal.slice(0, 4), 1, 0.8);
    });
    r.add('cut_' + prefix, (t) => {
      blotchy(t, pal.slice(1, 4), 1, 0.5);
      bevel(t, pal[4]!, pal[0]!, 0);
      for (let x = 0; x < 16; x++) t.set(x, 7, pal[0]!);
      for (let x = 0; x < 16; x++) t.set(x, 8, pal[4]!);
    });
    r.add('chiseled_' + prefix, (t) => {
      blotchy(t, pal.slice(1, 4), 1, 0.5);
      bevel(t, pal[4]!, pal[0]!, 0);
      for (let x = 2; x < 14; x++) {
        t.set(x, 3, pal[0]!);
        t.set(x, 12, pal[0]!);
      }
      // glyph
      t.mask(['..xx..', '.x..x.', 'xxxxxx', '.x..x.', '..xx..'], { x: pal[0]! }, 5, 5);
    });
  }
  r.add('snow', (t) => snow(t));
  r.add('snow_block', (t) => snow(t));
  r.add('powder_snow', (t) => {
    snow(t);
    t.speckle(hex(0xd8e6ee), 0.08);
  });
  r.add('ice', (t) => ice(t, hex(0x91b8f5), 190));
  r.add('packed_ice', (t) => ice(t, hex(0x8db4f0), 255, 10));
  r.add('blue_ice', (t) => ice(t, hex(0x74a4f4), 255, 8));
  r.add('moss_block', (t) => moss(t));
  r.add('bone_block_side', (t) => {
    blotchy(t, [hex(0xd6d1b8), hex(0xdfdac2), hex(0xe5e1c9)], 1, 0.6);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) t.set(x, y, hex(0xbfb89c));
  });
  r.add('bone_block_top', (t) => {
    blotchy(t, [hex(0xd6d1b8), hex(0xdfdac2), hex(0xe5e1c9)], 1, 0.6);
    for (const [x, y] of [[3, 3], [11, 3], [3, 11], [11, 11]] as const) t.rect(x, y, 2, 2, hex(0xa9a288));
  });

  // Terracotta
  const TERRA: Record<string, number> = {
    terracotta: 0x985e43,
    white: 0xd1b2a1,
    orange: 0xa05325,
    magenta: 0x95576c,
    light_blue: 0x716c89,
    yellow: 0xba8523,
    lime: 0x677534,
    pink: 0xa04d4e,
    gray: 0x392a23,
    light_gray: 0x876b62,
    cyan: 0x575b5b,
    purple: 0x764656,
    blue: 0x4a3b5b,
    brown: 0x4d3323,
    green: 0x4c532a,
    red: 0x8f3d2e,
    black: 0x251710,
  };
  for (const [k, v] of Object.entries(TERRA)) {
    r.add(k === 'terracotta' ? 'terracotta' : k + '_terracotta', (t) => terracotta(t, hex(v)));
  }

  // Liquids
  r.anim('water_still', 32, 2, (t, f) => waterFrame(t, f, false));
  r.anim('water_flow', 16, 1, (t, f) => waterFrame(t, f, true));
  r.anim('lava_still', 20, 3, (t, f) => lavaFrame(t, f, false));
  r.anim('lava_flow', 16, 2, (t, f) => lavaFrame(t, f, true));

  // Ores
  const ORE: Record<string, [number, number, number?]> = {
    coal: [0x3a3a3a, 0x3c3c3c, 0x161616],
    iron: [0xe2c0aa, 0xa07a60, 0xd8af93],
    copper: [0xe7865f, 0x7a9a78, 0xc36c47],
    gold: [0xfcee4b, 0xae8a1c, 0xf5d53b],
    redstone: [0xff3030, 0x8e0000, 0xd40000],
    lapis: [0x3c6ae0, 0x10307c, 0x1f4bb4],
    diamond: [0xa1fbe8, 0x1a9f9c, 0x4aedd9],
    emerald: [0x71f0a0, 0x006c25, 0x17c544],
  };
  for (const [name, [light, dark, mid]] of Object.entries(ORE)) {
    r.add(name + '_ore', (t) => {
      stone(t);
      oreSpots(t, hex(light), hex(dark), name === 'diamond' || name === 'emerald' ? 4 : 6, mid !== undefined ? hex(mid) : undefined);
    });
    r.add('deepslate_' + name + '_ore', (t) => {
      deepslate(t);
      oreSpots(t, hex(light), hex(dark), name === 'diamond' || name === 'emerald' ? 4 : 6, mid !== undefined ? hex(mid) : undefined);
    });
  }
  r.add('sunstone_ore', (t) => {
    stone(t);
    oreSpots(t, hex(0xfff0a0), hex(0xb05a0a), 5, hex(0xffb13a));
  });

  // Storage blocks
  r.add('coal_block', (t) => metalBlock(t, hex(0x1d1d1f), 'dust'));
  r.add('iron_block', (t) => metalBlock(t, hex(0xd8d8d8), 'plate'));
  r.add('gold_block', (t) => metalBlock(t, hex(0xf5d33a), 'plate'));
  r.add('diamond_block', (t) => metalBlock(t, hex(0x62ded8), 'gem'));
  r.add('emerald_block', (t) => metalBlock(t, hex(0x2acb58), 'gem'));
  r.add('lapis_block', (t) => metalBlock(t, hex(0x2552a6), 'dust'));
  r.add('redstone_block', (t) => metalBlock(t, hex(0xb01b0c), 'grid'));
  r.add('copper_block', (t) => metalBlock(t, hex(0xc26a4c), 'plate'));
  r.add('netherite_block', (t) => metalBlock(t, hex(0x44393a), 'grid'));
  r.add('sunstone_block', (t) => metalBlock(t, hex(0xffb13a), 'gem'));
  r.add('raw_iron_block', (t) => rawBlock(t, hex(0xd8af93), hex(0x8f6e57)));
  r.add('raw_gold_block', (t) => rawBlock(t, hex(0xf5d53b), hex(0xae8a1c)));
  r.add('raw_copper_block', (t) => rawBlock(t, hex(0xe7865f), hex(0x9a4f35)));
}
