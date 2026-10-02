/**
 * V6 - The End Expansion: textures for the Expansion Portal and the
 * Expanded End's landscape blocks.
 *
 * The portal is set apart from the End's other ways through: the exit
 * portal and the gateways are a dark starfield, nether portals swirl in
 * violet. The Expansion Portal's sheet is ribbons of pale blue light rising
 * through deep indigo, framed in dark slate whose inlaid channels are cold
 * and empty while it sleeps and glow once it is alive.
 */
import { Tex, type RGB, hex, mix, shade } from './canvas';
import { bevel, blotchy, voronoi } from './patterns';
import type { PainterRegistry } from './registry';

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
