/** Wood families: planks, logs, stripped logs, leaves, saplings, doors, trapdoors. */
import { Tex, type RGB, hex, shade, mix } from './canvas';
import { blotchy, planks, rings, streaksV, leaves, frame } from './patterns';
import type { PainterRegistry } from './registry';

export interface WoodPalette {
  plank: RGB[]; // [seam, dark, mid, light, highlight]
  bark: RGB[]; // [dark line, dark, mid, light]
  leaf: RGB[] | null; // null => grayscale tinted
  leafTinted: boolean;
  special?: 'birch' | 'crimson' | 'warped' | 'null' | 'cherry';
  /** The log's name when it is not `<name>_log` (V6: chorus stalks), for a set without leaves or a sapling. */
  log?: string;
}

export const WOODS: Record<string, WoodPalette> = {
  oak: { plank: [hex(0x6b5433), hex(0x8f7248), hex(0xa2824e), hex(0xb49358), hex(0xc0a064)], bark: [hex(0x3d2f1b), hex(0x574326), hex(0x6b5332), hex(0x7f6441)], leaf: null, leafTinted: true },
  spruce: { plank: [hex(0x3f2c16), hex(0x5a3f22), hex(0x6b4c2a), hex(0x7a5831), hex(0x85613a)], bark: [hex(0x24170a), hex(0x3a2811), hex(0x4a3318), hex(0x5a3f20)], leaf: null, leafTinted: true },
  birch: { plank: [hex(0x8e7b4f), hex(0xb7a26b), hex(0xc8b77a), hex(0xd6c68b), hex(0xe0d19a)], bark: [hex(0x2a2a2a), hex(0xc9c7c0), hex(0xdcdad3), hex(0xeeede8)], leaf: null, leafTinted: true, special: 'birch' },
  jungle: { plank: [hex(0x6a4630), hex(0x93643f), hex(0xa7744c), hex(0xb78357), hex(0xc38f62)], bark: [hex(0x2e2409), hex(0x4f3f14), hex(0x5d4b19), hex(0x6e5a21)], leaf: null, leafTinted: true },
  acacia: { plank: [hex(0x6f361b), hex(0x9b4f2b), hex(0xad5a31), hex(0xbc6639), hex(0xc87141)], bark: [hex(0x413b33), hex(0x5a544b), hex(0x686158), hex(0x78716a)], leaf: null, leafTinted: true },
  dark_oak: { plank: [hex(0x2a1a0b), hex(0x3c2813), hex(0x4a3118), hex(0x553a1d), hex(0x604223)], bark: [hex(0x1e150a), hex(0x2f2213), hex(0x3c2c19), hex(0x4a3720)], leaf: null, leafTinted: true },
  mangrove: { plank: [hex(0x4e1d19), hex(0x6a2a24), hex(0x77302a), hex(0x843731), hex(0x903e37)], bark: [hex(0x2e2213), hex(0x4a3a22), hex(0x5a4629), hex(0x6a5431)], leaf: null, leafTinted: true },
  cherry: { plank: [hex(0x9c6a67), hex(0xd49e98), hex(0xe2b1aa), hex(0xebc0b9), hex(0xf3cec7)], bark: [hex(0x1f1117), hex(0x351f2a), hex(0x442834), hex(0x54323f)], leaf: [hex(0xc76a9a), hex(0xe28fb8), hex(0xf0a9c8), hex(0xf8c1d8), hex(0xffd8e8)], leafTinted: false, special: 'cherry' },
  crimson: { plank: [hex(0x44192c), hex(0x622a40), hex(0x6e304a), hex(0x7b3654), hex(0x89405e)], bark: [hex(0x3a0c14), hex(0x5b1422), hex(0x7a1d2d), hex(0x952b3a)], leaf: null, leafTinted: false, special: 'crimson' },
  warped: { plank: [hex(0x16453f), hex(0x236b62), hex(0x2a7a70), hex(0x33897e), hex(0x3b978b)], bark: [hex(0x1d1a2a), hex(0x2e2743), hex(0x3a3155), hex(0x44395f)], leaf: null, leafTinted: false, special: 'warped' },
  null: { plank: [hex(0x3c4650), hex(0x5d6b77), hex(0x6c7b88), hex(0x7b8c99), hex(0x8b9ca9)], bark: [hex(0x12161a), hex(0x2a3238), hex(0x384249), hex(0x46525a)], leaf: [hex(0x1d4a45), hex(0x2a6860), hex(0x36847a), hex(0x44a094), hex(0xd24fd0)], leafTinted: false, special: 'null' },
  // V6 phase 2: the giant chorus trees of the Expanded End's Chorus Forest
  chorus: { plank: [hex(0x5a3a66), hex(0x7a5288), hex(0x8a5e98), hex(0x9a6ca8), hex(0xaa7ab8)], bark: [hex(0x3a2244), hex(0x5a3a66), hex(0x6e4a7c), hex(0x845c92)], leaf: null, leafTinted: false, log: 'chorus_stalk' },
};

function logSide(t: Tex, w: WoodPalette): void {
  if (w.special === 'birch') {
    blotchy(t, [w.bark[1]!, w.bark[2]!, w.bark[3]!], 1, 0.6);
    for (let i = 0; i < 7; i++) {
      const y = t.rng.int(16);
      const x = t.rng.int(14);
      const len = 1 + t.rng.int(4);
      for (let k = 0; k < len; k++) t.set(x + k, y, w.bark[0]!);
    }
    return;
  }
  streaksV(t, w.bark, 4);
  if (w.special === 'crimson' || w.special === 'warped') {
    const glow = w.special === 'crimson' ? hex(0xff5a3c) : hex(0x3cf2c8);
    for (let i = 0; i < 10; i++) t.set(t.rng.int(16), t.rng.int(16), glow);
  }
  if (w.special === 'null') glitchRows(t, 3);
}

function logTop(t: Tex, w: WoodPalette, stripped: boolean): void {
  const ringA = w.plank[2]!;
  const ringB = w.plank[3]!;
  rings(t, ringA, ringB, w.plank[1]!, stripped ? null : w.bark[2]!, stripped ? undefined : w.bark[1]);
  if (stripped) frame(t, w.plank[1]!);
  if (w.special === 'crimson' || w.special === 'warped') {
    const glow = w.special === 'crimson' ? hex(0xff5a3c) : hex(0x3cf2c8);
    t.rect(6, 6, 4, 4, glow);
  }
}

function strippedSide(t: Tex, w: WoodPalette): void {
  streaksV(t, [w.plank[1]!, w.plank[2]!, w.plank[3]!, w.plank[4]!], 2);
  if (w.special === 'null') glitchRows(t, 2);
}

/** Shifts random rows horizontally for the corrupted Farlands look. */
export function glitchRows(t: Tex, count: number): void {
  const c = t.copy();
  for (let i = 0; i < count; i++) {
    const y = t.rng.int(16);
    const h = 1 + t.rng.int(2);
    const s = 2 + t.rng.int(6);
    for (let yy = y; yy < y + h && yy < 16; yy++) for (let x = 0; x < 16; x++) t.set(x, yy, c.get(x + s, yy));
  }
}

function sapling(t: Tex, w: WoodPalette, name: string): void {
  t.clear();
  const leafCols = w.leaf ?? [hex(0x2e5f14), hex(0x3f7f1d), hex(0x4f9a26), hex(0x5fb030), hex(0x70c03a)];
  const trunk = w.bark[2]!;
  for (let y = 10; y < 16; y++) t.set(7, y, trunk);
  t.set(8, 12, trunk);
  const shapes: Record<string, string[]> = {
    default: ['.....aa.....', '...abbcba...', '..abccccba..', '.abcddccba..', '.abccdccbba.', '..abbccbba..', '...aabba....', '.....a......'],
    spruce: ['.....a......', '....aba.....', '...abcba....', '....aba.....', '..abcccba...', '.abcddccba..', '...abcba....', '..abbcbba...'],
  };
  const shape = name.startsWith('spruce') ? shapes.spruce! : shapes.default!;
  const pal = { a: leafCols[0]!, b: leafCols[1]!, c: leafCols[2]!, d: leafCols[3]! };
  t.mask(shape, pal, 2, 2);
}

function door(t: Tex, w: WoodPalette, part: 'top' | 'bottom', kind: string): void {
  planks(t, w.plank);
  // rotate plank direction to vertical for doors
  t.rotate90();
  frame(t, w.plank[0]!);
  if (part === 'top') {
    if (kind === 'oak' || kind === 'jungle' || kind === 'dark_oak' || kind === 'acacia' || kind === 'cherry' || kind === 'mangrove') {
      // windows
      for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]] as const) {
        for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) t.set(x, y, [0, 0, 0, 0]);
      }
    } else if (kind === 'spruce' || kind === 'birch') {
      for (let y = 3; y < 7; y++) for (let x = 3; x < 13; x++) t.set(x, y, [0, 0, 0, 0]);
    }
  } else {
    for (let y = 2; y < 14; y++) {
      t.set(3, y, w.plank[1]!);
      t.set(12, y, w.plank[1]!);
    }
    t.set(12, 1, hex(0x2b2b2b));
    t.rect(11, 1, 2, 2, hex(0x5c5c5c));
  }
}

function trapdoor(t: Tex, w: WoodPalette): void {
  planks(t, w.plank);
  frame(t, w.plank[0]!);
  for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]] as const) {
    for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) if ((x + y) % 2 === 0) t.set(x, y, [0, 0, 0, 0]);
  }
}

export function registerWood(r: PainterRegistry): void {
  for (const [name, w] of Object.entries(WOODS)) {
    const nether = name === 'crimson' || name === 'warped';
    const log = w.log ?? (nether ? name + '_stem' : name + '_log');
    r.add(name + '_planks', (t) => {
      planks(t, w.plank);
      if (w.special === 'null') glitchRows(t, 3);
    });
    r.add(log, (t) => logSide(t, w));
    r.add(log + '_top', (t) => logTop(t, w, false));
    r.add('stripped_' + log, (t) => strippedSide(t, w));
    r.add('stripped_' + log + '_top', (t) => logTop(t, w, true));
    if (!nether && !w.log) {
      r.add(name + '_leaves', (t) => {
        if (w.leafTinted || !w.leaf) {
          leaves(t, [hex(0x2c2c2c), hex(0x505050), hex(0x6a6a6a), hex(0x858585), hex(0x9e9e9e)], 0.12);
          t.toTintable(1.9);
        } else {
          leaves(t, w.leaf, 0.12);
          if (w.special === 'null') {
            for (let i = 0; i < 6; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xd24fd0));
            glitchRows(t, 2);
          }
        }
      });
      r.add(name + '_sapling', (t, n) => sapling(t, w, n));
    }
    r.add(name + '_door_top', (t) => door(t, w, 'top', name));
    r.add(name + '_door_bottom', (t) => door(t, w, 'bottom', name));
    r.add(name + '_trapdoor', (t) => trapdoor(t, w));
  }
  // Iron door/trapdoor
  const iron = [hex(0x7b7b7b), hex(0xa7a7a7), hex(0xc4c4c4), hex(0xd6d6d6), hex(0xe8e8e8)];
  r.add('iron_door_top', (t) => {
    blotchy(t, iron.slice(1, 4), 1, 0.4);
    frame(t, iron[0]!);
    for (let y = 3; y < 8; y++) for (let x = 3; x < 13; x++) t.set(x, y, [0, 0, 0, 0]);
    for (let x = 4; x < 13; x += 2) for (let y = 3; y < 8; y++) t.set(x, y, iron[1]!);
  });
  r.add('iron_door_bottom', (t) => {
    blotchy(t, iron.slice(1, 4), 1, 0.4);
    frame(t, iron[0]!);
    for (let y = 2; y < 14; y += 3) for (let x = 2; x < 14; x++) t.set(x, y, iron[1]!);
    t.rect(11, 1, 2, 2, hex(0x5c5c5c));
  });
  r.add('iron_trapdoor', (t) => {
    blotchy(t, iron.slice(1, 4), 1, 0.4);
    frame(t, iron[0]!);
    for (let y = 3; y < 13; y += 3) for (let x = 3; x < 13; x++) t.set(x, y, [0, 0, 0, 0]);
  });
  void mix;
  void shade;
}
