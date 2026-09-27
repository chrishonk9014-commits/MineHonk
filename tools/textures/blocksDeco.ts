/** Colored blocks, glass, functional blocks, plants, crops, misc decoration. */
import { Tex, type RGB, hex, shade, mix, TINT_ALPHA } from './canvas';
import { blotchy, bricks, wool, frame, bevel, planks, stones, voronoi } from './patterns';
import { WOODS } from './blocksWood';
import { STONE_PAL, stone } from './blocksNatural';
import type { PainterRegistry } from './registry';

export const DYE: Record<string, number> = {
  white: 0xe9ecec,
  orange: 0xf07613,
  magenta: 0xbd44b3,
  light_blue: 0x3aafd9,
  yellow: 0xf8c627,
  lime: 0x70b919,
  pink: 0xed8dac,
  gray: 0x3e4447,
  light_gray: 0x8e8e86,
  cyan: 0x158991,
  purple: 0x792aac,
  blue: 0x35399d,
  brown: 0x724728,
  green: 0x546d1b,
  red: 0xa12722,
  black: 0x141519,
};

const T: RGB = [0, 0, 0];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function glassPane(t: Tex, frameCol: RGB, alphaInner: number, tint: RGB | null): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, frameCol, tint ? 220 : 255);
      else if (tint) t.set(x, y, tint, alphaInner);
      else t.set(x, y, CLEAR);
    }
  }
  // streaks
  const streak = tint ? shade(tint, 1.25) : hex(0xffffff);
  for (const [x0, y0, len] of [[3, 3, 3], [4, 10, 2], [10, 5, 3]] as const) {
    for (let k = 0; k < len; k++) t.set(x0 + k, y0 + k, streak, tint ? 200 : 180);
  }
}

function plant(t: Tex, rows: string[], pal: Record<string, RGB>, oy = 0): void {
  t.clear();
  t.mask(rows, pal, 0, oy);
}

const STEM = hex(0x3f7a24);
const STEM_D = hex(0x2d5a17);

function flowerSprite(t: Tex, head: string[], pal: Record<string, RGB>, stemTop = 9): void {
  t.clear();
  for (let y = stemTop; y < 16; y++) t.set(7, y, STEM);
  t.set(6, 13, STEM_D);
  t.set(5, 12, STEM_D);
  t.set(8, 12, STEM);
  t.set(9, 11, STEM);
  t.set(10, 11, STEM_D);
  t.mask(head, pal, 0, 0);
}

function crossGrass(t: Tex, tall: number, density: number): void {
  t.clear();
  for (let i = 0; i < density; i++) {
    const x = 1 + t.rng.int(14);
    const h = Math.max(3, Math.round(tall * (0.5 + t.rng.next() * 0.5)));
    let xx = x;
    for (let y = 15; y > 15 - h; y--) {
      const g = y > 15 - h + 2 ? 0x8c + t.rng.int(20) : 0xb0 + t.rng.int(20);
      t.set(xx, y, [g, g, g, TINT_ALPHA]);
      if (t.rng.chance(0.2)) xx += t.rng.bool() ? 1 : -1;
      xx = Math.max(0, Math.min(15, xx));
    }
  }
}

function crop(t: Tex, stage: number, maxStage: number, leaf: RGB, fruit: RGB | null, kind: string): void {
  t.clear();
  const frac = (stage + 1) / (maxStage + 1);
  const h = Math.round(3 + frac * 12);
  const cols = [0, 3, 6, 9, 12, 14];
  for (const cx of cols) {
    const hh = h - (cx % 2);
    for (let y = 16 - hh; y < 16; y++) {
      const c = y < 16 - hh + 2 && stage === maxStage && kind === 'wheat' ? hex(0xd8b14a) : y % 3 === 0 ? shade(leaf, 0.85) : leaf;
      t.set(cx + (y % 4 === 0 ? 1 : 0), y, c);
    }
    if (stage === maxStage && fruit) {
      if (kind === 'wheat') {
        for (let y = 16 - hh; y < 16 - hh + 4; y++) {
          t.set(cx, y, fruit);
          t.set(cx + 1, y, shade(fruit, 0.85));
        }
      } else {
        t.set(cx, 16 - Math.floor(hh / 3), fruit);
        t.set(cx + 1, 16 - Math.floor(hh / 3), shade(fruit, 1.1));
      }
    }
  }
}

function furnaceSide(t: Tex): void {
  blotchy(t, STONE_PAL.slice(0, 4), 1, 0.8);
  bevel(t, STONE_PAL[4]!, STONE_PAL[0]!);
}

function furnaceFront(t: Tex, lit: boolean, accent: RGB): void {
  furnaceSide(t);
  t.rect(3, 8, 10, 6, hex(0x1f1f1f));
  frame(t, STONE_PAL[0]!, 2);
  t.rect(3, 3, 10, 2, shade(accent, 0.8));
  if (lit) {
    for (let x = 4; x < 12; x++) {
      const h = 2 + ((x * 7) % 3);
      for (let y = 13 - h; y < 13; y++) t.set(x, y, y > 11 ? hex(0xffd23f) : y > 10 ? hex(0xff8c1a) : hex(0xd8400c));
    }
  } else {
    for (let x = 4; x < 12; x++) t.set(x, 12, hex(0x3a3a3a));
  }
}

function fireFrame(t: Tex, f: number, cols: RGB[]): void {
  t.clear();
  for (let x = 0; x < 16; x++) {
    const base = 6 + Math.round(5 * Math.abs(Math.sin((x * 1.7 + f * 0.9) * 0.9)) + 2 * Math.sin(f * 0.5 + x));
    for (let y = 16 - base; y < 16; y++) {
      const rel = (y - (16 - base)) / base;
      if (t.rng.chance(0.08) && rel < 0.3) continue;
      const k = rel < 0.25 ? 3 : rel < 0.5 ? 2 : rel < 0.8 ? 1 : 0;
      t.set(x, y, cols[k]!);
    }
  }
}

export function registerDeco(r: PainterRegistry): void {
  // Colored blocks
  for (const [color, v] of Object.entries(DYE)) {
    const base = hex(v);
    r.add(color + '_wool', (t) => wool(t, base));
    r.add(color + '_concrete', (t) => {
      blotchy(t, [shade(base, 0.97), base, shade(base, 1.02)], 2, 0.5);
    });
    r.add(color + '_stained_glass', (t) => glassPane(t, shade(base, 0.9), 140, base));
    // beds
    r.add(color + '_bed_head_top', (t) => {
      wool(t, base);
      t.rect(1, 1, 14, 6, hex(0xf0f0f0));
      bevel(t, hex(0xffffff), hex(0xc8c8c8), 1);
      frame(t, shade(base, 0.7));
    });
    r.add(color + '_bed_foot_top', (t) => {
      wool(t, base);
      frame(t, shade(base, 0.7));
    });
    r.add(color + '_bed_side', (t) => {
      planks(t, WOODS.oak!.plank);
      t.rect(0, 0, 16, 7, base);
      for (let x = 0; x < 16; x++) t.set(x, 6, shade(base, 0.75));
      t.rect(0, 13, 3, 3, WOODS.oak!.plank[0]!);
      t.rect(13, 13, 3, 3, WOODS.oak!.plank[0]!);
    });
  }
  r.add('bed_bottom', (t) => planks(t, WOODS.oak!.plank));
  r.add('glass', (t) => glassPane(t, hex(0xdbe9ea), 0, null));
  r.add('glass_pane_top', (t) => {
    t.fill(hex(0xdbe9ea));
  });
  r.add('tinted_glass', (t) => glassPane(t, hex(0x2a2330), 210, hex(0x3a3242)));
  r.add('iron_bars', (t) => {
    t.clear();
    for (const x of [0, 4, 8, 12]) {
      for (let y = 0; y < 16; y++) {
        t.set(x + 1, y, hex(0x8e8e8e));
        t.set(x + 2, y, hex(0x5c5c5c));
      }
    }
    for (const y of [2, 13]) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x777777));
  });

  // Plants
  r.add('short_grass', (t) => crossGrass(t, 10, 22));
  r.add('tall_grass_bottom', (t) => crossGrass(t, 18, 26));
  r.add('tall_grass_top', (t) => crossGrass(t, 12, 18));
  r.add('fern', (t) => {
    t.clear();
    for (const [x0, dir] of [[7, -1], [8, 1], [7, 0]] as const) {
      let x = x0;
      for (let y = 15; y > 3; y--) {
        t.set(x, y, [0x96, 0x96, 0x96, TINT_ALPHA]);
        if (y % 2 === 0) {
          t.set(x - 1, y, [0xa8, 0xa8, 0xa8, TINT_ALPHA]);
          t.set(x + 1, y, [0x86, 0x86, 0x86, TINT_ALPHA]);
        }
        if (y % 3 === 0) x += dir;
      }
    }
  });
  r.add('large_fern_bottom', (t) => crossGrass(t, 18, 20));
  r.add('large_fern_top', (t) => crossGrass(t, 13, 14));
  r.add('far_tall_grass', (t) => {
    t.clear();
    for (let i = 0; i < 18; i++) {
      const x = 1 + t.rng.int(14);
      const h = 4 + t.rng.int(10);
      for (let y = 15; y > 15 - h; y--) t.set(x, y, y < 15 - h + 2 ? hex(0x8ae2d0) : hex(0x3f9a86));
      if (t.rng.chance(0.3)) t.set(x, 15 - h, hex(0xd24fd0));
    }
  });
  r.add('dead_bush', (t) => {
    t.clear();
    const c = hex(0x6b4f2a);
    const paths = [
      [7, 15, 0, -1, 9],
      [7, 11, -1, -1, 5],
      [7, 10, 1, -1, 6],
      [5, 8, -1, 0, 3],
      [10, 7, 1, -1, 3],
    ];
    for (const [x0, y0, dx, dy, n] of paths) for (let k = 0; k < n!; k++) t.set(x0! + dx! * k, y0! + dy! * k, k % 3 === 2 ? hex(0x8a6a3a) : c);
  });
  const petals = (c: RGB, d: RGB, center: RGB) => ({ a: c, b: d, c: center });
  r.add('poppy', (t) => flowerSprite(t, ['', '', '', '', '......aa........', '.....abba.......', '....abccba......', '.....abba.......', '......aa........'], petals(hex(0xed302c), hex(0xb01a17), hex(0x2c2c20))));
  r.add('dandelion', (t) => flowerSprite(t, ['', '', '', '', '', '......aa........', '.....abba.......', '.....abba.......', '......aa........'], petals(hex(0xfff14a), hex(0xe0b80f), hex(0xe0b80f))));
  r.add('blue_orchid', (t) => flowerSprite(t, ['', '', '', '....a..a........', '...aba.aba......', '....a.c.a.......', '......aba.......', '.......a........'], petals(hex(0x2abfe8), hex(0x1a7fb8), hex(0x9ee8ff)), 8));
  r.add('allium', (t) => flowerSprite(t, ['', '', '.....aba........', '....abcba.......', '....bcacb.......', '....abcba.......', '.....aba........'], petals(hex(0xb878e8), hex(0x8a4ec2), hex(0xe0b0ff)), 7));
  r.add('azure_bluet', (t) => flowerSprite(t, ['', '', '', '', '...a...a........', '..aca.aca.......', '...a.a.a........', '.....aca........', '......a.........'], petals(hex(0xf0f0f0), hex(0xc0c0c0), hex(0xf0e060))));
  for (const [n, c] of [['red', 0xe02a1a], ['orange', 0xf07a1a], ['white', 0xeeeeee], ['pink', 0xf0a0c8]] as const) {
    r.add(n + '_tulip', (t) => flowerSprite(t, ['', '', '', '', '.....a.a.a......', '.....aabaa......', '.....abbba......', '......aaa.......'], petals(hex(c), shade(hex(c), 0.8), T), 8));
  }
  r.add('oxeye_daisy', (t) => flowerSprite(t, ['', '', '', '', '......a.........', '....aaaaa.......', '.....acca.......', '....aaaaa.......', '......a.........'], petals(hex(0xf6f6f6), hex(0xd8d8d8), hex(0xf5c518))));
  r.add('cornflower', (t) => flowerSprite(t, ['', '', '', '', '.....a.a........', '....abbba.......', '.....bcb........', '....abbba.......', '.....a.a........'], petals(hex(0x6a8cf0), hex(0x3f5fd0), hex(0x1e2f80))));
  r.add('lily_of_the_valley', (t) => flowerSprite(t, ['', '', '', '.....aa.........', '......a..aa.....', '.......b..a.....', '...aa..b........', '....a.b.........'], petals(hex(0xffffff), STEM, T), 7));
  r.add('wither_rose', (t) => flowerSprite(t, ['', '', '', '', '......aa........', '.....abba.......', '....abccba......', '.....abba.......', '......aa........'], petals(hex(0x2a2a2a), hex(0x141414), hex(0x3a3a3a))));
  r.add('glowbell', (t) => flowerSprite(t, ['', '', '', '......aaa.......', '.....abcba......', '.....abcba......', '.....a.c.a......', '.......c........'], petals(hex(0x8ff0e8), hex(0x5ac8d8), hex(0xe8ffff)), 8));
  for (const [n, top, c] of [['sunflower', 'sun', 0xffd21f], ['lilac', 'lilac', 0xc88ad8], ['rose_bush', 'rose', 0xd8201a], ['peony', 'peony', 0xf0b0d8]] as const) {
    r.add(n + '_bottom', (t) => {
      t.clear();
      for (let y = 0; y < 16; y++) t.set(7, y, STEM);
      for (const [x, y] of [[5, 10], [6, 11], [9, 6], [10, 5], [4, 4], [5, 5], [9, 13], [10, 12]] as const) t.set(x, y, STEM_D);
      if (top !== 'sun') for (let i = 0; i < 6; i++) t.set(3 + t.rng.int(10), 2 + t.rng.int(8), hex(c));
    });
    r.add(n + '_top', (t) => {
      t.clear();
      for (let y = 8; y < 16; y++) t.set(7, y, STEM);
      if (top === 'sun') {
        t.mask(['....aaaaaa......', '...abbbbbba.....', '..abbccccbba....', '..abcddddcba....', '..abcddddcba....', '..abbccccbba....', '...abbbbbba.....', '....aaaaaa......'], { a: hex(0xe8a800), b: hex(0xffd21f), c: hex(0x6a3f10), d: hex(0x4a2a08) }, 0, 1);
      } else {
        for (let i = 0; i < 30; i++) {
          const x = 3 + t.rng.int(10);
          const y = 1 + t.rng.int(9);
          t.set(x, y, t.rng.chance(0.3) ? shade(hex(c), 0.8) : hex(c));
        }
      }
    });
  }
  r.add('brown_mushroom', (t) => plant(t, ['', '', '', '', '', '', '', '', '.....aaaaa......', '....abbbbba.....', '....aaaaaaa.....', '.......c........', '.......c........', '.......c........'], { a: hex(0x8a6545), b: hex(0xa47c56), c: hex(0xd8cfb8) }));
  r.add('red_mushroom', (t) => plant(t, ['', '', '', '', '', '', '', '.....aaaaa......', '....abaaaba.....', '....aaaabaa.....', '....aaaaaaa.....', '.......c........', '.......c........', '.......c........'], { a: hex(0xd92b1e), b: hex(0xf2f2f2), c: hex(0xd8cfb8) }));
  r.add('crimson_fungus', (t) => plant(t, ['', '', '', '', '', '', '', '....aaaaaa......', '...abbaabba.....', '...aaaaaaaa.....', '.....c..c.......', '......cc........', '.......c........', '.......c........'], { a: hex(0xa81e2a), b: hex(0xf2a43a), c: hex(0xd8cfb8) }));
  r.add('warped_fungus', (t) => plant(t, ['', '', '', '', '', '', '', '....aaaaaa......', '...abbaabba.....', '...aaaaaaaa.....', '.....c..c.......', '......cc........', '.......c........', '.......c........'], { a: hex(0x16867a), b: hex(0xf2a43a), c: hex(0xd8cfb8) }));
  const roots = (t: Tex, c: RGB, d: RGB) => {
    t.clear();
    for (let i = 0; i < 9; i++) {
      let x = 2 + t.rng.int(12);
      const h = 5 + t.rng.int(9);
      for (let y = 15; y > 15 - h; y--) {
        t.set(x, y, y < 17 - h ? d : c);
        if (t.rng.chance(0.25)) x += t.rng.bool() ? 1 : -1;
      }
    }
  };
  r.add('crimson_roots', (t) => roots(t, hex(0x8a1f2a), hex(0xd8404a)));
  r.add('warped_roots', (t) => roots(t, hex(0x157a70), hex(0x3cd0c0)));
  r.add('nether_sprouts', (t) => roots(t, hex(0x1a9080), hex(0x5ae0d0)));
  r.add('brown_mushroom_block', (t) => {
    blotchy(t, [hex(0x8a6545), hex(0x967050), hex(0xa07a58)], 1, 0.8);
  });
  r.add('red_mushroom_block', (t) => {
    blotchy(t, [hex(0xb81f1a), hex(0xc8231d), hex(0xd62a22)], 1, 0.8);
    for (const [x, y, s] of [[2, 3, 3], [10, 2, 2], [6, 9, 3], [12, 11, 2], [1, 12, 2]] as const) t.rect(x, y, s, s, hex(0xf0ece4));
  });
  r.add('mushroom_stem', (t) => {
    blotchy(t, [hex(0xc9c3b0), hex(0xd4cfbd), hex(0xdcd8c8)], 1, 0.8);
  });
  r.add('mushroom_block_inside', (t) => blotchy(t, [hex(0xc8a88a), hex(0xd4b596), hex(0xdcc0a0)], 1, 0.8));
  r.add('lily_pad', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 7.5 && !(dx > 0 && Math.abs(dy) < 1.2)) {
          const g = d > 6.5 ? 0x70 : (x + y) % 5 === 0 ? 0x90 : 0x80;
          t.set(x, y, [g, g, g, TINT_ALPHA]);
        }
      }
    }
  });
  r.add('vine', (t) => {
    t.clear();
    for (let i = 0; i < 5; i++) {
      let x = 1 + t.rng.int(14);
      for (let y = 0; y < 16; y++) {
        t.set(x, y, [0x80, 0x80, 0x80, TINT_ALPHA]);
        if (t.rng.chance(0.4)) t.set(x + (t.rng.bool() ? 1 : -1), y, [0x9a, 0x9a, 0x9a, TINT_ALPHA]);
        if (t.rng.chance(0.3)) x = Math.max(0, Math.min(15, x + (t.rng.bool() ? 1 : -1)));
      }
    }
  });
  r.add('glow_lichen', (t) => {
    t.clear();
    for (let i = 0; i < 40; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.chance(0.3) ? hex(0xb8f0c8) : hex(0x6e9c80));
  });
  r.add('sculk_vein', (t) => {
    t.clear();
    for (let i = 0; i < 4; i++) {
      let x = t.rng.int(16);
      let y = t.rng.int(16);
      for (let k = 0; k < 10; k++) {
        t.set(x & 15, y & 15, k % 4 === 0 ? hex(0x1ec8c8) : hex(0x0b3a44));
        if (t.rng.bool()) x += t.rng.bool() ? 1 : -1;
        else y += t.rng.bool() ? 1 : -1;
      }
    }
  });
  r.add('seagrass', (t) => {
    t.clear();
    for (let i = 0; i < 6; i++) {
      let x = 2 + t.rng.int(12);
      for (let y = 15; y > 2 + t.rng.int(5); y--) {
        t.set(x, y, y % 2 ? hex(0x2f8a2a) : hex(0x3fa83a));
        if (t.rng.chance(0.3)) x += t.rng.bool() ? 1 : -1;
      }
    }
  });
  r.add('kelp', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++) {
      const x = 7 + Math.round(Math.sin(y * 0.7));
      t.set(x, y, hex(0x3a7a1a));
      t.set(x + 1, y, hex(0x4a8f22));
      if (y % 4 === 0) {
        t.set(x - 1, y, hex(0x5aa82a));
        t.set(x + 2, y + 1, hex(0x5aa82a));
      }
    }
  });
  r.add('sugar_cane', (t) => {
    t.clear();
    for (const x of [3, 8, 12]) {
      for (let y = 0; y < 16; y++) {
        const g = y % 5 === 0 ? 0x70 : 0xa8;
        t.set(x, y, [g, g, g, TINT_ALPHA]);
        t.set(x + 1, y, [g - 20, g - 20, g - 20, TINT_ALPHA]);
      }
      t.set(x + 2, 4 + x, [0xa0, 0xa0, 0xa0, TINT_ALPHA]);
    }
  });
  r.add('cactus_side', (t) => {
    blotchy(t, [hex(0x0f5c1a), hex(0x137020), hex(0x178226)], 1, 0.6);
    for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) t.set(x, y, hex(0x0c4a14));
    for (let i = 0; i < 12; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xd8d8a0));
    t.set(0, 0, CLEAR);
  });
  r.add('cactus_top', (t) => {
    blotchy(t, [hex(0x137020), hex(0x178226), hex(0x1d9430)], 1, 0.6);
    frame(t, hex(0x0c4a14), 1);
    t.rect(6, 6, 4, 4, hex(0x2aa83c));
  });
  r.add('cactus_bottom', (t) => blotchy(t, [hex(0x9aa860), hex(0xa8b46c), hex(0xb4c078)], 1, 0.6));
  r.add('bamboo_stalk', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++) {
      for (let x = 6; x < 10; x++) t.set(x, y, y % 8 === 0 ? hex(0x5a7a1a) : x === 6 ? hex(0x6e9a24) : hex(0x86b62e));
    }
  });
  r.add('bamboo_top', (t) => {
    t.fill(hex(0x86b62e));
    t.rect(6, 6, 4, 4, hex(0xd4c46a));
  });
  r.add('cobweb', (t) => {
    t.clear();
    const c: [number, number, number, number] = [0xe8, 0xe8, 0xe8, 255];
    for (let i = 0; i < 16; i++) {
      t.set(i, i, c);
      t.set(15 - i, i, c);
      t.set(7, i, c);
      t.set(i, 8, c);
    }
    for (const r0 of [3, 6]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        t.set(Math.round(7.5 + Math.cos(ang) * r0), Math.round(7.5 + Math.sin(ang) * r0), c);
      }
    }
  });
  r.add('sweet_berry_bush', (t) => crossGrass(t, 10, 20));
  for (let s = 0; s < 4; s++) {
    r.add('sweet_berry_bush_stage' + s, (t) => {
      t.clear();
      for (let i = 0; i < 16 + s * 6; i++) t.set(2 + t.rng.int(12), 16 - 3 - t.rng.int(3 + s * 3), t.rng.chance(0.5) ? hex(0x2d5a24) : hex(0x3f7a2e));
      if (s >= 2) for (let i = 0; i < (s - 1) * 4; i++) t.set(2 + t.rng.int(12), 5 + t.rng.int(9), hex(0xc01a2a));
    });
  }
  r.add('azalea', (t) => {
    t.clear();
    t.rect(2, 3, 12, 9, hex(0x5f8a2a));
    for (let i = 0; i < 25; i++) t.set(2 + t.rng.int(12), 3 + t.rng.int(9), t.rng.chance(0.5) ? hex(0x4a7020) : hex(0x78a838));
    for (let y = 12; y < 16; y++) t.set(7, y, hex(0x6e5a3a));
  });
  r.add('cave_vines', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++) {
      t.set(7 + (y % 3 === 0 ? 1 : 0), y, hex(0x4a7a2a));
      if (y % 4 === 1) t.set(6, y, hex(0x5f9a34));
    }
  });
  r.add('cave_vines_lit', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++) t.set(7 + (y % 3 === 0 ? 1 : 0), y, hex(0x4a7a2a));
    for (const [x, y] of [[5, 4], [9, 9], [6, 13]] as const) {
      t.rect(x, y, 2, 2, hex(0xffb02a));
      t.set(x, y, hex(0xffe08a));
    }
  });
  r.add('hanging_roots', (t) => {
    t.clear();
    for (let i = 0; i < 7; i++) {
      let x = 2 + t.rng.int(12);
      const len = 5 + t.rng.int(10);
      for (let y = 0; y < len; y++) {
        t.set(x, y, hex(0xa37b52));
        if (t.rng.chance(0.25)) x += t.rng.bool() ? 1 : -1;
      }
    }
  });
  r.add('spore_blossom', (t) => {
    t.clear();
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (let k = 1; k < 7; k++) t.set(Math.round(7.5 + Math.cos(ang) * k), Math.round(7.5 + Math.sin(ang) * k), k > 4 ? hex(0xe86aa8) : hex(0xc84a88));
    }
    t.rect(6, 6, 4, 4, hex(0x6a9a3a));
  });
  r.add('weeping_vines', (t) => {
    t.clear();
    for (const x of [4, 8, 11]) for (let y = 0; y < 16; y++) t.set(x + (y % 5 === 0 ? 1 : 0), y, y % 3 ? hex(0x8a1a1a) : hex(0xb02a2a));
  });
  r.add('twisting_vines', (t) => {
    t.clear();
    for (const x of [4, 8, 11]) for (let y = 0; y < 16; y++) t.set(x + (y % 5 === 0 ? 1 : 0), y, y % 3 ? hex(0x148a78) : hex(0x20b09a));
  });

  // Crops
  const cropSpec: [string, number, RGB, RGB | null][] = [
    ['wheat', 8, hex(0x4f9a26), hex(0xc8a03a)],
    ['carrots', 4, hex(0x3f8a2a), hex(0xf07a1a)],
    ['potatoes', 4, hex(0x3f8a2a), hex(0xd8c070)],
    ['beetroots', 4, hex(0x4a8a2a), hex(0xa8203a)],
    ['sunroot', 4, hex(0x6a9a2a), hex(0xffc02a)],
    ['nether_wart', 4, hex(0x8a1a2a), hex(0xc02a3a)],
  ];
  for (const [n, stages, leaf, fruit] of cropSpec) {
    for (let s = 0; s < stages; s++) r.add(`${n}_stage${s}`, (t) => crop(t, s, stages - 1, leaf, fruit, n));
  }

  // Functional
  const oak = WOODS.oak!.plank;
  r.add('crafting_table_top', (t) => {
    planks(t, oak);
    frame(t, oak[0]!);
    for (let i = 3; i < 13; i++) {
      t.set(i, 5, oak[0]!);
      t.set(i, 10, oak[0]!);
      t.set(5, i, oak[0]!);
      t.set(10, i, oak[0]!);
    }
  });
  r.add('crafting_table_side', (t) => {
    planks(t, oak);
    t.rect(0, 0, 16, 3, oak[1]!);
    for (let x = 0; x < 16; x++) t.set(x, 3, oak[0]!);
    // saw
    t.mask(['aaaaaaa', 'abbbbba', '.bcbcb.'], { a: hex(0x6b6b6b), b: hex(0xa8a8a8), c: hex(0x4a4a4a) }, 2, 6);
    // hammer
    t.mask(['ddd', '.e.', '.e.', '.e.'], { d: hex(0x6b6b6b), e: hex(0x7a5a33) }, 11, 6);
  });
  r.add('crafting_table_front', (t) => {
    planks(t, oak);
    t.rect(0, 0, 16, 3, oak[1]!);
    for (let x = 0; x < 16; x++) t.set(x, 3, oak[0]!);
    t.mask(['aa..bb', 'a.a.b.', 'aa..bb'], { a: hex(0x6b6b6b), b: hex(0x8a6a3a) }, 4, 7);
    for (let y = 5; y < 15; y++) t.set(13, y, hex(0x7a5a33));
  });
  for (const [f, accent] of [['furnace', hex(0x5a5a5a)], ['blast_furnace', hex(0x8a8a9a)], ['smoker', hex(0x6a4a2a)]] as const) {
    r.add(f + '_side', (t) => {
      furnaceSide(t);
      if (f === 'blast_furnace') for (let y = 4; y < 16; y += 4) for (let x = 1; x < 15; x++) t.set(x, y, hex(0x4a4a52));
      if (f === 'smoker') t.rect(0, 0, 16, 3, hex(0x5a3f22));
    });
    r.add(f + '_top', (t) => {
      furnaceSide(t);
      if (f !== 'furnace') t.rect(4, 4, 8, 8, shade(accent, 0.6));
    });
    r.add(f + '_front', (t) => furnaceFront(t, false, accent));
    r.add(f + '_front_on', (t) => furnaceFront(t, true, accent));
  }
  const chest = (base: RGB[], latch: RGB, part: 'top' | 'side' | 'front') => (t: Tex) => {
    planks(t, base);
    bevel(t, base[4]!, base[0]!, 0);
    frame(t, shade(base[0]!, 0.7));
    if (part !== 'top') for (let x = 0; x < 16; x++) t.set(x, 5, shade(base[0]!, 0.7));
    if (part === 'front') t.rect(7, 4, 2, 4, latch);
  };
  const chestPal = [hex(0x4a2f12), hex(0x8b5a24), hex(0xa06a2c), hex(0xb07a36), hex(0xbe8a42)];
  for (const [n, pal, latch] of [
    ['chest', chestPal, hex(0xc8c8c8)],
    ['trapped_chest', chestPal, hex(0xc02a2a)],
    ['ender_chest', [hex(0x0c1a1a), hex(0x1a3030), hex(0x244040), hex(0x2c4c4c), hex(0x365858)], hex(0x8af0e0)],
  ] as const) {
    r.add(n + '_top', chest(pal as RGB[], latch, 'top'));
    r.add(n + '_side', chest(pal as RGB[], latch, 'side'));
    r.add(n + '_front', chest(pal as RGB[], latch, 'front'));
    r.add(n, chest(pal as RGB[], latch, 'front'));
  }
  r.add('barrel_side', (t) => {
    planks(t, WOODS.spruce!.plank);
    t.rotate90();
    for (const y of [2, 13]) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x3a3a3a));
  });
  r.add('barrel_top', (t) => {
    planks(t, WOODS.spruce!.plank);
    frame(t, hex(0x3a3a3a));
    t.rect(6, 6, 4, 4, WOODS.spruce!.plank[0]!);
  });
  r.add('barrel_bottom', (t) => {
    planks(t, WOODS.spruce!.plank);
    frame(t, hex(0x3a3a3a));
  });
  r.add('bookshelf', (t) => {
    planks(t, oak);
    const cols = [0x8a2a2a, 0x2a4a8a, 0x2a7a3a, 0x8a6a2a, 0x5a2a7a, 0xa8a8a8, 0x6a3a1a];
    for (const y0 of [1, 9]) {
      t.rect(0, y0, 16, 6, hex(0x2a1a0a));
      let x = 1;
      while (x < 15) {
        const w = 1 + t.rng.int(2);
        const h = 4 + t.rng.int(3);
        const c = hex(t.rng.pick(cols));
        for (let xx = x; xx < Math.min(15, x + w); xx++) for (let y = y0 + 6 - h; y < y0 + 6; y++) t.set(xx, y, xx === x ? shade(c, 1.15) : c);
        x += w + (t.rng.chance(0.2) ? 1 : 0);
      }
    }
  });
  r.add('sponge', (t) => {
    blotchy(t, [hex(0xb8a83a), hex(0xc8b848), hex(0xd4c454)], 1, 0.8);
    for (let i = 0; i < 14; i++) t.rect(t.rng.int(15), t.rng.int(15), 2, 1, hex(0x9a8a2a));
  });
  r.add('wet_sponge', (t) => {
    blotchy(t, [hex(0x8a8a2a), hex(0x9a9a38), hex(0xa8a844)], 1, 0.8);
    for (let i = 0; i < 14; i++) t.rect(t.rng.int(15), t.rng.int(15), 2, 1, hex(0x5a6a3a));
  });
  r.add('slime_block', (t) => {
    t.fill(hex(0x7ac85a), 200);
    frame(t, hex(0x5aa83a));
    t.rect(4, 4, 8, 8, hex(0x6ab84a), 230);
  });
  r.add('honey_block', (t) => {
    t.fill(hex(0xf0a820), 200);
    frame(t, hex(0xd08810));
  });
  r.anim('sea_lantern', 5, 5, (t, f) => {
    blotchy(t, [hex(0xa8c8c0), hex(0xc0dcd4), hex(0xd8ece8), hex(0xf0fffa)], 1, 1);
    const s = [hex(0xe0f8f4), hex(0xffffff)];
    for (let i = 0; i < 16; i++) t.set((i + f * 3) % 16, i, s[i % 2]!);
    frame(t, hex(0x7aa8a0));
  });
  r.add('glowstone', (t) => {
    const cols = [hex(0x8a6a32), hex(0xc0903a), hex(0xf0c060), hex(0xffe8a0)];
    voronoi(t, 10, (x, y, c) => {
      const e = c.d2 - c.d1;
      t.set(x, y, e < 0.8 ? cols[0]! : c.d1 < 1.2 ? cols[3]! : c.d1 < 2.5 ? cols[2]! : cols[1]!);
    });
  });
  r.add('shroomlight', (t) => {
    blotchy(t, [hex(0xf09a3a), hex(0xf8b050), hex(0xffc868), hex(0xffe0a0)], 1, 1.2);
  });
  r.add('tnt_side', (t) => {
    blotchy(t, [hex(0xa8281c), hex(0xc0321f), hex(0xd23c26)], 1, 0.6);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) t.set(x, y, hex(0x8a1a12));
    t.rect(0, 5, 16, 6, hex(0xe8e0d0));
    t.mask(['aaa.a..a.aaa', '.a..aa.a..a.', '.a..a.aa..a.', '.a..a..a..a.'], { a: hex(0x1a1a1a) }, 2, 6);
  });
  r.add('tnt_top', (t) => {
    blotchy(t, [hex(0xa8281c), hex(0xc0321f)], 1, 0.6);
    for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]] as const) {
      t.rect(x, y, 4, 4, hex(0x3a3a3a));
      t.rect(x + 1, y + 1, 2, 2, hex(0x9a9a9a));
    }
  });
  r.add('tnt_bottom', (t) => blotchy(t, [hex(0xa8281c), hex(0xc0321f)], 1, 0.6));
  r.add('ladder', (t) => {
    t.clear();
    const [d, m, l] = [oak[0]!, oak[2]!, oak[3]!];
    for (let y = 0; y < 16; y++) {
      t.set(2, y, l);
      t.set(3, y, m);
      t.set(12, y, l);
      t.set(13, y, m);
    }
    for (const y of [2, 6, 10, 14]) {
      for (let x = 4; x < 12; x++) t.set(x, y, m);
      for (let x = 4; x < 12; x++) t.set(x, y + 1, d);
    }
  });
  r.add('scaffolding_side', (t) => {
    t.clear();
    const c = hex(0xc8a85a);
    const d = hex(0x8a6a2a);
    for (let i = 0; i < 16; i++) {
      t.set(0, i, c);
      t.set(15, i, d);
      t.set(i, 0, c);
      t.set(i, 15, d);
      t.set(i, i, c);
    }
  });
  r.add('scaffolding_top', (t) => {
    t.clear();
    frame(t, hex(0xc8a85a));
    for (let i = 3; i < 13; i += 3) for (let k = 0; k < 16; k++) t.set(k, i, hex(0xb8984a));
  });
  r.add('scaffolding_bottom', (t) => {
    t.clear();
    frame(t, hex(0xa8883a));
  });
  r.add('chain', (t) => {
    t.clear();
    for (let y = 0; y < 16; y += 4) {
      t.rect(7, y, 2, 3, hex(0x3a3f4a));
      t.set(7, y + 1, hex(0x5a6070));
    }
  });
  const torch = (flame: RGB[], stick: RGB) => (t: Tex) => {
    t.clear();
    for (let y = 6; y < 16; y++) {
      t.set(7, y, stick);
      t.set(8, y, shade(stick, 0.8));
    }
    t.rect(7, 4, 2, 2, flame[1]!);
    t.set(7, 4, flame[2]!);
    t.set(8, 3, flame[0]!);
    t.set(7, 5, flame[1]!);
  };
  r.add('torch', torch([hex(0xffe066), hex(0xffae2a), hex(0xfff8d0)], hex(0x6b5433)));
  r.add('soul_torch', torch([hex(0x8af0f8), hex(0x3ac8e0), hex(0xe0ffff)], hex(0x6b5433)));
  const lantern = (glow: RGB) => (t: Tex) => {
    t.clear();
    t.rect(5, 5, 6, 8, hex(0x3a3f4a));
    t.rect(6, 7, 4, 5, glow);
    t.rect(6, 4, 4, 1, hex(0x2a2f3a));
    t.rect(7, 2, 2, 2, hex(0x3a3f4a));
  };
  r.add('lantern', lantern(hex(0xffb840)));
  r.add('soul_lantern', lantern(hex(0x5ae0f0)));
  r.add('end_rod', (t) => {
    t.clear();
    t.rect(7, 0, 2, 14, hex(0xf8f0f8));
    t.rect(6, 14, 4, 2, hex(0xd8c8a8));
  });
  r.add('campfire_log', (t) => {
    const w = WOODS.oak!;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, y < 4 || (y > 7 && y < 12) ? w.bark[1 + ((x + y) % 3)]! : w.plank[2]!);
  });
  r.anim('campfire_fire', 8, 2, (t, f) => fireFrame(t, f, [hex(0xd8400c), hex(0xff8c1a), hex(0xffc83a), hex(0xfff0a0)]));
  r.anim('fire', 16, 1, (t, f) => fireFrame(t, f, [hex(0xc8300a), hex(0xf07a12), hex(0xffc028), hex(0xfff6b0)]));
  r.anim('soul_fire', 16, 1, (t, f) => fireFrame(t, f, [hex(0x1a8aa8), hex(0x2ab8d8), hex(0x6ae8f8), hex(0xd0ffff)]));
  r.add('enchanting_table_top', (t) => {
    blotchy(t, [hex(0x5a1a1a), hex(0x7a2424), hex(0x8a2a2a)], 1, 0.6);
    frame(t, hex(0x2a1418));
    t.rect(3, 3, 10, 10, hex(0x3a1a4a));
    t.rect(5, 5, 6, 6, hex(0x20a8a0));
  });
  r.add('enchanting_table_side', (t) => {
    blotchy(t, [hex(0x14101c), hex(0x1c1628), hex(0x241c34)], 1, 0.8);
    t.rect(0, 0, 16, 5, hex(0x8a2a2a));
    for (let x = 0; x < 16; x++) t.set(x, 4, hex(0x5a1414));
    for (let i = 0; i < 5; i++) t.set(2 + t.rng.int(12), 8 + t.rng.int(6), hex(0x6a4a8a));
  });
  r.add('enchanting_table_bottom', (t) => blotchy(t, [hex(0x14101c), hex(0x1c1628), hex(0x241c34)], 1, 0.8));
  const anvilBase = (t: Tex) => {
    blotchy(t, [hex(0x3a3a3a), hex(0x444444), hex(0x4e4e4e)], 1, 0.6);
    bevel(t, hex(0x5a5a5a), hex(0x2a2a2a));
  };
  r.add('anvil', anvilBase);
  r.add('anvil_top', (t) => {
    anvilBase(t);
    t.rect(3, 1, 10, 14, hex(0x4a4a4a));
  });
  r.add('chipped_anvil_top', (t) => {
    anvilBase(t);
    t.rect(3, 1, 10, 14, hex(0x4a4a4a));
    for (let i = 0; i < 4; i++) t.set(3 + t.rng.int(10), 1 + t.rng.int(14), hex(0x2a2a2a));
  });
  r.add('damaged_anvil_top', (t) => {
    anvilBase(t);
    t.rect(3, 1, 10, 14, hex(0x4a4a4a));
    for (let i = 0; i < 10; i++) t.set(3 + t.rng.int(10), 1 + t.rng.int(14), hex(0x2a2a2a));
  });
  r.add('brewing_stand', (t) => {
    t.clear();
    t.rect(7, 1, 2, 14, hex(0xc8a83a));
    t.set(7, 1, hex(0xf0d060));
  });
  r.add('brewing_stand_base', (t) => {
    stone(t);
  });
  r.add('smithing_table_top', (t) => {
    blotchy(t, [hex(0x2a2a30), hex(0x34343a), hex(0x3e3e44)], 1, 0.6);
    frame(t, hex(0x5a3a1a));
  });
  r.add('smithing_table_side', (t) => {
    planks(t, WOODS.dark_oak!.plank);
    t.rect(0, 0, 16, 4, hex(0x34343a));
  });
  r.add('smithing_table_front', (t) => {
    planks(t, WOODS.dark_oak!.plank);
    t.rect(0, 0, 16, 4, hex(0x34343a));
    t.rect(4, 7, 8, 2, hex(0x8a8a8a));
  });
  r.add('smithing_table_bottom', (t) => planks(t, WOODS.dark_oak!.plank));
  r.add('stonecutter_top', (t) => {
    blotchy(t, STONE_PAL.slice(1, 4), 1, 0.5);
    t.rect(2, 7, 12, 2, hex(0x9a9a9a));
  });
  r.add('stonecutter_side', (t) => {
    planks(t, oak);
    t.rect(0, 0, 16, 9, STONE_PAL[2]!);
    frame(t, STONE_PAL[0]!);
  });
  r.add('stonecutter_bottom', (t) => planks(t, oak));
  r.add('cauldron_side', (t) => {
    blotchy(t, [hex(0x3a3a3a), hex(0x464646), hex(0x505050)], 1, 0.6);
    bevel(t, hex(0x5a5a5a), hex(0x2a2a2a));
    t.rect(4, 13, 8, 3, CLEAR as unknown as RGB, 0);
  });
  r.add('cauldron_top', (t) => {
    blotchy(t, [hex(0x3a3a3a), hex(0x464646), hex(0x505050)], 1, 0.6);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, CLEAR);
  });
  r.add('cauldron_inner', (t) => blotchy(t, [hex(0x2a2a2a), hex(0x343434)], 1, 0.6));
  r.add('composter_side', (t) => {
    planks(t, oak);
    t.rotate90();
    frame(t, oak[0]!);
  });
  r.add('composter_top', (t) => {
    planks(t, oak);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, CLEAR);
  });
  r.add('composter_bottom', (t) => planks(t, oak));
  r.add('jukebox_side', (t) => {
    planks(t, oak);
    frame(t, WOODS.dark_oak!.plank[2]!);
  });
  r.add('jukebox_top', (t) => {
    planks(t, oak);
    frame(t, WOODS.dark_oak!.plank[2]!);
    t.rect(4, 7, 8, 2, hex(0x1a1a1a));
  });
  r.add('note_block', (t) => {
    planks(t, WOODS.jungle!.plank);
    frame(t, WOODS.dark_oak!.plank[2]!);
    t.mask(['...aa', '...aaa', '...a.a', '...a..', '.aaa..', 'aaaa..', '.aa...'], { a: hex(0x2a1a0a) }, 5, 4);
  });
  r.add('lever', (t) => {
    t.clear();
    for (let y = 2; y < 12; y++) t.set(7, y, hex(0x6b5433));
    t.rect(7, 1, 2, 2, hex(0x3a3a3a));
  });
  r.add('spawner', (t) => {
    t.clear();
    frame(t, hex(0x2a3a4a));
    for (let i = 0; i < 16; i += 4) {
      for (let k = 0; k < 16; k++) {
        t.set(i, k, hex(0x1a2a3a));
        t.set(k, i, hex(0x1a2a3a));
      }
    }
    for (let i = 0; i < 16; i += 4) for (let k = 0; k < 16; k += 4) t.set(i + 1, k + 1, hex(0x4a6a8a));
  });
  r.add('bell', (t) => {
    t.clear();
    t.mask(['.....aaa......', '....abbba.....', '....abbba.....', '...abbbbba....', '...abbbbba....', '..abbbbbbba...', '..aaaaaaaaa...'], { a: hex(0xc8962a), b: hex(0xf0c040) }, 1, 5);
  });
  r.add('beacon', (t) => {
    t.fill(hex(0x8ae8e0));
    frame(t, hex(0x3aa8a0));
    t.rect(5, 5, 6, 6, hex(0xffffff));
  });
  r.add('respawn_anchor_side', (t) => {
    blotchy(t, [hex(0x14101c), hex(0x1c1628), hex(0x241c34)], 1, 0.8);
    frame(t, hex(0x3a2a5a));
    for (let i = 0; i < 6; i++) t.set(2 + t.rng.int(12), 2 + t.rng.int(12), hex(0x9a4af0));
  });
  r.add('respawn_anchor_top', (t) => {
    blotchy(t, [hex(0x14101c), hex(0x1c1628), hex(0x241c34)], 1, 0.8);
    t.rect(4, 4, 8, 8, hex(0x3a1a5a));
    frame(t, hex(0x6a3aa8), 3);
  });
  r.add('respawn_anchor_bottom', (t) => blotchy(t, [hex(0x14101c), hex(0x1c1628), hex(0x241c34)], 1, 0.8));
  r.add('lodestone_side', (t) => {
    stones(t, STONE_PAL, hex(0x4a4a4a), 6);
    t.rect(0, 5, 16, 2, hex(0x3a3a3a));
  });
  r.add('lodestone_top', (t) => {
    blotchy(t, STONE_PAL.slice(1, 4), 1, 0.5);
    frame(t, hex(0x3a3a3a));
    t.rect(6, 6, 4, 4, hex(0x8a8a8a));
  });
  r.add('cake_top', (t) => {
    blotchy(t, [hex(0xf0ece4), hex(0xf8f4ec), hex(0xffffff)], 1, 0.5);
    for (const [x, y] of [[3, 3], [9, 5], [5, 10], [11, 11]] as const) t.set(x, y, hex(0xd02a2a));
  });
  r.add('cake_side', (t) => {
    blotchy(t, [hex(0xc8904a), hex(0xd8a05a)], 1, 0.5);
    t.rect(0, 0, 16, 4, hex(0xf8f4ec));
    for (let x = 0; x < 16; x++) if (t.rng.chance(0.5)) t.set(x, 4, hex(0xf0ece4));
  });
  r.add('cake_bottom', (t) => blotchy(t, [hex(0xb8804a), hex(0xc8904a)], 1, 0.5));
  r.add('cake_inner', (t) => {
    blotchy(t, [hex(0xd8a06a), hex(0xe8b07a)], 1, 0.5);
    t.rect(0, 0, 16, 4, hex(0xf8f4ec));
    t.rect(0, 8, 16, 1, hex(0xd02a2a));
  });
  r.add('flower_pot', (t) => blotchy(t, [hex(0x7a3a24), hex(0x8a4a2e), hex(0x9a5234)], 1, 0.6));
  r.add('pumpkin_side', (t) => {
    blotchy(t, [hex(0xc06a0a), hex(0xd07a12), hex(0xe08a1a)], 1, 0.6);
    for (const x of [0, 5, 10, 15]) for (let y = 0; y < 16; y++) t.set(x, y, hex(0xa8580a));
  });
  r.add('pumpkin_top', (t) => {
    blotchy(t, [hex(0xc06a0a), hex(0xd07a12), hex(0xe08a1a)], 1, 0.6);
    t.rect(6, 6, 4, 4, hex(0x5a7a2a));
    t.rect(7, 7, 2, 2, hex(0x4a6a1a));
  });
  const face = (glow: boolean) => (t: Tex) => {
    blotchy(t, [hex(0xc06a0a), hex(0xd07a12), hex(0xe08a1a)], 1, 0.6);
    const c = glow ? hex(0xffe060) : hex(0x3a2008);
    t.rect(3, 4, 3, 3, c);
    t.rect(10, 4, 3, 3, c);
    t.rect(3, 10, 10, 2, c);
    t.rect(4, 12, 2, 1, c);
    t.rect(10, 12, 2, 1, c);
    t.set(7, 10, hex(0xd07a12));
  };
  r.add('carved_pumpkin', face(false));
  r.add('jack_o_lantern', face(true));
  r.add('melon_side', (t) => {
    blotchy(t, [hex(0x6a9a1a), hex(0x78a822), hex(0x86b62a)], 1, 0.6);
    for (const x of [1, 6, 11]) for (let y = 0; y < 16; y++) t.set(x + (y % 5 === 0 ? 1 : 0), y, hex(0x3a6a0a));
  });
  r.add('melon_top', (t) => {
    blotchy(t, [hex(0x6a9a1a), hex(0x78a822), hex(0x86b62a)], 1, 0.6);
    t.rect(7, 7, 2, 2, hex(0x5a4a1a));
  });
  r.add('hay_block_side', (t) => {
    streaksV(t, [hex(0x8a7a1a), hex(0xb8a030), hex(0xc8b03a), hex(0xd8c04a)]);
    for (const y of [3, 12]) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x8a2a1a));
  });
  r.add('hay_block_top', (t) => {
    blotchy(t, [hex(0xb8a030), hex(0xc8b03a), hex(0xd8c04a)], 1, 1);
    t.rect(7, 0, 2, 16, hex(0x8a2a1a));
  });
  r.add('dried_kelp_side', (t) => {
    blotchy(t, [hex(0x2a3a1a), hex(0x344a22), hex(0x3e5a2a)], 1, 0.8);
    for (const y of [3, 12]) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x1a2a0a));
  });
  r.add('dried_kelp_top', (t) => {
    blotchy(t, [hex(0x2a3a1a), hex(0x344a22), hex(0x3e5a2a)], 1, 0.8);
    frame(t, hex(0x1a2a0a));
  });
  r.add('barrier', (t) => {
    t.clear();
    for (let i = 2; i < 14; i++) {
      t.set(i, i, hex(0xe02020));
      t.set(i + 1, i, hex(0xe02020));
    }
    frame(t, hex(0xe02020), 1);
  });
  void bricks;
  void mix;
}

function streaksV(t: Tex, pal: RGB[]): void {
  for (let x = 0; x < 16; x++) {
    let k = 1 + t.rng.int(pal.length - 1);
    for (let y = 0; y < 16; y++) {
      if (t.rng.chance(0.3)) k = Math.max(1, Math.min(pal.length - 1, k + (t.rng.bool() ? 1 : -1)));
      t.set(x, y, pal[k]!);
    }
  }
}
