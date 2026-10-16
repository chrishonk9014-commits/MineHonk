/**
 * V7 - The Halloween Update: when Halloween content is on.
 *
 * Halloween does not come back by itself every year. The season is a list of
 * windows (`HALLOWEEN_WINDOWS`, the only place its dates are written); today
 * there is one, which runs until one fixed moment for everyone, whatever the
 * player's time zone: November 7, 2026, 12:00 AM Pacific Standard Time. A
 * later Halloween comes back by adding a window there (docs/SEASONS.md).
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
 * The Admin Panel has two test overrides (never saved): the Halloween content
 * itself (forced on or off) and the date (just before or just after the
 * cutoff).
 *
 * Hauntings, Abandoned Villages and the Update Log are never seasonal.
 */

/** A stretch of time when Halloween content is on. */
export interface SeasonWindow {
  id: string;
  /** How players see it named ("Halloween 2026"). */
  name: string;
  /** When it begins (ms since 1970, UTC); null: on since the update that brought it. */
  from: number | null;
  /** When it ends (ms since 1970, UTC): on before this moment, off from it. */
  until: number;
  /** How the end reads to players, in full and as a date. */
  untilText: string;
  untilDate: string;
}

/**
 * Every Halloween season, oldest first: the one place the dates are written.
 * Nothing here repeats by itself; a new Halloween is a new entry.
 */
export const HALLOWEEN_WINDOWS: readonly SeasonWindow[] = [
  // November 7, 2026, 12:00 AM PST is 08:00 UTC
  { id: 'halloween-2026', name: 'Halloween 2026', from: null, until: Date.UTC(2026, 10, 7, 8, 0, 0), untilText: 'November 7, 2026, 12:00 AM PST', untilDate: 'November 7, 2026' },
];

/** The window `now` is in (null: none, it is not the season). */
export function seasonWindowAt(now: number, windows: readonly SeasonWindow[] = HALLOWEEN_WINDOWS): SeasonWindow | null {
  for (const w of windows) if ((w.from === null || now >= w.from) && now < w.until) return w;
  return null;
}

/**
 * The window that matters at `now`: the one it is in, else the next to come,
 * else the last that was (what the menus and the Admin Panel talk about).
 */
export function seasonWindowFor(now: number, windows: readonly SeasonWindow[] = HALLOWEEN_WINDOWS): SeasonWindow {
  const inside = seasonWindowAt(now, windows);
  if (inside) return inside;
  const next = windows.filter((w) => w.from !== null && w.from > now).sort((a, b) => a.from! - b.from!)[0];
  return next ?? windows.reduce((a, b) => (b.until > a.until ? b : a));
}

const LATEST = HALLOWEEN_WINDOWS[HALLOWEEN_WINDOWS.length - 1]!;
/** The latest cutoff (2026-11-07T08:00:00Z for now). Code asks the windows; this is for texts and tests. */
export const HALLOWEEN_ENDS_AT = LATEST.until;
/** How the latest cutoff reads to players, in full and as a date. */
export const HALLOWEEN_ENDS_TEXT = LATEST.untilText;
export const HALLOWEEN_ENDS_DATE = LATEST.untilDate;

/** The world option chosen at creation ("More World Options..."). */
export type HalloweenSetting = 'seasonal' | 'always';
export const HALLOWEEN_SETTINGS: readonly HalloweenSetting[] = ['seasonal', 'always'];
export const HALLOWEEN_SETTING_NAMES: Record<HalloweenSetting, string> = { seasonal: 'Seasonal', always: 'Always on' };

/**
 * Admin Panel test overrides (never saved: they end when the world closes).
 *  - content: the Halloween content itself, as the season and setting have
 *    it ('real'), or forced on or off;
 *  - date: the real date, or a simulated one starting just before or just
 *    after the cutoff (it runs on from there, so "just before" shows the
 *    cutoff passing a minute later).
 */
export type HalloweenContentTest = 'real' | 'on' | 'off';
export type HalloweenDateTest = 'real' | 'before' | 'after';
export const HALLOWEEN_CONTENT_TESTS: readonly HalloweenContentTest[] = ['real', 'on', 'off'];
export const HALLOWEEN_DATE_TESTS: readonly HalloweenDateTest[] = ['real', 'before', 'after'];
export const HALLOWEEN_CONTENT_TEST_NAMES: Record<HalloweenContentTest, string> = { real: 'Real', on: 'Force on', off: 'Force off' };
export const HALLOWEEN_DATE_TEST_NAMES: Record<HalloweenDateTest, string> = { real: 'Real', before: 'Just before the cutoff', after: 'Just after the cutoff' };
/** How far from the cutoff a simulated date starts (ms). */
export const DATE_TEST_LEAD = 60_000;

export interface HalloweenTests {
  content: HalloweenContentTest;
  date: HalloweenDateTest;
}
export const NO_TESTS: Readonly<HalloweenTests> = { content: 'real', date: 'real' };

/** Where a simulated date starts, for a real time `now`. */
export function simulatedDateStart(date: HalloweenDateTest, now: number): number {
  if (date === 'real') return now;
  const cut = seasonWindowFor(now).until;
  return date === 'before' ? cut - DATE_TEST_LEAD : cut + DATE_TEST_LEAD;
}

/** Why Halloween content is on or off in a world. */
export type HalloweenReason = 'season' | 'always' | 'expired' | 'forced';

export interface HalloweenState {
  active: boolean;
  reason: HalloweenReason;
  /** The world's own setting. */
  setting: HalloweenSetting;
  /** Whether the date the world goes by (real or simulated) is in the season. */
  inSeason: boolean;
  /** The Admin Panel's test overrides ('real' in normal play). */
  content: HalloweenContentTest;
  date: HalloweenDateTest;
}

/** The menu's answer: the date only. */
export function seasonActive(now: number): boolean {
  return seasonWindowAt(now) !== null;
}

/**
 * A world's answer: `now` is the date it goes by (a simulated one under a
 * date test), with its setting and the Admin Panel's tests.
 */
export function halloweenState(now: number, setting: HalloweenSetting, tests: Readonly<HalloweenTests> = NO_TESTS): HalloweenState {
  const inSeason = seasonActive(now);
  const content = tests.content;
  const reason: HalloweenReason = content !== 'real' ? 'forced' : setting === 'always' ? 'always' : inSeason ? 'season' : 'expired';
  const active = content === 'on' || (content === 'real' && (setting === 'always' || inSeason));
  return { active, reason, setting, inSeason, content, date: tests.date };
}

/** Whether an Admin Panel test is changing anything. */
export function halloweenTested(s: HalloweenState): boolean {
  return s.content !== 'real' || s.date !== 'real';
}

/** A safe setting from saved data (worlds from before V7 have none: Seasonal). */
export function normalizeHalloweenSetting(v: unknown): HalloweenSetting {
  return v === 'always' ? 'always' : 'seasonal';
}

/** One line explaining a world's state (the Admin Panel and the F3 screen); `now` is the date the world goes by. */
export function halloweenReasonText(s: HalloweenState, now?: number): string {
  const w = now === undefined ? LATEST : seasonWindowFor(now);
  const date = s.date === 'before' ? ' Simulated date: just before the cutoff.' : s.date === 'after' ? ' Simulated date: just after the cutoff.' : '';
  if (s.reason === 'forced') return (s.content === 'on' ? 'On: forced on by a test (Admin Panel).' : 'Off: forced off by a test (Admin Panel).') + date;
  if (s.reason === 'always') return 'On: this world has Halloween content always on.' + (s.inSeason ? '' : ' (The season itself is over.)') + date;
  if (s.reason === 'season') return `On: it is the Halloween season (until ${w.untilText}).` + date;
  return 'Off: the Halloween season is over, and this world is Seasonal. Nothing seasonal is removed.' + date;
}
