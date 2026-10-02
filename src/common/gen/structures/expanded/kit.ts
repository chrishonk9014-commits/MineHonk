/**
 * V6 phase 3: the building kit of the Expanded End's structures.
 *
 * Every structure there is assembled at plan time from pieces (towers,
 * halls, houses, bridges, platforms, stairs, domes, hulls...) with random
 * sizes, rotations and branch counts, then built chunk by chunk like every
 * other structure (manager.ts): each piece's build writes only the blocks
 * inside the chunk being generated.
 *
 * Rules that keep that order-independent:
 * - Plans read only the pure terrain (ExpansionTerrain) and their own Random.
 * - Builds take their per-block randomness from position hashes (`chance`),
 *   never from a sequential generator, so building a piece clipped to any
 *   chunk gives the same blocks as building it whole.
 *
 * Palettes follow the classic End City (purpur, end stone bricks, end rods)
 * dressed in each biome's phase 2 blocks: its end stone variant, chorus
 * wood, Crystal Glass, Void Glass, Astral Glass and Astral Lanterns.
 */
import { hash3, hashInts } from '../../../math/rng';
import { S, stateOf, blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID, STATE_REPLACEABLE } from '../../../registry/blocks';
import { GLYPH_FACES } from '../../../endExpansion/ancient';
import { Builder, type Rotation } from '../builder';
import { boxOf, type Box, type Piece, type Start } from '../manager';
import type { DecorView } from '../../decorate/view';

export type P3 = [number, number, number];
export type Entities = NonNullable<Start['entities']>;

/** A float in [0, 1) from a position and a salt: the build-time randomness. */
export function chance(seed: number, x: number, y: number, z: number): number {
  return hash3(seed, x, y, z) / 4294967296;
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

export interface Palette {
  /** The biome it dresses for. */
  biome: string;
  /** Main walls (purpur in the classic End City). */
  main: string;
  /** Bricks, trim and floors of the biome's stone. */
  accent: string;
  stairs: string;
  slab: string;
  /** A wall block for railings and battlements. */
  rail: string;
  /** Corner pillars (have an axis). */
  pillar: string;
  floor: string;
  glass: string;
  light: 'end_rod' | 'astral_lantern' | 'crystal_lamp';
  wood: string;
  woodStairs: string;
  woodSlab: string;
  cloth: string;
}

const BASE: Omit<Palette, 'biome'> = {
  main: 'purpur_block',
  accent: 'end_stone_bricks',
  stairs: 'end_stone_bricks_stairs',
  slab: 'end_stone_bricks_slab',
  rail: 'end_stone_bricks_wall',
  pillar: 'purpur_pillar',
  floor: 'end_stone_bricks',
  glass: 'magenta_stained_glass',
  light: 'end_rod',
  wood: 'chorus_planks',
  woodStairs: 'chorus_stairs',
  woodSlab: 'chorus_slab',
  cloth: 'purple_wool',
};

const variantStone = (v: string): Partial<Palette> => ({ accent: `${v}_end_stone_bricks`, stairs: `${v}_end_stone_bricks_stairs`, slab: `${v}_end_stone_bricks_slab`, rail: `${v}_end_stone_bricks_wall`, floor: `polished_${v}_end_stone` });

const PALETTES: Record<string, Partial<Palette>> = {
  end_barrens: { ...variantStone('cracked') },
  shattered_end: { ...variantStone('dark'), glass: 'purple_stained_glass' },
  astral_end: { ...variantStone('astral'), glass: 'astral_glass', light: 'astral_lantern', cloth: 'blue_wool' },
  highlands: { cloth: 'chorus_cloth' },
  end_crystal_fields: { ...variantStone('crystalline'), glass: 'crystal_glass', light: 'crystal_lamp', cloth: 'white_wool' },
  chorus_forest: { accent: 'chorus_planks', stairs: 'chorus_stairs', slab: 'chorus_slab', rail: 'chorus_fence', pillar: 'chorus_stalk', floor: 'chorus_planks', cloth: 'chorus_cloth' },
  void_wastes: { ...variantStone('dark'), glass: 'void_glass', cloth: 'black_wool' },
};

/** The palette of a structure standing in an Expanded End biome. */
export function paletteFor(biome: string): Palette {
  return { ...BASE, ...(PALETTES[biome] ?? {}), biome };
}

// ---------------------------------------------------------------------------
// Block states
// ---------------------------------------------------------------------------

export const st = {
  air: 0,
  b: (id: string): number => S(id),
  pillar: (p: Palette, axis = 'y'): number => stateOf(p.pillar, { axis }),
  stair: (id: string, facing: string, half = 'bottom'): number => stateOf(id, { facing, half }),
  slab: (id: string, type = 'bottom'): number => stateOf(id, { type }),
  rod: (facing = 'up'): number => stateOf('end_rod', { facing }),
  ladder: (facing: string): number => stateOf('ladder', { facing }),
  glyph: (seed: number, x: number, y: number, z: number): number => stateOf('ender_glyph_stone', { glyph: String(hash3(seed ^ 0x61f, x, y, z) % GLYPH_FACES) }),
};

/** A lamp of the palette's kind standing on (or hanging under) a block. */
export function lamp(p: Palette, hanging = false): number {
  if (p.light === 'astral_lantern') return stateOf('astral_lantern', { hanging: hanging ? 'true' : 'false' });
  if (p.light === 'crystal_lamp') return S('crystal_lamp');
  return stateOf('end_rod', { facing: hanging ? 'down' : 'up' });
}

/** True for blocks a structure may overwrite freely (air, plants, fluids). */
export function soft(s: number): boolean {
  return s === 0 || !!STATE_REPLACEABLE[s] || !!STATE_FLUID[s];
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A piece with its kind (for the layout signature tests compare across seeds). */
export interface KindPiece extends Piece {
  kind: string;
}

export function piece(kind: string, box: Box, build: (v: DecorView) => void): KindPiece {
  return { kind, box, build };
}

/** A rectangle of columns (world, inclusive). */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function rectOf(x0: number, z0: number, x1: number, z1: number): Rect {
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.z0 - pad <= b.z1 && a.z1 + pad >= b.z0;
}

/** A builder over a world rectangle at height y, rotated so local z = 0 is the `front` side. */
export function frame(v: DecorView, r: Rect, y: number, rot: Rotation, sx: number, sz: number): Builder {
  return new Builder(v, r.x0, y, r.z0, rot, sx, sz);
}

/** The world rectangle a local sx x sz footprint covers at (x0, z0) under a rotation. */
export function footprint(x0: number, z0: number, rot: Rotation, sx: number, sz: number): Rect {
  const wx = rot & 1 ? sz : sx;
  const wz = rot & 1 ? sx : sz;
  return { x0, z0, x1: x0 + wx - 1, z1: z0 + wz - 1 };
}

/** World position of a local point of a frame (without a view: plan time). */
export function at(r: Rect, y: number, rot: Rotation, sx: number, sz: number, lx: number, ly: number, lz: number): P3 {
  const b = new Builder(null as unknown as DecorView, r.x0, y, r.z0, rot, sx, sz);
  return [b.wx(lx, lz), y + ly, b.wz(lx, lz)];
}

/** A chest with a loot table (rolled on the server when first opened). */
export function chest(b: Builder, x: number, y: number, z: number, facing: string, loot: string, seed: number): void {
  b.chest(x, y, z, facing, loot, hashInts(seed, b.wx(x, z), b.oy + y, b.wz(x, z), 0x10c7));
}

// ---------------------------------------------------------------------------
// Ruins: a builder that weathers, breaks and collapses whatever it builds
// ---------------------------------------------------------------------------

const CRACKED: Record<string, string> = {
  ancient_end_bricks: 'cracked_ancient_end_bricks',
  end_stone_bricks: 'cracked_end_stone_bricks',
  purpur_block: 'cracked_end_stone_bricks',
  dark_end_stone_bricks: 'dark_end_stone',
  crystalline_end_stone_bricks: 'crystalline_end_stone',
  astral_end_stone_bricks: 'astral_end_stone',
  chorus_planks: 'chorus_stalk',
};

/**
 * Builds through `holes` (a share of blocks left out), cracks bricks, and
 * leaves nothing above a broken top line that rises and falls across the
 * piece (`collapse` local height, varying by up to `jag`). Glass and lamps
 * mostly break.
 */
export class RuinBuilder extends Builder {
  constructor(
    v: DecorView,
    ox: number,
    oy: number,
    oz: number,
    rot: Rotation,
    sx: number,
    sz: number,
    private readonly seed: number,
    private readonly holes: number,
    private readonly collapse: number,
    private readonly jag: number,
  ) {
    super(v, ox, oy, oz, rot, sx, sz);
  }

  override set(x: number, y: number, z: number, state: number): void {
    const wx = this.wx(x, z);
    const wz = this.wz(x, z);
    const wy = this.oy + y;
    if (state !== 0) {
      const top = this.collapse + Math.floor(chance(this.seed, wx >> 2, 0, wz >> 2) * this.jag) - Math.floor(this.jag / 2);
      if (y > top) return;
      if (chance(this.seed ^ 0x4013, wx, wy, wz) < this.holes * (y > top - 3 ? 2 : 1)) return;
      const id = blockId(state);
      if (/glass|lantern|lamp|end_rod|chest/.test(id) && chance(this.seed ^ 0x61a5, wx, wy, wz) < 0.7) return;
      const cracked = CRACKED[id];
      if (cracked && chance(this.seed ^ 0xc4ac, wx, wy, wz) < 0.35) state = S(cracked);
    } else if (y > this.collapse + this.jag) return;
    super.set(x, y, z, state);
  }

  override chest(x: number, y: number, z: number, facing: string, loot: string, seed: number): void {
    // Loot survives the collapse: it sits in the rubble at the bottom
    super.set(x, y, z, stateOf('chest', { facing }));
    this.blockEntity(x, y, z, { type: 'chest', loot, lootSeed: seed });
  }
}

let BLOCK_IDS: string[] | null = null;
function blockId(state: number): string {
  BLOCK_IDS ??= blocks.map((b) => b.id);
  return BLOCK_IDS[STATE_BLOCK[state]!] ?? 'air';
}

// ---------------------------------------------------------------------------
// Primitives (local coordinates of a Builder; the front is the z = 0 side)
// ---------------------------------------------------------------------------

/** Fills a footprint's foundation down to the ground (or `max` blocks into the void). */
export function footing(b: Builder, x0: number, z0: number, x1: number, z1: number, state: number, max = 14): void {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) b.foundation(x, z, -1, state, max);
}

/** Walls of a storey with corner pillars and windows; floor at y0, ceiling at y0 + h. */
export function storey(b: Builder, p: Palette, seed: number, x0: number, y0: number, z0: number, x1: number, z1: number, h: number, o: { windows?: boolean; glass?: string; floor?: string; ceiling?: string | null; wall?: string } = {}): void {
  const wall = S(o.wall ?? p.main);
  const glass = S(o.glass ?? p.glass);
  const pil = st.pillar(p);
  for (let y = y0; y <= y0 + h; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const ex = x === x0 || x === x1;
        const ez = z === z0 || z === z1;
        if (y === y0) b.set(x, y, z, S(o.floor ?? p.floor));
        else if (y === y0 + h) {
          if (o.ceiling !== null) b.set(x, y, z, S(o.ceiling ?? p.main));
        } else if (ex && ez) b.set(x, y, z, pil);
        else if (ex || ez) {
          const along = ez ? x - x0 : z - z0;
          const len = ez ? x1 - x0 : z1 - z0;
          const win = o.windows !== false && y >= y0 + 2 && y <= y0 + Math.min(3, h - 1) && along > 1 && along < len - 1 && (along % 3 === 2 || (len < 6 && along === len >> 1));
          b.set(x, y, z, win ? glass : wall);
        } else b.set(x, y, z, 0);
      }
  void seed;
}

/** A doorway (3 high, `w` wide) through a wall at local x (centre) on the front (z) or a side. */
export function doorway(b: Builder, x: number, y: number, z: number, w = 1, h = 3, alongX = true): void {
  for (let i = -(w >> 1); i <= w >> 1; i++) for (let dy = 0; dy < h; dy++) b.set(alongX ? x + i : x, y + dy, alongX ? z : z + i, 0);
}

/** Battlements around a flat roof at height y (alternating rail and gaps). */
export function battlements(b: Builder, p: Palette, x0: number, y: number, z0: number, x1: number, z1: number): void {
  const rail = S(p.rail);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      if ((x + z) % 2 === 0 || (x === x0 || x === x1) === (z === z0 || z === z1)) b.set(x, y, z, rail);
    }
}

/** A stepped pyramid roof of stairs over a footprint, from height y (with a lamp or rod on top). */
export function pyramidRoof(b: Builder, p: Palette, x0: number, y: number, z0: number, x1: number, z1: number, block?: string): void {
  const sid = block === 'wood' ? p.woodStairs : p.stairs;
  const solid = S(block === 'wood' ? p.wood : p.accent);
  let i = 0;
  while (x0 + i <= x1 - i && z0 + i <= z1 - i) {
    const a = x0 + i;
    const c = x1 - i;
    const d = z0 + i;
    const e = z1 - i;
    for (let x = a; x <= c; x++)
      for (let z = d; z <= e; z++) {
        if (x !== a && x !== c && z !== d && z !== e) {
          b.set(x, y + i, z, solid);
          continue;
        }
        const f = z === d ? 'south' : z === e ? 'north' : x === a ? 'east' : 'west';
        b.set(x, y + i, z, a === c || d === e ? solid : st.stair(sid, f));
      }
    i++;
  }
  b.set((x0 + x1) >> 1, y + i, (z0 + z1) >> 1, lamp(p));
}

/** A ladder up the inside of a wall from y0 to y1 (inclusive), opening a hole through each floor. */
export function ladder(b: Builder, x: number, y0: number, y1: number, z: number, facing: string): void {
  for (let y = y0; y <= y1; y++) b.set(x, y, z, st.ladder(facing));
}

/**
 * A square End City tower: `floors` storeys of height `fh` on a w x w
 * footprint, a ladder up one wall, and a roof: a terrace with battlements,
 * a pyramid or a crown of rods. Returns the roof level.
 */
export function tower(b: Builder, p: Palette, seed: number, w: number, floors: number, fh: number, roof: 'terrace' | 'pyramid' | 'crown', o: { door?: boolean; base?: number } = {}): number {
  const m = w - 1;
  footing(b, 0, 0, m, m, S(p.accent), o.base ?? 14);
  for (let f = 0; f < floors; f++) storey(b, p, seed, 0, f * fh, 0, m, m, fh, { floor: f === 0 ? p.floor : p.accent, ceiling: f === floors - 1 ? p.accent : null });
  const top = floors * fh;
  // Ladder on the back wall (z = m - 1), through every floor
  ladder(b, m >> 1, 1, top, m - 1, 'north');
  for (let f = 1; f < floors; f++) b.set(m >> 1, f * fh, m - 1, st.ladder('north'));
  b.set(m >> 1, top, m - 1, st.ladder('north'));
  b.set(m >> 1, top + 1, m - 1, 0);
  if (o.door !== false) doorway(b, m >> 1, 1, 0, w >= 9 ? 3 : 1);
  // Lamps hanging in each storey
  for (let f = 0; f < floors; f++) b.set(m >> 1, f * fh + fh - 1, m >> 1, lamp(p, true));
  if (roof === 'terrace') {
    battlements(b, p, 0, top + 1, 0, m, m);
    for (const [x, z] of [
      [0, 0],
      [m, 0],
      [0, m],
      [m, m],
    ] as const)
      b.set(x, top + 2, z, lamp(p));
  } else if (roof === 'pyramid') {
    b.set(m >> 1, top + 1, m - 1, 0);
    pyramidRoof(b, p, -1, top + 1, -1, m + 1, m + 1);
    // the ladder ends in a hatch under the roof
    b.set(m >> 1, top + 1, m - 1, st.ladder('north'));
  } else {
    battlements(b, p, 0, top + 1, 0, m, m);
    for (let i = 1; i <= 3; i++) b.set(m >> 1, top + i, m >> 1, i === 3 ? st.rod() : st.pillar(p));
  }
  return top;
}

/** A round platform (radius r) at height 0 around local (r, r), with a railing and lamps, footed to the ground. */
export function platform(b: Builder, p: Palette, seed: number, r: number, o: { rail?: boolean; floor?: string } = {}): void {
  const floor = S(o.floor ?? p.floor);
  const rail = S(p.rail);
  for (let z = 0; z <= r * 2; z++)
    for (let x = 0; x <= r * 2; x++) {
      const d = Math.hypot(x - r, z - r);
      if (d > r + 0.4) continue;
      b.set(x, 0, z, floor);
      // Hangs over the void: a tapered underside instead of a foundation
      const depth = Math.max(1, Math.round((r - d) * 1.2));
      for (let k = 1; k <= depth; k++) if (soft(b.get(x, -k, z))) b.set(x, -k, z, S(p.accent));
      for (let k = 1; k <= 3; k++) b.set(x, k, z, 0);
      if (o.rail !== false && d > r - 0.6) b.set(x, 1, z, rail);
    }
  void seed;
  b.set(r, 1, r, lamp(p));
}

/**
 * A straight walkway along local +z from z0 to z1, `w` wide (odd) around
 * local x, rising from y0 to y1 (stairs where it steps up), with rails and
 * lamps. `broken` leaves its last blocks crumbled away.
 */
export function walkway(b: Builder, p: Palette, seed: number, x: number, z0: number, z1: number, y0: number, y1: number, o: { w?: number; rails?: boolean; broken?: number; deck?: string; supports?: boolean } = {}): void {
  const w = o.w ?? 3;
  const half = w >> 1;
  const deck = S(o.deck ?? p.accent);
  const rail = S(p.rail);
  const len = Math.max(1, z1 - z0);
  let prev = y0;
  for (let z = z0; z <= z1; z++) {
    const t = (z - z0) / len;
    const y = Math.round(y0 + (y1 - y0) * t);
    const crumble = o.broken ? z1 - z < o.broken : false;
    for (let dx = -half; dx <= half; dx++) {
      if (crumble && chance(seed, b.wx(x + dx, z), y, b.wz(x + dx, z)) < 0.6) continue;
      const up = y > prev;
      b.set(x + dx, y - 1, z, up ? st.stair(o.deck === p.wood ? p.woodStairs : p.stairs, 'south') : deck);
      if (up) b.set(x + dx, y - 2, z, deck);
      for (let k = 0; k < 3; k++) b.set(x + dx, y + k, z, 0);
    }
    if (o.rails !== false && !crumble) {
      b.set(x - half - 1, y - 1, z, deck);
      b.set(x + half + 1, y - 1, z, deck);
      b.set(x - half - 1, y, z, (z - z0) % 6 === 3 ? lamp(p) : rail);
      b.set(x + half + 1, y, z, (z - z0) % 6 === 3 ? lamp(p) : rail);
    }
    if (o.supports && (z - z0) % 7 === 3) for (let dx = -half; dx <= half; dx += half * 2 || 1) b.foundation(x + dx, z, y - 2, S(p.accent), 18);
    prev = y;
  }
}

/** A staircase climbing local +z from (x, 0, 0): `h` steps, `w` wide, solid underneath. */
export function stairway(b: Builder, p: Palette, x: number, z0: number, h: number, w = 3, block?: string): void {
  const sid = block ?? p.stairs;
  for (let i = 0; i < h; i++)
    for (let dx = -(w >> 1); dx <= w >> 1; dx++) {
      b.set(x + dx, i, z0 + i, st.stair(sid, 'south'));
      for (let y = i - 1; y >= 0; y--) b.set(x + dx, y, z0 + i, S(p.accent));
      for (let k = 1; k <= 3; k++) b.set(x + dx, i + k, z0 + i, 0);
    }
}

/** A hemispherical dome of radius r over local centre (cx, y0, cz): ribs of `shell`, panes of `glass`. */
export function dome(b: Builder, cx: number, y0: number, cz: number, r: number, shell: number, glass: number, floor: number | null): void {
  for (let y = 0; y <= r; y++)
    for (let z = -r; z <= r; z++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y, z);
        if (d > r + 0.5) continue;
        if (y === 0 && floor !== null) {
          b.set(cx + x, y0, cz + z, floor);
          continue;
        }
        // Without a floor of its own the dome leaves whatever floor it stands on
        if (y === 0 && d < r - 0.5) continue;
        if (d >= r - 0.5) {
          const rib = x === 0 || z === 0 || Math.abs(x) === Math.abs(z) || y === Math.round(r * 0.5);
          b.set(cx + x, y0 + y, cz + z, rib ? shell : glass);
        } else b.set(cx + x, y0 + y, cz + z, 0);
      }
}

/** A panel of Ender Glyph Stone (rows of the made-up script). */
export function glyphWall(b: Builder, seed: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let y = y0; y <= y1; y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) b.set(x, y, z, st.glyph(seed, b.wx(x, z), b.oy + y, b.wz(x, z)));
}

/**
 * A broken portal: an upright frame (inner w x h) of Ancient End Bricks
 * along local x at z, cracked and with pieces missing, around a dead sheet.
 */
export function brokenPortal(b: Builder, seed: number, x0: number, y0: number, z: number, w: number, h: number, missing = 0.25): void {
  const brick = S('ancient_end_bricks');
  const cracked = S('cracked_ancient_end_bricks');
  const chis = S('chiseled_ancient_end_bricks');
  const axis = b.rot & 1 ? 'z' : 'x';
  for (let y = 0; y <= h + 1; y++)
    for (let x = 0; x <= w + 1; x++) {
      const wx = b.wx(x0 + x, z);
      const wz = b.wz(x0 + x, z);
      const edge = x === 0 || x === w + 1 || y === 0 || y === h + 1;
      if (edge) {
        const corner = (x === 0 || x === w + 1) && (y === 0 || y === h + 1);
        if (!corner && y > 0 && chance(seed, wx, y0 + y, wz) < missing) continue;
        b.set(x0 + x, y0 + y, z, corner ? chis : chance(seed ^ 0x77, wx, y0 + y, wz) < 0.45 ? cracked : brick);
      } else b.set(x0 + x, y0 + y, z, chance(seed ^ 0x5e, wx, y0 + y, wz) < 0.15 ? 0 : stateOf('dead_portal', { axis }));
    }
}

/** Strange machines (dormant): the observatory telescope, the cathedral organ, the giant lens. */
export function telescope(b: Builder, x: number, y: number, z: number): void {
  const core = S('ancient_core');
  const lens = S('ancient_lens');
  const conduit = (a: string): number => stateOf('ancient_conduit', { axis: a });
  b.set(x, y, z, S('chiseled_ancient_end_bricks'));
  b.set(x, y + 1, z, core);
  b.set(x, y + 2, z, conduit('y'));
  // The tube leans towards the sky (local -z)
  for (let i = 0; i < 4; i++) b.set(x, y + 3 + i, z - i, conduit(i % 2 ? 'z' : 'y'));
  b.set(x, y + 7, z - 4, lens);
  b.set(x + 1, y + 1, z, conduit('x'));
  b.set(x - 1, y + 1, z, conduit('x'));
}

export function organ(b: Builder, x0: number, y: number, z: number, n: number, seed: number): void {
  for (let i = 0; i < n; i++) {
    const h = 4 + Math.floor(Math.abs(Math.sin((i + 1) * 1.7 + seed)) * 8) + (i === n >> 1 ? 4 : 0);
    for (let k = 0; k < h; k++) b.set(x0 + i, y + k, z, stateOf('ancient_conduit', { axis: 'y' }));
    b.set(x0 + i, y + h, z, S('ancient_lens'));
  }
  // The console: cores under a bench of chiseled bricks
  for (let i = 1; i < n - 1; i += 2) b.set(x0 + i, y, z - 2, S('ancient_core'));
  for (let i = 0; i < n; i++) b.set(x0 + i, y, z - 3, S('chiseled_ancient_end_bricks'));
}

/** Column-local hash for chest/entity choices inside a build. */
export function pick<T>(seed: number, i: number, arr: readonly T[]): T {
  return arr[hashInts(seed, i, 0x9a1) % arr.length]!;
}

export { boxOf, STATE_SOLID };
