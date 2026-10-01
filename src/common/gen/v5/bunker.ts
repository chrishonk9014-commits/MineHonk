/**
 * Generator 5 bunkers. Every bunker is laid out at random on a 4 x 4 grid of
 * rooms: the entry hall under the hatch, a security gate, a maze of rooms
 * (barracks, storage, armory, lab, mess, comms...) holding two or three
 * generators, and the vault behind the blast door. The whole complex sits in
 * a bedrock shell, and the entry hall and vault are walled in bedrock too, so
 * there is no digging in or around the doors: the way in is the hatch, the
 * keycard, the generators and the blast door.
 *
 * The keycard is no longer inside: it waits in a chest at a guard post up on
 * the surface near the hatch. Bunkers dress for their biome (desert,
 * snow, taiga, jungle, swamp, badlands, mountain or temperate), from the
 * guard post and the camouflage up top to the floors and the mobs inside.
 */
import type { Random } from '../../math/rng';
import { S, stateOf, STATE_SOLID } from '../../registry/blocks';
import type { Biome } from '../../registry/biomes';
import { Builder } from '../structures/builder';
import { single, lootSeed } from '../structures/misc';
import type { Start } from '../structures/manager';
import { at, localBox, type P3 } from './common';

/** Grid origin, cell pitch, cells per side, floor depth and footprint size (local). */
const GX = 3;
const GZ = 3;
const CELL = 5;
const N = 4;
/** Interior floor, relative to the hatch at the surface. */
export const BK = -14;
const SIZE = 27;

type Theme = 'entry' | 'vault' | 'checkpoint' | 'generator' | 'barracks' | 'storage' | 'armory' | 'lab' | 'mess' | 'comms' | 'empty';
const ROOM_THEMES: Theme[] = ['barracks', 'storage', 'armory', 'lab', 'mess', 'comms', 'barracks', 'storage', 'empty'];

interface Door {
  a: number;
  b: number;
  /** The whole wall between the rooms is gone (one bigger hall). */
  open: boolean;
  /** Doorway start (1 or 2) and width (1 or 2) along the wall, inside the 4-block span. */
  off: number;
  w: number;
}

export interface BunkerLayout {
  entry: number;
  vault: number;
  /** Rooms of the maze (not the entry hall or vault), by index j * 4 + i. */
  active: boolean[];
  doors: Door[];
  themes: Theme[];
  /** Which corner each room's furniture starts from (0..3). */
  turn: number[];
  generators: number[];
  spawner: number;
  post: { x: number; z: number };
}

const idx = (i: number, j: number): number => j * N + i;
const col = (k: number): number => k % N;
const row = (k: number): number => Math.floor(k / N);

function neighbours(k: number): number[] {
  const i = col(k);
  const j = row(k);
  const out: number[] = [];
  if (j > 0) out.push(idx(i, j - 1));
  if (i < N - 1) out.push(idx(i + 1, j));
  if (j < N - 1) out.push(idx(i, j + 1));
  if (i > 0) out.push(idx(i - 1, j));
  return out;
}

function distances(from: number, ok: boolean[]): Map<number, number> {
  const d = new Map<number, number>([[from, 0]]);
  const q = [from];
  while (q.length) {
    const k = q.shift()!;
    for (const n of neighbours(k)) if (ok[n] && !d.has(n)) (d.set(n, d.get(k)! + 1), q.push(n));
  }
  return d;
}

/** Hatch column (local), over the entry hall. */
export const hatchOf = (entry: number): { x: number; z: number } => ({ x: GX + CELL * entry + 2, z: GZ + 2 });

/** The random plan of a bunker. Build, quest and mobs all derive it from the same seed. */
export function bunkerLayout(rng: Random): BunkerLayout {
  const entry = 1 + rng.int(2);
  const vault = rng.int(N);
  const E = idx(entry, 0);
  const V = idx(vault, N - 1);
  const G = idx(entry, 1);
  const F = idx(vault, N - 2);
  let active = Array.from({ length: N * N }, (_, k) => k !== E && k !== V);
  for (let k = 0; k < N * N; k++) if (active[k] && k !== G && k !== F && rng.chance(0.22)) active[k] = false;
  let dist = distances(G, active);
  // Too few rooms left connected (or none to the vault): keep the whole grid
  if (!dist.has(F) || dist.size < 7) {
    active = Array.from({ length: N * N }, (_, k) => k !== E && k !== V);
    dist = distances(G, active);
  }
  active = active.map((a, k) => a && dist.has(k));
  // A random spanning tree over the rooms, then a few loops
  const doors: Door[] = [];
  const linked = new Set<string>();
  const link = (a: number, b: number): void => {
    const open = rng.chance(0.2);
    const w = rng.chance(0.5) ? 2 : 1;
    doors.push({ a: Math.min(a, b), b: Math.max(a, b), open, off: w === 2 ? 1 : 1 + rng.int(2), w });
    linked.add(Math.min(a, b) + ':' + Math.max(a, b));
  };
  const seen = new Set([G]);
  const stack = [G];
  while (stack.length) {
    const cur = stack[stack.length - 1]!;
    const next = neighbours(cur).filter((n) => active[n] && !seen.has(n));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const n = next[rng.int(next.length)]!;
    link(cur, n);
    seen.add(n);
    stack.push(n);
  }
  for (let k = 0; k < N * N; k++)
    for (const n of neighbours(k)) if (n > k && active[k] && active[n] && !linked.has(k + ':' + n) && rng.chance(0.18)) link(k, n);
  // Generators go in the farther rooms
  const far = [...dist.keys()].filter((k) => active[k] && k !== G).sort((a, b) => dist.get(b)! - dist.get(a)! || a - b);
  const count = Math.min(far.length, 2 + (rng.chance(0.4) ? 1 : 0));
  const generators: number[] = [];
  for (let n = 0; n < count; n++) generators.push(far.splice(rng.int(Math.min(3, far.length)), 1)[0]!);
  const themes: Theme[] = [];
  const turn: number[] = [];
  for (let k = 0; k < N * N; k++) {
    themes.push(k === E ? 'entry' : k === V ? 'vault' : k === G ? 'checkpoint' : generators.includes(k) ? 'generator' : ROOM_THEMES[rng.int(ROOM_THEMES.length)]!);
    turn.push(rng.int(4));
  }
  const others = [...dist.keys()].filter((k) => active[k] && k !== G && !generators.includes(k)).sort((a, b) => a - b);
  const spawner = others.length ? others[rng.int(others.length)]! : G;
  // The guard post with the keycard: 8 to 11 blocks from the hatch, inside the footprint
  const h = hatchOf(entry);
  const spots: { x: number; z: number }[] = [];
  for (let d = 8; d <= 11; d++)
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const x = h.x + dx * d;
      const z = h.z + dz * d;
      if (x >= 3 && x <= SIZE - 4 && z >= 3 && z <= SIZE - 4) spots.push({ x, z });
    }
  const post = spots[rng.int(spots.length)]!;
  return { entry, vault, active, doors, themes, turn, generators, spawner, post };
}

// ---------------------------------------------------------------------------
// Biome styles
// ---------------------------------------------------------------------------
type PostKind = 'booth' | 'sandbag' | 'cabin' | 'hut' | 'pillbox';
interface BunkerStyle {
  id: string;
  floor: string;
  pad: string;
  post: PostKind;
  /** Post walls, corners and roof. */
  wall: string;
  corner: string;
  roof: string;
  mobs: string[];
  spawner: string;
  /** Scatter on the ground around the hatch (camouflage), if any. */
  cover?: string;
}

const STYLES: Record<string, BunkerStyle> = {
  temperate: { id: 'temperate', floor: 'smooth_stone', pad: 'gray_concrete', post: 'booth', wall: 'gray_concrete', corner: 'stone_bricks', roof: 'smooth_stone_slab', mobs: ['zombie', 'zombie', 'skeleton'], spawner: 'zombie' },
  desert: { id: 'desert', floor: 'smooth_sandstone', pad: 'cut_sandstone', post: 'sandbag', wall: 'cut_sandstone', corner: 'chiseled_sandstone', roof: 'orange_wool', mobs: ['husk', 'husk', 'skeleton'], spawner: 'husk', cover: 'dead_bush' },
  arid: { id: 'arid', floor: 'terracotta', pad: 'cut_red_sandstone', post: 'sandbag', wall: 'red_sandstone', corner: 'chiseled_red_sandstone', roof: 'brown_wool', mobs: ['husk', 'zombie', 'skeleton'], spawner: 'husk', cover: 'dead_bush' },
  snow: { id: 'snow', floor: 'polished_andesite', pad: 'packed_ice', post: 'cabin', wall: 'spruce_planks', corner: 'spruce_log', roof: 'spruce_slab', mobs: ['stray', 'stray', 'zombie'], spawner: 'stray', cover: 'snow' },
  taiga: { id: 'taiga', floor: 'polished_andesite', pad: 'cobblestone', post: 'cabin', wall: 'spruce_planks', corner: 'spruce_log', roof: 'spruce_slab', mobs: ['zombie', 'skeleton', 'skeleton'], spawner: 'skeleton', cover: 'fern' },
  jungle: { id: 'jungle', floor: 'mossy_stone_bricks', pad: 'mossy_cobblestone', post: 'hut', wall: 'jungle_planks', corner: 'jungle_log', roof: 'jungle_leaves', mobs: ['zombie', 'cave_spider', 'spider'], spawner: 'cave_spider', cover: 'leaf_litter' },
  swamp: { id: 'swamp', floor: 'mud_bricks', pad: 'packed_mud', post: 'hut', wall: 'dark_oak_planks', corner: 'dark_oak_log', roof: 'mud_bricks_slab', mobs: ['zombie', 'witch', 'slime'], spawner: 'zombie', cover: 'peat' },
  mountain: { id: 'mountain', floor: 'polished_deepslate', pad: 'stone_bricks', post: 'pillbox', wall: 'stone_bricks', corner: 'polished_deepslate', roof: 'stone_bricks_slab', mobs: ['skeleton', 'zombie', 'skeleton'], spawner: 'skeleton' },
};

export function bunkerStyle(biome: Biome): BunkerStyle {
  const snowy = biome.precipitation === 'snow';
  switch (biome.category) {
    case 'desert':
      return STYLES.desert!;
    case 'mesa':
    case 'savanna':
      return STYLES.arid!;
    case 'icy':
      return STYLES.snow!;
    case 'taiga':
      return snowy ? STYLES.snow! : STYLES.taiga!;
    case 'jungle':
      return STYLES.jungle!;
    case 'swamp':
      return STYLES.swamp!;
    case 'mountain':
      if (snowy) return STYLES.snow!;
      return biome.id === 'meadow' || biome.id === 'cherry_grove' ? STYLES.temperate! : STYLES.mountain!;
    default:
      return STYLES.temperate!;
  }
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------
/** Interior origin (local) of a room. */
const ox = (k: number): number => GX + CELL * col(k) + 1;
const oz = (k: number): number => GZ + CELL * row(k) + 1;
const CORNERS: [number, number][] = [
  [0, 0],
  [3, 0],
  [3, 3],
  [0, 3],
];
/** The n-th corner of a room, turned by the room's turn. */
const corner = (L: BunkerLayout, k: number, n: number): [number, number] => CORNERS[(n + L.turn[k]!) & 3]!;
/** Facing from a corner towards the middle of the room (along z). */
const inward = (c: [number, number]): string => (c[1] === 0 ? 'south' : 'north');

/** The gate (security) and blast door blocks: the middle two blocks of a wall span, three high. */
const gateXs = (k: number): number[] => [ox(k) + 1, ox(k) + 2];

function buildGuardPost(b: Builder, L: BunkerLayout, st: BunkerStyle, seed: number, hx: number, hz: number): void {
  const { x: px, z: pz } = L.post;
  const wall = S(st.wall);
  const cornerB = st.corner.endsWith('_log') ? stateOf(st.corner, { axis: 'y' }) : S(st.corner);
  const roof = st.roof.endsWith('_slab') ? stateOf(st.roof, { type: 'bottom' }) : S(st.roof);
  // The doorway faces the hatch
  const dx = Math.sign(hx - px);
  const dz = Math.sign(hz - pz);
  const doorSide = Math.abs(hx - px) >= Math.abs(hz - pz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
  for (let x = px - 2; x <= px + 2; x++)
    for (let z = pz - 2; z <= pz + 2; z++) {
      b.foundation(x, z, 0, S(st.pad), 8);
      b.clearAbove(x, z, x, z, 1, 5);
    }
  const isDoor = (x: number, z: number): boolean =>
    (doorSide === 'east' && x === px + 2 && z === pz) || (doorSide === 'west' && x === px - 2 && z === pz) || (doorSide === 'south' && z === pz + 2 && x === px) || (doorSide === 'north' && z === pz - 2 && x === px);
  const height = st.post === 'sandbag' ? 2 : 3;
  for (let x = px - 2; x <= px + 2; x++)
    for (let z = pz - 2; z <= pz + 2; z++) {
      const edge = x === px - 2 || x === px + 2 || z === pz - 2 || z === pz + 2;
      if (!edge) continue;
      const isCorner = (x === px - 2 || x === px + 2) && (z === pz - 2 || z === pz + 2);
      for (let y = 1; y <= height; y++) {
        if (isDoor(x, z) && y <= 2) continue;
        let s = isCorner ? cornerB : wall;
        // Windows / firing slits in the middle of each wall
        if (!isCorner && y === 2 && (x === px || z === pz) && st.post !== 'sandbag') s = st.post === 'pillbox' ? 0 : S('iron_bars');
        if (st.post === 'sandbag' && y === 2 && !isCorner) s = 0;
        b.set(x, y, z, s);
      }
    }
  // Roof (the sandbag nest gets a canopy on its corner posts)
  if (st.post === 'sandbag') {
    for (const [x, z] of [
      [px - 2, pz - 2],
      [px + 2, pz - 2],
      [px - 2, pz + 2],
      [px + 2, pz + 2],
    ] as const)
      b.set(x, 3, z, S('oak_fence'));
    for (let x = px - 2; x <= px + 2; x++) for (let z = pz - 2; z <= pz + 2; z++) b.set(x, 4, z, roof);
  } else {
    for (let x = px - 2; x <= px + 2; x++) for (let z = pz - 2; z <= pz + 2; z++) b.set(x, height + 1, z, roof);
    if (st.id === 'snow') for (let x = px - 2; x <= px + 2; x++) for (let z = pz - 2; z <= pz + 2; z++) b.set(x, height + 2, z, stateOf('snow', { layers: '2' }));
    if (st.post === 'hut') {
      for (const [x, z] of [
        [px - 3, pz],
        [px + 3, pz],
      ] as const)
        if (x >= 0 && x < SIZE) b.set(x, 3, z, stateOf('vine', x < px ? { east: 'true' } : { west: 'true' }));
    }
  }
  // Inside: the keycard's chest against the back wall, a lantern and a barrel
  const back: P3 =
    doorSide === 'east' ? [px - 1, 1, pz] : doorSide === 'west' ? [px + 1, 1, pz] : doorSide === 'south' ? [px, 1, pz - 1] : [px, 1, pz + 1];
  b.chest(back[0], 1, back[2], doorSide, 'chest/bunker_cache', lootSeed(b, back[0], 1, back[2], seed));
  const side: P3 = doorSide === 'east' || doorSide === 'west' ? [back[0], 1, pz - 1] : [px - 1, 1, back[2]];
  b.set(side[0], 1, side[2], S('barrel'));
  b.set(side[0], 2, side[2], stateOf('lantern', { hanging: 'false' }));
}

function furnish(b: Builder, L: BunkerLayout, k: number, st: BunkerStyle, seed: number, rng: Random): void {
  const x0 = ox(k);
  const z0 = oz(k);
  const y = BK + 1;
  const c = (n: number): [number, number] => corner(L, k, n);
  const put = (n: number, s: number): void => {
    const [cx, cz] = c(n);
    b.set(x0 + cx, y, z0 + cz, s);
  };
  const chest = (n: number, loot: string): void => {
    const [cx, cz] = c(n);
    b.chest(x0 + cx, y, z0 + cz, inward(c(n)), loot, lootSeed(b, x0 + cx, y, z0 + cz, seed));
  };
  // A lamp in the ceiling
  b.set(x0 + 1 + (k & 1), BK + 4, z0 + 1 + ((k >> 2) & 1), stateOf('redstone_lamp', { lit: 'true' }));
  switch (L.themes[k]) {
    case 'generator': {
      const [cx, cz] = c(0);
      b.set(x0 + cx, y, z0 + cz, stateOf('bunker_generator', { facing: inward([cx, cz]), lit: 'false' }));
      put(2, S('iron_block'));
      break;
    }
    case 'barracks': {
      for (const z of [0, 3]) {
        b.set(x0 + 1, y, z0 + z, stateOf('white_bed', { facing: 'west', part: 'foot' }));
        b.set(x0, y, z0 + z, stateOf('white_bed', { facing: 'west', part: 'head' }));
      }
      b.chest(x0 + 3, y, z0, 'south', 'chest/bunker_locker', lootSeed(b, x0 + 3, y, z0, seed));
      break;
    }
    case 'storage':
      put(0, S('barrel'));
      put(1, S('barrel'));
      chest(2, 'chest/bunker_storage');
      b.set(x0 + c(0)[0], y + 1, z0 + c(0)[1], S('barrel'));
      break;
    case 'armory':
      chest(0, 'chest/bunker_armory');
      put(1, stateOf('anvil', { facing: 'north' }));
      put(2, S('iron_block'));
      break;
    case 'lab':
      put(0, S('brewing_stand'));
      put(1, stateOf('cauldron', { level: '0' }));
      chest(2, 'chest/bunker_lab');
      break;
    case 'mess':
      put(0, S('crafting_table'));
      put(1, stateOf('smoker', { facing: inward(c(1)), lit: 'false' }));
      put(2, S('barrel'));
      break;
    case 'comms':
      put(0, S('note_block'));
      put(1, S('jukebox'));
      put(2, stateOf('redstone_lamp', { lit: 'true' }));
      chest(3, 'chest/bunker_locker');
      break;
    case 'checkpoint':
      put(0, S('barrel'));
      put(1, stateOf('lantern', { hanging: 'false' }));
      break;
    default:
      break;
  }
  if (k === L.spawner) {
    const [cx, cz] = c(3);
    if (L.themes[k] !== 'comms') b.spawner(x0 + cx, y, z0 + cz, st.spawner);
  }
  // Cobwebs in the upper corners, now and then
  for (let n = 0; n < 4; n++) if (rng.chance(0.2)) b.set(x0 + c(n)[0], BK + 3, z0 + c(n)[1], S('cobweb'));
}

export const BUNKER_V5 = single({
  id: 'bunker',
  spacing: 34,
  separation: 8,
  salt: 0xb0b55,
  sx: SIZE,
  sz: SIZE,
  height: 7,
  below: 16,
  y: 'surface',
  maxSlope: 5,
  biome: (b) => !['ocean', 'river', 'beach', 'mushroom', 'underground', 'nether', 'end', 'farlands', 'error'].includes(b.category),
  build(b, rng, seed, biome) {
    const L = bunkerLayout(rng);
    const st = bunkerStyle(biome);
    const bedrock = S('bedrock');
    const plate = S('bunker_plating');
    const floor = S(st.floor);
    const E = idx(L.entry, 0);
    const V = idx(L.vault, N - 1);
    const x1 = GX + CELL * N;
    const z1 = GZ + CELL * N;
    // 1. The bedrock shell, with the whole grid inside it
    b.fill(GX - 1, BK - 1, GZ - 1, x1 + 1, BK + 5, z1 + 1, bedrock);
    // 2. Plated walls between the maze's rooms (the entry hall and vault keep bedrock walls)
    const room = (k: number): boolean => L.active[k]! || k === E || k === V;
    for (let k = 0; k < N * N; k++) {
      if (!L.active[k]) continue;
      const a = GX + CELL * col(k);
      const c = GZ + CELL * row(k);
      for (let y = BK; y <= BK + 4; y++)
        for (let i = 0; i <= CELL; i++) {
          b.set(a + i, y, c, plate);
          b.set(a + i, y, c + CELL, plate);
          b.set(a, y, c + i, plate);
          b.set(a + CELL, y, c + i, plate);
        }
    }
    for (const k of [E, V]) {
      const a = GX + CELL * col(k);
      const c = GZ + CELL * row(k);
      for (let y = BK; y <= BK + 4; y++)
        for (let i = 0; i <= CELL; i++) {
          b.set(a + i, y, c, bedrock);
          b.set(a + i, y, c + CELL, bedrock);
          b.set(a, y, c + i, bedrock);
          b.set(a + CELL, y, c + i, bedrock);
        }
    }
    // 3. Rooms: floor, air, plated ceiling (the rooms left out stay solid bedrock)
    for (let k = 0; k < N * N; k++) {
      if (!room(k)) continue;
      for (let x = ox(k); x < ox(k) + 4; x++)
        for (let z = oz(k); z < oz(k) + 4; z++) {
          b.set(x, BK, z, floor);
          for (let y = BK + 1; y <= BK + 3; y++) b.set(x, y, z, 0);
          b.set(x, BK + 4, z, plate);
        }
    }
    // 4. Doorways and open walls between the maze's rooms
    for (const d of L.doors) {
      const horizontal = row(d.a) === row(d.b);
      const span = d.open ? [0, 1, 2, 3] : Array.from({ length: d.w }, (_, i) => d.off + i);
      const top = d.open ? BK + 3 : BK + 2;
      for (const s of span)
        for (let y = BK; y <= top; y++) {
          const x = horizontal ? GX + CELL * (col(d.a) + 1) : ox(d.a) + s;
          const z = horizontal ? oz(d.a) + s : GZ + CELL * (row(d.a) + 1);
          b.set(x, y, z, y === BK ? floor : 0);
        }
    }
    // 5. The security gate out of the entry hall, its reader, and the blast door into the vault
    const gateZ = GZ + CELL;
    for (const x of gateXs(E)) {
      b.set(x, BK, gateZ, floor);
      for (let y = BK + 1; y <= BK + 3; y++) b.set(x, y, gateZ, S('bunker_blast_door'));
    }
    b.set(ox(E), BK + 2, gateZ, stateOf('keycard_reader', { facing: 'north', lit: 'false' }));
    const blastZ = GZ + CELL * (N - 1);
    for (const x of gateXs(V)) {
      b.set(x, BK, blastZ, floor);
      for (let y = BK + 1; y <= BK + 3; y++) b.set(x, y, blastZ, S('bunker_blast_door'));
    }
    // 6. The shaft: a ladder from the hatch down into the entry hall, on a concrete column
    const h = hatchOf(L.entry);
    const concrete = S(st.pad === 'packed_ice' ? 'gray_concrete' : st.pad);
    for (let y = BK + 1; y <= -1; y++) {
      b.set(h.x, y, h.z, stateOf('ladder', { facing: 'north' }));
      b.set(h.x, y, h.z + 1, S('gray_concrete'));
      if (y > BK + 5) {
        b.set(h.x - 1, y, h.z, concrete);
        b.set(h.x + 1, y, h.z, concrete);
        b.set(h.x, y, h.z - 1, concrete);
      }
    }
    // 7. The hatch up top: a pad, the trapdoor, an old antenna and some camouflage
    for (let x = h.x - 2; x <= h.x + 2; x++)
      for (let z = h.z - 2; z <= h.z + 2; z++) {
        b.foundation(x, z, 0, S(st.pad), 6);
        b.clearAbove(x, z, x, z, 1, 5);
      }
    b.set(h.x, 0, h.z, stateOf('iron_trapdoor', { facing: 'north', half: 'top' }));
    for (let y = 1; y <= 4; y++) b.set(h.x + 2, y, h.z + 2, S('iron_bars'));
    b.set(h.x + 2, 5, h.z + 2, stateOf('end_rod', { facing: 'up' }));
    if (st.cover) {
      const cover = st.cover === 'snow' ? stateOf('snow', { layers: '1' }) : S(st.cover);
      for (let i = 0; i < 14; i++) {
        const x = h.x - 4 + rng.int(9);
        const z = h.z - 3 + rng.int(8);
        if (Math.abs(x - h.x) <= 2 && Math.abs(z - h.z) <= 2) continue;
        if (st.cover === 'peat') b.set(x, 0, z, cover);
        else if (b.get(x, 1, z) === 0 && STATE_SOLID[b.get(x, 0, z)]) b.set(x, 1, z, cover);
      }
    }
    // 8. The guard post with the keycard
    buildGuardPost(b, L, st, seed, h.x, h.z);
    // 9. Furniture: the entry hall, the maze's rooms and the vault
    for (let k = 0; k < N * N; k++) if (L.active[k]) furnish(b, L, k, st, seed, rng);
    b.set(ox(E) + 3, BK + 1, oz(E), S('barrel'));
    b.set(ox(E) + 3, BK + 1, oz(E) + 3, stateOf('lantern', { hanging: 'false' }));
    b.set(ox(E) + 2, BK + 4, oz(E) + 2, stateOf('redstone_lamp', { lit: 'true' }));
    b.set(ox(E), BK + 1, oz(E) + 2, S('yellow_concrete'));
    b.chest(ox(V) + 1, BK + 1, oz(V) + 3, 'north', 'chest/bunker_vault', lootSeed(b, ox(V) + 1, BK + 1, oz(V) + 3, seed));
    b.set(ox(V), BK + 1, oz(V) + 3, S('barrel'));
    b.set(ox(V) + 3, BK + 1, oz(V) + 3, S('barrel'));
    b.set(ox(V) + 2, BK + 1, oz(V) + 3, S('gold_block'));
    b.set(ox(V) + 1, BK + 4, oz(V) + 1, S('sea_lantern'));
    b.set(ox(V) + 2, BK + 4, oz(V) + 2, S('sea_lantern'));
  },
  mobs(b, rng, biome) {
    const L = bunkerLayout(rng);
    const st = bunkerStyle(biome);
    const out: NonNullable<Start['entities']> = [];
    const rooms = L.active.map((a, k) => (a ? k : -1)).filter((k) => k >= 0);
    for (let n = 0; n < Math.min(3, rooms.length); n++) {
      const k = rooms[(n * 5 + 3) % rooms.length]!;
      const [x, y, z] = at(b, ox(k) + 1, BK + 1, oz(k) + 2);
      out.push({ type: st.mobs[n % st.mobs.length]!, x: x + 0.5, y, z: z + 0.5 });
    }
    return out;
  },
  quest(b, rng, biome) {
    const L = bunkerLayout(rng);
    const st = bunkerStyle(biome);
    const E = idx(L.entry, 0);
    const V = idx(L.vault, N - 1);
    const gateZ = GZ + CELL;
    const blastZ = GZ + CELL * (N - 1);
    const h = hatchOf(L.entry);
    const { x: px, z: pz } = L.post;
    const dx = Math.sign(h.x - px);
    const dz = Math.sign(h.z - pz);
    const doorSide = Math.abs(h.x - px) >= Math.abs(h.z - pz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
    const back = doorSide === 'east' ? [px - 1, pz] : doorSide === 'west' ? [px + 1, pz] : doorSide === 'south' ? [px, pz - 1] : [px, pz + 1];
    return {
      kind: 'bunker',
      reader: at(b, ox(E), BK + 2, gateZ),
      doors: gateXs(E).flatMap((x) => [1, 2, 3].map((y) => at(b, x, BK + y, gateZ))),
      generators: L.generators.map((k) => {
        const [cx, cz] = corner(L, k, 0);
        return at(b, ox(k) + cx, BK + 1, oz(k) + cz);
      }),
      blast: gateXs(V).flatMap((x) => [1, 2, 3].map((y) => at(b, x, BK + y, blastZ))),
      vault: at(b, ox(V) + 1, BK + 1, oz(V) + 3),
      area: localBox(b, GX - 1, BK - 1, GZ - 1, GX + CELL * N + 1, 1, GZ + CELL * N + 1),
      cache: at(b, back[0]!, 1, back[1]!),
      hatch: at(b, h.x, 0, h.z),
      style: st.id,
    };
  },
});
