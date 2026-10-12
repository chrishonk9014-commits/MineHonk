/**
 * V5 - The Engineering Update: textures for machines, generators, batteries,
 * cables, pipes, conveyors, storage, signal parts, factory blocks and the
 * engineering items.
 *
 * Machines are painted from one recipe so they read as a family: a metal
 * body coloured by tier, rivets and vents on the sides, a hatch on top, and a
 * front panel with the machine's own pictogram and a status lamp (dark when
 * idle, green while working, red on a problem).
 */
import { Tex, type RGB, hex, shade, mix } from './canvas';
import { bevel, frame, planks } from './patterns';
import type { PainterRegistry } from './registry';
import { paintMask, matPal } from './items';

interface TierPal {
  base: RGB;
  trim: RGB;
  accent: RGB;
}

const TIERS: Record<number, TierPal> = {
  1: { base: hex(0x9a9ea4), trim: hex(0x5a5e64), accent: hex(0xd07a2a) },
  2: { base: hex(0x7a8a98), trim: hex(0x3e4a56), accent: hex(0x3a8ad8) },
  3: { base: hex(0x585e66), trim: hex(0x2a2e34), accent: hex(0xe8b820) },
  4: { base: hex(0x33383f), trim: hex(0x15181c), accent: hex(0x30d8e8) },
};

const GREEN = hex(0x50f060);
const RED = hex(0xf03a30);
const DARK = hex(0x1c1e22);

/** Brushed metal with a bevel and corner rivets. */
function body(t: Tex, p: TierPal, rivets = true): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = t.rng.next();
      t.set(x, y, shade(p.base, 0.94 + n * 0.1 + (y % 4 === 0 ? -0.03 : 0)));
    }
  bevel(t, shade(p.base, 1.25), shade(p.base, 0.62));
  frame(t, p.trim);
  if (rivets) for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) {
    t.set(x, y, shade(p.base, 1.4));
    t.set(x + 1, y + 1 > 15 ? y : y + 1, shade(p.base, 0.55));
  }
}

function side(t: Tex, p: TierPal): void {
  body(t, p);
  // Vents and an accent band
  for (let y = 5; y <= 9; y += 2) for (let x = 4; x <= 11; x++) t.set(x, y, shade(p.trim, 0.8));
  for (let x = 1; x < 15; x++) t.set(x, 12, p.accent);
}

function top(t: Tex, p: TierPal): void {
  body(t, p);
  t.rect(4, 4, 8, 8, shade(p.base, 0.8));
  for (let i = 4; i < 12; i++) {
    t.set(i, 4, p.trim);
    t.set(i, 11, shade(p.base, 1.2));
    t.set(4, i, p.trim);
    t.set(11, i, shade(p.base, 1.2));
  }
  t.set(7, 7, p.accent);
  t.set(8, 8, p.accent);
  t.set(7, 8, shade(p.accent, 0.7));
  t.set(8, 7, shade(p.accent, 0.7));
}

type Lamp = 'off' | 'on' | 'err';

/** Pictograms (8x8, '#' = lit pixel) per machine. */
const GLYPH: Record<string, string[]> = {
  crusher: ['#.#..#.#', '########', '.#.##.#.', '........', '........', '.#.##.#.', '########', '#.#..#.#'],
  electric_furnace: ['........', '...#....', '..##..#.', '..###.#.', '.#####..', '.######.', '########', '########'],
  grinder: ['..####..', '.#....#.', '#..##..#', '#.#..#.#', '#.#..#.#', '#..##..#', '.#....#.', '..####..'],
  compressor: ['########', '...##...', '...##...', '.######.', '........', '########', '########', '########'],
  cutter: ['...#....', '..###...', '.#.#.#..', '###.###.', '.#.#.#..', '..###...', '...#....', '########'],
  recycler: ['..###...', '.#...#..', '#.....##', '#....###', '###....#', '##.....#', '..#...#.', '...###..'],
  assembler: ['###.###.', '#.#.#.#.', '###.###.', '........', '###.###.', '#.#.#.#.', '###.###.', '........'],
  industrial_furnace: ['########', '#......#', '#.#..#.#', '#.####.#', '#######.', '########', '#......#', '########'],
  advanced_crusher: ['#.#.#.#.', '########', '.######.', '..####..', '..####..', '.######.', '########', '.#.#.#.#'],
  large_generator: ['...##...', '..####..', '.##..##.', '##.##.##', '##.##.##', '.##..##.', '..####..', '...##...'],
  quarry: ['########', '#......#', '#.####.#', '#.#..#.#', '#.#..#.#', '#.####.#', '#......#', '########'],
  mining_drill: ['...##...', '...##...', '..####..', '..####..', '.######.', '..####..', '...##...', '....#...'],
  ore_scanner: ['..####..', '.#....#.', '#..#...#', '#...#..#', '#....#.#', '#......#', '.#....#.', '..####..'],
  crop_planter: ['...#....', '..###...', '...#....', '...#.#..', '.#.###..', '.###.#..', '...#....', '########'],
  crop_harvester: ['.#.#.#.#', '.#.#.#.#', '.#####.#', '.#.#.###', '...#...#', '########', '.......#', '........'],
  irrigation_sprinkler: ['#..#..#.', '.#.#.#..', '..###...', '########', '...#....', '...#....', '...#....', '..###...'],
  item_collector: ['#......#', '.#....#.', '..#..#..', '........', '..####..', '.#....#.', '.#....#.', '..####..'],
  animal_feeder: ['........', '.##..##.', '#..##..#', '#......#', '.######.', '..#..#..', '........', '########'],
  pump: ['...##...', '...##...', '########', '#......#', '#.####.#', '#......#', '########', '...##...'],
  fluid_outlet: ['########', '...##...', '...##...', '..####..', '.##..##.', '.#....#.', '.##..##.', '..####..'],
  water_wheel: ['#..#..#.', '.#.#.#..', '..###...', '###.###.', '..###...', '.#.#.#..', '#..#..#.', '........'],
  solar_panel: ['#.#..#.#', '.#....#.', '#..##..#', '..####..', '..####..', '#..##..#', '.#....#.', '#.#..#.#'],
  wind_turbine: ['...#....', '...##...', '...#.#..', '#######.', '..#.#...', '..##....', '...#....', '...#....'],
  steam_generator: ['.#..#...', '#..#....', '.#..#...', '........', '.######.', '#......#', '#......#', '.######.'],
  advanced_generator: ['....#...', '...##...', '..##....', '.######.', '....##..', '...##...', '...#....', '..#.....'],
  control_panel: ['#.#.#.#.', '........', '#.#.#.#.', '........', '#.#.#.#.', '........', '#.#.#.#.', '........'],
};

function front(t: Tex, p: TierPal, id: string, lamp: Lamp): void {
  body(t, p, false);
  // Recessed panel
  t.rect(2, 2, 12, 10, DARK);
  for (let x = 2; x < 14; x++) t.set(x, 11, shade(p.base, 1.2));
  for (let y = 2; y < 12; y++) t.set(13, y, shade(p.base, 1.2));
  const g = GLYPH[id];
  const lit = lamp === 'on' ? mix(p.accent, hex(0xffffff), 0.35) : lamp === 'err' ? shade(p.accent, 0.45) : shade(p.accent, 0.6);
  if (g) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (g[y]![x] === '#') t.set(4 + x, 3 + y, lit);
  if (lamp === 'on') {
    // A soft glow around the lit pictogram
    for (let y = 2; y < 11; y++) for (let x = 3; x < 13; x++) if (t.get(x, y)[0] === DARK[0] && t.get(x, y)[1] === DARK[1]) t.set(x, y, mix(DARK, p.accent, 0.12));
  }
  // Status lamp
  const lc = lamp === 'on' ? GREEN : lamp === 'err' ? RED : hex(0x3a3c40);
  t.rect(11, 13, 2, 2, lc);
  t.set(11, 13, lamp === 'off' ? hex(0x55585c) : mix(lc, hex(0xffffff), 0.5));
  // Two small dials
  t.set(3, 13, shade(p.trim, 0.8));
  t.set(5, 13, shade(p.trim, 0.8));
  t.set(3, 14, p.accent);
}

function monitorFront(t: Tex, p: TierPal, lamp: Lamp): void {
  body(t, p, false);
  const screen = lamp === 'on' ? hex(0x0c2414) : lamp === 'err' ? hex(0x2a0a0a) : hex(0x0a0c0e);
  t.rect(2, 2, 12, 12, screen);
  for (let y = 2; y < 14; y += 2) for (let x = 2; x < 14; x++) t.set(x, y, shade(screen, 1.25));
  if (lamp === 'err') for (let i = 0; i < 4; i++) t.set(7 + (i % 2), 5 + i, RED);
}

const COMPONENT_TIER: Record<string, number> = {
  water_wheel: 1, solar_panel: 1, wind_turbine: 2, steam_generator: 2, advanced_generator: 3,
  crusher: 1, electric_furnace: 1, grinder: 2, compressor: 2, cutter: 2, recycler: 3, assembler: 4,
  industrial_furnace: 3, advanced_crusher: 3, large_generator: 4, quarry: 4,
  mining_drill: 3, ore_scanner: 3, crop_planter: 2, crop_harvester: 2, irrigation_sprinkler: 2, item_collector: 2, animal_feeder: 2,
  pump: 2, fluid_outlet: 2, monitor: 3, control_panel: 4,
};

function cable(t: Tex, core: RGB, sheath: RGB, band?: RGB): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      t.set(x, y, edge ? shade(sheath, 0.6) : shade(sheath, 0.9 + t.rng.next() * 0.15 + (y < 6 ? 0.08 : 0)));
    }
  if (band) for (let x = 0; x < 16; x++) for (const y of [7, 8]) t.set(x, y, band);
  t.set(7, 7, core);
  t.set(8, 8, core);
}

function pipe(t: Tex, wall: RGB, inner: RGB, ring: RGB): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const e = Math.min(x, y, 15 - x, 15 - y);
      t.set(x, y, e === 0 ? shade(wall, 0.55) : e <= 2 ? shade(wall, 1 + (y < 8 ? 0.1 : -0.05)) : inner);
    }
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, ring);
    t.set(x, 15, ring);
  }
}

/** Arrows pointing up the texture (the direction a conveyor moves). */
function belt(t: Tex, base: RGB, arrow: RGB): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) t.set(x, y, x < 2 || x > 13 ? hex(0x5a5e64) : shade(base, y % 4 === 0 ? 0.8 : 0.95 + t.rng.next() * 0.08));
  for (const oy of [2, 10])
    for (let i = 0; i < 4; i++) {
      t.set(7 - i, oy + i, arrow);
      t.set(8 + i, oy + i, arrow);
    }
}

function wood(t: Tex): void {
  planks(t, [hex(0x9a6a3a), hex(0x8a5a2e), hex(0xa87a48), hex(0x7a4e26)]);
}

/** 3x5 letters for logic gate labels. */
const LETTERS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
};

function label(t: Tex, text: string, y: number, c: RGB): void {
  const w = text.length * 4 - 1;
  let x = Math.floor((16 - w) / 2);
  for (const ch of text) {
    const g = LETTERS[ch];
    if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r]![k] === '#') t.set(x + k, y + r, c);
    x += 4;
  }
}

/** The top of a signal part: a slate plate with a mark, glowing when lit. */
function plate(t: Tex, lit: boolean, draw: (t: Tex, c: RGB) => void): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(hex(0x4a4e56), 0.92 + t.rng.next() * 0.12));
  frame(t, hex(0x2a2c30));
  // Input/output marks: front (top of the texture) arrow
  const c = lit ? hex(0x40f0ff) : hex(0x206070);
  t.set(7, 1, c);
  t.set(8, 1, c);
  draw(t, c);
}

export function registerV5Blocks(r: PainterRegistry): void {
  // --- Machines ---------------------------------------------------------------
  for (const [id, tier] of Object.entries(COMPONENT_TIER)) {
    const p = TIERS[tier]!;
    r.add(`${id}_side`, (t) => side(t, p));
    r.add(`${id}_top`, (t) => top(t, p));
    const fr = (lamp: Lamp) => (t: Tex) => (id === 'monitor' ? monitorFront(t, p, lamp) : front(t, p, id, lamp));
    r.add(`${id}_front`, fr('off'));
    r.add(`${id}_front_on`, fr('on'));
    r.add(`${id}_front_err`, fr('err'));
  }
  // Generators look the part on their other faces
  r.add('solar_panel_top', (t) => {
    t.fill(hex(0x8a8e94));
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) t.set(x, y, (x % 5 === 0 || y % 5 === 0) ? hex(0xb0b4ba) : mix(hex(0x1a3a8a), hex(0x3a6ad0), ((x + y) % 7) / 10 + t.rng.next() * 0.1));
  });
  r.add('water_wheel_side', (t) => {
    wood(t);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (let d = 2; d < 8; d++) t.set(Math.round(7.5 + Math.cos(ang) * d), Math.round(7.5 + Math.sin(ang) * d), hex(0x4a2e14));
    }
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      t.set(Math.round(7.5 + Math.cos(ang) * 7), Math.round(7.5 + Math.sin(ang) * 7), hex(0x5a5e64));
    }
    t.rect(6, 6, 4, 4, hex(0x5a5e64));
  });
  r.add('wind_turbine_top', (t) => {
    body(t, TIERS[2]!);
    for (let i = 1; i < 7; i++) {
      t.set(7 - i, 7 - Math.floor(i / 2), hex(0xe8ecf0));
      t.set(8 + Math.floor(i / 2), 7 - i, hex(0xe8ecf0));
      t.set(8 + i, 8 + Math.floor(i / 2), hex(0xe8ecf0));
      t.set(7 - Math.floor(i / 2), 8 + i, hex(0xe8ecf0));
    }
    t.rect(7, 7, 2, 2, TIERS[2]!.accent);
  });
  r.add('machine_bottom', (t) => {
    body(t, TIERS[1]!);
    for (let y = 4; y < 12; y += 3) for (let x = 4; x < 12; x++) t.set(x, y, hex(0x3a3e44));
  });

  // --- Batteries ----------------------------------------------------------------
  const battery = (id: string, p: TierPal, cell: RGB): void => {
    const sidePaint = (charge: number) => (t: Tex) => {
      body(t, p);
      t.rect(5, 2, 6, 12, DARK);
      for (let k = 0; k < 4; k++) {
        const on = k < charge;
        t.rect(6, 11 - k * 3, 4, 2, on ? mix(cell, hex(0xffffff), 0.15 * k) : hex(0x2e3034));
      }
    };
    r.add(`${id}_side`, sidePaint(0));
    for (let c = 0; c <= 4; c++) r.add(`${id}_side_${c}`, sidePaint(c));
    r.add(`${id}_top`, (t) => {
      body(t, p);
      t.rect(3, 6, 3, 3, hex(0xc03030));
      t.rect(10, 6, 3, 3, hex(0x303030));
      t.set(4, 7, hex(0xffffff));
      t.set(11, 7, hex(0xffffff));
    });
  };
  battery('battery', TIERS[1]!, hex(0x50e050));
  battery('battery_bank', TIERS[2]!, hex(0x50c0f0));
  battery('energy_cell', TIERS[4]!, hex(0x40f0ff));

  // --- Cables and pipes ---------------------------------------------------------
  r.add('copper_wire', (t) => cable(t, hex(0xffc080), hex(0xc8743a)));
  r.add('insulated_cable', (t) => cable(t, hex(0xd8843a), hex(0x2a2a2e), hex(0xd8843a)));
  r.add('power_conduit', (t) => cable(t, hex(0x80ffff), hex(0x3a4048), hex(0x30d8e8)));
  r.add('item_pipe', (t) => pipe(t, hex(0xc8a050), hex(0x8a6a30), hex(0x8a6a2a)));
  r.add('fluid_pipe', (t) => pipe(t, hex(0x7a8a98), hex(0x4a5a68), hex(0x3a4a5a)));
  r.add('item_filter', (t) => {
    pipe(t, hex(0xc8a050), hex(0x8a6a30), hex(0x8a6a2a));
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if ((x + y) % 2 === 0) t.set(x, y, hex(0x3a3a3a));
  });
  r.add('fluid_filter', (t) => {
    pipe(t, hex(0x7a8a98), hex(0x4a5a68), hex(0x3a4a5a));
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if ((x + y) % 2 === 0) t.set(x, y, hex(0x3a7ad8));
  });
  r.add('fluid_valve', (t) => {
    pipe(t, hex(0x7a8a98), hex(0x4a5a68), hex(0x3a4a5a));
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      t.set(Math.round(7.5 + Math.cos(ang) * 5), Math.round(7.5 + Math.sin(ang) * 5), hex(0xc02a20));
    }
    for (let i = 3; i < 13; i++) {
      t.set(i, 7, hex(0xc02a20));
      t.set(7, i, hex(0xc02a20));
    }
  });

  // --- Conveyors, hoppers, chutes ----------------------------------------------
  r.add('conveyor_belt', (t) => belt(t, hex(0x2e3034), hex(0xe8b820)));
  r.add('express_conveyor_belt', (t) => belt(t, hex(0x2e3034), hex(0x30d8e8)));
  r.add('conveyor_side', (t) => {
    t.fill(hex(0x6a6e74));
    for (let x = 0; x < 16; x++) {
      t.set(x, 12, hex(0xe8b820));
      t.set(x, 15, hex(0x3a3e44));
    }
    for (let x = 1; x < 16; x += 4) t.set(x, 13, hex(0x2a2c30));
  });
  r.add('express_conveyor_side', (t) => {
    t.fill(hex(0x5a6a78));
    for (let x = 0; x < 16; x++) {
      t.set(x, 12, hex(0x30d8e8));
      t.set(x, 15, hex(0x2a343e));
    }
    for (let x = 1; x < 16; x += 4) t.set(x, 13, hex(0x1a2028));
  });
  r.add('hopper_side', (t) => {
    body(t, TIERS[1]!, false);
    for (let x = 1; x < 15; x++) t.set(x, 2, hex(0x3a3e44));
  });
  r.add('hopper_top', (t) => {
    body(t, TIERS[1]!, false);
    t.rect(3, 3, 10, 10, hex(0x2a2c30));
    for (let i = 3; i < 13; i += 3) for (let k = 3; k < 13; k++) t.set(k, i, hex(0x5a5e64));
  });
  r.add('chute', (t) => {
    body(t, TIERS[1]!, false);
    for (let y = 1; y < 15; y += 3) for (let x = 3; x < 13; x++) t.set(x, y, hex(0x6a6e74));
  });

  // --- Fluid tank ------------------------------------------------------------
  r.add('fluid_tank', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const edge = x <= 1 || x >= 14 || y <= 1 || y >= 14;
        if (edge) t.set(x, y, shade(hex(0x7a8a98), x <= 1 || y <= 1 ? 1.15 : 0.7));
        else if ((x + y) % 9 === 0) t.set(x, y, hex(0xd8f0ff), 140);
        else t.set(x, y, hex(0xa8c8e0), 40);
      }
    for (let y = 3; y < 14; y += 3) {
      t.set(12, y, hex(0x3a4a5a));
      t.set(13, y, hex(0x3a4a5a));
    }
  });
  r.add('fluid_tank_top', (t) => {
    body(t, TIERS[2]!);
    t.rect(5, 5, 6, 6, hex(0x2a343e));
  });

  // --- Storage -----------------------------------------------------------------
  r.add('crate_side', (t) => {
    wood(t);
    frame(t, hex(0x5a3a1a));
    for (let i = 1; i < 15; i++) t.set(i, i, hex(0x6a4420));
  });
  r.add('crate_top', (t) => {
    wood(t);
    frame(t, hex(0x5a3a1a));
  });
  const box = (id: string, p: TierPal, lock: RGB): void => {
    r.add(`${id}_side`, (t) => {
      body(t, p);
      for (let x = 1; x < 15; x++) t.set(x, 6, p.trim);
      t.rect(7, 5, 2, 3, lock);
    });
    r.add(`${id}_top`, (t) => {
      body(t, p);
      t.rect(3, 3, 10, 10, shade(p.base, 0.85));
    });
  };
  box('industrial_chest', TIERS[2]!, hex(0xe8b820));
  box('item_vault', TIERS[3]!, hex(0x30d8e8));
  r.add('storage_barrel_side', (t) => {
    wood(t);
    for (let x = 0; x < 16; x++) {
      t.set(x, 2, hex(0x5a5e64));
      t.set(x, 13, hex(0x5a5e64));
    }
  });
  r.add('storage_barrel_top', (t) => {
    wood(t);
    frame(t, hex(0x5a5e64));
  });
  r.add('storage_barrel_front', (t) => {
    wood(t);
    frame(t, hex(0x5a5e64));
    t.rect(4, 4, 8, 6, hex(0x3a2a1a));
    t.rect(5, 11, 6, 2, hex(0xe8e0c8));
  });
  const sixway = (id: string, p: TierPal, mark: RGB): void => {
    r.add(`${id}_side`, (t) => {
      body(t, p);
      for (let x = 3; x < 13; x++) t.set(x, 8, mark);
      t.set(11, 7, mark);
      t.set(11, 9, mark);
      t.set(10, 6, mark);
      t.set(10, 10, mark);
    });
    r.add(`${id}_front`, (t) => {
      body(t, p);
      t.rect(4, 4, 8, 8, hex(0x1a1c20));
      for (let y = 5; y < 11; y += 2) for (let x = 5; x < 11; x++) t.set(x, y, shade(mark, 0.7));
    });
    r.add(`${id}_back`, (t) => {
      body(t, p);
      t.rect(6, 6, 4, 4, shade(mark, 0.6));
    });
  };
  sixway('item_extractor', TIERS[2]!, hex(0xe8b820));
  sixway('item_sorter', TIERS[2]!, hex(0x50e050));

  // --- Signals -----------------------------------------------------------------
  const dust = (bright: boolean, line: boolean) => (t: Tex) => {
    t.clear();
    const cols = bright ? [hex(0x40f0ff), hex(0x20c0e0), hex(0xb0ffff)] : [hex(0x0a3a4a), hex(0x06303c), hex(0x1a5a6a)];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const inLine = line ? x >= 6 && x <= 9 : Math.hypot(x - 7.5, y - 7.5) < 3.2;
        if (!inLine) continue;
        const edge = line ? x === 6 || x === 9 : Math.hypot(x - 7.5, y - 7.5) > 2.4;
        t.set(x, y, edge ? cols[1]! : (y % 3 === 0 ? cols[2]! : cols[0]!));
      }
  };
  r.add('signal_cable_dot', dust(false, false));
  r.add('signal_cable_line', dust(false, true));
  r.add('signal_cable_dot_on', dust(true, false));
  r.add('signal_cable_line_on', dust(true, true));
  r.add('signal_plate', (t) => {
    t.fill(hex(0x3a3e46));
    for (let x = 0; x < 16; x++) t.set(x, 0, hex(0x5a5e66));
  });
  const clock = (c: RGB) => (t: Tex, cc: RGB) => {
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2;
      t.set(Math.round(7.5 + Math.cos(ang) * 4.5), Math.round(8 + Math.sin(ang) * 4.5), c);
    }
    for (let i = 0; i < 4; i++) t.set(8, 8 - i, cc);
    for (let i = 0; i < 3; i++) t.set(8 + i, 8, cc);
  };
  r.add('timer', (t) => plate(t, false, clock(hex(0x8a8e96))));
  r.add('timer_on', (t) => plate(t, true, clock(hex(0x40f0ff))));
  const gate = (mode: string, lit: boolean) => (t: Tex) =>
    plate(t, lit, (tt, c) => {
      label(tt, mode.toUpperCase(), 6, c);
      // Inputs on the left, right and back
      tt.set(1, 8, c);
      tt.set(14, 8, c);
      tt.set(7, 14, c);
      tt.set(8, 14, c);
    });
  r.add('logic_gate', gate('and', false));
  r.add('logic_gate_on', gate('and', true));
  for (const m of ['and', 'or', 'xor', 'nand', 'nor', 'not']) {
    r.add(`logic_gate_${m}`, gate(m, false));
    r.add(`logic_gate_${m}_on`, gate(m, true));
  }
  const meter = (t: Tex, c: RGB): void => {
    t.rect(4, 4, 8, 9, hex(0x1a1c20));
    for (let k = 0; k < 4; k++) t.rect(5, 11 - k * 2, 6, 1, k < 2 || c[1] > 200 ? c : shade(c, 0.5));
  };
  r.add('level_sensor', (t) => plate(t, false, meter));
  r.add('level_sensor_on', (t) => plate(t, true, meter));
  const eye = (t: Tex, c: RGB): void => {
    for (let x = 4; x < 12; x++) {
      t.set(x, 6, c);
      t.set(x, 11, c);
    }
    t.set(3, 7, c);
    t.set(3, 10, c);
    t.set(12, 7, c);
    t.set(12, 10, c);
    t.rect(7, 8, 2, 2, c);
  };
  r.add('item_sensor', (t) => plate(t, false, eye));
  r.add('item_sensor_on', (t) => plate(t, true, eye));
  r.add('warning_light', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, mix(hex(0x6a3a0a), hex(0x8a5010), ((x * 3 + y) % 5) / 5));
  });
  r.add('warning_light_on', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, mix(hex(0xffa020), hex(0xffe080), ((x * 3 + y) % 5) / 5));
  });
  r.add('warning_light_base', (t) => body(t, TIERS[3]!, false));

  // --- Factory blocks --------------------------------------------------------
  r.add('machine_casing', (t) => {
    body(t, TIERS[2]!);
    for (let i = 2; i < 14; i++) {
      t.set(i, i, shade(TIERS[2]!.base, 0.7));
      t.set(15 - i, i, shade(TIERS[2]!.base, 0.7));
    }
  });
  r.add('steel_block', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(hex(0x8a929c), 0.92 + t.rng.next() * 0.1 + (x === y ? 0.1 : 0)));
    bevel(t, hex(0xc0c8d0), hex(0x4a525c));
  });
  r.add('industrial_glass', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, hex(0x3a3e44));
        else if (x === 1 || y === 1) t.set(x, y, hex(0x6a6e74));
        else if (x - y === 3 || x - y === 4) t.set(x, y, hex(0xe0f0ff), 120);
      }
  });
  r.add('metal_grate', (t) => {
    t.clear();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (x % 4 === 0 || y % 4 === 0 || x === 15 || y === 15) t.set(x, y, shade(hex(0x6a6e74), (x + y) % 8 === 0 ? 1.2 : 1));
  });
  r.add('hazard_stripes', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, Math.floor((x + y) / 4) % 2 === 0 ? hex(0xe8c020) : hex(0x1a1a1a));
  });
  r.add('factory_light', (t) => {
    body(t, TIERS[3]!, false);
    t.rect(2, 2, 12, 12, hex(0xfff4d0));
    for (let x = 2; x < 14; x++) t.set(x, 7, hex(0xe8d8a8));
    for (let y = 2; y < 14; y++) t.set(7, y, hex(0xe8d8a8));
  });
  r.add('industrial_door_top', (t) => {
    body(t, TIERS[3]!);
    t.rect(3, 3, 10, 6, hex(0xa8c0d0));
    for (let x = 3; x < 13; x++) t.set(x, 3, hex(0x3a3e44));
  });
  r.add('industrial_door_bottom', (t) => {
    body(t, TIERS[3]!);
    for (let y = 9; y < 15; y++) for (let x = 1; x < 15; x++) if (Math.floor((x + y) / 3) % 2 === 0) t.set(x, y, hex(0xe8c020));
    t.rect(12, 3, 2, 3, hex(0x2a2a2a));
  });

  // --- Engineering Crafting Table ---------------------------------------------
  r.add('engineering_table_top', (t) => {
    body(t, TIERS[1]!);
    t.rect(2, 2, 12, 12, hex(0x3a5a8a));
    for (let i = 2; i < 14; i += 3) for (let k = 2; k < 14; k++) {
      t.set(k, i, hex(0x6a8aba));
      t.set(i, k, hex(0x6a8aba));
    }
  });
  r.add('engineering_table_side', (t) => {
    wood(t);
    for (let x = 0; x < 16; x++) for (const y of [0, 1]) t.set(x, y, hex(0x6a6e74));
    t.rect(3, 5, 4, 6, hex(0x5a5e64));
    t.rect(9, 6, 4, 2, hex(0xc8743a));
  });
  r.add('engineering_table_front', (t) => {
    wood(t);
    for (let x = 0; x < 16; x++) for (const y of [0, 1]) t.set(x, y, hex(0x6a6e74));
    // A wrench and a gear
    for (let i = 0; i < 7; i++) t.set(3 + i, 12 - i, hex(0xb0b4ba));
    t.set(9, 4, hex(0xb0b4ba));
    t.set(10, 6, hex(0xb0b4ba));
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      t.set(Math.round(11 + Math.cos(ang) * 2.5), Math.round(11 + Math.sin(ang) * 2.5), hex(0xd07a2a));
    }
  });
}

export function registerV5Items(r: PainterRegistry): void {
  const dust = (id: string, c: number): void => r.add(id, (t) => paintMask(t, 'dust', matPal(hex(c))));
  dust('copper_dust', 0xd0844a);
  dust('iron_dust', 0xc8c0b8);
  dust('gold_dust', 0xf0d040);
  dust('coal_dust', 0x3a3a3e);
  dust('steel_blend', 0x6a6e78);
  r.add('steel_ingot', (t) => paintMask(t, 'ingot', matPal(hex(0x8a98a8))));
  r.add('iron_plate', (t) => paintMask(t, 'sheet', matPal(hex(0xd0d0d4))));
  r.add('steel_plate', (t) => paintMask(t, 'sheet', matPal(hex(0x7a8898))));
  const sprite = (id: string, rows: string[], pal: Record<string, RGB>): void =>
    r.add(id, (t) => {
      t.clear();
      t.mask(rows, pal);
    });
  sprite('iron_gear', ['', '......oo........', '...oo.oo.oo.....', '...obbbbbbo.....', '....obccbo......', '..oobcooccboo...', '..obbco..cbbo...', '..obbco..cbbo...', '..oobbooccboo...', '....obbbbo......', '...obbbbbbo.....', '...oo.oo.oo.....', '......oo........'], { o: hex(0x4a4e54), b: hex(0xa8acb2), c: hex(0xd8dce2) });
  sprite('copper_coil', ['', '', '....oooooooo....', '...oaaaaaaaao...', '...obcbcbcbco...', '...oaaaaaaaao...', '...obcbcbcbco...', '...oaaaaaaaao...', '...obcbcbcbco...', '...oaaaaaaaao...', '....oooooooo....'], { o: hex(0x5a3010), a: hex(0xb06030), b: hex(0xd8844a), c: hex(0xf0b080) });
  sprite('motor', ['', '', '...ooooooooo....', '...obbbbbbbo....', '..oobccccbbooooo', '..obbcaacbbbaaao', '..obbcaacbbbaaao', '..oobccccbbooooo', '...obbbbbbbo....', '...ooooooooo....', '....oo...oo.....'], { o: hex(0x2a2e34), b: hex(0x6a7480), c: hex(0xc8743a), a: hex(0xe8b820) });
  sprite('control_circuit', ['', '', '..o.o.o.o.o.o...', '..oooooooooooo..', '..oggggggggggo..', '..oglllgddgggo..', '..ogggglgdgggo..', '..ogyyglgggrgo..', '..oggggggggggo..', '..oooooooooooo..', '..o.o.o.o.o.o...'], { o: hex(0x1a3a1a), g: hex(0x2a8a3a), l: hex(0xe8c040), d: hex(0x1a1a1a), y: hex(0xd0d0d0), r: hex(0xd03020) });
  sprite('advanced_circuit', ['', '', '..o.o.o.o.o.o...', '..oooooooooooo..', '..obbbbbbbbbbo..', '..oblllbddbbbo..', '..obbbblbcbbbo..', '..obyyblbbbcbo..', '..obbbbbbbbbbo..', '..oooooooooooo..', '..o.o.o.o.o.o...'], { o: hex(0x1a1a3a), b: hex(0x3a3a9a), l: hex(0xe8c040), d: hex(0x1a1a1a), y: hex(0xd0d0d0), c: hex(0x40f0ff) });
  const upgrade = (id: string, c: number, mark: string[]): void =>
    sprite(id, ['', '', '...oooooooooo...', '...obbbbbbbbo...', ...mark.map((m) => '...ob' + m + 'bo...'), '...obbbbbbbbo...', '...oooooooooo...', '....o.o..o.o....'], { o: hex(0x2a2e34), b: hex(0x6a7480), m: hex(c) });
  upgrade('speed_upgrade', 0x50e050, ['..mm..', '.mmmm.', 'mm..mm', '..mm..', '.mmmm.', 'mm..mm']);
  upgrade('efficiency_upgrade', 0x40c0f0, ['..mm..', '.mmmm.', '.mmmm.', 'mmmmmm', 'mmmmmm', '.mmmm.']);
  upgrade('capacity_upgrade', 0xe8b820, ['mmmmmm', 'm....m', 'mmmmmm', 'm....m', 'mmmmmm', 'mmmmmm']);
  upgrade('range_upgrade', 0xd050e0, ['m....m', '.m..m.', '..mm..', '..mm..', '.m..m.', 'm....m']);
  r.add('engineering_book', (t) => paintMask(t, 'book', { ...matPal(hex(0x3a5a8a)), d: hex(0xf0ece0) }));
  // Icons for blocks whose models are not cubes
  const conduitIcon = (id: string, wall: RGB, core: RGB, w: number): void =>
    r.add(id, (t) => {
      t.clear();
      const a = 8 - w;
      const b = 7 + w;
      for (let x = 1; x < 15; x++) for (let y = a; y <= b; y++) t.set(x, y, y === a ? shade(wall, 1.3) : y === b ? shade(wall, 0.6) : wall);
      for (let y = a + 1; y < b; y++) t.set(7, y, core);
      t.outline(shade(wall, 0.4));
    });
  conduitIcon('copper_wire', hex(0xc8743a), hex(0xffc080), 1);
  conduitIcon('insulated_cable', hex(0x2a2a2e), hex(0xd8843a), 2);
  conduitIcon('power_conduit', hex(0x3a4048), hex(0x30d8e8), 3);
  conduitIcon('item_pipe', hex(0xc8a050), hex(0x8a6a30), 3);
  conduitIcon('fluid_pipe', hex(0x7a8a98), hex(0x3a7ad8), 3);
  conduitIcon('item_filter', hex(0xc8a050), hex(0x3a3a3a), 4);
  conduitIcon('fluid_filter', hex(0x7a8a98), hex(0x3a7ad8), 4);
  conduitIcon('fluid_valve', hex(0x7a8a98), hex(0xc02a20), 4);
  const beltIcon = (id: string, arrow: RGB): void =>
    r.add(id, (t) => {
      t.clear();
      for (let x = 1; x < 15; x++) for (let y = 9; y < 14; y++) t.set(x, y, y === 9 ? hex(0x2e3034) : y === 13 ? hex(0x3a3e44) : hex(0x6a6e74));
      for (let x = 2; x < 14; x += 4) t.set(x, 10, arrow);
      for (let i = 0; i < 3; i++) {
        t.set(10 + i, 4 + i, arrow);
        t.set(10 + i, 8 - i, arrow);
      }
      for (let x = 4; x < 13; x++) t.set(x, 6, arrow);
    });
  beltIcon('conveyor', hex(0xe8b820));
  beltIcon('express_conveyor', hex(0x30d8e8));
  const plateIcon = (id: string, mark: (t: Tex) => void): void =>
    r.add(id, (t) => {
      t.clear();
      for (let x = 1; x < 15; x++) for (let y = 4; y < 14; y++) t.set(x, y, y >= 12 ? hex(0x2a2c30) : hex(0x4a4e56));
      mark(t);
    });
  plateIcon('timer', (t) => {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      t.set(Math.round(7.5 + Math.cos(ang) * 3.5), Math.round(8 + Math.sin(ang) * 3), hex(0x40f0ff));
    }
  });
  plateIcon('logic_gate', (t) => label(t, 'AND', 6, hex(0x40f0ff)));
  plateIcon('level_sensor', (t) => {
    for (let k = 0; k < 3; k++) t.rect(5, 10 - k * 2, 6, 1, hex(0x40f0ff));
  });
  plateIcon('item_sensor', (t) => t.rect(6, 7, 4, 3, hex(0x40f0ff)));
  r.add('signal_cable', (t) => {
    t.clear();
    for (let i = 2; i < 14; i++) {
      t.set(i, 8, hex(0x20c0e0));
      t.set(i, 7, hex(0x40f0ff));
    }
    t.rect(6, 6, 4, 4, hex(0x40f0ff));
  });
  r.add('warning_light', (t) => {
    t.clear();
    t.rect(4, 12, 8, 3, hex(0x585e66));
    for (let y = 4; y < 12; y++) for (let x = 5; x < 11; x++) t.set(x, y, y < 6 ? hex(0xffe080) : hex(0xffa020));
    t.outline(hex(0x2a2e34));
  });
  r.add('hopper', (t) => {
    t.clear();
    t.rect(1, 2, 14, 5, hex(0x8a8e94));
    t.rect(4, 7, 8, 4, hex(0x7a7e84));
    t.rect(6, 11, 4, 3, hex(0x6a6e74));
    t.rect(3, 3, 10, 2, hex(0x2a2c30));
    t.outline(hex(0x3a3e44));
  });
  r.add('chute', (t) => {
    t.clear();
    t.rect(3, 1, 10, 14, hex(0x8a8e94));
    for (let y = 2; y < 14; y += 3) t.rect(5, y, 6, 1, hex(0x5a5e64));
    t.outline(hex(0x3a3e44));
  });
}
