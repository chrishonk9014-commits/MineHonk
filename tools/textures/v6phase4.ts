/**
 * V6 - The End Expansion, phase 4: textures for End engineering, transport
 * and the quests.
 *
 * The End's machines share one casing: dark violet plate trimmed with Ender
 * Alloy teal, nothing like the grey and copper of the Overworld's. Each front
 * has its own pictogram in a recessed panel and a status lamp (dark idle,
 * lit while working, red on an error). The restored ancient machines keep
 * the old civilization's brass and stone.
 */
import { Tex, type RGB, hex, mix, shade } from './canvas';
import { bevel, blotchy, frame } from './patterns';
import type { PainterRegistry } from './registry';

type Lamp = 'off' | 'on' | 'err';

const CASE: RGB[] = [hex(0x241e32), hex(0x2a2338), hex(0x30283f), hex(0x362d46)];
const PANEL = hex(0x130f1c);
const TRIM = hex(0x3a8a86);
const TRIM_LIGHT = hex(0x7ad8cc);
const GREEN = hex(0x5ae07a);
const RED = hex(0xe04848);
const BRASS = hex(0x8a7a5a);
const ANCIENT_STONE: RGB[] = [hex(0x3a3444), hex(0x403848), hex(0x463e50)];

/** The End casing: plate with a teal trim line and corner rivets. */
function body(t: Tex): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(t.rng.pick(CASE), 0.95 + t.rng.next() * 0.1));
  bevel(t, shade(CASE[3]!, 1.3), shade(CASE[0]!, 0.65));
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]] as const) t.set(x, y, TRIM_LIGHT);
}

function side(t: Tex, accent: RGB): void {
  body(t);
  // Vents with a faint glow of the machine's colour behind them
  for (let y = 4; y <= 11; y += 2) for (let x = 4; x < 12; x++) t.set(x, y, mix(PANEL, accent, 0.25));
  for (let x = 2; x < 14; x++) t.set(x, 13, TRIM);
}

function top(t: Tex, accent: RGB): void {
  body(t);
  t.rect(4, 4, 8, 8, PANEL);
  frame(t, TRIM, 3);
  t.rect(6, 6, 4, 4, mix(PANEL, accent, 0.4));
  t.set(7, 7, accent);
}

/** 8x8 pictograms ('#' lit, '+' half lit). */
const GLYPH: Record<string, string[]> = {
  crystal_generator: ['...##...', '..#++#..', '.#+##+#.', '.#+##+#.', '..#++#..', '...##...', '.+.++.+.', '..++++..'],
  void_collector: ['.######.', '#......#', '#.####.#', '#.#..#.#', '#.#.##.#', '#.#....#', '#.######', '+.+.+.+.'],
  restored_ancient_core: ['########', '#......#', '#.####.#', '#.#++#.#', '#.#++#.#', '#.####.#', '#......#', '########'],
  end_processor: ['+#+..+#+', '###..###', '+#+..+#+', '........', '#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '........'],
  crystal_grower: ['....#...', '...##...', '...#+#..', '..#++#..', '..#+#...', '...#....', '.######.', '########'],
  ender_bridge_projector: ['..####..', '.#++++#.', '#++##++#', '#+####+#', '#+####+#', '#++##++#', '.#++++#.', '..####..'],
};

const ACCENT: Record<string, RGB> = {
  crystal_generator: hex(0xd090ff),
  void_collector: hex(0x6a5ad8),
  restored_ancient_core: hex(0xb88aff),
  end_processor: hex(0x5ad8c8),
  crystal_grower: hex(0xe0b0ff),
  ender_bridge_projector: hex(0x9ae8ff),
  teleport_node: hex(0x7ae0ff),
};

function front(t: Tex, id: string, lamp: Lamp, ancient = false): void {
  if (ancient) {
    blotchy(t, ANCIENT_STONE, 1, 0.6);
    frame(t, BRASS);
  } else body(t);
  const accent = ACCENT[id]!;
  t.rect(2, 2, 12, 10, PANEL);
  for (let x = 2; x < 14; x++) t.set(x, 11, ancient ? shade(BRASS, 0.8) : TRIM);
  const g = GLYPH[id];
  const lit = lamp === 'on' ? mix(accent, hex(0xffffff), 0.3) : lamp === 'err' ? shade(accent, 0.4) : shade(accent, 0.55);
  const half = lamp === 'on' ? accent : shade(accent, lamp === 'err' ? 0.3 : 0.4);
  if (g)
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const c = g[y]![x];
        if (c === '#') t.set(4 + x, 3 + y, lit);
        else if (c === '+') t.set(4 + x, 3 + y, half);
      }
  if (lamp === 'on') for (let y = 2; y < 11; y++) for (let x = 3; x < 13; x++) if (t.get(x, y)[0] === PANEL[0] && t.get(x, y)[2] === PANEL[2]) t.set(x, y, mix(PANEL, accent, 0.14));
  const lc = lamp === 'on' ? GREEN : lamp === 'err' ? RED : hex(0x3a3444);
  t.rect(11, 13, 2, 2, lc);
  t.set(11, 13, lamp === 'off' ? hex(0x544a64) : mix(lc, hex(0xffffff), 0.5));
  t.set(3, 13, TRIM_LIGHT);
  t.set(5, 13, TRIM);
}

/** A rail: two rails on sleepers (a corner bends round from the south to the east). */
function rail(t: Tex, ties: RGB, steel: RGB, corner = false, glow?: RGB): void {
  t.clear();
  if (!corner) {
    for (let y = 1; y < 16; y += 4) for (let x = 1; x < 15; x++) t.set(x, y, shade(ties, 0.9 + t.rng.next() * 0.2));
    for (let y = 1; y < 16; y += 4) for (let x = 1; x < 15; x++) t.set(x, y + 1, shade(ties, 0.75));
    for (let y = 0; y < 16; y++) {
      t.set(3, y, steel);
      t.set(4, y, shade(steel, 0.75));
      t.set(11, y, steel);
      t.set(12, y, shade(steel, 0.75));
      if (glow && y % 3 === 1) t.set(7 + (y % 2), y, glow);
    }
    return;
  }
  // Curving from the south edge round to the east edge: sleepers fan out, the rails are two arcs
  const cx = 15.5;
  const cy = 15.5;
  for (let s = 0; s < 4; s++) {
    for (const da of [-0.07, 0, 0.07]) {
      const ang = ((s + 0.5) / 4) * (Math.PI / 2) + da;
      for (let rr = 3; rr <= 14; rr += 0.2) {
        const x = Math.floor(cx - Math.cos(ang) * rr);
        const y = Math.floor(cy - Math.sin(ang) * rr);
        if (x >= 0 && y >= 0 && x < 16 && y < 16) t.set(x, y, shade(ties, da === 0 ? 0.95 : 0.78));
      }
    }
  }
  for (let a = 0; a <= 96; a++) {
    const ang = (a / 96) * (Math.PI / 2);
    for (const [rr, c] of [[4.5, steel], [5.3, shade(steel, 0.75)], [11.5, steel], [12.3, shade(steel, 0.75)]] as const) {
      const x = Math.floor(cx - Math.cos(ang) * rr);
      const y = Math.floor(cy - Math.sin(ang) * rr);
      if (x >= 0 && y >= 0 && x < 16 && y < 16) t.set(x, y, c);
    }
  }
}

export function registerV6Phase4Blocks(r: PainterRegistry): void {
  // --- Machines (idle, working, error fronts) ---------------------------------
  for (const id of ['crystal_generator', 'void_collector', 'end_processor', 'crystal_grower', 'ender_bridge_projector']) {
    r.add(`${id}_side`, (t) => side(t, ACCENT[id]!));
    r.add(`${id}_top`, (t) => top(t, ACCENT[id]!));
    r.add(`${id}_front`, (t) => front(t, id, 'off'));
    r.add(`${id}_front_on`, (t) => front(t, id, 'on'));
    r.add(`${id}_front_err`, (t) => front(t, id, 'err'));
  }
  // The Void Collector looks down at the void: a dark well on top
  r.add('void_collector_top', (t) => {
    body(t);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 5.6) t.set(x, y, mix(hex(0x05030a), hex(0x3a2a7a), Math.max(0, (d - 2) / 4)));
    }
    t.set(7, 7, hex(0x8a7aff));
  });
  // The grower's top is where the crystal shows through
  r.add('crystal_grower_top', (t) => {
    top(t, ACCENT.crystal_grower!);
    for (const [x, y] of [[7, 5], [8, 6], [6, 7], [9, 8], [7, 9]] as const) t.set(x, y, hex(0xf0d8ff));
  });
  // The restored Ancient Core keeps the old brass and stone
  r.add('restored_ancient_core_side', (t) => {
    blotchy(t, ANCIENT_STONE, 1, 0.6);
    frame(t, BRASS);
    for (const i of [4, 11]) for (let k = 1; k < 15; k++) t.set(i, k, shade(BRASS, 0.8));
    t.rect(6, 5, 4, 6, hex(0xb88aff));
    t.rect(7, 6, 2, 4, hex(0xf0e0ff));
  });
  r.add('restored_ancient_core_top', (t) => {
    blotchy(t, ANCIENT_STONE, 1, 0.6);
    frame(t, BRASS);
    frame(t, shade(BRASS, 0.7), 3);
    t.rect(6, 6, 4, 4, hex(0xd8b8ff));
  });
  for (const [n, lamp] of [['', 'off'], ['_on', 'on'], ['_err', 'err']] as const) r.add(`restored_ancient_core_front${n}`, (t) => front(t, 'restored_ancient_core', lamp, true));
  // --- The Void Cell (a battery: its side shows its charge) --------------------
  const cellSide = (charge: number) => (t: Tex) => {
    body(t);
    t.rect(4, 2, 8, 12, PANEL);
    for (let k = 0; k < 4; k++) {
      const on = k < charge;
      for (let x = 5; x < 11; x++) for (let y = 11 - k * 3; y < 13 - k * 3; y++) t.set(x, y, on ? mix(hex(0x5a3ad8), hex(0xd0c0ff), k / 4 + t.rng.next() * 0.1) : hex(0x221a30));
    }
    for (let y = 2; y < 14; y++) {
      t.set(3, y, TRIM);
      t.set(12, y, TRIM);
    }
  };
  r.add('void_cell_side', cellSide(0));
  for (let c = 0; c <= 4; c++) r.add(`void_cell_side_${c}`, cellSide(c));
  r.add('void_cell_top', (t) => {
    body(t);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if (Math.hypot(x - 7.5, y - 7.5) < 4.6) t.set(x, y, mix(hex(0x0a0614), hex(0x4a3aa8), Math.hypot(x - 7.5, y - 7.5) / 5));
    frame(t, TRIM, 1);
  });
  // --- The Teleportation Node: a pad with a ring that lights ----------------------
  r.add('teleport_node_side', (t) => {
    body(t);
    for (let x = 1; x < 15; x++) {
      t.set(x, 3, TRIM);
      t.set(x, 4, shade(TRIM, 0.7));
    }
    t.rect(6, 8, 4, 4, PANEL);
    t.set(7, 9, ACCENT.teleport_node!);
  });
  const pad = (lamp: Lamp) => (t: Tex) => {
    body(t);
    const ring = lamp === 'on' ? hex(0xb8f4ff) : lamp === 'err' ? hex(0x8a2a3a) : hex(0x2a5a64);
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      t.set(Math.round(7.5 + Math.cos(ang) * 5.5), Math.round(7.5 + Math.sin(ang) * 5.5), ring);
    }
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3.4) t.set(x, y, lamp === 'on' ? mix(hex(0x1a4a6a), hex(0x9ae8ff), 1 - Math.hypot(x - 7.5, y - 7.5) / 3.4) : PANEL);
    if (lamp === 'err') for (let i = 5; i < 11; i++) t.set(i, i, RED);
  };
  r.add('teleport_node_top', pad('off'));
  r.add('teleport_node_top_on', pad('on'));
  r.add('teleport_node_top_err', pad('err'));
  // --- Rails ---------------------------------------------------------------------
  r.add('rail', (t) => rail(t, hex(0x6a4a2a), hex(0x9a9ea4)));
  r.add('rail_corner', (t) => rail(t, hex(0x6a4a2a), hex(0x9a9ea4), true));
  r.add('powered_rail', (t) => rail(t, hex(0x6a4a2a), hex(0xd8b040), false, hex(0x5a1a14)));
  r.add('powered_rail_on', (t) => rail(t, hex(0x6a4a2a), hex(0xe8c050), false, hex(0xff4a2a)));
  r.add('ender_rail', (t) => rail(t, hex(0x2a2338), hex(0x3a8a86), false, hex(0x1a3a40)));
  r.add('ender_rail_on', (t) => rail(t, hex(0x2a2338), hex(0x7ad8cc), false, hex(0xc0ffff)));
  // --- Ender Light (the bridge) and the ancient gateway's sheet ----------------
  r.add('ender_light', (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const e = Math.min(x, y, 15 - x, 15 - y);
      t.set(x, y, e === 0 ? hex(0xc8f8ff) : mix(hex(0x5ac8e8), hex(0x9ae8ff), t.rng.next() * 0.4), e === 0 ? 220 : 120);
    }
    for (let i = 0; i < 6; i++) t.set(1 + t.rng.int(14), 1 + t.rng.int(14), hex(0xffffff), 200);
  });
  // Fading (power lost): fainter and fainter
  for (const f of [1, 2, 3])
    r.add(`ender_light_${f}`, (t) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const e = Math.min(x, y, 15 - x, 15 - y);
        t.set(x, y, e === 0 ? hex(0xc8f8ff) : mix(hex(0x5ac8e8), hex(0x9ae8ff), t.rng.next() * 0.4), Math.round((e === 0 ? 200 : 100) * (1 - f * 0.25)));
      }
    });
  r.anim('ancient_gateway', 16, 3, (t, f) => {
    // Old gold motes drifting through a dark violet sheet (unlike the classic gateway's starfield)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = Math.sin((x + f) * 0.7) * 0.5 + Math.sin((y - f * 0.5) * 0.9 + x * 0.2) * 0.5;
      t.set(x, y, mix(hex(0x1a0e2a), hex(0x5a3a8a), v * 0.5 + 0.5), 200);
    }
    for (let i = 0; i < 5; i++) {
      const x = (i * 5 + f) % 16;
      const y = (i * 7 + f * 2) % 16;
      t.set(x, y, hex(0xe8c878), 230);
    }
  });
  // --- The restored Ancient Lens, the Crystal Vault's pedestals and the reliquary -------
  const lensTex = (lit: boolean) => (t: Tex) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      t.set(x, y, lit ? mix(hex(0xf0f8ff), hex(0x7ab8ff), d / 11) : mix(hex(0xb8d8ff), hex(0x5a6a9a), d / 11), lit ? 220 : 170);
    }
    frame(t, BRASS);
    if (lit) for (const [x, y] of [[7, 4], [11, 7], [8, 11], [4, 8]] as const) t.set(x, y, hex(0xffffff));
  };
  r.add('restored_ancient_lens', lensTex(false));
  r.add('restored_ancient_lens_on', lensTex(true));
  r.add('crystal_pedestal', (t) => {
    blotchy(t, [hex(0xd8c8f0), hex(0xe4d8f8), hex(0xcabce4)], 1, 0.5);
    frame(t, hex(0xa898b8));
    for (let x = 1; x < 15; x++) t.set(x, 5, hex(0xb0a0c8));
  });
  r.add('crystal_pedestal_top', (t) => {
    blotchy(t, [hex(0xd8c8f0), hex(0xe4d8f8)], 1, 0.5);
    frame(t, hex(0xa898b8));
    t.rect(5, 5, 6, 6, hex(0x8a7aa8));
  });
  r.add('crystal_pedestal_on', (t) => {
    blotchy(t, [hex(0xf0e4ff), hex(0xfaf0ff)], 1, 0.5);
    frame(t, hex(0xe0a8ff));
    t.rect(5, 5, 6, 6, hex(0xffe0ff));
  });
  r.add('ancient_reliquary', (t) => {
    blotchy(t, [hex(0x8a7a5a), hex(0x7a6a4a), hex(0x96865e)], 1, 0.6);
    for (let x = 0; x < 16; x++) {
      t.set(x, 3, hex(0x5a4a34));
      t.set(x, 12, hex(0x5a4a34));
    }
    for (const [x, y] of [[5, 7], [7, 6], [9, 8], [11, 7]] as const) t.set(x, y, hex(0xc8a8ff));
  });
  r.add('ancient_reliquary_top', (t) => {
    blotchy(t, [hex(0x8a7a5a), hex(0x96865e)], 1, 0.5);
    frame(t, hex(0x5a4a34));
    t.rect(5, 5, 6, 6, hex(0x6a5a40));
    t.rect(7, 7, 2, 2, hex(0xc8a8ff));
  });
  r.add('ancient_reliquary_open', (t) => {
    blotchy(t, [hex(0x8a7a5a), hex(0x96865e)], 1, 0.5);
    frame(t, hex(0x5a4a34));
    t.rect(4, 4, 8, 8, hex(0x1a1410));
  });
}

type Pal = Record<string, RGB>;

export function registerV6Phase4Items(r: PainterRegistry, pm: (t: Tex, mask: string, pal: Pal) => void, mp: (base: RGB, outline?: number) => Pal): void {
  // Vehicles and the blueprint
  r.add('minecart', (t) => {
    t.clear();
    const steel = hex(0x8a8e94);
    for (let x = 2; x < 14; x++) for (let y = 6; y < 12; y++) t.set(x, y, x === 2 || x === 13 || y === 11 ? shade(steel, 0.6) : y === 6 ? shade(steel, 1.2) : steel);
    for (let x = 3; x < 13; x++) t.set(x, 7, hex(0x3a3c40));
    for (const cx of [4, 11]) for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) t.set(cx + k, 12 + j, hex(0x2a2a2e));
  });
  r.add('void_skiff', (t) => {
    t.clear();
    const hull = hex(0x7a4a8a);
    for (let x = 1; x < 15; x++) {
      const depth = x < 3 || x > 12 ? 1 : 2;
      for (let y = 10; y < 10 + depth + 1; y++) t.set(x, y, y === 10 ? shade(hull, 1.2) : shade(hull, 0.75));
    }
    for (let y = 2; y < 10; y++) t.set(7, y, hex(0x4a3a2a));
    for (let y = 3; y < 9; y++) for (let x = 8; x < 8 + Math.min(5, y - 1); x++) t.set(x, y, mix(hex(0xd8c8e8), hex(0xb0a0c8), (x - 8) / 5));
    t.set(3, 9, hex(0x6a5ad8));
    t.set(12, 9, hex(0x6a5ad8));
  });
  r.add('void_skiff_blueprint', (t) => {
    pm(t, 'sheet', mp(hex(0x2a4a8a)));
    for (let x = 4; x < 12; x++) if (t.alpha(x, 9)) t.set(x, 9, hex(0xd8f0ff));
    for (let y = 4; y < 9; y++) if (t.alpha(8, y)) t.set(8, y, hex(0xd8f0ff));
    for (const [x, y] of [[9, 5], [10, 6], [9, 7]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xd8f0ff));
  });
  // Elytra modules: a membrane disc with each one's mark
  const module = (id: string, base: number, mark: (t: Tex) => void): void =>
    r.add(id, (t) => {
      pm(t, 'disc', mp(hex(base)));
      mark(t);
    });
  module('reinforced_module', 0x5a6a7a, (t) => {
    for (let i = 4; i < 12; i++) for (const k of [5, 10]) if (t.alpha(i, k)) t.set(i, k, hex(0x3a8a86));
  });
  module('thrust_module', 0x4a7ab0, (t) => {
    for (let i = 0; i < 4; i++) for (const ox of [5, 9]) if (t.alpha(ox + i % 2, 4 + i)) t.set(ox + (i % 2), 4 + i, hex(0xffe0a0));
  });
  module('hover_module', 0x8a6ab0, (t) => {
    for (const [x, y] of [[6, 5], [7, 6], [8, 7], [9, 6], [10, 5], [7, 9], [8, 10], [9, 9]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xf0d8ff));
  });
  module('burst_module', 0x3a3a7a, (t) => {
    for (const [x, y] of [[7, 3], [8, 3], [7, 4], [8, 5], [9, 6], [6, 7], [7, 8], [8, 9], [7, 10]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xa8f0ff));
  });
  module('ender_blink_module', 0x2a5a4a, (t) => {
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.hypot(x - 7.5, y - 7.5) < 2.6 && t.alpha(x, y)) t.set(x, y, hex(0x7ae0a0));
    if (t.alpha(7, 7)) t.set(7, 7, hex(0x0a1a14));
  });
  r.add('sanctum_dragon_scale', (t) => {
    pm(t, 'scale', mp(hex(0x2a1a3a)));
    for (const [x, y] of [[6, 5], [8, 6], [7, 8], [9, 9], [6, 10]] as const) if (t.alpha(x, y)) t.set(x, y, hex(0xe0b0ff));
  });
  // The Silent City
  r.add('ancient_key', (t) => {
    t.clear();
    const brass = hex(0x9a8a68);
    const dark = shade(brass, 0.55);
    // The bow: a thick ring with a violet stone
    for (let y = 1; y < 9; y++)
      for (let x = 1; x < 9; x++) {
        const d = Math.hypot(x - 4.5, y - 4.5);
        if (d < 3.6 && d > 1.6) t.set(x, y, d > 2.9 ? dark : brass);
      }
    t.set(4, 4, hex(0xc8a8ff));
    t.set(5, 5, hex(0xa080e0));
    // The shaft, two pixels thick, and the bit
    for (let i = 0; i < 8; i++) {
      t.set(7 + i, 7 + i, brass);
      if (8 + i < 16) t.set(8 + i, 7 + i, dark);
    }
    for (const [x, y] of [[11, 13], [12, 14], [10, 12], [13, 10], [14, 11]] as const) t.set(x, y, brass);
    t.set(9, 9, hex(0xc8a8ff));
  });
  r.add('silent_bell', (t) => {
    t.clear();
    const bronze = hex(0x6a5a7a);
    for (let y = 3; y < 13; y++) {
      const w = Math.round(2 + (y - 3) * 0.55);
      for (let x = 8 - w; x < 8 + w; x++) t.set(x, y, x === 8 - w || x === 7 + w ? shade(bronze, 0.6) : mix(bronze, hex(0xb0a0c8), (y - 3) / 14));
    }
    for (let x = 2; x < 14; x++) t.set(x, 12, shade(bronze, 0.5));
    t.set(7, 2, shade(bronze, 0.7));
    t.set(8, 2, shade(bronze, 0.7));
    t.set(7, 13, hex(0x2a2238));
    t.set(8, 13, hex(0x2a2238));
  });
}
