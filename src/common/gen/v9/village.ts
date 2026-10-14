/**
 * Generator 9 (V7 - The Halloween Update, phase 2): the V4 village and its
 * two new variants (rules and rarity in src/common/halloween/villages.ts).
 *
 * Every village is planned exactly as V4 plans it, so a normal village is the
 * V4 village block for block, and so is the layout of both variants:
 *
 *  - Trick-or-Treat Villages get extra pieces laid over the village's own
 *    (inside its pieces' boxes, so its bounds and every other structure's
 *    placement stay as they were). Each asks the server (`villages.trick`)
 *    whether the village is dressed: decided once when the server first builds
 *    any part of it, and recorded with the world, so every chunk of a village
 *    agrees. Without a server (tests, the title screen) nothing is dressed
 *    unless `villages.force` says so.
 *  - Abandoned Villages build every piece through a ruin view that drops,
 *    breaks and weathers blocks by a pure function of the seed and the
 *    position (collapsed roofs and walls, broken windows, doors and fences, no
 *    lights), then add overgrowth, rubble and cobwebs. Villagers become
 *    zombie villagers, and undead guardians keep watch; all of them stay in
 *    the village (`guard`). The start's type is 'abandoned_village'.
 *
 * As everywhere in generation, every decision reads only the seed, the plan
 * and the pure terrain, or the one block being written (and the block under
 * it, in the same chunk), so chunks come out the same in any order.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, withProp, getProp, blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID, STATE_REPLACEABLE } from '../../registry/blocks';
import { DecorView } from '../decorate/view';
import type { BlockEntityData } from '../../world/chunk';
import { Builder, rotateFacing } from '../structures/builder';
import type { StructureType, PlanContext, Start, Piece } from '../structures/manager';
import { VILLAGE_V4, planVillage, newVillageLog, DESIGN_INFO, PLAZA, type VillageLog, type LoggedBuilding, type Style, type ForcedVillage } from '../v4/village';
import { villageVariant, villageKey, dealDoors, HOME_DESIGNS, TRICK_MIN_DOORS, GUARDIANS_MIN, GUARDIANS_MAX, type DoorSpot, type Facing4, type GuardArea, type VillageVariant } from '../../halloween/villages';

/** Halloween lights (V7 Engineering decor blocks). */
const LIGHTS = ['factory_light_orange', 'factory_light_purple'] as const;
/** Zombie villagers an Abandoned Village keeps at most (its other villagers are gone). */
const ZOMBIE_VILLAGERS_MAX = 8;

const frame = (v: DecorView, bd: LoggedBuilding): Builder => new Builder(v, bd.px, bd.gy, bd.pz, bd.rot, bd.sx, bd.sz);
const fenceOf = (st: Style): number => S(`${st.flatRoof ? 'jungle' : st.wood}_fence`);

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------
/** The house doors a plan placed (world positions), in plan order. */
export function doorSpotsOf(log: VillageLog): Omit<DoorSpot, 'kind' | 'seed'>[] {
  const lift = log.style.stilts ?? 0;
  const out: Omit<DoorSpot, 'kind' | 'seed'>[] = [];
  for (const bd of log.buildings) {
    if (!HOME_DESIGNS.includes(bd.design)) continue;
    const dx = DESIGN_INFO[bd.design]!.door!;
    // The frame alone turns local into world positions (no view needed)
    const b = new Builder(null as unknown as DecorView, bd.px, bd.gy, bd.pz, bd.rot, bd.sx, bd.sz);
    const y = bd.gy + lift + 1;
    out.push({ id: out.length, x: b.wx(dx, 0), y, z: b.wz(dx, 0), facing: rotateFacing('north', bd.rot) as Facing4, out: [b.wx(dx, -1), y, b.wz(dx, -1)], design: bd.design });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trick-or-Treat dressing
// ---------------------------------------------------------------------------
type Skull = 'skeleton_skull' | 'zombie_head' | 'creeper_head';
const pickSkull = (r: number): Skull => (r < 0.45 ? 'skeleton_skull' : r < 0.8 ? 'zombie_head' : 'creeper_head');

/** Placing helpers over a builder: only into air (or plants), only onto something solid. */
function placer(b: Builder) {
  const free = (x: number, y: number, z: number): boolean => {
    const s = b.get(x, y, z);
    return s === 0 || (!!STATE_REPLACEABLE[s] && !STATE_FLUID[s]);
  };
  const solidAt = (x: number, y: number, z: number): boolean => {
    const s = b.get(x, y, z);
    return !!STATE_SOLID[s] && !STATE_FLUID[s];
  };
  const put = (x: number, y: number, z: number, state: number): boolean => {
    if (!free(x, y, z) || !solidAt(x, y - 1, z)) return false;
    b.set(x, y, z, state);
    return true;
  };
  return { free, solidAt, put };
}

const pumpkinFacing = (f: string): number => stateOf('hallow_pumpkin', { facing: f });

/**
 * Dresses one building of a Trick-or-Treat Village: pumpkins and a skull on a
 * fence post by the door, a string of orange and purple lights along the top
 * of the front wall, a few cobwebs; scarecrows in the fields, pumpkins on the
 * stalls and watchtowers. Local frame: the door on the z = 0 side, the road
 * at z < 0.
 */
function dressBuilding(v: DecorView, st: Style, bd: LoggedBuilding, seed: number): void {
  const b = frame(v, bd);
  const { free, solidAt, put } = placer(b);
  const L = st.stilts ?? 0;
  const info = DESIGN_INFO[bd.design]!;
  // Every random choice is drawn up front, the same in every chunk
  const rng = new Random(hashInts(seed, bd.px, bd.gy, bd.pz, 0x7d3e55));
  const [r1, r2, r3, r4, r5] = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
  const c1 = rng.int(4);
  const c2 = rng.int(4);
  const top = L + info.wallTop;
  const pumpkin = pumpkinFacing('north');
  const web = S('cobweb');
  const lights = (from: number, to: number): void => {
    for (let x = from; x <= to; x += 2) if (solidAt(x, top, 0)) b.set(x, top, 0, S(LIGHTS[(x >> 1) & 1]!));
  };
  const webs = (): void => {
    // One under the eave outside, one or two in the room's top corners
    if (r4 < 0.6) {
      const ex = r5 < 0.5 ? 0 : bd.sx - 1;
      if (free(ex, top, -1)) b.set(ex, top, -1, web);
    }
    const corners: [number, number][] = [
      [1, 1],
      [bd.sx - 2, 1],
      [1, bd.sz - 2],
      [bd.sx - 2, bd.sz - 2],
    ];
    for (const k of new Set([c1, c2])) {
      const [x, z] = corners[k]!;
      if (free(x, top, z)) b.set(x, top, z, web);
    }
  };
  switch (bd.design) {
    case 'cottage':
    case 'house':
    case 'manor':
    case 'workshop':
    case 'chapel': {
      const dx = info.door!;
      // Beside the door: pumpkins, or a skull on a fence post on one side
      const skullSide = r1 < 0.5 ? 0 : r2 < 0.5 ? -1 : 1;
      const skull = stateOf(pickSkull(r3), { facing: 'north' });
      for (const side of [-1, 1] as const) {
        const x = dx + side;
        if (L === 0) {
          if (side === skullSide) {
            if (free(x, 1, -1) && free(x, 2, -1) && solidAt(x, 0, -1)) {
              b.set(x, 1, -1, fenceOf(st));
              b.set(x, 2, -1, skull);
            }
          } else put(x, 1, -1, pumpkin);
        } else put(x, L + 1, 1, side === skullSide ? skull : pumpkin); // on stilts: just inside the door
      }
      lights(1, bd.sx - 2);
      webs();
      break;
    }
    case 'storehouse':
      put(2, 1 + L, -1, pumpkin);
      put(6, 1 + L, -1, pumpkinFacing('north'));
      lights(1, bd.sx - 2);
      webs();
      break;
    case 'smithy':
      put(1, L + 1, 1, pumpkin);
      put(7, L + 1, 1, stateOf('jack_o_lantern', { facing: 'north' }));
      // A head on the barrel by the forge
      put(1, L + 2, 4, stateOf(pickSkull(r3), { facing: 'east' }));
      break;
    case 'stall':
      b.set(1, 2, 1, pumpkin);
      b.set(3, 2, 1, stateOf('carved_pumpkin', { facing: 'north' }));
      // An orange and black canopy
      for (let x = 0; x < 5; x++) for (let z = 0; z < 4; z++) b.set(x, 4, z, S((x + z) % 2 ? 'orange_wool' : 'black_wool'));
      break;
    case 'farm':
      // A scarecrow, and a few pumpkins growing at the end of the field
      b.set(2, 1, 2, fenceOf(st));
      b.set(2, 2, 2, stateOf('hay_bale', { axis: 'y' }));
      b.set(2, 3, 2, stateOf('carved_pumpkin', { facing: 'north' }));
      for (const x of [1, 3, 7, 9]) b.set(x, 1, 7, S('pumpkin'));
      break;
    case 'pen':
      put(1, 1, 1, stateOf('carved_pumpkin', { facing: 'south' }));
      put(2, 2, 6, stateOf('jack_o_lantern', { facing: 'north' }));
      break;
    case 'watchtower':
      put(1, 10, 3, pumpkinFacing('west'));
      put(3, 10, 1, pumpkinFacing('north'));
      break;
  }
}

/** The plaza: pumpkins in the flower beds, a pile of them by the bell, jack o'lanterns on the lamps, lights on the well. */
function dressPlaza(v: DecorView, st: Style, log: VillageLog): void {
  const n = PLAZA * 2 + 1;
  const c = PLAZA;
  const b = new Builder(v, log.plaza.x0, log.plaza.y, log.plaza.z0, 0, n, n);
  const { put } = placer(b);
  for (const [x, z] of [
    [1, 1],
    [n - 2, 1],
    [1, n - 2],
    [n - 2, n - 2],
  ] as const)
    b.set(x, 1, z, pumpkinFacing(z < c ? 'south' : 'north'));
  put(c + 5, 1, c + 4, S('pumpkin'));
  put(c + 4, 1, c + 5, stateOf('carved_pumpkin', { facing: 'south' }));
  if (put(c + 5, 1, c + 5, stateOf('hay_bale', { axis: 'y' }))) put(c + 5, 2, c + 5, pumpkinFacing('west'));
  for (const [x, z] of [
    [0, 0],
    [n - 1, 0],
    [0, n - 1],
    [n - 1, n - 1],
  ] as const)
    b.set(x, 4, z, stateOf('jack_o_lantern', { facing: z === 0 ? 'south' : 'north' }));
  // The well's roof corners light up (a fountain has no roof)
  let i = 0;
  for (const [dx, dz] of [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ] as const) {
    const s = b.get(c + dx, 4, c + dz);
    if (s !== 0 && blocks[STATE_BLOCK[s]!]!.def.model === 'slab') b.set(c + dx, 4, c + dz, S(LIGHTS[i & 1]!));
    i++;
  }
  void st;
}

/** Dressing pieces over the village's own (same boxes, so the village's bounds don't move). */
function dressingPieces(ctx: PlanContext, s: Start, log: VillageLog): Piece[] {
  const seed = ctx.seed;
  const st = log.style;
  const on = (): boolean => (ctx.villages?.force ? ctx.villages.force === 'trick' : !!ctx.villages?.trick?.(s));
  const out: Piece[] = [];
  out.push({ box: s.pieces[log.plaza.piece]!.box, kind: 'trick_dressing', build: (v) => on() && dressPlaza(v, st, log) });
  for (const bd of log.buildings) out.push({ box: s.pieces[bd.piece]!.box, kind: 'trick_dressing', build: (v) => on() && dressBuilding(v, st, bd, seed) });
  for (const lp of log.lamps)
    out.push({
      box: s.pieces[lp.piece]!.box,
      kind: 'trick_dressing',
      build: (v) => {
        if (!on()) return;
        const f = (['north', 'south', 'west', 'east'] as const)[hashInts(seed, lp.x, lp.z, 0x1a3) & 3]!;
        new Builder(v, lp.x, lp.y, lp.z, 0, 1, 1).set(0, 4, 0, stateOf('jack_o_lantern', { facing: f }));
      },
    });
  return out;
}

// ---------------------------------------------------------------------------
// Abandoned Villages: ruins
// ---------------------------------------------------------------------------
type Kind = 'keep' | 'chest' | 'light' | 'hanging' | 'campfire' | 'lava' | 'glass' | 'bed' | 'door' | 'fence' | 'gate' | 'pot' | 'carpet' | 'wool' | 'crop' | 'farmland' | 'cobble' | 'stone_bricks' | 'paving' | 'path' | 'ladder' | 'bench' | 'flower' | 'block';

const kinds = new Map<number, Kind>();
function kindOf(state: number): Kind {
  let k = kinds.get(state);
  if (k) return k;
  const bt = blocks[STATE_BLOCK[state]!]!;
  const id = bt.id;
  const m = bt.def.model;
  if (m === 'chest' || id === 'chest' || id === 'barrel') k = 'chest';
  else if (id === 'lantern' || id === 'soul_lantern') k = 'hanging';
  else if (m === 'torch' || m === 'wall_torch') k = 'light';
  else if (id === 'campfire') k = 'campfire';
  else if (id === 'lava') k = 'lava';
  else if (m === 'pane') k = 'glass';
  else if (m === 'bed') k = 'bed';
  else if (m === 'door') k = 'door';
  else if (m === 'fence') k = 'fence';
  else if (m === 'fence_gate') k = 'gate';
  else if (id === 'flower_pot') k = 'pot';
  else if (m === 'carpet') k = 'carpet';
  else if (id.endsWith('_wool')) k = 'wool';
  else if (m === 'crop') k = 'crop';
  else if (id === 'farmland') k = 'farmland';
  else if (id === 'cobblestone') k = 'cobble';
  else if (id === 'stone_bricks') k = 'stone_bricks';
  else if (id === 'andesite' || id === 'smooth_sandstone' || id === 'cut_sandstone' || id === 'packed_mud' || id === 'mud_bricks') k = 'paving';
  else if (id === 'dirt_path') k = 'path';
  else if (m === 'ladder') k = 'ladder';
  else if (m === 'stairs') k = 'bench';
  else if (m === 'cross' || m === 'double_plant') k = 'flower';
  else if (STATE_SOLID[state] && !STATE_FLUID[state] && id !== 'bell' && id !== 'water') k = 'block';
  else k = 'keep';
  kinds.set(state, k);
  return k;
}

/** A 0..1 value for a block position (and a purpose). */
const roll = (seed: number, x: number, y: number, z: number, salt: number): number => (hashInts(seed, x, y, z, salt) >>> 0) / 4294967296;

/** Wears a block: moss and cracks, rotten wood (null: it is gone). */
function weather(seed: number, k: Kind, state: number, x: number, y: number, z: number, holes: number): number | null {
  const r = roll(seed, x, y, z, 0x3ea7);
  switch (k) {
    case 'cobble':
      return r < 0.4 ? S('mossy_cobblestone') : state;
    case 'stone_bricks':
      return r < 0.25 ? S('cracked_stone_bricks') : r < 0.5 ? S('mossy_stone_bricks') : state;
    case 'block':
      return r < holes ? null : state;
    default:
      return state;
  }
}

/** How the ruin changes what a piece writes: the block to write instead, or null to leave air. */
type RuinFn = (state: number, x: number, y: number, z: number) => number | null;

/** Furnishings, lights and plants as an abandoned village has them. */
function abandonedThing(seed: number, k: Kind, state: number, x: number, y: number, z: number, st: Style): number | null | undefined {
  const r = roll(seed, x, y, z, 0x7b1e);
  switch (k) {
    case 'light':
      return null;
    case 'hanging':
      // Dim: most lights are out, a few burn cold
      return r < 0.18 ? withProp(S('soul_lantern'), 'hanging', getProp(state, 'hanging') ?? 'false') : null;
    case 'campfire':
      return withProp(state, 'lit', 'false');
    case 'lava':
      return S('magma_block');
    case 'glass':
      return r < 0.85 ? null : state;
    case 'bed':
      return null;
    case 'fence':
      return r < 0.35 ? null : state;
    case 'gate':
      return null;
    case 'pot':
      return r < 0.5 ? null : stateOf('flower_pot', { plant: 'dead_bush' });
    case 'carpet':
    case 'wool':
      return r < 0.55 ? null : state;
    case 'crop':
      return r < 0.4 ? S('dead_bush') : r < 0.7 ? S('short_grass') : null;
    case 'farmland':
      return r < 0.5 ? S('coarse_dirt') : S('dirt');
    case 'ladder':
      return r < 0.3 ? null : state;
    case 'bench':
      return state;
    case 'flower':
      return r < 0.5 ? S(st.flatRoof ? 'dead_bush' : 'short_grass') : null;
    default:
      return undefined;
  }
}

/**
 * The ruin of one building: on one side (a direction picked by the seed) its
 * walls are broken down, nearly to the floor at the far edge; the roof is
 * holed, gone where the walls fell, or gone altogether.
 */
export interface BuildingRuin {
  /** World y of the floor. */
  floor: number;
  wallTop: number;
  /** Highest block still standing in a column (Infinity: untouched). */
  standing(x: number, z: number): number;
  /** Whether a roof block survives. */
  roofStays(x: number, y: number, z: number): boolean;
}

export function buildingRuin(seed: number, st: Style, bd: LoggedBuilding): BuildingRuin {
  const L = st.stilts ?? 0;
  const info = DESIGN_INFO[bd.design]!;
  const floor = bd.gy + L;
  const wallTop = floor + info.wallTop;
  const rng = new Random(hashInts(seed, bd.px, bd.gy, bd.pz, 0xab4d0));
  const a = rng.next() * Math.PI * 2;
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const severity = 0.35 + rng.next() * 0.65;
  const roofless = rng.chance(0.3);
  const cx = (bd.x0 + bd.x1 + 1) / 2;
  const cz = (bd.z0 + bd.z1 + 1) / 2;
  const R = Math.max(1, Math.hypot(bd.x1 - bd.x0 + 1, bd.z1 - bd.z0 + 1) / 2);
  const cut = 1 - 2 * severity;
  const span = Math.max(0, wallTop - floor - 1);
  const standing = (x: number, z: number): number => {
    const t = ((x + 0.5 - cx) * ux + (z + 0.5 - cz) * uz) / R;
    if (t <= cut) return Infinity;
    const f = Math.min(1, (t - cut) / Math.max(0.05, 1 - cut));
    const j = (hashInts(seed, x, z, 0x5e1) & 3) - 1;
    return floor + Math.max(0, 1 + Math.round((1 - f) * span) + j);
  };
  return {
    floor,
    wallTop,
    standing,
    roofStays: (x, y, z) => !roofless && standing(x, z) === Infinity && roll(seed, x, y, z, 0x400f) >= 0.22,
  };
}

function ruinOfBuilding(seed: number, st: Style, ruin: BuildingRuin): RuinFn {
  return (state, x, y, z) => {
    if (state === 0) return 0;
    const k = kindOf(state);
    // Chests (and barrels) always stay: their contents are the point of coming
    if (k === 'chest') return state;
    if (k === 'door') {
      // A door stands only if its whole frame does; then it hangs open, or it is gone
      if (ruin.standing(x, z) < ruin.floor + 2 || roll(seed, x, 0, z, 0xd002) < 0.5) return null;
      return withProp(state, 'open', 'true');
    }
    if (y > ruin.floor) {
      if (y > ruin.wallTop) {
        if (!ruin.roofStays(x, y, z)) return null;
      } else if (y > ruin.standing(x, z)) return null;
    }
    const t = abandonedThing(seed, k, state, x, y, z, st);
    if (t !== undefined) return t;
    return weather(seed, k, state, x, y, z, y > ruin.floor ? 0.06 : 0);
  };
}

function ruinOfPlaza(seed: number, st: Style, y0: number): RuinFn {
  return (state, x, y, z) => {
    if (state === 0) return 0;
    const k = kindOf(state);
    const r = roll(seed, x, y, z, 0x91a3);
    // The paving is cracked and overgrown
    if (y === y0 && (k === 'paving' || k === 'cobble' || k === 'stone_bricks' || k === 'block')) {
      if (r < 0.22) return S(st.flatRoof ? 'sand' : r < 0.12 ? 'grass_block' : 'coarse_dirt');
      return weather(seed, k, state, x, y, z, 0);
    }
    if (k === 'bench') return r < 0.5 ? null : state;
    if (blocks[STATE_BLOCK[state]!]!.def.model === 'slab') return r < 0.5 ? null : state;
    const t = abandonedThing(seed, k, state, x, y, z, st);
    if (t !== undefined) return t;
    return weather(seed, k, state, x, y, z, 0);
  };
}

function ruinOfLamp(seed: number, st: Style, y0: number): RuinFn {
  return (state, x, y, z) => {
    if (state === 0) return 0;
    const k = kindOf(state);
    if (k === 'hanging') return null;
    if (k === 'fence' && y >= y0 + 2) return roll(seed, x, y, z, 0x1a4) < 0.5 ? null : state;
    void st;
    return state;
  };
}

function ruinOfRoad(seed: number, st: Style): RuinFn {
  return (state, x, y, z) => {
    if (state === 0) return 0;
    const k = kindOf(state);
    const r = roll(seed, x, 0, z, 0x40ad);
    if (k === 'path' || (st.flatRoof && STATE_BLOCK[state] === STATE_BLOCK[S('sandstone')])) {
      if (st.flatRoof) return r < 0.4 ? S('sand') : state;
      return r < 0.35 ? S('grass_block') : r < 0.5 ? S('coarse_dirt') : r < 0.6 ? S('gravel') : state;
    }
    // Plank bridges have lost boards
    if (k === 'block') return r < 0.35 ? null : state;
    return state;
  };
}

/** A view that builds a piece through its ruin (and swaps village loot for the abandoned village's). */
class RuinView extends DecorView {
  constructor(
    inner: DecorView,
    private readonly fn: RuinFn,
  ) {
    super(inner.target, (cx, cz) => inner.protoChunk(cx, cz));
  }

  override set(x: number, y: number, z: number, state: number): void {
    const s = this.fn(state, x, y, z);
    if (s !== null) super.set(x, y, z, s);
  }

  override setBlockEntity(x: number, y: number, z: number, data: BlockEntityData): void {
    const loot = (data as { loot?: string }).loot;
    if (typeof loot === 'string' && loot.startsWith('chest/village')) data = { ...data, loot: loot === 'chest/village_smithy' ? 'chest/abandoned_village_smithy' : 'chest/abandoned_village' } as BlockEntityData;
    super.setBlockEntity(x, y, z, data);
  }
}

function wrap(p: Piece, fn: RuinFn): void {
  const build = p.build;
  p.build = (v) => build(new RuinView(v, fn));
}

/** Where the village's last treasure waits, per design (local, on the floor). */
const TREASURE_SPOT: Record<string, [number, number]> = { manor: [2, 7], chapel: [5, 9], house: [6, 5], cottage: [5, 3], workshop: [6, 3] };

/** After a building's ruin: rubble where it fell, moss, cobwebs, vines on what still stands. */
function overgrow(v: DecorView, seed: number, st: Style, bd: LoggedBuilding, ruin: BuildingRuin, treasure: boolean): void {
  const b = frame(v, bd);
  const { free, solidAt } = placer(b);
  const L = st.stilts ?? 0;
  const fy = L; // local floor
  const top = ruin.wallTop - bd.gy;
  if (treasure) {
    const [tx, tz] = TREASURE_SPOT[bd.design]!;
    if (free(tx, fy + 1, tz) && solidAt(tx, fy, tz)) b.chest(tx, fy + 1, tz, 'south', 'chest/abandoned_village_treasure', hashInts(seed, b.wx(tx, tz), bd.gy, b.wz(tx, tz), 0x7ea5));
  }
  const rubble = [S('cobblestone'), S('mossy_cobblestone'), S('gravel'), S(st.planks), stateOf(st.roofSlab, { type: 'bottom' })];
  const web = S('cobweb');
  const isFarm = bd.design === 'farm' || bd.design === 'pen';
  for (let lx = -1; lx <= bd.sx; lx++)
    for (let lz = -1; lz <= bd.sz; lz++) {
      const wx = b.wx(lx, lz);
      const wz = b.wz(lx, lz);
      if (!v.inside(wx, wz)) continue;
      const h = hashInts(seed, wx, wz, 0x0e9) >>> 0;
      const inside = lx > 0 && lx < bd.sx - 1 && lz > 0 && lz < bd.sz - 1;
      const edge = lx === -1 || lx === bd.sx || lz === -1 || lz === bd.sz;
      if (inside && !isFarm) {
        const fell = ruin.standing(wx, wz) < ruin.wallTop;
        if (fell && h % 8 < 3) {
          if (free(lx, fy + 1, lz) && solidAt(lx, fy, lz)) b.set(lx, fy + 1, lz, rubble[(h >>> 3) % rubble.length]!);
        } else if ((h >>> 6) % 16 < 3 && free(lx, fy + 1, lz) && solidAt(lx, fy, lz)) b.set(lx, fy + 1, lz, S('moss_carpet'));
        // Cobwebs high in the rooms, thickest in the corners
        const corner = (lx === 1 || lx === bd.sx - 2) && (lz === 1 || lz === bd.sz - 2);
        for (let y = fy + 2; y <= top; y++) {
          const r = roll(seed, wx, y, wz, 0xc0b);
          if (r < (corner && y >= top - 1 ? 0.7 : 0.035) && free(lx, y, lz) && y + bd.gy <= ruin.standing(wx, wz)) b.set(lx, y, lz, web);
        }
      } else if (edge && !isFarm) {
        // Vines climb the walls still standing (only where the wall is in this chunk too)
        const dirs: [string, number, number][] = [
          ['north', 0, -1],
          ['south', 0, 1],
          ['west', -1, 0],
          ['east', 1, 0],
        ];
        for (let y = bd.gy + fy + 1; y <= ruin.wallTop; y++) {
          if (roll(seed, wx, y, wz, 0x71e) >= 0.3) continue;
          if (v.get(wx, y, wz) !== 0) continue;
          for (const [d, ox, oz] of dirs) {
            if (!v.inside(wx + ox, wz + oz)) continue;
            const s = v.get(wx + ox, y, wz + oz);
            if (STATE_SOLID[s] && !STATE_FLUID[s] && blocks[STATE_BLOCK[s]!]!.def.model === 'cube') {
              v.set(wx, y, wz, stateOf('vine', { [d]: 'true' }));
              break;
            }
          }
        }
      }
    }
}

/** Turns a planned village into an Abandoned Village. */
function abandon(ctx: PlanContext, s: Start, log: VillageLog): void {
  const seed = ctx.seed;
  const st = log.style;
  s.type = 'abandoned_village';
  const ruins = new Map<LoggedBuilding, BuildingRuin>();
  for (const bd of log.buildings) {
    const r = buildingRuin(seed, st, bd);
    ruins.set(bd, r);
    wrap(s.pieces[bd.piece]!, ruinOfBuilding(seed, st, r));
  }
  wrap(s.pieces[log.plaza.piece]!, ruinOfPlaza(seed, st, log.plaza.y));
  for (const lp of log.lamps) wrap(s.pieces[lp.piece]!, ruinOfLamp(seed, st, lp.y));
  if (log.road) wrap(s.pieces[log.road.piece]!, ruinOfRoad(seed, st));
  // The finest house keeps the village's last treasure
  const rank = ['manor', 'chapel', 'house', 'workshop', 'cottage'];
  const best = [...log.buildings].filter((bd) => rank.includes(bd.design)).sort((a, b) => rank.indexOf(a.design) - rank.indexOf(b.design))[0];
  for (const bd of log.buildings) s.pieces.push({ box: s.pieces[bd.piece]!.box, kind: 'ruin_overgrowth', build: (v) => overgrow(v, seed, st, bd, ruins.get(bd)!, bd === best) });
  // Its people: villagers turned, the golem and animals long gone, undead keeping watch
  const guard: GuardArea = { x0: s.bounds.x0, z0: s.bounds.z0, x1: s.bounds.x1, z1: s.bounds.z1, y: s.y };
  const entities: NonNullable<Start['entities']> = [];
  for (const e of s.entities ?? []) {
    if (e.type !== 'villager' || entities.length >= ZOMBIE_VILLAGERS_MAX) continue;
    entities.push({ type: 'zombie_villager', x: e.x, y: e.y, z: e.z, data: { profession: e.data?.profession ?? 'none', guard } });
  }
  const rng = new Random(hashInts(seed, s.x, s.z, 0x6a2d));
  const n = GUARDIANS_MIN + rng.int(GUARDIANS_MAX - GUARDIANS_MIN + 1);
  const spots: [number, number, number][] = [];
  // Round the plaza, then along the roads
  for (const [dx, dz] of [
    [-3, -3],
    [3, 3],
    [-3, 3],
    [3, -3],
  ] as const)
    spots.push([s.x + dx + 0.5, s.y + 1, s.z + dz + 0.5]);
  const cols = log.road?.cols ?? [];
  for (let i = 0; i < cols.length && spots.length < GUARDIANS_MAX + 4; i += Math.max(1, Math.floor(cols.length / (GUARDIANS_MAX + 2)))) {
    const [x, z] = cols[(i * 7919) % cols.length]!;
    spots.push([x + 0.5, ctx.groundY(x, z) + 1, z + 0.5]);
  }
  const kindsFor = st.id === 'desert' ? ['husk', 'skeleton'] : st.id === 'snowy' ? ['zombie', 'stray'] : ['zombie', 'skeleton'];
  for (let i = 0; i < n && i < spots.length; i++) {
    const [x, y, z] = spots[i]!;
    entities.push({ type: rng.chance(0.6) ? kindsFor[0]! : kindsFor[1]!, x, y, z, data: { guard, guardian: true } });
  }
  s.entities = entities;
}

// ---------------------------------------------------------------------------
// The type
// ---------------------------------------------------------------------------
/** Plans a village as generator 9 has it (a variant forced for the Admin Panel and title screen). */
export function planVillageV9(ctx: PlanContext, cx: number, cz: number, rng: Random, variant?: VillageVariant, force?: ForcedVillage): Start | null {
  const log = newVillageLog();
  const s = planVillage(ctx, cx, cz, rng, log, force);
  if (!s) return null;
  const v = variant ?? ctx.villages?.force ?? villageVariant(ctx.seed, cx, cz);
  const key = villageKey(cx, cz);
  if (v === 'abandoned') {
    abandon(ctx, s, log);
    s.village = { variant: 'abandoned', key, style: log.style.id, doors: [], guard: { x0: s.bounds.x0, z0: s.bounds.z0, x1: s.bounds.x1, z1: s.bounds.z1, y: s.y } };
    return s;
  }
  const spots = v === 'trick' ? doorSpotsOf(log) : [];
  if (v === 'trick' && spots.length >= TRICK_MIN_DOORS) {
    s.village = { variant: 'trick', key, style: log.style.id, doors: dealDoors(ctx.seed, key, spots) };
    s.pieces.push(...dressingPieces(ctx, s, log));
  } else s.village = { variant: 'normal', key, style: log.style.id, doors: [] };
  return s;
}

export const VILLAGE_V9: StructureType = {
  ...VILLAGE_V4,
  plan: (ctx, cx, cz, rng) => planVillageV9(ctx, cx, cz, rng),
};
