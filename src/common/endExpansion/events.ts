/**
 * V6 - The End Expansion, phase 5: the End's events (they stand in for
 * weather, in the Expanded End only).
 *
 * - VOID STORMS: about once every 2-4 in-game days, 3-5 minutes long, with a
 *   minute's warning. Void Debris rains down (each impact marked first),
 *   low-gravity pockets form, the End's mobs grow bolder, End crystal glows
 *   and Crystal Generators run hotter, and Storm Remnants (small floating
 *   ruins with a chest) appear near players for the length of the storm.
 * - THE END ECLIPSE: very rare (2.5% a day, never within 20 days of the
 *   last), one night long, without warning. The sky goes dark round a ringed
 *   disc, Eclipse Shards grow on the islands (they dissolve at dawn), Eclipse
 *   Monoliths rise near players, eclipsed Phantoms and Void Stalkers hunt,
 *   and the Void Citadel shows itself with a beam of light.
 *
 * The server decides everything (src/server/systems/EndEvents.ts); these are
 * the shared numbers, blocks and items.
 */
import type { BlockDef } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';

/** Ticks in an in-game day. */
export const DAY = 24000;

export const STORM = {
  /** Days between storms (picked at random between these). */
  minGapDays: 2,
  maxGapDays: 4,
  /** How long a storm lasts (ticks). */
  minTicks: 3 * 60 * 20,
  maxTicks: 5 * 60 * 20,
  /** The warning before it breaks. */
  warnTicks: 60 * 20,
  /** Debris: one impact near each player in the band every this many ticks (on average). */
  debrisEvery: 50,
  /** How far from a player debris lands. */
  debrisRange: 14,
  debrisDamage: 6,
  /** Radius an impact hurts in. */
  debrisRadius: 1.6,
  /** Low-gravity pockets: how often one forms near a player, its radius and how long it lasts. */
  pocketEvery: 240,
  pocketRadius: 4,
  pocketTicks: 400,
  /** Storm Remnants per storm (1-2) and their fading warning. */
  remnants: [1, 2] as [number, number],
  fadeWarnTicks: 30 * 20,
  /** End mobs' follow range during a storm. */
  followBoost: 1.5,
  /** Crystal Generators' output during a storm. */
  crystalBoost: 1.5,
  /** The Void Collector's (the phase 4 hook). */
  voidBoost: 4,
} as const;

export const ECLIPSE = {
  /** Chance an eclipse comes on a given day. */
  chancePerDay: 0.025,
  /** Days that must pass after one before another can come. */
  minGapDays: 20,
  /** One night (about 7 minutes). */
  ticks: 7 * 60 * 20,
  /** It starts at nightfall (time of day). */
  startOfDay: 13000,
  /** Eclipse Shards: one grows near each player in the band every this many ticks, up to `shardsNear` around them. */
  shardEvery: 160,
  shardsNear: 10,
  shardRange: 24,
  /** Monoliths near each player (2-3), and their fading warning. */
  monoliths: [2, 3] as [number, number],
  fadeWarnTicks: 30 * 20,
  /** Eclipsed End Phantoms: at most this many near each player. */
  phantomsPerPlayer: 2,
  /** Eclipsed Void Stalkers take this share of damage. */
  stalkerDamageTaken: 0.75,
} as const;

/** The shortest warning any event hazard gets (more with company): the fairness pattern. */
export function eventTelegraph(company: boolean): number {
  return company ? 32 : 24;
}

/** What `level.flags.endEvents` holds. */
export interface EndEventState {
  storm: {
    /** 'calm' until `warnAt`, 'warning' until `startAt`, 'active' until `endAt`. */
    phase: 'calm' | 'warning' | 'active';
    warnAt: number;
    startAt: number;
    endAt: number;
    /** Set by the Admin Panel (nothing during it counts). */
    cheat?: boolean;
  };
  eclipse: {
    active: boolean;
    startAt: number;
    endAt: number;
    /** The last day rolled for (an eclipse is rolled once a day). */
    rolledDay: number;
    /** The day the last eclipse began (-1: never). */
    lastDay: number;
    cheat?: boolean;
  };
}

/** The sync message's view of the events (clients draw them; the band is theirs to check). */
export interface EndEventsView {
  storm: 'calm' | 'warning' | 'active';
  /** Ticks left of the warning or the storm. */
  stormLeft: number;
  eclipse: boolean;
  eclipseLeft: number;
  /** The Void Citadel's beam (during an eclipse), and where it is. */
  citadel?: [number, number, number];
}

const BOOL = ['false', 'true'] as const;

/** Blocks of the events (appended after the phase 4 quest blocks). */
export function eventBlockDefs(): BlockDef[] {
  const temporary = { hardness: -1, resistance: 3600000, drops: 'none' as const, creative: 'hidden', item: false };
  return [
    // Eclipse Shards grow on the islands only while an eclipse lasts (they dissolve at dawn)
    { id: 'eclipse_shard_growth', name: 'Eclipse Shard', hardness: 0.6, sound: 'glass', model: 'cross', tex: { all: 'eclipse_shard_growth' }, light: 12, place: 'needs_solid_below', collide: false, opacity: 0, drops: { item: 'eclipse_shard', min: 1, max: 2, fortune: true }, mapColor: 0xe8d8ff, creative: 'hidden', item: false },
    // Storm Remnants: ancient stone the storm brings, unbreakable (it goes when the storm does)
    { id: 'remnant_stone', name: 'Remnant Stone', sound: 'stone', model: 'cube', tex: { all: 'remnant_stone' }, mapColor: 0x6a5e78, ...temporary },
    { id: 'remnant_bricks', name: 'Remnant Bricks', sound: 'stone', model: 'cube', tex: { all: 'remnant_bricks' }, mapColor: 0x7a6e5a, ...temporary },
    // Fading: the same stone flickering (still solid underfoot) in its last 30 seconds
    { id: 'fading_remnant', name: 'Fading Remnant', sound: 'glass', model: 'cube', tex: { all: 'fading_remnant' }, layer: 'translucent', opacity: 0, light: 6, mapColor: 0xa090c0, ...temporary },
    // Eclipse Monoliths: obsidian and astral stone, ringed with light
    { id: 'monolith_obsidian', name: 'Monolith Obsidian', sound: 'stone', model: 'cube', tex: { all: 'monolith_obsidian' }, light: 2, mapColor: 0x18101e, ...temporary },
    { id: 'monolith_astral', name: 'Monolith Astral Stone', sound: 'stone', model: 'cube', tex: { all: 'monolith_astral' }, light: 13, mapColor: 0xc8c0ff, ...temporary },
    { id: 'fading_monolith', name: 'Fading Monolith', sound: 'glass', model: 'cube', tex: { all: 'fading_monolith' }, layer: 'translucent', opacity: 0, light: 8, mapColor: 0xd0c8ff, ...temporary },
    // The chests of remnants and monoliths: ordinary chests marked in their block entity
    // A storm's crumbling ground near the Dragon: loose end stone (phase 5 Edge Strike craters)
    { id: 'loose_end_stone', name: 'Loose End Stone', hardness: -1, resistance: 3600000, sound: 'gravel', model: 'cube', tex: { all: 'loose_end_stone' }, drops: 'none', mapColor: 0xc8c08a, creative: 'hidden', item: false, props: { crumble: BOOL } },
  ];
}

export function eventItemDefs(): ItemDef[] {
  return [
    { id: 'eclipse_shard', name: 'Eclipse Shard', rarity: 'epic', creative: 'materials', tooltip: 'It grows only under the End Eclipse. The End Guardian\'s altar wants four.' },
  ];
}
