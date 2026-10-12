/**
 * V6 - The End Expansion: textures for the Expansion Portal and the
 * Expanded End's landscape blocks, and (phase 2) its stone, ores, crystal,
 * chorus, ancient and astral blocks and its items.
 *
 * The portal is set apart from the End's other ways through: the exit
 * portal and the gateways are a dark starfield, nether portals swirl in
 * violet. The Expansion Portal's sheet is ribbons of pale blue light rising
 * through deep indigo, framed in dark slate whose inlaid channels are cold
 * and empty while it sleeps and glow once it is alive.
 */
import { Tex, type RGB, hex, mix, shade } from './canvas';
import { bevel, blotchy, bricks, frame, oreSpots, tiles, voronoi, wool } from './patterns';
import type { PainterRegistry } from './registry';
import { GLYPHS } from '../../src/common/endExpansion/glyphs';

const SLATE: RGB[] = [hex(0x1c1828), hex(0x241f34), hex(0x2b2540), hex(0x342d4c)];
const CHANNEL_DARK = hex(0x120f1c);
const GLOW_A = hex(0x6fe3d0);
const GLOW_B = hex(0xd8fbff);

/** Dark slate with an inlaid channel ring and corner studs; the channel glows when lit. */
function portalFrame(t: Tex, lit: boolean): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(t.rng.pick(SLATE), 0.95 + t.rng.next() * 0.1));
  bevel(t, shade(SLATE[3]!, 1.25), shade(SLATE[0]!, 0.7));
  // The channel: a square ring with a gap in the middle of each side
  for (let i = 3; i <= 12; i++)
    for (const [x, y] of [
      [i, 3],
      [i, 12],
      [3, i],
      [12, i],
    ] as const) {
      if (i === 7 || i === 8) continue;
      t.set(x, y, lit ? mix(GLOW_A, GLOW_B, ((x + y) % 4) / 4) : CHANNEL_DARK);
    }
  // Diamond at the centre
  for (const [x, y] of [
    [7, 6],
    [8, 6],
    [6, 7],
    [9, 7],
    [6, 8],
    [9, 8],
    [7, 9],
    [8, 9],
  ] as const)
    t.set(x, y, lit ? GLOW_A : CHANNEL_DARK);
  for (const [x, y] of [
    [7, 7],
    [8, 7],
    [7, 8],
    [8, 8],
  ] as const)
    t.set(x, y, lit ? GLOW_B : shade(SLATE[1]!, 0.8));
  // Studs in the corners
  for (const [x, y] of [
    [1, 1],
    [14, 1],
    [1, 14],
    [14, 14],
  ] as const)
    t.set(x, y, lit ? shade(GLOW_A, 0.8) : SLATE[3]!);
}

/** Ribbons of light rising through indigo (32 frames, seamless). */
function portalSheet(t: Tex, f: number): void {
  const deep = hex(0x120a34);
  const mid = hex(0x3a52c4);
  const light = hex(0x9fe8ff);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const phase = (f / 32) * Math.PI * 2;
      const ribbon = Math.sin(x * 0.8 + Math.sin(y * 0.4 + phase) * 1.6) * 0.5 + Math.sin(y * 0.39 * 2 + phase * 2 - x * 0.3) * 0.5;
      const v = ribbon * 0.5 + 0.5;
      const col = v > 0.78 ? light : v > 0.45 ? mix(mid, light, (v - 0.45) / 0.33 * 0.4) : mix(deep, mid, v / 0.45);
      t.set(x, y, col, 210);
    }
  // A few motes that rise with the frames
  for (let i = 0; i < 4; i++) {
    const x = (i * 5 + 3) % 16;
    const y = (((16 - ((f * 2 + i * 9) % 16)) % 16) + 16) % 16;
    t.set(x, y, hex(0xf2feff), 240);
  }
}

/** A thin upright blade from (x, 15) upwards, leaning a little. */
function blade(t: Tex, x: number, h: number, lean: number, c: RGB, tip: RGB): void {
  let px = x;
  for (let k = 0; k < h; k++) {
    const y = 15 - k;
    if (k > 0 && k % 4 === 0) px += lean;
    t.set(px, y, k === h - 1 ? tip : shade(c, 0.9 + (k / h) * 0.2));
  }
}

export function registerV6Blocks(r: PainterRegistry): void {
  r.add('expansion_portal_frame', (t) => portalFrame(t, false));
  r.add('expansion_portal_frame_lit', (t) => portalFrame(t, true));
  r.anim('expansion_portal', 32, 2, (t, f) => portalSheet(t, f));

  // Ground of the Expanded End
  const PALE: RGB[] = [hex(0xc9c5b2), hex(0xd8d4c0), hex(0xe3dfcc), hex(0xece9d8), hex(0xf5f2e4)];
  r.add('pale_end_stone', (t) => {
    blotchy(t, PALE.slice(1, 5), 1, 0.7);
    for (let i = 0; i < 7; i++) {
      const x = t.rng.int(15);
      const y = t.rng.int(15);
      t.set(x, y, PALE[0]!);
      t.set(x + 1, y, shade(PALE[0]!, 1.04));
    }
  });
  const VOID: RGB[] = [hex(0x17111f), hex(0x1f1729), hex(0x271d34), hex(0x30243f), hex(0x3c2e4e)];
  r.add('voidstone', (t) => {
    voronoi(t, 10, (x, y, c) => t.set(x, y, c.d2 - c.d1 < 0.9 ? VOID[0]! : VOID[1 + (c.cell % 4)]!));
    t.speckle(hex(0x5a3f7a), 0.04);
  });
  r.add('luminous_moss', (t) => {
    blotchy(t, [hex(0x1f6a63), hex(0x24806f), hex(0x2a9884), hex(0x31ad96)], 1, 1.1);
    for (let i = 0; i < 9; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.chance(0.5) ? hex(0x8ff5e0) : hex(0x5fe0c8));
  });
  const DUNE: RGB[] = [hex(0xbfae84), hex(0xcdbc92), hex(0xd8c8a0), hex(0xe1d3ad), hex(0xeadfbd)];
  r.add('end_sand', (t) => {
    blotchy(t, DUNE.slice(1, 4), 1, 0.8);
    t.speckle(DUNE[0]!, 0.08);
    t.speckle(DUNE[4]!, 0.08);
    // faint ripples
    for (const y of [4, 10]) for (let x = 0; x < 16; x++) if ((x + y) % 5 !== 0) t.set(x, y + (x > 8 ? 1 : 0), shade(DUNE[1]!, 0.95));
  });
  r.add('prism_crystal', (t) => {
    const a = hex(0xd9a8e8);
    const b = hex(0xf2d4f8);
    const c = hex(0xfff4ff);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x + y) % 6 < 3 ? a : b, 200);
    for (let i = 0; i < 16; i++) t.set(i, (i * 3) % 16, c, 230);
    bevel(t, c, hex(0xb07ac8));
  });

  // Plants
  r.add('pale_grass', (t) => {
    t.clear();
    const c = hex(0xc8c4ae);
    for (const [x, h, lean] of [[3, 7, -1], [5, 10, 0], [7, 12, 1], [9, 9, 0], [11, 11, 1], [13, 6, 0]] as const) blade(t, x, h, lean, c, hex(0xf0ecdc));
  });
  r.add('dune_reed', (t) => {
    t.clear();
    const c = hex(0x9a8458);
    for (const [x, h, lean] of [[4, 12, 0], [7, 15, 0], [10, 13, 1], [12, 9, 0]] as const) {
      blade(t, x, h, lean, c, hex(0xc9b37e));
      // a seed head at the top of the tallest
      if (h >= 13) for (let k = 0; k < 3; k++) t.set(x + (h > 13 ? 0 : 1), 15 - h + 1 + k, hex(0x6e5a38));
    }
  });
  r.add('mist_bloom', (t) => {
    t.clear();
    const stem = hex(0x9aa6a0);
    for (let y = 8; y < 16; y++) t.set(7, y, stem);
    t.set(6, 12, stem);
    t.set(5, 11, stem);
    const petal = hex(0xf6f8ff);
    const shadow = hex(0xd6dcec);
    for (const [x, y] of [[7, 4], [6, 5], [8, 5], [5, 6], [9, 6], [6, 7], [8, 7], [7, 8]] as const) t.set(x, y, y > 6 ? shadow : petal);
    t.set(7, 6, hex(0xbfe8ff));
    t.set(7, 5, petal);
    t.set(6, 6, petal);
    t.set(8, 6, petal);
  });
  r.add('prism_cluster', (t) => {
    t.clear();
    const c = [hex(0xc690dc), hex(0xe8c4f4), hex(0xfff2ff)];
    for (const [x0, h] of [[3, 7], [6, 12], [9, 9], [11, 5]] as const) {
      for (let y = 16 - h; y < 16; y++) {
        t.set(x0, y, c[1]!);
        t.set(x0 + 1, y, c[0]!);
      }
      t.set(x0, 16 - h, c[2]!);
    }
  });
  r.add('void_vines', (t) => {
    t.clear();
    for (const [x0, len] of [[3, 14], [6, 16], [9, 12], [12, 15]] as const) {
      let x = x0;
      for (let y = 0; y < len; y++) {
        t.set(x, y, y % 5 === 4 ? hex(0x9a7ae8) : hex(0x4a3a8a));
        if (y % 6 === 5) x += t.rng.chance(0.5) ? 1 : -1;
      }
      t.set(x, len - 1, hex(0xb8a0ff));
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 2: the Expanded End's resources
// ---------------------------------------------------------------------------
/** Palettes of the four end stone variants: [mortar/dark, ...light]. */
const VARIANT_PAL: Record<string, RGB[]> = {
  cracked: [hex(0x8f8c5e), hex(0xb9b583), hex(0xc8c493), hex(0xd3cf9f), hex(0xdedaad)],
  dark: [hex(0x17141f), hex(0x2a2636), hex(0x332e42), hex(0x3c364c), hex(0x474058)],
  crystalline: [hex(0xa898b8), hex(0xd8cce4), hex(0xe4d8ee), hex(0xece2f4), hex(0xf6f0fb)],
  astral: [hex(0x1a2050), hex(0x2c3a86), hex(0x34449a), hex(0x3e50ae), hex(0x4a5cc2)],
};

/** Cracks: dark lines wandering across the stone. */
function cracks(t: Tex, c: RGB, n: number): void {
  for (let i = 0; i < n; i++) {
    let x = t.rng.int(16);
    let y = t.rng.int(16);
    const len = 4 + t.rng.int(6);
    for (let k = 0; k < len; k++) {
      t.set(x, y, c);
      if (t.rng.chance(0.5)) x = (x + (t.rng.chance(0.5) ? 1 : 15)) % 16;
      else y = (y + 1) % 16;
    }
  }
}

/** Astral glow specks: stars in the stone. */
function stars(t: Tex, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = t.rng.int(16);
    const y = t.rng.int(16);
    t.set(x, y, t.rng.chance(0.3) ? hex(0xffffff) : hex(0xb8c8ff));
  }
}

/** Crystalline sparkle frame f of 16: a few glints that come and go. */
function sparkle(t: Tex, f: number): void {
  for (let i = 0; i < 6; i++) {
    const x = (i * 7 + 3) % 16;
    const y = (i * 11 + 5) % 16;
    const phase = (f + i * 5) % 16;
    if (phase < 3) t.set(x, y, phase === 1 ? hex(0xffffff) : hex(0xf4e8ff));
    if (phase === 1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) t.set((x + dx + 16) % 16, (y + dy + 16) % 16, hex(0xf0e0ff));
  }
}

function variantStone(t: Tex, v: string, form: 'natural' | 'polished' | 'bricks', f = 0): void {
  const pal = VARIANT_PAL[v]!;
  if (form === 'natural') {
    blotchy(t, pal.slice(1, 5), 1, 0.9);
    if (v === 'cracked') cracks(t, pal[0]!, 4);
    if (v === 'dark') {
      t.speckle(hex(0x5a3a8a), 0.05);
      t.speckle(pal[0]!, 0.08);
    }
  } else if (form === 'polished') {
    blotchy(t, pal.slice(2, 5), 1, 0.4);
    frame(t, pal[1]!);
    bevel(t, pal[4]!, pal[1]!, 1);
  } else bricks(t, pal.slice(1), pal[0]!, 8, 4, 4);
  if (v === 'cracked' && form !== 'natural') cracks(t, pal[0]!, 1);
  if (v === 'astral') stars(t, form === 'natural' ? 7 : 4);
  if (v === 'crystalline') sparkle(t, f);
}

export function registerV6Phase2Blocks(r: PainterRegistry): void {
  for (const v of Object.keys(VARIANT_PAL)) {
    const forms: [string, 'natural' | 'polished' | 'bricks'][] = [
      [`${v}_end_stone`, 'natural'],
      [`polished_${v}_end_stone`, 'polished'],
      [`${v}_end_stone_bricks`, 'bricks'],
    ];
    for (const [name, form] of forms) {
      // The crystalline stone sparkles faintly (an animation)
      if (v === 'crystalline') r.anim(name, 16, 3, (t, f) => variantStone(t, v, form, f));
      else r.add(name, (t) => variantStone(t, v, form));
    }
  }
  // End Crystal Fields
  r.add('end_crystal_cluster', (t) => {
    t.clear();
    const c = [hex(0xc8a0f0), hex(0xe8d0ff), hex(0xffffff)];
    for (const [x0, h, w] of [[2, 6, 2], [5, 11, 2], [8, 14, 3], [12, 8, 2]] as const) {
      for (let y = 16 - h; y < 16; y++) for (let x = x0; x < x0 + w; x++) t.set(x, y, x === x0 ? c[1]! : c[0]!);
      t.set(x0, 16 - h, c[2]!);
      t.set(x0 + w - 1, 16 - h + 1, c[1]!);
    }
  });
  r.add('crystal_lamp', (t) => {
    blotchy(t, [hex(0xe8d8ff), hex(0xf2e8ff), hex(0xfaf4ff)], 1, 0.6);
    frame(t, hex(0x9a7ac8));
    for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11], [7, 7], [8, 8]] as const) t.set(x, y, hex(0xffffff));
    t.rect(6, 6, 4, 4, hex(0xffffff));
  });
  r.add('crystal_glass', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex(0xe8d0ff), 70);
    frame(t, hex(0xc8a0f0));
    for (let i = 2; i < 7; i++) t.set(i, 9 - i, hex(0xffffff), 200);
  });
  // Void Wastes
  r.add('void_crystal_ore', (t) => {
    variantStone(t, 'dark', 'natural');
    oreSpots(t, hex(0xb07aff), hex(0x5a2aa0), 5, hex(0x8a4ae0));
  });
  r.add('void_glass', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x2a1a44), 120);
    frame(t, hex(0x6a3ad0));
    t.speckle(hex(0x9a6af0), 0.03);
  });
  // Chorus Forest: cloth and rope from chorus fiber (the wood is in blocksWood.ts)
  r.add('chorus_cloth', (t) => {
    wool(t, hex(0xb48ac8));
    for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) if ((x + y) % 3 === 0) t.set(x, y, hex(0x9a6aae));
  });
  r.add('chorus_rope', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++) {
      t.set(7, y, (y % 4) < 2 ? hex(0xc89ae0) : hex(0x9a6aae));
      t.set(8, y, (y % 4) < 2 ? hex(0x9a6aae) : hex(0xc89ae0));
    }
  });
  // End Highlands: Ender Ore, deep in the voidstone
  r.add('ender_ore_side', (t) => {
    voronoi(t, 10, (x, y, c) => t.set(x, y, c.d2 - c.d1 < 0.9 ? hex(0x17111f) : [hex(0x1f1729), hex(0x271d34), hex(0x30243f)][c.cell % 3]!));
    oreSpots(t, hex(0x4ad8b8), hex(0x14584a), 4, hex(0x2a9a84));
    for (let i = 0; i < 4; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xb07aff));
  });
  r.add('ender_ore_top', (t) => {
    voronoi(t, 8, (x, y, c) => t.set(x, y, c.d2 - c.d1 < 0.9 ? hex(0x17111f) : [hex(0x1f1729), hex(0x271d34)][c.cell % 2]!));
    for (let i = 0; i < 3; i++) {
      const x = 3 + t.rng.int(10);
      const y = 3 + t.rng.int(10);
      t.rect(x, y, 2, 2, hex(0x2a9a84));
      t.set(x, y, hex(0x6af0d0));
    }
  });
  // Shattered End: worked stone, older than the cities
  r.add('ancient_end_fragment', (t) => {
    voronoi(t, 10, (x, y, c) => t.set(x, y, c.d2 - c.d1 < 0.9 ? hex(0x17111f) : [hex(0x1f1729), hex(0x271d34), hex(0x30243f)][c.cell % 3]!));
    // A carved slab set into the stone: grooves of a pattern nobody knows
    t.rect(3, 4, 10, 8, hex(0x8a7a5a));
    t.rect(4, 5, 8, 6, hex(0x9a8a68));
    for (const [x, y] of [[5, 6], [7, 6], [9, 6], [6, 8], [8, 8], [10, 8], [5, 9], [9, 9]] as const) t.set(x, y, hex(0x5a4a34));
  });
  r.add('ancient_end_bricks', (t) => {
    bricks(t, [hex(0x7a6a4c), hex(0x8a7a5a), hex(0x9a8a68), hex(0xa89876)], hex(0x4a3e2a), 8, 4, 4);
    for (let i = 0; i < 5; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x5a4a34));
  });
  // Astral End
  r.add('astral_ore', (t) => {
    variantStone(t, 'astral', 'natural');
    oreSpots(t, hex(0xffffff), hex(0x7a8ae8), 5, hex(0xc8d4ff));
  });
  r.add('astral_lantern', (t) => {
    t.clear();
    t.rect(5, 5, 6, 8, hex(0x2a3060));
    t.rect(6, 7, 4, 5, hex(0xd8e4ff));
    t.set(7, 8, hex(0xffffff));
    t.set(8, 10, hex(0xffffff));
    t.rect(6, 4, 4, 1, hex(0x1a2050));
    t.rect(7, 2, 2, 2, hex(0x2a3060));
  });
  r.add('astral_glass', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x34449a), 90);
    frame(t, hex(0x6a7ad8));
    for (let i = 0; i < 6; i++) t.set(1 + t.rng.int(14), 1 + t.rng.int(14), hex(0xffffff), 220);
  });
  void tiles;
}

/** Items of the Expanded End (Ender Alloy tools and armor are painted with the other tiers in items.ts). */
export function registerV6Items(r: PainterRegistry, paint: (t: Tex, mask: string, base: RGB, outline?: number) => void): void {
  r.add('end_crystal_fragment', (t) => paint(t, 'shard', hex(0xe0c8ff)));
  r.add('chorus_fiber', (t) => paint(t, 'string', hex(0xb48ac8)));
  r.add('ender_scrap', (t) => {
    paint(t, 'raw', hex(0x2a8a7a));
    for (let i = 0; i < 3; i++) if (t.alpha(5 + i * 2, 7)) t.set(5 + i * 2, 7, hex(0xb07aff));
  });
  r.add('ender_alloy_ingot', (t) => {
    paint(t, 'ingot', hex(0x2a8a7a));
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (t.alpha(x, y) && (x + y) % 7 === 0) t.set(x, y, hex(0x9a6af0));
  });
  r.add('ancient_fragment', (t) => paint(t, 'shard', hex(0x9a8a68)));
  r.add('astral_dust', (t) => {
    paint(t, 'dust', hex(0x8a9aff));
    for (let i = 0; i < 4; i++) {
      const x = 4 + t.rng.int(8);
      const y = 6 + t.rng.int(6);
      if (t.alpha(x, y)) t.set(x, y, hex(0xffffff));
    }
  });
  r.add('astral_shard', (t) => {
    paint(t, 'gem', hex(0x6a7ae8));
    for (let i = 0; i < 3; i++) {
      const x = 5 + t.rng.int(6);
      const y = 5 + t.rng.int(6);
      if (t.alpha(x, y)) t.set(x, y, hex(0xffffff));
    }
  });
  r.add('void_stalker_hide', (t) => paint(t, 'leather', hex(0x2a1f3a)));
  r.add('void_leather', (t) => {
    paint(t, 'leather', hex(0x3a2a5a));
    for (let i = 0; i < 4; i++) {
      const x = 4 + t.rng.int(8);
      const y = 4 + t.rng.int(8);
      if (t.alpha(x, y)) t.set(x, y, hex(0x8a5ae0));
    }
  });
  r.add('end_phantom_membrane', (t) => paint(t, 'membrane', hex(0xd8dcf4)));
  r.add('void_pack', (t) => {
    paint(t, 'saddle', hex(0x3a2a5a));
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) if (t.alpha(x, y)) t.set(x, y, (x + y) % 2 ? hex(0x6a3ad0) : hex(0x9a6af0));
  });
  r.add('raw_endling', (t) => paint(t, 'meat', hex(0xd8a8c8)));
  r.add('cooked_endling', (t) => paint(t, 'meat', hex(0xa86a58)));
}

// ---------------------------------------------------------------------------
// Phase 3: the ancient civilization's stone, machines, seals, the Dragon's
// Nest and the End Palace's own blocks; artifacts, weapons and the map
// ---------------------------------------------------------------------------
const ANCIENT: RGB[] = [hex(0x7a6a4c), hex(0x8a7a5a), hex(0x9a8a68), hex(0xa89876)];
const ANCIENT_MORTAR = hex(0x4a3e2a);
const GLYPH_STONE: RGB[] = [hex(0x2c2638), hex(0x342c42), hex(0x3c344c), hex(0x443a56)];

/** One glyph of the made-up script on a stone face. */
function glyph(t: Tex, face: number, ink: RGB, glow: RGB): void {
  const g = GLYPHS[face % GLYPHS.length]!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const ch = g[y]![x];
      if (ch === '#') {
        t.set(4 + x, 4 + y, ink);
        // a little depth: the cut's lower edge is darker
        if (g[y + 1]?.[x] !== '#' && y < 7) t.set(4 + x, 5 + y, shade(ink, 0.55));
      } else if (ch === 'o') t.set(4 + x, 4 + y, glow);
    }
}

export function registerV6Phase3Blocks(r: PainterRegistry): void {
  r.add('ender_glyph_stone_top', (t) => {
    blotchy(t, GLYPH_STONE, 1, 0.6);
    frame(t, hex(0x1e1828));
    frame(t, hex(0x4a3e5e), 2);
  });
  // The unsuffixed name is the item icon and particles (the block's sides take a face each)
  for (const name of ['ender_glyph_stone', 'ender_glyph_stone_0', 'ender_glyph_stone_1', 'ender_glyph_stone_2', 'ender_glyph_stone_3', 'ender_glyph_stone_4', 'ender_glyph_stone_5']) {
    const face = Number(name.slice(-1)) || 0;
    r.add(name, (t) => {
      blotchy(t, GLYPH_STONE, 1, 0.5);
      frame(t, hex(0x1e1828));
      glyph(t, face, hex(0x8a6ac8), hex(0xc8a8ff));
    });
  }
  r.add('cracked_ancient_end_bricks', (t) => {
    bricks(t, ANCIENT, ANCIENT_MORTAR, 8, 4, 4);
    cracks(t, hex(0x3a3020), 4);
  });
  r.add('chiseled_ancient_end_bricks', (t) => {
    blotchy(t, ANCIENT.slice(1), 1, 0.5);
    frame(t, ANCIENT_MORTAR);
    frame(t, hex(0x6a5a3e), 2);
    for (const [x, y] of [[7, 5], [8, 5], [5, 7], [10, 7], [5, 8], [10, 8], [7, 10], [8, 10], [7, 7], [8, 8]] as const) t.set(x, y, hex(0x5a4a34));
  });
  r.add('ancient_ward_stone', (t) => {
    blotchy(t, [hex(0x5a4c3a), hex(0x625442), hex(0x6a5c48)], 1, 0.6);
    frame(t, hex(0x3a3024));
    // A faint seal ring
    for (let a = 0; a < 24; a++) t.set(Math.round(7.5 + Math.cos((a / 24) * Math.PI * 2) * 4.5), Math.round(7.5 + Math.sin((a / 24) * Math.PI * 2) * 4.5), hex(0x8a7ab0));
  });
  r.add('ancient_vault_door', (t) => {
    blotchy(t, [hex(0x5a4c3a), hex(0x625442), hex(0x6a5c48)], 1, 0.5);
    frame(t, hex(0x2a2218));
    frame(t, hex(0x8a7a5a), 1);
    t.rect(7, 1, 2, 14, hex(0x2a2218));
    for (let a = 0; a < 28; a++) t.set(Math.round(7.5 + Math.cos((a / 28) * Math.PI * 2) * 5), Math.round(7.5 + Math.sin((a / 28) * Math.PI * 2) * 5), hex(0xb89ae0));
    t.rect(7, 7, 2, 3, hex(0x120e18));
  });
  r.add('crystal_vault_door', (t) => {
    variantStone(t, 'crystalline', 'bricks');
    t.rect(3, 2, 10, 13, hex(0xd8c8f0));
    frame(t, hex(0xa898b8), 2);
    t.rect(7, 2, 2, 13, hex(0xa898b8));
    for (const [x, y] of [[7, 6], [8, 6], [6, 7], [9, 7], [6, 8], [9, 8], [7, 9], [8, 9]] as const) t.set(x, y, hex(0xffffff));
  });
  r.add('dead_portal', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, mix(hex(0x241c30), hex(0x3a3048), t.rng.next() * 0.6), 150);
    for (let i = 0; i < 5; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x5a4a70), 170);
  });
  r.add('ancient_conduit', (t) => {
    t.fill(hex(0x4a4250));
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, hex(0x2a2430));
      t.set(x, 15, hex(0x2a2430));
    }
    for (let y = 0; y < 16; y++) {
      t.set(3, y, hex(0x5a5262));
      t.set(12, y, hex(0x34303c));
    }
    for (const y of [3, 4, 11, 12]) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x8a7a5a));
    for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) t.set(x, y, hex(0x2a2238));
  });
  r.add('ancient_conduit_top', (t) => {
    t.fill(hex(0x4a4250));
    frame(t, hex(0x8a7a5a), 1);
    t.rect(5, 5, 6, 6, hex(0x1a1424));
    t.rect(6, 6, 4, 4, hex(0x2a2238));
  });
  const core = (t: Tex, lit: boolean): void => {
    t.fill(hex(0x3a3444));
    frame(t, hex(0x8a7a5a));
    for (const i of [4, 8, 11]) for (let k = 1; k < 15; k++) {
      t.set(i, k, hex(0x6a5e4a));
      t.set(k, i, hex(0x6a5e4a));
    }
    t.rect(5, 5, 6, 6, lit ? hex(0xb88aff) : hex(0x2a2040));
    t.rect(6, 6, 4, 4, lit ? hex(0xf0e0ff) : hex(0x3a2c58));
    if (!lit) t.set(7, 7, hex(0x5a4a80));
  };
  r.add('ancient_core', (t) => core(t, false));
  r.add('ancient_core_on', (t) => core(t, true));
  const lens = (t: Tex, lit: boolean): void => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        t.set(x, y, d > 6.5 ? hex(0x8a7a5a) : lit ? mix(hex(0xd8f0ff), hex(0x7ab0ff), d / 7) : mix(hex(0x8aa0c0), hex(0x4a5a7a), d / 7), d > 6.5 ? 255 : 150);
      }
    t.set(5, 5, hex(0xffffff), 220);
    t.set(6, 5, hex(0xffffff), 180);
  };
  r.add('ancient_lens', (t) => lens(t, false));
  r.add('ancient_lens_on', (t) => lens(t, true));
  r.add('old_crystal_growth', (t) => {
    t.clear();
    for (const [x, h, c] of [[4, 7, 0xa890c0], [7, 11, 0xc0a8d8], [10, 8, 0x9a84b0], [12, 5, 0xb8a0d0]] as const) {
      for (let y = 15; y > 15 - h; y--) {
        t.set(x, y, hex(c));
        if (y > 15 - h + 2) t.set(x + 1, y, shade(hex(c), 0.8));
      }
      t.set(x, 15 - h + 1, hex(0xf0e8ff));
    }
  });
  r.add('shell_fragments', (t) => {
    t.clear();
    for (const [x, y, w, h] of [[2, 3, 4, 3], [9, 2, 5, 3], [5, 9, 3, 4], [11, 9, 3, 3], [2, 12, 3, 2]] as const) {
      t.rect(x, y, w, h, hex(0xd8d0b8));
      t.set(x, y, hex(0xf0ead8));
      t.set(x + w - 1, y + h - 1, hex(0xa89e84));
    }
  });
  r.add('crystal_pillar', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, [hex(0xe4d8ee), hex(0xf0e8f8), hex(0xd8cce4)][Math.floor(x / 3) % 3]!);
    for (let y = 0; y < 16; y++) {
      t.set(0, y, hex(0xa898b8));
      t.set(15, y, hex(0xa898b8));
    }
    for (let y = 0; y < 16; y += 5) t.set(7, y, hex(0xffffff));
  });
  r.add('crystal_pillar_top', (t) => {
    t.fill(hex(0xe4d8ee));
    frame(t, hex(0xa898b8));
    frame(t, hex(0xf6f0fb), 3);
    t.rect(7, 7, 2, 2, hex(0xffffff));
  });
  r.add('astral_mosaic', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? hex(0x2c3a86) : hex(0x3e50ae));
    for (let i = 0; i < 16; i++) {
      t.set(i, i, hex(0xd8b850));
      t.set(15 - i, i, hex(0xd8b850));
    }
    stars(t, 5);
  });
}

type Pal = Record<string, RGB>;

/** Phase 3 items: the six End Artifacts, the three ancient weapons and the Ancient Map. */
export function registerV6Phase3Items(r: PainterRegistry, pm: (t: Tex, mask: string, pal: Pal) => void, mp: (base: RGB, outline?: number) => Pal): void {
  r.add('glyph_tablet', (t) => {
    pm(t, 'sheet', mp(hex(0x5a4c6a)));
    for (const [x, y] of [[5, 5], [6, 5], [8, 6], [9, 6], [9, 7], [5, 8], [7, 9], [8, 9], [6, 11], [9, 11]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xc8a8ff));
  });
  r.add('cracked_ender_eye', (t) => {
    pm(t, 'eye', { ...mp(hex(0x2a5a4a)), e: hex(0x0a1a1a), k: hex(0x4a9a7a) });
    for (const [x, y] of [[6, 4], [7, 5], [7, 6], [8, 7], [8, 8], [9, 9]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0x0a0a0a));
  });
  r.add('old_crystal_lens', (t) => {
    pm(t, 'disc', mp(hex(0x8a7a5a)));
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3.2 && t.alpha(x, y)) t.set(x, y, mix(hex(0xd8ccf0), hex(0x8a7ab0), Math.hypot(x - 7.5, y - 7.5) / 3.5));
  });
  r.add('ancient_coin', (t) => {
    pm(t, 'nugget', mp(hex(0xb8984a)));
    for (const [x, y] of [[7, 7], [8, 8]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0x6a5424));
  });
  r.add('ancient_key_shard', (t) => {
    pm(t, 'fang', mp(hex(0x9a8a68)));
    for (let y = 4; y < 12; y += 2) if (t.alpha(7, y)) t.set(7, y, hex(0xc8a8ff));
  });
  r.add('dragon_scale_fragment', (t) => {
    pm(t, 'scale', mp(hex(0x4a2a5a)));
    for (const [x, y] of [[6, 6], [9, 8], [7, 10]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xb07ad0));
  });
  r.add('ancient_blade', (t) => {
    pm(t, 'sword', { ...mp(hex(0x9a8a68)), h: hex(0x4a3e5e), H: hex(0x2c2638), k: hex(0x1a1424) });
    for (let i = 4; i < 12; i++) if (t.alpha(i + 1, 14 - i)) t.set(i + 1, 14 - i, hex(0x7ae0ff));
  });
  r.add('voidpiercer', (t) => {
    pm(t, 'bow', { s: hex(0xc8a8ff) });
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (t.alpha(x, y) && t.get(x, y)[0] < 200) t.set(x, y, hex(0x3a2a5a));
    for (let i = 4; i < 13; i++) t.set(i, 16 - i, hex(0x9a8a68));
    t.set(12, 4, hex(0x7ae0ff));
  });
  r.add('shardstaff', (t) => {
    pm(t, 'stick', { h: hex(0x4a3e5e), H: hex(0x2c2638), k: hex(0x1a1424) });
    for (const [x, y, c] of [[11, 2, 0xf0e0ff], [12, 3, 0xc8a8ff], [11, 3, 0xd8c8f0], [12, 2, 0xffffff], [13, 3, 0xa890c0], [12, 4, 0xa890c0]] as const) t.set(x, y, hex(c));
  });
  r.add('ancient_map', (t) => pm(t, 'compass', { ...mp(hex(0x8a7a5a)), r: hex(0x7ae0ff), w: hex(0xd8c8a0) }));
}
