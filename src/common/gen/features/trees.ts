/**
 * Tree and large-plant generators. Used by world generation (through a
 * clipping writer) and by sapling growth on the server.
 */
import type { Random } from '../../math/rng';
import { S, stateOf, STATE_REPLACEABLE, STATE_BLOCK, blocks, blockHasTag, withProp } from '../../registry/blocks';
import type { TreeKind } from '../../data/biomes';

export interface TreeReader {
  /** Reads used for placement decisions (world generation passes pure terrain here). */
  getState(x: number, y: number, z: number): number;
  /** Reads used when deciding whether a single block may be overwritten (defaults to getState). */
  current?(x: number, y: number, z: number): number;
}
export type TreeSetter = (x: number, y: number, z: number, state: number) => void;

interface Ctx {
  r: TreeReader;
  cur: (x: number, y: number, z: number) => number;
  set: TreeSetter;
  rng: Random;
}

function replaceableForLog(s: number): boolean {
  if (s === 0 || STATE_REPLACEABLE[s]) return true;
  const def = blocks[STATE_BLOCK[s]!]!.def;
  return !!def.tags?.includes('leaves') || !!def.tags?.includes('saplings') || def.model === 'cross' || def.model === 'vine' || def.id === 'snow';
}

function log(c: Ctx, x: number, y: number, z: number, state: number): void {
  if (y < 1 || y > 254) return;
  if (replaceableForLog(c.cur(x, y, z))) c.set(x, y, z, state);
}

function leaf(c: Ctx, x: number, y: number, z: number, state: number): void {
  if (y < 1 || y > 254) return;
  const s = c.cur(x, y, z);
  if (s === 0 || (STATE_REPLACEABLE[s] && !blocks[STATE_BLOCK[s]!]!.def.fluid)) c.set(x, y, z, state);
}

function leaves(kind: string): number {
  return stateOf(kind + '_leaves', { persistent: false, distance: 1 });
}
function logOf(kind: string, axis: 'x' | 'y' | 'z' = 'y'): number {
  const nether = kind === 'crimson' || kind === 'warped';
  return stateOf(nether ? kind + '_stem' : kind + '_log', { axis });
}

function blob(c: Ctx, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, state: number, holes = 0.1): void {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dz = -rz; dz <= rz; dz++) {
        const d = (dx * dx) / (rx * rx + 0.5) + (dy * dy) / (ry * ry + 0.5) + (dz * dz) / (rz * rz + 0.5);
        if (d > 1) continue;
        if (d > 0.7 && c.rng.chance(holes)) continue;
        leaf(c, cx + dx, cy + dy, cz + dz, state);
      }
    }
  }
}

/** Classic oak-style crown: 2 wide layers + 2 narrow layers. */
function roundCrown(c: Ctx, x: number, top: number, z: number, state: number): void {
  for (let dy = -3; dy <= 0; dy++) {
    const r = dy >= -1 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 0 || c.rng.chance(0.5))) continue;
        leaf(c, x + dx, top + dy, z + dz, state);
      }
    }
  }
}

function trunkClear(c: Ctx, x: number, y: number, z: number, h: number, w = 1): boolean {
  for (let dy = 1; dy <= h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < w; dz++) {
        const s = c.r.getState(x + dx, y + dy, z + dz);
        if (!replaceableForLog(s)) return false;
      }
    }
  }
  return true;
}

function oak(c: Ctx, x: number, y: number, z: number, kind = 'oak', minH = 4, extra = 3): boolean {
  const h = minH + c.rng.int(extra);
  if (!trunkClear(c, x, y - 1, z, h + 1)) return false;
  const lv = leaves(kind);
  roundCrown(c, x, y + h, z, lv);
  for (let i = 0; i < h; i++) log(c, x, y + i, z, logOf(kind));
  return true;
}

function fancyOak(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 8 + c.rng.int(6);
  if (!trunkClear(c, x, y - 1, z, h)) return false;
  const lv = leaves('oak');
  for (let i = 0; i < h; i++) log(c, x, y + i, z, logOf('oak'));
  const branches = 3 + c.rng.int(3);
  for (let b = 0; b < branches; b++) {
    const by = y + Math.floor(h * 0.5) + c.rng.int(Math.ceil(h * 0.45));
    const ang = c.rng.next() * Math.PI * 2;
    const len = 2 + c.rng.int(3);
    let bx = x;
    let bz = z;
    for (let k = 1; k <= len; k++) {
      bx = x + Math.round(Math.cos(ang) * k);
      bz = z + Math.round(Math.sin(ang) * k);
      log(c, bx, by + (k >> 1), bz, logOf('oak', Math.abs(Math.cos(ang)) > 0.7 ? 'x' : Math.abs(Math.sin(ang)) > 0.7 ? 'z' : 'y'));
    }
    blob(c, bx, by + (len >> 1) + 1, bz, 2, 2, 2, lv, 0.25);
  }
  blob(c, x, y + h, z, 3, 2, 3, lv, 0.2);
  return true;
}

function birch(c: Ctx, x: number, y: number, z: number, tall: boolean): boolean {
  return oak(c, x, y, z, 'birch', tall ? 8 : 5, 3);
}

function spruce(c: Ctx, x: number, y: number, z: number, pine: boolean, kind = 'spruce'): boolean {
  const h = pine ? 7 + c.rng.int(5) : 6 + c.rng.int(4);
  if (!trunkClear(c, x, y - 1, z, h + 1)) return false;
  const lv = leaves(kind);
  const bare = pine ? h - 3 - c.rng.int(2) : 1 + c.rng.int(2);
  let r = 0;
  const maxR = pine ? 1 : 2 + c.rng.int(2);
  for (let yy = y + h + 1; yy > y + bare; yy--) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && r > 0) continue;
        leaf(c, x + dx, yy, z + dz, lv);
      }
    }
    if (pine) r = r >= 1 ? 0 : 1;
    else {
      r++;
      if (r > maxR) r = 1;
    }
  }
  for (let i = 0; i <= h; i++) log(c, x, y + i, z, logOf(kind));
  return true;
}

function megaSpruce(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 16 + c.rng.int(12);
  if (!trunkClear(c, x, y - 1, z, h, 2)) return false;
  const lv = leaves('spruce');
  for (let yy = y + h + 1; yy > y + Math.floor(h / 3); yy--) {
    const rel = (y + h + 1 - yy) / (h * 0.66);
    const r = Math.max(1, Math.floor(rel * 5 * (0.6 + 0.4 * ((yy % 3) / 2))));
    for (let dx = -r; dx <= r + 1; dx++) {
      for (let dz = -r; dz <= r + 1; dz++) {
        const d = Math.hypot(dx - 0.5, dz - 0.5);
        if (d <= r + 0.3) leaf(c, x + dx, yy, z + dz, lv);
      }
    }
  }
  for (let i = 0; i < h; i++) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) log(c, x + dx, y + i, z + dz, logOf('spruce'));
  // podzol ring
  return true;
}

function jungle(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 6 + c.rng.int(7);
  if (!trunkClear(c, x, y - 1, z, h + 1)) return false;
  const lv = leaves('jungle');
  roundCrown(c, x, y + h, z, lv);
  blob(c, x, y + h - 1, z, 3, 1, 3, lv, 0.3);
  for (let i = 0; i < h; i++) {
    log(c, x, y + i, z, logOf('jungle'));
    vines(c, x, y + i, z, 0.35);
  }
  return true;
}

function vines(c: Ctx, x: number, y: number, z: number, chance: number): void {
  const dirs: [number, number, string][] = [
    [1, 0, 'west'],
    [-1, 0, 'east'],
    [0, 1, 'north'],
    [0, -1, 'south'],
  ];
  for (const [dx, dz, side] of dirs) {
    if (!c.rng.chance(chance)) continue;
    const vx = x + dx;
    const vz = z + dz;
    const len = 1 + c.rng.int(4);
    for (let k = 0; k < len; k++) {
      if (c.cur(vx, y - k, vz) !== 0) break;
      c.set(vx, y - k, vz, stateOf('vine', { [side]: true }));
    }
  }
}

function megaJungle(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 18 + c.rng.int(12);
  if (!trunkClear(c, x, y - 1, z, h, 2)) return false;
  const lv = leaves('jungle');
  for (let i = 0; i < h; i++) {
    for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) log(c, x + dx, y + i, z + dz, logOf('jungle'));
    if (i % 2 === 0) vines(c, x + (c.rng.bool() ? 1 : 0), y + i, z + (c.rng.bool() ? 1 : 0), 0.4);
  }
  blob(c, x, y + h, z, 4, 2, 4, lv, 0.25);
  for (let b = 0; b < 3; b++) {
    const by = y + Math.floor(h * 0.55) + c.rng.int(Math.floor(h * 0.35));
    const ang = c.rng.next() * Math.PI * 2;
    const bx = x + Math.round(Math.cos(ang) * 4);
    const bz = z + Math.round(Math.sin(ang) * 4);
    for (let k = 1; k <= 4; k++) log(c, x + Math.round(Math.cos(ang) * k), by, z + Math.round(Math.sin(ang) * k), logOf('jungle', 'x'));
    blob(c, bx, by + 1, bz, 2, 1, 2, lv, 0.2);
  }
  return true;
}

function jungleBush(c: Ctx, x: number, y: number, z: number): boolean {
  log(c, x, y, z, logOf('jungle'));
  blob(c, x, y + 1, z, 2, 1, 2, leaves('oak'), 0.3);
  return true;
}

function acacia(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 5 + c.rng.int(3);
  if (!trunkClear(c, x, y - 1, z, h)) return false;
  const lv = leaves('acacia');
  const dir = c.rng.int(4);
  const dx = [1, -1, 0, 0][dir]!;
  const dz = [0, 0, 1, -1][dir]!;
  const bend = h - 2 - c.rng.int(2);
  let tx = x;
  let tz = z;
  for (let i = 0; i < h; i++) {
    if (i >= bend) {
      tx += dx;
      tz += dz;
    }
    log(c, tx, y + i, tz, logOf('acacia'));
  }
  const top = y + h;
  for (let ddx = -3; ddx <= 3; ddx++) for (let ddz = -3; ddz <= 3; ddz++) if (Math.abs(ddx) + Math.abs(ddz) <= 4) leaf(c, tx + ddx, top, tz + ddz, lv);
  for (let ddx = -1; ddx <= 1; ddx++) for (let ddz = -1; ddz <= 1; ddz++) leaf(c, tx + ddx, top + 1, tz + ddz, lv);
  // second small branch
  if (c.rng.chance(0.6)) {
    const bx = x - dx * 2;
    const bz = z - dz * 2;
    log(c, x - dx, y + bend, z - dz, logOf('acacia'));
    log(c, bx, y + bend + 1, bz, logOf('acacia'));
    for (let ddx = -2; ddx <= 2; ddx++) for (let ddz = -2; ddz <= 2; ddz++) if (Math.abs(ddx) + Math.abs(ddz) <= 3) leaf(c, bx + ddx, y + bend + 2, bz + ddz, lv);
  }
  return true;
}

function darkOak(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 6 + c.rng.int(3);
  if (!trunkClear(c, x, y - 1, z, h, 2)) return false;
  const lv = leaves('dark_oak');
  for (let i = 0; i < h; i++) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) log(c, x + dx, y + i, z + dz, logOf('dark_oak'));
  for (let dy = -1; dy <= 1; dy++) {
    const r = dy === 1 ? 2 : 3;
    for (let dx = -r; dx <= r + 1; dx++) {
      for (let dz = -r; dz <= r + 1; dz++) {
        if (Math.abs(dx - 0.5) + Math.abs(dz - 0.5) > r + 1.5) continue;
        leaf(c, x + dx, y + h + dy, z + dz, lv);
      }
    }
  }
  return true;
}

function swampOak(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 5 + c.rng.int(3);
  // swamp oaks may start in shallow water
  const lv = leaves('oak');
  for (let dy = -3; dy <= 0; dy++) {
    const r = dy >= -1 ? 2 : 3;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && c.rng.chance(0.6)) continue;
        leaf(c, x + dx, y + h + dy, z + dz, lv);
        if ((Math.abs(dx) === r || Math.abs(dz) === r) && dy === -3 && c.rng.chance(0.3)) {
          for (let k = 1; k <= 3; k++) if (c.cur(x + dx, y + h + dy - k, z + dz) === 0) c.set(x + dx, y + h + dy - k, z + dz, stateOf('vine', { north: true }));
        }
      }
    }
  }
  for (let i = 0; i < h; i++) {
    const s = c.cur(x, y + i, z);
    if (replaceableForLog(s) || blocks[STATE_BLOCK[s]!]!.id === 'water') c.set(x, y + i, z, logOf('oak'));
  }
  return true;
}

function mangrove(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 6 + c.rng.int(4);
  const lv = leaves('mangrove');
  const root = logOf('mangrove');
  // stilt roots
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (let k = 0; k < 3; k++) {
      const s = c.cur(x + dx * 2, y + 2 - k, z + dz * 2);
      if (replaceableForLog(s) || blocks[STATE_BLOCK[s]!]!.id === 'water') c.set(x + dx * 2, y + 2 - k, z + dz * 2, root);
    }
    log(c, x + dx, y + 2, z + dz, root);
  }
  for (let i = 2; i < h; i++) c.set(x, y + i, z, logOf('mangrove'));
  blob(c, x, y + h, z, 3, 2, 3, lv, 0.25);
  return true;
}

function cherry(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 5 + c.rng.int(3);
  if (!trunkClear(c, x, y - 1, z, h)) return false;
  const lv = leaves('cherry');
  for (let i = 0; i < h; i++) log(c, x, y + i, z, logOf('cherry'));
  const arms = 2 + c.rng.int(2);
  for (let a = 0; a < arms; a++) {
    const ang = (a / arms) * Math.PI * 2 + c.rng.next();
    const ex = x + Math.round(Math.cos(ang) * 3);
    const ez = z + Math.round(Math.sin(ang) * 3);
    for (let k = 1; k <= 3; k++) log(c, x + Math.round(Math.cos(ang) * k), y + h - 2 + (k >> 1), z + Math.round(Math.sin(ang) * k), logOf('cherry', 'x'));
    blob(c, ex, y + h + 1, ez, 3, 2, 3, lv, 0.15);
  }
  blob(c, x, y + h + 1, z, 2, 2, 2, lv, 0.15);
  return true;
}

function azalea(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 4 + c.rng.int(2);
  if (!trunkClear(c, x, y - 1, z, h)) return false;
  for (let i = 0; i < h; i++) log(c, x, y + i, z, logOf('oak'));
  blob(c, x, y + h, z, 2, 1, 2, leaves('oak'), 0.2);
  return true;
}

function hugeMushroom(c: Ctx, x: number, y: number, z: number, red: boolean): boolean {
  const h = 5 + c.rng.int(3);
  if (!trunkClear(c, x, y - 1, z, h + 1)) return false;
  const cap = S(red ? 'red_mushroom_block' : 'brown_mushroom_block');
  const stem = S('mushroom_stem');
  for (let i = 0; i < h; i++) log(c, x, y + i, z, stem);
  if (red) {
    for (let dy = -3; dy <= 0; dy++) {
      const r = dy === 0 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const edge = Math.abs(dx) === r || Math.abs(dz) === r;
          if (dy < 0 && !edge) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && dy < 0) continue;
          leaf(c, x + dx, y + h + dy, z + dz, cap);
        }
      }
    }
  } else {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (!(Math.abs(dx) === 3 && Math.abs(dz) === 3)) leaf(c, x + dx, y + h, z + dz, cap);
  }
  return true;
}

function fungus(c: Ctx, x: number, y: number, z: number, kind: 'crimson' | 'warped'): boolean {
  const h = 4 + c.rng.int(9);
  if (!trunkClear(c, x, y - 1, z, h)) return false;
  const wart = S(kind === 'crimson' ? 'nether_wart_block' : 'warped_wart_block');
  const stem = logOf(kind);
  for (let i = 0; i < h; i++) log(c, x, y + i, z, stem);
  const r = 2 + c.rng.int(2);
  for (let dy = -3; dy <= 0; dy++) {
    const rr = dy === 0 ? r - 1 : r;
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        const edge = Math.abs(dx) === rr || Math.abs(dz) === rr || dy === 0;
        if (!edge) continue;
        if (c.rng.chance(dy < -1 ? 0.35 : 0.08)) continue;
        leaf(c, x + dx, y + h + dy, z + dz, c.rng.chance(0.06) ? S('shroomlight') : wart);
      }
    }
  }
  if (kind === 'crimson') for (let k = 0; k < 4; k++) {
    const vx = x + c.rng.range(-r, r);
    const vz = z + c.rng.range(-r, r);
    for (let l = 0; l < 3; l++) if (c.cur(vx, y + h - 4 - l, vz) === 0) c.set(vx, y + h - 4 - l, vz, S('weeping_vines'));
  }
  return true;
}

/** Farlands glitched tree: offset trunk segments and floating leaf cubes. */
function nullTree(c: Ctx, x: number, y: number, z: number): boolean {
  const h = 6 + c.rng.int(8);
  if (!trunkClear(c, x, y - 1, z, 4)) return false;
  const lv = leaves('null');
  let tx = x;
  let tz = z;
  for (let i = 0; i < h; i++) {
    if (i > 2 && c.rng.chance(0.2)) {
      tx += c.rng.range(-1, 1);
      tz += c.rng.range(-1, 1);
    }
    log(c, tx, y + i, tz, logOf('null'));
  }
  const cubes = 2 + c.rng.int(4);
  for (let k = 0; k < cubes; k++) {
    const s = 1 + c.rng.int(2);
    const cx = tx + c.rng.range(-3, 3);
    const cy = y + h - 2 + c.rng.range(0, 5);
    const cz = tz + c.rng.range(-3, 3);
    for (let dx = -s; dx <= s; dx++) for (let dy = -s; dy <= s; dy++) for (let dz = -s; dz <= s; dz++) leaf(c, cx + dx, cy + dy, cz + dz, c.rng.chance(0.03) ? S('glitch_block') : lv);
  }
  return true;
}

function chorus(c: Ctx, x: number, y: number, z: number, depth = 0): boolean {
  const plant = S('chorus_plant');
  const h = 1 + c.rng.int(4 - Math.min(3, depth));
  for (let i = 0; i < h; i++) {
    if (c.r.getState(x, y + i, z) !== 0) return depth > 0;
    c.set(x, y + i, z, withProp(withProp(plant, 'down', 'true'), 'up', i < h - 1 ? 'true' : 'false'));
  }
  const top = y + h;
  if (depth < 3) {
    const n = c.rng.int(3);
    for (let b = 0; b < n; b++) {
      const dirs: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const [dx, dz] = c.rng.pick(dirs);
      if (c.cur(x + dx, top - 1, z + dz) !== 0) continue;
      c.set(x + dx, top - 1, z + dz, plant);
      chorus(c, x + dx, top, z + dz, depth + 1);
    }
  }
  if (c.cur(x, top, z) === 0) c.set(x, top, z, stateOf('chorus_flower', { age: 5 }));
  return true;
}

/** Places a generated tree/plant of the given kind rooted at (x, y, z) (y = first trunk block). */
export function placeTree(r: TreeReader, set: TreeSetter, rng: Random, kind: TreeKind, x: number, y: number, z: number): boolean {
  const c: Ctx = { r, cur: r.current ? (x2, y2, z2) => r.current!(x2, y2, z2) : (x2, y2, z2) => r.getState(x2, y2, z2), set, rng };
  switch (kind) {
    case 'oak':
      return oak(c, x, y, z);
    case 'fancy_oak':
      return fancyOak(c, x, y, z);
    case 'birch':
      return birch(c, x, y, z, false);
    case 'tall_birch':
      return birch(c, x, y, z, true);
    case 'spruce':
      return spruce(c, x, y, z, false);
    case 'pine':
      return spruce(c, x, y, z, true);
    case 'mega_spruce':
      return megaSpruce(c, x, y, z);
    case 'jungle':
      return jungle(c, x, y, z);
    case 'mega_jungle':
      return megaJungle(c, x, y, z);
    case 'jungle_bush':
      return jungleBush(c, x, y, z);
    case 'acacia':
      return acacia(c, x, y, z);
    case 'dark_oak':
      return darkOak(c, x, y, z);
    case 'swamp_oak':
      return swampOak(c, x, y, z);
    case 'mangrove':
      return mangrove(c, x, y, z);
    case 'cherry':
      return cherry(c, x, y, z);
    case 'azalea':
      return azalea(c, x, y, z);
    case 'huge_red_mushroom':
      return hugeMushroom(c, x, y, z, true);
    case 'huge_brown_mushroom':
      return hugeMushroom(c, x, y, z, false);
    case 'crimson_fungus':
      return fungus(c, x, y, z, 'crimson');
    case 'warped_fungus':
      return fungus(c, x, y, z, 'warped');
    case 'null_tree':
      return nullTree(c, x, y, z);
    case 'chorus':
      return chorus(c, x, y, z);
    default:
      return oak(c, x, y, z);
  }
}

/**
 * Grows a sapling into a tree (server). Handles 2x2 saplings for dark oak,
 * mega spruce and mega jungle.
 */
export function growTree(r: TreeReader, x: number, y: number, z: number, wood: string, rng: Random, set: TreeSetter): boolean {
  const sap = r.getState(x, y, z);
  const same = (dx: number, dz: number): boolean => STATE_BLOCK[r.getState(x + dx, y, z + dz)] === STATE_BLOCK[sap];
  // find 2x2 arrangement
  let big: [number, number] | null = null;
  for (const [ox, oz] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ] as const) {
    if (same(ox, oz) && same(ox + 1, oz) && same(ox, oz + 1) && same(ox + 1, oz + 1)) {
      big = [x + ox, z + oz];
      break;
    }
  }
  const clearSap = (bx: number, bz: number, n: number): void => {
    for (let dx = 0; dx < n; dx++) for (let dz = 0; dz < n; dz++) set(bx + dx, y, bz + dz, 0);
  };
  const reader: TreeReader = r;
  let kind: TreeKind;
  switch (wood) {
    case 'oak':
      kind = rng.chance(0.1) ? 'fancy_oak' : 'oak';
      break;
    case 'spruce':
      kind = big ? 'mega_spruce' : 'spruce';
      break;
    case 'jungle':
      kind = big ? 'mega_jungle' : 'jungle';
      break;
    case 'dark_oak':
      if (!big) return false;
      kind = 'dark_oak';
      break;
    case 'birch':
    case 'acacia':
    case 'mangrove':
    case 'cherry':
      kind = wood as TreeKind;
      break;
    case 'null':
      kind = 'null_tree';
      break;
    default:
      kind = 'oak';
  }
  if (big && (kind === 'mega_spruce' || kind === 'mega_jungle' || kind === 'dark_oak')) {
    clearSap(big[0], big[1], 2);
    const ok = placeTree({ getState: (a, b, c) => reader.getState(a, b, c) }, set, rng, kind, big[0], y, big[1]);
    if (!ok) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) set(big[0] + dx, y, big[1] + dz, sap);
    return ok;
  }
  set(x, y, z, 0);
  const ok = placeTree(reader, set, rng, kind, x, y, z);
  if (!ok) set(x, y, z, sap);
  return ok;
}

export { blockHasTag };
