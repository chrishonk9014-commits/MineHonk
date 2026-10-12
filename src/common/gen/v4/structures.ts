/**
 * V4 structures: something to find in every major biome, each with its own
 * look and purpose. Landmarks (oasis, stone circle, lighthouse, lookout),
 * camps and ruins with loot, a buried tomb, two temples with puzzles (the
 * sun monument's levers and the jungle shrine's braziers) and the bunker
 * quest. All are authored facing north (the door on the z = 0 side); the
 * Builder rotates them.
 */
import type { Random } from '../../math/rng';
import { S, stateOf } from '../../registry/blocks';
import type { Biome } from '../../registry/biomes';
import { Builder, weathered } from '../structures/builder';
import { single, lootSeed } from '../structures/misc';
import type { StructureType, Start } from '../structures/manager';

const cat = (...c: string[]) => (b: Biome): boolean => c.includes(b.category);
const ids = (...c: string[]) => (b: Biome): boolean => c.includes(b.id);
const either = (...fs: ((b: Biome) => boolean)[]) => (b: Biome): boolean => fs.some((f) => f(b));

type P3 = [number, number, number];
const at = (b: Builder, x: number, y: number, z: number): P3 => [b.wx(x, z), b.oy + y, b.wz(x, z)];

/** A lantern hanging from the block above. */
const hangingLantern = (): number => stateOf('lantern', { hanging: 'true' });

/** An A-frame tent of wool over `len` blocks along z, opening to the north. */
function tent(b: Builder, x0: number, z0: number, len: number, wool: string): void {
  const w = S(wool);
  for (let z = z0; z < z0 + len; z++) {
    b.set(x0, 1, z, w);
    b.set(x0 + 4, 1, z, w);
    b.set(x0 + 1, 2, z, w);
    b.set(x0 + 3, 2, z, w);
    b.set(x0 + 2, 3, z, w);
  }
  // Back wall
  for (let x = x0 + 1; x <= x0 + 3; x++) b.set(x, 1, z0 + len - 1, w);
  b.set(x0 + 2, 2, z0 + len - 1, w);
}

// ---------------------------------------------------------------------------
// Desert oasis: a spring-fed pond under palms, with a traveller's tent
// ---------------------------------------------------------------------------
function palm(b: Builder, x: number, z: number, h: number, lean: [number, number]): void {
  const log = stateOf('jungle_log', { axis: 'y' });
  const leaves = S('jungle_leaves');
  let px = x;
  let pz = z;
  for (let y = 1; y <= h; y++) {
    if (y === Math.ceil(h / 2)) {
      px += lean[0];
      pz += lean[1];
    }
    b.set(px, y, pz, log);
  }
  const top = h + 1;
  b.set(px, top, pz, leaves);
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    b.set(px + dx, top, pz + dz, leaves);
    b.set(px + dx * 2, top, pz + dz * 2, leaves);
    b.set(px + dx * 3, top - 1, pz + dz * 3, leaves);
  }
  for (const [dx, dz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const)
    b.set(px + dx, top - 1 + 1, pz + dz, leaves);
}

export const DESERT_OASIS = single({
  id: 'desert_oasis',
  spacing: 22,
  separation: 6,
  salt: 0x0a515,
  sx: 17,
  sz: 17,
  height: 12,
  below: 4,
  y: 'surface',
  maxSlope: 4,
  biome: cat('desert'),
  build(b, rng, seed) {
    b.clearAbove(0, 0, 16, 16, 1, 11);
    const cx = 8;
    const cz = 8;
    for (let z = 0; z < 17; z++)
      for (let x = 0; x < 17; x++) {
        const d = Math.hypot((x - cx) / 1.25, z - cz);
        b.foundation(x, z, -1, S('sand'));
        if (d < 4.2) {
          b.set(x, -3, z, S('clay'));
          b.set(x, -2, z, d < 3 ? S('water') : S('sand'));
          b.set(x, -1, z, S('water'));
          b.set(x, 0, z, 0);
        } else if (d < 6.8) {
          b.set(x, -1, z, S('grass_block'));
          b.set(x, 0, z, S('dirt'));
          b.set(x, 0, z, S('grass_block'));
          const r = rng.next();
          if (r < 0.28) b.set(x, 1, z, S('short_grass'));
          else if (r < 0.36) b.set(x, 1, z, S('beach_grass'));
          else if (r < 0.4) b.set(x, 1, z, S('desert_marigold'));
          // Reeds where the grass meets the water
          if (d < 5 && rng.chance(0.35)) {
            b.set(x, 1, z, S('sugar_cane'));
            b.set(x, 2, z, S('sugar_cane'));
          }
        } else b.set(x, 0, z, S('sand'));
      }
    for (let i = 0; i < 4; i++) b.set(cx - 2 + rng.int(5), 0, cz - 2 + rng.int(4), S('lily_pad'));
    palm(b, 3, 4, 6, [0, -1]);
    palm(b, 13, 5, 7, [1, 0]);
    palm(b, 11, 13, 5, [0, 1]);
    // A traveller's tent with their pack
    tent(b, 1, 11, 4, 'white_wool');
    b.set(3, 0, 12, S('sand'));
    b.chest(3, 1, 13, 'north', 'chest/oasis', lootSeed(b, 3, 1, 13, seed));
    b.set(2, 1, 12, S('barrel'));
    b.set(4, 1, 9, stateOf('campfire', { lit: 'false' }));
  },
});

// ---------------------------------------------------------------------------
// Sun monument: an obelisk on a plaza. Set its levers to match the glyphs
// above them and the seal over the stairs to the chamber below breaks open.
// ---------------------------------------------------------------------------
const SUN_LEVERS: [number, number, string][] = [
  [7, 5, 'north'],
  [9, 7, 'east'],
  [7, 9, 'south'],
  [5, 7, 'west'],
];
function sunGlyphs(rng: Random): boolean[] {
  const g = SUN_LEVERS.map(() => rng.chance(0.5));
  if (!g.some(Boolean)) g[rng.int(4)] = true;
  return g;
}

export const SUN_MONUMENT = single({
  id: 'sun_monument',
  spacing: 44,
  separation: 10,
  salt: 0x5a7,
  sx: 15,
  sz: 15,
  height: 18,
  below: 9,
  y: 'surface',
  maxSlope: 5,
  biome: cat('desert'),
  build(b, rng, seed) {
    const glyphs = sunGlyphs(rng);
    b.clearAbove(0, 0, 14, 14, 1, 17);
    for (let z = 0; z < 15; z++)
      for (let x = 0; x < 15; x++) {
        b.foundation(x, z, -1, S('sandstone'), 10);
        const edge = x === 0 || z === 0 || x === 14 || z === 14;
        b.set(x, 0, z, edge ? S('cut_sandstone') : (x + z) % 2 ? S('smooth_sandstone') : S('sandstone'));
      }
    // Corner pillars with braziers of glowing sunstone
    for (const [x, z] of [
      [1, 1],
      [13, 1],
      [1, 13],
      [13, 13],
    ] as const) {
      for (let y = 1; y <= 3; y++) b.set(x, y, z, S('cut_sandstone'));
      b.set(x, 4, z, S('chiseled_sandstone'));
      b.set(x, 5, z, S('lantern'));
    }
    // The obelisk: a 3x3 base, a tall shaft, a gold cap
    for (let y = 1; y <= 3; y++) for (let x = 6; x <= 8; x++) for (let z = 6; z <= 8; z++) b.set(x, y, z, S('cut_sandstone'));
    for (let y = 4; y <= 14; y++) b.set(7, y, 7, y % 4 === 0 ? S('chiseled_sandstone') : S('sandstone'));
    b.set(7, 15, 7, S('gold_block'));
    // Levers on the base's faces, a glyph above each: chiseled means on
    SUN_LEVERS.forEach(([x, z, facing], i) => {
      b.set(x, 1, z, stateOf('lever', { face: 'wall', facing, powered: 'false' }));
      const [dx, dz] = facing === 'north' ? [0, 1] : facing === 'south' ? [0, -1] : facing === 'west' ? [1, 0] : [-1, 0];
      b.set(x + dx, 2, z + dz, glyphs[i] ? S('chiseled_sandstone') : S('cut_sandstone'));
    });
    // The hidden chamber, reached by stairs under a sandstone seal
    b.box(3, -8, 3, 11, -3, 11, S('sandstone'), 0);
    for (let x = 4; x <= 10; x++) for (let z = 4; z <= 10; z++) b.set(x, -8, z, (x + z) % 2 ? S('orange_terracotta') : S('smooth_sandstone'));
    for (let i = 0; i < 5; i++) {
      b.set(7, -1 - i, 12 - i, stateOf('sandstone_stairs', { facing: 'north' }));
      for (let y = 0; y < 3; y++) b.set(7, -i + y, 12 - i, i === 0 && y === 0 ? S('sandstone') : 0);
    }
    b.set(7, 0, 12, S('sandstone'));
    b.chest(7, -7, 5, 'south', 'chest/sun_monument', lootSeed(b, 7, -7, 5, seed));
    for (const [x, z] of [
      [4, 4],
      [10, 4],
      [4, 9],
      [10, 9],
      [5, 5],
    ] as const)
      b.set(x, -7, z, S('ancient_urn'));
    b.set(7, -5, 7, stateOf('lantern', { hanging: 'false' }));
    b.set(7, -6, 7, S('chiseled_sandstone'));
    b.set(7, -7, 7, S('chiseled_sandstone'));
  },
  quest(b, rng) {
    const glyphs = sunGlyphs(rng);
    return { kind: 'levers', levers: SUN_LEVERS.map(([x, z], i) => ({ at: at(b, x, 1, z), on: glyphs[i]! })), door: [at(b, 7, 0, 12)] };
  },
});

// ---------------------------------------------------------------------------
// Buried tomb: a sealed burial hall under the sand
// ---------------------------------------------------------------------------
export const BURIED_TOMB = single({
  id: 'buried_tomb',
  spacing: 26,
  separation: 6,
  salt: 0x70b,
  sx: 13,
  sz: 13,
  height: 7,
  below: 1,
  y: 'underground',
  minY: 28,
  maxY: 52,
  biome: cat('desert', 'mesa'),
  build(b, rng, seed) {
    const wall = (): number => weathered(rng, 'sandstone', 'cut_sandstone', 'smooth_sandstone', 0.35);
    for (let y = 0; y <= 6; y++)
      for (let z = 0; z < 13; z++)
        for (let x = 0; x < 13; x++) {
          const edge = x === 0 || z === 0 || x === 12 || z === 12 || y === 0 || y === 6;
          b.set(x, y, z, edge ? wall() : 0);
        }
    // A central hall with pillars and two burial niches
    for (const [x, z] of [
      [3, 3],
      [9, 3],
      [3, 9],
      [9, 9],
    ] as const)
      for (let y = 1; y <= 5; y++) b.set(x, y, z, y === 3 ? S('chiseled_sandstone') : S('cut_sandstone'));
    for (let x = 1; x < 12; x++) {
      b.set(x, 1, 1, S('smooth_sandstone'));
      b.set(x, 1, 11, S('smooth_sandstone'));
    }
    for (let x = 2; x < 11; x += 2) {
      b.set(x, 2, 1, S('ancient_urn'));
      b.set(x, 2, 11, rng.chance(0.7) ? S('ancient_urn') : S('cobweb'));
    }
    // The sarcophagus and its keeper
    for (let z = 5; z <= 7; z++) {
      b.set(6, 1, z, S('smooth_sandstone'));
      b.set(6, 2, z, stateOf('sandstone_slab', { type: 'bottom' }));
    }
    b.chest(6, 1, 8, 'south', 'chest/buried_tomb', lootSeed(b, 6, 1, 8, seed));
    b.spawner(6, 1, 4, 'zombie');
    for (const [x, z] of [
      [1, 6],
      [11, 6],
    ] as const)
      b.set(x, 3, z, S('soul_lantern'));
    for (let i = 0; i < 5; i++) b.set(1 + rng.int(11), 5, 1 + rng.int(11), S('cobweb'));
  },
});

// ---------------------------------------------------------------------------
// Ranger tower: a lookout above the treetops
// ---------------------------------------------------------------------------
export const RANGER_TOWER = single({
  id: 'ranger_tower',
  spacing: 30,
  separation: 8,
  salt: 0x7a9e,
  sx: 7,
  sz: 7,
  height: 18,
  below: 6,
  y: 'surface',
  maxSlope: 4,
  biome: either(cat('forest', 'taiga'), ids('windswept_hills')),
  build(b, rng, seed) {
    const wood = rng.chance(0.5) ? 'spruce' : 'oak';
    const log = stateOf(`${wood}_log`, { axis: 'y' });
    const planks = S(`${wood}_planks`);
    b.clearAbove(0, 0, 6, 6, 1, 17);
    for (const [x, z] of [
      [1, 1],
      [5, 1],
      [1, 5],
      [5, 5],
    ] as const) {
      b.foundation(x, z, 0, S('cobblestone'), 8);
      for (let y = 1; y <= 12; y++) b.set(x, y, z, log);
    }
    // Braces every few blocks
    for (const y of [4, 8]) {
      for (let i = 2; i <= 4; i++) {
        b.set(i, y, 1, S(`${wood}_fence`));
        b.set(i, y, 5, S(`${wood}_fence`));
        b.set(1, y, i, S(`${wood}_fence`));
        b.set(5, y, i, S(`${wood}_fence`));
      }
    }
    // The cabin at the top: a floor, railing, a roof
    b.fill(0, 12, 0, 6, 12, 6, planks);
    for (let i = 0; i <= 6; i++) {
      b.set(i, 13, 0, S(`${wood}_fence`));
      b.set(i, 13, 6, S(`${wood}_fence`));
      b.set(0, 13, i, S(`${wood}_fence`));
      b.set(6, 13, i, S(`${wood}_fence`));
    }
    for (const [x, z] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
    ] as const)
      for (let y = 13; y <= 15; y++) b.set(x, y, z, log);
    for (let r = 0; r < 3; r++)
      for (let x = r - 1; x <= 7 - r; x++)
        for (let z = r - 1; z <= 7 - r; z++) {
          const edge = x === r - 1 || z === r - 1 || x === 7 - r || z === 7 - r;
          if (edge) b.set(x, 16 + r, z, stateOf(`${wood}_slab`, { type: 'bottom' }));
        }
    b.set(3, 15, 3, hangingLantern());
    b.set(3, 16, 3, planks);
    // Ladder up the middle
    b.set(3, 1, 3, planks);
    for (let y = 1; y <= 12; y++) b.set(3, y, 4, stateOf('ladder', { facing: 'north' }));
    b.set(3, 12, 4, stateOf('ladder', { facing: 'north' }));
    for (let y = 2; y <= 11; y++) b.set(3, y, 3, planks);
    b.chest(5, 13, 5, 'west', 'chest/ranger_tower', lootSeed(b, 5, 13, 5, seed));
    b.set(1, 13, 5, S('crafting_table'));
  },
});

// ---------------------------------------------------------------------------
// Hunter camp: tents around a fire in the taiga
// ---------------------------------------------------------------------------
export const HUNTER_CAMP = single({
  id: 'hunter_camp',
  spacing: 24,
  separation: 6,
  salt: 0x4c4a,
  sx: 13,
  sz: 11,
  height: 6,
  below: 3,
  y: 'surface',
  maxSlope: 3,
  biome: cat('taiga'),
  build(b, rng, seed) {
    b.clearAbove(0, 0, 12, 10, 1, 5);
    for (let z = 0; z < 11; z++) for (let x = 0; x < 13; x++) b.foundation(x, z, 0, S('podzol'), 4);
    tent(b, 0, 1, 4, 'brown_wool');
    tent(b, 8, 1, 4, 'white_wool');
    // The fire and log seats
    b.set(6, 1, 6, stateOf('campfire', { lit: 'true' }));
    b.set(4, 1, 6, stateOf('spruce_log', { axis: 'z' }));
    b.set(8, 1, 6, stateOf('spruce_log', { axis: 'z' }));
    b.set(6, 1, 8, stateOf('spruce_log', { axis: 'x' }));
    // A drying rack of fences with a hay bale and the day's catch
    for (let x = 2; x <= 5; x++) b.set(x, 1, 9, S('spruce_fence'));
    b.set(2, 2, 9, S('spruce_fence'));
    b.set(5, 2, 9, S('spruce_fence'));
    for (let x = 2; x <= 5; x++) b.set(x, 3, 9, S('spruce_slab'));
    b.set(9, 1, 9, stateOf('hay_bale', { axis: 'x' }));
    b.chest(2, 1, 2, 'south', 'chest/hunter_camp', lootSeed(b, 2, 1, 2, seed));
    b.set(10, 1, 3, S('barrel'));
    b.set(11, 1, 8, S('spruce_fence'));
    b.set(11, 2, 8, S('lantern'));
    for (let i = 0; i < 6; i++) b.set(rng.int(13), 1, 5 + rng.int(3), S('leaf_litter'));
  },
});

// ---------------------------------------------------------------------------
// Frozen ruins: the broken walls of a keep, locked in ice, with a cellar
// ---------------------------------------------------------------------------
export const FROZEN_RUINS = single({
  id: 'frozen_ruins',
  spacing: 26,
  separation: 6,
  salt: 0xf102,
  sx: 13,
  sz: 13,
  height: 9,
  below: 6,
  y: 'surface',
  maxSlope: 5,
  biome: either(cat('icy'), ids('snowy_slopes', 'grove', 'snowy_taiga')),
  build(b, rng, seed) {
    const brick = (): number => (rng.chance(0.25) ? S('packed_ice') : S('frosted_stone_bricks'));
    for (let z = 0; z < 13; z++) for (let x = 0; x < 13; x++) b.foundation(x, z, 0, S('frosted_stone_bricks'), 6);
    // Walls broken to different heights
    for (let i = 0; i < 13; i++) {
      for (const [x, z] of [
        [i, 0],
        [i, 12],
        [0, i],
        [12, i],
      ] as const) {
        const h = Math.max(0, Math.round(2 + Math.sin(i * 1.3 + x * 0.7) * 2 + rng.next() * 2));
        for (let y = 1; y <= h; y++) b.set(x, y, z, brick());
        if (h > 0 && rng.chance(0.4)) b.set(x, h + 1, z, stateOf('snow', { layers: 2 }));
      }
    }
    // A corner tower still standing
    for (let y = 1; y <= 8; y++)
      for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) if (x !== 1 || z !== 1) b.set(x, y, z, y > 6 && rng.chance(0.4) ? 0 : brick());
    b.set(1, 1, 1, 0);
    b.set(1, 2, 1, 0);
    // Ice pillars and an altar of blue ice
    for (const [x, z] of [
      [4, 4],
      [8, 4],
      [4, 8],
      [8, 8],
    ] as const)
      for (let y = 1; y <= 3 + rng.int(3); y++) b.set(x, y, z, S('packed_ice'));
    b.set(6, 1, 6, S('blue_ice'));
    b.set(6, 2, 6, S('frostbloom'));
    for (let x = 1; x < 12; x++) for (let z = 1; z < 12; z++) if (rng.chance(0.3)) b.set(x, 1, z, stateOf('snow', { layers: 1 }));
    // The cellar under a trapdoor
    b.box(8, -5, 8, 12, -1, 12, S('frosted_stone_bricks'), 0);
    b.set(10, 0, 10, stateOf('spruce_trapdoor', { facing: 'north', half: 'top' }));
    for (let y = -4; y <= -1; y++) b.set(10, y, 11, stateOf('ladder', { facing: 'north' }));
    b.chest(9, -4, 9, 'south', 'chest/frozen_ruins', lootSeed(b, 9, -4, 9, seed));
    b.spawner(11, -4, 9, 'skeleton');
  },
});

// ---------------------------------------------------------------------------
// Jungle shrine: a stepped shrine. Light the four braziers on its top and
// the stone that seals the sanctum inside slides away.
// ---------------------------------------------------------------------------
const SHRINE_BRAZIERS: [number, number][] = [
  [4, 4],
  [8, 4],
  [4, 8],
  [8, 8],
];

export const JUNGLE_SHRINE = single({
  id: 'jungle_shrine',
  spacing: 30,
  separation: 8,
  salt: 0x1a5e,
  sx: 13,
  sz: 13,
  height: 12,
  below: 4,
  y: 'surface',
  maxSlope: 6,
  biome: cat('jungle'),
  build(b, rng, seed) {
    const stone = (): number => weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.55);
    b.clearAbove(0, 0, 12, 12, 1, 11);
    // Three tiers
    for (let t = 0; t < 3; t++) {
      const lo = t * 2;
      const hi = 12 - t * 2;
      for (let y = t * 2; y <= t * 2 + 1; y++) for (let x = lo; x <= hi; x++) for (let z = lo; z <= hi; z++) b.set(x, y, z, stone());
    }
    for (let z = 0; z < 13; z++) for (let x = 0; x < 13; x++) b.foundation(x, z, -1, S('mossy_cobblestone'), 6);
    // Stairs up the north face
    for (let i = 0; i < 6; i++) for (let x = 5; x <= 7; x++) b.set(x, i, i, stateOf('mossy_stone_bricks_stairs', { facing: 'south' }));
    // The sanctum inside, sealed
    b.box(3, 0, 3, 9, 5, 9, S('mossy_stone_bricks'), 0);
    for (let x = 4; x <= 8; x++) for (let z = 4; z <= 8; z++) b.set(x, 1, z, S('mossy_cobblestone'));
    b.chest(6, 2, 7, 'north', 'chest/jungle_shrine', lootSeed(b, 6, 2, 7, seed));
    b.set(4, 2, 7, S('ancient_urn'));
    b.set(8, 2, 7, S('ancient_urn'));
    b.set(5, 2, 5, S('jungle_orchid'));
    b.set(7, 2, 5, S('jungle_orchid'));
    b.set(5, 1, 5, S('grass_block'));
    b.set(7, 1, 5, S('grass_block'));
    // The seal: the stone plug in the top of the sanctum
    b.fill(6, 5, 6, 6, 5, 6, S('chiseled_stone_bricks'));
    // Top tier and its unlit braziers
    for (const [x, z] of SHRINE_BRAZIERS) b.set(x, 6, z, stateOf('campfire', { lit: 'false' }));
    b.set(6, 6, 6, stateOf('stone_bricks_slab', { type: 'bottom' }));
    // Overgrowth
    for (let i = 0; i < 18; i++) {
      const x = rng.int(13);
      const z = rng.int(13);
      const edge = x === 0 || z === 0 || x === 12 || z === 12;
      if (edge) b.set(x, 1, z, S('mossy_cobblestone'));
    }
  },
  quest(b) {
    return { kind: 'braziers', braziers: SHRINE_BRAZIERS.map(([x, z]) => at(b, x, 6, z)), door: [at(b, 6, 5, 6), at(b, 6, 6, 6)] };
  },
});

// ---------------------------------------------------------------------------
// Swamp shack: a hut on stilts with a boardwalk out over the water
// ---------------------------------------------------------------------------
export const SWAMP_SHACK = single({
  id: 'swamp_shack',
  spacing: 24,
  separation: 6,
  salt: 0x5aac,
  sx: 9,
  sz: 13,
  height: 10,
  below: 8,
  y: 'surface',
  maxSlope: 6,
  biome: cat('swamp'),
  build(b, rng, seed) {
    const wood = rng.chance(0.5) ? 'mangrove' : 'dark_oak';
    const planks = S(`${wood}_planks`);
    const fence = S(`${wood}_fence`);
    const y0 = 3;
    for (const [x, z] of [
      [0, 5],
      [8, 5],
      [0, 12],
      [8, 12],
      [4, 0],
      [4, 3],
    ] as const)
      b.foundation(x, z, y0 - 1, stateOf(`${wood === 'mangrove' ? 'mangrove' : 'oak'}_log`, { axis: 'y' }), 12);
    // The platform and the boardwalk out front
    b.fill(0, y0, 5, 8, y0, 12, planks);
    for (let z = 0; z < 5; z++) b.set(4, y0, z, planks);
    for (let z = 0; z < 5; z++) {
      b.set(3, y0 + 1, z, fence);
      b.set(5, y0 + 1, z, fence);
    }
    // Walls with windows, a door, a sloped roof
    b.box(1, y0, 6, 7, y0 + 4, 11, planks, 0);
    b.fill(1, y0 + 4, 6, 7, y0 + 4, 11, planks);
    for (const [x, z] of [
      [1, 8],
      [7, 8],
      [4, 11],
    ] as const)
      b.set(x, y0 + 2, z, S('glass_pane'));
    b.set(4, y0 + 1, 6, stateOf(`${wood}_door`, { facing: 'north', half: 'lower' }));
    b.set(4, y0 + 2, 6, stateOf(`${wood}_door`, { facing: 'north', half: 'upper' }));
    for (let x = 0; x <= 8; x++) {
      b.set(x, y0 + 5, 5, stateOf(`${wood}_stairs`, { facing: 'south' }));
      b.set(x, y0 + 5, 12, stateOf(`${wood}_stairs`, { facing: 'north' }));
      for (let z = 6; z <= 11; z++) b.set(x, y0 + 5, z, stateOf(`${wood}_slab`, { type: 'bottom' }));
    }
    // Inside: a cauldron, a brewing stand, glowcaps in the corner and the owner's chest
    b.set(2, y0 + 1, 10, S('cauldron'));
    b.set(6, y0 + 1, 10, S('brewing_stand'));
    b.chest(6, y0 + 1, 7, 'west', 'chest/swamp_shack', lootSeed(b, 6, y0 + 1, 7, seed));
    b.set(2, y0 + 1, 7, S('marsh_glowcap'));
    b.set(4, y0 + 3, 9, hangingLantern());
    for (const [x, z] of [
      [0, 6],
      [8, 6],
      [0, 11],
    ] as const)
      b.set(x, y0 + 4, z, S('hanging_moss'));
  },
});

// ---------------------------------------------------------------------------
// Stone circle: standing stones around an altar, with a cache beneath it
// ---------------------------------------------------------------------------
export const STONE_CIRCLE = single({
  id: 'stone_circle',
  spacing: 40,
  separation: 10,
  salt: 0x5c1c,
  sx: 15,
  sz: 15,
  height: 7,
  below: 4,
  y: 'surface',
  maxSlope: 3,
  biome: either(cat('savanna', 'plains'), ids('meadow')),
  build(b, rng, seed) {
    const stones = 10;
    const tops: P3[] = [];
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2;
      const x = Math.round(7 + Math.cos(a) * 6);
      const z = Math.round(7 + Math.sin(a) * 6);
      b.foundation(x, z, 0, S('stone'), 6);
      if (rng.chance(0.15)) {
        // A fallen stone
        const dx = Math.round(Math.cos(a));
        const dz = Math.round(Math.sin(a));
        b.set(x, 1, z, S('mossy_cobblestone'));
        b.set(x + dx, 1, z + dz, S('andesite'));
        continue;
      }
      const h = 3 + rng.int(2);
      for (let y = 1; y <= h; y++) b.set(x, y, z, y === h ? S('polished_andesite') : rng.chance(0.3) ? S('mossy_cobblestone') : S('andesite'));
      tops.push([x, h, z]);
    }
    // Lintels between some neighbouring stones
    for (let i = 0; i + 1 < tops.length; i += 3) {
      const [x0, h0, z0] = tops[i]!;
      const [x1, h1, z1] = tops[i + 1]!;
      if (Math.abs(x1 - x0) + Math.abs(z1 - z0) > 4) continue;
      const y = Math.min(h0, h1) + 1;
      const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
      for (let k = 0; k <= n; k++) b.set(Math.round(x0 + ((x1 - x0) * k) / n), y, Math.round(z0 + ((z1 - z0) * k) / n), S('stone_slab'));
    }
    // The altar, the path of old stones, and what lies under the altar
    b.set(7, 1, 7, S('chiseled_stone_bricks'));
    b.set(7, 2, 7, stateOf('stone_bricks_slab', { type: 'bottom' }));
    b.set(6, 1, 7, stateOf('stone_bricks_stairs', { facing: 'east' }));
    b.set(8, 1, 7, stateOf('stone_bricks_stairs', { facing: 'west' }));
    b.set(7, 0, 7, S('stone_bricks'));
    b.chest(7, -1, 7, 'north', 'chest/stone_circle', lootSeed(b, 7, -1, 7, seed));
    b.set(7, -2, 7, S('stone_bricks'));
    for (let i = 0; i < 6; i++) b.set(7, 0, 1 + i, rng.chance(0.6) ? S('mossy_cobblestone') : S('gravel'));
  },
});

// ---------------------------------------------------------------------------
// Lighthouse: a banded tower on the shore, its lamp room still burning
// ---------------------------------------------------------------------------
export const LIGHTHOUSE = single({
  id: 'lighthouse',
  spacing: 34,
  separation: 8,
  salt: 0x11447,
  sx: 9,
  sz: 9,
  height: 26,
  below: 8,
  y: 'surface',
  maxSlope: 5,
  biome: ids('beach', 'stony_shore', 'snowy_beach'),
  build(b, rng, seed) {
    b.clearAbove(0, 0, 8, 8, 1, 25);
    const round = (x: number, z: number, r: number): boolean => (x - 4) ** 2 + (z - 4) ** 2 <= r * r + 1;
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) if (round(x, z, 4)) b.foundation(x, z, 0, S('stone_bricks'), 10);
    for (let y = 1; y <= 18; y++) {
      const band = Math.floor((y - 1) / 3) % 2 === 0 ? S('white_terracotta') : S('red_terracotta');
      for (let z = 1; z < 8; z++)
        for (let x = 1; x < 8; x++) {
          if (!round(x, z, 3)) continue;
          const inner = round(x, z, 2) && !(x === 2 || x === 6 || z === 2 || z === 6) ? true : (x - 4) ** 2 + (z - 4) ** 2 < 5;
          b.set(x, y, z, inner ? 0 : band);
        }
    }
    // A door, windows on the way up, a ladder inside
    b.set(4, 1, 1, stateOf('spruce_door', { facing: 'north', half: 'lower' }));
    b.set(4, 2, 1, stateOf('spruce_door', { facing: 'north', half: 'upper' }));
    for (const y of [6, 11, 15]) b.set(y % 2 ? 7 : 1, y, 4, S('glass_pane'));
    for (let y = 1; y <= 19; y++) b.set(4, y, 6, stateOf('ladder', { facing: 'north' }));
    // The gallery and lamp room
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) if (round(x, z, 4)) b.set(x, 19, z, S('stone_bricks'));
    b.set(4, 19, 6, stateOf('ladder', { facing: 'north' }));
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) if (round(x, z, 4) && !round(x, z, 3)) b.set(x, 20, z, S('iron_bars'));
    for (let z = 2; z < 7; z++)
      for (let x = 2; x < 7; x++) {
        const edge = x === 2 || x === 6 || z === 2 || z === 6;
        for (let y = 20; y <= 22; y++) if (edge) b.set(x, y, z, S('glass_pane'));
      }
    b.set(4, 20, 4, S('sea_lantern'));
    b.set(4, 21, 4, S('glowstone'));
    for (let z = 2; z < 7; z++) for (let x = 2; x < 7; x++) b.set(x, 23, z, S('dark_oak_slab'));
    b.set(4, 24, 4, S('end_rod'));
    b.chest(3, 20, 5, 'east', 'chest/lighthouse', lootSeed(b, 3, 20, 5, seed));
    void rng;
  },
});

// ---------------------------------------------------------------------------
// Mountain lookout: a squat stone tower and a cairn on a high ridge
// ---------------------------------------------------------------------------
export const MOUNTAIN_LOOKOUT = single({
  id: 'mountain_lookout',
  spacing: 30,
  separation: 8,
  salt: 0x1007,
  sx: 9,
  sz: 9,
  height: 12,
  below: 6,
  y: 'surface',
  maxSlope: 7,
  biome: either(ids('windswept_hills', 'stony_peaks', 'jagged_peaks', 'snowy_slopes', 'frozen_peaks', 'grove')),
  build(b, rng, seed) {
    const brick = (): number => weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.3);
    b.clearAbove(1, 1, 7, 7, 1, 11);
    for (let z = 1; z <= 7; z++) for (let x = 1; x <= 7; x++) b.foundation(x, z, 0, S('cobblestone'), 10);
    for (let y = 1; y <= 7; y++)
      for (let z = 2; z <= 6; z++)
        for (let x = 2; x <= 6; x++) {
          const edge = x === 2 || x === 6 || z === 2 || z === 6;
          b.set(x, y, z, edge ? brick() : 0);
        }
    b.set(4, 1, 2, 0);
    b.set(4, 2, 2, 0);
    b.fill(2, 7, 2, 6, 7, 6, S('stone_bricks'));
    for (let i = 2; i <= 6; i++) {
      b.set(i, 8, 2, S('stone_bricks_wall'));
      b.set(i, 8, 6, S('stone_bricks_wall'));
      b.set(2, 8, i, S('stone_bricks_wall'));
      b.set(6, 8, i, S('stone_bricks_wall'));
    }
    for (let y = 1; y <= 6; y++) b.set(5, y, 5, stateOf('ladder', { facing: 'north' }));
    b.set(5, 7, 5, stateOf('ladder', { facing: 'north' }));
    b.set(3, 1, 5, S('campfire'));
    b.chest(3, 1, 3, 'south', 'chest/mountain_lookout', lootSeed(b, 3, 1, 3, seed));
    // A cairn of stacked stones beside it
    for (let y = 1; y <= 3; y++) b.set(8, y, 8, y === 3 ? S('cobblestone_wall') : S('cobblestone'));
    b.set(7, 1, 8, S('cobblestone'));
  },
});

// ---------------------------------------------------------------------------
// Prospector camp: a shack and a shaft sunk into the badlands for gold
// ---------------------------------------------------------------------------
export const PROSPECTOR_CAMP = single({
  id: 'prospector_camp',
  spacing: 26,
  separation: 6,
  salt: 0x9e05,
  sx: 13,
  sz: 11,
  height: 7,
  below: 18,
  y: 'surface',
  maxSlope: 4,
  biome: cat('mesa'),
  build(b, rng, seed) {
    b.clearAbove(0, 0, 12, 10, 1, 6);
    for (let z = 0; z < 11; z++) for (let x = 0; x < 13; x++) b.foundation(x, z, 0, S('terracotta'), 6);
    // The shack
    b.box(0, 0, 4, 5, 4, 10, S('acacia_planks'), 0);
    b.fill(0, 4, 4, 5, 4, 10, S('acacia_slab'));
    b.set(2, 1, 4, stateOf('acacia_door', { facing: 'north', half: 'lower' }));
    b.set(2, 2, 4, stateOf('acacia_door', { facing: 'north', half: 'upper' }));
    b.set(5, 2, 7, S('glass_pane'));
    b.chest(1, 1, 9, 'east', 'chest/prospector_camp', lootSeed(b, 1, 1, 9, seed));
    b.set(4, 1, 9, S('crafting_table'));
    b.set(4, 3, 7, hangingLantern());
    // The headframe and shaft
    for (const [x, z] of [
      [8, 3],
      [11, 3],
      [8, 6],
      [11, 6],
    ] as const)
      for (let y = 1; y <= 4; y++) b.set(x, y, z, S('acacia_fence'));
    b.fill(8, 5, 3, 11, 5, 6, S('acacia_slab'));
    for (let y = -14; y <= 0; y++)
      for (let x = 9; x <= 10; x++)
        for (let z = 4; z <= 5; z++) b.set(x, y, z, 0);
    for (let y = -14; y <= 0; y++) b.set(9, y, 4, stateOf('ladder', { facing: 'south' }));
    // The drift at the bottom, following a vein of gold
    for (let x = 9; x <= 12; x++)
      for (let y = -14; y <= -12; y++) for (let z = 4; z <= 5; z++) b.set(x, y, z, 0);
    for (let x = 9; x <= 12; x += 3) {
      b.set(x, -12, 3, S('acacia_planks'));
      b.set(x, -12, 6, S('acacia_planks'));
    }
    for (const [x, y, z] of [
      [12, -13, 6],
      [12, -14, 3],
      [11, -11, 5],
    ] as const)
      b.set(x, y, z, rng.chance(0.6) ? S('gold_ore') : S('raw_gold_block'));
    b.set(10, -12, 5, hangingLantern());
    b.set(10, -11, 5, S('acacia_planks'));
  },
});

// ---------------------------------------------------------------------------
// Bunker: a sealed shelter under a hatch. Find the keycard in the barracks,
// open the security doors, bring both generators online, and the blast
// door to the vault opens.
// ---------------------------------------------------------------------------
/** Bunker interior floor, relative to the hatch at the surface. */
const BK = -14;

export const BUNKER = single({
  id: 'bunker',
  spacing: 36,
  separation: 8,
  salt: 0xb0b5,
  sx: 19,
  sz: 21,
  height: 5,
  below: 16,
  y: 'surface',
  maxSlope: 4,
  biome: either(cat('plains', 'forest', 'taiga', 'savanna', 'icy'), ids('meadow')),
  build(b, rng, seed) {
    const wall = S('bunker_plating');
    const floor = S('smooth_stone');
    const concrete = S('gray_concrete');
    // The hatch: a concrete pad, an iron trapdoor over the shaft, an old antenna
    for (let x = 7; x <= 11; x++) for (let z = 1; z <= 5; z++) b.foundation(x, z, 0, concrete, 4);
    b.clearAbove(7, 1, 11, 5, 1, 4);
    b.set(9, 0, 3, stateOf('iron_trapdoor', { facing: 'north', half: 'top' }));
    for (let y = BK + 1; y < 0; y++) b.set(9, y, 3, 0);
    for (let y = BK + 1; y <= -1; y++) b.set(9, y, 4, concrete);
    for (let y = BK + 1; y <= -1; y++) b.set(9, y, 3, stateOf('ladder', { facing: 'north' }));
    for (let y = BK; y <= -1; y++)
      for (const [x, z] of [
        [8, 3],
        [10, 3],
        [9, 2],
      ] as const)
        b.set(x, y, z, concrete);
    for (let y = 1; y <= 4; y++) b.set(11, y, 5, S('iron_bars'));
    b.set(11, 5, 5, S('end_rod'));
    // The shell: every room is carved out of it
    for (let y = BK - 1; y <= BK + 4; y++) for (let x = 0; x < 19; x++) for (let z = 3; z < 21; z++) b.set(x, y, z, wall);
    const room = (x0: number, z0: number, x1: number, z1: number): void => {
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          b.set(x, BK, z, floor);
          for (let y = BK + 1; y <= BK + 3; y++) b.set(x, y, z, 0);
        }
    };
    // Entry hall under the ladder, barracks to the west, security door to the south
    room(7, 3, 11, 7);
    room(1, 4, 5, 9);
    room(6, 5, 6, 5);
    // The ladder down the shaft, against a concrete column all the way to the floor
    for (let y = BK + 1; y <= -1; y++) {
      b.set(9, y, 3, stateOf('ladder', { facing: 'north' }));
      b.set(9, y, 4, concrete);
    }
    // Barracks: bunks, lockers, and the keycard left in a footlocker
    for (const z of [5, 8]) {
      b.set(1, BK + 1, z, stateOf('white_bed', { facing: 'east', part: 'foot' }));
      b.set(2, BK + 1, z, stateOf('white_bed', { facing: 'east', part: 'head' }));
    }
    b.chest(5, BK + 1, 9, 'west', 'chest/bunker_barracks', lootSeed(b, 5, BK + 1, 9, seed));
    b.set(1, BK + 1, 9, S('barrel'));
    b.set(3, BK + 3, 7, S('redstone_lamp'));
    b.set(3, BK + 3, 7, stateOf('redstone_lamp', { lit: 'true' }));
    // Security door and its reader
    room(9, 8, 9, 9);
    b.set(9, BK + 1, 8, stateOf('iron_door', { facing: 'south', half: 'lower', hinge: 'left' }));
    b.set(9, BK + 2, 8, stateOf('iron_door', { facing: 'south', half: 'upper', hinge: 'left' }));
    b.set(10, BK + 2, 7, stateOf('keycard_reader', { facing: 'north', lit: 'false' }));
    // Generator hall
    room(3, 10, 15, 15);
    b.set(4, BK + 1, 12, stateOf('bunker_generator', { facing: 'east', lit: 'false' }));
    b.set(14, BK + 1, 12, stateOf('bunker_generator', { facing: 'west', lit: 'false' }));
    for (const [x, z] of [
      [4, 13],
      [14, 13],
      [4, 11],
      [14, 11],
    ] as const)
      b.set(x, BK + 1, z, S('iron_block'));
    b.spawner(9, BK + 1, 14, 'zombie');
    b.set(6, BK + 3, 12, S('redstone_lamp'));
    b.set(12, BK + 3, 12, S('redstone_lamp'));
    for (let i = 0; i < 3; i++) b.set(5 + rng.int(9), BK + 3, 10 + rng.int(6), S('cobweb'));
    // The blast door and the vault beyond
    room(8, 16, 10, 16);
    for (let x = 8; x <= 10; x++) for (let y = BK + 1; y <= BK + 3; y++) b.set(x, y, 16, S('bunker_blast_door'));
    room(6, 17, 12, 19);
    b.chest(9, BK + 1, 19, 'north', 'chest/bunker_vault', lootSeed(b, 9, BK + 1, 19, seed));
    b.set(7, BK + 1, 19, S('barrel'));
    b.set(11, BK + 1, 19, S('barrel'));
    b.set(9, BK + 3, 18, S('sea_lantern'));
  },
  // The footprint's centre lies in the generator hall whichever way the bunker faces
  entities: (x, y, z) => [
    { type: 'zombie', x: x - 1, y: y + BK, z },
    { type: 'zombie', x: x + 1, y: y + BK, z },
    { type: 'skeleton', x, y: y + BK, z: z + 1 },
  ],
  quest(b) {
    return {
      kind: 'bunker',
      reader: at(b, 10, BK + 2, 7),
      doors: [at(b, 9, BK + 1, 8), at(b, 9, BK + 2, 8)],
      generators: [at(b, 4, BK + 1, 12), at(b, 14, BK + 1, 12)],
      blast: [8, 9, 10].flatMap((x) => [1, 2, 3].map((y) => at(b, x, BK + y, 16))),
      vault: at(b, 9, BK + 1, 19),
      area: boxOfPts([at(b, 0, BK - 1, 3), at(b, 18, 1, 20)]),
    };
  },
});

function boxOfPts(ps: P3[]): Start['bounds'] {
  const xs = ps.map((p) => p[0]);
  const ys = ps.map((p) => p[1]);
  const zs = ps.map((p) => p[2]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), z0: Math.min(...zs), x1: Math.max(...xs), y1: Math.max(...ys), z1: Math.max(...zs) };
}

/** V4 surface and underground structures, in priority order (earlier types win overlaps). */
export const V4_STRUCTURES: StructureType[] = [SUN_MONUMENT, STONE_CIRCLE, JUNGLE_SHRINE, BUNKER, LIGHTHOUSE, RANGER_TOWER, MOUNTAIN_LOOKOUT, FROZEN_RUINS, DESERT_OASIS, HUNTER_CAMP, SWAMP_SHACK, PROSPECTOR_CAMP, BURIED_TOMB];
