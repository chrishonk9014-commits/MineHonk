/**
 * V6 - The End Expansion, phase 5: the End Guardian, the strongest optional
 * boss in the game (not a story boss: its defeat is a victory title, never an
 * ending). It waits in the arena at the bottom of the Void Citadel; four
 * Eclipse Shards on the altar wake it (the first time the altar is already
 * charged). The fight is the server's (src/server/systems/EndGuardian.ts);
 * these are the shared numbers and its rewards.
 */
import type { ItemDef } from '../registry/itemTypes';

export const GUARDIAN = {
  health: 1000,
  /** Extra health for each player beyond the first. */
  perPlayer: 400,
  armor: 16,
  /** Phases begin at these shares of its health. */
  phase2: 0.66,
  phase3: 0.33,
  /** A core window (kneeling, core exposed) after every this many attacks, for this long. */
  attacksPerWindow: 4,
  windowTicks: 100,
  /** Damage taken while the core is exposed. */
  exposedFactor: 1.5,
  /** Damage taken while the crystal pylons' shield is up. */
  shieldFactor: 0.5,
  /** Shards the altar wants. */
  shards: 4,
  /** In-game days before it re-forms after a defeat. */
  respawnDays: 7,
  /** It resets this long after everyone has died or left. */
  resetTicks: 60 * 20,
  /** Attacks. */
  lanceCharge: 30,
  lanceDamage: 14,
  fractureWarn: 32,
  fractureDrop: 60,
  constructEvery: 45 * 20,
  orbDamage: 8,
  wellWarn: 24,
  collapseWarn: 40,
  collapseDrop: 160,
  finalLanceWarn: 40,
  finalLanceDamage: 16,
  /** Players further than this from the arena's middle have left the fight. */
  leash: 40,
} as const;

/** Its rewards. */
export const GUARDIAN_LOOT = {
  /** The Guardian Core: certain on a player's first defeat of it, this chance after. */
  coreChance: 0.25,
  lanceChance: 0.33,
  veilChance: 0.2,
} as const;

/** The Guardian's Lance. */
export const LANCE = { reach: 6, beam: 12, damage: 9, cooldown: 40 } as const;
/** Eclipse Veil (an Elytra module). */
export const VEIL = { ticks: 5 * 20, cooldown: 60 * 20 } as const;

/** The Admin Panel's rare End loot (cheat-marked when given there). */
export const RARE_END_LOOT: readonly { id: string; name: string; items: [string, number][] }[] = [
  { id: 'guardian_core', name: 'Guardian Core', items: [['guardian_core', 1]] },
  { id: 'guardians_lance', name: 'The Guardian\'s Lance', items: [['guardians_lance', 1]] },
  { id: 'eclipse_veil', name: 'Eclipse Veil module', items: [['eclipse_veil_module', 1]] },
  { id: 'eclipse_shards', name: 'Eclipse Shards', items: [['eclipse_shard', 16]] },
  { id: 'star_chart', name: 'Citadel Star Chart pieces', items: [['citadel_star_chart_piece', 3]] },
  { id: 'guardian_head', name: 'End Guardian Head', items: [['end_guardian_head', 1]] },
];

export function guardianItemDefs(): ItemDef[] {
  return [
    { id: 'guardian_core', name: 'Guardian Core', maxStack: 1, rarity: 'epic', creative: 'tools', tooltip: 'Apply it to an Elytra at a smithing table: a fourth upgrade slot.' },
    { id: 'guardians_lance', name: 'The Guardian\'s Lance', maxStack: 1, durability: 2031, tool: { type: 'sword', tier: 4, speed: 1.5, material: 'ancient' }, weapon: { damage: 9, speed: 0.9 }, use: 'guardians_lance', enchantability: 15, repair: 'eclipse_shard', rarity: 'epic', tags: ['weapons', 'swords'], creative: 'combat', tooltip: 'Reaches further than a sword. Use it to fire a short Crystal Lance (2 seconds to recharge).' },
    { id: 'eclipse_veil_module', name: 'Elytra Module: Eclipse Veil', maxStack: 16, rarity: 'epic', tags: ['elytra_module'], creative: 'tools', tooltip: 'Apply to an Elytra at a smithing table. While gliding, sneak and use an empty hand: hard to see for 5 seconds (mobs lose you). 60 seconds to recharge.' },
  ];
}
