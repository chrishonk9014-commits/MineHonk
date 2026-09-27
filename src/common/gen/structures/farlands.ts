/**
 * Farlands structures: data spires (twisted towers crowned with data
 * crystals) and buried vaults that hold the Farlands' best loot, guarded by
 * glitched spawners and sometimes a Glitch Beast.
 */
import { S } from '../../registry/blocks';
import { single, lootSeed } from './misc';
import type { StructureType } from './manager';

const farBiome = (b: { dimension: string }): boolean => b.dimension === 'farlands';

export const DATA_SPIRE = single({
  id: 'data_spire',
  spacing: 28,
  separation: 8,
  salt: 0xda7a5,
  sx: 9,
  sz: 9,
  height: 40,
  below: 3,
  y: 'surface',
  biome: (b) => farBiome(b) && b.id !== 'overflow_walls',
  maxSlope: 10,
  build(b, rng, seed) {
    const bricks = S('farstone_bricks');
    const glitch = S('glitch_block');
    const glass = S('fractal_glass');
    const lamp = S('echo_lamp');
    const floor = S('corrupted_stone');
    b.fill(0, -1, 0, 8, -1, 8, floor);
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) b.foundation(x, z, -2, S('farstone'), 8);
    const height = 22 + rng.int(14);
    let ox = 2;
    let oz = 2;
    for (let y = 0; y < height; y++) {
      // Every few levels the tower slips sideways, as if its coordinates overflowed
      if (y > 0 && y % 7 === 0) {
        ox = Math.max(0, Math.min(4, ox + rng.int(3) - 1));
        oz = Math.max(0, Math.min(4, oz + rng.int(3) - 1));
      }
      for (let x = 0; x < 5; x++)
        for (let z = 0; z < 5; z++) {
          const edge = x === 0 || x === 4 || z === 0 || z === 4;
          const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
          if (!edge) b.set(ox + x, y, oz + z, 0);
          else if (corner) b.set(ox + x, y, oz + z, rng.chance(0.15) ? glitch : bricks);
          else b.set(ox + x, y, oz + z, y % 4 === 2 && rng.chance(0.6) ? glass : bricks);
        }
      if (y % 6 === 3) b.set(ox + 2, y, oz + 2, lamp);
    }
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) b.set(ox + x, height, oz + z, bricks);
    b.set(ox + 2, height + 1, oz + 2, S('data_crystal'));
    b.set(ox + 1, height + 1, oz + 1, S('data_crystal'));
    b.set(ox + 3, height + 1, oz + 3, S('data_crystal'));
    // Doorway and the treasure at the base
    for (let y = 0; y < 3; y++) b.set(4, y, 2, 0);
    b.chest(4, 0, 4, 'north', 'chest/farlands_ruin', lootSeed(b, 4, 0, 4, seed));
  },
  entities: (x, y, z, rng) => (rng.chance(0.5) ? [{ type: 'rift_walker', x, y, z: z + 6 }] : []),
});

export const FAR_VAULT = single({
  id: 'farlands_vault',
  spacing: 36,
  separation: 10,
  salt: 0xfa0a17,
  sx: 11,
  sz: 11,
  height: 8,
  below: 1,
  y: 'underground',
  biome: farBiome,
  build(b, rng, seed) {
    const bricks = S('farstone_bricks');
    const glass = S('fractal_glass');
    const lamp = S('echo_lamp');
    const nullOre = S('null_ore');
    b.box(0, 0, 0, 10, 7, 10, bricks, 0);
    for (let x = 1; x < 10; x++) for (let z = 1; z < 10; z++) b.set(x, 0, z, (x + z) % 2 ? S('corrupted_stone') : bricks);
    for (const [x, z] of [
      [2, 2],
      [8, 2],
      [2, 8],
      [8, 8],
    ] as const) {
      for (let y = 1; y <= 6; y++) b.set(x, y, z, y === 3 ? lamp : bricks);
    }
    for (let i = 3; i <= 7; i += 2) {
      b.set(i, 3, 0, glass);
      b.set(i, 3, 10, glass);
      b.set(0, 3, i, glass);
      b.set(10, 3, i, glass);
    }
    if (rng.chance(0.5)) b.set(5, 7, 5, nullOre);
    b.spawner(5, 1, 5, rng.chance(0.5) ? 'glitch_zombie' : 'glitch_skeleton');
    b.chest(3, 1, 5, 'east', 'chest/farlands_vault', lootSeed(b, 3, 1, 5, seed));
    b.chest(7, 1, 5, 'west', 'chest/farlands_ruin', lootSeed(b, 7, 1, 5, seed));
  },
  entities: (x, y, z, rng) => (rng.chance(0.35) ? [{ type: 'glitch_beast', x, y, z: z + 2 }] : []),
});

export const FARLANDS_STRUCTURES: StructureType[] = [DATA_SPIRE, FAR_VAULT];
