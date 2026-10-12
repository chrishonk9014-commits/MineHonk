/**
 * V4 surface and cave decoration (worlds made with generator version 4).
 *
 *  - cacti: natural desert cacti of varied heights, branching saguaros,
 *    clusters and flowering stubs, placed only on level sand;
 *  - groundFeatures: mossy boulders, fallen logs overgrown with bracket fungus
 *    and moss, old stumps, and savanna termite mounds;
 *  - plantColumn: each biome's own plants (hooked into the shared vegetation
 *    pass);
 *  - afterVegetation: hanging moss under jungle and swamp canopies, peat beds
 *    in swamps;
 *  - volcanic: lava that would touch water cools into a magma crust, and cave
 *    lava is lined with magma and basalt.
 *
 * Like every decoration stage, decisions read only pure terrain (`proto`) so
 * results do not depend on the order chunks are generated in.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_FLUID, STATE_SOLID, STATE_OPAQUE, STATE_BLOCK, blocks } from '../../registry/blocks';
import { biomeOf, type Biome } from '../../registry/biomes';
import { SEA_LEVEL } from '../../world/constants';
import type { DecorView } from '../decorate/view';
import { groundY } from '../decorate/features';

let B: ReturnType<typeof makeStates> | undefined;
function makeStates() {
  return {
    sand: S('sand'),
    redSand: S('red_sand'),
    grass: S('grass_block'),
    dirt: S('dirt'),
    mud: S('mud'),
    podzol: S('podzol'),
    coarse: S('coarse_dirt'),
    gravel: S('gravel'),
    terracotta: S('terracotta'),
    water: S('water'),
    lava: S('lava'),
    caveAir: S('cave_air'),
    cactus: S('cactus'),
    cactusFlower: S('cactus_flower'),
    deadBush: S('dead_bush'),
    marigold: S('desert_marigold'),
    scrub: S('desert_scrub'),
    aloe: S('aloe_vera'),
    leafLitter: S('leaf_litter'),
    shadowcap: S('shadowcap'),
    frostbloom: S('frostbloom'),
    snowberry: S('snowberry_bush'),
    edelweiss: S('edelweiss'),
    orchid: S('jungle_orchid'),
    hangingMoss: S('hanging_moss'),
    cattailLo: stateOf('cattail', { half: 'lower' }),
    cattailHi: stateOf('cattail', { half: 'upper' }),
    glowcap: S('marsh_glowcap'),
    peat: S('peat'),
    clover: S('clover'),
    buttercup: S('buttercup'),
    lingonberry: S('lingonberry_bush'),
    termite: S('termite_mound'),
    beachGrass: S('beach_grass'),
    seashell: S('seashell'),
    petals: S('cherry_petals'),
    mossCarpet: S('moss_carpet'),
    mossyCobble: S('mossy_cobblestone'),
    brownMushroom: S('brown_mushroom'),
    redMushroom: S('red_mushroom'),
    magma: S('magma_block'),
    basalt: S('basalt'),
    fungus: (['north', 'south', 'west', 'east'] as const).map((f) => stateOf('bracket_fungus', { facing: f })),
  };
}
function st(): ReturnType<typeof makeStates> {
  return (B ??= makeStates());
}

const SIDES: [number, number, string][] = [
  [0, -1, 'north'],
  [0, 1, 'south'],
  [-1, 0, 'west'],
  [1, 0, 'east'],
];

function isAirish(s: number): boolean {
  return s === 0 || s === st().caveAir;
}

function isLeaves(s: number): boolean {
  return blocks[STATE_BLOCK[s]!]!.tags.has('leaves');
}

/** Whether the ground at (x, z) is level with `y` (within one block) on all four sides. */
function level(v: DecorView, x: number, y: number, z: number): boolean {
  for (const [dx, dz] of SIDES) if (Math.abs(groundY(v, x + dx, z + dz) - y) > 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cacti
// ---------------------------------------------------------------------------
/** Cactus plants of varied shapes in deserts and badlands. */
export function cacti(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const biome = biomeOf(v.biome((ocx << 4) + 8, (ocz << 4) + 8));
  const desert = biome.category === 'desert';
  const mesa = biome.category === 'mesa';
  if (!desert && !mesa) return;
  const rng = new Random(hashInts(seed, ocx, ocz, 0xcac7));
  const b = st();
  // Deserts have loose stands of cacti with open ground between; badlands fewer
  const attempts = desert ? 2 + rng.int(4) : rng.int(3);
  for (let i = 0; i < attempts; i++) {
    const x = (ocx << 4) + 1 + rng.int(14);
    const z = (ocz << 4) + 1 + rng.int(14);
    const shape = rng.next();
    const r2 = rng.next();
    const r3 = rng.next();
    // The largest cactus reaches three blocks out from its root
    if (x + 3 < v.bx || x - 3 >= v.bx + 16 || z + 3 < v.bz || z - 3 >= v.bz + 16) continue;
    const y = groundY(v, x, z);
    if (y < SEA_LEVEL) continue;
    const ground = v.proto(x, y, z);
    if (ground !== b.sand && ground !== b.redSand) continue;
    if (!level(v, x, y, z)) continue;
    // Never at the water's edge
    let wet = false;
    for (let dx = -2; dx <= 2 && !wet; dx++) for (let dz = -2; dz <= 2 && !wet; dz++) if (STATE_FLUID[v.proto(x + dx, y + 1, z + dz)] || STATE_FLUID[v.proto(x + dx, y, z + dz)]) wet = true;
    if (wet) continue;
    const cells: [number, number, number, number][] = [];
    const column = (cx: number, cz: number, base: number, h: number): void => {
      for (let k = 0; k < h; k++) cells.push([cx, base + k, cz, b.cactus]);
    };
    if (shape < 0.42) {
      // A plain column: mostly two or three tall, sometimes one or four or five
      const h = r2 < 0.12 ? 1 : r2 < 0.45 ? 2 : r2 < 0.8 ? 3 : r2 < 0.95 ? 4 : 5;
      column(x, z, y + 1, h);
      if (r3 < 0.3) cells.push([x, y + 1 + h, z, b.cactusFlower]);
    } else if (shape < 0.66 && desert) {
      // Saguaro: a tall trunk with one or two arms that turn upwards
      const h = 4 + Math.floor(r2 * 3);
      column(x, z, y + 1, h);
      const arms = r3 < 0.55 ? 2 : 1;
      const first = rng.int(4);
      for (let a = 0; a < arms; a++) {
        const [dx, dz] = SIDES[(first + a * 2) % 4]!;
        const at = y + 2 + rng.int(Math.max(1, h - 3));
        const up = 1 + rng.int(Math.min(3, y + h - at));
        cells.push([x + dx, at, z + dz, b.cactus]);
        column(x + dx, z + dz, at + 1, up);
        if (rng.chance(0.35)) cells.push([x + dx, at + 1 + up, z + dz, b.cactusFlower]);
      }
      if (rng.chance(0.4)) cells.push([x, y + 1 + h, z, b.cactusFlower]);
    } else if (shape < 0.88) {
      // A cluster: two to four short columns a step apart
      const n = 2 + rng.int(3);
      const spots: [number, number][] = [
        [0, 0],
        [2, 0],
        [0, 2],
        [-2, 1],
        [1, -2],
      ];
      for (let k = 0; k < n; k++) {
        const [dx, dz] = spots[k]!;
        const gy = groundY(v, x + dx, z + dz);
        const g = v.proto(x + dx, gy, z + dz);
        if (gy !== y || (g !== b.sand && g !== b.redSand)) continue;
        const h = 1 + rng.int(k === 0 ? 3 : 2);
        column(x + dx, z + dz, y + 1, h);
        if (rng.chance(0.25)) cells.push([x + dx, y + 1 + h, z + dz, b.cactusFlower]);
      }
    } else {
      // A squat flowering stub
      column(x, z, y + 1, 1);
      cells.push([x, y + 2, z, b.cactusFlower]);
    }
    // Everything the plant needs must be open air in the terrain (and nothing solid beside its trunk)
    let ok = true;
    for (const [cx, cy, cz] of cells) if (!isAirish(v.proto(cx, cy, cz))) ok = false;
    if (!ok) continue;
    for (const [cx, cy, cz, s] of cells) if (v.inside(cx, cz) && isAirish(v.get(cx, cy, cz))) v.set(cx, cy, cz, s);
  }
}

// ---------------------------------------------------------------------------
// Boulders, fallen logs, stumps and termite mounds
// ---------------------------------------------------------------------------
function woodFor(biome: Biome): string | null {
  switch (biome.category) {
    case 'taiga':
      return 'spruce';
    case 'jungle':
      return 'jungle';
    case 'forest':
      if (biome.id === 'dark_forest') return 'dark_oak';
      if (biome.id.includes('birch')) return 'birch';
      return 'oak';
    case 'swamp':
      return biome.id === 'mangrove_swamp' ? null : 'oak';
    default:
      return null;
  }
}

export function groundFeatures(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const rng = new Random(hashInts(seed, ocx, ocz, 0x6f04));
  const b = st();
  const biome = biomeOf(v.biome((ocx << 4) + 8, (ocz << 4) + 8));
  // Mossy boulders in taigas (as before V4)
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
  const wood = woodFor(biome);
  if (wood && rng.chance(biome.category === 'forest' ? 0.3 : 0.18)) {
    const x = (ocx << 4) + 2 + rng.int(12);
    const z = (ocz << 4) + 2 + rng.int(12);
    const y = groundY(v, x, z);
    const ground = v.proto(x, y, z);
    if (y >= SEA_LEVEL && (ground === b.grass || ground === b.dirt || ground === b.podzol || ground === b.coarse) && !STATE_FLUID[v.proto(x, y + 1, z)]) {
      if (rng.chance(0.3)) {
        // An old stump, one or two logs tall, with fungus shelves
        const h = 1 + rng.int(2);
        for (let k = 1; k <= h; k++) v.set(x, y + k, z, stateOf(wood + '_log', { axis: 'y' }));
        for (let s = 0; s < 4; s++) {
          const [dx, dz] = SIDES[s]!;
          if (rng.chance(0.45) && isAirish(v.proto(x + dx, y + h, z + dz))) v.set(x + dx, y + h, z + dz, b.fungus[s]!);
        }
        if (rng.chance(0.5)) v.set(x, y + h + 1, z, b.mossCarpet);
      } else {
        // A fallen trunk lying along the ground, going soft with moss and fungus
        const alongX = rng.chance(0.5);
        const len = 4 + rng.int(4);
        for (let k = 0; k < len; k++) {
          const px = x + (alongX ? k : 0);
          const pz = z + (alongX ? 0 : k);
          if (groundY(v, px, pz) !== y || !isAirish(v.proto(px, y + 1, pz))) break;
          v.set(px, y + 1, pz, stateOf(wood + '_log', { axis: alongX ? 'x' : 'z' }));
          const top = rng.next();
          if (top < 0.35) v.set(px, y + 2, pz, b.mossCarpet);
          else if (top < 0.45) v.set(px, y + 2, pz, rng.chance(0.5) ? b.brownMushroom : b.redMushroom);
          // Shelves on the log's sides
          for (let s = 0; s < 4; s++) {
            const [dx, dz] = SIDES[s]!;
            if ((alongX && dx !== 0) || (!alongX && dz !== 0)) continue;
            if (rng.chance(0.22) && isAirish(v.proto(px + dx, y + 1, pz + dz)) && STATE_SOLID[v.proto(px + dx, y, pz + dz)]) v.set(px + dx, y + 1, pz + dz, b.fungus[s]!);
          }
        }
      }
    }
  }
  // Termite mounds rise out of savanna grass
  if (biome.category === 'savanna' && rng.chance(0.14)) {
    const x = (ocx << 4) + 2 + rng.int(12);
    const z = (ocz << 4) + 2 + rng.int(12);
    const y = groundY(v, x, z);
    if (y >= SEA_LEVEL && level(v, x, y, z) && !STATE_FLUID[v.proto(x, y + 1, z)]) {
      const h = 3 + rng.int(4);
      for (let k = 0; k < h; k++) {
        const rad = k === 0 ? 1 : k < h / 3 ? 1 : 0;
        for (let dx = -rad; dx <= rad; dx++)
          for (let dz = -rad; dz <= rad; dz++) {
            if (rad && Math.abs(dx) + Math.abs(dz) === 2 && k > 0) continue;
            v.set(x + dx, y + 1 + k, z + dz, b.termite);
          }
      }
      // A second, smaller spire leaning beside it
      if (rng.chance(0.5)) {
        const [dx, dz] = SIDES[rng.int(4)]!;
        for (let k = 0; k < h - 2; k++) v.set(x + dx * 2, y + 1 + k, z + dz * 2, b.termite);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Biome plants (called for every surface column by the vegetation pass)
// ---------------------------------------------------------------------------
/**
 * Places this biome's own plant on a surface column, if any. Returns true
 * when the column is done (the shared pass then skips it).
 */
export function plantColumn(v: DecorView, seed: number, x: number, y: number, z: number, top: number, biome: Biome, r: number, r2: number): boolean {
  const b = st();
  // Patches: coarse cells decide where a plant grows thickly
  const patch = (salt: number, size = 3): number => (hashInts(seed, x >> size, z >> size, salt) >>> 0) % 100;
  const put = (s: number): boolean => {
    v.set(x, y + 1, z, s);
    return true;
  };
  const cat = biome.category;
  const id = biome.id;
  const sandy = top === b.sand || top === b.redSand;
  if (cat === 'desert') {
    if (!sandy) return false;
    if (r < 0.005) return put(b.deadBush);
    if (r < 0.011) return put(b.scrub);
    if (patch(0xd01) < 14 && r < 0.05) return put(b.marigold);
    return false;
  }
  if (cat === 'mesa') {
    if (!sandy && top !== b.terracotta && top !== b.coarse) return false;
    if (r < 0.008) return put(b.scrub);
    if (sandy && r < 0.011) return put(b.aloe);
    return false;
  }
  if (cat === 'savanna') {
    if (r < 0.003) return put(b.aloe);
    if (r < 0.006) return put(b.scrub);
    return false;
  }
  if (cat === 'beach') {
    if (id === 'beach' && sandy) {
      if (r < 0.02) return put(b.seashell);
      if (patch(0xbea) < 30 && r < 0.18) return put(b.beachGrass);
    }
    if (id === 'stony_shore' && r < 0.006) return put(b.seashell);
    return false;
  }
  if (top === b.grass || top === b.podzol || top === b.mud || top === b.coarse || top === b.dirt) {
    switch (cat) {
      case 'plains':
        if (patch(0xc10) < 22 && r < 0.3) return put(b.clover);
        if (r < 0.004) return put(b.buttercup);
        return false;
      case 'forest':
        if (id === 'dark_forest' && r < 0.012) return put(b.shadowcap);
        if (patch(0x1ea, 2) < 30 && r < 0.4) return put(b.leafLitter);
        return false;
      case 'taiga':
        if (id === 'snowy_taiga') return r < 0.006 ? put(b.snowberry) : false;
        return r < 0.006 ? put(b.lingonberry) : false;
      case 'icy':
        if (patch(0xf05) < 18 && r < 0.05) return put(b.frostbloom);
        return r < 0.003 ? put(b.snowberry) : false;
      case 'mountain':
        if (id === 'cherry_grove') return patch(0xce7, 2) < 45 && r < 0.35 ? put(b.petals) : false;
        if (id === 'meadow' && r < 0.012) return put(b.edelweiss);
        if ((id === 'windswept_hills' || id === 'grove') && r < 0.005) return put(b.edelweiss);
        return false;
      case 'jungle':
        return patch(0x0c1) < 25 && r < 0.03 ? put(b.orchid) : false;
      case 'swamp':
      case 'river': {
        // Cattails line the water's edge
        let edge = false;
        for (const [dx, dz] of SIDES) if (STATE_FLUID[v.get(x + dx, y, z + dz)] === 1) edge = true;
        if (edge && r2 < 0.45 && v.get(x, y + 2, z) === 0) {
          v.set(x, y + 1, z, b.cattailLo);
          v.set(x, y + 2, z, b.cattailHi);
          return true;
        }
        if (cat === 'swamp' && r < 0.006) return put(b.glowcap);
        return false;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// After vegetation: hanging moss and peat beds (column-local)
// ---------------------------------------------------------------------------
export function afterVegetation(v: DecorView, seed: number, cx: number, cz: number): void {
  const b = st();
  for (let lx = 0; lx < 16; lx++)
    for (let lz = 0; lz < 16; lz++) {
      const x = (cx << 4) + lx;
      const z = (cz << 4) + lz;
      const biome = biomeOf(v.biome(x, z));
      const h = hashInts(seed, x, z, 0x3055);
      const r = ((h >>> 0) % 1000) / 1000;
      if (biome.category === 'jungle' || id(biome) === 'mangrove_swamp' || biome.category === 'swamp') {
        // Moss hangs under the canopy: find the lowest leaves of the column's top crown
        if (r < 0.14) {
          let y = v.height(x, z) + 40;
          while (y > SEA_LEVEL && !isLeaves(v.get(x, y, z))) y--;
          while (y > SEA_LEVEL && isLeaves(v.get(x, y - 1, z))) y--;
          if (isLeaves(v.get(x, y, z))) {
            const len = 1 + ((h >>> 12) % 4);
            for (let k = 1; k <= len; k++) {
              if (v.get(x, y - k, z) !== 0) break;
              v.set(x, y - k, z, b.hangingMoss);
            }
          }
        }
      }
      if (biome.category === 'swamp') {
        // Peat beds lie a little below the surface
        if ((hashInts(seed, x >> 3, z >> 3, 0x9ea7) >>> 0) % 100 < 40) {
          const gy = groundY(v, x, z);
          for (let k = 1; k <= 3; k++) {
            const s = v.get(x, gy - k, z);
            if (s === b.dirt || s === b.mud) v.set(x, gy - k, z, b.peat);
          }
        }
      }
    }
}

function id(b: Biome): string {
  return b.id;
}

// ---------------------------------------------------------------------------
// Volcanic caves
// ---------------------------------------------------------------------------
/**
 * Lava never touches water in V4 caves: where they would meet, the lava has
 * cooled into a magma crust. Rock around cave lava turns to magma, with basalt
 * where it cooled further. Column-local over the target chunk.
 */
export function volcanic(v: DecorView, seed: number, cx: number, cz: number): void {
  const b = st();
  const bx = cx << 4;
  const bz = cz << 4;
  const t = v.target;
  const get = (x: number, y: number, z: number): number => v.get(x, y, z);
  const isWater = (s: number): boolean => STATE_FLUID[s] === 1;
  // 1. Lava next to water becomes magma (pass on the chunk's lava cells)
  const crust: number[] = [];
  const top = Math.min(250, t.topSection() * 16);
  for (let y = 1; y < top; y++)
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        if (STATE_FLUID[t.get(lx, y, lz)] !== 2) continue;
        const x = bx + lx;
        const z = bz + lz;
        if (isWater(get(x, y + 1, z)) || isWater(get(x, y - 1, z)) || SIDES.some(([dx, dz]) => isWater(get(x + dx, y, z + dz)))) crust.push(lx, y, lz);
      }
  for (let i = 0; i < crust.length; i += 3) t.setRaw(crust[i]!, crust[i + 1]!, crust[i + 2]!, b.magma);
  // 2. Magma and basalt lining the rock around underground lava
  for (let y = 2; y < Math.min(top, 96); y++)
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const s = t.get(lx, y, lz);
        if (!STATE_SOLID[s] || !STATE_OPAQUE[s] || s === b.magma || !isHostRock(s)) continue;
        const x = bx + lx;
        const z = bz + lz;
        // Only below the surface
        if (y > v.height(x, z) - 6) continue;
        const above = get(x, y + 1, z);
        const lavaAbove = STATE_FLUID[above] === 2;
        let lavaSide = false;
        for (const [dx, dz] of SIDES) if (STATE_FLUID[get(x + dx, y, z + dz)] === 2) lavaSide = true;
        if (!lavaAbove && !lavaSide && STATE_FLUID[get(x, y - 1, z)] !== 2) continue;
        // Nobody sees the floor under deep lava
        if (lavaAbove && !lavaSide && STATE_FLUID[get(x, y + 2, z)] === 2) continue;
        const roll = (hashInts(seed, x, y, z, 0x3a63) >>> 0) % 100;
        if (roll < (lavaAbove ? 62 : 42)) t.setRaw(lx, y, lz, b.magma);
        else if (roll < (lavaAbove ? 72 : 55)) t.setRaw(lx, y, lz, b.basalt);
      }
}

let HOST: Set<number> | undefined;
function isHostRock(s: number): boolean {
  HOST ??= new Set(['stone', 'deepslate', 'tuff', 'granite', 'diorite', 'andesite', 'cobblestone', 'gravel', 'dripstone_block', 'calcite', 'smooth_basalt'].map((i) => S(i)));
  return HOST.has(s);
}
