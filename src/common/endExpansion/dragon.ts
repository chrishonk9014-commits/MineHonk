/**
 * V6 - The End Expansion, phase 5: the Dragon expansion. Additions to the
 * classic fight (src/server/systems/TheEnd.ts and DragonAdditions.ts), never
 * a replacement: 200 health, the crystals and pillars, perching as often as
 * before, the exit portal, the respawn, the Voidbound and malware paths all
 * stay as they are. Every new attack is shown before it lands (at least 24
 * ticks, 32 with company) and resolved on the server when it does.
 */

export const DRAGON_X = {
  /** Void Breath Wave: inhale, then a line of breath along the ground that fades over 4 seconds. */
  breathInhale: 30,
  breathLength: 20,
  breathFade: 80,
  /** Wing Gust: it rears up on the portal, then pushes everyone near away from it (never off the island). */
  gustRear: 28,
  gustRadius: 12,
  gustMax: 6,
  /** Strafing Dive: a shallow pass along a marked line; its claws hurt whoever stands on the line. */
  diveWarn: 24,
  diveHalfLength: 22,
  diveSpeed: 1.2,
  diveWidth: 2.5,
  diveDamage: 8,
  /** Crystal Fury: after a crystal breaks, the others flare; the nearest may fire at someone camping its pillar. */
  furyTicks: 200,
  furyCharge: 30,
  furyRadius: 8,
  furyDamage: 5,
  /** Edge Strike: a slam into the island's edge, away from the portal; a small crater that crumbles. */
  edgeWarn: 40,
  edgeRadius: 3,
  edgeDamage: 6,
  /** How close to the pillars, portals, the Nest's way in and gateways a crater may never come. */
  edgeKeepOut: 7,
  /** Below this share of its health a cosmetic storm rolls over the island. */
  stormBelow: 0.25,
  /** Pillar Weave: how often an approach starts with a weave through the pillars (and how long it may take). */
  weaveChance: 0.3,
  weaveTicks: 160,
  /**
   * Of the attacks it picks in its holding pattern (where it would strafe or
   * charge), how many become a breath wave, a dive or an edge strike: they
   * take the place of strafes, so it comes down to the portal as often.
   */
  waveChance: 0.2,
  diveChance: 0.18,
  edgeChance: 0.07,
} as const;

/** The Dragon additions an Admin Panel test can trigger one at a time. */
export const DRAGON_TESTS = ['breath_wave', 'wing_gust', 'roar', 'pillar_weave', 'strafing_dive', 'crystal_fury', 'edge_strike', 'dragon_storm'] as const;
export type DragonTest = (typeof DRAGON_TESTS)[number];
