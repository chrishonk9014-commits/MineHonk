/**
 * V6 - The End Expansion, phase 5: the Void Citadel.
 *
 * One per world: a vast inverted tower hanging into the void from its own
 * island, deep in the band in the Void Wastes. Its site is picked from a
 * seed-fixed list of candidates (the first in the Void Wastes whose footprint
 * holds no other structure, and, in an older world, no chunk that was ever
 * saved), recorded in `level.flags.citadel`, and handed to the End generator,
 * which builds it into its chunks as they generate (like every structure, a
 * chunk at a time, never into a saved chunk).
 *
 * The plan here is a pure function of the seed and the site, so the server,
 * the client (its ambience, the title screen) and the tests all see the same
 * Citadel:
 * - the island, with the open entrance hall on top and a ladder shaft down;
 * - six floors, each of one kind (combat, glyph lock, crystal sequence,
 *   parkour, engineering; every kind at least once, the order shuffled by
 *   the seed, harder with depth). Each starts at a landing with a Citadel
 *   Anchor, a little library and a vault chest, and ends at a sealed descent
 *   door over the shaft to the next floor;
 * - at the bottom, the End Guardian's arena: a round platform over a lower
 *   floor that catches every fall, with the altar.
 * Walls and floors are Citadel Stone, which nothing can break.
 */
import type { BlockDef } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';
import { S, stateOf } from '../registry/blocks';
import { Random, hashInts } from '../math/rng';
import type { DecorView } from '../gen/decorate/view';
import type { Box } from '../gen/structures/manager';
import type { BlockEntityData } from '../world/chunk';

type P3 = [number, number, number];

export const CITADEL = {
  /** Distance from 0,0 its site is searched in (the deep band, land ends at 9,600). */
  minR: 8600,
  maxR: 9400,
  /** Half the tower's width (walls at +-HALF), the island's radius and top. */
  half: 18,
  islandR: 27,
  islandTop: 125,
  /** Floor k's slab is at FLOOR0 - k * FLOOR_STEP; its room is the 12 blocks above. */
  floor0: 100,
  floorStep: 13,
  floors: 6,
  /** The arena: its lower floor, its platform (radius) and the tower's bottom. */
  arenaLow: 10,
  arenaY: 18,
  arenaR: 15,
  /** How many candidates the search may try. */
  maxCandidates: 4000,
} as const;

export type FloorKind = 'combat' | 'glyph' | 'crystal' | 'parkour' | 'engineering';
export const FLOOR_KINDS: FloorKind[] = ['combat', 'glyph', 'crystal', 'parkour', 'engineering'];
export const FLOOR_NAMES: Record<FloorKind, string> = { combat: 'Combat', glyph: 'Glyph Lock', crystal: 'Crystal Sequence', parkour: 'Parkour', engineering: 'Engineering' };
/** Glyphs on the murals and the lock keys. */
export const GLYPHS = 8;

/** Blocks of the Citadel (and the Guardian's arena). */
export function citadelBlockDefs(): BlockDef[] {
  // (Local: the block registry calls this while this module may still be loading)
  const BOOL = ['false', 'true'] as const;
  const GLYPH_PROPS = ['0', '1', '2', '3', '4', '5', '6', '7'];
  const FACING4 = ['north', 'south', 'west', 'east'] as const;
  const hard = { hardness: -1, resistance: 3600000, drops: 'none' as const, creative: 'hidden' };
  return [
    { id: 'citadel_stone', name: 'Citadel Stone', sound: 'stone', model: 'cube', tex: { all: 'citadel_stone' }, mapColor: 0x2a2436, ...hard },
    { id: 'citadel_bricks', name: 'Citadel Bricks', sound: 'stone', model: 'cube', tex: { all: 'citadel_bricks' }, mapColor: 0x34304a, ...hard },
    { id: 'citadel_pillar', name: 'Citadel Pillar', sound: 'stone', model: 'cube', tex: { top: 'citadel_pillar_top', side: 'citadel_pillar' }, mapColor: 0x3a3450, ...hard },
    { id: 'citadel_tiles', name: 'Citadel Tiles', sound: 'stone', model: 'cube', tex: { all: 'citadel_tiles' }, mapColor: 0x403a56, ...hard },
    { id: 'citadel_glass', name: 'Citadel Glass', sound: 'glass', model: 'cube', tex: { all: 'citadel_glass' }, layer: 'translucent', opacity: 0, mapColor: 0x6a5a9a, ...hard },
    { id: 'citadel_lamp', name: 'Citadel Lamp', sound: 'glass', model: 'cube', tex: { all: 'citadel_lamp' }, light: 13, mapColor: 0xc8b8ff, ...hard },
    // The sealed descent door: opens (to air) when its floor's objective is done
    { id: 'citadel_door', name: 'Sealed Descent Door', sound: 'stone', model: 'cube', tex: { all: 'citadel_door' }, light: 4, mapColor: 0x6a4aa8, ...hard },
    { id: 'citadel_anchor', name: 'Citadel Anchor', sound: 'stone', model: 'cube', tex: { top: 'citadel_anchor_top', side: 'citadel_anchor' }, light: 10, mapColor: 0x8a6ae0, ...hard },
    // Glyph Lock: the mural's glyphs and the keys pressed in their order
    { id: 'citadel_glyph', name: 'Citadel Mural', sound: 'stone', model: 'cube', props: { glyph: GLYPH_PROPS }, texBy: 'glyph', tex: { all: 'citadel_glyph' }, light: 5, mapColor: 0x4a3a6a, ...hard },
    { id: 'citadel_glyph_key', name: 'Glyph Key', sound: 'stone', model: 'cube', props: { glyph: GLYPH_PROPS, lit: BOOL }, texBy: 'glyph', tex: { all: 'citadel_glyph_key' }, light: 3, mapColor: 0x5a4a7a, ...hard },
    // Crystal Sequence: pedestals that flash, and the stone that starts them
    { id: 'citadel_pedestal', name: 'Sequence Pedestal', sound: 'glass', model: 'custom', props: { lit: BOOL }, tex: { all: 'citadel_pedestal', top: 'citadel_pedestal_top', on: 'citadel_pedestal_on' }, layer: 'cutout', opacity: 0, light: 4, mapColor: 0x8a7ab0, ...hard },
    { id: 'citadel_beacon', name: 'Sequence Stone', sound: 'stone', model: 'cube', tex: { top: 'citadel_beacon_top', side: 'citadel_beacon' }, light: 8, mapColor: 0xb0a0e0, ...hard },
    // A void rift in a combat hall's floor (Void Stalkers come out of it)
    { id: 'void_rift', name: 'Void Rift', sound: 'glass', model: 'cube', tex: { all: 'void_rift' }, light: 6, mapColor: 0x100818, ...hard },
    // Engineering: levers anyone may pull (but never break)
    { id: 'citadel_lever', name: 'Citadel Lever', sound: 'stone', model: 'lever', props: { face: ['floor', 'wall', 'ceiling'], facing: [...FACING4], powered: BOOL }, tex: { all: 'citadel_lever', base: 'citadel_stone' }, interact: 'lever', ...hard },
    // Engineering floors: the core and the socket (engineering components: catalog.ts)
    { id: 'citadel_core', name: 'Citadel Core', sound: 'metal', model: 'cube', props: { facing: [...FACING4], status: ['idle', 'working', 'error'] }, tex: { all: 'citadel_core_side', top: 'citadel_core_top', bottom: 'citadel_core_top', front: 'citadel_core_front', front_on: 'citadel_core_front_on', front_err: 'citadel_core_front_err' }, light: 9, interact: 'engineering', entity: 'eng', mapColor: 0x6a4ac8, ...hard },
    { id: 'citadel_socket', name: 'Citadel Socket', sound: 'metal', model: 'cube', props: { facing: [...FACING4], status: ['idle', 'working', 'error'] }, tex: { all: 'citadel_socket_side', top: 'citadel_socket_top', bottom: 'citadel_socket_top', front: 'citadel_socket_front', front_on: 'citadel_socket_front_on', front_err: 'citadel_socket_front_err' }, light: 5, entity: 'eng', mapColor: 0x5a3aa8, ...hard },
    // The End Guardian: its arena floor, and the altar four Eclipse Shards wake it from
    { id: 'guardian_floor', name: 'Arena Floor', sound: 'stone', model: 'cube', tex: { all: 'guardian_floor' }, mapColor: 0x4a4060, ...hard },
    { id: 'guardian_altar', name: 'Guardian Altar', sound: 'stone', model: 'custom', props: { shards: ['0', '1', '2', '3', '4'], charged: BOOL }, tex: { all: 'guardian_altar', top: 'guardian_altar_top', on: 'guardian_altar_on' }, layer: 'cutout', opacity: 0, light: 6, mapColor: 0x9a88d0, ...hard },
    // A trophy
    { id: 'end_guardian_head', name: 'End Guardian Head', hardness: 1, sound: 'stone', model: 'custom', props: { facing: [...FACING4] }, tex: { all: 'end_guardian_head', front: 'end_guardian_head_front' }, layer: 'cutout', opacity: 0, light: 5, tool: 'pickaxe', mapColor: 0x8a7a5a, creative: 'functional' },
  ];
}

export function citadelItemDefs(): ItemDef[] {
  return [
    { id: 'citadel_star_chart_piece', name: 'Citadel Star Chart Piece', rarity: 'rare', creative: 'tools', tooltip: 'A torn piece of a chart of the deep band. Three pieces make a whole.' },
    { id: 'void_citadel_map', name: 'Void Citadel Map', maxStack: 1, use: 'ancient_map', rarity: 'epic', creative: 'tools', tooltip: 'It points to the Void Citadel.' },
  ];
}

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

/** Footprint half-width round the site (the island is the widest part). */
export const FOOTPRINT = CITADEL.islandR + 1;

/** The candidate sites in their seed-fixed order (it never changes for a seed). */
export function* citadelCandidates(seed: number): Generator<{ x: number; z: number }> {
  const r = new Random(hashInts(seed, 0xc17ade1));
  const a0 = r.next() * Math.PI * 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < CITADEL.maxCandidates; i++) {
    const a = a0 + i * golden;
    const rad = CITADEL.minR + ((i * 7919 + Math.floor(a0 * 1000)) % 800);
    yield { x: Math.round(Math.cos(a) * rad), z: Math.round(Math.sin(a) * rad) };
  }
}

/** The chunks (cx, cz) a Citadel at a site touches. */
export function citadelChunks(site: { x: number; z: number }): [number, number][] {
  const out: [number, number][] = [];
  for (let cx = (site.x - FOOTPRINT) >> 4; cx <= (site.x + FOOTPRINT) >> 4; cx++) for (let cz = (site.z - FOOTPRINT) >> 4; cz <= (site.z + FOOTPRINT) >> 4; cz++) out.push([cx, cz]);
  return out;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface FloorSpec {
  index: number;
  kind: FloorKind;
  /** The slab's height; the room is y + 1 .. y + 12. */
  y: number;
  /** +1: arrives at the north-west corner, leaves at the south-east; -1 the other way round. */
  m: 1 | -1;
  /** The descent door's blocks. */
  door: P3[];
  anchor: P3;
  /** The room (world box) the floor's objective is played in. */
  room: Box;
  /** Combat: rifts, how many Void Stalkers come out of them in all, and the Constructs placed. */
  rifts?: P3[];
  stalkers?: number;
  /** Glyph Lock: the mural's glyphs in order, and each glyph's key. */
  sequence?: number[];
  keys?: { glyph: number; at: P3 }[];
  sentinelAt?: P3;
  /** Crystal Sequence: the pedestals, the start stone and the pattern (pedestal indices). */
  pedestals?: P3[];
  beacon?: P3;
  pattern?: number[];
  /** Parkour: where the route starts and ends, its pulsing bridges and moving platforms. */
  start?: P3;
  finish?: Box;
  bridges?: { cells: P3[]; phase: number }[];
  movers?: { cells: P3[]; axis: 'x' | 'z'; dir: 1 | -1; length: number; phase: number }[];
  /** Engineering: the core, the socket, the three levers (A, B, C) and the rule (a truth table over A, B, C). */
  core?: P3;
  socket?: P3;
  levers?: P3[];
  rule?: { text: string; table: boolean[] };
}

export interface CitadelPlan {
  seed: number;
  x: number;
  z: number;
  bounds: Box;
  floors: FloorSpec[];
  /** The top: the entrance hall's middle (where players first arrive) and the beam's foot. */
  entrance: P3;
  arena: { center: P3; radius: number; y: number; low: number; altar: P3; pylons: P3[]; balcony: P3 };
  /** Constructs placed by the plan (structure entities). */
  entities: { type: string; x: number; y: number; z: number; data?: Record<string, unknown> }[];
  /** Builds the part of the Citadel inside the view's target chunk. */
  build(v: DecorView): void;
  /** The block the Citadel puts at a position (null: none of its business). */
  blockAt(x: number, y: number, z: number): number | null;
}

/** Boolean rules for the engineering floors: their text and truth table over (A, B, C) as bits. */
const RULES: { text: string; f: (a: boolean, b: boolean, c: boolean) => boolean }[] = [
  { text: 'A AND NOT B', f: (a, b) => a && !b },
  { text: 'A XOR B', f: (a, b) => a !== b },
  { text: '(A OR B) AND NOT C', f: (a, b, c) => (a || b) && !c },
  { text: 'NOT (A AND C)', f: (a, _b, c) => !(a && c) },
  { text: 'A AND B AND NOT C', f: (a, b, c) => a && b && !c },
  { text: '(A XOR C) OR B', f: (a, b, c) => a !== c || b },
  { text: 'NOT A AND (B OR C)', f: (a, b, c) => !a && (b || c) },
  { text: 'A OR (B AND C)', f: (a, b, c) => a || (b && c) },
];

/** The truth table of a rule as eight booleans (index = A | B << 1 | C << 2). */
export function ruleTable(f: (a: boolean, b: boolean, c: boolean) => boolean): boolean[] {
  return Array.from({ length: 8 }, (_, i) => f(!!(i & 1), !!(i & 2), !!(i & 4)));
}

/** Which floor kinds a seed gives, top to bottom: every kind once, one twice. */
export function floorKinds(seed: number): FloorKind[] {
  const r = new Random(hashInts(seed, 0xf100e));
  const kinds = [...FLOOR_KINDS, FLOOR_KINDS[r.int(FLOOR_KINDS.length)]!];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  return kinds;
}

const floorY = (k: number): number => CITADEL.floor0 - k * CITADEL.floorStep;

export function planCitadel(seed: number, site: { x: number; z: number }): CitadelPlan {
  const X = site.x;
  const Z = site.z;
  const H = CITADEL.half;
  const r = new Random(hashInts(seed, X, Z, 0xc17));
  const kinds = floorKinds(seed);
  const details = new Map<number, { s: number; be?: BlockEntityData }>();
  /** A number for a position near the site (|dx|, |dz| < 64). */
  const key = (x: number, y: number, z: number): number => ((x - X + 64) * 256 + y) * 128 + (z - Z + 64);
  /** A detail block at a local position (dx, y, dz from the site). */
  const put = (dx: number, y: number, dz: number, s: number, be?: BlockEntityData): void => {
    details.set(key(X + dx, y, Z + dz), be ? { s, be } : { s });
  };
  const AIR = 0;
  const stone = S('citadel_stone');
  const tiles = S('citadel_tiles');
  const lamp = S('citadel_lamp');
  const entities: CitadelPlan['entities'] = [];
  const floors: FloorSpec[] = [];
  /** Solid fill (the parkour floor's core) per floor: local boxes. */
  const solids: { y0: number; y1: number; test: (dx: number, dz: number) => boolean }[] = [];
  /** Openings in the outer wall (local), and cleared space outside it. */
  const openings: { y0: number; y1: number; test: (dx: number, dz: number) => boolean }[] = [];
  const outside: { y0: number; y1: number }[] = [];

  /** A ladder down a corner shaft (c: +1 the south-east corner, -1 the north-west), from y0 up to y1. */
  const shaftLadder = (c: 1 | -1, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) {
      put(c * 17, y, c * 15, stone);
      put(c * 16, y, c * 15, stateOf('ladder', { facing: c > 0 ? 'west' : 'east' }));
    }
  };

  // ------------------------------------------------------------------ the floors
  for (let k = 0; k < CITADEL.floors; k++) {
    const kind = kinds[k]!;
    const Y = floorY(k);
    const m: 1 | -1 = k % 2 === 0 ? 1 : -1;
    /** World offset of a canonical position (arrival north-west, exit south-east). */
    const at = (cx: number, dy: number, cz: number): P3 => [X + m * cx, Y + dy, Z + m * cz];
    const p = (cx: number, dy: number, cz: number, s: number, be?: BlockEntityData): void => put(m * cx, Y + dy, m * cz, s, be);
    // Facing after the half turn of an odd floor
    const face = (f: 'north' | 'south' | 'east' | 'west'): string => (m > 0 ? f : ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[f]);
    const d = k; // difficulty grows with depth
    const room: Box = { x0: X - 17, y0: Y + 1, z0: Z - 17, x1: X + 17, y1: Y + 12, z1: Z + 17 };
    // The exit: an enclosure in the canonical south-east corner, its door in the west wall, the shaft down behind it
    for (let dy = 1; dy <= 12; dy++) {
      for (let cz = 12; cz <= 17; cz++) p(12, dy, cz, S('citadel_bricks'));
      for (let cx = 12; cx <= 17; cx++) p(cx, dy, 12, S('citadel_bricks'));
    }
    const door: P3[] = [];
    for (let dy = 1; dy <= 3; dy++)
      for (let cz = 13; cz <= 15; cz++) {
        p(12, dy, cz, S('citadel_door'));
        door.push(at(12, dy, cz));
      }
    for (let cx = 14; cx <= 16; cx++) for (let cz = 14; cz <= 16; cz++) p(cx, 0, cz, AIR);
    // Down the shaft to the next floor (or the arena)
    const below = k + 1 < CITADEL.floors ? floorY(k + 1) + 1 : CITADEL.arenaY + 1;
    shaftLadder(m, below, Y);
    // The landing at the arrival corner: an anchor, a little library, a vault
    const anchor = at(-12, 1, -13);
    p(-12, 1, -13, S('citadel_anchor'));
    for (let cz = -12; cz <= -8; cz++) for (let dy = 1; dy <= 3; dy++) p(-17, dy, cz, S('bookshelf'));
    p(-16, 1, -11, stateOf('chest', { facing: face('east') }), { type: 'chest', loot: 'chest/citadel_library', lootSeed: hashInts(seed, k, 1) } as BlockEntityData);
    p(-16, 1, -9, stateOf('chest', { facing: face('east') }), { type: 'chest', loot: 'chest/citadel_vault', lootSeed: hashInts(seed, k, 2) } as BlockEntityData);
    // Lamps in the ceiling
    for (const cx of [-8, 0, 8]) for (const cz of [-8, 0, 8]) p(cx, 12, cz, lamp);
    const f: FloorSpec = { index: k, kind, y: Y, m, door, anchor, room };
    switch (kind) {
      case 'combat': {
        for (const [px, pz] of [
          [-7, -7],
          [7, -7],
          [-7, 7],
          [7, 7],
        ] as const)
          for (let dy = 1; dy <= 12; dy++) for (const ox of [0, 1]) for (const oz of [0, 1]) p(px + ox, dy, pz + oz, S('citadel_pillar'));
        f.rifts = [at(-4, 0, 4), at(4, 0, -4)];
        p(-4, 0, 4, S('void_rift'));
        p(4, 0, -4, S('void_rift'));
        f.stalkers = 2 + Math.floor(d / 2);
        const posts: [number, number][] = [
          [0, 0],
          [-6, 2],
          [6, -2],
          [2, 6],
        ];
        const sentinels = 2 + (d >= 2 ? 1 : 0) + (d >= 4 ? 1 : 0);
        for (let i = 0; i < sentinels; i++) {
          const [px, pz] = posts[i]!;
          const w = at(px, 1, pz);
          entities.push({ type: 'guardian_sentinel', x: w[0] + 0.5, y: w[1], z: w[2] + 0.5, data: { citadelFloor: k, home: w } });
        }
        if (d >= 3) {
          const w = at(5, 1, 5);
          entities.push({ type: 'guardian_bulwark', x: w[0] + 0.5, y: w[1], z: w[2] + 0.5, data: { citadelFloor: k, home: w, room: [room.x0, room.y0, room.z0, room.x1, room.y1, room.z1] } });
        }
        break;
      }
      case 'glyph': {
        const n = Math.min(6, 3 + Math.floor(d / 2));
        const pool = Array.from({ length: GLYPHS }, (_, i) => i);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = r.int(i + 1);
          [pool[i], pool[j]] = [pool[j]!, pool[i]!];
        }
        const seq = pool.slice(0, n);
        f.sequence = seq;
        // The mural on the canonical north wall, framed
        for (let i = 0; i < n; i++) {
          const cx = -(n - 1) + i * 2;
          p(cx, 4, -18, stateOf('citadel_glyph', { glyph: String(seq[i]) }));
          p(cx, 3, -18, S('citadel_bricks'));
          p(cx, 5, -18, S('citadel_bricks'));
        }
        // The keys by the door, in an order of their own
        const order = Array.from({ length: GLYPHS }, (_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = r.int(i + 1);
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        f.keys = order.map((g, i) => {
          p(18, 2, i, stateOf('citadel_glyph_key', { glyph: String(g), lit: 'false' }));
          return { glyph: g, at: at(18, 2, i) };
        });
        f.sentinelAt = at(0, 1, 4);
        // Pillars between mural and keys
        for (const [px, pz] of [
          [-5, -4],
          [5, -4],
          [-5, 5],
          [5, 5],
        ] as const)
          for (let dy = 1; dy <= 12; dy++) p(px, dy, pz, S('citadel_pillar'));
        break;
      }
      case 'crystal': {
        f.pedestals = [];
        for (const [px, pz] of [
          [-4, -3],
          [0, -3],
          [4, -3],
          [-4, 3],
          [0, 3],
          [4, 3],
        ] as const) {
          p(px, 1, pz, stateOf('citadel_pedestal', { lit: 'false' }));
          f.pedestals.push(at(px, 1, pz));
        }
        f.beacon = at(0, 1, 0);
        p(0, 1, 0, S('citadel_beacon'));
        const len = 4 + Math.floor(d * 0.6);
        const pattern: number[] = [];
        for (let i = 0; i < len; i++) {
          let n = r.int(6);
          while (pattern.length && pattern[pattern.length - 1] === n) n = r.int(6);
          pattern.push(n);
        }
        f.pattern = pattern;
        break;
      }
      case 'parkour': {
        // The room is a solid core but for the two landings: the way across runs outside, over the void
        solids.push({ y0: Y + 1, y1: Y + 12, test: (dx, dz) => !(m * dx <= -9 && m * dz <= -9) && !(m * dx >= 9 && m * dz >= 9) });
        openings.push({ y0: Y + 1, y1: Y + 3, test: (dx, dz) => (m * dx === -18 && m * dz >= -12 && m * dz <= -10) || (m * dz === 18 && m * dx >= 10 && m * dx <= 12) });
        outside.push({ y0: Y - 6, y1: Y + 12 });
        const gap = d >= 3 ? 3 : 2;
        f.start = at(-20, 1, -11);
        f.finish = { x0: Math.min(X + m * 9, X + m * 17), x1: Math.max(X + m * 9, X + m * 17), y0: Y + 1, y1: Y + 4, z0: Math.min(Z + m * 9, Z + m * 17), z1: Math.max(Z + m * 9, Z + m * 17) };
        f.bridges = [];
        f.movers = [];
        const ledge = (cx: number, cz: number, w = 3): void => {
          for (let ox = 0; ox < w; ox++) for (let oz = 0; oz < w; oz++) p(cx + ox, 0, cz + oz, tiles);
        };
        // Out of the west opening onto a ledge
        ledge(-21, -12);
        // South along x = -21: stepping stones, a pulsing bridge, a moving platform, more stones
        let z = -9 + gap - 1;
        for (let i = 0; i < 3; i++) {
          ledge(-21, z, 2);
          z += 2 + gap;
        }
        const b1: P3[] = [];
        for (let i = 0; i < 6; i++) {
          p(-20, 0, z + i, stateOf('ender_light', { fade: '0' }));
          b1.push(at(-20, 0, z + i));
        }
        f.bridges.push({ cells: b1, phase: 0 });
        z += 6;
        ledge(-21, z);
        z += 3;
        // A moving platform carrying across a long gap along z
        const mv: P3[] = [];
        for (let ox = 0; ox < 3; ox++) for (let oz = 0; oz < 3; oz++) mv.push(at(-21 + ox, 0, z + oz));
        for (const c of mv) put(c[0] - X, c[1], c[2] - Z, tiles);
        f.movers.push({ cells: mv, axis: 'z', dir: m, length: 6, phase: 0 });
        z += 3 + 6;
        ledge(-21, z);
        // Round the corner, east along z = 21
        const zc = z;
        let x = -21 + 3 + gap - 1;
        for (let i = 0; i < 3; i++) {
          ledge(x, zc, 2);
          x += 2 + gap;
        }
        const b2: P3[] = [];
        for (let i = 0; i < 7; i++) {
          p(x + i, 0, zc + 1, stateOf('ender_light', { fade: '0' }));
          b2.push(at(x + i, 0, zc + 1));
        }
        f.bridges.push({ cells: b2, phase: 80 });
        x += 7;
        while (x < 9) {
          ledge(x, zc, 2);
          x += 2 + Math.min(gap, 2);
        }
        // The last stretch: a walkway to the south opening
        for (let cx = 8; cx <= 12; cx++) for (let cz = 19; cz <= Math.max(21, zc + 1); cz++) p(cx, 0, cz, tiles);
        break;
      }
      case 'engineering': {
        f.core = at(-8, 1, 6);
        // (their engineering state comes with them: the core runs, the socket waits)
        p(-8, 1, 6, stateOf('citadel_core', { facing: face('east'), status: 'idle' }), { type: 'eng', id: 'citadel_core', energy: 0 } as BlockEntityData);
        f.socket = at(11, 1, 11);
        p(11, 1, 11, stateOf('citadel_socket', { facing: face('north'), status: 'idle' }), { type: 'eng', id: 'citadel_socket', energy: 0, cfg: { signal: 'ignore' } } as BlockEntityData);
        // Broken conduits from the core towards the socket (every so often one is gone)
        const path: [number, number][] = [];
        for (let cx = -7; cx <= 9; cx++) path.push([cx, 6]);
        for (let cz = 7; cz <= 11; cz++) path.push([9, cz]);
        path.push([10, 11]);
        path.forEach(([cx, cz], i) => {
          if (i % 4 !== 2 || i === path.length - 1) p(cx, 1, cz, S('ancient_conduit'));
        });
        // Three levers on the canonical north wall, named on signs above them
        f.levers = [];
        ['A', 'B', 'C'].forEach((name, i) => {
          const cx = -3 + i * 3;
          p(cx, 2, -17, stateOf('citadel_lever', { face: 'wall', facing: face('south'), powered: 'false' }));
          f.levers!.push(at(cx, 2, -17));
          p(cx, 3, -17, stateOf('wall_sign', { facing: face('south') }), { type: 'sign', lines: ['', name, '', ''] } as BlockEntityData);
        });
        const rule = RULES[r.int(RULES.length)]!;
        f.rule = { text: rule.text, table: ruleTable(rule.f) };
        p(17, 3, 6, stateOf('wall_sign', { facing: face('west') }), { type: 'sign', lines: ['THE DOOR OPENS', 'WHEN', rule.text, 'POWER + SIGNAL'] } as BlockEntityData);
        break;
      }
    }
    floors.push(f);
  }

  // ------------------------------------------------------------------ the top: hall and shaft
  const top = CITADEL.islandTop;
  shaftLadder(-1, floorY(0) + 1, top);
  for (let x = -16; x <= -14; x++) for (let zz = -16; zz <= -14; zz++) for (let y = floorY(0) + 13; y <= top; y++) put(x, y, zz, AIR);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = Math.round(Math.cos(a) * 12);
    const pz = Math.round(Math.sin(a) * 12);
    for (let y = top + 1; y <= top + 6; y++) put(px, y, pz, S('citadel_pillar'));
    put(px, top + 7, pz, lamp);
  }

  // ------------------------------------------------------------------ the arena
  const aY = CITADEL.arenaY;
  const altar: P3 = [X, aY + 1, Z - 9];
  put(0, aY + 1, -9, stateOf('guardian_altar', { shards: '0', charged: 'true' }));
  const pylons: P3[] = [
    [X + 6, aY + 1, Z + 6],
    [X - 6, aY + 1, Z + 6],
    [X + 6, aY + 1, Z - 6],
    [X - 6, aY + 1, Z - 6],
  ];
  // Stairs from the lower floor up to the platform, east and west
  for (let i = 0; i < 8; i++) {
    for (const ox of [15, 16]) put(ox, CITADEL.arenaLow + 1 + i, 8 - i, tiles);
    for (const ox of [-16, -15]) put(ox, CITADEL.arenaLow + 1 + i, -8 + i, tiles);
  }
  for (const [lx, lz] of [
    [-12, 0],
    [12, 0],
    [0, 12],
    [0, -12],
  ] as const)
    put(lx, 34, lz, lamp);

  const bounds: Box = { x0: X - FOOTPRINT, y0: CITADEL.arenaLow - 1, z0: Z - FOOTPRINT, x1: X + FOOTPRINT, y1: top + 8, z1: Z + FOOTPRINT };

  // ------------------------------------------------------------------ the structure, block by block
  const island = (dx: number, y: number, dz: number): number | null => {
    const rr = Math.hypot(dx, dz);
    if (rr > CITADEL.islandR) return null;
    const t = rr <= 18 ? 13 : Math.max(2, Math.round(13 - (rr - 18) * 1.25));
    if (y > top || y < top - t + 1) return null;
    if (y === top) return rr <= 14 ? tiles : S('dark_end_stone');
    return y >= top - 2 ? S('end_stone') : S('dark_end_stone');
  };
  const floorOf = (y: number): number => {
    for (let k = 0; k < CITADEL.floors; k++) if (y >= floorY(k) && y <= floorY(k) + 12) return k;
    return -1;
  };

  const blockAt = (x: number, y: number, z: number): number | null => {
    const dx = x - X;
    const dz = z - Z;
    if (Math.abs(dx) > FOOTPRINT || Math.abs(dz) > FOOTPRINT || y < bounds.y0 || y > bounds.y1) return null;
    const det = details.get(key(x, y, z));
    if (det) return det.s;
    const ax = Math.abs(dx);
    const az = Math.abs(dz);
    const inTower = ax <= H && az <= H;
    // Above the island: the hall's floor, roof ring, and clear air
    if (y > top) {
      const rr = Math.hypot(dx, dz);
      if (y === top + 7 && rr <= 14 && rr > 4) return S('citadel_bricks');
      if (rr <= 16 && y <= top + 8) return AIR;
      return null;
    }
    if (y > floorY(0) + 12) {
      // The island (the tower's top is buried in it)
      return island(dx, y, dz);
    }
    if (!inTower) {
      // Outside the walls: clear around the tower; the parkour floors' outside is open void
      const k = floorOf(y);
      if (ax <= H + 2 && az <= H + 2 && y >= CITADEL.arenaLow) return AIR;
      if (ax <= H + 8 && az <= H + 8 && outside.some((o) => y >= o.y0 && y <= o.y1)) return AIR;
      void k;
      return null;
    }
    if (y < CITADEL.arenaLow) return null;
    const wall = ax === H || az === H;
    if (wall) {
      if (ax === H && az === H) return S('citadel_pillar');
      if (openings.some((o) => y >= o.y0 && y <= o.y1 && o.test(dx, dz))) return AIR;
      const k = floorOf(y);
      if (k >= 0) {
        const fy = y - floorY(k);
        if (fy === 0 || fy === 12) return S('citadel_bricks');
        if (fy >= 5 && fy <= 7 && (Math.abs(dx) % 6 === 3 || Math.abs(dz) % 6 === 3)) return S('citadel_glass');
        return stone;
      }
      // The arena's walls: windows on the void
      if (y >= 22 && y <= 28 && (Math.abs(dx) % 6 === 0 || Math.abs(dz) % 6 === 0)) return S('citadel_glass');
      return stone;
    }
    // Inside the tower
    const k = floorOf(y);
    if (k >= 0) {
      const fy = y - floorY(k);
      if (fy === 0) return tiles;
      if (solids.some((s) => y >= s.y0 && y <= s.y1 && s.test(dx, dz))) return stone;
      return AIR;
    }
    // The arena (under the last floor)
    if (y === CITADEL.arenaLow) return Math.hypot(dx, dz) <= 4 ? S('citadel_glass') : tiles;
    if (y === CITADEL.arenaY) {
      const rr = Math.hypot(dx, dz);
      if (rr <= CITADEL.arenaR) return S('guardian_floor');
      // The corner balcony under the shaft from the last floor
      const c = floors[CITADEL.floors - 1]!.m;
      if (c * dx >= 10 && c * dz >= 10) return tiles;
      return AIR;
    }
    return AIR;
  };

  const plan: CitadelPlan = {
    seed,
    x: X,
    z: Z,
    bounds,
    floors,
    entrance: [X, top + 1, Z],
    arena: { center: [X, aY + 1, Z], radius: CITADEL.arenaR, y: aY, low: CITADEL.arenaLow, altar, pylons, balcony: [X + floors[CITADEL.floors - 1]!.m * 13, aY + 1, Z + floors[CITADEL.floors - 1]!.m * 13] },
    entities,
    blockAt,
    build(v: DecorView): void {
      const c = v.target;
      const x0 = Math.max(bounds.x0, c.cx << 4);
      const x1 = Math.min(bounds.x1, (c.cx << 4) + 15);
      const z0 = Math.max(bounds.z0, c.cz << 4);
      const z1 = Math.min(bounds.z1, (c.cz << 4) + 15);
      if (x0 > x1 || z0 > z1) return;
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++)
          for (let y = bounds.y0; y <= bounds.y1; y++) {
            const s = blockAt(x, y, z);
            if (s === null) continue;
            v.set(x, y, z, s);
            const det = details.get(key(x, y, z));
            if (det?.be) v.setBlockEntity(x, y, z, { ...det.be });
          }
    },
  };
  return plan;
}

/** Which floor (index) a position is on, -1 for none (the arena is CITADEL.floors). */
export function citadelFloorAt(plan: CitadelPlan, x: number, y: number, z: number): number {
  if (Math.abs(x - plan.x) > CITADEL.half + 8 || Math.abs(z - plan.z) > CITADEL.half + 8) return -1;
  for (const f of plan.floors) if (y >= f.y && y <= f.y + 12) return f.index;
  if (y >= CITADEL.arenaLow && y < plan.floors[plan.floors.length - 1]!.y && Math.abs(x - plan.x) <= CITADEL.half && Math.abs(z - plan.z) <= CITADEL.half) return CITADEL.floors;
  return -1;
}

/** Whether a position is in the Citadel (its island and hall included). */
export function inCitadel(plan: CitadelPlan, x: number, y: number, z: number): boolean {
  const b = plan.bounds;
  return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1 + 4;
}
