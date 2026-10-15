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

/**
 * V7 phase 2: the costume heads (painted as 8 x 8 pixel art, two texels a
 * pixel, so they match the 8-pixel box they cover) and the factory light in
 * Halloween orange and purple.
 */
export function registerV7Phase2Blocks(r: PainterRegistry): void {
  /** One art pixel (2 x 2 texels), a little varied so it isn't flat. */
  const px = (t: Tex, x: number, y: number, c: RGB, vary = 0.06): void => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) t.set(x * 2 + dx, y * 2 + dy, shade(c, 1 - vary / 2 + t.rng.next() * vary));
  };
  /** Paints an 8 x 8 grid: each character a colour from the key ('.' leaves the base). */
  const art = (t: Tex, rows: string[], key: Record<string, RGB>, base: RGB[], vary = 0.06): void => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const ch = rows[y]?.[x] ?? '.';
        px(t, x, y, key[ch] ?? base[(x * 3 + y * 5 + t.rng.int(base.length)) % base.length]!, vary);
      }
  };
  const PLAIN = ['........', '........', '........', '........', '........', '........', '........', '........'];

  // ---------------------------------------------------------------- Skeleton Skull
  const BONE = [hex(0xd8d4c4), hex(0xe2ded0), hex(0xccc8b6)];
  const boneKey = { D: hex(0x262422), d: hex(0x56524a), b: hex(0xb4b0a0), w: hex(0xeeeae0) };
  r.add('skeleton_skull_front', (t) => art(t, ['w.......', '.b....b.', '.DD..DD.', '.DD..DD.', '...dd...', 'b......b', '.D.DD.D.', '........'], boneKey, BONE));
  r.add('skeleton_skull_side', (t) => art(t, ['w.......', '........', '......b.', '.....b..', '........', '..b.....', '........', '.b......'], boneKey, BONE));
  r.add('skeleton_skull_top', (t) => art(t, ['..w.....', '........', '...b....', '...b....', '....b...', '........', '.....w..', '........'], boneKey, BONE));
  r.add('skeleton_skull_back', (t) => art(t, PLAIN.map((row, y) => (y === 3 ? '..b.....' : row)), boneKey, BONE));
  r.add('skeleton_skull_bottom', (t) => art(t, PLAIN, boneKey, BONE.map((c) => shade(c, 0.85))));

  // ---------------------------------------------------------------- Zombie Head
  const SKIN = [hex(0x4a8a3a), hex(0x528f40), hex(0x447e34)];
  const zKey = { H: hex(0x2e5a26), h: hex(0x3a6a30), E: hex(0x16241a), s: hex(0x3c7230), M: hex(0x2a4a22) };
  r.add('zombie_head_front', (t) => art(t, ['HHhHHHhH', 'H......H', '........', '.EE..EE.', '...ss...', '..MMMM..', '........', '........'], zKey, SKIN));
  r.add('zombie_head_side', (t) => art(t, ['HHhHHHHH', 'HHH.....', 'H.......', '........', '......s.', '........', '........', '........'], zKey, SKIN));
  r.add('zombie_head_top', (t) => art(t, ['HHhHHHHH', 'HHHHhHHH', 'HhHHHHHH', 'HHHHHHhH', 'HHHhHHHH', 'HHHHHHHH', 'hHHHHhHH', 'HHHHHHHH'], zKey, SKIN));
  r.add('zombie_head_back', (t) => art(t, ['HHHHhHHH', 'HHhHHHHH', 'HHHHHHHH', 'H.HHHH.H', '........', '........', '........', '........'], zKey, SKIN));
  r.add('zombie_head_bottom', (t) => art(t, PLAIN, zKey, SKIN.map((c) => shade(c, 0.8))));

  // ---------------------------------------------------------------- Creeper Head
  const CREEP = [hex(0x5cb048), hex(0x4a9a3a), hex(0x72c85a), hex(0x3e8a32), hex(0x86d470)];
  const cKey = { K: hex(0x0e120e), k: hex(0x1e2a1c) };
  r.add('creeper_head_front', (t) => art(t, ['........', '........', '.KK..KK.', '.KK..KK.', '...KK...', '..KKKK..', '..KkkK..', '..K..K..'], cKey, CREEP, 0.1));
  for (const f of ['side', 'top', 'back']) r.add(`creeper_head_${f}`, (t) => art(t, PLAIN, cKey, CREEP, 0.1));
  r.add('creeper_head_bottom', (t) => art(t, PLAIN, cKey, CREEP.map((c) => shade(c, 0.8)), 0.1));

  // ---------------------------------------------------------------- Herobrine Head
  const FACE = [hex(0xb07a5a), hex(0xa87252), hex(0xb88262)];
  const hKey = { H: hex(0x3a2414), h: hex(0x4a3020), W: hex(0xffffff), n: hex(0x8a5a3e), m: hex(0x5a3a24), b: hex(0x6a4630) };
  r.add('herobrine_head_front', (t) => {
    art(t, ['HHHHHHHH', 'HhHHHHhH', 'H......H', '.WW..WW.', '...nn...', '..m..m..', '..mmmm..', '........'], hKey, FACE);
    // The eyes glow: no pupils, and a faint halo round them
    for (const [x, y] of [[2, 6], [3, 6], [10, 6], [11, 6], [2, 7], [11, 7]] as const) t.set(x, y, mix(t.get(x, y) as unknown as RGB, hex(0xffffff), 0.35));
  });
  r.add('herobrine_head_side', (t) => art(t, ['HHHHHHHH', 'HHHHHHHH', 'HHHHHH..', 'HHHH....', 'HHH..b..', 'HH......', 'H.......', '........'], hKey, FACE));
  r.add('herobrine_head_top', (t) => art(t, ['HHHHHHHH', 'HhHHHHHH', 'HHHHhHHH', 'HHHHHHHH', 'HHHHHHhH', 'HHhHHHHH', 'HHHHHHHH', 'HHHHHHHH'], hKey, FACE));
  r.add('herobrine_head_back', (t) => art(t, ['HHHHHHHH', 'HHHhHHHH', 'HHHHHHHH', 'HHHHHHhH', 'HhHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'H.HHHH.H'], hKey, FACE));
  r.add('herobrine_head_bottom', (t) => art(t, PLAIN, hKey, FACE.map((c) => shade(c, 0.8))));

  // ---------------------------------------------------------------- Halloween factory lights
  const light = (t: Tex, core: RGB, edge: RGB): void => {
    // The factory light's steel housing, its lens glowing in colour
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(hex(0x6a6e74), 0.92 + t.rng.next() * 0.12));
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, hex(0x8a8e94));
      t.set(0, i, hex(0x8a8e94));
      t.set(i, 15, hex(0x3a3e44));
      t.set(15, i, hex(0x3a3e44));
    }
    for (let y = 2; y < 14; y++)
      for (let x = 2; x < 14; x++) {
        const d = Math.min(1, Math.hypot(x - 7.5, y - 7.5) / 7.5);
        t.set(x, y, mix(core, edge, d * d));
      }
    for (let i = 2; i < 14; i++) {
      t.set(i, 7, mix(edge, core, 0.4));
      t.set(7, i, mix(edge, core, 0.4));
    }
  };
  r.add('factory_light_orange', (t) => light(t, hex(0xffe0a0), hex(0xff8a1e)));
  r.add('factory_light_purple', (t) => light(t, hex(0xf0c8ff), hex(0xa040f0)));
}

// ---------------------------------------------------------------------------
// Phase 3: the Trick-or-Treat Sack and the four candies (16 x 16 item icons)
// ---------------------------------------------------------------------------

/** Paints every texel a function returns a colour for (null: left clear). */
function shape(t: Tex, fn: (x: number, y: number) => RGB | null): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const c = fn(x, y);
      if (c) t.set(x, y, c);
    }
}

/** A dark rim round everything painted, so the icon reads on any background. */
function outline(t: Tex, c: RGB): void {
  const solid = (x: number, y: number): boolean => t.alpha(x, y) > 0;
  const edge: [number, number][] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) t.set(x, y, c);
}

/** A wrapped sweet on its side: an oval in the middle, the paper twisted at both ends. `warp` bends it out of true. */
function wrappedSweet(t: Tex, body: RGB[], stripe: RGB, paper: RGB[], warp = 0): void {
  const bend = (x: number): number => (warp ? Math.round(Math.sin((x - 2) * 0.55) * warp + (x > 9 ? (x - 9) * 0.35 * warp : 0)) : 0);
  shape(t, (x, y0) => {
    const y = y0 - bend(x);
    const dx = (x - 7.5) / 3.6;
    const dy = (y - 8) / (2.7 + (warp ? Math.sin(x * 1.3) * 0.4 : 0));
    if (dx * dx + dy * dy <= 1) {
      // Stripes run on the slant; light from the top left
      const lit = dy < -0.35 ? 2 : dy > 0.45 ? 0 : 1;
      return (x + y) % 4 === 0 ? stripe : body[lit]!;
    }
    // The twisted ends: fans opening outwards
    const end = x <= 3 ? 3.6 - x : x >= 12 ? x - 11.6 : -1;
    if (end > 0 && Math.abs(y - 8) <= end * 0.9 + 0.4 && end < 3.4) return paper[(Math.abs(y - 8) + x) % 2 === 0 ? 1 : 0]!;
    return null;
  });
}

export function registerV7Phase3Items(r: PainterRegistry): void {
  // Candy: orange paper, white stripes, the ends a paler twist
  r.add('candy', (t) => {
    wrappedSweet(t, [hex(0xc8560a), hex(0xe8741a), hex(0xff9a3a)], hex(0xfff2dc), [hex(0xf0a040), hex(0xffc870)]);
    outline(t, hex(0x4a1c04));
  });
  // Big Candy: a swirl lollipop, orange and purple, on a stick
  r.add('big_candy', (t) => {
    const cx = 9.5;
    const cy = 6.2;
    shape(t, (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= 5.2) {
        const a = Math.atan2(dy, dx);
        const swirl = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 4 + d * 0.55) % 2;
        const c = swirl ? hex(0x8a3ad8) : hex(0xff8a1a);
        return dx + dy < -3.5 ? mix(c, hex(0xffffff), 0.35) : c;
      }
      // The stick, down to the bottom left
      const k = (x - 2) / (6 - 2);
      if (x >= 2 && x <= 6 && Math.abs(y - (14 - k * 4.2)) <= 0.6) return x % 2 ? hex(0xf2ece0) : hex(0xd8d0c0);
      return null;
    });
    outline(t, hex(0x2a1236));
  });
  // King-Sized Candy: a chocolate bar, half in gold foil
  r.add('king_sized_candy', (t) => {
    shape(t, (x, y) => {
      if (x < 1 || x > 14 || y < 4 || y > 11) return null;
      if (x >= 7) {
        // Gold foil, crinkled, a purple band with a crown
        if (y >= 6 && y <= 9 && x >= 8 && x <= 13) {
          const crown = (y === 7 && (x === 9 || x === 11 || x === 13)) || (y === 8 && x >= 9 && x <= 13);
          return crown ? hex(0xffe066) : hex(0x5a1a8a);
        }
        const shine = (x * 3 + y * 5) % 7 === 0;
        return shine ? hex(0xfff4b0) : y < 6 ? hex(0xf0c040) : hex(0xd8a020);
      }
      // Chocolate in squares, the bitten corner gone
      if (x <= 2 && y <= 5) return null;
      const seam = x === 4 || y === 7 || y === 10;
      return seam ? hex(0x3a1e0e) : y === 5 || x === 1 ? hex(0x8a5230) : hex(0x6a3a1e);
    });
    outline(t, hex(0x26140a));
  });
  // Poisoned Candy: the same sweet gone wrong, warped, a sickly yellow-brown, oozing
  r.add('poisoned_candy', (t) => {
    wrappedSweet(t, [hex(0x86681c), hex(0xa8862a), hex(0xc8a844)], hex(0x6e7a22), [hex(0x9a7e34), hex(0xbaa04e)], 0.7);
    // Mould spots and a drip hanging off the bottom
    for (const [x, y] of [[6, 7], [9, 9], [8, 6]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0x4a5a12));
    let low = 0;
    for (let y = 15; y >= 0; y--)
      if (t.alpha(8, y)) {
        low = y;
        break;
      }
    t.set(8, low + 1, hex(0x8a8a20));
    t.set(8, low + 2, hex(0x6a7016));
    outline(t, hex(0x2a2006));
  });
  // The Trick-or-Treat Sack: burlap, tied with string, a jack-o'-lantern face printed on it
  r.add('trick_or_treat_sack', (t) => {
    shape(t, (x, y) => {
      // The cloth bunched above the string, the string, the neck below it
      if (y === 1) return Math.abs(x - 7.5) <= 2.5 && x !== 7 ? (x % 2 ? hex(0xa86a26) : hex(0xc8862e)) : null;
      if (y === 2) return Math.abs(x - 7.5) <= 2 ? (x % 2 ? hex(0xb87424) : hex(0xd0903a)) : null;
      if (y === 3) return Math.abs(x - 7.5) <= 1.5 ? hex(0xf0e0b8) : null;
      if (y === 4) return Math.abs(x - 7.5) <= 2 ? (x % 2 ? hex(0x9a5e20) : hex(0xb07028)) : null;
      if (y < 5 || y > 15) return null;
      // The body: wider towards the bottom, rounded off
      const half = 4.2 + (y - 5) * 0.45 - (y >= 14 ? (y - 13) * 1.4 : 0);
      if (Math.abs(x - 7.5) > half) return null;
      const weave = (x + y) % 2 === 0 ? hex(0xc8862e) : hex(0xb87424);
      const lit = x < 6 && y < 10 ? mix(weave, hex(0xffd080), 0.2) : weave;
      return lit;
    });
    // The printed face
    const face: [number, number][] = [
      [5, 8], [6, 8], [9, 8], [10, 8], [6, 9], [9, 9],
      [7, 10], [8, 10],
      [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12], [6, 13], [8, 13], [10, 13],
    ];
    for (const [x, y] of face) t.set(x, y, hex(0x2a1406));
    outline(t, hex(0x3a2008));
  });
}
