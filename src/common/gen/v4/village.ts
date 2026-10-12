/**
 * V4 villages: planned settlements instead of a few houses along a cross.
 *
 * A village grows out from a town centre (a plaza with a well or fountain,
 * a bell, benches and market stalls) along main roads with side streets.
 * Plots are zoned by distance from the centre: shops, a storehouse, a
 * workshop and a chapel near the plaza; houses of three sizes around them;
 * fields, animal pens and watchtowers at the edge. Every building stands on
 * a foundation built down to the ground and clears the terrain above it;
 * roads follow the ground and cross small streams on plank bridges.
 *
 * Architecture follows the biome: plains, desert, savanna, taiga, snowy,
 * jungle and swamp villages (on stilts), and cherry-wood villages in
 * cherry groves. All designs are original and authored facing north (door
 * on the z = 0 side); the Builder turns them to face their road.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_SOLID, STATE_FLUID } from '../../registry/blocks';
import type { DecorView } from '../decorate/view';
import { Builder, type Rotation } from '../structures/builder';
import { boxOf, unionBoxes, type StructureType, type PlanContext, type Start, type Piece } from '../structures/manager';

interface Style {
  id: string;
  log: string;
  planks: string;
  wood: string;
  foundation: string;
  wall: string;
  roof: string;
  roofSlab: string;
  path: string;
  accent: string;
  bed: string;
  wool: string;
  flatRoof?: boolean;
  /** Buildings stand on stilts (swamps, jungles). */
  stilts?: number;
  snowy?: boolean;
  crop: string[];
  animals: string[];
}

const wood = (w: string, o: Partial<Style> & { id: string }): Style => ({
  log: `${w}_log`,
  planks: `${w}_planks`,
  wood: w,
  foundation: 'cobblestone',
  wall: `${w}_planks`,
  roof: `${w}_stairs`,
  roofSlab: `${w}_slab`,
  path: 'dirt_path',
  accent: 'white_wool',
  bed: 'red_bed',
  wool: 'white_wool',
  crop: ['wheat', 'wheat', 'carrots', 'potatoes', 'beetroots'],
  animals: ['cow', 'sheep', 'pig', 'chicken'],
  ...o,
});

const STYLES: Record<string, Style> = {
  plains: wood('oak', { id: 'plains', roof: 'spruce_stairs', roofSlab: 'spruce_slab', wall: 'oak_planks', accent: 'white_terracotta', crop: ['wheat', 'wheat', 'carrots', 'potatoes', 'beetroots', 'sunroot'] }),
  desert: wood('jungle', { id: 'desert', log: 'cut_sandstone', planks: 'smooth_sandstone', foundation: 'sandstone', wall: 'smooth_sandstone', roof: 'sandstone_stairs', roofSlab: 'sandstone_slab', accent: 'orange_terracotta', bed: 'green_bed', wool: 'orange_wool', flatRoof: true, crop: ['wheat', 'beetroots', 'sunroot'], animals: ['camel', 'chicken', 'sheep'] }),
  savanna: wood('acacia', { id: 'savanna', wall: 'orange_terracotta', accent: 'yellow_terracotta', bed: 'yellow_bed', wool: 'yellow_wool', crop: ['wheat', 'beetroots', 'potatoes'], animals: ['cow', 'sheep', 'horse'] }),
  taiga: wood('spruce', { id: 'taiga', accent: 'mossy_cobblestone', bed: 'brown_bed', wool: 'brown_wool', animals: ['sheep', 'pig', 'chicken'] }),
  snowy: wood('spruce', { id: 'snowy', foundation: 'stone_bricks', wall: 'white_terracotta', roof: 'dark_oak_stairs', roofSlab: 'dark_oak_slab', accent: 'packed_ice', bed: 'light_blue_bed', wool: 'light_blue_wool', snowy: true, crop: ['potatoes', 'carrots', 'beetroots'], animals: ['sheep', 'chicken'] }),
  jungle: wood('jungle', { id: 'jungle', foundation: 'mossy_cobblestone', roof: 'jungle_stairs', accent: 'moss_block', bed: 'lime_bed', wool: 'lime_wool', stilts: 2, crop: ['wheat', 'carrots', 'potatoes'], animals: ['chicken', 'pig'] }),
  swamp: wood('mangrove', { id: 'swamp', foundation: 'mud_bricks', wall: 'mangrove_planks', roof: 'dark_oak_stairs', roofSlab: 'dark_oak_slab', accent: 'mud_bricks', bed: 'green_bed', wool: 'green_wool', stilts: 3, crop: ['potatoes', 'beetroots'], animals: ['pig', 'chicken'] }),
  cherry: wood('cherry', { id: 'cherry', foundation: 'stone_bricks', wall: 'cherry_planks', roof: 'dark_oak_stairs', roofSlab: 'dark_oak_slab', accent: 'pink_terracotta', bed: 'pink_bed', wool: 'pink_wool' }),
};

function styleFor(biomeId: string, category: string): Style | null {
  if (category === 'desert') return STYLES.desert!;
  if (category === 'savanna') return STYLES.savanna!;
  if (biomeId === 'snowy_plains' || biomeId === 'snowy_taiga') return STYLES.snowy!;
  if (category === 'taiga') return STYLES.taiga!;
  if (biomeId === 'jungle' || biomeId === 'sparse_jungle') return STYLES.jungle!;
  if (biomeId === 'swamp') return STYLES.swamp!;
  if (biomeId === 'cherry_grove') return STYLES.cherry!;
  if (category === 'plains' || biomeId === 'meadow') return STYLES.plains!;
  return null;
}

// ---------------------------------------------------------------------------
// Building kit
// ---------------------------------------------------------------------------
const logY = (st: Style): number => (st.log.endsWith('_log') ? stateOf(st.log, { axis: 'y' }) : S(st.log));

/** Solid ground under the footprint (or stilts) and air above it. */
function site(b: Builder, st: Style, sx: number, sz: number, height: number): number {
  const lift = st.stilts ?? 0;
  b.clearAbove(-1, -1, sx, sz, 1, height + lift);
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      if (lift) {
        const post = (x === 0 || x === sx - 1) && (z === 0 || z === sz - 1);
        if (post) b.foundation(x, z, lift - 1, logY(st), 16);
      } else b.foundation(x, z, -1, S(st.foundation));
    }
  return lift;
}

function floorOf(b: Builder, st: Style, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const f = st.foundation === 'cobblestone' || st.stilts ? S(st.planks) : S(st.foundation);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) b.set(x, y, z, f);
}

function walls(b: Builder, st: Style, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const ex = x === x0 || x === x1;
        const ez = z === z0 || z === z1;
        if (!ex && !ez) continue;
        b.set(x, y, z, ex && ez ? logY(st) : y === y0 && st.foundation !== 'sandstone' && !st.stilts ? S(st.foundation) : S(st.wall));
      }
}

function door(b: Builder, st: Style, x: number, y: number, z: number): void {
  const d = st.flatRoof ? 'jungle_door' : `${st.wood}_door`;
  b.set(x, y, z, stateOf(d, { facing: 'south', half: 'lower' }));
  b.set(x, y + 1, z, stateOf(d, { facing: 'south', half: 'upper' }));
  // A step or porch out front
  if (st.stilts) {
    b.set(x, y - 1, z - 1, S(st.planks));
    for (let k = 1; k <= st.stilts; k++) b.set(x, y - 1 - k, z - 1 - k, stateOf(`${st.wood}_stairs`, { facing: 'south' }));
  } else b.set(x, y - 1, z - 1, S(st.foundation));
}

function bed(b: Builder, st: Style, x: number, y: number, z: number): void {
  b.set(x, y, z, stateOf(st.bed, { facing: 'south', part: 'foot' }));
  b.set(x, y, z + 1, stateOf(st.bed, { facing: 'south', part: 'head' }));
}

function windowAt(b: Builder, x: number, y: number, z: number, tall = false): void {
  b.set(x, y, z, S('glass_pane'));
  if (tall) b.set(x, y + 1, z, S('glass_pane'));
}

/** A pitched roof along x over [x0..x1] x [z0..z1] at height y, or a flat roof with a parapet. */
function roof(b: Builder, st: Style, x0: number, x1: number, z0: number, z1: number, y: number): void {
  if (st.flatRoof) {
    b.fill(x0, y, z0, x1, y, z1, S(st.planks));
    for (let x = x0; x <= x1; x++) {
      b.set(x, y + 1, z0, S(st.roofSlab));
      b.set(x, y + 1, z1, S(st.roofSlab));
    }
    for (let z = z0; z <= z1; z++) {
      b.set(x0, y + 1, z, S(st.roofSlab));
      b.set(x1, y + 1, z, S(st.roofSlab));
    }
    return;
  }
  const depth = z1 - z0 + 1;
  const layers = Math.ceil(depth / 2);
  for (let i = 0; i < layers; i++) {
    const zn = z0 - 1 + i;
    const zs = z1 + 1 - i;
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (zn < zs) {
        b.set(x, y + i, zn, stateOf(st.roof, { facing: 'south' }));
        b.set(x, y + i, zs, stateOf(st.roof, { facing: 'north' }));
        if (st.snowy) {
          b.set(x, y + i + 1, zn, stateOf('snow', { layers: 1 }));
          b.set(x, y + i + 1, zs, stateOf('snow', { layers: 1 }));
        }
      } else b.set(x, y + i, zn, stateOf(st.roofSlab, { type: 'bottom' }));
    }
    for (let z = zn + 1; z < zs; z++) {
      b.set(x0, y + i, z, S(st.planks));
      b.set(x1, y + i, z, S(st.planks));
    }
  }
  if (depth % 2 === 1) {
    const zc = z0 + (depth >> 1);
    for (let x = x0 - 1; x <= x1 + 1; x++) b.set(x, y + layers, zc, stateOf(st.roofSlab, { type: 'bottom' }));
  }
}

function lampPost(b: Builder, st: Style, x: number, z: number, y = 0): void {
  const fence = `${st.flatRoof ? 'jungle' : st.wood}_fence`;
  b.set(x, y + 1, z, S(fence));
  b.set(x, y + 2, z, S(fence));
  b.set(x, y + 3, z, S(fence));
  b.set(x, y + 4, z, S('lantern'));
}

type BuildFn = (b: Builder, st: Style, rng: Random, seed: number) => void;
interface Design {
  id: string;
  sx: number;
  sz: number;
  height: number;
  build: BuildFn;
  beds?: number;
  job?: string;
  /** Animals kept in or around it. */
  animals?: number;
}

const loot = (b: Builder, x: number, y: number, z: number, seed: number): number => hashInts(seed, b.wx(x, z), b.oy + y, b.wz(x, z));

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------
const cottage: Design = {
  id: 'cottage',
  sx: 7,
  sz: 7,
  height: 9,
  beds: 1,
  build(b, st, rng) {
    const y = site(b, st, 7, 7, 9);
    floorOf(b, st, 0, 0, 6, 6, y);
    walls(b, st, 0, 0, 6, 6, y + 1, y + 3);
    door(b, st, 3, y + 1, 0);
    windowAt(b, 0, y + 2, 3);
    windowAt(b, 6, y + 2, 3);
    windowAt(b, 3, y + 2, 6);
    roof(b, st, 0, 6, 0, 6, y + 4);
    bed(b, st, 1, y + 1, 4);
    b.set(5, y + 1, 5, rng.chance(0.5) ? S('crafting_table') : S('barrel'));
    b.set(5, y + 1, 1, stateOf('flower_pot', { plant: rng.pick(['poppy', 'dandelion', 'fern', 'azure_bluet']) }));
    b.set(3, y + 3, 5, stateOf('wall_torch', { facing: 'north' }));
    b.set(1, y + 1, 1, stateOf(`${st.wool.replace('_wool', '')}_carpet`));
  },
};

const house: Design = {
  id: 'house',
  sx: 9,
  sz: 7,
  height: 10,
  beds: 2,
  build(b, st, rng, seed) {
    const y = site(b, st, 9, 7, 10);
    floorOf(b, st, 0, 0, 8, 6, y);
    walls(b, st, 0, 0, 8, 6, y + 1, y + 4);
    door(b, st, 4, y + 1, 0);
    for (const [x, z] of [
      [2, 0],
      [6, 0],
      [0, 3],
      [8, 3],
      [2, 6],
      [6, 6],
    ] as const)
      windowAt(b, x, y + 2, z, true);
    roof(b, st, 0, 8, 0, 6, y + 5);
    bed(b, st, 1, y + 1, 4);
    bed(b, st, 7, y + 1, 4);
    // A table and chairs, a stove and a cupboard
    b.set(4, y + 1, 4, S(`${st.wood}_fence`));
    b.set(4, y + 2, 4, stateOf(`${st.wood}_slab`, { type: 'bottom' }));
    b.set(3, y + 1, 4, stateOf(`${st.wood}_stairs`, { facing: 'east' }));
    b.set(5, y + 1, 4, stateOf(`${st.wood}_stairs`, { facing: 'west' }));
    b.set(1, y + 1, 1, stateOf('furnace', { facing: 'south' }));
    b.set(7, y + 1, 1, S('barrel'));
    b.chest(7, y + 1, 2, 'west', 'chest/village', loot(b, 7, y + 1, 2, seed));
    b.set(4, y + 4, 3, hanging());
    b.set(2, y + 1, 1, stateOf('flower_pot', { plant: rng.pick(['poppy', 'blue_orchid', 'oak_sapling', 'cornflower']) }));
  },
};

const hanging = (): number => stateOf('lantern', { hanging: 'true' });

const manor: Design = {
  id: 'manor',
  sx: 11,
  sz: 9,
  height: 14,
  beds: 3,
  build(b, st, rng, seed) {
    const y = site(b, st, 11, 9, 14);
    floorOf(b, st, 0, 0, 10, 8, y);
    walls(b, st, 0, 0, 10, 8, y + 1, y + 8);
    // Upper floor with a stair up along the west wall
    floorOf(b, st, 1, 1, 9, 7, y + 4);
    for (let i = 0; i < 3; i++) {
      b.set(1, y + 1 + i, 3 + i, stateOf(`${st.wood}_stairs`, { facing: 'south' }));
      b.set(1, y + 4, 3 + i, 0);
    }
    b.set(1, y + 4, 6, 0);
    door(b, st, 5, y + 1, 0);
    for (const x of [2, 8]) {
      windowAt(b, x, y + 2, 0, true);
      windowAt(b, x, y + 6, 0, true);
      windowAt(b, x, y + 2, 8, true);
      windowAt(b, x, y + 6, 8, true);
    }
    windowAt(b, 10, y + 2, 4, true);
    windowAt(b, 0, y + 6, 4, true);
    windowAt(b, 10, y + 6, 4, true);
    roof(b, st, 0, 10, 0, 8, y + 9);
    // Ground floor: a hall with a hearth and a long table
    b.set(9, y + 1, 7, S('campfire'));
    b.set(9, y + 2, 7, S('cobblestone'));
    for (let x = 4; x <= 7; x++) {
      b.set(x, y + 1, 5, S(`${st.wood}_fence`));
      b.set(x, y + 2, 5, stateOf(`${st.wood}_slab`, { type: 'bottom' }));
    }
    b.set(9, y + 1, 1, S('bookshelf'));
    b.set(9, y + 2, 1, S('bookshelf'));
    b.chest(8, y + 1, 7, 'north', 'chest/village', loot(b, 8, y + 1, 7, seed));
    b.set(5, y + 3, 3, hanging());
    // Upstairs: three beds
    bed(b, st, 3, y + 5, 5);
    bed(b, st, 6, y + 5, 5);
    bed(b, st, 8, y + 5, 2);
    b.set(4, y + 7, 4, hanging());
    b.set(9, y + 5, 7, stateOf(`${st.wool.replace('_wool', '')}_carpet`));
    void rng;
  },
};

const storehouse: Design = {
  id: 'storehouse',
  sx: 9,
  sz: 7,
  height: 9,
  job: 'farmer',
  build(b, st, rng, seed) {
    const y = site(b, st, 9, 7, 9);
    floorOf(b, st, 0, 0, 8, 6, y);
    walls(b, st, 0, 0, 8, 6, y + 1, y + 4);
    // Wide double doors for carts
    b.fill(3, y + 1, 0, 5, y + 3, 0, 0);
    roof(b, st, 0, 8, 0, 6, y + 5);
    for (let x = 1; x <= 7; x++)
      for (let z = 4; z <= 5; z++) {
        const r = rng.next();
        b.set(x, y + 1, z, r < 0.35 ? S('barrel') : r < 0.6 ? stateOf('hay_bale', { axis: 'x' }) : r < 0.75 ? S('pumpkin') : 0);
        if (rng.chance(0.4)) b.set(x, y + 2, z, rng.chance(0.5) ? S('barrel') : stateOf('hay_bale', { axis: 'z' }));
      }
    b.chest(1, y + 1, 1, 'south', 'chest/village_storehouse', loot(b, 1, y + 1, 1, seed));
    b.chest(7, y + 1, 1, 'south', 'chest/village_storehouse', loot(b, 7, y + 1, 1, seed));
    b.set(4, y + 4, 3, hanging());
    b.set(1, y + 1, 3, S('composter'));
  },
};

const smithy: Design = {
  id: 'smithy',
  sx: 9,
  sz: 9,
  height: 8,
  job: 'toolsmith',
  build(b, st, rng, seed) {
    const y = site(b, st, 9, 9, 8);
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) b.set(x, y, z, S('cobblestone'));
    // An open-fronted forge under a roof on posts
    for (const [x, z] of [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ] as const)
      for (let yy = 1; yy <= 4; yy++) b.set(x, y + yy, z, logY(st));
    for (let x = 0; x < 9; x++) for (let yy = 1; yy <= 4; yy++) b.set(x, y + yy, 8, S('cobblestone'));
    for (let z = 1; z < 8; z++) for (let yy = 1; yy <= 4; yy++) b.set(8, y + yy, z, S('cobblestone'));
    b.fill(0, y + 5, 0, 8, y + 5, 8, stateOf(st.roofSlab, { type: 'bottom' }));
    b.fill(5, y, 5, 7, y, 7, S('cobblestone'));
    b.set(6, y, 6, S('lava'));
    b.set(6, y + 1, 7, S('iron_bars'));
    b.set(5, y + 1, 7, stateOf('blast_furnace', { facing: 'north' }));
    b.set(7, y + 1, 7, stateOf('furnace', { facing: 'north' }));
    b.set(2, y + 1, 7, S('anvil'));
    b.set(1, y + 1, 7, S('smithing_table'));
    b.set(1, y + 1, 4, S('barrel'));
    b.chest(1, y + 1, 5, 'east', 'chest/village_smithy', loot(b, 1, y + 1, 5, seed));
    b.set(3, y + 1, 1, S('stonecutter'));
    b.set(4, y + 4, 4, hanging());
    void rng;
  },
};

const workshop: Design = {
  id: 'workshop',
  sx: 9,
  sz: 7,
  height: 9,
  job: 'mason',
  beds: 1,
  build(b, st, rng, seed) {
    const y = site(b, st, 9, 7, 9);
    floorOf(b, st, 0, 0, 8, 6, y);
    walls(b, st, 0, 0, 8, 6, y + 1, y + 4);
    door(b, st, 2, y + 1, 0);
    windowAt(b, 5, y + 2, 0, true);
    windowAt(b, 6, y + 2, 0, true);
    windowAt(b, 8, y + 2, 3);
    roof(b, st, 0, 8, 0, 6, y + 5);
    // A carpenter's bench: logs, a crafting table, a stonecutter and a lathe
    b.set(1, y + 1, 5, S('crafting_table'));
    b.set(2, y + 1, 5, S('stonecutter'));
    b.set(3, y + 1, 5, stateOf(`${st.wood}_slab`, { type: 'top' }));
    b.set(4, y + 1, 5, stateOf(`${st.wood}_slab`, { type: 'top' }));
    for (let x = 5; x <= 7; x++) for (let yy = 1; yy <= 2; yy++) b.set(x, y + yy, 5, stateOf(st.log.endsWith('_log') ? st.log : 'oak_log', { axis: 'x' }));
    b.set(7, y + 1, 1, S('smoker'));
    bed(b, st, 1, y + 1, 1);
    b.chest(7, y + 1, 3, 'west', 'chest/village', loot(b, 7, y + 1, 3, seed));
    b.set(4, y + 4, 3, hanging());
    void rng;
  },
};

const chapel: Design = {
  id: 'chapel',
  sx: 7,
  sz: 11,
  height: 16,
  job: 'cleric',
  beds: 1,
  build(b, st, rng, seed) {
    const y = site(b, st, 7, 11, 16);
    const stone = st.flatRoof ? S('sandstone') : S('stone_bricks');
    for (let z = 0; z < 11; z++) for (let x = 0; x < 7; x++) b.set(x, y, z, stone);
    for (let yy = 1; yy <= 5; yy++)
      for (let z = 0; z < 11; z++)
        for (let x = 0; x < 7; x++) if (x === 0 || x === 6 || z === 0 || z === 10) b.set(x, y + yy, z, stone);
    door(b, st, 3, y + 1, 0);
    for (const z of [3, 6]) {
      windowAt(b, 0, y + 2, z, true);
      windowAt(b, 6, y + 2, z, true);
    }
    roof(b, st, 0, 6, 0, 10, y + 6);
    // A bell tower over the door
    for (let yy = 6; yy <= 9; yy++)
      for (const [x, z] of [
        [2, 0],
        [4, 0],
        [2, 2],
        [4, 2],
      ] as const)
        b.set(x, y + yy, z, stone);
    b.fill(2, y + 10, 0, 4, y + 10, 2, stone);
    b.set(3, y + 9, 1, stateOf('bell', { hanging: 'true' }));
    b.set(3, y + 11, 1, S(`${st.wood}_fence`));
    // Pews, an altar, a lectern-like stand of books
    for (let z = 3; z <= 7; z += 2) {
      b.set(1, y + 1, z, stateOf(`${st.wood}_stairs`, { facing: 'south' }));
      b.set(2, y + 1, z, stateOf(`${st.wood}_stairs`, { facing: 'south' }));
      b.set(4, y + 1, z, stateOf(`${st.wood}_stairs`, { facing: 'south' }));
      b.set(5, y + 1, z, stateOf(`${st.wood}_stairs`, { facing: 'south' }));
    }
    b.set(3, y + 1, 9, S('brewing_stand'));
    b.set(2, y + 1, 9, S('bookshelf'));
    b.set(4, y + 1, 9, S('bookshelf'));
    b.set(3, y + 4, 5, hanging());
    b.chest(1, y + 1, 9, 'east', 'chest/village', loot(b, 1, y + 1, 9, seed));
    void rng;
  },
};

/** A market stall: a counter under a striped canopy. */
const stall: Design = {
  id: 'stall',
  sx: 5,
  sz: 4,
  height: 5,
  job: 'none',
  build(b, st, rng) {
    b.clearAbove(0, 0, 4, 3, 1, 5);
    for (let z = 0; z < 4; z++) for (let x = 0; x < 5; x++) b.foundation(x, z, 0, S(st.path === 'dirt_path' ? st.foundation : st.path));
    for (const [x, z] of [
      [0, 0],
      [4, 0],
      [0, 3],
      [4, 3],
    ] as const)
      for (let yy = 1; yy <= 3; yy++) b.set(x, yy, z, S(`${st.wood}_fence`));
    for (let x = 0; x < 5; x++) for (let z = 0; z < 4; z++) b.set(x, 4, z, S((x + z) % 2 ? st.wool : 'white_wool'));
    for (let x = 1; x <= 3; x++) b.set(x, 1, 1, stateOf(`${st.wood}_slab`, { type: 'top' }));
    const goods = ['melon', 'pumpkin', 'hay_bale', 'barrel', 'cactus'];
    b.set(1, 2, 1, S(rng.pick(goods.slice(0, 4))));
    b.set(3, 2, 1, S('barrel'));
    b.set(2, 1, 2, S('barrel'));
  },
};

const farm: Design = {
  id: 'farm',
  sx: 11,
  sz: 9,
  height: 3,
  job: 'farmer',
  build(b, st, rng) {
    const crop = rng.pick(st.crop);
    const maxAge = crop === 'wheat' ? 7 : 3;
    b.clearAbove(0, 0, 10, 8, 1, 3);
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 11; x++) {
        b.foundation(x, z, -1, S('dirt'));
        const border = x === 0 || x === 10 || z === 0 || z === 8;
        if (border) {
          b.set(x, 0, z, stateOf(st.log.endsWith('_log') ? st.log : 'oak_log', { axis: x === 0 || x === 10 ? 'z' : 'x' }));
          continue;
        }
        if (x === 5 || (x === 3 && z === 4) || (x === 7 && z === 4)) {
          b.set(x, 0, z, S('water'));
          continue;
        }
        b.set(x, 0, z, stateOf('farmland', { moisture: 7 }));
        b.set(x, 1, z, stateOf(crop, { age: rng.int(maxAge + 1) }));
      }
    b.set(0, 1, 0, S('composter'));
    b.set(10, 1, 8, stateOf('hay_bale', { axis: 'y' }));
  },
};

const pen: Design = {
  id: 'pen',
  sx: 9,
  sz: 9,
  height: 3,
  animals: 4,
  build(b, st) {
    const fence = S(`${st.wood}_fence`);
    b.clearAbove(0, 0, 8, 8, 1, 3);
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) {
        const g = b.get(x, 0, z);
        if (!STATE_SOLID[g]) b.foundation(x, z, 0, S('dirt'));
        b.set(x, 0, z, S('grass_block'));
        const border = x === 0 || x === 8 || z === 0 || z === 8;
        if (border) b.set(x, 1, z, x === 4 && z === 0 ? stateOf(`${st.wood}_fence_gate`, { facing: 'north' }) : fence);
      }
    b.set(2, 1, 6, stateOf('hay_bale', { axis: 'y' }));
    b.set(6, 1, 6, stateOf('cauldron', { level: 3 }));
    b.set(7, 1, 7, stateOf('hay_bale', { axis: 'x' }));
  },
};

const watchtower: Design = {
  id: 'watchtower',
  sx: 5,
  sz: 5,
  height: 14,
  build(b, st) {
    b.clearAbove(0, 0, 4, 4, 1, 14);
    for (const [x, z] of [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
    ] as const) {
      b.foundation(x, z, 0, S(st.foundation), 12);
      for (let y = 1; y <= 9; y++) b.set(x, y, z, logY(st));
    }
    b.fill(0, 9, 0, 4, 9, 4, S(st.planks));
    for (let i = 0; i <= 4; i++) {
      b.set(i, 10, 0, S(`${st.wood}_fence`));
      b.set(i, 10, 4, S(`${st.wood}_fence`));
      b.set(0, 10, i, S(`${st.wood}_fence`));
      b.set(4, 10, i, S(`${st.wood}_fence`));
    }
    for (const [x, z] of [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
    ] as const)
      for (let y = 11; y <= 12; y++) b.set(x, y, z, logY(st));
    roof(b, st, 0, 4, 0, 4, 13);
    for (let y = 1; y <= 9; y++) b.set(2, y, 1, stateOf('ladder', { facing: 'north' }));
    b.set(2, 0, 2, S(st.planks));
    for (let y = 1; y <= 8; y++) b.set(2, y, 2, S(st.planks));
    b.set(2, 12, 2, hanging());
    b.set(3, 10, 3, stateOf('bell', { hanging: 'false' }));
  },
};

const HOUSES = [cottage, cottage, house, house, house, manor];

// ---------------------------------------------------------------------------
// Town centre
// ---------------------------------------------------------------------------
const PLAZA = 6; // half-size: the plaza spans 13 x 13

function buildPlaza(b: Builder, st: Style, rng: Random): void {
  const n = PLAZA * 2 + 1;
  b.clearAbove(0, 0, n - 1, n - 1, 1, 7);
  const paving = st.flatRoof ? ['smooth_sandstone', 'cut_sandstone', 'sandstone'] : st.id === 'swamp' ? ['mud_bricks', 'packed_mud', 'mud_bricks'] : ['stone_bricks', 'cobblestone', 'andesite'];
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      b.foundation(x, z, -1, S(st.foundation));
      b.set(x, 0, z, S(paving[(x * 7 + z * 13 + rng.int(3)) % 3]!));
    }
  // A well or a fountain at the heart
  const c = PLAZA;
  if (rng.chance(0.5) || st.flatRoof) {
    for (let x = c - 2; x <= c + 2; x++)
      for (let z = c - 2; z <= c + 2; z++) {
        const inner = Math.abs(x - c) <= 1 && Math.abs(z - c) <= 1;
        if (inner) for (let y = -4; y <= 0; y++) b.set(x, y, z, S('water'));
        else b.set(x, 1, z, S(st.foundation));
      }
    for (const [dx, dz] of [
      [-2, -2],
      [2, -2],
      [-2, 2],
      [2, 2],
    ] as const) {
      b.set(c + dx, 2, c + dz, S(`${st.wood}_fence`));
      b.set(c + dx, 3, c + dz, S(`${st.wood}_fence`));
    }
    b.fill(c - 2, 4, c - 2, c + 2, 4, c + 2, stateOf(st.roofSlab, { type: 'bottom' }));
    b.set(c, 3, c, hanging());
  } else {
    // Fountain: a basin, a column, water spilling from the top
    for (let x = c - 2; x <= c + 2; x++)
      for (let z = c - 2; z <= c + 2; z++) {
        const edge = Math.abs(x - c) === 2 || Math.abs(z - c) === 2;
        b.set(x, 1, z, edge ? S('stone_bricks') : S('water'));
      }
    for (let y = 1; y <= 3; y++) b.set(c, y, c, S('chiseled_stone_bricks'));
    b.set(c, 4, c, S('water'));
  }
  // The bell and benches facing the centre
  b.set(c + 4, 1, c + 4, stateOf('bell', { hanging: 'false' }));
  for (const [x, z, f] of [
    [c - 4, c - 1, 'east'],
    [c - 4, c + 1, 'east'],
    [c + 4, c - 1, 'west'],
    [c + 4, c + 1, 'west'],
  ] as const)
    b.set(x, 1, z, stateOf(`${st.wood}_stairs`, { facing: f }));
  // Flower beds in the corners
  const flowers = st.flatRoof ? ['desert_marigold', 'cactus'] : st.snowy ? ['frostbloom', 'fern'] : ['poppy', 'dandelion', 'cornflower', 'buttercup', 'azure_bluet'];
  for (const [x, z] of [
    [1, 1],
    [n - 2, 1],
    [1, n - 2],
    [n - 2, n - 2],
  ] as const) {
    b.set(x, 0, z, st.flatRoof ? S('sand') : S('grass_block'));
    b.set(x, 1, z, S(rng.pick(flowers)));
  }
  lampPost(b, st, 0, 0);
  lampPost(b, st, n - 1, 0);
  lampPost(b, st, 0, n - 1);
  lampPost(b, st, n - 1, n - 1);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
interface Plot {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function overlaps(a: Plot, list: Plot[], gap = 1): boolean {
  for (const b of list) if (a.x0 <= b.x1 + gap && a.x1 >= b.x0 - gap && a.z0 <= b.z1 + gap && a.z1 >= b.z0 - gap) return true;
  return false;
}

/** Median ground height over a plot, or null when it is wet or too steep to build on. */
function footprint(ctx: PlanContext, p: Plot, maxSlope = 5): number | null {
  const ys: number[] = [];
  for (const [x, z] of [
    [p.x0, p.z0],
    [p.x1, p.z0],
    [p.x0, p.z1],
    [p.x1, p.z1],
    [(p.x0 + p.x1) >> 1, (p.z0 + p.z1) >> 1],
  ] as const) {
    if (ctx.isWater(x, z)) return null;
    ys.push(ctx.groundY(x, z));
  }
  ys.sort((a, b) => a - b);
  if (ys[4]! - ys[0]! > maxSlope) return null;
  return ys[2]!;
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export const VILLAGE_V4: StructureType = {
  id: 'village',
  spacing: 28,
  separation: 8,
  salt: 0x71a94,
  radius: 6,
  candidate(ctx, x, z) {
    const b = ctx.estimateBiome(x, z);
    return !!styleFor(b.id, b.category);
  },
  plan(ctx, cx, cz, rng) {
    const x = (cx << 4) + 8;
    const z = (cz << 4) + 8;
    const biome = ctx.biome(x, z);
    const st = styleFor(biome.id, biome.category);
    if (!st) return null;
    const seed = ctx.seed;
    const plaza: Plot = { x0: x - PLAZA, z0: z - PLAZA, x1: x + PLAZA, z1: z + PLAZA };
    const py = footprint(ctx, plaza, 4);
    if (py === null || py < 62) return null;
    const pieces: Piece[] = [];
    const plots: Plot[] = [plaza];
    const roadCells = new Set<string>();
    const entities: NonNullable<Start['entities']> = [];
    pieces.push({ box: boxOf(plaza.x0 - 1, py - 6, plaza.z0 - 1, plaza.x1 + 1, py + 8, plaza.z1 + 1), build: (v) => buildPlaza(new Builder(v, plaza.x0, py, plaza.z0, 0, PLAZA * 2 + 1, PLAZA * 2 + 1), st, new Random(hashInts(seed, x, z, 0x91a2a))) });
    const used = new Map<string, number>();
    let homes = 0;
    let beds = 0;
    const place = (d: Design, rot: Rotation, px: number, pz: number, y?: number): boolean => {
      const wsx = rot & 1 ? d.sz : d.sx;
      const wsz = rot & 1 ? d.sx : d.sz;
      const plot = { x0: px, z0: pz, x1: px + wsx - 1, z1: pz + wsz - 1 };
      if (overlaps(plot, plots)) return false;
      for (let a = plot.x0; a <= plot.x1; a++) for (let c = plot.z0; c <= plot.z1; c++) if (roadCells.has(a + ',' + c)) return false;
      const gy = y ?? footprint(ctx, plot);
      if (gy === null) return false;
      plots.push(plot);
      used.set(d.id, (used.get(d.id) ?? 0) + 1);
      const bSeed = hashInts(seed, px, gy, pz, 0xb1d);
      const lift = st.stilts ?? 0;
      pieces.push({ box: boxOf(plot.x0 - 1, gy - 14, plot.z0 - 1, plot.x1 + 1, gy + d.height + lift + 1, plot.z1 + 1), build: (v) => d.build(new Builder(v, px, gy, pz, rot, d.sx, d.sz), st, new Random(bSeed), seed) });
      const mx = plot.x0 + wsx / 2;
      const mz = plot.z0 + wsz / 2;
      for (let i = 0; i < (d.beds ?? 0); i++) {
        beds++;
        entities.push({ type: 'villager', x: mx, y: gy + 1 + lift, z: mz, data: { profession: i === 0 && d.job ? d.job : rng.pick(['farmer', 'fisherman', 'shepherd', 'butcher', 'librarian', 'none']) } });
      }
      if (d.job && !d.beds) entities.push({ type: 'villager', x: mx, y: gy + 1 + lift, z: mz, data: { profession: d.job } });
      if (d.animals) {
        const kind = rng.pick(st.animals);
        for (let a = 0; a < d.animals; a++) entities.push({ type: kind, x: mx, y: gy + 1, z: mz });
      }
      if (d.beds) homes++;
      return true;
    };
    /** Places a design beside a road cell, facing it. */
    const beside = (d: Design, rx: number, rz: number, dx: number, dz: number, side: 1 | -1, setback = 2): boolean => {
      const alongX = dx !== 0;
      // Rotation that turns the design's north-facing door towards the road
      const rot: Rotation = alongX ? (side === 1 ? 0 : 2) : side === 1 ? 3 : 1;
      const wsx = rot & 1 ? d.sz : d.sx;
      const wsz = rot & 1 ? d.sx : d.sz;
      let px: number;
      let pz: number;
      if (alongX) {
        px = rx - (wsx >> 1);
        pz = side === 1 ? rz + setback : rz - setback - wsz + 1;
      } else {
        pz = rz - (wsz >> 1);
        px = side === 1 ? rx + setback : rx - setback - wsx + 1;
      }
      return place(d, rot, px, pz);
    };
    const pickNear = (dist: number, isEnd: boolean): Design => {
      if (isEnd) return watchtower;
      const count = (id: string): number => used.get(id) ?? 0;
      if (dist < 22) {
        const civic = [smithy, storehouse, workshop, chapel].filter((d) => count(d.id) === 0);
        if (civic.length && rng.chance(0.75)) return rng.pick(civic);
        return rng.pick(HOUSES);
      }
      if (dist < 40) return rng.chance(0.85) ? rng.pick(HOUSES) : rng.chance(0.5) ? pen : farm;
      return rng.chance(0.55) ? (rng.chance(0.6) ? farm : pen) : rng.pick(HOUSES);
    };
    // Roads: one step at a time, following the ground, stopping at water or cliffs
    const walk = (sx: number, sz: number, dx: number, dz: number, len: number, width: number): [number, number][] => {
      const cells: [number, number][] = [];
      let prev = ctx.groundY(sx, sz);
      let wet = 0;
      for (let i = 0; i < len; i++) {
        const rx = sx + dx * i;
        const rz = sz + dz * i;
        const g = ctx.groundY(rx, rz);
        if (ctx.isWater(rx, rz)) {
          if (++wet > 4) break;
        } else wet = 0;
        if (!ctx.isWater(rx, rz) && Math.abs(g - prev) > 2) break;
        if (overlaps({ x0: rx, z0: rz, x1: rx, z1: rz }, plots.slice(1), 0)) break;
        prev = ctx.isWater(rx, rz) ? prev : g;
        cells.push([rx, rz]);
        for (let w = -(width >> 1); w <= width >> 1; w++) roadCells.add(rx + (dz !== 0 ? w : 0) + ',' + (rz + (dx !== 0 ? w : 0)));
      }
      return cells;
    };
    const first = rng.int(4);
    const arms = 2 + rng.int(3);
    const lamps: [number, number][] = [];
    for (let a = 0; a < arms; a++) {
      const [dx, dz] = DIRS[(first + a + (a === 2 && arms === 3 ? rng.int(2) : 0)) % 4]!;
      const sx = x + dx * (PLAZA + 1);
      const sz = z + dz * (PLAZA + 1);
      const main = walk(sx, sz, dx, dz, 26 + rng.int(22), 3);
      if (main.length < 8) continue;
      main.forEach(([rx, rz], i) => {
        const dist = Math.hypot(rx - x, rz - z);
        if (i % 9 === 4) {
          // Buildings along both sides of the main road
          for (const side of [1, -1] as const) if (rng.chance(0.85)) beside(pickNear(dist, false), rx, rz, dx, dz, side);
        }
        if (i % 10 === 7) lamps.push([rx + dz * 2, rz + dx * 2]);
        // Side streets branch off now and then
        if (i % 12 === 9 && i < main.length - 4) {
          for (const side of [1, -1] as const) {
            if (!rng.chance(0.55)) continue;
            const [ex, ez] = [dz * side, dx * side];
            const street = walk(rx + ex * 2, rz + ez * 2, ex, ez, 10 + rng.int(12), 3);
            street.forEach(([qx, qz], k) => {
              if (k % 8 === 3) for (const s2 of [1, -1] as const) if (rng.chance(0.8)) beside(pickNear(Math.hypot(qx - x, qz - z) + 6, false), qx, qz, ex, ez, s2);
            });
          }
        }
      });
      // A watchtower where the road ends
      const [ex, ez] = main[main.length - 1]!;
      beside(watchtower, ex, ez, dx, dz, rng.chance(0.5) ? 1 : -1, 2);
    }
    // Market stalls around the plaza
    const stallSpots: [number, number, Rotation][] = [
      [x - PLAZA - 6, z - PLAZA - 5, 1],
      [x + PLAZA + 2, z - PLAZA - 5, 3],
      [x - PLAZA - 6, z + PLAZA + 2, 1],
      [x + PLAZA + 2, z + PLAZA + 2, 3],
    ];
    for (const [sx, sz, rot] of stallSpots) if (rng.chance(0.75)) place(stall, rot, sx, sz);
    if (homes < 3) return null;
    // The road piece: column-local path blocks that follow the ground, bridges over water
    const plotBlocked = (a: number, c: number): boolean => plots.some((p) => a >= p.x0 && a <= p.x1 && c >= p.z0 && c <= p.z1);
    const cols = [...roadCells].map((k) => k.split(',').map(Number) as [number, number]).filter(([a, c]) => !plotBlocked(a, c));
    if (cols.length) {
      const rb = unionBoxes(cols.map(([a, c]) => boxOf(a, 0, c, a, 255, c)));
      const path = S(st.path);
      const bridge = S(st.planks);
      pieces.push({
        box: rb,
        build: (v: DecorView) => {
          for (const [a, c] of cols) {
            if (!v.inside(a, c)) continue;
            const gy = ctx.groundY(a, c);
            const top = v.get(a, gy, c);
            if (STATE_FLUID[top] || gy < 62) {
              v.set(a, Math.max(63, gy + 1), c, bridge);
              continue;
            }
            // Gravel edges on wider roads look worn in
            const h = hashInts(seed, a, c, 0x9a7);
            v.set(a, gy, c, st.flatRoof ? S('sandstone') : (h & 7) === 0 ? S('gravel') : path);
            for (let k = 1; k <= 3; k++) {
              const s = v.get(a, gy + k, c);
              if (s !== 0 && !STATE_SOLID[s]) v.set(a, gy + k, c, 0);
            }
          }
        },
      });
    }
    for (const [lx, lz] of lamps) {
      const lp = { x0: lx, z0: lz, x1: lx, z1: lz };
      if (overlaps(lp, plots, 0) || roadCells.has(lx + ',' + lz) || ctx.isWater(lx, lz)) continue;
      const ly = ctx.groundY(lx, lz);
      plots.push(lp);
      pieces.push({ box: boxOf(lx, ly - 2, lz, lx, ly + 5, lz), build: (v) => lampPost(new Builder(v, lx, ly, lz, 0, 1, 1), st, 0, 0) });
    }
    entities.push({ type: 'iron_golem', x: x + 3, y: py + 1, z: z + 4 });
    if (st.id === 'plains' || st.id === 'cherry') entities.push({ type: 'cat', x: x - 3, y: py + 1, z: z - 3 });
    if (beds === 0) entities.push({ type: 'villager', x, y: py + 2, z: z - 3, data: { profession: 'none' } });
    return { type: 'village', x, y: py, z, pieces, bounds: unionBoxes(pieces.map((p) => p.box)), entities };
  },
};
