/**
 * V7 - The Halloween Update, phase 1: textures for the five dimension
 * pumpkins. Each has a top (with its stem), a ribbed side and a carved face:
 *
 *  - Hallow Pumpkin: warm orange, a triangle-eyed candle grin;
 *  - Ember Pumpkin: charred rind cracked with lava light, a fiery face that flickers;
 *  - Ender Pumpkin: pale end-stone violet, a cluster of glowing alien eyes;
 *  - Glitched Pumpkin: missing-texture patches and a face that tears sideways;
 *  - Data Pumpkin: a circuit-board rind and a face on a little screen.
 */
import { Tex, type RGB, hex, mix, shade } from './canvas';
import { blotchy } from './patterns';
import type { PainterRegistry } from './registry';

const ORANGE: RGB[] = [hex(0xb85e08), hex(0xc86c0e), hex(0xd87c16), hex(0xe68c20)];
const RIB = hex(0x9a4a06);
const STEM = hex(0x5a6a24);
const STEM_DARK = hex(0x3e4a16);

/** Ribs down a side: darker columns, a little light either side of each. */
function ribs(t: Tex, rib: RGB, light: RGB | null, cols = [0, 5, 10, 15]): void {
  for (const x of cols)
    for (let y = 0; y < 16; y++) {
      t.set(x, y, rib);
      if (light && y % 3 !== 0) {
        if (x + 2 < 16) t.set(x + 2, y, mix(t.get(x + 2, y) as unknown as RGB, light, 0.35));
      }
    }
}

/** A top: the rind round a stem, ribs running out from it. */
function top(t: Tex, pal: RGB[], rib: RGB, stem: RGB, stemDark: RGB): void {
  blotchy(t, pal, 1, 0.6);
  for (let i = 0; i < 16; i++) {
    t.set(i, 7, rib);
    t.set(7, i, rib);
  }
  for (const [x, y] of [[2, 2], [3, 3], [12, 12], [13, 13], [12, 3], [13, 2], [3, 12], [2, 13]] as const) t.set(x, y, rib);
  t.rect(6, 6, 4, 4, stemDark);
  t.rect(7, 6, 2, 3, stem);
}

/** Darkens the rind right round the carved parts, so the cuts read as cut. */
function rim(t: Tex, mask: string[], f = 0.5): void {
  const cut = (x: number, y: number): boolean => mask[y]?.[x] === '#';
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (cut(x, y)) continue;
      if (cut(x - 1, y) || cut(x + 1, y) || cut(x, y - 1) || cut(x, y + 1)) t.set(x, y, shade(t.get(x, y) as unknown as RGB, f));
    }
}

/** Fills the carved parts of a face mask (1 = carved) with a glow running from `edge` to `core`. */
function carve(t: Tex, mask: string[], edge: RGB, core: RGB, cy = 8): void {
  rim(t, mask);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (mask[y]?.[x] !== '#') continue;
      const d = Math.min(1, Math.hypot(x - 7.5, (y - cy) * 1.3) / 8);
      t.set(x, y, mix(core, edge, d));
    }
}

// 16x16 face masks: '#' is carved out
const HALLOW_FACE = [
  '................',
  '................',
  '................',
  '...#......#.....',
  '..###....###....',
  '.#####..#####...',
  '................',
  '.......#........',
  '......###.......',
  '................',
  '.##############.',
  '..############..',
  '..##.##..##.##..',
  '...#..#..#..#...',
  '................',
  '................',
];

const EMBER_FACE = [
  '................',
  '................',
  '.##..........##.',
  '.####......####.',
  '..####....####..',
  '...##......##...',
  '................',
  '................',
  '.#..#..##..#..#.',
  '.##############.',
  '..############..',
  '..############..',
  '...##########...',
  '....#.####.#....',
  '................',
  '................',
];

const DATA_FACE = [
  '................',
  '................',
  '................',
  '................',
  '...##......##...',
  '...##......##...',
  '................',
  '................',
  '..#..........#..',
  '..############..',
  '...##########...',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export function registerV7Blocks(r: PainterRegistry): void {
  // ---------------------------------------------------------------- Hallow Pumpkin
  r.add('hallow_pumpkin_side', (t) => {
    blotchy(t, ORANGE, 1, 0.6);
    ribs(t, RIB, hex(0xf2a040));
  });
  r.add('hallow_pumpkin_top', (t) => {
    top(t, ORANGE, RIB, STEM, STEM_DARK);
    // A curl of vine off the stem
    for (const [x, y] of [[10, 5], [11, 4], [12, 4], [12, 5]] as const) t.set(x, y, STEM);
  });
  r.add('hallow_pumpkin_face', (t) => {
    blotchy(t, ORANGE, 1, 0.6);
    ribs(t, RIB, null, [0, 15]);
    carve(t, HALLOW_FACE, hex(0xffb828), hex(0xfffbe0), 9);
  });

  // ---------------------------------------------------------------- Ember Pumpkin (the Nether)
  const CHAR: RGB[] = [hex(0x1e0a08), hex(0x2a0f0a), hex(0x36140c), hex(0x421a0e)];
  const LAVA = hex(0xff6a10);
  const LAVA_HOT = hex(0xffc040);
  const cracks = (t: Tex, glow: number): void => {
    // Cracks down the ribs, branching off now and then
    for (const x0 of [2, 7, 12]) {
      let x = x0;
      for (let y = 0; y < 16; y++) {
        t.set(x, y, mix(LAVA, LAVA_HOT, glow * ((y * 7 + x0) % 5 === 0 ? 1 : 0.4)));
        if ((y * 3 + x0) % 7 === 0) x += x < x0 + 1 ? 1 : -1;
        if ((y + x0) % 9 === 0) t.set(x + 1, y, shade(LAVA, 0.8));
      }
    }
  };
  r.add('ember_pumpkin_side', (t) => {
    blotchy(t, CHAR, 1, 0.7);
    cracks(t, 0.6);
  });
  r.add('ember_pumpkin_top', (t) => {
    top(t, CHAR, hex(0x5a1a0a), hex(0x2a1810), hex(0x140a06));
    t.set(7, 6, LAVA_HOT);
    t.set(8, 6, LAVA);
    for (const [x, y] of [[3, 2], [4, 3], [12, 11], [11, 12], [3, 12], [12, 3]] as const) t.set(x, y, LAVA);
  });
  r.anim('ember_pumpkin_face', 4, 3, (t, f) => {
    blotchy(t, CHAR, 1, 0.7);
    cracks(t, 0.3 + 0.2 * (f % 2));
    rim(t, EMBER_FACE, 0.4);
    // The fire inside: red at the bottom, yellow at the heart, moving frame to frame
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (EMBER_FACE[y]?.[x] !== '#') continue;
        const flick = Math.sin(x * 1.7 + f * 1.9) * 0.5 + Math.sin(y * 2.3 - f * 2.4) * 0.5;
        const heat = Math.max(0, Math.min(1, 1 - Math.abs(y - 9) / 7 + flick * 0.25));
        t.set(x, y, heat > 0.75 ? mix(LAVA_HOT, hex(0xfff6c0), (heat - 0.75) * 4) : mix(hex(0xc01808), LAVA, heat / 0.75));
      }
  });

  // ---------------------------------------------------------------- Ender Pumpkin (the End)
  const PALE: RGB[] = [hex(0xa898cc), hex(0xb8aad8), hex(0xc8bce4), hex(0xd8d0f0)];
  const PURPLE = hex(0x6a4a9a);
  r.add('ender_pumpkin_side', (t) => {
    blotchy(t, PALE, 1, 0.6);
    ribs(t, PURPLE, hex(0xf0e8ff));
    // End stone specks
    for (let i = 0; i < 10; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xe8e4a8));
  });
  r.add('ender_pumpkin_top', (t) => {
    top(t, PALE, PURPLE, hex(0x9a62a8), hex(0x5a2a6a));
    // A chorus bud for a stem
    t.rect(7, 5, 2, 1, hex(0xd8a8e8));
    t.set(7, 4, hex(0xf0d0ff));
  });
  r.add('ender_pumpkin_face', (t) => {
    blotchy(t, PALE, 1, 0.6);
    ribs(t, PURPLE, null, [0, 15]);
    // Too many eyes, glowing violet, none quite in line
    const eyes: [number, number, number][] = [[3, 3, 2], [10, 2, 2], [6, 5, 1], [12, 6, 2], [2, 8, 1], [8, 8, 2], [5, 11, 1], [11, 11, 1]];
    for (const [x, y, s] of eyes) {
      t.rect(x, y, s, s, hex(0xe070ff));
      t.set(x, y, hex(0xffd8ff));
      if (s === 2) t.set(x + 1, y + 1, hex(0xa030d0));
    }
    // A thin, wide mouth
    for (let x = 4; x <= 11; x++) t.set(x, 13 + (x % 3 === 0 ? 1 : 0), hex(0xc050f0));
  });

  // ---------------------------------------------------------------- Glitched Pumpkin (the Farlands)
  const MAGENTA = hex(0xf000f0);
  const BLACK = hex(0x101010);
  const TEAL = hex(0x2ad7c2);
  const missing = (t: Tex, x0: number, y0: number, w: number, h: number): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) t.set(x, y, ((x >> 1) + (y >> 1)) % 2 ? MAGENTA : BLACK);
  };
  const tear = (t: Tex, rows: number[], by: number): void => {
    for (const y of rows) {
      const row: RGB[] = [];
      for (let x = 0; x < 16; x++) row.push(t.get(x, y) as unknown as RGB);
      for (let x = 0; x < 16; x++) t.set(x, y, row[(x - by + 16) % 16]!);
    }
  };
  r.add('glitched_pumpkin_side', (t) => {
    blotchy(t, ORANGE, 1, 0.6);
    ribs(t, RIB, hex(0xf2a040));
    missing(t, 6, 2, 4, 4);
    missing(t, 11, 10, 4, 4);
    tear(t, [7, 8], 3);
    for (let i = 0; i < 6; i++) t.set(t.rng.int(16), t.rng.int(16), TEAL);
  });
  r.add('glitched_pumpkin_top', (t) => {
    top(t, ORANGE, RIB, STEM, STEM_DARK);
    missing(t, 1, 10, 4, 4);
    missing(t, 11, 1, 4, 2);
    t.set(8, 7, TEAL);
  });
  r.anim('glitched_pumpkin_face', 4, 4, (t, f) => {
    blotchy(t, ORANGE, 1, 0.6);
    ribs(t, RIB, null, [0, 15]);
    carve(t, HALLOW_FACE, hex(0x2ad7c2), hex(0xe8fffc), 9);
    // The face tears: a band of rows slides sideways, a different one each frame
    const bands = [[4, 5], [10, 11, 12], [7, 8], [12, 13]];
    tear(t, bands[f]!, f % 2 ? 2 : -2);
    // Colour split on the eyes
    if (f === 1 || f === 3) for (let y = 3; y < 6; y++) for (let x = 1; x < 13; x++) if (HALLOW_FACE[y]?.[x] === '#') t.set(x + 1, y, MAGENTA);
    if (f === 2) missing(t, 12, 2, 3, 3);
  });

  // ---------------------------------------------------------------- Data Pumpkin (inside the computer)
  const BOARD: RGB[] = [hex(0x0c3018), hex(0x0f3a1e), hex(0x134424), hex(0x174e2a)];
  const TRACE = hex(0x3ad07a);
  const SOLDER = hex(0xc8c8a0);
  const circuit = (t: Tex): void => {
    blotchy(t, BOARD, 1, 0.5);
    // Traces along the ribs, crossing over, ending in solder pads
    for (const x of [2, 7, 12]) for (let y = 0; y < 16; y++) if ((y + x) % 6 !== 0) t.set(x, y, TRACE);
    for (const [y, x0, x1] of [[4, 2, 7], [10, 7, 12], [13, 2, 5]] as const) for (let x = x0; x <= x1; x++) t.set(x, y, TRACE);
    for (const [x, y] of [[2, 4], [7, 4], [7, 10], [12, 10], [5, 13]] as const) t.set(x, y, SOLDER);
    for (const x of [0, 15]) for (let y = 0; y < 16; y++) t.set(x, y, hex(0x082210));
  };
  r.add('data_pumpkin_side', (t) => circuit(t));
  r.add('data_pumpkin_top', (t) => {
    circuit(t);
    // A cable for a stem, and one green light
    t.rect(6, 6, 4, 4, hex(0x3a3e44));
    t.rect(7, 7, 2, 2, hex(0x5a6068));
    t.set(9, 6, hex(0x7affb0));
  });
  r.anim('data_pumpkin_face', 4, 5, (t, f) => {
    circuit(t);
    // The screen: a bezel round a dark glass with scanlines
    t.rect(1, 1, 14, 14, hex(0x1a1e22));
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, y % 2 ? hex(0x04140a) : hex(0x061c0e));
    const scan = 2 + ((f * 3) % 12);
    for (let x = 2; x < 14; x++) t.set(x, scan, hex(0x0e3a1e));
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (DATA_FACE[y]?.[x] === '#' && x > 1 && x < 14 && y > 1 && y < 14) t.set(x, y, y % 2 ? hex(0x5aff96) : hex(0x8affb6));
    // A blinking cursor
    if (f < 2) t.rect(11, 12, 2, 1, hex(0x8affb6));
  });
}
