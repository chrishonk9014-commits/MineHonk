/**
 * V5.5 - the Digital Corruption Update: textures for computers and their
 * peripherals, network cable and server racks, the blocks of the world
 * inside the computer (digital ground, circuit stone, data, wireframe,
 * server towers, cable bundles, screens of static, giant hard drives, tesla
 * coils, old terminals and Herobrine's core), and the computer parts.
 *
 * The computers are an old beige family (cases, keyboards, terminals); the
 * world inside is the Overworld drawn on graph paper: the same colours, cut
 * into pixels and traced with circuits.
 */
import { Tex, type RGB, hex, shade, mix } from './canvas';
import { bevel, frame, leaves } from './patterns';
import type { PainterRegistry } from './registry';

const BEIGE = hex(0xd6cdb6);
const BEIGE_D = hex(0xa69c84);
const BEIGE_L = hex(0xece5d2);
const BLACK = hex(0x16181b);
const SCREEN = hex(0x0b1a10);
const PHOS = hex(0x6cff8a);
const AMBER = hex(0xffbf4a);
const RED = hex(0xf03a30);
const CYAN = hex(0x3fe8ff);
const PCB = hex(0x1f6a3a);
const TRACE = hex(0x6ad88a);
const GOLD = hex(0xe0b840);
const STEEL = hex(0x9aa2ac);

/** Plastic: flat beige with a faint grain, light top-left edge, dark bottom-right. */
function plastic(t: Tex, base: RGB = BEIGE): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, 0.97 + t.rng.next() * 0.06));
  bevel(t, shade(base, 1.12), shade(base, 0.78));
}

/** Dark metal (servers, racks). */
function darkMetal(t: Tex, base = hex(0x2a2e34)): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, 0.92 + t.rng.next() * 0.12 + (x % 4 === 0 ? -0.04 : 0)));
  bevel(t, shade(base, 1.4), shade(base, 0.6));
}

/** Circuit traces wandering across a texture (deterministic per texture). */
function traces(t: Tex, col: RGB, n: number, pad?: RGB): void {
  for (let i = 0; i < n; i++) {
    let x = t.rng.int(16);
    let y = t.rng.int(16);
    const horiz = t.rng.next() < 0.5;
    const len = 4 + t.rng.int(8);
    for (let k = 0; k < len; k++) {
      t.set(x, y, col);
      if (k === Math.floor(len / 2) && t.rng.next() < 0.6) {
        // a right-angle turn
        if (horiz) y += t.rng.next() < 0.5 ? 1 : -1;
        else x += t.rng.next() < 0.5 ? 1 : -1;
      } else if (horiz) x++;
      else y++;
    }
    if (pad) t.set(x, y, pad);
  }
}

/** The pixel grid the computer world is drawn on. */
function grid(t: Tex, col: RGB, step = 4, a = 255): void {
  for (let i = 0; i < 16; i += step)
    for (let k = 0; k < 16; k++) {
      t.set(i, k, mix(t.get(i, k).slice(0, 3) as RGB, col, a / 255 * 0.5));
      t.set(k, i, mix(t.get(k, i).slice(0, 3) as RGB, col, a / 255 * 0.5));
    }
}

// ---------------------------------------------------------------------------
// Computers
// ---------------------------------------------------------------------------

/** The case front: a small status window, two drive bays and the power button. */
function computerFront(t: Tex, state: string, frameNo = 0): void {
  plastic(t);
  frame(t, BEIGE_D);
  // Status window
  t.rect(3, 2, 10, 5, BLACK);
  const win = (c: RGB, rows: number[]): void => {
    for (const y of rows) for (let x = 4; x < 12; x++) if ((x * 7 + y * 3 + frameNo) % 5 !== 0) t.set(x, y, c);
  };
  switch (state) {
    case 'off':
      t.rect(4, 3, 8, 3, hex(0x101410));
      break;
    case 'boot':
      win(AMBER, [3]);
      t.set(4, 5, AMBER);
      t.set(5, 5, AMBER);
      break;
    case 'on':
      t.rect(4, 3, 8, 3, SCREEN);
      win(PHOS, [3, 5]);
      break;
    case 'err':
      t.rect(4, 3, 8, 3, hex(0x200808));
      for (let i = 0; i < 3; i++) {
        t.set(6 + i, 3 + i, RED);
        t.set(8 - i, 3 + i, RED);
      }
      break;
    case 'glitch':
      for (let y = 3; y < 6; y++) for (let x = 4; x < 12; x++) t.set(x, y, t.rng.next() < 0.5 ? hex(0xffffff) : t.rng.next() < 0.5 ? RED : BLACK);
      break;
    case 'portal': {
      for (let y = 3; y < 6; y++)
        for (let x = 4; x < 12; x++) {
          const d = Math.hypot(x - 7.5, y - 4) + frameNo * 0.6;
          t.set(x, y, mix(CYAN, hex(0xffffff), (Math.sin(d * 2) + 1) / 2));
        }
      break;
    }
  }
  // Drive bays
  for (const y of [8, 10]) {
    t.rect(3, y, 10, 1, BEIGE_D);
    t.set(11, y, hex(0x3a3a3a));
  }
  // Power button and its light
  t.rect(6, 12, 3, 2, shade(BEIGE, 0.85));
  const led = state === 'off' ? hex(0x303030) : state === 'err' || state === 'glitch' ? RED : state === 'portal' ? CYAN : state === 'boot' ? AMBER : hex(0x40f060);
  t.set(10, 13, led);
  // The glitch spills over the case
  if (state === 'glitch') for (let i = 0; i < 10; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.next() < 0.5 ? hex(0xff2a6a) : CYAN);
  if (state === 'portal') for (let i = 0; i < 4; i++) t.set(2 + t.rng.int(12), 7 + t.rng.int(8), mix(CYAN, BEIGE, 0.5));
}

function computerSide(t: Tex): void {
  plastic(t);
  frame(t, BEIGE_D);
  for (let y = 4; y <= 11; y += 2) for (let x = 4; x <= 11; x++) t.set(x, y, shade(BEIGE, 0.72));
  t.rect(2, 13, 12, 1, shade(BEIGE, 0.9));
}

function computerTop(t: Tex): void {
  plastic(t);
  frame(t, BEIGE_D);
  t.rect(3, 3, 10, 10, shade(BEIGE, 0.96));
  for (let x = 5; x < 11; x += 2) t.rect(x, 5, 1, 6, shade(BEIGE, 0.8));
}

function keyboardTop(t: Tex): void {
  t.fill(BEIGE_D);
  bevel(t, shade(BEIGE, 1.05), shade(BEIGE_D, 0.8));
  // Rows of keys
  for (let row = 0; row < 4; row++)
    for (let k = 0; k < 7; k++) {
      const x = 1 + k * 2;
      const y = 4 + row * 2;
      t.set(x, y, BEIGE_L);
      t.set(x + 1, y, shade(BEIGE, 0.95));
    }
  t.rect(4, 12, 8, 1, BEIGE_L);
}

function mouseTop(t: Tex): void {
  t.fill(BEIGE);
  bevel(t, BEIGE_L, BEIGE_D);
  t.rect(7, 0, 1, 7, BEIGE_D);
  t.rect(0, 7, 16, 1, BEIGE_D);
  t.set(7, 2, hex(0x606060));
  t.set(7, 3, hex(0x606060));
}

function speakerSide(t: Tex): void {
  t.fill(hex(0x3a3d42));
  bevel(t, hex(0x5a5e64), hex(0x22252a));
  // The cone
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 9);
      if (d < 4.6) t.set(x, y, shade(hex(0x1c1e22), 0.8 + (d % 1.5 < 0.7 ? 0.25 : 0)));
      if (d < 1.4) t.set(x, y, hex(0x6a6e74));
    }
  t.set(7, 3, hex(0x8a8e94));
  t.set(8, 3, hex(0x8a8e94));
}

function ledHousing(t: Tex, lit: boolean): void {
  t.fill(hex(0x4a4e54));
  bevel(t, hex(0x6a6e74), hex(0x2a2e34));
  const c = lit ? hex(0x70ff80) : hex(0x1f4a28);
  t.rect(5, 5, 6, 6, shade(c, 0.85));
  t.rect(6, 6, 4, 4, c);
  if (lit) t.set(6, 6, hex(0xe8ffe8));
}

// ---------------------------------------------------------------------------
// The world inside the computer
// ---------------------------------------------------------------------------

function digitalDirt(t: Tex): void {
  const base = hex(0x6a4a34);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, 0.85 + t.rng.int(3) * 0.08));
  // Whole pixels of colour, aligned to a grid of 2
  for (let i = 0; i < 14; i++) {
    const x = t.rng.int(8) * 2;
    const y = t.rng.int(8) * 2;
    t.rect(x, y, 2, 2, shade(base, 0.7 + t.rng.next() * 0.5));
  }
  grid(t, hex(0x2aff9a), 4, 60);
}

function digitalGrassTop(t: Tex): void {
  const base = hex(0x3ab25a);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, 0.88 + t.rng.int(3) * 0.07));
  for (let i = 0; i < 12; i++) t.rect(t.rng.int(8) * 2, t.rng.int(8) * 2, 2, 2, shade(base, 0.75 + t.rng.next() * 0.45));
  grid(t, hex(0x9affd0), 4, 90);
}

function digitalGrassSide(t: Tex): void {
  digitalDirt(t);
  const g = hex(0x3ab25a);
  for (let x = 0; x < 16; x++) {
    const h = 3 + ((x >> 1) % 2);
    for (let y = 0; y < h; y++) t.set(x, y, shade(g, 0.9 + ((x + y) % 2) * 0.1));
  }
}

function digitalStone(t: Tex): void {
  const base = hex(0x7a8690);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, 0.9 + t.rng.int(3) * 0.06));
  for (let i = 0; i < 8; i++) t.rect(t.rng.int(4) * 4 + 1, t.rng.int(4) * 4 + 1, 2, 2, shade(base, 0.75));
  grid(t, hex(0xbfe8ff), 4, 70);
}

function digitalLog(t: Tex): void {
  const bark = hex(0x5a3e2a);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(bark, x % 4 === 0 ? 0.75 : 0.92 + t.rng.next() * 0.1));
  // Glowing circuit lines running up the trunk
  for (const x of [2, 9, 13]) for (let y = 0; y < 16; y++) if ((y + x) % 7 !== 0) t.set(x, y, mix(bark, hex(0x40ffa0), 0.55));
  t.set(9, 6, hex(0x9affd0));
  t.set(2, 11, hex(0x9affd0));
}

function digitalLogTop(t: Tex): void {
  t.fill(hex(0x8a6a48));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) t.set(x, y, hex(0x5a3e2a));
      else if (Math.floor(d) % 2 === 0) t.set(x, y, hex(0x7a5a3a));
    }
  t.rect(7, 7, 2, 2, hex(0x40ffa0));
}

function digitalLeaves(t: Tex): void {
  leaves(t, [hex(0x1e7a40), hex(0x2a9a52), hex(0x38b866), hex(0x56d080)], 0.1);
  // Square holes and cyan pixels: leaves made of data
  for (let i = 0; i < 6; i++) {
    const x = t.rng.int(8) * 2;
    const y = t.rng.int(8) * 2;
    t.rect(x, y, 2, 2, [0, 0, 0], 0);
  }
  for (let i = 0; i < 5; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x9affd0));
}

function circuitStone(t: Tex): void {
  const base = hex(0x2a3440);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, 0.9 + t.rng.next() * 0.15));
  traces(t, hex(0x3ad07a), 7, GOLD);
  for (let i = 0; i < 3; i++) {
    const x = 2 + t.rng.int(11);
    const y = 2 + t.rng.int(11);
    t.rect(x, y, 2, 2, hex(0x14181c));
    t.set(x, y, hex(0x8a8a8a));
  }
}

function dataBlock(t: Tex, f: number): void {
  t.fill(hex(0x0a3a48));
  // Columns of bits sliding down
  for (let x = 0; x < 16; x += 2)
    for (let y = 0; y < 16; y++) {
      const v = (x * 13 + ((y + f * (1 + (x % 3))) & 15) * 7) % 11;
      if (v < 4) t.set(x, y, v === 0 ? hex(0xe8ffff) : CYAN);
      else if (v < 6) t.set(x, y, hex(0x1a8aa0));
    }
  frame(t, hex(0x5af0ff));
}

function wireframe(t: Tex): void {
  t.clear();
  const c = hex(0x40f0a0);
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, c);
    t.set(i, 15, c);
    t.set(0, i, c);
    t.set(15, i, c);
  }
  for (let i = 1; i < 15; i += 3) {
    t.set(i, i, shade(c, 0.7));
  }
}

function serverFront(t: Tex, f: number, err = false): void {
  darkMetal(t);
  for (let row = 0; row < 4; row++) {
    const y = 2 + row * 3;
    t.rect(2, y, 12, 2, hex(0x15181c));
    for (let k = 0; k < 3; k++) {
      const on = (row * 5 + k * 3 + f) % 4 !== 0;
      t.set(3 + k * 2, y, on ? (err && k === 0 ? RED : k === 2 ? AMBER : hex(0x40f060)) : hex(0x203020));
    }
    t.rect(10, y, 3, 1, hex(0x3a3e44));
  }
}

function serverSide(t: Tex): void {
  darkMetal(t);
  for (let y = 2; y < 14; y += 2) for (let x = 3; x < 13; x++) t.set(x, y, hex(0x1a1d22));
}

function serverTop(t: Tex): void {
  darkMetal(t);
  t.rect(3, 3, 10, 10, hex(0x22262c));
  for (let x = 4; x < 12; x += 2) t.rect(x, 4, 1, 8, hex(0x15181c));
}

function cableBundleSide(t: Tex): void {
  const cols = [hex(0x1a1a1e), hex(0x2a3a8a), hex(0x8a2a2a), hex(0x2a6a3a), hex(0x1a1a1e), hex(0xd0b030), hex(0x1a1a1e), hex(0x6a6a6e)];
  for (let x = 0; x < 16; x++) {
    const c = cols[(x >> 1) % cols.length]!;
    for (let y = 0; y < 16; y++) t.set(x, y, shade(c, x % 2 === 0 ? 1.1 : 0.85));
  }
  for (const y of [3, 11]) t.rect(0, y, 16, 1, hex(0x0c0c0e));
}

function cableBundleTop(t: Tex): void {
  t.fill(hex(0x0c0c0e));
  const cols = [hex(0x2a3a8a), hex(0x8a2a2a), hex(0x2a6a3a), hex(0xd0b030), hex(0x6a6a6e), hex(0x1a1a1e)];
  for (let cy = 0; cy < 4; cy++)
    for (let cx = 0; cx < 4; cx++) {
      const c = cols[(cx * 3 + cy * 5) % cols.length]!;
      t.rect(cx * 4 + 1, cy * 4 + 1, 2, 2, c);
      t.set(cx * 4 + 1, cy * 4 + 1, shade(c, 1.4));
    }
}

function staticScreen(t: Tex, f: number): void {
  t.fill(BLACK);
  for (let y = 1; y < 15; y++)
    for (let x = 1; x < 15; x++) {
      const v = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + f * 37.7) * 43758.5453) % 1;
      t.set(x, y, v < 0.45 ? hex(0x1a1a1a) : v < 0.8 ? hex(0x9a9a9a) : hex(0xf0f0f0));
    }
  // A rolling bar
  const bar = (f * 3) % 16;
  for (let x = 1; x < 15; x++) t.set(x, bar, hex(0xd8d8d8));
  frame(t, hex(0x2a2e34));
}

function hddTop(t: Tex): void {
  t.fill(hex(0x8a929c));
  bevel(t, hex(0xb8c0c8), hex(0x5a626c));
  // The platter
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7, y - 7);
      if (d < 6.5) t.set(x, y, shade(hex(0xd8dce2), 0.85 + ((Math.floor(d * 2) % 2) * 0.1)));
      if (d < 1.5) t.set(x, y, hex(0x4a525c));
    }
  // The arm
  for (let i = 0; i < 6; i++) t.set(13 - i, 13 - Math.floor(i * 0.8), hex(0x2a2e34));
  t.set(13, 13, hex(0x6a727c));
}

function hddSide(t: Tex): void {
  t.fill(hex(0x9aa2ac));
  bevel(t, hex(0xc0c8d0), hex(0x5a626c));
  t.rect(3, 4, 10, 6, hex(0xe8e8e0));
  for (let x = 4; x < 12; x++) if (x % 3 !== 0) t.set(x, 6, hex(0x3a3a3a));
  t.rect(4, 8, 4, 1, RED);
  for (let x = 2; x < 14; x += 2) t.set(x, 13, hex(0xd0b030));
}

function teslaSide(t: Tex): void {
  t.fill(hex(0x2a2e34));
  for (let y = 1; y < 15; y++)
    for (let x = 3; x < 13; x++) {
      const copper = y % 2 === 0 ? hex(0xc8783a) : hex(0x9a5426);
      t.set(x, y, shade(copper, 0.85 + Math.sin((x - 3) / 9 * Math.PI) * 0.3));
    }
  for (let y = 0; y < 16; y++) {
    t.set(2, y, hex(0x15181c));
    t.set(13, y, hex(0x15181c));
  }
}

function teslaTop(t: Tex): void {
  t.fill(hex(0x2a2e34));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 5.5) t.set(x, y, mix(hex(0xe8f8ff), hex(0x4ab8ff), d / 5.5));
    }
  t.set(6, 6, hex(0xffffff));
}

function terminalFront(t: Tex): void {
  plastic(t, hex(0xc8bea0));
  t.rect(2, 2, 12, 9, BLACK);
  t.rect(3, 3, 10, 7, hex(0x1a1206));
  for (const y of [4, 6, 8]) for (let x = 4; x < 12; x++) if ((x * 3 + y) % 5 !== 0) t.set(x, y, AMBER);
  t.set(4, 8, hex(0xfff0c0));
  t.rect(3, 12, 10, 2, shade(hex(0xc8bea0), 0.82));
}

function coreTex(t: Tex, f: number, top: boolean): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = top ? Math.hypot(x - 7.5, y - 7.5) : Math.abs(x - 7.5) + Math.abs(((y + f) % 16) - 7.5) * 0.4;
      const pulse = (Math.sin(f * 0.8 - d * 0.7) + 1) / 2;
      t.set(x, y, mix(hex(0x7ad8ff), hex(0xffffff), pulse));
    }
  // Black circuit lines over the light
  for (let i = 0; i < 16; i += 5) {
    for (let k = 0; k < 16; k++) {
      t.set(i, k, hex(0x0a0a10));
      t.set(k, (i + 2) % 16, hex(0x0a0a10));
    }
  }
  frame(t, hex(0x0a0a10));
}

// ---------------------------------------------------------------------------

export function registerV55Blocks(r: PainterRegistry): void {
  // Computers
  r.add('computer_side', computerSide);
  r.add('computer_top', computerTop);
  r.add('computer_front', (t) => computerFront(t, 'off'));
  for (const s of ['off', 'boot', 'on', 'err']) r.add(`computer_front_${s}`, (t) => computerFront(t, s));
  r.anim('computer_front_glitch', 4, 2, (t, f) => computerFront(t, 'glitch', f));
  r.anim('computer_front_portal', 6, 2, (t, f) => computerFront(t, 'portal', f));
  r.add('keyboard', (t) => (t.fill(BEIGE_D), bevel(t, BEIGE, shade(BEIGE_D, 0.8))));
  r.add('keyboard_top', keyboardTop);
  r.add('mouse', (t) => (t.fill(BEIGE), bevel(t, BEIGE_L, BEIGE_D)));
  r.add('mouse_top', mouseTop);
  r.add('speaker', speakerSide);
  r.add('speaker_top', (t) => (t.fill(hex(0x3a3d42)), bevel(t, hex(0x5a5e64), hex(0x22252a))));
  r.add('led_light', (t) => ledHousing(t, false));
  r.add('led_light_top', (t) => ledHousing(t, false));
  r.add('led_light_on', (t) => ledHousing(t, true));
  r.add('network_cable', (t) => {
    const blue = hex(0x2a5ab8);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(blue, (x + y) % 6 < 2 ? 1.25 : 0.9 + t.rng.next() * 0.08));
    for (let i = 0; i < 16; i += 5) t.rect(0, i, 16, 1, hex(0xd8d8d8));
  });
  r.add('server_rack_side', serverSide);
  r.add('server_rack_top', serverTop);
  r.add('server_rack_front', (t) => serverFront(t, 99));
  r.anim('server_rack_front_on', 4, 4, (t, f) => serverFront(t, f));
  r.add('server_rack_front_err', (t) => serverFront(t, 2, true));
  // The world inside the computer
  r.add('digital_dirt', digitalDirt);
  r.add('digital_grass_top', digitalGrassTop);
  r.add('digital_grass_side', digitalGrassSide);
  r.add('digital_stone', digitalStone);
  r.add('digital_log', digitalLog);
  r.add('digital_log_top', digitalLogTop);
  r.add('digital_leaves', digitalLeaves);
  r.add('circuit_stone', circuitStone);
  r.anim('data_block', 8, 3, (t, f) => dataBlock(t, f));
  r.add('wireframe_block', wireframe);
  r.add('server_tower_side', serverSide);
  r.add('server_tower_top', serverTop);
  r.anim('server_tower_front', 4, 5, (t, f) => serverFront(t, f));
  r.add('cable_bundle', cableBundleSide);
  r.add('cable_bundle_top', cableBundleTop);
  r.anim('static_screen', 6, 1, (t, f) => staticScreen(t, f));
  r.add('giant_hard_drive_top', hddTop);
  r.add('giant_hard_drive_side', hddSide);
  r.add('tesla_coil_side', teslaSide);
  r.add('tesla_coil_top', teslaTop);
  r.add('old_terminal_side', (t) => (plastic(t, hex(0xc8bea0)), frame(t, shade(hex(0xc8bea0), 0.7))));
  r.add('old_terminal_top', (t) => {
    plastic(t, hex(0xc8bea0));
    for (let x = 4; x < 12; x += 2) t.rect(x, 3, 1, 10, shade(hex(0xc8bea0), 0.8));
  });
  r.add('old_terminal_front', terminalFront);
  r.anim('herobrine_core_side', 8, 2, (t, f) => coreTex(t, f, false));
  r.anim('herobrine_core_top', 8, 2, (t, f) => coreTex(t, f, true));
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function item(r: PainterRegistry, id: string, rows: string[], pal: Record<string, RGB>, after?: (t: Tex) => void): void {
  r.add(id, (t) => {
    t.clear();
    t.mask(rows, pal);
    after?.(t);
  });
}

export function registerV55Items(r: PainterRegistry): void {
  const o = hex(0x101214);
  item(
    r,
    'circuit_board',
    [
      '................',
      '..oooooooooooo..',
      '..oggggggggggo..',
      '..ogtttgggykgo..',
      '..oggggtggkkgo..',
      '..ogccgtggggto..',
      '..ogccgttttgto..',
      '..oggggggggtgo..',
      '..ogttttgggtgo..',
      '..ogtgggccgggo..',
      '..ogtgggccgggo..',
      '..oggyggggttgo..',
      '..oggggggggggo..',
      '..oooooooooooo..',
      '................',
      '................',
    ],
    { o, g: PCB, t: TRACE, c: hex(0x1a1a1e), y: GOLD, k: hex(0x2a2a2e) },
  );
  item(
    r,
    'electronic_components',
    [
      '................',
      '...........oo...',
      '..........obbo..',
      '..........obbo..',
      '..s.......obbo..',
      '..s........oo...',
      '.oro........s...',
      '.oyo........s...',
      '.oro....ooo.....',
      '.oko...occco....',
      '..s....ocyco....',
      '..s....occco....',
      '........ooo.....',
      '........s.s.....',
      '........s.s.....',
      '................',
    ],
    { o, s: STEEL, r: hex(0xd0a070), y: hex(0x8a3a2a), k: hex(0x3a6ad0), b: hex(0x2a4a9a), c: hex(0x1a1a1e) },
  );
  item(
    r,
    'connector',
    [
      '................',
      '................',
      '.....ssss.......',
      '.....s..s.......',
      '....oooooo......',
      '....oggggo......',
      '....oggggo......',
      '....oggggo......',
      '.....oggo.......',
      '......kk........',
      '......kk........',
      '.......kk.......',
      '........kk......',
      '.........kk.....',
      '................',
      '................',
    ],
    { o, s: STEEL, g: hex(0x3a3d42), k: hex(0x2a5ab8) },
  );
  item(
    r,
    'power_supply',
    [
      '................',
      '.oooooooooooooo.',
      '.ommmmmmmmmmmmo.',
      '.omkkkkkmmmmmmo.',
      '.omkfkfkmmyymmo.',
      '.omkkfkkmmyymmo.',
      '.omkfkfkmmmmmmo.',
      '.omkkkkkmmmmmmo.',
      '.ommmmmmmmmmmmo.',
      '.oooooooooooooo.',
      '..........yy....',
      '...........yy...',
      '............yy..',
      '.............yy.',
      '................',
      '................',
    ],
    { o, m: hex(0x8a929c), k: hex(0x2a2e34), f: hex(0x5a626c), y: hex(0xd8b020) },
  );
  item(
    r,
    'motherboard',
    [
      '................',
      '.oooooooooooooo.',
      '.oggggggggggggo.',
      '.ogcccgwwwwwwgo.',
      '.ogcccgggggggto.',
      '.ogcccgwwwwwwgo.',
      '.ogggggggggggto.',
      '.ogtttgggggggto.',
      '.oggggggbbbbggo.',
      '.ogyygggbbbbggo.',
      '.ogyyggggggggto.',
      '.ogggttttttgggo.',
      '.oggggggggggggo.',
      '.oooooooooooooo.',
      '................',
      '................',
    ],
    { o, g: PCB, t: TRACE, c: hex(0xc8ccd0), w: hex(0x1a1a1e), b: hex(0x2a4a9a), y: GOLD },
  );
  item(
    r,
    'cpu',
    [
      '................',
      '...y.y.y.y.y....',
      '..oooooooooooo..',
      '.yossssssssssoy.',
      '..osllllllllso..',
      '.yoslllllllsoy..',
      '..osllkkkllso...',
      '.yosllkkkllsoy..',
      '..osllllllllso..',
      '.yossssssssssoy.',
      '..oooooooooooo..',
      '...y.y.y.y.y....',
      '................',
      '................',
      '................',
      '................',
    ],
    { o, s: hex(0x8a929c), l: hex(0xc8ccd2), k: hex(0x5a626c), y: GOLD },
  );
  item(
    r,
    'ram_module',
    [
      '................',
      '................',
      '................',
      '................',
      'oooooooooooooooo',
      'oggggggggggggggo',
      'ogkkgkkgkkgkkggo',
      'ogkkgkkgkkgkkggo',
      'oggggggggggggggo',
      'oyyyyyyy.yyyyyyo',
      'oooooooo.ooooooo',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    { o, g: PCB, k: hex(0x1a1a1e), y: GOLD },
  );
  item(
    r,
    'gpu',
    [
      '................',
      '................',
      '.oooooooooooooo.',
      '.ommmmmmmmmmmmo.',
      '.omffffmmffffmo.',
      '.omfkkfmmfkkfmo.',
      '.omfkkfmmfkkfmo.',
      '.omffffmmffffmo.',
      '.ommmmmmmmmmmmo.',
      '.oooooooooooooo.',
      '.ogggggggggggg..',
      '.oyyyyyy.yyyy...',
      '................',
      '................',
      '................',
      '................',
    ],
    { o, m: hex(0x2a2e34), f: hex(0x5a626c), k: hex(0x15181c), g: PCB, y: GOLD },
  );
  item(
    r,
    'network_card',
    [
      '................',
      '................',
      '..oooooooooooo..',
      '..oggggggggggo..',
      '..ogkkggggggso..',
      '..ogkkggtttgso..',
      '..oggggggggsso..',
      '..ogtttgggssso..',
      '..oggggggggsso..',
      '..oooooooooooo..',
      '...yyyyyy.yy....',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    { o, g: PCB, k: hex(0x1a1a1e), t: TRACE, s: STEEL, y: GOLD },
  );
  item(
    r,
    'hard_drive',
    [
      '................',
      '................',
      '..oooooooooooo..',
      '..osssssssssso..',
      '..osdddddddsso..',
      '..osdddkkddsso..',
      '..osdddkkddsso..',
      '..osdddddddsso..',
      '..ossssssssaso..',
      '..oswwwwwwssso..',
      '..oswrrwwwssso..',
      '..osssssssssso..',
      '..oyoyoyoyoyoo..',
      '................',
      '................',
      '................',
    ],
    { o, s: hex(0x9aa2ac), d: hex(0xd8dce2), k: hex(0x4a525c), a: hex(0x2a2e34), w: hex(0xe8e8e0), r: RED, y: GOLD },
  );
  const drive = [
    '................',
    '................',
    '................',
    '..........ooo...',
    '.........ossso..',
    '........osooso..',
    '.......obbossbo.',
    '......obbbbbbo..',
    '.....obbhbbbo...',
    '....obbbbbbo....',
    '...obbbbbbo.....',
    '..obbbbbbo......',
    '..obbbbbo.......',
    '..obbbbo........',
    '...oooo.........',
    '................',
  ];
  item(r, 'flash_drive', drive, { o, s: STEEL, b: hex(0x2a6ad8), h: hex(0x9ac8ff) });
  item(r, 'corrupted_flash_drive', drive, { o, s: hex(0x6a6e74), b: hex(0x0c160e), h: hex(0x18ff6a) }, (t) => {
    // Green data leaking out, magenta dead pixels
    for (const [x, y] of [
      [4, 11],
      [6, 9],
      [8, 7],
      [5, 12],
      [9, 8],
    ] as const)
      t.set(x, y, hex(0x18ff6a));
    t.set(7, 10, hex(0xff2bd6));
    t.set(10, 6, hex(0xff2bd6));
    t.set(13, 2, hex(0x18ff6a));
    t.set(14, 1, hex(0x9dffb8));
  });
  item(
    r,
    'witch_grimoire',
    [
      '................',
      '...oooooooooo...',
      '..oppppppppppo..',
      '..opPPPPPPPPpow.',
      '..opPPPPPPPPpow.',
      '..opPPPeePPPpow.',
      '..opPPeiieePpow.',
      '..opPPPeePPPpow.',
      '..opPPPPPPPPpow.',
      '..opPPPllPPPpow.',
      '..opPPPllPPPpow.',
      '..opPPPPPPPPpow.',
      '..oppppppppppow.',
      '...oooooooooow..',
      '....wwwwwwwww...',
      '................',
    ],
    { o: hex(0x14081a), p: hex(0x3a1a4a), P: hex(0x2a1036), e: hex(0x9a7ab8), i: hex(0xffffff), l: hex(0x6a3a8a), w: hex(0xd8d0bc) },
  );
}


