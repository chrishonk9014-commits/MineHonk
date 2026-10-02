/**
 * V6 - The End Expansion, phase 2: where the Expanded End's mobs live.
 *
 * Each biome's spawn lists (merged into its biome definition, so the mob
 * system's natural spawning uses them like any other biome's), and the
 * extra limits the server holds them to: at most this many of a kind
 * around any one player, and the End Phantom's rarity. Vanilla Endermen
 * keep spawning everywhere in the Expanded End. Nothing here reaches the
 * central island or the outer islands: their biomes are untouched.
 */
import type { SpawnEntry } from '../data/biomes';

export const EXPANSION_MOBS = ['endling', 'void_stalker', 'chorus_beast', 'end_crystal_mite', 'end_phantom'] as const;
export type ExpansionMob = (typeof EXPANSION_MOBS)[number];
const MOB_SET = new Set<string>(EXPANSION_MOBS);

export function isExpansionMob(type: string): type is ExpansionMob {
  return MOB_SET.has(type);
}

const enderman: SpawnEntry = { mob: 'enderman', weight: 10, min: 1, max: 3 };

/** Natural spawns of each expansion biome. */
export const EXPANSION_SPAWNS: Readonly<Record<string, { creature: SpawnEntry[]; monster: SpawnEntry[] }>> = {
  end_barrens: { creature: [], monster: [{ mob: 'void_stalker', weight: 8, min: 1, max: 2 }, enderman] },
  shattered_end: { creature: [], monster: [{ mob: 'void_stalker', weight: 10, min: 1, max: 2 }, enderman] },
  astral_end: { creature: [], monster: [enderman, { mob: 'end_phantom', weight: 2, min: 1, max: 1 }] },
  highlands: { creature: [{ mob: 'endling', weight: 10, min: 2, max: 4 }], monster: [enderman] },
  end_crystal_fields: { creature: [], monster: [{ mob: 'end_crystal_mite', weight: 4, min: 2, max: 4 }, enderman] },
  chorus_forest: { creature: [{ mob: 'endling', weight: 10, min: 2, max: 4 }], monster: [{ mob: 'chorus_beast', weight: 3, min: 1, max: 1 }, enderman] },
  void_wastes: { creature: [], monster: [{ mob: 'void_stalker', weight: 12, min: 1, max: 2 }, enderman, { mob: 'end_phantom', weight: 2, min: 1, max: 1 }] },
};

/** Natural spawning stops once this many of a kind are within SPAWN_AREA blocks of the player it spawns for. */
export const EXPANSION_MOB_CAPS: Readonly<Record<ExpansionMob, number>> = {
  endling: 10,
  void_stalker: 6,
  chorus_beast: 2,
  end_crystal_mite: 8,
  end_phantom: 1,
};
export const SPAWN_AREA = 128;

/** End Phantoms only appear this far out (the outer part of the band)... */
export const PHANTOM_MIN_DISTANCE = 8000;
/** ...and, around a player, at most once in this many ticks. */
export const PHANTOM_COOLDOWN = 6000;
/** End Crystal Mites spawn naturally only this close to a crystal formation. */
export const MITE_FORMATION_RANGE = 5;
