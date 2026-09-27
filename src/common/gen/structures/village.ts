/**
 * Villages: a well and bell at the centre, dirt roads branching out, and
 * houses, farms, a forge, a library, animal pens and lamp posts along the
 * roads. Materials follow the biome (plains, desert, savanna, taiga, snowy).
 * All building designs are original and authored facing north (door on the
 * z = 0 side); the Builder rotates them to face the road.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_SOLID, STATE_FLUID } from '../../registry/blocks';
import type { DecorView } from '../decorate/view';
import { Builder, type Rotation } from './builder';
import { boxOf, unionBoxes, type StructureType, type PlanContext, type Start, type Piece } from './manager';

interface Style {
  log: string;
  planks: string;
  stairs: string;
  slab: string;
  fence: string;
  door: string;
  foundation: string;
  wall: string;
  roof: string;
  roofSlab: string;
  path: string;
  accent: string;
  bed: string;
  flatRoof?: boolean;
  snowy?: boolean;
}

const STYLES: Record<string, Style> = {
  plains: { log: 'oak_log', planks: 'oak_planks', stairs: 'oak_stairs', slab: 'oak_slab', fence: 'oak_fence', door: 'oak_door', foundation: 'cobblestone', wall: 'oak_planks', roof: 'spruce_stairs', roofSlab: 'spruce_slab', path: 'dirt_path', accent: 'white_wool', bed: 'red_bed' },
  desert: { log: 'cut_sandstone', planks: 'smooth_sandstone', stairs: 'sandstone_stairs', slab: 'sandstone_slab', fence: 'jungle_fence', door: 'jungle_door', foundation: 'sandstone', wall: 'smooth_sandstone', roof: 'sandstone_stairs', roofSlab: 'sandstone_slab', path: 'dirt_path', accent: 'orange_terracotta', bed: 'green_bed', flatRoof: true },
  savanna: { log: 'acacia_log', planks: 'acacia_planks', stairs: 'acacia_stairs', slab: 'acacia_slab', fence: 'acacia_fence', door: 'acacia_door', foundation: 'cobblestone', wall: 'orange_terracotta', roof: 'acacia_stairs', roofSlab: 'acacia_slab', path: 'dirt_path', accent: 'yellow_terracotta', bed: 'yellow_bed' },
  taiga: { log: 'spruce_log', planks: 'spruce_planks', stairs: 'spruce_stairs', slab: 'spruce_slab', fence: 'spruce_fence', door: 'spruce_door', foundation: 'cobblestone', wall: 'spruce_planks', roof: 'spruce_stairs', roofSlab: 'spruce_slab', path: 'dirt_path', accent: 'mossy_cobblestone', bed: 'brown_bed' },
  snowy: { log: 'spruce_log', planks: 'spruce_planks', stairs: 'spruce_stairs', slab: 'spruce_slab', fence: 'spruce_fence', door: 'spruce_door', foundation: 'stone_bricks', wall: 'white_terracotta', roof: 'dark_oak_stairs', roofSlab: 'dark_oak_slab', path: 'dirt_path', accent: 'blue_ice', bed: 'light_blue_bed', snowy: true },
};

function styleFor(biomeId: string, category: string): Style | null {
  if (category === 'desert') return STYLES.desert!;
  if (category === 'savanna') return STYLES.savanna!;
  if (category === 'taiga') return STYLES.taiga!;
  if (biomeId === 'snowy_plains') return STYLES.snowy!;
  if (category === 'plains' || biomeId === 'meadow') return STYLES.plains!;
  return null;
}

type BuildFn = (b: Builder, st: Style, rng: Random, seed: number) => void;
interface Design {
  id: string;
  sx: number;
  sz: number;
  height: number;
  weight: number;
  build: BuildFn;
  beds?: number;
  max?: number;
}

// ---------------------------------------------------------------------------
// Building designs
// ---------------------------------------------------------------------------
function gableRoof(b: Builder, st: Style, x0: number, x1: number, z0: number, z1: number, y: number): void {
  if (st.flatRoof) {
    b.fill(x0, y, z0, x1, y, z1, S(st.planks));
    for (let x = x0; x <= x1; x++) {
      b.set(x, y + 1, z0, S(st.slab));
      b.set(x, y + 1, z1, S(st.slab));
    }
    for (let z = z0; z <= z1; z++) {
      b.set(x0, y + 1, z, S(st.slab));
      b.set(x1, y + 1, z, S(st.slab));
    }
    return;
  }
  // Ridge runs along X; slopes face north and south with a 1-block overhang
  const depth = z1 - z0 + 1;
  const layers = Math.ceil(depth / 2);
  for (let i = 0; i < layers; i++) {
    const zn = z0 - 1 + i;
    const zs = z1 + 1 - i;
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (zn < zs) {
        b.set(x, y + i, zn, stateOf(st.roof, { facing: 'south' }));
        b.set(x, y + i, zs, stateOf(st.roof, { facing: 'north' }));
      } else b.set(x, y + i, zn, stateOf(st.roofSlab, { type: 'bottom' }));
    }
    // Gable ends
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

function walls(b: Builder, st: Style, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const edgeX = x === x0 || x === x1;
        const edgeZ = z === z0 || z === z1;
        if (!edgeX && !edgeZ) continue;
        b.set(x, y, z, edgeX && edgeZ ? stateOf(st.log, st.log.endsWith('_log') ? { axis: 'y' } : undefined) : S(st.wall));
      }
}

function door(b: Builder, st: Style, x: number, y: number, z: number): void {
  b.set(x, y, z, stateOf(st.door, { facing: 'south', half: 'lower' }));
  b.set(x, y + 1, z, stateOf(st.door, { facing: 'south', half: 'upper' }));
  // Step outside the door
  b.set(x, y - 1, z - 1, S(st.foundation));
}

function bed(b: Builder, st: Style, x: number, y: number, z: number): void {
  b.set(x, y, z, stateOf(st.bed, { facing: 'south', part: 'foot' }));
  b.set(x, y, z + 1, stateOf(st.bed, { facing: 'south', part: 'head' }));
}

function floor(b: Builder, st: Style, x0: number, z0: number, x1: number, z1: number): void {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      b.foundation(x, z, -1, S(st.foundation));
      b.set(x, 0, z, S(st.foundation === 'cobblestone' ? st.planks : st.foundation));
    }
}

const smallHouse: Design = {
  id: 'small_house',
  sx: 7,
  sz: 7,
  height: 9,
  weight: 6,
  beds: 1,
  build(b, st, rng) {
    b.clearAbove(-1, -1, 7, 7, 1, 8);
    floor(b, st, 0, 0, 6, 6);
    walls(b, st, 0, 0, 6, 6, 1, 3);
    door(b, st, 3, 1, 0);
    for (const [x, z] of [
      [0, 3],
      [6, 3],
      [3, 6],
    ] as const)
      b.set(x, 2, z, S('glass_pane'));
    gableRoof(b, st, 0, 6, 0, 6, 4);
    bed(b, st, 1, 1, 4);
    b.set(5, 1, 5, rng.chance(0.5) ? S('crafting_table') : S('barrel'));
    b.set(5, 1, 1, S('flower_pot'));
    b.set(3, 3, 5, stateOf('wall_torch', { facing: 'north' }));
  },
};

const bigHouse: Design = {
  id: 'big_house',
  sx: 9,
  sz: 11,
  height: 11,
  weight: 3,
  beds: 2,
  build(b, st, rng, seed) {
    b.clearAbove(-1, -1, 9, 11, 1, 10);
    floor(b, st, 0, 0, 8, 10);
    walls(b, st, 0, 0, 8, 10, 1, 4);
    // Interior dividing wall with opening
    for (let x = 1; x < 8; x++) for (let y = 1; y <= 3; y++) if (x !== 4 || y > 2) b.set(x, y, 5, S(st.planks));
    door(b, st, 4, 1, 0);
    for (const [x, z] of [
      [0, 2],
      [0, 8],
      [8, 2],
      [8, 8],
      [2, 10],
      [6, 10],
    ] as const) {
      b.set(x, 2, z, S('glass_pane'));
      b.set(x, 3, z, S('glass_pane'));
    }
    gableRoof(b, st, 0, 8, 0, 10, 5);
    bed(b, st, 1, 1, 7);
    bed(b, st, 7, 1, 7);
    b.set(1, 1, 1, stateOf('furnace', { facing: 'south' }));
    b.set(2, 1, 1, S('crafting_table'));
    b.chest(7, 1, 1, 'south', 'chest/village', hashInts(seed, b.wx(7, 1), b.oy + 1, b.wz(7, 1)));
    b.set(4, 3, 9, stateOf('wall_torch', { facing: 'north' }));
    b.set(4, 3, 4, stateOf('wall_torch', { facing: 'north' }));
    if (rng.chance(0.5)) b.set(7, 1, 4, S('bookshelf'));
  },
};

const farm: Design = {
  id: 'farm',
  sx: 9,
  sz: 9,
  height: 3,
  weight: 4,
  build(b, st, rng) {
    const crops = ['wheat', 'wheat', 'carrots', 'potatoes', 'beetroots', 'sunroot'];
    const crop = crops[rng.int(crops.length)]!;
    const maxAge = crop === 'beetroots' || crop === 'sunroot' ? 3 : 7;
    b.clearAbove(0, 0, 8, 8, 1, 3);
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) {
        b.foundation(x, z, -1, S('dirt'));
        const border = x === 0 || x === 8 || z === 0 || z === 8;
        if (border) {
          b.set(x, 0, z, stateOf(st.log.endsWith('_log') ? st.log : 'oak_log', { axis: x === 0 || x === 8 ? 'z' : 'x' }));
          continue;
        }
        if (x === 4) {
          b.set(x, 0, z, S('water'));
          continue;
        }
        b.set(x, 0, z, stateOf('farmland', { moisture: 7 }));
        b.set(x, 1, z, stateOf(crop, { age: rng.int(maxAge + 1) }));
      }
    b.set(0, 1, 0, S('composter'));
  },
};

const forge: Design = {
  id: 'forge',
  sx: 9,
  sz: 7,
  height: 7,
  weight: 2,
  max: 1,
  build(b, st, rng, seed) {
    b.clearAbove(-1, -1, 9, 7, 1, 6);
    for (let z = 0; z < 7; z++)
      for (let x = 0; x < 9; x++) {
        b.foundation(x, z, -1, S('cobblestone'));
        b.set(x, 0, z, S('cobblestone'));
      }
    // Open-front workshop: pillars and a roof
    for (const [x, z] of [
      [0, 0],
      [8, 0],
      [0, 6],
      [8, 6],
    ] as const)
      for (let y = 1; y <= 3; y++) b.set(x, y, z, stateOf(st.log.endsWith('_log') ? st.log : 'oak_log', { axis: 'y' }));
    for (let x = 0; x < 9; x++) for (let y = 1; y <= 3; y++) b.set(x, y, 6, S('cobblestone'));
    for (let z = 1; z < 6; z++) for (let y = 1; y <= 3; y++) b.set(8, y, z, S('cobblestone'));
    b.fill(0, 4, 0, 8, 4, 6, S(st.slab));
    // Lava forge
    b.fill(5, 0, 3, 7, 0, 5, S('cobblestone'));
    b.set(6, 0, 4, S('lava'));
    b.set(6, 1, 5, S('iron_bars'));
    b.set(5, 1, 5, stateOf('furnace', { facing: 'north' }));
    b.set(7, 1, 5, stateOf('furnace', { facing: 'north' }));
    b.set(2, 1, 5, S('anvil'));
    b.set(1, 1, 5, S('smithing_table'));
    b.chest(1, 1, 3, 'east', 'chest/village', hashInts(seed, b.wx(1, 3), b.oy + 1, b.wz(1, 3)));
    b.set(3, 1, 1, S('stonecutter'));
    void rng;
  },
};

const library: Design = {
  id: 'library',
  sx: 9,
  sz: 9,
  height: 10,
  weight: 1,
  max: 1,
  build(b, st, rng, seed) {
    b.clearAbove(-1, -1, 9, 9, 1, 9);
    floor(b, st, 0, 0, 8, 8);
    walls(b, st, 0, 0, 8, 8, 1, 4);
    door(b, st, 4, 1, 0);
    for (let x = 1; x < 8; x++)
      for (let y = 1; y <= 3; y++) {
        if (x === 4 && y < 3) continue;
        b.set(x, y, 7, S('bookshelf'));
      }
    for (let z = 2; z < 7; z += 2) {
      b.set(1, 1, z, S('bookshelf'));
      b.set(7, 1, z, S('bookshelf'));
    }
    b.set(0, 2, 4, S('glass_pane'));
    b.set(8, 2, 4, S('glass_pane'));
    b.set(4, 1, 4, S('enchanting_table'));
    b.chest(6, 1, 1, 'south', 'chest/village', hashInts(seed, b.wx(6, 1), b.oy + 1, b.wz(6, 1)));
    b.set(4, 3, 6, stateOf('wall_torch', { facing: 'north' }));
    gableRoof(b, st, 0, 8, 0, 8, 5);
    void rng;
  },
};

const pen: Design = {
  id: 'pen',
  sx: 9,
  sz: 9,
  height: 3,
  weight: 2,
  build(b, st) {
    b.clearAbove(0, 0, 8, 8, 1, 3);
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) {
        const g = b.get(x, 0, z);
        if (!STATE_SOLID[g]) b.foundation(x, z, 0, S('dirt'));
        const s = b.get(x, 0, z);
        if (s !== S('grass_block')) b.set(x, 0, z, S('grass_block'));
        const border = x === 0 || x === 8 || z === 0 || z === 8;
        if (border) b.set(x, 1, z, x === 4 && z === 0 ? stateOf(st.fence.replace('_fence', '_fence_gate'), { facing: 'north' }) : S(st.fence));
      }
    b.set(2, 1, 6, stateOf('hay_bale', { axis: 'y' }));
    b.set(6, 1, 6, S('cauldron'));
  },
};

const lamp: Design = {
  id: 'lamp',
  sx: 1,
  sz: 1,
  height: 5,
  weight: 3,
  build(b, st) {
    b.foundation(0, 0, 0, S(st.foundation));
    b.set(0, 1, 0, S(st.fence));
    b.set(0, 2, 0, S(st.fence));
    b.set(0, 3, 0, stateOf(st.log.endsWith('_log') ? st.log : 'oak_log', { axis: 'y' }));
    b.set(0, 4, 0, S('lantern'));
  },
};

const DESIGNS: Design[] = [smallHouse, bigHouse, farm, forge, library, pen];

// ---------------------------------------------------------------------------
// Centre: well + bell
// ---------------------------------------------------------------------------
function buildWell(b: Builder, st: Style): void {
  b.clearAbove(-1, -1, 6, 6, 1, 6);
  for (let z = 0; z < 6; z++)
    for (let x = 0; x < 6; x++) {
      b.foundation(x, z, -1, S(st.foundation));
      b.set(x, 0, z, S(st.foundation));
    }
  for (let z = 1; z < 5; z++)
    for (let x = 1; x < 5; x++) {
      const inner = x >= 2 && x <= 3 && z >= 2 && z <= 3;
      if (inner) {
        for (let y = -4; y <= 0; y++) b.set(x, y, z, S('water'));
      } else b.set(x, 1, z, S(st.foundation));
    }
  for (const [x, z] of [
    [1, 1],
    [4, 1],
    [1, 4],
    [4, 4],
  ] as const) {
    b.set(x, 2, z, S(st.fence));
    b.set(x, 3, z, S(st.fence));
  }
  b.fill(1, 4, 1, 4, 4, 4, S(st.slab));
  b.set(0, 1, 5, stateOf('bell', { hanging: false }));
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

function overlaps(a: Plot, list: Plot[]): boolean {
  for (const b of list) if (a.x0 <= b.x1 + 1 && a.x1 >= b.x0 - 1 && a.z0 <= b.z1 + 1 && a.z1 >= b.z0 - 1) return true;
  return false;
}

function footprintOk(ctx: PlanContext, p: Plot): number | null {
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
  if (ys[4]! - ys[0]! > 5) return null;
  return ys[2]!;
}

export const VILLAGE: StructureType = {
  id: 'village',
  spacing: 34,
  separation: 8,
  salt: 0x71a9e,
  radius: 5,
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
    const centerY = ctx.groundY(x, z);
    if (ctx.isWater(x, z) || centerY < 62) return null;
    const pieces: Piece[] = [];
    const plots: Plot[] = [];
    const entities: Start['entities'] = [];
    const seed = ctx.seed;
    // Well
    const wellPlot = { x0: x - 3, z0: z - 3, x1: x + 2, z1: z + 2 };
    plots.push(wellPlot);
    const wy = footprintOk(ctx, wellPlot) ?? centerY;
    pieces.push({
      box: boxOf(wellPlot.x0 - 1, wy - 6, wellPlot.z0 - 1, wellPlot.x1 + 1, wy + 7, wellPlot.z1 + 1),
      build: (v) => buildWell(new Builder(v, wellPlot.x0, wy, wellPlot.z0, 0, 6, 6), st),
    });
    // Roads
    const roadCols: [number, number][] = [];
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const used = new Map<string, number>();
    let houses = 0;
    let beds = 0;
    for (const [dx, dz] of dirs) {
      if (rng.chance(0.15)) continue;
      const len = 18 + rng.int(26);
      const sx = x + dx * 4;
      const sz = z + dz * 4;
      for (let i = 0; i < len; i++) {
        const rx = sx + dx * i;
        const rz = sz + dz * i;
        if (ctx.isWater(rx, rz) && i > 2) break;
        for (let w = -1; w <= 1; w++) roadCols.push([rx + (dz !== 0 ? w : 0), rz + (dx !== 0 ? w : 0)]);
        // Buildings along the road every ~9 blocks, alternating sides
        if (i > 3 && i % 8 === 4) {
          for (const side of [1, -1]) {
            if (rng.chance(0.12)) continue;
            const d = pick(rng, used);
            const along = dx !== 0; // road runs along X
            // Footprint in world space depends on rotation
            const rot: Rotation = along ? (side === 1 ? 0 : 2) : side === 1 ? 3 : 1;
            const wsx = rot & 1 ? d.sz : d.sx;
            const wsz = rot & 1 ? d.sx : d.sz;
            let px: number;
            let pz: number;
            if (along) {
              px = rx - (wsx >> 1);
              pz = side === 1 ? rz + 3 : rz - 2 - wsz;
            } else {
              pz = rz - (wsz >> 1);
              px = side === 1 ? rx + 3 : rx - 2 - wsx;
            }
            const plot = { x0: px, z0: pz, x1: px + wsx - 1, z1: pz + wsz - 1 };
            if (overlaps(plot, plots)) continue;
            const py = footprintOk(ctx, plot);
            if (py === null) continue;
            plots.push(plot);
            used.set(d.id, (used.get(d.id) ?? 0) + 1);
            houses++;
            const bSeed = hashInts(seed, px, py, pz);
            pieces.push({
              box: boxOf(plot.x0 - 1, py - 8, plot.z0 - 1, plot.x1 + 1, py + d.height, plot.z1 + 1),
              build: (v) => d.build(new Builder(v, px, py, pz, rot, d.sx, d.sz), st, new Random(bSeed), seed),
            });
            for (let bi = 0; bi < (d.beds ?? 0); bi++) {
              beds++;
              entities.push({ type: 'villager', x: plot.x0 + wsx / 2, y: py + 1, z: plot.z0 + wsz / 2, data: { profession: villagerJob(d.id, rng) } });
            }
            if (d.id === 'pen') {
              const animal = ['cow', 'sheep', 'pig', 'chicken'][rng.int(4)]!;
              for (let a = 0; a < 3; a++) entities.push({ type: animal, x: plot.x0 + wsx / 2, y: py + 1, z: plot.z0 + wsz / 2 });
            }
          }
        }
        // Lamp posts
        if (i % 12 === 6) {
          const lx = rx + (dz !== 0 ? 2 : 0);
          const lz = rz + (dx !== 0 ? 2 : 0);
          const lp = { x0: lx, z0: lz, x1: lx, z1: lz };
          if (!overlaps(lp, plots) && !ctx.isWater(lx, lz)) {
            const ly = ctx.groundY(lx, lz);
            plots.push(lp);
            pieces.push({ box: boxOf(lx, ly - 4, lz, lx, ly + 5, lz), build: (v) => lamp.build(new Builder(v, lx, ly, lz, 0, 1, 1), st, rng, seed) });
          }
        }
      }
    }
    if (houses < 3) return null;
    // Road piece: column-local path blocks (bridges over water)
    const roadSet = new Set(roadCols.map(([a, b]) => a + ',' + b));
    const plotBlocked = (a: number, c: number): boolean => plots.some((p) => a >= p.x0 && a <= p.x1 && c >= p.z0 && c <= p.z1);
    const cols = [...roadSet].map((k) => k.split(',').map(Number) as [number, number]).filter(([a, c]) => !plotBlocked(a, c));
    const rb = unionBoxes(cols.map(([a, c]) => boxOf(a, 0, c, a, 255, c)));
    pieces.push({
      box: rb,
      build: (v: DecorView) => {
        for (const [a, c] of cols) {
          if (!v.inside(a, c)) continue;
          const gy = ctx.groundY(a, c);
          const top = v.get(a, gy, c);
          if (STATE_FLUID[top] || gy < 62) {
            v.set(a, 63, c, S(st.planks));
            continue;
          }
          v.set(a, gy, c, S(st.path));
          for (let k = 1; k <= 3; k++) {
            const s = v.get(a, gy + k, c);
            if (s !== 0 && !STATE_SOLID[s]) v.set(a, gy + k, c, 0);
          }
        }
      },
    });
    entities.push({ type: 'iron_golem', x: x + 4, y: centerY + 1, z: z + 4 });
    if (beds === 0) entities.push({ type: 'villager', x, y: centerY + 2, z, data: { profession: 'none' } });
    return { type: 'village', x, y: centerY, z, pieces, bounds: unionBoxes(pieces.map((p) => p.box)), entities };
  },
};

function pick(rng: Random, used: Map<string, number>): Design {
  for (let tries = 0; tries < 10; tries++) {
    let total = 0;
    for (const d of DESIGNS) total += d.weight;
    let r = rng.next() * total;
    for (const d of DESIGNS) {
      r -= d.weight;
      if (r <= 0) {
        if (d.max && (used.get(d.id) ?? 0) >= d.max) break;
        return d;
      }
    }
  }
  return smallHouse;
}

function villagerJob(design: string, rng: Random): string {
  if (design === 'library') return 'librarian';
  if (design === 'forge') return 'toolsmith';
  if (design === 'farm') return 'farmer';
  return ['farmer', 'fisherman', 'shepherd', 'cleric', 'butcher', 'mason', 'none'][rng.int(7)]!;
}
