/** Nether, End, Farlands, ocean and deep-dark textures, plus destroy stages. */
import { Tex, type RGB, hex, shade, mix } from './canvas';
import { blotchy, bricks, voronoi, tiles, oreSpots, frame, bevel, stones } from './patterns';
import { NETHERRACK_PAL, STONE_PAL, SAND_PAL, stone, DIRT_PAL } from './blocksNatural';
import { glitchRows } from './blocksWood';
import type { PainterRegistry } from './registry';

function netherrack(t: Tex): Tex {
  blotchy(t, NETHERRACK_PAL, 1, 1.3);
  t.clumps(NETHERRACK_PAL[0]!, 8, 3);
  t.clumps(hex(0xa55a58), 4, 2);
  return t;
}

const FAR_STONE: RGB[] = [hex(0x3f4452), hex(0x4b5162), hex(0x575e70), hex(0x636a7d), hex(0x70778a)];
const GLITCH_COLS: RGB[] = [hex(0xff00ff), hex(0x00ffff), hex(0x000000), hex(0xffffff), hex(0x00ff40)];

function farstone(t: Tex): Tex {
  blotchy(t, FAR_STONE, 2, 1.1);
  // scanlines
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) if (t.rng.chance(0.6)) t.set(x, y, FAR_STONE[0]!);
  glitchRows(t, 3);
  return t;
}

/** Horizontal smear – the classic "stretched" far-lands look. */
function stretched(t: Tex, pal: RGB[]): Tex {
  for (let y = 0; y < 16; y++) {
    let k = t.rng.int(pal.length);
    for (let x = 0; x < 16; x++) {
      if (t.rng.chance(0.08)) k = t.rng.int(pal.length);
      t.set(x, y, pal[k]!);
    }
  }
  return t;
}

function soulSand(t: Tex): Tex {
  blotchy(t, [hex(0x3f2f24), hex(0x4f3b2d), hex(0x5a4535), hex(0x66503e)], 1, 1);
  for (let i = 0; i < 3; i++) {
    const x = 1 + t.rng.int(11);
    const y = 1 + t.rng.int(11);
    t.set(x, y, hex(0x2a1e16));
    t.set(x + 2, y, hex(0x2a1e16));
    t.rect(x, y + 2, 3, 1, hex(0x2a1e16));
  }
  return t;
}

function portalFrame(t: Tex, f: number, a: RGB, b: RGB, c: RGB, glitch: boolean): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const ang = Math.atan2(dy, dx);
      const r = Math.sqrt(dx * dx + dy * dy);
      const v = Math.sin(ang * 3 + r * 0.9 - (f / 32) * Math.PI * 2 * 2) * 0.5 + Math.sin(r * 1.3 + (f / 32) * Math.PI * 4) * 0.5;
      let col = v > 0.35 ? c : v > -0.2 ? b : a;
      if (glitch && t.rng.chance(0.06)) col = t.rng.pick(GLITCH_COLS);
      t.set(x, y, col, 200);
    }
  }
  if (glitch) {
    const c2 = t.copy();
    const y = (f * 5) % 16;
    for (let x = 0; x < 16; x++) t.set(x, y, c2.get(x + 4, y));
  }
}

export function registerDims(r: PainterRegistry): void {
  // Nether
  r.add('netherrack', (t) => netherrack(t));
  r.add('smoldering_netherrack', (t) => {
    netherrack(t);
    for (let i = 0; i < 5; i++) {
      let x = t.rng.int(16);
      let y = t.rng.int(16);
      for (let k = 0; k < 5; k++) {
        t.set(x & 15, y & 15, k % 2 ? hex(0xff8a1a) : hex(0xffc83a));
        x += t.rng.int(3) - 1;
        y += t.rng.int(3) - 1;
      }
    }
  });
  r.add('nether_gold_ore', (t) => {
    netherrack(t);
    oreSpots(t, hex(0xfcee4b), hex(0xae8a1c), 7, hex(0xf5d53b));
  });
  r.add('nether_quartz_ore', (t) => {
    netherrack(t);
    oreSpots(t, hex(0xf8f4ee), hex(0xb8aca0), 6, hex(0xe8e0d8));
  });
  r.add('cinder_ore', (t) => {
    netherrack(t);
    oreSpots(t, hex(0xffd060), hex(0x8a2a08), 5, hex(0xff7a1a));
  });
  r.add('ancient_debris_side', (t) => {
    blotchy(t, [hex(0x4a3630), hex(0x5a423a), hex(0x654b42), hex(0x70544a)], 1, 1);
    for (let y = 0; y < 16; y += 3) for (let x = 0; x < 16; x++) if (t.rng.chance(0.5)) t.set(x, y, hex(0x3a2a24));
    oreSpots(t, hex(0x9a7a6a), hex(0x2a1e1a), 3);
  });
  r.add('ancient_debris_top', (t) => {
    blotchy(t, [hex(0x4a3630), hex(0x5a423a), hex(0x654b42)], 1, 1);
    for (let i = 0; i < 4; i++) {
      const s = 2 + i * 3;
      frame(t, i % 2 ? hex(0x3a2a24) : hex(0x7a5a4a), 8 - s / 2 > 0 ? Math.floor(8 - s / 2) : 0);
    }
  });
  const nylium = (t: Tex, pal: RGB[]) => {
    blotchy(t, pal, 1, 1.2);
    t.speckle(shade(pal[pal.length - 1]!, 1.2), 0.05);
  };
  r.add('crimson_nylium', (t) => nylium(t, [hex(0x7a0f14), hex(0x8f1a1e), hex(0xa22228), hex(0xb42e30)]));
  r.add('warped_nylium', (t) => nylium(t, [hex(0x14604f), hex(0x1a7a64), hex(0x229078), hex(0x2aa88a)]));
  const nyliumSide = (t: Tex, pal: RGB[]) => {
    netherrack(t);
    for (let x = 0; x < 16; x++) {
      const d = 2 + t.rng.int(3);
      for (let y = 0; y < d; y++) t.set(x, y, pal[t.rng.int(pal.length)]!);
    }
  };
  r.add('crimson_nylium_side', (t) => nyliumSide(t, [hex(0x8f1a1e), hex(0xa22228), hex(0xb42e30)]));
  r.add('warped_nylium_side', (t) => nyliumSide(t, [hex(0x1a7a64), hex(0x229078), hex(0x2aa88a)]));
  r.add('soul_sand', (t) => soulSand(t));
  r.add('soul_soil', (t) => {
    blotchy(t, [hex(0x3a2c22), hex(0x46362a), hex(0x503e31), hex(0x5a4638)], 1, 1);
  });
  r.add('basalt_side', (t) => {
    for (let x = 0; x < 16; x++) {
      const base = [hex(0x404046), hex(0x4a4a50), hex(0x55555c), hex(0x5f5f66)][(x * 7 + 3) % 4]!;
      for (let y = 0; y < 16; y++) t.set(x, y, t.rng.chance(0.2) ? shade(base, 0.9) : base);
    }
    for (const x of [3, 8, 12]) for (let y = 0; y < 16; y++) t.set(x, y, hex(0x333338));
  });
  r.add('basalt_top', (t) => {
    stones(t, [hex(0x3a3a40), hex(0x444449), hex(0x4e4e54), hex(0x58585e), hex(0x62626a)], hex(0x2a2a2e), 5);
  });
  r.add('polished_basalt_side', (t) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) t.set(x, y, x % 4 === 0 ? hex(0x4a4a50) : hex(0x5f5f66));
  });
  r.add('polished_basalt_top', (t) => {
    blotchy(t, [hex(0x55555c), hex(0x5f5f66)], 1, 0.5);
    frame(t, hex(0x404046));
    frame(t, hex(0x4a4a50), 3);
  });
  r.add('smooth_basalt', (t) => blotchy(t, [hex(0x46464a), hex(0x4e4e53), hex(0x56565b)], 2, 0.8));
  const BLACK: RGB[] = [hex(0x1c181c), hex(0x252026), hex(0x2c2730), hex(0x352f38), hex(0x3e3842)];
  r.add('blackstone', (t) => {
    blotchy(t, BLACK, 1, 1.2);
    t.speckle(hex(0x5a525e), 0.04);
  });
  r.add('blackstone_top', (t) => {
    blotchy(t, BLACK, 2, 1);
  });
  r.add('polished_blackstone', (t) => {
    blotchy(t, BLACK.slice(1, 4), 2, 0.6);
    bevel(t, BLACK[4]!, BLACK[0]!);
  });
  r.add('polished_blackstone_bricks', (t) => bricks(t, BLACK, hex(0x121014), 8, 4, 4));
  r.add('cracked_polished_blackstone_bricks', (t) => {
    bricks(t, BLACK, hex(0x121014), 8, 4, 4);
    for (let i = 0; i < 3; i++) {
      let x = t.rng.int(16);
      for (let y = t.rng.int(8); y < 16; y++) {
        t.set(x & 15, y, hex(0x121014));
        x += t.rng.int(3) - 1;
      }
    }
  });
  r.add('chiseled_polished_blackstone', (t) => {
    blotchy(t, BLACK.slice(1, 4), 2, 0.6);
    bevel(t, BLACK[4]!, BLACK[0]!);
    frame(t, BLACK[0]!, 3);
    t.rect(6, 6, 4, 4, BLACK[4]!);
  });
  r.add('gilded_blackstone', (t) => {
    blotchy(t, BLACK, 1, 1.2);
    oreSpots(t, hex(0xfcee4b), hex(0xae8a1c), 6, hex(0xf5d53b));
  });
  r.add('magma_block', (t) => {
    const cols = [hex(0x5a1a08), hex(0x7a2a0a), hex(0xd0561a), hex(0xff9a2a)];
    voronoi(t, 9, (x, y, c) => {
      const e = c.d2 - c.d1;
      t.set(x, y, e < 0.7 ? cols[3]! : e < 1.3 ? cols[2]! : c.d1 < 2 ? cols[1]! : cols[0]!);
    });
  });
  const NB: RGB[] = [hex(0x1e0e10), hex(0x2c1418), hex(0x361a1e), hex(0x421f24), hex(0x4e252b)];
  r.add('nether_bricks', (t) => bricks(t, NB, hex(0x120809), 8, 4, 4));
  r.add('red_nether_bricks', (t) => bricks(t, [hex(0x3e0306), hex(0x4f060a), hex(0x5c0a0e), hex(0x690f13), hex(0x76151a)], hex(0x250104), 8, 4, 4));
  r.add('cracked_nether_bricks', (t) => {
    bricks(t, NB, hex(0x120809), 8, 4, 4);
    for (let i = 0; i < 3; i++) {
      let x = t.rng.int(16);
      for (let y = t.rng.int(8); y < 16; y++) {
        t.set(x & 15, y, hex(0x120809));
        x += t.rng.int(3) - 1;
      }
    }
  });
  r.add('chiseled_nether_bricks', (t) => {
    blotchy(t, NB.slice(1, 4), 1, 0.6);
    bevel(t, NB[4]!, NB[0]!);
    frame(t, NB[0]!, 3);
    t.rect(6, 6, 4, 4, NB[4]!);
  });
  r.add('nether_wart_block', (t) => blotchy(t, [hex(0x6a0a0a), hex(0x7e1010), hex(0x921818), hex(0xa82222)], 1, 1.2));
  r.add('warped_wart_block', (t) => blotchy(t, [hex(0x0e5e56), hex(0x137268), hex(0x18867a), hex(0x209a8c)], 1, 1.2));
  const Q: RGB[] = [hex(0xd8d0c6), hex(0xe2dbd2), hex(0xebe5dd), hex(0xf2ede6), hex(0xfaf7f2)];
  r.add('quartz_block_side', (t) => {
    blotchy(t, Q.slice(1, 4), 2, 0.5);
    bevel(t, Q[4]!, Q[0]!);
  });
  r.add('quartz_block_top', (t) => {
    blotchy(t, Q.slice(1, 4), 2, 0.5);
    bevel(t, Q[4]!, Q[0]!);
  });
  r.add('quartz_block_bottom', (t) => blotchy(t, Q.slice(1, 4), 2, 0.5));
  r.add('quartz_bricks', (t) => bricks(t, Q, hex(0xb8b0a6), 8, 4, 4));
  r.add('quartz_pillar', (t) => {
    blotchy(t, Q.slice(1, 4), 2, 0.5);
    for (let y = 0; y < 16; y++) {
      t.set(0, y, Q[0]!);
      t.set(15, y, Q[0]!);
      t.set(4, y, Q[1]!);
      t.set(11, y, Q[1]!);
    }
  });
  r.add('quartz_pillar_top', (t) => {
    blotchy(t, Q.slice(1, 4), 2, 0.5);
    frame(t, Q[0]!);
    frame(t, Q[1]!, 3);
  });
  r.anim('nether_portal', 32, 1, (t, f) => portalFrame(t, f, hex(0x3a0a7a), hex(0x6a1ad0), hex(0xb050ff), false));
  r.anim('far_portal', 32, 1, (t, f) => portalFrame(t, f, hex(0x083a3a), hex(0x10a8a0), hex(0xff40ff), true));

  // End
  const ES: RGB[] = [hex(0xc8c68a), hex(0xd4d296), hex(0xdcdba0), hex(0xe4e3ac), hex(0xecebb8)];
  r.add('end_stone', (t) => {
    blotchy(t, ES.slice(1, 5), 1, 0.9);
    for (let i = 0; i < 9; i++) {
      const x = t.rng.int(15);
      const y = t.rng.int(15);
      t.set(x, y, hex(0xa8a670));
      t.set(x + 1, y + 1, ES[4]!);
    }
  });
  r.add('end_stone_bricks', (t) => bricks(t, ES, hex(0xa8a670), 8, 4, 4));
  const PUR: RGB[] = [hex(0x7a5a7a), hex(0x8e6a8e), hex(0xa07ca0), hex(0xaa88aa), hex(0xb898b8)];
  r.add('purpur_block', (t) => tiles(t, PUR, 8));
  r.add('purpur_pillar', (t) => {
    blotchy(t, PUR.slice(1, 4), 1, 0.6);
    for (let y = 0; y < 16; y++) {
      t.set(0, y, PUR[0]!);
      t.set(15, y, PUR[0]!);
      t.set(7, y, PUR[4]!);
    }
  });
  r.add('purpur_pillar_top', (t) => {
    blotchy(t, PUR.slice(1, 4), 1, 0.6);
    frame(t, PUR[0]!);
    frame(t, PUR[4]!, 3);
  });
  r.add('chorus_plant', (t) => {
    blotchy(t, [hex(0x5a3a6a), hex(0x6a4a7a), hex(0x7a5a8a)], 1, 1);
    for (let i = 0; i < 8; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x9a7aaa));
  });
  r.add('chorus_flower', (t) => {
    blotchy(t, [hex(0x8a6a9a), hex(0xa07aaa), hex(0xb88ac0)], 1, 1);
    frame(t, hex(0x6a4a7a));
  });
  r.add('end_portal', (t) => {
    t.fill(hex(0x050810));
    for (let i = 0; i < 18; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.pick([hex(0x2a8a7a), hex(0x3ab0a0), hex(0x6ad8c8), hex(0x1a4a6a)]));
  });
  r.add('end_portal_frame_top', (t) => {
    blotchy(t, [hex(0x2a5a4a), hex(0x346a5a), hex(0x3e7a6a)], 1, 0.8);
    frame(t, ES[1]!, 0);
    frame(t, ES[0]!, 1);
    t.rect(4, 4, 8, 8, hex(0x1a3a30));
  });
  r.add('end_portal_frame_side', (t) => {
    t.fill(ES[2]!);
    blotchy(t, ES.slice(1, 4), 1, 0.8);
    t.rect(0, 0, 16, 3, hex(0x346a5a));
  });
  r.add('end_portal_frame_eye', (t) => {
    t.clear();
    t.rect(4, 4, 8, 8, hex(0x1a7a5a));
    t.rect(5, 5, 6, 6, hex(0x2aa87a));
    t.rect(6, 6, 4, 4, hex(0x102820));
    t.set(6, 6, hex(0x8af0c8));
  });
  r.add('dragon_egg', (t) => {
    blotchy(t, [hex(0x0c0610), hex(0x160c1c), hex(0x1e1226)], 1, 1);
    for (let i = 0; i < 10; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x5a2a7a));
  });
  r.add('void_crystal', (t) => {
    t.clear();
    for (const [x0, h, c] of [[4, 9, 0x6a3ad0], [7, 14, 0x8a5af0], [10, 10, 0x5a2ab0]] as const) {
      for (let y = 16 - h; y < 16; y++) {
        t.set(x0, y, hex(c));
        t.set(x0 + 1, y, shade(hex(c), 0.8));
      }
      t.set(x0, 16 - h, hex(0xe0c8ff));
    }
  });

  // Ocean / misc
  const PR: RGB[] = [hex(0x4a8a7a), hex(0x5aa090), hex(0x63ad9c), hex(0x72bca8), hex(0x86ccb8)];
  r.add('prismarine', (t) => {
    blotchy(t, PR, 2, 1.2);
  });
  r.add('prismarine_bricks', (t) => bricks(t, PR, hex(0x3a6a5a), 8, 4, 4));
  r.add('dark_prismarine', (t) => tiles(t, [hex(0x1e3a30), hex(0x2a4e40), hex(0x335a4a), hex(0x3c6654), hex(0x4a7862)], 8, 0, hex(0x14261e)));
  const CORAL: Record<string, number> = { tube: 0x3155d6, brain: 0xcf5a9e, bubble: 0xa51ea5, fire: 0xc72f2f, horn: 0xd8c23f };
  for (const [n, c] of Object.entries(CORAL)) {
    const base = hex(c);
    r.add(n + '_coral_block', (t) => {
      blotchy(t, [shade(base, 0.8), shade(base, 0.9), base, shade(base, 1.1)], 1, 1.2);
      t.speckle(shade(base, 1.3), 0.08);
    });
    r.add(n + '_coral', (t) => {
      t.clear();
      for (let i = 0; i < 5; i++) {
        let x = 3 + t.rng.int(10);
        for (let y = 15; y > 4 + t.rng.int(5); y--) {
          t.set(x, y, y % 3 ? base : shade(base, 1.2));
          if (t.rng.chance(0.35)) x += t.rng.bool() ? 1 : -1;
        }
      }
    });
  }

  // Sculk
  r.add('sculk', (t) => {
    blotchy(t, [hex(0x06141a), hex(0x0b1e26), hex(0x0f2a33), hex(0x133540)], 1, 1.2);
    for (let i = 0; i < 8; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x1ec8c8));
  });
  r.add('sculk_sensor_top', (t) => {
    blotchy(t, [hex(0x0b1e26), hex(0x0f2a33)], 1, 1);
    t.rect(3, 3, 10, 10, hex(0x1a4a5a));
  });
  r.add('sculk_sensor_side', (t) => {
    blotchy(t, [hex(0x0b1e26), hex(0x0f2a33)], 1, 1);
    t.rect(0, 0, 16, 8, hex(0x163c48));
  });
  r.add('sculk_sensor_bottom', (t) => blotchy(t, [hex(0x0b1e26), hex(0x0f2a33)], 1, 1));

  // Farlands
  r.add('farstone', (t) => farstone(t));
  r.add('farstone_bricks', (t) => {
    bricks(t, FAR_STONE, hex(0x2a2e38), 8, 4, 4);
    glitchRows(t, 2);
  });
  r.add('corrupted_stone', (t) => {
    stone(t);
    for (let i = 0; i < 4; i++) {
      const x = t.rng.int(13);
      const y = t.rng.int(13);
      const c = t.rng.pick(GLITCH_COLS);
      t.rect(x, y, 1 + t.rng.int(3), 1 + t.rng.int(3), c);
    }
    glitchRows(t, 4);
  });
  r.add('glitch_block', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? hex(0x1a001a) : hex(0xd000d0));
    for (let i = 0; i < 10; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.pick(GLITCH_COLS));
    glitchRows(t, 3);
  });
  r.add('missing_block', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, ((x >> 3) + (y >> 3)) % 2 ? hex(0x000000) : hex(0xf800f8));
  });
  r.anim('static_block', 8, 2, (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = 40 + t.rng.int(200);
      t.set(x, y, [v, v, v]);
    }
  });
  r.add('overflow_stone', (t) => stretched(t, STONE_PAL));
  r.add('stretched_sand', (t) => stretched(t, SAND_PAL));
  r.add('far_dirt', (t) => {
    blotchy(t, DIRT_PAL.map((c) => mix(c, hex(0x4a3a5a), 0.35)), 1, 1);
    glitchRows(t, 2);
  });
  r.add('far_grass_block_top', (t) => {
    blotchy(t, [hex(0x2f7a6a), hex(0x3a8f7c), hex(0x46a08c), hex(0x52b09a), hex(0x60c0a8)], 1, 1.2);
    for (let i = 0; i < 4; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xd24fd0));
    glitchRows(t, 2);
  });
  r.add('far_grass_block_side', (t) => {
    blotchy(t, DIRT_PAL.map((c) => mix(c, hex(0x4a3a5a), 0.35)), 1, 1);
    for (let x = 0; x < 16; x++) {
      const d = 2 + t.rng.int(3);
      for (let y = 0; y < d; y++) t.set(x, y, [hex(0x3a8f7c), hex(0x46a08c), hex(0x52b09a)][t.rng.int(3)]!);
    }
    glitchRows(t, 3);
  });
  r.add('glitch_ore', (t) => {
    farstone(t);
    oreSpots(t, hex(0xff80ff), hex(0x400040), 5, hex(0xff00ff));
    for (let i = 0; i < 4; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x00ffff));
  });
  r.add('null_ore', (t) => {
    farstone(t);
    for (let i = 0; i < 4; i++) {
      const x = 1 + t.rng.int(12);
      const y = 1 + t.rng.int(12);
      t.rect(x, y, 3, 3, hex(0x000000));
      t.set(x, y, hex(0xffffff));
    }
  });
  r.add('fractal_glass', (t) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const on = (x & y) === 0;
        t.set(x, y, on ? hex(0xb0f0ff) : hex(0x6a40c0), on ? 200 : 110);
      }
    }
  });
  r.add('echo_lamp', (t) => {
    blotchy(t, [hex(0x6af0e8), hex(0x9af8f0), hex(0xd0fffa)], 1, 1);
    frame(t, hex(0x2a8a8a));
    frame(t, hex(0x3ab0b0), 1);
  });
  r.add('far_portal_frame', (t) => {
    const pal = [hex(0x1a1a1a), hex(0x2e2e2e), hex(0x474747), hex(0x6a6a6a), hex(0x8a8a8a)];
    blotchy(t, pal, 1, 1.6);
    for (let i = 0; i < 4; i++) {
      let x = t.rng.int(16);
      let y = t.rng.int(16);
      for (let k = 0; k < 6; k++) {
        t.set(x & 15, y & 15, k % 2 ? hex(0xff00ff) : hex(0x00ffff));
        x += t.rng.int(3) - 1;
        y += 1;
      }
    }
  });
  r.add('data_crystal', (t) => {
    t.clear();
    for (const [x0, h] of [[4, 9], [7, 14], [10, 10]] as const) {
      for (let y = 16 - h; y < 16; y++) {
        t.set(x0, y, (y + x0) % 3 === 0 ? hex(0xd0ffd0) : hex(0x20e060));
        t.set(x0 + 1, y, hex(0x10a040));
      }
    }
  });
  r.add('glitched_block', (t) => {
    const pal = [hex(0x401060), hex(0x6020a0), hex(0x8040e0), hex(0x20c0c0), hex(0xff40ff)];
    blotchy(t, pal, 1, 1.4);
    bevel(t, hex(0xff80ff), hex(0x200030));
    glitchRows(t, 3);
  });

  // Destroy stages (crack overlays)
  for (let s = 0; s < 10; s++) {
    r.add('destroy_stage_' + s, (t) => {
      t.clear();
      const rng = t.rng;
      const branches = 2 + s * 2;
      const len = 3 + s;
      for (let b = 0; b < branches; b++) {
        let x = 7 + rng.int(3) - 1;
        let y = 7 + rng.int(3) - 1;
        const dx = rng.int(3) - 1 || 1;
        const dy = rng.int(3) - 1;
        for (let k = 0; k < len; k++) {
          t.set(((x % 16) + 16) % 16, ((y % 16) + 16) % 16, [0, 0, 0, 160]);
          if (rng.chance(0.6)) x += dx;
          if (rng.chance(0.6)) y += dy || (rng.bool() ? 1 : -1);
        }
      }
    });
  }
  void frame;
}
