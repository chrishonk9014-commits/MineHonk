/**
 * Single-piece structures: temples, huts, igloos, ruined portals, ocean
 * ruins, shipwrecks, buried treasure, outposts and the original MineHonk
 * structures (sky shrines, overgrown ruins, stalker dens and the rare
 * glitched ruin that holds the gateway to the Farlands).
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_SOLID, STATE_FLUID } from '../../registry/blocks';
import { SEA_LEVEL } from '../../world/constants';
import type { Biome } from '../../registry/biomes';
import { Builder, weathered, type Rotation } from './builder';
import { boxOf, type StructureType, type PlanContext, type Start } from './manager';

type YMode = 'surface' | 'seafloor' | 'underground' | 'sky' | 'buried';

interface SingleDef {
  id: string;
  spacing: number;
  separation: number;
  salt: number;
  sx: number;
  sz: number;
  /** Blocks above the anchor y that may be touched. */
  height: number;
  /** Blocks below the anchor y that may be touched (foundations, basements). */
  below: number;
  y: YMode;
  biome: (b: Biome) => boolean;
  /** Extra chance gate after the biome test. */
  chance?: number;
  maxSlope?: number;
  build: (b: Builder, rng: Random, seed: number) => void;
  entities?: (x: number, y: number, z: number, rng: Random) => Start['entities'];
}

function single(def: SingleDef): StructureType {
  return {
    id: def.id,
    spacing: def.spacing,
    separation: def.separation,
    salt: def.salt,
    radius: Math.ceil(Math.max(def.sx, def.sz) / 16) + 1,
    candidate(ctx, x, z, rng) {
      if (def.chance !== undefined && !rng.chance(def.chance)) return false;
      return def.biome(ctx.estimateBiome(x, z));
    },
    plan(ctx: PlanContext, cx: number, cz: number, rng: Random): Start | null {
      const rot = rng.int(4) as Rotation;
      const wsx = rot & 1 ? def.sz : def.sx;
      const wsz = rot & 1 ? def.sx : def.sz;
      const x0 = (cx << 4) + rng.int(Math.max(1, 16 - Math.min(16, wsx)));
      const z0 = (cz << 4) + rng.int(Math.max(1, 16 - Math.min(16, wsz)));
      if (!def.biome(ctx.biome(x0 + (wsx >> 1), z0 + (wsz >> 1)))) return null;
      const corners: number[] = [];
      let water = 0;
      for (const [a, b] of [
        [x0, z0],
        [x0 + wsx - 1, z0],
        [x0, z0 + wsz - 1],
        [x0 + wsx - 1, z0 + wsz - 1],
        [x0 + (wsx >> 1), z0 + (wsz >> 1)],
      ] as const) {
        corners.push(ctx.groundY(a, b));
        if (ctx.isWater(a, b)) water++;
      }
      corners.sort((a, b) => a - b);
      let y: number;
      switch (def.y) {
        case 'surface':
          if (water > 1) return null;
          if (corners[4]! - corners[0]! > (def.maxSlope ?? 6)) return null;
          y = corners[2]! + 1;
          break;
        case 'seafloor':
          if (water < 4) return null;
          y = corners[0]! + 1;
          if (y > SEA_LEVEL - 4) return null;
          break;
        case 'buried':
          y = corners[2]! - 3;
          break;
        case 'sky':
          y = Math.min(200, corners[4]! + 24 + rng.int(20));
          break;
        default:
          y = 12 + rng.int(Math.max(1, corners[0]! - 30));
      }
      const seed = hashInts(ctx.seed, x0, y, z0, def.salt);
      const box = boxOf(x0 - 1, y - def.below, z0 - 1, x0 + wsx, y + def.height, z0 + wsz);
      const piece = { box, build: (v: import('../decorate/view').DecorView) => def.build(new Builder(v, x0, y, z0, rot, def.sx, def.sz), new Random(seed), ctx.seed) };
      return { type: def.id, x: x0 + (wsx >> 1), y, z: z0 + (wsz >> 1), pieces: [piece], bounds: box, entities: def.entities?.(x0 + wsx / 2, y + 1, z0 + wsz / 2, new Random(seed ^ 0x55)) };
    },
  };
}

const cat = (...c: string[]) => (b: Biome) => c.includes(b.category);
const ids = (...c: string[]) => (b: Biome) => c.includes(b.id);
const lootSeed = (b: Builder, x: number, y: number, z: number, seed: number): number => hashInts(seed, b.wx(x, z), b.oy + y, b.wz(x, z));

// ---------------------------------------------------------------------------
// Desert temple: stepped sandstone pyramid with a trapped treasure pit
// ---------------------------------------------------------------------------
export const DESERT_TEMPLE = single({
  id: 'desert_temple',
  spacing: 32,
  separation: 8,
  salt: 0xde5e27,
  sx: 21,
  sz: 21,
  height: 18,
  below: 16,
  y: 'surface',
  biome: cat('desert'),
  maxSlope: 8,
  build(b, rng, seed) {
    const sand = S('sandstone');
    const cut = S('cut_sandstone');
    const smooth = S('smooth_sandstone');
    const orange = S('orange_terracotta');
    const blue = S('blue_terracotta');
    // Foundation
    for (let z = 0; z < 21; z++) for (let x = 0; x < 21; x++) b.foundation(x, z, -1, sand, 30);
    // Stepped body: 4 tiers
    for (let t = 0; t < 4; t++) {
      const i = t * 2;
      b.fill(i, t * 3, i, 20 - i, t * 3 + 2, 20 - i, t === 3 ? cut : sand);
      // decorative stripe
      for (let x = i; x <= 20 - i; x++) {
        b.set(x, t * 3 + 1, i, (x + t) % 4 === 0 ? blue : orange);
        b.set(x, t * 3 + 1, 20 - i, (x + t) % 4 === 0 ? blue : orange);
      }
      for (let z = i; z <= 20 - i; z++) {
        b.set(i, t * 3 + 1, z, (z + t) % 4 === 0 ? blue : orange);
        b.set(20 - i, t * 3 + 1, z, (z + t) % 4 === 0 ? blue : orange);
      }
    }
    // Hollow hall inside the first two tiers
    b.fill(3, 1, 3, 17, 5, 17, 0);
    b.fill(3, 0, 3, 17, 0, 17, smooth);
    // Entrance corridor on the north face
    b.fill(9, 1, 0, 11, 4, 3, 0);
    b.set(10, 5, 0, S('chiseled_sandstone'));
    // Pillars
    for (const [x, z] of [
      [6, 6],
      [14, 6],
      [6, 14],
      [14, 14],
    ] as const)
      b.fill(x, 1, z, x, 5, z, cut);
    // Treasure pit under a blue/orange floor mosaic
    for (let z = 8; z <= 12; z++) for (let x = 8; x <= 12; x++) b.set(x, 0, z, (x + z) % 2 === 0 ? orange : blue);
    b.set(10, 0, 10, blue);
    b.fill(9, -12, 9, 11, -1, 11, 0);
    b.fill(8, -13, 8, 12, -13, 12, sand);
    // Chests in alcoves at the bottom
    b.set(10, -12, 8, 0);
    b.chest(10, -12, 8, 'south', 'chest/desert_temple', lootSeed(b, 10, -12, 8, seed));
    b.chest(10, -12, 12, 'north', 'chest/desert_temple', lootSeed(b, 10, -12, 12, seed));
    b.chest(8, -12, 10, 'east', 'chest/desert_temple', lootSeed(b, 8, -12, 10, seed));
    b.chest(12, -12, 10, 'west', 'chest/desert_temple', lootSeed(b, 12, -12, 10, seed));
    // Trap: pressure plate over TNT
    b.set(10, -12, 10, S('stone_pressure_plate'));
    b.fill(9, -14, 9, 11, -14, 11, S('tnt'));
    // Torches of the hall
    b.set(10, 4, 17, stateOf('wall_torch', { facing: 'north' }));
    void rng;
  },
});

// ---------------------------------------------------------------------------
// Jungle temple: mossy three-level shrine
// ---------------------------------------------------------------------------
export const JUNGLE_TEMPLE = single({
  id: 'jungle_temple',
  spacing: 32,
  separation: 8,
  salt: 0x1a91e,
  sx: 13,
  sz: 15,
  height: 14,
  below: 6,
  y: 'surface',
  biome: cat('jungle'),
  maxSlope: 10,
  build(b, rng, seed) {
    const cob = (): number => weathered(rng, 'cobblestone', undefined, 'mossy_cobblestone', 0.7);
    for (let z = 0; z < 15; z++) for (let x = 0; x < 13; x++) b.foundation(x, z, -1, S('mossy_cobblestone'), 20);
    b.clearAbove(0, 0, 12, 14, 0, 13);
    // Lower hall
    for (let y = -4; y <= 3; y++)
      for (let z = 0; z < 15; z++)
        for (let x = 0; x < 13; x++) {
          const edge = x === 0 || x === 12 || z === 0 || z === 14 || y === -4 || y === 3;
          b.set(x, y, z, edge ? cob() : 0);
        }
    // Upper tier
    for (let y = 4; y <= 8; y++)
      for (let z = 2; z < 13; z++)
        for (let x = 2; x < 11; x++) {
          const edge = x === 2 || x === 10 || z === 2 || z === 12 || y === 8;
          b.set(x, y, z, edge ? cob() : 0);
        }
    b.fill(4, 9, 4, 8, 9, 10, S('mossy_cobblestone'));
    b.fill(5, 10, 6, 7, 10, 8, S('chiseled_stone_bricks'));
    // Entrance & stairs down
    b.fill(5, 0, 0, 7, 2, 0, 0);
    for (let i = 0; i < 4; i++) b.fill(5, -i - 1, 1 + i, 7, -i - 1, 1 + i, stateOf('cobblestone_stairs', { facing: 'north' }));
    for (let i = 0; i < 4; i++) b.fill(5, -i, 1 + i, 7, 2, 1 + i, 0);
    // Treasure
    b.chest(1, -3, 13, 'north', 'chest/jungle_temple', lootSeed(b, 1, -3, 13, seed));
    b.chest(11, -3, 13, 'north', 'chest/jungle_temple', lootSeed(b, 11, -3, 13, seed));
    b.set(6, -3, 12, S('chiseled_stone_bricks'));
    // Vines outside
    for (let z = 0; z < 15; z += 3) for (let y = 0; y < 3; y++) if (rng.chance(0.5)) b.set(-1 + 0, y + 4, z, stateOf('vine', { east: true }));
  },
});

// ---------------------------------------------------------------------------
// Witch hut on stilts
// ---------------------------------------------------------------------------
export const WITCH_HUT = single({
  id: 'witch_hut',
  spacing: 32,
  separation: 8,
  salt: 0x3171c4,
  sx: 7,
  sz: 9,
  height: 9,
  below: 8,
  y: 'surface',
  biome: ids('swamp'),
  maxSlope: 6,
  build(b) {
    const planks = S('spruce_planks');
    const y0 = 3;
    for (const [x, z] of [
      [1, 2],
      [5, 2],
      [1, 7],
      [5, 7],
    ] as const) {
      b.foundation(x, z, y0 - 1, stateOf('oak_log', { axis: 'y' }), 12);
    }
    b.fill(0, y0, 1, 6, y0, 8, planks);
    b.fill(1, y0 + 1, 2, 5, y0 + 3, 7, planks);
    b.fill(2, y0 + 1, 3, 4, y0 + 3, 6, 0);
    b.fill(3, y0 + 1, 2, 3, y0 + 2, 2, 0);
    b.set(1, y0 + 2, 4, S('glass_pane'));
    b.set(5, y0 + 2, 4, S('glass_pane'));
    b.fill(0, y0 + 4, 1, 6, y0 + 4, 8, S('spruce_slab'));
    b.set(4, y0 + 1, 6, S('cauldron'));
    b.set(2, y0 + 1, 6, S('crafting_table'));
    b.set(2, y0 + 1, 3, S('flower_pot'));
    b.fill(1, y0 + 1, 0, 5, y0 + 1, 0, S('oak_fence'));
  },
  entities: (x, y, z) => [
    { type: 'witch', x, y: y + 4, z },
    { type: 'cat', x, y: y + 4, z, data: { variant: 'black' } },
  ],
});

// ---------------------------------------------------------------------------
// Igloo with an optional hidden basement
// ---------------------------------------------------------------------------
export const IGLOO = single({
  id: 'igloo',
  spacing: 32,
  separation: 8,
  salt: 0x1910,
  sx: 7,
  sz: 7,
  height: 6,
  below: 12,
  y: 'surface',
  biome: ids('snowy_plains', 'snowy_taiga', 'ice_spikes'),
  maxSlope: 4,
  build(b, rng, seed) {
    const snow = S('snow_block');
    for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) b.foundation(x, z, -1, snow, 8);
    b.clearAbove(0, 0, 6, 6, 0, 5);
    for (let y = 0; y <= 4; y++)
      for (let z = 0; z < 7; z++)
        for (let x = 0; x < 7; x++) {
          const dx = x - 3;
          const dz = z - 3;
          const d = Math.sqrt(dx * dx + dz * dz + (y * 0.9) ** 2);
          if (d < 3.6 && d >= 2.6) b.set(x, y, z, snow);
        }
    b.fill(1, 0, 1, 5, 0, 5, snow);
    b.fill(3, 1, 0, 3, 2, 1, 0);
    b.set(0, 2, 3, S('ice'));
    b.set(6, 2, 3, S('ice'));
    b.set(2, 1, 4, stateOf('red_bed', { facing: 'south', part: 'foot' }));
    b.set(2, 1, 5, stateOf('red_bed', { facing: 'south', part: 'head' }));
    b.set(4, 1, 5, stateOf('furnace', { facing: 'north' }));
    b.set(5, 1, 4, S('crafting_table'));
    b.set(4, 3, 4, S('torch'));
    if (rng.chance(0.5)) {
      // Basement reached through a trapdoor under a carpet
      b.set(3, 0, 3, stateOf('oak_trapdoor', { facing: 'north' }));
      for (let y = -1; y >= -7; y--) {
        b.set(3, y, 3, stateOf('ladder', { facing: 'south' }));
        b.set(3, y, 2, S('stone_bricks'));
      }
      b.box(0, -11, 1, 6, -7, 7, S('stone_bricks'), 0);
      b.set(3, -7, 3, stateOf('ladder', { facing: 'south' }));
      b.set(3, -8, 3, 0);
      b.chest(1, -10, 6, 'north', 'chest/igloo', lootSeed(b, 1, -10, 6, seed));
      b.set(5, -10, 6, S('brewing_stand'));
      b.set(3, -10, 6, S('cobweb'));
      b.set(3, -8, 6, stateOf('wall_torch', { facing: 'north' }));
    }
  },
});

// ---------------------------------------------------------------------------
// Ruined nether portal
// ---------------------------------------------------------------------------
export const RUINED_PORTAL = single({
  id: 'ruined_portal',
  spacing: 26,
  separation: 8,
  salt: 0x9a4a1,
  sx: 9,
  sz: 9,
  height: 9,
  below: 3,
  y: 'surface',
  biome: (b) => b.dimension === 'overworld' && !b.id.includes('ocean'),
  maxSlope: 8,
  build(b, rng, seed) {
    const obs = S('obsidian');
    const cry = S('crying_obsidian');
    const nr = S('netherrack');
    // Scorched ground
    for (let z = 0; z < 9; z++)
      for (let x = 0; x < 9; x++) {
        const d = Math.hypot(x - 4, z - 4);
        if (d > 4.5) continue;
        if (rng.chance(0.7)) b.set(x, -1, z, rng.chance(0.15) ? S('magma_block') : nr);
        if (rng.chance(0.1)) b.set(x, 0, z, S('netherrack'));
      }
    // Broken frame: 4 wide, 5 tall, standing along X at z = 4
    const frame: [number, number][] = [];
    for (let x = 2; x <= 5; x++) frame.push([x, 0], [x, 4]);
    for (let y = 1; y <= 3; y++) frame.push([2, y], [5, y]);
    for (const [x, y] of frame) {
      if (rng.chance(0.25)) {
        // Fallen piece
        if (rng.chance(0.5)) b.set(x + rng.int(3) - 1, 0, 4 + (rng.chance(0.5) ? 2 : -2), obs);
        continue;
      }
      b.set(x, y, 4, rng.chance(0.15) ? cry : obs);
    }
    b.set(1, 0, 6, S('gold_block'));
    b.chest(6, 0, 6, 'west', 'chest/ruined_portal', lootSeed(b, 6, 0, 6, seed));
    for (let i = 0; i < 4; i++) {
      const x = rng.int(9);
      const z = rng.int(9);
      if (b.get(x, 0, z) === 0) b.set(x, 0, z, rng.chance(0.3) ? S('fire') : S('netherrack'));
    }
  },
});

// ---------------------------------------------------------------------------
// Ocean: shipwrecks, ruins, buried treasure
// ---------------------------------------------------------------------------
export const SHIPWRECK = single({
  id: 'shipwreck',
  spacing: 24,
  separation: 4,
  salt: 0x5419,
  sx: 7,
  sz: 16,
  height: 9,
  below: 2,
  y: 'seafloor',
  biome: (b) => b.category === 'ocean' || b.id.endsWith('ocean'),
  build(b, rng, seed) {
    const wood = rng.chance(0.5) ? 'oak' : 'spruce';
    const planks = S(wood + '_planks');
    const log = (axis: string): number => stateOf(wood + '_log', { axis });
    // Hull
    for (let z = 0; z < 16; z++) {
      const w = z < 3 ? z : z > 12 ? 15 - z + 0 : 3;
      for (let x = 3 - w; x <= 3 + w; x++) {
        if (rng.chance(0.12)) continue;
        b.set(x, 0, z, planks);
        if (x === 3 - w || x === 3 + w) {
          b.set(x, 1, z, planks);
          if (z > 2 && z < 13) b.set(x, 2, z, rng.chance(0.8) ? planks : 0);
        }
      }
      b.set(3, -1, z, log('z'));
    }
    // Deck and mast
    b.fill(1, 3, 4, 5, 3, 11, S(wood + '_slab'));
    for (let y = 1; y < 8; y++) if (y < 5 || rng.chance(0.5)) b.set(3, y, 8, log('y'));
    b.fill(1, 1, 5, 5, 2, 10, 0);
    b.chest(3, 1, 13, 'north', 'chest/shipwreck', lootSeed(b, 3, 1, 13, seed));
    b.chest(2, 1, 5, 'east', 'chest/shipwreck', lootSeed(b, 2, 1, 5, seed));
    if (rng.chance(0.5)) b.chest(4, 1, 10, 'west', 'chest/shipwreck', lootSeed(b, 4, 1, 10, seed));
  },
});

export const OCEAN_RUIN = single({
  id: 'ocean_ruin',
  spacing: 20,
  separation: 4,
  salt: 0x0ce2,
  sx: 8,
  sz: 8,
  height: 7,
  below: 2,
  y: 'seafloor',
  biome: (b) => b.id.endsWith('ocean'),
  build(b, rng, seed) {
    const brick = (): number => weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.6);
    b.fill(0, -1, 0, 7, -1, 7, S('gravel'));
    for (let y = 0; y < 5; y++)
      for (let z = 0; z < 8; z++)
        for (let x = 0; x < 8; x++) {
          const wall = x === 0 || x === 7 || z === 0 || z === 7;
          if (!wall || rng.chance(0.25 + y * 0.12)) continue;
          b.set(x, y, z, brick());
        }
    b.fill(2, 0, 2, 5, 0, 5, S('prismarine_bricks'));
    b.chest(4, 1, 4, 'north', 'chest/ocean_ruin', lootSeed(b, 4, 1, 4, seed));
    b.set(3, 1, 3, S('magma_block'));
  },
  entities: (x, y, z) => [{ type: 'drowned', x, y: y + 1, z }],
});

export const BURIED_TREASURE = single({
  id: 'buried_treasure',
  spacing: 12,
  separation: 2,
  salt: 0x7a3a,
  sx: 1,
  sz: 1,
  height: 1,
  below: 2,
  y: 'buried',
  chance: 0.25,
  biome: (b) => b.category === 'beach' || b.id === 'beach' || b.id === 'snowy_beach',
  build(b, rng, seed) {
    b.set(0, -1, 0, S('sandstone'));
    b.chest(0, 0, 0, 'north', 'chest/buried_treasure', lootSeed(b, 0, 0, 0, seed));
    void rng;
  },
});

// ---------------------------------------------------------------------------
// Pillager outpost
// ---------------------------------------------------------------------------
export const OUTPOST = single({
  id: 'pillager_outpost',
  spacing: 40,
  separation: 10,
  salt: 0x0b705,
  sx: 11,
  sz: 11,
  height: 24,
  below: 8,
  y: 'surface',
  chance: 0.6,
  biome: (b) => ['plains', 'desert', 'savanna', 'taiga'].includes(b.category) || b.id === 'snowy_plains' || b.id === 'meadow' || b.id === 'grove',
  build(b, rng, seed) {
    const log = stateOf('dark_oak_log', { axis: 'y' });
    const planks = S('birch_planks');
    const dark = S('dark_oak_planks');
    for (let z = 2; z <= 8; z++) for (let x = 2; x <= 8; x++) b.foundation(x, z, -1, S('cobblestone'), 12);
    b.clearAbove(1, 1, 9, 9, 0, 22);
    for (let lvl = 0; lvl < 3; lvl++) {
      const y0 = lvl * 6;
      for (let y = y0; y < y0 + 5; y++)
        for (let z = 2; z <= 8; z++)
          for (let x = 2; x <= 8; x++) {
            const corner = (x === 2 || x === 8) && (z === 2 || z === 8);
            const edge = x === 2 || x === 8 || z === 2 || z === 8;
            if (corner) b.set(x, y, z, log);
            else if (edge) b.set(x, y, z, (y - y0) % 4 === 2 && (x === 5 || z === 5) ? 0 : dark);
          }
      b.fill(3, y0 + 5, 3, 7, y0 + 5, 7, planks);
      // Ladder up the inside
      for (let y = y0; y < y0 + 6; y++) b.set(5, y, 7, stateOf('ladder', { facing: 'north' }));
    }
    b.fill(1, 18, 1, 9, 18, 9, dark);
    for (let x = 1; x <= 9; x++) {
      b.set(x, 19, 1, S('dark_oak_fence'));
      b.set(x, 19, 9, S('dark_oak_fence'));
    }
    for (let z = 1; z <= 9; z++) {
      b.set(1, 19, z, S('dark_oak_fence'));
      b.set(9, 19, z, S('dark_oak_fence'));
    }
    b.fill(3, 20, 3, 7, 20, 7, S('dark_oak_slab'));
    b.set(5, 0, 2, 0);
    b.set(5, 1, 2, 0);
    b.chest(3, 19, 3, 'south', 'chest/pillager_outpost', lootSeed(b, 3, 19, 3, seed));
    b.set(7, 19, 7, S('torch'));
    void rng;
  },
  entities: (x, y, z, rng) => Array.from({ length: 2 + rng.int(3) }, (_, i) => ({ type: 'pillager', x: x + (i % 2), y: y + 19, z })),
});

// ---------------------------------------------------------------------------
// Original MineHonk structures
// ---------------------------------------------------------------------------
/** A floating island crowned by a white shrine. Sky rays circle it. */
export const SKY_SHRINE = single({
  id: 'sky_shrine',
  spacing: 36,
  separation: 10,
  salt: 0x5c1,
  sx: 15,
  sz: 15,
  height: 12,
  below: 10,
  y: 'sky',
  biome: (b) => b.category === 'mountain' || b.id === 'windswept_hills' || b.id === 'meadow',
  build(b, rng, seed) {
    const stone = S('stone');
    // Inverted cone island
    for (let y = -9; y <= 0; y++) {
      const r = 7 * (1 - (-y / 10) ** 1.5);
      for (let z = 0; z < 15; z++)
        for (let x = 0; x < 15; x++) {
          const d = Math.hypot(x - 7, z - 7) + ((hashInts(seed, x, y, z) & 7) / 7) * 0.8;
          if (d > r) continue;
          b.set(x, y, z, y === 0 ? S('grass_block') : y > -3 ? S('dirt') : rng.chance(0.06) ? S('sunstone_ore') : stone);
        }
    }
    // Shrine: quartz floor, pillars and a slab roof
    b.fill(4, 1, 4, 10, 1, 10, S('smooth_quartz'));
    for (const [x, z] of [
      [4, 4],
      [10, 4],
      [4, 10],
      [10, 10],
    ] as const)
      b.fill(x, 2, z, x, 5, z, stateOf('quartz_pillar', { axis: 'y' }));
    b.fill(3, 6, 3, 11, 6, 11, S('quartz_block_slab'));
    b.fill(5, 7, 5, 9, 7, 9, S('quartz_block'));
    b.set(7, 8, 7, S('end_rod'));
    b.chest(7, 2, 7, 'north', 'chest/sky_shrine', lootSeed(b, 7, 2, 7, seed));
    b.set(7, 5, 7, stateOf('lantern', { hanging: true }));
    // Flowers on the rim
    for (let i = 0; i < 10; i++) {
      const x = rng.int(15);
      const z = rng.int(15);
      if (b.get(x, 0, z) === S('grass_block') && b.get(x, 1, z) === 0) b.set(x, 1, z, S(['dandelion', 'azure_bluet', 'allium', 'glowbell'][rng.int(4)]!));
    }
  },
  entities: (x, y, z) => [
    { type: 'sky_ray', x, y: y + 6, z },
    { type: 'sky_ray', x: x + 4, y: y + 8, z: z - 3 },
  ],
});

/** Moss-covered ruins of an old watchtower in forests and jungles. */
export const OVERGROWN_RUIN = single({
  id: 'overgrown_ruin',
  spacing: 24,
  separation: 6,
  salt: 0x0f94,
  sx: 11,
  sz: 11,
  height: 9,
  below: 4,
  y: 'surface',
  biome: (b) => b.category === 'forest' || b.category === 'jungle' || b.id === 'dark_forest',
  maxSlope: 7,
  build(b, rng, seed) {
    const brick = (): number => weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.8);
    for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) if (Math.hypot(x - 5, z - 5) < 5.5) b.foundation(x, z, -1, S('mossy_cobblestone'), 6);
    for (let y = 0; y < 8; y++)
      for (let z = 0; z < 11; z++)
        for (let x = 0; x < 11; x++) {
          const d = Math.hypot(x - 5, z - 5);
          if (d < 4.3 || d > 5.3) continue;
          const decay = y / 8 + ((hashInts(seed, x, y, z) & 15) / 15) * 0.6;
          if (decay > 0.9) continue;
          b.set(x, y, z, brick());
          if (rng.chance(0.15) && y > 1) b.set(x + (x > 5 ? 1 : -1), y, z, stateOf('vine', { [x > 5 ? 'west' : 'east']: true }));
        }
    b.fill(3, -1, 3, 7, -1, 7, S('mossy_stone_bricks'));
    b.fill(4, 0, 4, 6, 3, 6, 0);
    b.chest(5, 0, 5, 'north', 'chest/overgrown_ruin', lootSeed(b, 5, 0, 5, seed));
    b.set(5, 0, 2, S('moss_carpet'));
    b.set(3, 0, 5, S('glowbell'));
  },
});

/** A bone-littered cave den guarded by a Cave Stalker spawner. */
export const STALKER_DEN = single({
  id: 'stalker_den',
  spacing: 20,
  separation: 5,
  salt: 0x57a1,
  sx: 11,
  sz: 11,
  height: 7,
  below: 1,
  y: 'underground',
  biome: (b) => b.dimension === 'overworld',
  build(b, rng, seed) {
    for (let y = 0; y < 7; y++)
      for (let z = 0; z < 11; z++)
        for (let x = 0; x < 11; x++) {
          const d = Math.sqrt((x - 5) ** 2 + ((y - 2) * 1.6) ** 2 + (z - 5) ** 2);
          if (d < 5) b.set(x, y, z, S('cave_air'));
          else if (d < 6 && STATE_SOLID[b.proto(x, y, z)]) b.set(x, y, z, rng.chance(0.3) ? S('cobbled_deepslate') : S('deepslate'));
        }
    for (let z = 1; z < 10; z++)
      for (let x = 1; x < 10; x++) {
        if (b.get(x, 0, z) !== S('cave_air')) continue;
        b.set(x, -1, z, S('mud'));
        if (rng.chance(0.08)) b.set(x, 0, z, stateOf('bone_block', { axis: rng.chance(0.5) ? 'x' : 'z' }));
        else if (rng.chance(0.05)) b.set(x, 0, z, S('cobweb'));
      }
    b.spawner(5, 0, 5, 'cave_stalker');
    b.chest(2, 0, 5, 'east', 'chest/stalker_den', lootSeed(b, 2, 0, 5, seed));
    b.set(8, 0, 5, S('soul_torch'));
  },
});

/**
 * The glitched ruin: a rare, half-corrupted structure that holds a dormant
 * gateway frame to the Farlands. Corrupted blocks bleed into the terrain.
 */
export const GLITCHED_RUIN = single({
  id: 'glitched_ruin',
  spacing: 72,
  separation: 16,
  salt: 0x6117c4,
  sx: 13,
  sz: 13,
  height: 12,
  below: 4,
  y: 'surface',
  biome: (b) => b.dimension === 'overworld' && !b.id.includes('ocean') && b.id !== 'river',
  maxSlope: 10,
  build(b, rng, seed) {
    const corrupted = S('corrupted_stone');
    const farstone = S('farstone_bricks');
    const stat = S('static_block');
    // Corruption patch spreading into the ground
    for (let z = -2; z < 15; z++)
      for (let x = -2; x < 15; x++) {
        const d = Math.hypot(x - 6, z - 6);
        const n = (hashInts(seed, x, z) & 255) / 255;
        if (d > 7 + n * 2) continue;
        for (let y = -3; y <= 0; y++) if (STATE_SOLID[b.proto(x, y - 1, z)] && !STATE_FLUID[b.proto(x, y - 1, z)] && n < 0.8) b.set(x, y - 1, z, n < 0.15 ? stat : corrupted);
      }
    b.clearAbove(1, 1, 11, 11, 0, 11);
    // Platform
    b.fill(2, -1, 2, 10, -1, 10, farstone);
    // Floating, misaligned fragments
    for (let i = 0; i < 9; i++) {
      const x = rng.int(13);
      const z = rng.int(13);
      const y = 3 + rng.int(7);
      b.fill(x, y, z, x + rng.int(2), y, z + rng.int(2), rng.chance(0.3) ? stat : corrupted);
    }
    // Dormant gateway frame (activated with a Corrupted Eye)
    const frame = S('far_portal_frame');
    for (let x = 4; x <= 8; x++) {
      b.set(x, 0, 6, frame);
      b.set(x, 6, 6, frame);
    }
    for (let y = 1; y <= 5; y++) {
      b.set(4, y, 6, frame);
      b.set(8, y, 6, frame);
    }
    b.set(4, 7, 6, S('data_crystal'));
    b.set(8, 7, 6, S('data_crystal'));
    b.chest(6, 0, 9, 'north', 'chest/farlands_ruin', lootSeed(b, 6, 0, 9, seed));
    b.set(2, 0, 2, S('glitch_ore'));
  },
  entities: (x, y, z) => [{ type: 'farlands_wanderer', x: x + 3, y, z: z + 3 }],
});

export const SURFACE_STRUCTURES: StructureType[] = [DESERT_TEMPLE, JUNGLE_TEMPLE, WITCH_HUT, IGLOO, RUINED_PORTAL, SHIPWRECK, OCEAN_RUIN, BURIED_TREASURE, OUTPOST, SKY_SHRINE, OVERGROWN_RUIN, STALKER_DEN, GLITCHED_RUIN];
