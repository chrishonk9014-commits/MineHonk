/**
 * Overworld decoration features: ore veins, stone blobs, lakes, springs,
 * dungeons, geodes, cave decoration, surface vegetation and the freeze pass.
 *
 * Every feature is a function of (seed, origin chunk, stage) and reads only
 * pure terrain for its decisions (see DecorView), so a chunk decorates
 * identically no matter which neighbours were generated first.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_BLOCK, STATE_FLUID, STATE_SOLID, STATE_REPLACEABLE, STATE_OPAQUE, blocks, withProp, getProp } from '../../registry/blocks';
import { biomeOf } from '../../registry/biomes';
import { SEA_LEVEL } from '../../world/constants';
import type { DecorView } from './view';
import { placeTree } from '../features/trees';
import type { TreeKind } from '../../data/biomes';

/** Lazily resolved block states used by features. */
let B: ReturnType<typeof makeStates> | undefined;
function makeStates() {
  return {
    air: 0,
    caveAir: S('cave_air'),
    stone: S('stone'),
    deepslate: S('deepslate'),
    water: S('water'),
    lava: S('lava'),
    dirt: S('dirt'),
    grass: S('grass_block'),
    grassSnowy: stateOf('grass_block', { snowy: true }),
    podzol: S('podzol'),
    mycelium: S('mycelium'),
    sand: S('sand'),
    redSand: S('red_sand'),
    gravel: S('gravel'),
    clay: S('clay'),
    ice: S('ice'),
    packedIce: S('packed_ice'),
    blueIce: S('blue_ice'),
    snowBlock: S('snow_block'),
    snow: stateOf('snow', { layers: 1 }),
    cobble: S('cobblestone'),
    mossyCobble: S('mossy_cobblestone'),
    spawner: S('spawner'),
    chest: S('chest'),
    shortGrass: S('short_grass'),
    fern: S('fern'),
    tallGrassLo: stateOf('tall_grass', { half: 'lower' }),
    tallGrassHi: stateOf('tall_grass', { half: 'upper' }),
    largeFernLo: stateOf('large_fern', { half: 'lower' }),
    largeFernHi: stateOf('large_fern', { half: 'upper' }),
    deadBush: S('dead_bush'),
    cactus: S('cactus'),
    sugarCane: S('sugar_cane'),
    lilyPad: S('lily_pad'),
    seagrass: S('seagrass'),
    kelp: S('kelp'),
    kelpTop: stateOf('kelp', { age: 1 }),
    pumpkin: S('pumpkin'),
    melon: S('melon'),
    berryBush: stateOf('sweet_berry_bush', { age: 3 }),
    bamboo: S('bamboo'),
    brownMushroom: S('brown_mushroom'),
    redMushroom: S('red_mushroom'),
    mossBlock: S('moss_block'),
    mossCarpet: S('moss_carpet'),
    azalea: S('azalea'),
    caveVines: S('cave_vines'),
    caveVinesBerries: stateOf('cave_vines', { berries: true }),
    glowLichenDown: stateOf('glow_lichen', { down: true }),
    glowLichenUp: stateOf('glow_lichen', { up: true }),
    dripstoneBlock: S('dripstone_block'),
    tuff: S('tuff'),
    calcite: S('calcite'),
    amethyst: S('amethyst_block'),
    amethystCluster: S('amethyst_cluster'),
    smoothBasalt: S('smooth_basalt'),
    obsidian: S('obsidian'),
    magma: S('magma_block'),
    sculk: S('sculk'),
    sculkVein: stateOf('sculk_vein', { down: true }),
    sculkSensor: S('sculk_sensor'),
    cobweb: S('cobweb'),
    bone: S('bone_block'),
    coral: ['tube_coral', 'brain_coral', 'bubble_coral', 'fire_coral', 'horn_coral'].map((c) => S(c)),
    coralBlocks: ['tube_coral_block', 'brain_coral_block', 'bubble_coral_block', 'fire_coral_block', 'horn_coral_block'].map((c) => S(c)),
  };
}
function states(): ReturnType<typeof makeStates> {
  return (B ??= makeStates());
}

function idOf(s: number): string {
  return blocks[STATE_BLOCK[s]!]!.id;
}

export function isStoneLike(s: number): boolean {
  const b = states();
  return s === b.stone || s === b.deepslate || s === b.tuff || s === S('granite') || s === S('diorite') || s === S('andesite');
}

function isAir(s: number): boolean {
  const b = states();
  return s === 0 || s === b.caveAir;
}

/** Top solid (non-fluid, non-air) block y at a column in pure terrain; -1 if none. */
export function groundY(v: DecorView, x: number, z: number): number {
  let y = v.height(x, z) - 1;
  while (y > 0) {
    const s = v.proto(x, y, z);
    if (s !== 0 && !STATE_FLUID[s]) return y;
    y--;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Ores and underground blobs
// ---------------------------------------------------------------------------
interface OreRule {
  block: string;
  deep?: string;
  size: number;
  count: number;
  minY: number;
  maxY: number;
  /** triangle distribution centred between min and max */
  triangle?: boolean;
  /** Only in these biome categories. */
  categories?: string[];
  /** Fraction of blocks skipped when exposed to air. */
  airSkip?: number;
}

const ORE_RULES: OreRule[] = [
  { block: 'dirt', size: 33, count: 7, minY: 0, maxY: 160 },
  { block: 'gravel', size: 33, count: 8, minY: 0, maxY: 255 },
  { block: 'granite', size: 64, count: 2, minY: 0, maxY: 60 },
  { block: 'diorite', size: 64, count: 2, minY: 0, maxY: 60 },
  { block: 'andesite', size: 64, count: 2, minY: 0, maxY: 60 },
  { block: 'tuff', size: 64, count: 2, minY: 0, maxY: 18 },
  { block: 'coal_ore', deep: 'deepslate_coal_ore', size: 17, count: 20, minY: 16, maxY: 136 },
  { block: 'coal_ore', size: 17, count: 12, minY: 136, maxY: 255, categories: ['mountain'] },
  { block: 'iron_ore', deep: 'deepslate_iron_ore', size: 9, count: 10, minY: 0, maxY: 72, triangle: true },
  { block: 'iron_ore', size: 9, count: 20, minY: 80, maxY: 255, categories: ['mountain'] },
  { block: 'copper_ore', deep: 'deepslate_copper_ore', size: 10, count: 16, minY: 0, maxY: 112, triangle: true },
  { block: 'gold_ore', deep: 'deepslate_gold_ore', size: 9, count: 4, minY: 0, maxY: 40, triangle: true, airSkip: 0.5 },
  { block: 'gold_ore', size: 9, count: 20, minY: 32, maxY: 100, categories: ['badlands'] },
  { block: 'redstone_ore', deep: 'deepslate_redstone_ore', size: 8, count: 8, minY: 0, maxY: 18 },
  { block: 'lapis_ore', deep: 'deepslate_lapis_ore', size: 7, count: 2, minY: 0, maxY: 34, triangle: true },
  { block: 'diamond_ore', deep: 'deepslate_diamond_ore', size: 8, count: 6, minY: 1, maxY: 18, airSkip: 0.5 },
  { block: 'sunstone_ore', size: 5, count: 3, minY: 30, maxY: 110, categories: ['desert', 'badlands', 'savanna'] },
];

/** V2 ore table: follows the thicker deepslate layer and the bigger caves. */
const ORE_RULES_V2: OreRule[] = ORE_RULES.map((r) => {
  switch (r.block) {
    case 'tuff':
      return { ...r, count: 3, maxY: 26 };
    case 'diamond_ore':
      return { ...r, count: 7, maxY: 22 };
    case 'redstone_ore':
      return { ...r, count: 9, maxY: 24 };
    case 'lapis_ore':
      return r.categories ? r : { ...r, count: 3, maxY: 40 };
    default:
      return r;
  }
});

let ORE_STATES: Map<string, number> | undefined;
function oreState(id: string): number {
  ORE_STATES ??= new Map();
  let s = ORE_STATES.get(id);
  if (s === undefined) {
    s = S(id);
    ORE_STATES.set(id, s);
  }
  return s;
}

// Scratch marks for vein(): one slot per block of the target chunk around the
// vein's height, stamped with the vein's number so it never needs clearing
const VEIN_H = 32;
const veinMark = new Uint32Array(16 * 16 * VEIN_H);
let veinStamp = 0;

/**
 * Classic ellipsoid-along-a-segment vein. `place` runs once for each block
 * of the vein inside the target chunk (in x, y, z order). The spheres along
 * the segment overlap heavily, so the union is collected first: callers only
 * look at the block's own state, which gives the same result as placing
 * every sphere in turn, at a fraction of the cost.
 */
export function vein(v: DecorView, rng: Random, x: number, y: number, z: number, size: number, place: (x: number, y: number, z: number) => void): void {
  const ang = rng.next() * Math.PI;
  // Conservative reach of the vein; skip work when it cannot touch the target chunk.
  const reach = size / 8 + size / 16 + 2;
  if (x + reach < v.bx || x - reach >= v.bx + 16 || z + reach < v.bz || z - reach >= v.bz + 16) {
    // Consume the same random numbers so later veins stay identical
    rng.int(3);
    rng.int(3);
    for (let i = 0; i < size; i++) rng.next();
    return;
  }
  const len = size / 8;
  const x0 = x + Math.sin(ang) * len;
  const x1 = x - Math.sin(ang) * len;
  const z0 = z + Math.cos(ang) * len;
  const z1 = z - Math.cos(ang) * len;
  const y0 = y + rng.int(3) - 2;
  const y1 = y + rng.int(3) - 2;
  // Heights the vein can reach: its centre line spans y-2..y, radius < size/16 + 1
  const yBase = y - 2 - Math.ceil(size / 16 + 1);
  const tall = yBase + VEIN_H > y + Math.ceil(size / 16 + 1) + 1;
  if (++veinStamp === 0xffffffff) {
    veinMark.fill(0);
    veinStamp = 1;
  }
  const stamp = veinStamp;
  let mx0 = 16;
  let mx1 = -1;
  let my0 = 256;
  let my1 = -1;
  let mz0 = 16;
  let mz1 = -1;
  for (let i = 0; i < size; i++) {
    const t = i / size;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const cz = z0 + (z1 - z0) * t;
    const r = ((Math.sin(Math.PI * t) + 1) * (rng.next() * size) / 16 + 1) / 2;
    // Clip the sphere's box to the target chunk (writes outside are discarded anyway)
    const ix0 = Math.max(v.bx, Math.floor(cx - r));
    const ix1 = Math.min(v.bx + 15, Math.floor(cx + r));
    const iy0 = Math.max(1, Math.floor(cy - r));
    const iy1 = Math.min(254, Math.floor(cy + r));
    const iz0 = Math.max(v.bz, Math.floor(cz - r));
    const iz1 = Math.min(v.bz + 15, Math.floor(cz + r));
    if (ix0 > ix1 || iz0 > iz1) continue;
    for (let bx = ix0; bx <= ix1; bx++) {
      const dx = (bx + 0.5 - cx) / r;
      if (dx * dx >= 1) continue;
      const lx = bx - v.bx;
      for (let by = iy0; by <= iy1; by++) {
        const dy = (by + 0.5 - cy) / r;
        if (dx * dx + dy * dy >= 1) continue;
        const ly = by - yBase;
        // Only the z range the sphere can cover here (a superset; the exact test decides)
        const half = r * Math.sqrt(1 - dx * dx - dy * dy);
        const za = Math.max(iz0, Math.floor(cz - half - 0.5));
        const zb = Math.min(iz1, Math.ceil(cz + half - 0.5));
        for (let bz = za; bz <= zb; bz++) {
          const dz = (bz + 0.5 - cz) / r;
          if (dx * dx + dy * dy + dz * dz >= 1) continue;
          if (!tall || ly < 0 || ly >= VEIN_H) {
            place(bx, by, bz); // outside the scratch window (never for normal sizes)
            continue;
          }
          const lz = bz - v.bz;
          veinMark[(ly << 8) | (lz << 4) | lx] = stamp;
          if (lx < mx0) mx0 = lx;
          if (lx > mx1) mx1 = lx;
          if (by < my0) my0 = by;
          if (by > my1) my1 = by;
          if (lz < mz0) mz0 = lz;
          if (lz > mz1) mz1 = lz;
        }
      }
    }
  }
  for (let lx = mx0; lx <= mx1; lx++)
    for (let by = my0; by <= my1; by++) {
      const row = (by - yBase) << 8;
      for (let lz = mz0; lz <= mz1; lz++) if (veinMark[row | (lz << 4) | lx] === stamp) place(v.bx + lx, by, v.bz + lz);
    }
}

function exposedToAir(v: DecorView, x: number, y: number, z: number): boolean {
  return isAir(v.proto(x + 1, y, z)) || isAir(v.proto(x - 1, y, z)) || isAir(v.proto(x, y + 1, z)) || isAir(v.proto(x, y - 1, z)) || isAir(v.proto(x, y, z + 1)) || isAir(v.proto(x, y, z - 1));
}

let ORE_HOST: Uint8Array | undefined;
/** 1 = stone-like host, 2 = deepslate host. */
function oreHost(): Uint8Array {
  if (ORE_HOST) return ORE_HOST;
  const b = states();
  const arr = new Uint8Array(65536);
  for (const id of ['stone', 'granite', 'diorite', 'andesite', 'tuff']) arr[S(id)] = 1;
  arr[b.deepslate] = 2;
  ORE_HOST = arr;
  return arr;
}

export function ores(v: DecorView, seed: number, ocx: number, ocz: number): void {
  oresWith(ORE_RULES, v, seed, ocx, ocz);
}

export function oresV2(v: DecorView, seed: number, ocx: number, ocz: number): void {
  oresWith(ORE_RULES_V2, v, seed, ocx, ocz);
}

function oresWith(rules: OreRule[], v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  // Veins reach at most ~6 blocks from their origin chunk
  if (bx - 8 >= v.bx + 16 || bx + 24 <= v.bx || bz - 8 >= v.bz + 16 || bz + 24 <= v.bz) return;
  const category = biomeOf(v.biome(bx + 8, bz + 8)).category;
  const host = oreHost();
  rules.forEach((rule, ri) => {
    if (rule.categories && !rule.categories.includes(category)) return;
    const rng = new Random(hashInts(seed, ocx, ocz, 0x0e5 + ri));
    const main = oreState(rule.block);
    const deep = rule.deep ? oreState(rule.deep) : main;
    const soft = rule.block === 'dirt' || rule.block === 'gravel';
    const skip = rule.airSkip ?? 0;
    for (let n = 0; n < rule.count; n++) {
      const x = bx + rng.int(16);
      const z = bz + rng.int(16);
      const y = rule.triangle ? Math.round(rule.minY + ((rng.next() + rng.next()) / 2) * (rule.maxY - rule.minY)) : rule.minY + rng.int(Math.max(1, rule.maxY - rule.minY));
      vein(v, rng, x, y, z, rule.size, (px, py, pz) => {
        const kind = host[v.get(px, py, pz)]!;
        if (kind === 0) return;
        if (skip > 0 && exposedToAir(v, px, py, pz) && hashInts(seed, px, py, pz) % 1000 < skip * 1000) return;
        v.set(px, py, pz, kind === 2 && !soft ? deep : main);
      });
    }
  });
  // Emeralds: single blocks in mountains
  if (category === 'mountain') {
    const rng = new Random(hashInts(seed, ocx, ocz, 0xe3e));
    const em = oreState('emerald_ore');
    for (let n = 3 + rng.int(6); n > 0; n--) {
      const x = bx + rng.int(16);
      const z = bz + rng.int(16);
      const y = 32 + rng.int(200);
      if (v.inside(x, z) && v.get(x, y, z) === states().stone) v.set(x, y, z, em);
    }
  }
}

// ---------------------------------------------------------------------------
// Lakes (water on the surface, lava underground)
// ---------------------------------------------------------------------------
export function lakes(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0x1a4e));
  const b = states();
  const lava = rng.chance(1 / 9);
  const water = !lava && rng.chance(1 / 24);
  if (!lava && !water) return;
  const x0 = (ocx << 4) + rng.int(16) - 8;
  const z0 = (ocz << 4) + rng.int(16) - 8;
  let y0: number;
  if (water) {
    y0 = groundY(v, x0 + 8, z0 + 8) - 3;
    if (y0 < SEA_LEVEL - 2) return;
  } else {
    y0 = 8 + rng.int(rng.int(120) + 8);
    if (y0 > SEA_LEVEL - 4 && !rng.chance(0.1)) return;
    const gy = groundY(v, x0 + 8, z0 + 8);
    if (y0 >= gy - 2) return;
  }
  // Blob mask (16x8x16)
  const mask = new Uint8Array(16 * 16 * 8);
  const blobs = 4 + rng.int(4);
  for (let i = 0; i < blobs; i++) {
    const sx = rng.next() * 6 + 3;
    const sy = rng.next() * 4 + 2;
    const sz = rng.next() * 6 + 3;
    const cx = rng.next() * (16 - sx - 2) + 1 + sx / 2;
    const cy = rng.next() * (8 - sy - 4) + 2 + sy / 2;
    const cz = rng.next() * (16 - sz - 2) + 1 + sz / 2;
    for (let x = 1; x < 15; x++)
      for (let z = 1; z < 15; z++)
        for (let y = 1; y < 7; y++) {
          const dx = (x - cx) / (sx / 2);
          const dy = (y - cy) / (sy / 2);
          const dz = (z - cz) / (sz / 2);
          if (dx * dx + dy * dy + dz * dz < 1) mask[(x * 16 + z) * 8 + y] = 1;
        }
  }
  const m = (x: number, y: number, z: number): boolean => x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < 8 && mask[(x * 16 + z) * 8 + y] === 1;
  // Reject if the boundary touches liquid below the surface line or open air below it (pure terrain)
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++)
      for (let y = 0; y < 8; y++) {
        const edge = !m(x, y, z) && (m(x + 1, y, z) || m(x - 1, y, z) || m(x, y + 1, z) || m(x, y - 1, z) || m(x, y, z + 1) || m(x, y, z - 1));
        if (!edge) continue;
        const s = v.proto(x0 + x, y0 + y, z0 + z);
        if (y >= 4 && STATE_FLUID[s]) return;
        if (y < 4 && !STATE_SOLID[s] && s !== (lava ? b.lava : b.water)) return;
      }
  const fluid = lava ? b.lava : b.water;
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++)
      for (let y = 0; y < 8; y++) {
        if (!m(x, y, z)) continue;
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        v.set(wx, wy, wz, y >= 4 ? (lava ? b.caveAir : 0) : fluid);
      }
  // Shore: grass becomes dirt under water; lava lakes get stone rims
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++)
      for (let y = 0; y < 8; y++) {
        if (m(x, y, z)) continue;
        const near = m(x + 1, y, z) || m(x - 1, y, z) || m(x, y + 1, z) || m(x, y - 1, z) || m(x, y, z + 1) || m(x, y, z - 1);
        if (!near) continue;
        const wx = x0 + x;
        const wy = y0 + y;
        const wz = z0 + z;
        const cur = v.get(wx, wy, wz);
        if (lava && y < 5 && STATE_SOLID[cur] && rng.chance(0.5)) v.set(wx, wy, wz, b.stone);
        if (!lava && y < 4 && cur === b.grass) v.set(wx, wy, wz, b.dirt);
      }
  if (!lava) {
    // Grass regrows on the exposed rim
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        const wx = x0 + x;
        const wz = z0 + z;
        for (let y = 4; y < 8; y++) {
          if (!m(x, y, z)) continue;
          const below = v.get(wx, y0 + y - 1, wz);
          if (below === b.dirt) v.set(wx, y0 + y - 1, wz, b.grass);
        }
      }
  }
}

// ---------------------------------------------------------------------------
// Springs (single fluid sources in cave walls)
// ---------------------------------------------------------------------------
export function springs(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0x5b21));
  const b = states();
  const tries = 25;
  for (let i = 0; i < tries; i++) {
    const lava = i >= 20;
    const x = (ocx << 4) + rng.int(16);
    const z = (ocz << 4) + rng.int(16);
    const y = lava ? 8 + rng.int(rng.int(100) + 1) : 8 + rng.int(160);
    if (!v.inside(x, z)) continue;
    if (!isStoneLike(v.proto(x, y, z))) continue;
    if (!isStoneLike(v.proto(x, y + 1, z)) || !isStoneLike(v.proto(x, y - 1, z))) continue;
    let stoneSides = 0;
    let airSides = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const s = v.proto(x + dx, y, z + dz);
      if (isStoneLike(s)) stoneSides++;
      else if (isAir(s)) airSides++;
    }
    if (stoneSides === 3 && airSides === 1) v.set(x, y, z, lava ? b.lava : b.water);
  }
}

// ---------------------------------------------------------------------------
// Dungeons (monster rooms)
// ---------------------------------------------------------------------------
const DUNGEON_MOBS = ['zombie', 'zombie', 'skeleton', 'spider'];

export interface DungeonSite {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  /** Generator state after the site was chosen (drives the rest of the room). */
  rng: Random;
}

/**
 * The monster room an origin chunk places: the first attempt that sits in an
 * open cave with solid floor and ceiling. Reads pure terrain only, so the
 * locator finds exactly the rooms the decorator builds. `reaches` skips
 * attempts that do not touch the chunk being decorated.
 */
export function dungeonSite(seed: number, ocx: number, ocz: number, proto: (x: number, y: number, z: number) => number, reaches?: (cx: number, cz: number, rx: number, rz: number) => boolean): DungeonSite | null {
  const rng = new Random(hashInts(seed, ocx, ocz, 0xd09e));
  for (let attempt = 0; attempt < 6; attempt++) {
    const cx = (ocx << 4) + rng.int(16);
    const cz = (ocz << 4) + rng.int(16);
    const cy = 6 + rng.int(54);
    const rx = 2 + rng.int(2);
    const rz = 2 + rng.int(2);
    if (!rng.chance(0.35)) continue;
    if (reaches && !reaches(cx, cz, rx, rz)) continue;
    // Cheap rejections: must sit in an open cave
    if (!isAir(proto(cx, cy, cz)) || !STATE_SOLID[proto(cx, cy - 1, cz)]) continue;
    // Validate against pure terrain: solid floor & ceiling, 1-5 openings in the walls
    let openings = 0;
    let ok = true;
    for (let x = cx - rx - 1; x <= cx + rx + 1 && ok; x++)
      for (let z = cz - rz - 1; z <= cz + rz + 1 && ok; z++)
        for (let y = cy - 1; y <= cy + 4; y++) {
          const s = proto(x, y, z);
          if ((y === cy - 1 || y === cy + 4) && !STATE_SOLID[s]) {
            ok = false;
            break;
          }
          if (STATE_FLUID[s]) {
            ok = false;
            break;
          }
          const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1;
          if (wall && y === cy && isAir(s) && isAir(proto(x, y + 1, z))) openings++;
        }
    if (!ok || openings < 1 || openings > 5) continue;
    return { cx, cy, cz, rx, rz, rng };
  }
  return null;
}

export function dungeons(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const site = dungeonSite(
    seed,
    ocx,
    ocz,
    (x, y, z) => v.proto(x, y, z),
    (cx, cz, rx, rz) => !(cx + rx + 1 < v.bx || cx - rx - 1 >= v.bx + 16 || cz + rz + 1 < v.bz || cz - rz - 1 >= v.bz + 16),
  );
  if (!site) return;
  const { cx, cy, cz, rx, rz, rng } = site;
  const b = states();
  {
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++)
      for (let z = cz - rz - 1; z <= cz + rz + 1; z++)
        for (let y = cy + 3; y >= cy - 1; y--) {
          const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1;
          if (!wall && y >= cy && y <= cy + 3) {
            v.set(x, y, z, b.caveAir);
          } else if (y === cy - 1) {
            v.set(x, y, z, hashInts(seed, x, y, z) % 4 === 0 ? b.cobble : b.mossyCobble);
          } else if (STATE_SOLID[v.proto(x, y, z)] && y >= cy) {
            v.set(x, y, z, b.cobble);
          }
        }
    // Ceiling
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) if (STATE_SOLID[v.proto(x, cy + 4, z)]) v.set(x, cy + 4, z, b.cobble);
    // Spawner
    v.set(cx, cy, cz, b.spawner);
    v.setBlockEntity(cx, cy, cz, { type: 'spawner', mob: DUNGEON_MOBS[rng.int(DUNGEON_MOBS.length)]!, delay: 20 });
    // Chests against walls
    const chests = 1 + rng.int(2);
    for (let c = 0; c < chests; c++) {
      const side = rng.int(4);
      const along = rng.int(2 * (side < 2 ? rz : rx) + 1) - (side < 2 ? rz : rx);
      const px = side === 0 ? cx - rx : side === 1 ? cx + rx : cx + along;
      const pz = side === 2 ? cz - rz : side === 3 ? cz + rz : cz + along;
      if (px === cx && pz === cz) continue;
      const facing = side === 0 ? 'east' : side === 1 ? 'west' : side === 2 ? 'south' : 'north';
      v.set(px, cy, pz, stateOf('chest', { facing }));
      v.setBlockEntity(px, cy, pz, { type: 'chest', loot: 'chest/dungeon', lootSeed: hashInts(seed, px, cy, pz) });
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Geodes
// ---------------------------------------------------------------------------
export function geodes(v: DecorView, seed: number, ocx: number, ocz: number): void {
  geodesWith(false, v, seed, ocx, ocz);
}

/** V2: geodes only form inside rock, so a cave cuts them open instead of leaving a shell in the air. */
export function geodesV2(v: DecorView, seed: number, ocx: number, ocz: number): void {
  geodesWith(true, v, seed, ocx, ocz);
}

function geodesWith(rockOnly: boolean, v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0x6e0d));
  if (!rng.chance(1 / 24)) return;
  const b = states();
  const cx = (ocx << 4) + rng.int(16);
  const cz = (ocz << 4) + rng.int(16);
  const cy = 8 + rng.int(40);
  const r = 4 + rng.next() * 2;
  if (cy + r + 4 >= groundY(v, cx, cz)) return;
  const R = Math.ceil(r + 2);
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++) {
        const wx = cx + x;
        const wy = cy + y;
        const wz = cz + z;
        if (!v.inside(wx, wz)) continue;
        const n = ((hashInts(seed, wx, wy, wz) & 255) / 255) * 0.4;
        const d = Math.sqrt(x * x + y * y + z * z) + n;
        if (d > r + 2) continue;
        const here = v.proto(wx, wy, wz);
        if (STATE_FLUID[here]) continue;
        if (rockOnly && (here === 0 || here === b.caveAir)) continue;
        let s: number;
        if (d > r + 1.2) s = b.smoothBasalt;
        else if (d > r + 0.4) s = b.calcite;
        else if (d > r - 0.6) s = b.amethyst;
        else s = b.caveAir;
        v.set(wx, wy, wz, s);
      }
  // Crystals on budding blocks
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++) {
        const wx = cx + x;
        const wy = cy + y;
        const wz = cz + z;
        if (!v.inside(wx, wz) || v.get(wx, wy, wz) !== b.amethyst || hashInts(seed, wx, wy, wz, 7) % 6 !== 0) continue;
        if (v.get(wx, wy + 1, wz) === b.caveAir) v.set(wx, wy + 1, wz, b.amethystCluster);
      }
}

// ---------------------------------------------------------------------------
// Cave decoration: lush / dripstone / deep dark regions, lichen, cobwebs
// ---------------------------------------------------------------------------
export function caveDecor(v: DecorView, seed: number, cx: number, cz: number, climate: (x: number, z: number) => { humidity: number; continentalness: number; weirdness: number }): void {
  // Only decorates the target chunk itself (column-local, no cross-chunk writes)
  if (v.target.cx !== cx || v.target.cz !== cz) return;
  const b = states();
  const bx = cx << 4;
  const bz = cz << 4;
  const cl = climate(bx + 8, bz + 8);
  const lush = cl.humidity > 0.35;
  const dripstone = !lush && cl.continentalness > 0.45;
  const deepDark = !lush && !dripstone && cl.weirdness < -0.5;
  const rng = new Random(hashInts(seed, cx, cz, 0xca7e));
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const x = bx + lx;
      const z = bz + lz;
      const top = groundY(v, x, z) - 6;
      for (let y = 6; y < Math.min(top, 120); y++) {
        const s = v.get(x, y, z);
        if (s !== b.caveAir) continue;
        const below = v.get(x, y - 1, z);
        const above = v.get(x, y + 1, z);
        const floor = STATE_SOLID[below] && STATE_OPAQUE[below];
        const ceil = STATE_SOLID[above] && STATE_OPAQUE[above];
        const h = hashInts(seed, x, y, z, 0xc4) % 1000;
        if (lush && y < 60) {
          if (floor && isStoneLike(below)) {
            v.set(x, y - 1, z, b.mossBlock);
            if (h < 250) v.set(x, y, z, b.mossCarpet);
            else if (h < 280) v.set(x, y, z, b.azalea);
            else if (h < 380) v.set(x, y, z, b.shortGrass);
          } else if (ceil && isStoneLike(above)) {
            if (h < 90) {
              v.set(x, y + 1, z, b.mossBlock);
              const len = 1 + (h % 5);
              for (let k = 0; k < len; k++) {
                if (v.get(x, y - k, z) !== b.caveAir) break;
                v.set(x, y - k, z, k === len - 1 || h % 3 === 0 ? b.caveVinesBerries : b.caveVines);
              }
            } else if (h < 200) v.set(x, y + 1, z, b.mossBlock);
          }
        } else if (dripstone && y < 90) {
          if (floor && isStoneLike(below) && h < 60) {
            v.set(x, y - 1, z, b.dripstoneBlock);
            v.set(x, y, z, stateOf('pointed_dripstone', { vertical_direction: 'up', thickness: 'tip' }));
          } else if (ceil && isStoneLike(above) && h < 90) {
            v.set(x, y + 1, z, b.dripstoneBlock);
            const len = 1 + (h % 3);
            for (let k = 0; k < len; k++) {
              if (v.get(x, y - k, z) !== b.caveAir) break;
              const thick = k === len - 1 ? 'tip' : k === 0 && len > 2 ? 'base' : 'middle';
              v.set(x, y - k, z, stateOf('pointed_dripstone', { vertical_direction: 'down', thickness: thick }));
            }
          } else if (floor && isStoneLike(below) && h < 160) v.set(x, y - 1, z, b.dripstoneBlock);
        } else if (deepDark && y < 30) {
          if (floor && (isStoneLike(below) || below === b.deepslate)) {
            if (h < 500) v.set(x, y - 1, z, b.sculk);
            if (h < 8) v.set(x, y, z, b.sculkSensor);
            else if (h < 120) v.set(x, y, z, b.sculkVein);
          }
        } else {
          // Generic caves: glow lichen, occasional cobwebs & mushrooms
          if (ceil && h < 12 && y < 50) v.set(x, y, z, b.glowLichenUp);
          else if (floor && h < 6 && y < 40) v.set(x, y, z, rng.chance(0.5) ? b.brownMushroom : b.redMushroom);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Surface: disks, vegetation, trees, sugar cane, cacti, ocean plants
// ---------------------------------------------------------------------------
export function weighted<T extends { weight: number }>(list: T[], rng: Random): T {
  let total = 0;
  for (const e of list) total += e.weight;
  let r = rng.next() * total;
  for (const e of list) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return list[list.length - 1]!;
}

/** Sand / gravel / clay patches on river and ocean floors. */
export function disks(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0xd15c));
  const b = states();
  const kinds: [number, number, number][] = [
    [b.sand, 3, 3],
    [b.clay, 1, 2],
    [b.gravel, 1, 3],
  ];
  for (const [block, count, radius] of kinds) {
    for (let i = 0; i < count; i++) {
      const x = (ocx << 4) + rng.int(16);
      const z = (ocz << 4) + rng.int(16);
      const y = groundY(v, x, z);
      if (y < 0 || !STATE_FLUID[v.proto(x, y + 1, z)]) continue;
      const r = 2 + rng.int(radius);
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r) continue;
          for (let dy = -2; dy <= 1; dy++) {
            const s = v.get(x + dx, y + dy, z + dz);
            if (s === b.dirt || s === b.grass || s === b.sand || s === b.gravel || s === b.clay) v.set(x + dx, y + dy, z + dz, block);
          }
        }
    }
  }
}

function canPlantOn(ground: number): boolean {
  const b = states();
  return ground === b.grass || ground === b.dirt || ground === b.podzol || ground === S('coarse_dirt') || ground === b.mossBlock || ground === S('rooted_dirt') || ground === S('mud') || ground === S('far_grass_block') || ground === S('far_dirt');
}

export function trees(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0x7ee5));
  const biome = biomeOf(v.biome((ocx << 4) + 8, (ocz << 4) + 8));
  if (!biome.trees?.length) return;
  const density = biome.treeDensity ?? 0;
  let count = Math.floor(density);
  if (rng.next() < density - count) count++;
  // Occasional clearing / extra tree for natural variation
  if (density >= 1 && rng.chance(0.1)) count++;
  for (let i = 0; i < count; i++) {
    const x = (ocx << 4) + rng.int(16);
    const z = (ocz << 4) + rng.int(16);
    const kindEntry = weighted(biome.trees, rng);
    const kind = kindEntry.kind as TreeKind;
    // Trees reach at most 8 blocks sideways; skip those that cannot touch the target
    if (x + 8 < v.bx || x - 8 >= v.bx + 16 || z + 8 < v.bz || z - 8 >= v.bz + 16) continue;
    const y = groundY(v, x, z);
    if (y < 1) continue;
    const ground = v.proto(x, y, z);
    const above = v.proto(x, y + 1, z);
    const mangrove = kind === 'mangrove';
    if (STATE_FLUID[above] && !(mangrove || kind === 'swamp_oak')) continue;
    if (!mangrove && !canPlantOn(ground) && !(kind === 'huge_red_mushroom' || kind === 'huge_brown_mushroom') && !(ground === b0().sand && kind === 'acacia')) continue;
    if (STATE_FLUID[above]) {
      // swamp trees may stand in shallow water only
      if (STATE_FLUID[v.proto(x, y + 3, z)]) continue;
    }
    const treeRng = new Random(hashInts(seed, x, y, z, 0x7a));
    placeTree(
      { getState: (a, bb, c) => v.proto(a, bb, c), current: (a, bb, c) => v.get(a, bb, c) },
      (a, bb, c, s) => v.set(a, bb, c, s),
      treeRng,
      kind,
      x,
      y + 1,
      z,
    );
    // Trees convert grass under their trunk to dirt
    if (v.inside(x, z) && v.get(x, y, z) === b0().grass && v.get(x, y + 1, z) !== 0 && !STATE_FLUID[v.get(x, y + 1, z)]) v.set(x, y, z, b0().dirt);
  }
}
function b0(): ReturnType<typeof makeStates> {
  return states();
}

/** Grass, flowers and biome-specific plants. Column-local: only for the target chunk. */
export function vegetation(v: DecorView, seed: number, cx: number, cz: number): void {
  if (v.target.cx !== cx || v.target.cz !== cz) return;
  const b = states();
  const bx = cx << 4;
  const bz = cz << 4;
  const flowerStates = new Map<string, number>();
  const flower = (id: string): number => {
    let s = flowerStates.get(id);
    if (s === undefined) {
      s = blocks.find((bb) => bb.id === id)?.def.model === 'double_plant' ? stateOf(id, { half: 'lower' }) : S(id);
      flowerStates.set(id, s);
    }
    return s;
  };
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const x = bx + lx;
      const z = bz + lz;
      const biome = biomeOf(v.biome(x, z));
      const h = hashInts(seed, x, z, 0x9e9);
      const r = (h & 0xffff) / 0x10000;
      const r2 = ((h >>> 16) & 0xffff) / 0x10000;
      // Find current top (after trees)
      let y = v.height(x, z) + 24;
      while (y > 1 && (v.get(x, y, z) === 0 || v.get(x, y, z) === b.caveAir)) y--;
      const top = v.get(x, y, z);
      const above = v.get(x, y + 1, z);
      if (above !== 0) continue;
      const underwater = STATE_FLUID[top] === 1;
      if (underwater) {
        oceanPlant(v, x, y, z, biome.id, r, r2, h);
        continue;
      }
      if (top === b.sand || top === b.redSand) {
        if (biome.category === 'desert' || biome.category === 'badlands') {
          if (r < 0.004) {
            const hgt = 1 + (h % 3);
            let ok = true;
            for (let k = 1; k <= hgt && ok; k++) for (const [dx, dz] of NEIGH4) if (v.get(x + dx, y + k, z + dz) !== 0) ok = false;
            if (ok && v.inside(x, z)) for (let k = 1; k <= hgt; k++) v.set(x, y + k, z, b.cactus);
          } else if (r < 0.012) v.set(x, y + 1, z, b.deadBush);
        }
        sugarCane(v, x, y, z, r2, h);
        continue;
      }
      if (top === S('terracotta') || idOf(top).endsWith('_terracotta')) {
        if (r < 0.01) v.set(x, y + 1, z, b.deadBush);
        continue;
      }
      if (!canPlantOn(top) && top !== b.mycelium) continue;
      if (top === b.mycelium) {
        if (r < 0.03) v.set(x, y + 1, z, r2 < 0.5 ? b.brownMushroom : b.redMushroom);
        continue;
      }
      sugarCane(v, x, y, z, r2, h);
      const cat = biome.category;
      const grassD = biome.grassDensity ?? 0;
      const flowerD = biome.flowerDensity ?? 0;
      if (flowerD > 0 && biome.flowers?.length && r < flowerD) {
        // Flowers cluster in patches: pick species from a coarse cell hash
        const cell = hashInts(seed, x >> 3, z >> 3, 0xf10);
        const id = biome.flowers[(cell + (r2 < 0.2 ? h : 0)) % biome.flowers.length]!;
        const st = flower(id);
        const dbl = getProp(st, 'half') !== undefined;
        if (dbl) {
          if (v.get(x, y + 2, z) === 0) {
            v.set(x, y + 1, z, st);
            v.set(x, y + 2, z, withProp(st, 'half', 'upper'));
          }
        } else v.set(x, y + 1, z, st);
        continue;
      }
      if (r < flowerD + grassD) {
        const ferny = cat === 'taiga' || cat === 'jungle';
        const tall = r2 < 0.12;
        if (tall && v.get(x, y + 2, z) === 0) {
          v.set(x, y + 1, z, ferny && r2 < 0.06 ? b.largeFernLo : b.tallGrassLo);
          v.set(x, y + 2, z, ferny && r2 < 0.06 ? b.largeFernHi : b.tallGrassHi);
        } else v.set(x, y + 1, z, ferny && r2 < 0.4 ? b.fern : b.shortGrass);
        continue;
      }
      // Biome specials
      if (cat === 'taiga' && r < flowerD + grassD + 0.004) v.set(x, y + 1, z, b.berryBush);
      else if (cat === 'jungle' && r < flowerD + grassD + 0.002) v.set(x, y + 1, z, b.melon);
      else if (biome.id === 'bamboo_jungle' && r < flowerD + grassD + 0.06) {
        const hgt = 4 + (h % 9);
        for (let k = 1; k <= hgt; k++) {
          if (v.get(x, y + k, z) !== 0) break;
          v.set(x, y + k, z, k >= hgt - 2 ? stateOf('bamboo', { age: 1 }) : b.bamboo);
        }
        if (top === b.grass) v.set(x, y, z, b.podzol);
      } else if (r < flowerD + grassD + 0.0008) v.set(x, y + 1, z, b.pumpkin);
      else if (cat === 'swamp' && r < flowerD + grassD + 0.01) v.set(x, y + 1, z, r2 < 0.5 ? b.brownMushroom : b.redMushroom);
    }
  }
  // Lily pads on swamp water
  for (let lx = 0; lx < 16; lx++)
    for (let lz = 0; lz < 16; lz++) {
      const x = bx + lx;
      const z = bz + lz;
      const biome = biomeOf(v.biome(x, z));
      if (biome.category !== 'swamp') continue;
      const hs = hashInts(seed, x, z, 0x111);
      if (hs % 100 >= 6) continue;
      let y = v.height(x, z);
      while (y > 1 && v.get(x, y, z) === 0) y--;
      if (STATE_FLUID[v.get(x, y, z)] === 1 && v.get(x, y + 1, z) === 0) v.set(x, y + 1, z, b.lilyPad);
    }
}

const NEIGH4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function sugarCane(v: DecorView, x: number, y: number, z: number, r: number, h: number): void {
  if (r > 0.08) return;
  const b = states();
  let water = false;
  for (const [dx, dz] of NEIGH4) if (STATE_FLUID[v.get(x + dx, y, z + dz)] === 1) water = true;
  if (!water) return;
  const hgt = 1 + (h % 3) + (r < 0.03 ? 1 : 0);
  for (let k = 1; k <= hgt; k++) {
    if (v.get(x, y + k, z) !== 0) break;
    v.set(x, y + k, z, b.sugarCane);
  }
}

function oceanPlant(v: DecorView, x: number, y: number, z: number, biomeId: string, r: number, r2: number, h: number): void {
  const b = states();
  // y is the water surface column top; find the floor
  let fy = y;
  while (fy > 1 && STATE_FLUID[v.get(x, fy, z)] === 1) fy--;
  const floor = v.get(x, fy, z);
  const depth = y - fy;
  if (depth < 1 || !STATE_SOLID[floor]) return;
  if (biomeId === 'warm_ocean' && r < 0.25 && depth > 2) {
    const i = h % 5;
    if (r < 0.08) v.set(x, fy, z, b.coralBlocks[i]!);
    v.set(x, fy + 1, z, b.coral[i]!);
    return;
  }
  const cold = biomeId === 'frozen_ocean' || biomeId === 'cold_ocean';
  if (!cold && biomeId.endsWith('ocean') && r < 0.12 && depth > 3) {
    const hgt = Math.min(depth - 1, 2 + (h % 12));
    for (let k = 1; k <= hgt; k++) v.set(x, fy + k, z, k === hgt ? b.kelpTop : b.kelp);
    return;
  }
  if ((biomeId.endsWith('ocean') || biomeId === 'river' || biomeId === 'swamp') && r2 < 0.3 && depth > 1) v.set(x, fy + 1, z, b.seagrass);
}

// ---------------------------------------------------------------------------
// Special surface shapes
// ---------------------------------------------------------------------------
/** Ice spikes and icebergs. */
export function iceFeatures(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0x1ce));
  const b = states();
  const bx = (ocx << 4) + 8;
  const bz = (ocz << 4) + 8;
  const biome = biomeOf(v.biome(bx, bz)).id;
  if (biome === 'ice_spikes') {
    for (let n = rng.int(3); n >= 0; n--) {
      const x = (ocx << 4) + rng.int(16);
      const z = (ocz << 4) + rng.int(16);
      const y = groundY(v, x, z);
      if (y < SEA_LEVEL) continue;
      const tall = rng.chance(0.1);
      const hgt = tall ? 20 + rng.int(20) : 5 + rng.int(8);
      const rad = tall ? 2 + rng.int(2) : 1 + rng.int(2);
      for (let k = -2; k < hgt; k++) {
        const rr = Math.max(0, Math.round(rad * (1 - Math.max(0, k) / hgt)));
        for (let dx = -rr; dx <= rr; dx++)
          for (let dz = -rr; dz <= rr; dz++) {
            if (dx * dx + dz * dz > rr * rr + 0.5) continue;
            v.set(x + dx, y + k, z + dz, b.packedIce);
          }
      }
    }
  } else if (biome === 'frozen_ocean' && rng.chance(0.08)) {
    const x = (ocx << 4) + rng.int(16);
    const z = (ocz << 4) + rng.int(16);
    const rad = 4 + rng.int(5);
    const hgt = 4 + rng.int(10);
    const blue = rng.chance(0.3);
    for (let k = -hgt; k < hgt; k++) {
      const rr = rad * Math.sqrt(1 - Math.min(1, (k / hgt) ** 2));
      for (let dx = -Math.ceil(rr); dx <= rr; dx++)
        for (let dz = -Math.ceil(rr); dz <= rr; dz++) {
          const d = Math.hypot(dx, dz * 1.3);
          if (d > rr) continue;
          const y = SEA_LEVEL + k;
          const s = v.proto(x + dx, y, z + dz);
          if (STATE_SOLID[s]) continue;
          v.set(x + dx, y, z + dz, blue && d < rr * 0.4 && k < 0 ? b.blueIce : b.packedIce);
        }
    }
  }
}

/** Mossy boulders in old growth taigas and fallen logs in forests. */
export function boulders(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0xb01d));
  const b = states();
  const biome = biomeOf(v.biome((ocx << 4) + 8, (ocz << 4) + 8));
  if (biome.id === 'old_growth_spruce_taiga' || (biome.id === 'taiga' && rng.chance(0.2))) {
    for (let n = rng.int(3); n > 0; n--) {
      const x = (ocx << 4) + rng.int(16);
      const z = (ocz << 4) + rng.int(16);
      const y = groundY(v, x, z);
      if (y < SEA_LEVEL || STATE_FLUID[v.proto(x, y + 1, z)]) continue;
      const rad = 1 + rng.int(2);
      for (let dx = -rad; dx <= rad; dx++)
        for (let dy = -rad; dy <= rad; dy++)
          for (let dz = -rad; dz <= rad; dz++) {
            if (dx * dx + dy * dy + dz * dz > rad * rad + 1) continue;
            v.set(x + dx, y + 1 + dy, z + dz, b.mossyCobble);
          }
    }
  }
  if ((biome.category === 'forest' || biome.category === 'taiga') && rng.chance(0.15)) {
    const x = (ocx << 4) + rng.int(16);
    const z = (ocz << 4) + rng.int(16);
    const y = groundY(v, x, z);
    const ground = v.proto(x, y, z);
    if (y < SEA_LEVEL || !canPlantOn(ground)) return;
    const wood = biome.category === 'taiga' ? 'spruce' : biome.trees?.[0]?.kind === 'birch' ? 'birch' : 'oak';
    const alongX = rng.chance(0.5);
    const len = 3 + rng.int(4);
    for (let k = 0; k < len; k++) {
      const px = x + (alongX ? k : 0);
      const pz = z + (alongX ? 0 : k);
      const gy = groundY(v, px, pz);
      if (gy !== y) break;
      if (!STATE_REPLACEABLE[v.get(px, y + 1, pz)] && v.get(px, y + 1, pz) !== 0) break;
      v.set(px, y + 1, pz, stateOf(wood + '_log', { axis: alongX ? 'x' : 'z' }));
    }
  }
}

// ---------------------------------------------------------------------------
// Freeze: ice on cold water, snow layers on cold ground
// ---------------------------------------------------------------------------
export function freeze(v: DecorView): void {
  const b = states();
  const bx = v.bx;
  const bz = v.bz;
  for (let lx = 0; lx < 16; lx++)
    for (let lz = 0; lz < 16; lz++) {
      const x = bx + lx;
      const z = bz + lz;
      const biome = biomeOf(v.biome(x, z));
      let y = 255;
      while (y > 0 && v.get(x, y, z) === 0) y--;
      const top = v.get(x, y, z);
      const temp = biome.temperature - Math.max(0, y - 90) * 0.0125;
      if (temp >= 0.15 || biome.precipitation === 'none') continue;
      if (STATE_FLUID[top] === 1) {
        if (getProp(top, 'level') === '0' || getProp(top, 'level') === undefined) v.set(x, y, z, b.ice);
        continue;
      }
      const def = blocks[STATE_BLOCK[top]!]!.def;
      const solidTop = STATE_SOLID[top] && (STATE_OPAQUE[top] || def.tags?.includes('leaves'));
      if (solidTop && y < 255 && top !== b.ice && top !== b.packedIce) {
        v.set(x, y + 1, z, b.snow);
        if (top === b.grass) v.set(x, y, z, b.grassSnowy);
        else if (top === b.podzol) v.set(x, y, z, stateOf('podzol', { snowy: true }));
      } else if (STATE_REPLACEABLE[top] && def.model === 'cross') {
        // short plants get buried
        const below = v.get(x, y - 1, z);
        if (STATE_SOLID[below] && STATE_OPAQUE[below]) {
          v.set(x, y, z, b.snow);
          if (below === b.grass) v.set(x, y - 1, z, b.grassSnowy);
        }
      }
    }
}
