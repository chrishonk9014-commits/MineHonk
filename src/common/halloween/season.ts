/**
 * V7 - The Halloween Update: when Halloween content is on.
 *
 * Halloween does not come back by itself every year (next year gets its own
 * update). The season runs until one fixed moment for everyone, whatever the
 * player's time zone: November 7, 2026, 12:00 AM Pacific Standard Time.
 *
 * Two questions, one answer each, used by every seasonal feature:
 *  - the menu (title screen backgrounds, splashes): the date only;
 *  - a world: the date and the world's own setting. A world created with
 *    "Halloween content: Always on" keeps it after the season; a "Seasonal"
 *    one (the default, and every world from before V7) stops getting new
 *    seasonal content at the cutoff. Nothing is ever taken away: pumpkins
 *    already placed, items and saves stay.
 *
 * A world's answer is decided by its server (the host, in multiplayer) and
 * sent to every player in it, so everyone in a world sees the same thing.
 * The Admin Panel can simulate "after the cutoff" or "always on" for testing
 * (never saved).
 *
 * Hauntings, Abandoned Villages and the Update Log are never seasonal.
 */

/** 2026-11-07T08:00:00Z: November 7, 2026, 12:00 AM PST. Halloween content is on before this moment. */
export const HALLOWEEN_ENDS_AT = Date.UTC(2026, 10, 7, 8, 0, 0);

/** The world option chosen at creation ("More World Options..."). */
export type HalloweenSetting = 'seasonal' | 'always';
export const HALLOWEEN_SETTINGS: readonly HalloweenSetting[] = ['seasonal', 'always'];
export const HALLOWEEN_SETTING_NAMES: Record<HalloweenSetting, string> = { seasonal: 'Seasonal', always: 'Always on' };

/** Admin Panel test simulation: none, as if after the cutoff, or as if the world had it always on. */
export type HalloweenSimulation = 'none' | 'expired' | 'always';
export const HALLOWEEN_SIMULATIONS: readonly HalloweenSimulation[] = ['none', 'expired', 'always'];

/** Why Halloween content is on or off in a world. */
export type HalloweenReason = 'season' | 'always' | 'expired';

export interface HalloweenState {
  active: boolean;
  reason: HalloweenReason;
  /** The world's own setting. */
  setting: HalloweenSetting;
  /** A test simulation from the Admin Panel ('none' in normal play). */
  sim: HalloweenSimulation;
}

/** The menu's answer: the date only. */
export function seasonActive(now: number): boolean {
  return now < HALLOWEEN_ENDS_AT;
}

/** A world's answer: the date, the world's setting and any Admin Panel simulation. */
export function halloweenState(now: number, setting: HalloweenSetting, sim: HalloweenSimulation = 'none'): HalloweenState {
  const always = setting === 'always' || sim === 'always';
  const inSeason = sim === 'expired' ? false : seasonActive(now);
  const reason: HalloweenReason = always ? 'always' : inSeason ? 'season' : 'expired';
  return { active: reason !== 'expired', reason, setting, sim };
}

/** A safe setting from saved data (worlds from before V7 have none: Seasonal). */
export function normalizeHalloweenSetting(v: unknown): HalloweenSetting {
  return v === 'always' ? 'always' : 'seasonal';
}

/** How the cutoff reads to players. */
export const HALLOWEEN_ENDS_TEXT = 'November 7, 2026, 12:00 AM PST';

/** One line explaining a world's state (the Admin Panel and the F3 screen). */
export function halloweenReasonText(s: HalloweenState): string {
  const sim = s.sim === 'expired' ? ' (simulating after the cutoff)' : s.sim === 'always' ? ' (simulating Always on)' : '';
  if (s.reason === 'always') return (s.setting === 'always' ? 'On: this world has Halloween content always on.' : 'On: Halloween content always on.') + sim;
  if (s.reason === 'season') return `On: it is the Halloween season (until ${HALLOWEEN_ENDS_TEXT}).` + sim;
  return 'Off: the Halloween season is over, and this world is Seasonal. Nothing seasonal is removed.' + sim;
}
