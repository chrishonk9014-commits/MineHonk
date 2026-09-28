/**
 * V2 underground structures: ruins, buried temples, hidden chambers behind
 * secret tunnels, sealed treasure rooms, abandoned laboratories, cave shrines
 * and monster chambers. All are single pieces embedded in the rock; caves
 * that cut through them make them discoverable, the rest reward digging.
 */
import { stateOf } from '../../registry/blocks';
import type { Biome } from '../../registry/biomes';
import { Builder, S, weathered } from './builder';
import { single, lootSeed } from './misc';
import type { Random } from '../../math/rng';
import type { StructureType } from './manager';

const overworld = (b: Biome): boolean => b.dimension === 'overworld';

/** Fills a room's inside with cave air (so it reads as underground, dark). */
function hollow(b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  b.fill(x0, y0, z0, x1, y1, z1, S('cave_air'));
}

function cobwebs(b: Builder, rng: Random, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, chance: number): void {
  const air = S('cave_air');
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (rng.chance(chance) && b.get(x, y, z) === air) b.set(x, y, z, S('cobweb'));
}

// ---------------------------------------------------------------------------
// Underground ruins: the broken hall of a buried settlement
// ---------------------------------------------------------------------------
export const UNDERGROUND_RUINS = single({
  id: 'underground_ruins',
  spacing: 14,
  separation: 4,
  salt: 0x7c01,
  sx: 13,
  sz: 13,
  height: 8,
  below: 1,
  y: 'underground',
  minY: 16,
  maxY: 50,
  biome: overworld,
  build(b, rng, seed) {
    const brick = (): number => weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.45);
    hollow(b, 0, 1, 0, 12, 7, 12);
    // Cracked floor
    for (let z = 0; z < 13; z++) for (let x = 0; x < 13; x++) if (!rng.chance(0.12)) b.set(x, 0, z, brick());
    // Walls standing to different heights, with gaps
    for (let i = 0; i < 13; i++) {
      for (const [x, z] of [
        [i, 0],
        [i, 12],
        [0, i],
        [12, i],
      ] as const) {
        const h = rng.chance(0.2) ? 0 : 1 + rng.int(5);
        for (let y = 1; y <= h; y++) b.set(x, y, z, brick());
      }
    }
    // Corner pillars and a broken ceiling
    for (const [x, z] of [
      [0, 0],
      [12, 0],
      [0, 12],
      [12, 12],
      [4, 4],
      [8, 4],
      [4, 8],
      [8, 8],
    ] as const) {
      const h = 3 + rng.int(4);
      for (let y = 1; y <= h; y++) b.set(x, y, z, y === h ? S('chiseled_stone_bricks') : brick());
    }
    for (let z = 2; z < 11; z++) for (let x = 2; x < 11; x++) if (rng.chance(0.3)) b.set(x, 7, z, stateOf('stone_bricks_slab', { type: 'top' }));
    // Altar with a candle and the hall's chest
    b.set(6, 1, 6, S('chiseled_stone_bricks'));
    b.set(6, 2, 6, stateOf('candle', { candles: String(1 + rng.int(3)) }));
    b.chest(6, 1, 7, 'south', 'chest/underground_ruins', lootSeed(b, 6, 1, 7, seed));
    if (rng.chance(0.5)) b.chest(2, 1, 10, 'east', 'chest/underground_ruins', lootSeed(b, 2, 1, 10, seed));
    // Hanging lanterns, moss and cobwebs
    for (const [x, z] of [
      [3, 3],
      [9, 9],
    ] as const) {
      b.set(x, 7, z, S('stone_bricks'));
      b.set(x, 6, z, S('chain'));
      b.set(x, 5, z, stateOf('lantern', { hanging: true }));
    }
    for (let z = 1; z < 12; z++) for (let x = 1; x < 12; x++) if (rng.chance(0.08) && b.get(x, 1, z) === S('cave_air')) b.set(x, 1, z, S('moss_carpet'));
    cobwebs(b, rng, 1, 3, 1, 11, 6, 11, 0.03);
  },
});

// ---------------------------------------------------------------------------
// Buried temple: a deepslate nave of pillars leading to a tiered altar
// ---------------------------------------------------------------------------
export const BURIED_TEMPLE = single({
  id: 'buried_temple',
  spacing: 22,
  separation: 6,
  salt: 0x7c02,
  sx: 15,
  sz: 19,
  height: 11,
  below: 1,
  y: 'underground',
  minY: 14,
  maxY: 40,
  biome: overworld,
  build(b, rng, seed) {
    const bricks = (): number => weathered(rng, 'deepslate_bricks', 'cracked_deepslate_bricks', undefined, 0.2);
    // Shell
    b.box(0, 0, 0, 14, 10, 18, S('polished_deepslate'), S('cave_air'));
    for (let z = 1; z < 18; z++) for (let x = 1; x < 14; x++) b.set(x, 0, z, (x + z) % 4 === 0 ? S('chiseled_deepslate') : S('deepslate_tiles'));
    // Murals: tile bands along the walls, broken in places
    for (let z = 1; z < 18; z++)
      for (const x of [0, 14]) {
        b.set(x, 3, z, S('deepslate_tiles'));
        b.set(x, 6, z, z % 3 === 0 ? S('chiseled_deepslate') : S('deepslate_tiles'));
        if (rng.chance(0.15)) b.set(x, 4, z, bricks());
      }
    // Entrance on the north side
    b.fill(6, 1, 0, 8, 4, 0, S('cave_air'));
    b.set(5, 5, 0, S('chiseled_deepslate'));
    b.set(9, 5, 0, S('chiseled_deepslate'));
    // Nave pillars with soul lanterns
    for (let z = 3; z <= 12; z += 3) {
      for (const x of [3, 11]) {
        for (let y = 1; y < 10; y++) b.set(x, y, z, bricks());
        b.set(x, 5, z + (z < 12 ? 1 : -1), stateOf('soul_lantern', { hanging: false }));
      }
    }
    // Tiered altar
    b.fill(4, 1, 14, 10, 1, 17, S('polished_deepslate'));
    b.fill(5, 2, 15, 9, 2, 17, S('deepslate_tiles'));
    b.fill(6, 3, 16, 8, 3, 17, S('chiseled_deepslate'));
    b.chest(7, 4, 16, 'north', 'chest/buried_temple', lootSeed(b, 7, 4, 16, seed));
    b.set(6, 4, 16, stateOf('candle', { candles: '3' }));
    b.set(8, 4, 16, stateOf('candle', { candles: '2' }));
    // Hidden side chambers behind cracked bricks
    for (const x of [1, 12]) {
      b.fill(x, 1, 6, x + 1, 2, 8, S('cave_air'));
      b.set(x === 1 ? 2 : 12, 1, 7, S('cracked_deepslate_bricks'));
      b.set(x === 1 ? 2 : 12, 2, 7, S('cracked_deepslate_bricks'));
      if (rng.chance(0.6)) b.chest(x === 1 ? 1 : 13, 1, 7, x === 1 ? 'east' : 'west', 'chest/buried_temple', lootSeed(b, x, 1, 7, seed));
    }
    b.spawner(7, 1, 9, rng.chance(0.5) ? 'skeleton' : 'zombie');
    cobwebs(b, rng, 1, 6, 1, 13, 9, 17, 0.04);
  },
});

// ---------------------------------------------------------------------------
// Hidden chamber at the end of a narrow secret tunnel
// ---------------------------------------------------------------------------
export const HIDDEN_CHAMBER = single({
  id: 'hidden_chamber',
  spacing: 12,
  separation: 3,
  salt: 0x7c03,
  sx: 9,
  sz: 24,
  height: 5,
  below: 1,
  y: 'underground',
  minY: 12,
  maxY: 54,
  biome: overworld,
  build(b, rng, seed) {
    // The tunnel wanders a little on its way in
    let x = 4;
    for (let z = 0; z < 15; z++) {
      if (z > 2 && z < 13 && rng.chance(0.25)) x = Math.max(2, Math.min(6, x + (rng.chance(0.5) ? 1 : -1)));
      b.set(x, 0, z, S('cobbled_deepslate'));
      b.set(x, 1, z, S('cave_air'));
      b.set(x, 2, z, S('cave_air'));
      b.set(x, 3, z, S('cobbled_deepslate'));
      if (z % 5 === 4) b.set(x, 2, z, stateOf('soul_torch', {}));
    }
    // A cracked wall hides the room
    b.set(x, 1, 15, S('cracked_stone_bricks'));
    b.set(x, 2, 15, S('cracked_stone_bricks'));
    b.box(0, 0, 16, 8, 4, 23, S('polished_andesite'), S('cave_air'));
    b.set(x, 1, 16, S('cave_air'));
    b.set(x, 2, 16, S('cave_air'));
    b.chest(4, 1, 22, 'north', 'chest/hidden_chamber', lootSeed(b, 4, 1, 22, seed));
    b.set(2, 1, 22, S('barrel'));
    b.set(6, 1, 22, S('bookshelf'));
    b.set(7, 1, 22, S('bookshelf'));
    b.set(1, 1, 18, S('crafting_table'));
    b.set(4, 3, 19, stateOf('lantern', { hanging: true }));
    b.set(4, 4, 19, S('polished_andesite'));
  },
});

// ---------------------------------------------------------------------------
// Treasure room: a sealed gold-trimmed vault, deep and rare
// ---------------------------------------------------------------------------
export const TREASURE_ROOM = single({
  id: 'treasure_room',
  spacing: 34,
  separation: 8,
  salt: 0x7c04,
  sx: 9,
  sz: 9,
  height: 6,
  below: 1,
  y: 'underground',
  minY: 8,
  maxY: 26,
  biome: overworld,
  build(b, rng, seed) {
    b.box(0, 0, 0, 8, 5, 8, S('polished_blackstone_bricks'), S('cave_air'));
    for (let z = 1; z < 8; z++) for (let x = 1; x < 8; x++) b.set(x, 0, z, (x + z) % 2 ? S('gilded_blackstone') : S('polished_blackstone_bricks'));
    for (const [x, z] of [
      [1, 1],
      [7, 1],
      [1, 7],
      [7, 7],
    ] as const)
      for (let y = 1; y < 5; y++) b.set(x, y, z, y === 4 ? S('gold_block') : S('chiseled_deepslate'));
    b.set(4, 1, 4, S('gold_block'));
    b.chest(4, 2, 4, 'south', 'chest/treasure_room', lootSeed(b, 4, 2, 4, seed));
    b.set(2, 1, 6, S('barrel'));
    b.set(6, 1, 6, S('barrel'));
    b.set(4, 4, 4, stateOf('soul_lantern', { hanging: true }));
    b.set(4, 5, 4, S('chain'));
    // One guard left behind
    b.spawner(4, 1, 2, rng.chance(0.5) ? 'cave_spider' : 'zombie');
  },
});

// ---------------------------------------------------------------------------
// Abandoned laboratory (original): someone studied the deep, then left
// ---------------------------------------------------------------------------
export const ABANDONED_LAB = single({
  id: 'abandoned_lab',
  spacing: 26,
  separation: 6,
  salt: 0x7c05,
  sx: 13,
  sz: 11,
  height: 7,
  below: 1,
  y: 'underground',
  minY: 18,
  maxY: 46,
  biome: overworld,
  build(b, rng, seed) {
    b.box(0, 0, 0, 12, 6, 10, S('smooth_stone'), S('cave_air'));
    for (let z = 1; z < 10; z++) for (let x = 1; x < 12; x++) b.set(x, 0, z, (x & 1) === (z & 1) ? S('polished_andesite') : S('smooth_stone'));
    // Observation windows, some shattered
    for (let x = 2; x < 11; x += 2) if (!rng.chance(0.3)) b.set(x, 3, 0, S('glass'));
    b.fill(5, 1, 0, 6, 2, 0, S('cave_air'));
    // Ceiling lights (long dead)
    for (let x = 3; x < 12; x += 4) b.set(x, 6, 5, S('redstone_lamp'));
    // Benches: brewing stands, cauldrons, a lever
    b.fill(1, 1, 8, 11, 1, 9, S('smooth_stone'));
    b.set(2, 2, 9, S('brewing_stand'));
    b.set(4, 2, 9, S('brewing_stand'));
    b.set(7, 2, 9, stateOf('cauldron', { level: String(rng.int(4)) }));
    b.set(9, 2, 9, S('crafting_table'));
    b.set(11, 1, 5, S('barrel'));
    b.set(11, 1, 4, S('bookshelf'));
    b.set(11, 2, 4, S('bookshelf'));
    // Specimen cages
    for (const x of [2, 5]) {
      b.fill(x, 1, 2, x + 1, 3, 3, S('iron_bars'));
      b.fill(x, 1, 2, x + 1, 2, 2, S('cave_air'));
      if (rng.chance(0.5)) b.set(x, 1, 2, S('cobweb'));
    }
    b.set(1, 1, 5, stateOf('anvil', { facing: 'north' }));
    b.chest(10, 2, 8, 'north', 'chest/abandoned_lab', lootSeed(b, 10, 2, 8, seed));
    if (rng.chance(0.5)) b.chest(1, 1, 7, 'east', 'chest/abandoned_lab', lootSeed(b, 1, 1, 7, seed));
    // Decay: holes in the walls and cobwebs
    for (let i = 0; i < 6; i++) b.set(rng.int(13), 1 + rng.int(5), rng.chance(0.5) ? 0 : 10, S('cave_air'));
    cobwebs(b, rng, 1, 3, 1, 11, 5, 9, 0.05);
  },
});

// ---------------------------------------------------------------------------
// Cave shrine: a small calcite and amethyst offering place
// ---------------------------------------------------------------------------
export const CAVE_SHRINE = single({
  id: 'cave_shrine',
  spacing: 16,
  separation: 4,
  salt: 0x7c06,
  sx: 7,
  sz: 7,
  height: 7,
  below: 1,
  y: 'underground',
  minY: 20,
  maxY: 56,
  biome: overworld,
  build(b, rng, seed) {
    hollow(b, 0, 1, 0, 6, 6, 6);
    b.fill(0, 0, 0, 6, 0, 6, S('calcite'));
    b.fill(1, 0, 1, 5, 0, 5, S('smooth_quartz'));
    for (const [x, z] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
    ] as const) {
      for (let y = 1; y < 5; y++) b.set(x, y, z, S('amethyst_block'));
      b.set(x, 5, z, S('lumen_crystal'));
    }
    b.set(3, 1, 3, S('chiseled_stone_bricks'));
    b.chest(3, 2, 3, 'south', 'chest/cave_shrine', lootSeed(b, 3, 2, 3, seed));
    for (const [x, z] of [
      [2, 2],
      [4, 2],
      [2, 4],
      [4, 4],
    ] as const)
      if (rng.chance(0.7)) b.set(x, 1, z, stateOf('candle', { candles: String(1 + rng.int(4)), lit: rng.chance(0.3) }));
  },
});

// ---------------------------------------------------------------------------
// Monster chamber: a bigger, nastier dungeon with two spawners
// ---------------------------------------------------------------------------
export const MONSTER_CHAMBER = single({
  id: 'monster_chamber',
  spacing: 18,
  separation: 4,
  salt: 0x7c07,
  sx: 11,
  sz: 11,
  height: 6,
  below: 1,
  y: 'underground',
  minY: 10,
  maxY: 40,
  biome: overworld,
  build(b, rng, seed) {
    const wall = (): number => (rng.chance(0.5) ? S('mossy_cobblestone') : S('cobbled_deepslate'));
    for (let y = 0; y <= 5; y++)
      for (let z = 0; z < 11; z++)
        for (let x = 0; x < 11; x++) {
          const edge = x === 0 || x === 10 || z === 0 || z === 10 || y === 0 || y === 5;
          b.set(x, y, z, edge ? wall() : S('cave_air'));
        }
    const mobs = ['zombie', 'skeleton', 'cave_spider', 'spider'];
    b.spawner(3, 1, 5, mobs[rng.int(mobs.length)]!);
    b.spawner(7, 1, 5, mobs[rng.int(mobs.length)]!);
    b.chest(5, 1, 1, 'south', 'chest/monster_chamber', lootSeed(b, 5, 1, 1, seed));
    b.chest(5, 1, 9, 'north', 'chest/monster_chamber', lootSeed(b, 5, 1, 9, seed));
    if (rng.chance(0.4)) b.chest(1, 1, 5, 'east', 'chest/monster_chamber', lootSeed(b, 1, 1, 5, seed));
    for (let i = 0; i < 5; i++) b.set(1 + rng.int(9), 1, 1 + rng.int(9), S('bone_block'));
    cobwebs(b, rng, 1, 2, 1, 9, 4, 9, 0.08);
    // Openings where the chamber meets the rock
    for (let i = 0; i < 3; i++) {
      const side = rng.int(4);
      const k = 3 + rng.int(5);
      const [x, z] = side === 0 ? [k, 0] : side === 1 ? [10, k] : side === 2 ? [k, 10] : [0, k];
      b.set(x, 1, z, S('cave_air'));
      b.set(x, 2, z, S('cave_air'));
    }
  },
});

/** The deep dark belongs to the Ancient Cities: other cave structures keep out of it. */
const outsideDeepDark = (t: StructureType): StructureType => ({
  ...t,
  candidate: (ctx, x, z, rng) => t.candidate(ctx, x, z, rng) && (ctx.deepDark?.(x, z) ?? -1) < 0.3,
});

export const CAVE_STRUCTURES: StructureType[] = [UNDERGROUND_RUINS, BURIED_TEMPLE, HIDDEN_CHAMBER, TREASURE_ROOM, ABANDONED_LAB, CAVE_SHRINE, MONSTER_CHAMBER].map(outsideDeepDark);
