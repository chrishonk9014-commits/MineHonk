/**
 * V6 - The End Expansion, phase 5: textures for the events (Void Storm
 * remnants, the End Eclipse's shards and monoliths, the crumbling edge the
 * Dragon leaves), the Void Citadel and the End Guardian's arena, and the
 * phase's items.
 *
 * Citadel Stone is the darkest stone in the game: blue-violet, cut in long
 * courses and trimmed with pale gold. Its lights are cold white-violet.
 */
import { Tex, type RGB, hex, mix, shade } from './canvas';
import { bevel, blotchy, bricks, frame, tiles } from './patterns';
import type { PainterRegistry } from './registry';
import { CITADEL_GLYPHS } from '../../src/common/endExpansion/glyphs';

type Pal = Record<string, RGB>;

const CSTONE: RGB[] = [hex(0x26203a), hex(0x2c2542), hex(0x322a4a), hex(0x383052)];
const CMORTAR = hex(0x16121f);
const GOLD = hex(0xc8b070);
const GOLD_DARK = hex(0x8a7a4a);
const LIGHT = hex(0xe8e0ff);
const VIOLET = hex(0xb08aff);
const REMNANT: RGB[] = [hex(0x5a5068), hex(0x625872), hex(0x6a607a), hex(0x564c62)];
const END_STONE: RGB[] = [hex(0xdcdba0), hex(0xd2d196), hex(0xe6e5ac), hex(0xc8c78c)];
const OBSIDIAN: RGB[] = [hex(0x0e0a18), hex(0x140f22), hex(0x1a1430), hex(0x100c1c)];

function citadelStone(t: Tex): void {
  blotchy(t, CSTONE, 1, 0.5);
  for (let x = 0; x < 16; x++) t.set(x, 15, shade(CSTONE[0]!, 0.75));
}

function glyphOn(t: Tex, g: number, ink: RGB, glow: RGB): void {
  const art = CITADEL_GLYPHS[g % CITADEL_GLYPHS.length]!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const ch = art[y]![x];
      if (ch === '#') t.set(4 + x, 4 + y, ink);
      else if (ch === 'o') t.set(4 + x, 4 + y, glow);
    }
}

/** A machine face in Citadel Stone: a recessed panel, a gold rim and a lamp (dark, lit or red). */
function citadelMachine(t: Tex, lamp: 'off' | 'on' | 'err', mark: (t: Tex, c: RGB) => void): void {
  citadelStone(t);
  frame(t, GOLD_DARK);
  t.rect(3, 3, 10, 10, hex(0x0e0a16));
  frame(t, GOLD, 2);
  const c = lamp === 'on' ? LIGHT : lamp === 'err' ? hex(0xe04848) : shade(VIOLET, 0.45);
  mark(t, c);
}

export function registerV6Phase5Blocks(r: PainterRegistry): void {
  // ---- the events
  r.add('eclipse_shard_growth', (t) => {
    t.clear();
    // Three thin shards from the ground, white at the core, violet at the edges
    for (const [x0, h, lean] of [[4, 10, -1], [8, 13, 0], [11, 8, 1]] as const)
      for (let y = 0; y < h; y++) {
        const x = x0 + Math.round((lean * y) / 5);
        const yy = 15 - y;
        const tipW = y > h - 3 ? 1 : 2;
        for (let k = 0; k < tipW; k++) t.set(x + k, yy, k === 0 ? mix(LIGHT, VIOLET, y / h) : shade(VIOLET, 0.85));
      }
  });
  r.add('remnant_stone', (t) => {
    blotchy(t, REMNANT, 1, 0.6);
    // Hairline void cracks
    for (const [x, y] of [[3, 4], [4, 5], [5, 5], [6, 6], [10, 9], [11, 10], [11, 11], [12, 12]] as const) t.set(x, y, hex(0x2a1a44));
  });
  r.add('remnant_bricks', (t) => {
    bricks(t, REMNANT, hex(0x3a3048), 8, 4, 4);
    for (const [x, y] of [[2, 6], [3, 6], [12, 2], [13, 3]] as const) t.set(x, y, hex(0x7a5ab0));
  });
  r.add('fading_remnant', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, mix(hex(0x8a78b0), hex(0xc8b8f0), t.rng.next() * 0.5), 110 + t.rng.int(60));
    frame(t, hex(0xe0d8ff));
  });
  r.add('monolith_obsidian', (t) => {
    blotchy(t, OBSIDIAN, 1, 0.5);
    // Pale veins of eclipse light
    for (let y = 0; y < 16; y++) {
      const x = 7 + Math.round(Math.sin(y * 0.7) * 2);
      t.set(x, y, mix(hex(0x6a4aa0), LIGHT, (y % 5) / 6));
    }
  });
  r.add('monolith_astral', (t) => {
    blotchy(t, [hex(0x141838), hex(0x181c42), hex(0x1c2048)], 1, 0.5);
    t.speckle(hex(0xe8e8ff), 0.06);
    t.speckle(hex(0x9ab0ff), 0.04);
    frame(t, hex(0x2a3060));
  });
  r.add('fading_monolith', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, mix(hex(0x30285a), hex(0xd8d0ff), t.rng.next() * 0.4), 100 + t.rng.int(60));
    frame(t, LIGHT);
  });
  r.add('loose_end_stone', (t) => {
    blotchy(t, END_STONE, 1, 0.8);
    // Broken into loose pieces: dark gaps between them
    for (const [x, y, len, dx] of [[0, 5, 16, 1], [6, 0, 16, 0], [0, 11, 16, 1], [11, 0, 16, 0]] as const)
      for (let i = 0; i < len; i++) {
        const xx = dx ? x + i : x + ((i * 3) % 2);
        const yy = dx ? y + ((i * 5) % 2) : y + i;
        if (xx < 16 && yy < 16) t.set(xx, yy, hex(0x6a6844));
      }
  });

  // ---- the Void Citadel
  r.add('citadel_stone', (t) => citadelStone(t));
  r.add('citadel_bricks', (t) => {
    bricks(t, CSTONE, CMORTAR, 8, 4, 4);
    for (let x = 0; x < 16; x += 8) t.set(x + 3, 1, GOLD_DARK);
  });
  r.add('citadel_pillar', (t) => {
    citadelStone(t);
    for (let y = 0; y < 16; y++) {
      t.set(2, y, GOLD_DARK);
      t.set(13, y, GOLD_DARK);
      t.set(7, y, shade(CSTONE[0]!, 0.8));
    }
  });
  r.add('citadel_pillar_top', (t) => {
    citadelStone(t);
    frame(t, GOLD_DARK);
    frame(t, CMORTAR, 3);
    t.rect(6, 6, 4, 4, GOLD);
  });
  r.add('citadel_tiles', (t) => {
    tiles(t, CSTONE, 8, 0, CMORTAR);
    for (const [x, y] of [[0, 0], [8, 8]] as const) t.set(x, y, GOLD);
  });
  r.add('citadel_glass', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex(0x6a5aa0), 60);
    frame(t, hex(0x3a3060));
    for (let i = 3; i < 7; i++) t.set(i, 10 - i, LIGHT, 140);
  });
  r.add('citadel_lamp', (t) => {
    citadelStone(t);
    frame(t, GOLD_DARK);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) t.set(x, y, mix(LIGHT, VIOLET, Math.hypot(x - 7.5, y - 7.5) / 7));
    frame(t, GOLD, 2);
  });
  r.add('citadel_door', (t) => {
    citadelStone(t);
    frame(t, GOLD_DARK);
    t.rect(7, 0, 2, 16, CMORTAR);
    // A sealed ring of light across the seam
    for (let a = 0; a < 30; a++) t.set(Math.round(7.5 + Math.cos((a / 30) * Math.PI * 2) * 5), Math.round(7.5 + Math.sin((a / 30) * Math.PI * 2) * 5), VIOLET);
    t.rect(7, 6, 2, 4, LIGHT);
  });
  r.add('citadel_anchor', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (let y = 4; y < 12; y++) t.set(7, y, LIGHT);
    for (let x = 5; x < 11; x++) t.set(x, 6, LIGHT);
  });
  r.add('citadel_anchor_top', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if (Math.abs(Math.hypot(x - 7.5, y - 7.5) - 4.5) < 0.8) t.set(x, y, VIOLET);
    t.rect(6, 6, 4, 4, LIGHT);
  });
  // Murals and keys: a face per glyph (the unsuffixed name is the item icon and particles)
  for (let g = -1; g < 8; g++) {
    const sfx = g < 0 ? '' : `_${g}`;
    r.add('citadel_glyph' + sfx, (t) => {
      citadelStone(t);
      frame(t, GOLD_DARK);
      glyphOn(t, Math.max(0, g), hex(0x8a6ac8), LIGHT);
    });
    r.add('citadel_glyph_key' + sfx, (t) => {
      citadelStone(t);
      bevel(t, shade(CSTONE[3]!, 1.4), shade(CSTONE[0]!, 0.6));
      frame(t, GOLD, 1);
      glyphOn(t, Math.max(0, g), hex(0x5a4a7a), VIOLET);
    });
    if (g >= 0)
      r.add(`citadel_glyph_key_lit_${g}`, (t) => {
        citadelStone(t);
        bevel(t, shade(CSTONE[3]!, 1.4), shade(CSTONE[0]!, 0.6));
        frame(t, GOLD, 1);
        glyphOn(t, g, LIGHT, hex(0xffffff));
      });
  }
  r.add('citadel_pedestal', (t) => {
    citadelStone(t);
    frame(t, GOLD_DARK);
    for (let x = 0; x < 16; x++) t.set(x, 2, GOLD);
  });
  r.add('citadel_pedestal_top', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3.6) t.set(x, y, shade(VIOLET, 0.55));
  });
  r.add('citadel_pedestal_on', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if (Math.hypot(x - 7.5, y - 7.5) < 4.4) t.set(x, y, mix(hex(0xffffff), VIOLET, Math.hypot(x - 7.5, y - 7.5) / 4.6));
  });
  r.add('citadel_beacon', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (let y = 2; y < 14; y++) t.set(7, y, LIGHT);
    for (let y = 2; y < 14; y++) t.set(8, y, VIOLET);
  });
  r.add('citadel_beacon_top', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    t.rect(4, 4, 8, 8, VIOLET);
    t.rect(6, 6, 4, 4, LIGHT);
  });
  r.anim('void_rift', 4, 4, (t, f) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const a = Math.atan2(y - 7.5, x - 7.5) + f * 0.4 + d * 0.35;
        const v = 0.5 + Math.sin(a * 3) * 0.5;
        t.set(x, y, mix(hex(0x05020a), hex(0x7a3ad0), v * Math.max(0, 1 - d / 9)));
      }
  });
  r.add('citadel_lever', (t) => {
    t.clear();
    for (let y = 2; y < 12; y++) for (let x = 7; x < 9; x++) t.set(x, y, x === 7 ? GOLD : GOLD_DARK);
    t.rect(6, 1, 4, 2, LIGHT);
  });
  // The dormant core and its socket (engineering floors)
  const machine = (id: string, mark: (t: Tex, c: RGB) => void): void => {
    r.add(`${id}_side`, (t) => {
      citadelStone(t);
      frame(t, GOLD_DARK);
      for (let x = 3; x < 13; x++) t.set(x, 12, GOLD_DARK);
    });
    r.add(`${id}_top`, (t) => {
      citadelStone(t);
      frame(t, GOLD);
      t.rect(5, 5, 6, 6, hex(0x0e0a16));
      t.rect(7, 7, 2, 2, VIOLET);
    });
    r.add(`${id}_front`, (t) => citadelMachine(t, 'off', mark));
    r.add(`${id}_front_on`, (t) => citadelMachine(t, 'on', mark));
    r.add(`${id}_front_err`, (t) => citadelMachine(t, 'err', mark));
  };
  machine('citadel_core', (t, c) => {
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (Math.abs(x - 7.5) + Math.abs(y - 7.5) < 4) t.set(x, y, c);
  });
  machine('citadel_socket', (t, c) => {
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.hypot(x - 7.5, y - 7.5) > 1.6 && Math.hypot(x - 7.5, y - 7.5) < 3) t.set(x, y, c);
  });

  // ---- the End Guardian's arena
  r.add('guardian_floor', (t) => {
    tiles(t, CSTONE, 16, 0, null);
    frame(t, GOLD_DARK);
    for (let a = 0; a < 20; a++) t.set(Math.round(7.5 + Math.cos((a / 20) * Math.PI * 2) * 4), Math.round(7.5 + Math.sin((a / 20) * Math.PI * 2) * 4), shade(VIOLET, 0.6));
  });
  r.add('guardian_altar', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (let x = 0; x < 16; x++) t.set(x, 4, GOLD_DARK);
    glyphOn(t, 1, hex(0x8a6ac8), LIGHT);
  });
  r.add('guardian_altar_top', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    // Four sockets for the Eclipse Shards
    for (const [x, y] of [[3, 3], [10, 3], [3, 10], [10, 10]] as const) t.rect(x, y, 3, 3, hex(0x0e0a16));
    t.rect(6, 6, 4, 4, shade(VIOLET, 0.5));
  });
  r.add('guardian_altar_on', (t) => {
    citadelStone(t);
    frame(t, GOLD);
    for (const [x, y] of [[3, 3], [10, 3], [3, 10], [10, 10]] as const) t.rect(x, y, 3, 3, LIGHT);
    t.rect(6, 6, 4, 4, hex(0xffffff));
  });
  r.add('end_guardian_head', (t) => {
    citadelStone(t);
    for (let x = 0; x < 16; x++) t.set(x, 0, GOLD);
  });
  r.add('end_guardian_head_front', (t) => {
    citadelStone(t);
    for (let x = 0; x < 16; x++) t.set(x, 0, GOLD);
    t.rect(3, 7, 10, 2, hex(0x120c1c));
    t.rect(5, 7, 6, 1, hex(0xc8b8ff));
  });
}

export function registerV6Phase5Items(r: PainterRegistry, pm: (t: Tex, mask: string, pal: Pal) => void, mp: (base: RGB, outline?: number) => Pal): void {
  r.add('eclipse_shard', (t) => {
    pm(t, 'shard', mp(hex(0x9a7ad8)));
    for (const [x, y] of [[7, 5], [8, 6], [8, 7], [9, 8]] as const) if (t.alpha(x, y)) t.set(x, y, LIGHT);
  });
  r.add('citadel_star_chart_piece', (t) => {
    pm(t, 'sheet', mp(hex(0x2a2448)));
    for (const [x, y] of [[5, 5], [9, 4], [7, 8], [10, 10], [5, 11]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xf0e8ff));
    for (let i = 0; i < 4; i++) if (t.alpha(5 + i, 5 + i)) t.set(5 + i, 5 + i, shade(GOLD, 0.9));
  });
  r.add('void_citadel_map', (t) => pm(t, 'compass', { ...mp(hex(0x2c2542)), r: hex(0xe8e0ff), w: hex(0xc8b070) }));
  r.add('guardian_core', (t) => {
    pm(t, 'core', mp(hex(0x3a3050)));
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.hypot(x - 7.5, y - 7.5) < 2.4 && t.alpha(x, y)) t.set(x, y, mix(hex(0xffffff), VIOLET, Math.hypot(x - 7.5, y - 7.5) / 2.6));
  });
  r.add('guardians_lance', (t) => {
    pm(t, 'sword', { ...mp(hex(0xc8bcf0)), h: GOLD, H: GOLD_DARK, k: hex(0x3a3050) });
    for (let i = 3; i < 12; i++) if (t.alpha(i + 1, 14 - i)) t.set(i + 1, 14 - i, LIGHT);
  });
  r.add('eclipse_veil_module', (t) => {
    pm(t, 'disc', mp(hex(0x1a1428)));
    for (let y = 4; y < 12; y++)
      for (let x = 4; x < 12; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (!t.alpha(x, y)) continue;
        if (d < 2.2) t.set(x, y, hex(0x05030a));
        else if (d < 3.2) t.set(x, y, LIGHT);
      }
  });
}
