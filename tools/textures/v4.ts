/**
 * V4 - The World Update: textures for the biome plants and materials, the
 * bunker machinery, the Error Biome's blocks and the new items.
 */
import { Tex, type RGB, type RGBA, hex, shade, mix, TINT_ALPHA } from './canvas';
import { blotchy, bricks } from './patterns';
import type { PainterRegistry } from './registry';

const STEM = hex(0x3f7a24);
const STEM_D = hex(0x2d5a17);

/** A flower head over a thin stem with two leaves (sprite on a transparent tile). */
function flower(t: Tex, head: string[], pal: Record<string, RGB>, stemTop: number, stem = STEM, stemD = STEM_D): void {
  t.clear();
  for (let y = stemTop; y < 16; y++) t.set(7, y, stem);
  t.set(6, 13, stemD);
  t.set(5, 12, stemD);
  t.set(8, 12, stem);
  t.set(9, 11, stem);
  t.set(10, 11, stemD);
  t.mask(head, pal, 0, 0);
}

/** Thin blades rising from the bottom edge. */
function blades(t: Tex, count: number, minH: number, maxH: number, low: RGB, high: RGB, tipChance = 0, tip: RGB = high): void {
  t.clear();
  for (let i = 0; i < count; i++) {
    let x = 1 + t.rng.int(14);
    const h = minH + t.rng.int(maxH - minH + 1);
    for (let y = 15; y > 15 - h; y--) {
      t.set(x, y, mix(low, high, (15 - y) / h));
      if (t.rng.chance(0.18)) x = Math.max(0, Math.min(15, x + (t.rng.bool() ? 1 : -1)));
    }
    if (tipChance && t.rng.chance(tipChance)) t.set(x, 15 - h, tip);
  }
}

/** A round berry bush with berries dotted over it. */
function bush(t: Tex, leaf: RGB[], berry: RGB, berryHi: RGB): void {
  t.clear();
  for (let y = 4; y < 16; y++)
    for (let x = 1; x < 15; x++) {
      const dx = (x - 7.5) / 7;
      const dy = (y - 10) / 6;
      if (dx * dx + dy * dy > 1 || t.rng.chance(0.12)) continue;
      t.set(x, y, leaf[t.rng.int(leaf.length)]!);
    }
  for (let i = 0; i < 9; i++) {
    const x = 2 + t.rng.int(12);
    const y = 5 + t.rng.int(9);
    if (t.alpha(x, y) === 0) continue;
    t.set(x, y, berry);
    if (t.rng.chance(0.5)) t.set(x, y - 1 < 4 ? y : y - 1, berryHi);
  }
}

const GLITCH: RGB[] = [hex(0xff00ff), hex(0x00ffff), hex(0x000000), hex(0xffffff), hex(0x9a3cff)];

export function registerV4Blocks(r: PainterRegistry): void {
  // --- Desert and badlands ---------------------------------------------------
  r.add('desert_marigold', (t) =>
    flower(t, ['', '', '', '', '.....a.a.......', '....abcba......', '...abcdcba.....', '....abcba......', '.....a.a.......'], { a: hex(0xe8801a), b: hex(0xf5a623), c: hex(0xffd04a), d: hex(0x7a3a0a) }, 9, hex(0x6a8a3a), hex(0x4a6a2a)),
  );
  r.add('desert_scrub', (t) => {
    t.clear();
    const twig = [hex(0x8a6a3a), hex(0x6b4f2a), hex(0xa0804a)];
    for (let i = 0; i < 7; i++) {
      let x = 5 + t.rng.int(6);
      let y = 15;
      const dx = t.rng.int(3) - 1;
      for (let k = 0; k < 6 + t.rng.int(7); k++) {
        t.set(x, y, twig[k % 3]!);
        y--;
        if (t.rng.chance(0.45)) x = Math.max(0, Math.min(15, x + dx + (t.rng.chance(0.2) ? (t.rng.bool() ? 1 : -1) : 0)));
      }
      if (t.rng.chance(0.6)) t.set(x, y, hex(0x9aa05a));
    }
  });
  r.add('cactus_flower', (t) => {
    t.clear();
    // Bloom painted in the lower half (the model shows the bottom half of the tile)
    t.mask(['', '', '', '', '', '', '', '', '', '.....a..a.......', '....abaaba......', '...abccccba.....', '....abccba......', '...aabddbaa.....', '....abbbba......', '.....gGGg.......'], {
      a: hex(0xd8305a),
      b: hex(0xf0608a),
      c: hex(0xffb0c8),
      d: hex(0xffe060),
      g: hex(0x2a8a3a),
      G: hex(0x1a6a2a),
    });
  });
  r.add('aloe_vera', (t) => {
    t.clear();
    const leafs: [number, number, number][] = [
      [7, -1, 11],
      [8, 1, 11],
      [6, -2, 8],
      [9, 2, 8],
      [7, 0, 13],
      [5, -3, 5],
      [10, 3, 5],
    ];
    for (const [x0, lean, h] of leafs) {
      for (let k = 0; k < h; k++) {
        const x = Math.round(x0 + (lean * k) / h);
        const y = 15 - k;
        const c = k < 2 ? hex(0x4a7a4a) : k > h - 3 ? hex(0x9ad09a) : hex(0x6aa86a);
        t.set(x, y, c);
        if (k % 3 === 1) t.set(x + (lean >= 0 ? 1 : -1), y, hex(0xd8f0c0));
      }
    }
  });
  const urnSide = (t: Tex): void => {
    blotchy(t, [hex(0xa05a2a), hex(0xb0683a), hex(0xbe7446), hex(0xc88050)], 1, 0.6);
    // Painted bands and glyphs
    for (let x = 0; x < 16; x++) {
      t.set(x, 3, hex(0x3a2210));
      t.set(x, 10, hex(0x3a2210));
    }
    for (let x = 1; x < 16; x += 4) {
      t.set(x, 5, hex(0xe8c878));
      t.set(x + 1, 6, hex(0xe8c878));
      t.set(x, 7, hex(0xe8c878));
      t.set(x + 2, 8, hex(0x2a6a7a));
    }
    for (let x = 0; x < 16; x++) t.set(x, 15, hex(0x6a3a1a));
  };
  r.add('ancient_urn', urnSide);
  r.add('ancient_urn_top', (t) => {
    t.fill(hex(0xb0683a));
    t.rect(4, 4, 8, 8, hex(0x2a160a));
    t.rect(5, 5, 6, 6, hex(0x160a04));
  });

  // --- Forests ---------------------------------------------------------------
  r.add('leaf_litter', (t) => {
    t.clear();
    const cols = [hex(0xa85a1a), hex(0xc8782a), hex(0x8a4a1a), hex(0xd8a040), hex(0x6a7a2a), hex(0x9a3a1a)];
    for (let i = 0; i < 26; i++) {
      const x = t.rng.int(15);
      const y = t.rng.int(15);
      const c = t.rng.pick(cols);
      t.set(x, y, c);
      t.set(x + 1, y, shade(c, 0.85));
      if (t.rng.chance(0.6)) t.set(x, y + 1, shade(c, 1.1));
    }
  });
  const fungus = (t: Tex, top: boolean): void => {
    blotchy(t, [hex(0x8a5a2a), hex(0x9a6a36), hex(0xaa7a42), hex(0xc0904e)], 1, 0.7);
    if (top) {
      for (let r0 = 2; r0 < 16; r0 += 4) for (let x = 0; x < 16; x++) t.set(x, r0, hex(0xd8b070));
    } else {
      for (let x = 0; x < 16; x++) {
        t.set(x, 0, hex(0xe8c888));
        t.set(x, 15, hex(0x5a3a1a));
      }
    }
  };
  r.add('bracket_fungus', (t) => fungus(t, false));
  r.add('bracket_fungus_top', (t) => fungus(t, true));
  r.add('shadowcap', (t) => {
    t.clear();
    t.mask(['', '', '', '', '', '', '....aaaaaa......', '...abcbbcba.....', '..abbbcbbbba....', '..aaaaaaaaaa....', '.......d........', '......dd........', '......d.........', '......d.........', '.....ddd........'], {
      a: hex(0x3a1a5a),
      b: hex(0x6a2a9a),
      c: hex(0xd070ff),
      d: hex(0x9a8aa8),
    });
  });

  // --- Snow and mountains ----------------------------------------------------
  r.add('frostbloom', (t) =>
    flower(t, ['', '', '', '....a...a.......', '...aba.aba......', '....abcba.......', '...ab.c.ba......', '....a.b.a.......', '......a.........'], { a: hex(0x9ad8ff), b: hex(0xd8f4ff), c: hex(0xffffff) }, 8, hex(0x4a8a8a), hex(0x2a6a6a)),
  );
  r.add('snowberry_bush', (t) => bush(t, [hex(0x2a5a4a), hex(0x3a6a5a), hex(0x4a7a6a), hex(0xd8e8e8)], hex(0xf4f8ff), hex(0xc8d8ff)));
  r.add('frosted_stone_bricks', (t) => {
    bricks(t, [hex(0x7a8a98), hex(0x8898a8), hex(0x98a8b8), hex(0xa8b8c8)], hex(0x5a6a78), 8, 8, 8, hex(0xc8d8e8));
    // Frost creeping in from the top and the mortar lines
    for (let x = 0; x < 16; x++) {
      const d = 1 + t.rng.int(3);
      for (let y = 0; y < d; y++) t.set(x, y, mix(hex(0xe8f4ff), hex(0xc8e0f8), y / d));
    }
    t.speckle(hex(0xf0f8ff), 0.06);
  });
  r.add('edelweiss', (t) =>
    flower(t, ['', '', '', '', '....a.a.a......', '.....aba.......', '...aabcbaa.....', '.....aba.......', '....a.a.a......'], { a: hex(0xf4f4ec), b: hex(0xd8d8c8), c: hex(0xe8d040) }, 8, hex(0x6a8a6a), hex(0x4a6a4a)),
  );

  // --- Jungle ------------------------------------------------------------------
  r.add('jungle_orchid', (t) =>
    flower(t, ['', '', '...aa...aa......', '..abba.abba.....', '...abbcbba......', '....abdba.......', '...abbcbba......', '..aba...aba.....', '...a.....a......'], { a: hex(0x9a2a8a), b: hex(0xe060d0), c: hex(0xffd0f8), d: hex(0xffe060) }, 9),
  );
  r.add('hanging_moss', (t) => {
    t.clear();
    for (let i = 0; i < 10; i++) {
      let x = 1 + t.rng.int(14);
      const len = 8 + t.rng.int(8);
      for (let y = 0; y < len; y++) {
        t.set(x, y, mix(hex(0x5a7a4a), hex(0x8aa87a), y / len));
        if (t.rng.chance(0.15)) x = Math.max(0, Math.min(15, x + (t.rng.bool() ? 1 : -1)));
      }
    }
  });

  // --- Swamps ------------------------------------------------------------------
  r.add('cattail_bottom', (t) => blades(t, 9, 14, 16, hex(0x3a6a2a), hex(0x6a9a3a)));
  r.add('cattail_top', (t) => {
    blades(t, 6, 5, 12, hex(0x6a9a3a), hex(0x8ab84a));
    for (const x of [5, 10]) {
      for (let y = 3; y < 10; y++) {
        t.set(x, y, y === 3 ? hex(0x5a3a1a) : hex(0x7a4a22));
        t.set(x + 1, y, hex(0x5a3416));
      }
      t.set(x, 1, hex(0x8ab84a));
      t.set(x, 2, hex(0x8ab84a));
      for (let y = 10; y < 16; y++) t.set(x, y, hex(0x5a8a3a));
    }
  });
  r.add('marsh_glowcap', (t) => {
    t.clear();
    t.mask(['', '', '', '', '', '', '', '', '......aa........', '.....abba.......', '.....aaaa.......', '..aa...c........', '.abba..c..aa....', '.aaaa..c.abba...', '...c...c.aaaa...', '...c...c...c....'], {
      a: hex(0x3a9a6a),
      b: hex(0xa0ffd0),
      c: hex(0xc8d0b8),
    });
  });
  r.add('peat', (t) => {
    blotchy(t, [hex(0x2a1e14), hex(0x3a2a1c), hex(0x4a3624), hex(0x56402a)], 1, 0.9);
    for (let i = 0; i < 7; i++) {
      const x = t.rng.int(14);
      const y = t.rng.int(16);
      t.set(x, y, hex(0x6a5a2a));
      t.set(x + 1, y, hex(0x5a4a22));
    }
  });

  // --- Plains, taiga, savanna, beaches, cherry groves ----------------------------
  r.add('clover', (t) => {
    t.clear();
    for (let i = 0; i < 22; i++) {
      const x = 1 + t.rng.int(14);
      const y = 1 + t.rng.int(14);
      const g = 0x90 + t.rng.int(40);
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [1, 0],
      ] as const)
        t.set(x + dx, y + dy, [g, g, g, TINT_ALPHA] as RGBA);
      if (t.rng.chance(0.15)) t.set(x, y, hex(0xf0f0f0));
    }
  });
  r.add('buttercup', (t) =>
    flower(t, ['', '', '', '', '', '.....aaa.......', '....abcba......', '....acdca......', '....abcba......', '.....aaa.......'], { a: hex(0xe0b800), b: hex(0xffe030), c: hex(0xfff080), d: hex(0xc08a00) }, 10),
  );
  r.add('lingonberry_bush', (t) => bush(t, [hex(0x1e4a1e), hex(0x2a5a24), hex(0x366a2c), hex(0x427a34)], hex(0xc81a2a), hex(0xf04a4a)));
  r.add('termite_mound', (t) => {
    blotchy(t, [hex(0x8a5028), hex(0x9a5c30), hex(0xaa683a), hex(0xba7644)], 2, 0.9);
    for (let i = 0; i < 6; i++) {
      const x = t.rng.int(15);
      const y = t.rng.int(15);
      t.set(x, y, hex(0x3a2010));
      t.set(x + 1, y + 1, hex(0x5a3018));
    }
    for (let y = 0; y < 16; y += 5) for (let x = 0; x < 16; x++) if (t.rng.chance(0.4)) t.set(x, y, hex(0xc88a50));
  });
  r.add('beach_grass', (t) => blades(t, 12, 5, 13, hex(0x8a9a5a), hex(0xc8c890), 0.4, hex(0xe0d8a0)));
  r.add('seashell', (t) => {
    t.fill(hex(0xf0d8c8));
    for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) t.set(x, y, hex(0xd8a890));
    for (let x = 0; x < 16; x++) t.set(x, 15, hex(0xc08870));
  });
  r.add('cherry_petals', (t) => {
    t.clear();
    const cols = [hex(0xf8b8d0), hex(0xf0a0c0), hex(0xffd0e0), hex(0xe888b0)];
    for (let i = 0; i < 30; i++) {
      const x = t.rng.int(15);
      const y = t.rng.int(15);
      const c = t.rng.pick(cols);
      t.set(x, y, c);
      if (t.rng.chance(0.5)) t.set(x + 1, y, shade(c, 0.92));
    }
    for (let i = 0; i < 4; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x4a8a2a));
  });

  // --- Bunkers -------------------------------------------------------------------
  const panel = (t: Tex): void => {
    blotchy(t, [hex(0x4a504a), hex(0x545a54), hex(0x5e645e)], 1, 0.4);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, hex(0x7a807a));
      t.set(0, i, hex(0x7a807a));
      t.set(i, 15, hex(0x2a2e2a));
      t.set(15, i, hex(0x2a2e2a));
    }
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ] as const)
      t.set(x, y, hex(0x9aa09a));
  };
  r.add('bunker_panel', panel);
  r.add('bunker_plating', (t) => {
    panel(t);
    for (let x = 0; x < 16; x++) t.set(x, 7, hex(0x3a3e3a));
    for (let y = 0; y < 16; y++) t.set(7, y, hex(0x3a3e3a));
    t.speckle(hex(0x6a4a2a), 0.04);
  });
  r.add('bunker_blast_door', (t) => {
    t.fill(hex(0x5a5e5a));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (((x + y) & 7) < 3) t.set(x, y, (x + y) & 8 ? hex(0xd8b020) : hex(0x1a1a1a));
    t.rect(3, 3, 10, 10, hex(0x6a6e6a));
    t.rect(4, 4, 8, 8, hex(0x4a4e4a));
    t.rect(7, 4, 2, 8, hex(0x2a2e2a));
  });
  const screen = (t: Tex, lit: boolean, generator: boolean): void => {
    panel(t);
    if (generator) {
      // Gauge and a big switch
      t.rect(3, 3, 10, 5, hex(0x1a1c1a));
      for (let x = 4; x < 12; x++) t.set(x, 6, lit ? hex(0x30ff60) : hex(0x5a1a1a));
      t.set(lit ? 11 : 4, 4, hex(0xf0f0f0));
      t.set(lit ? 10 : 5, 5, hex(0xf0f0f0));
      t.rect(6, 9, 4, 5, hex(0x2a2a2a));
      t.rect(7, lit ? 9 : 11, 2, 3, lit ? hex(0x30c050) : hex(0xc03030));
    } else {
      t.rect(4, 3, 8, 5, hex(0x0a140a));
      t.rect(5, 4, 6, 3, lit ? hex(0x30e060) : hex(0xe03030));
      t.rect(4, 9, 8, 1, hex(0x1a1a1a));
      t.rect(5, 11, 6, 3, hex(0x2a2e2a));
      t.rect(6, 12, 4, 1, hex(0x0a0a0a));
    }
  };
  r.add('keycard_reader', (t) => screen(t, false, false));
  r.add('keycard_reader_on', (t) => screen(t, true, false));
  r.add('bunker_generator', (t) => screen(t, false, true));
  r.add('bunker_generator_on', (t) => screen(t, true, true));
  r.add('bunker_generator_top', (t) => {
    panel(t);
    for (let y = 3; y < 13; y += 2) t.rect(3, y, 10, 1, hex(0x1a1c1a));
  });

  // --- The Error Biome -------------------------------------------------------------
  // An unloaded chunk: black and purple, torn by scanlines that crawl
  r.anim('error_block', 6, 3, (t, f) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const checker = ((x >> 2) + (y >> 2)) & 1;
        t.set(x, y, checker ? hex(0x05000a) : hex(0x6a00d8));
      }
    const row = (f * 5) % 16;
    for (let x = 0; x < 16; x++) {
      t.set(x, row, t.rng.chance(0.5) ? hex(0x000000) : hex(0xb050ff));
      if (t.rng.chance(0.3)) t.set(x, (row + 7) % 16, hex(0x1a0030));
    }
    // A torn band shifted sideways
    const band = (f * 3 + 5) % 16;
    const shift = 1 + (f % 3);
    const copy: RGBA[] = [];
    for (let x = 0; x < 16; x++) copy.push(t.get(x, band));
    for (let x = 0; x < 16; x++) t.set((x + shift) % 16, band, copy[x]!);
    for (let i = 0; i < 4; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.pick(GLITCH));
  });
  r.anim('glitch_firewall', 4, 3, (t, f) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const lattice = (x + f) % 4 === 0 || (y + f * 2) % 4 === 0;
        t.set(x, y, lattice ? hex(0xff30ff) : hex(0x6a00c8), lattice ? 220 : 110);
      }
    for (let i = 0; i < 6; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xffffff), 230);
  });

  // --- Temple trials (generator 5) -----------------------------------------------------
  // An altar of old carved stone: a sun glyph that glows gold once it is awakened
  const altar = (t: Tex, lit: boolean): void => {
    t.fill(hex(0x7a7468));
    t.speckle(hex(0x6a645a), 0.3);
    t.speckle(hex(0x8a8476), 0.15);
    t.rect(0, 0, 16, 2, hex(0x5a554c));
    t.rect(0, 14, 16, 2, hex(0x5a554c));
    t.rect(1, 1, 14, 1, hex(0x9a927e));
    t.rect(2, 3, 12, 10, hex(0x4a453e));
    const glyph = lit ? hex(0xffd84a) : hex(0x2e2a24);
    const rim = lit ? hex(0xff9a1a) : hex(0x3a362f);
    for (let y = 4; y < 12; y++)
      for (let x = 3; x < 13; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d < 2.2) t.set(x, y, glyph);
        else if (d < 3 && !lit) t.set(x, y, rim);
        else if (d < 3) t.set(x, y, rim);
      }
    for (const [x, y] of [
      [7, 3],
      [8, 3],
      [7, 12],
      [8, 12],
      [3, 7],
      [3, 8],
      [12, 7],
      [12, 8],
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
    ] as const)
      t.set(x, y, lit ? hex(0xffc030) : hex(0x35312a));
  };
  r.add('temple_altar', (t) => altar(t, false));
  r.add('temple_altar_lit', (t) => altar(t, true));
  // A seal: a slab of carved stone with a glowing lock rune, bound in bronze
  r.add('temple_seal', (t) => {
    t.fill(hex(0x8a6d3b));
    t.speckle(hex(0x7a5d2f), 0.3);
    t.speckle(hex(0x9a7d4b), 0.15);
    t.rect(0, 0, 16, 1, hex(0x5a4420));
    t.rect(0, 15, 16, 1, hex(0x5a4420));
    t.rect(0, 0, 1, 16, hex(0x5a4420));
    t.rect(15, 0, 1, 16, hex(0x5a4420));
    t.rect(2, 2, 12, 12, hex(0x6a5028));
    t.rect(3, 3, 10, 10, hex(0x4a3818));
    t.rect(7, 4, 2, 8, hex(0x40e0d0));
    t.rect(4, 7, 8, 2, hex(0x40e0d0));
    t.set(7, 7, hex(0xc0fff8));
    t.set(8, 8, hex(0xc0fff8));
    for (const [x, y] of [
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
    ] as const)
      t.set(x, y, hex(0xd8a040));
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
function sprite(t: Tex, rows: string[], pal: Record<string, RGB>): void {
  t.clear();
  t.mask(rows, pal);
}

export function registerV4Items(r: PainterRegistry): void {
  r.add('cactus_fruit', (t) =>
    sprite(
      t,
      ['', '', '', '.......gg.......', '......gGg.......', '.....oooo.......', '....obbcco......', '...obbbccdo.....', '...obabbbco.....', '...obbbabbo.....', '...oabbbbbo.....', '....oabbbo......', '.....oooo.......'],
      { o: hex(0x5a0a2a), a: hex(0x8a1a4a), b: hex(0xc8306a), c: hex(0xe8608a), d: hex(0xffb0c8), g: hex(0x3a9a3a), G: hex(0x2a7a2a) },
    ),
  );
  const berries = (n: string, c: number, leaf: number, outline = shade(hex(c), 0.5)): void =>
    r.add(n, (t) =>
      sprite(t, ['', '', '........g.......', '.......gG.......', '......g..g......', '.....oo..oo.....', '....ocbooccbo...', '....obboocbbo...', '.....oo.obbo....', '....ocbo.oo.....', '....obbo........', '.....oo.........'], {
        o: outline,
        b: hex(c),
        c: shade(hex(c), 1.25),
        g: hex(leaf),
        G: shade(hex(leaf), 0.75),
      }),
    );
  berries('snowberries', 0xe8f0ff, 0x3a6a5a, hex(0x5a6a8a));
  berries('lingonberries', 0xd0202a, 0x2a5a24);
  r.add('aloe_leaf', (t) =>
    sprite(t, ['', '............oo..', '...........obo..', '..........obco..', '.........obco...', '........obco....', '.......obco.....', '......obbo......', '.....obco.......', '....obco........', '...obbo.........', '..obbo..........', '..obo...........', '..oo............'], {
      o: hex(0x2a4a2a),
      b: hex(0x6aa86a),
      c: hex(0xc8f0b0),
    }),
  );
  r.add('bunker_keycard', (t) =>
    sprite(
      t,
      ['', '', '', '..oooooooooooo..', '..obbbbbbbbbbo..', '..obyybbbbbbbo..', '..obyybddddbbo..', '..obbbbbbbbbbo..', '..obccccccccbo..', '..obbbbbbbbbbo..', '..oaaaaaaaaaao..', '..oooooooooooo..'],
      { o: hex(0x1a1e1a), a: hex(0x3a3e3a), b: hex(0x5a6a5a), c: hex(0x202420), d: hex(0xd8d8d8), y: hex(0xe8c020) },
    ),
  );
  // A golden idol with turquoise eyes
  r.add('temple_relic', (t) =>
    sprite(
      t,
      ['', '......oooo......', '.....obbbbo.....', '....obtbbtbo....', '....obbbbbbo....', '....obcbbcbo....', '.....obbbbo.....', '...ooobccbooo...', '..obbbbbbbbbbo..', '..obcbbbbbbcbo..', '...oobbbbbboo...', '....obbccbbo....', '....obbbbbbo....', '...oddddddddo...', '...oooooooooo...'],
      { o: hex(0x5a3a0a), b: hex(0xe8b020), c: hex(0xfff0a0), t: hex(0x30d8c8), d: hex(0x8a6a2a) },
    ),
  );
}
