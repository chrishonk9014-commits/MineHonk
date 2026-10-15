/**
 * V7 - The Halloween Update, phase 3: candy and the Trick-or-Treat Sack.
 *
 * Four candies, eaten like food at any hunger (each a quick snack):
 *  - Candy: a short, mild buff (Speed, Jump Boost or Haste for 20 seconds);
 *  - Big Candy: two of those at once, for 45 seconds;
 *  - King-Sized Candy: rare and powerful, one of: strong buffs for a minute,
 *    a temporary enchantment on something the eater holds or wears (three
 *    minutes, see tempEnchant.ts), or a small payout of gold or a diamond;
 *  - Poisoned Candy: warped and sickly yellow-brown wherever it is seen.
 *    Poison, Wither, Blindness, Nausea or a little health lost, never enough
 *    to kill from full health.
 * Effects refresh rather than stack (the status effect system keeps the
 * stronger or longer of two).
 *
 * The sack holds 128 candies of every kind together. Its contents live in
 * the sack's own item data (ItemTag.data.candy), so they go wherever it goes;
 * only the server ever changes them, and only through the functions here.
 * Candy made by cheats stays cheat-made inside a sack (data.cheat counts how
 * many of each kind are), so nothing is laundered by putting it in.
 *
 * Plain data and pure functions, shared by the server, the client and the tests.
 */
import type { ItemStack } from '../game/itemstack';

export type CandyKind = 'regular' | 'big' | 'king' | 'poisoned';
export const CANDY_KINDS: readonly CandyKind[] = ['regular', 'big', 'king', 'poisoned'];

/** Item ids. */
export const SACK_ID = 'trick_or_treat_sack';
export const CANDY_ITEM: Readonly<Record<CandyKind, string>> = { regular: 'candy', big: 'big_candy', king: 'king_sized_candy', poisoned: 'poisoned_candy' };
export const CANDY_OF_ITEM: Readonly<Record<string, CandyKind>> = Object.fromEntries(CANDY_KINDS.map((k) => [CANDY_ITEM[k], k]));
export const CANDY_NAMES: Readonly<Record<CandyKind, string>> = { regular: 'Candy', big: 'Big Candy', king: 'King-Sized Candy', poisoned: 'Poisoned Candy' };
export const CANDY_LOOK: Readonly<Record<CandyKind, string>> = {
  regular: 'A little sweet in an orange twist of paper.',
  big: 'A swirl lollipop as big as your hand.',
  king: 'A chocolate bar in gold foil. Rare, and worth it.',
  poisoned: 'Warped, sticky and the wrong colour. Best not.',
};

/**
 * Recipes that only work while Halloween is on in the world (the sack); the
 * recipe book hides them otherwise. Sacks already made keep working.
 */
export const SEASONAL_RECIPES: Readonly<Record<string, 'halloween'>> = { [SACK_ID]: 'halloween' };

export function isCandy(id: string | undefined): boolean {
  return !!id && id in CANDY_OF_ITEM;
}

// ---------------------------------------------------------------------------
// Eating
// ---------------------------------------------------------------------------

/** Food values: a quick snack, at any hunger. */
export const CANDY_FOOD: Readonly<Record<CandyKind, { hunger: number; saturation: number; eatTime: number }>> = {
  regular: { hunger: 1, saturation: 0.2, eatTime: 16 },
  big: { hunger: 2, saturation: 0.4, eatTime: 20 },
  king: { hunger: 4, saturation: 2.4, eatTime: 24 },
  poisoned: { hunger: 1, saturation: 0, eatTime: 16 },
};

export interface CandyEffect {
  id: string;
  amp: number;
  ticks: number;
}

/** Candy: one of these. */
export const REGULAR_BUFFS: readonly CandyEffect[] = [
  { id: 'speed', amp: 0, ticks: 400 },
  { id: 'jump_boost', amp: 0, ticks: 400 },
  { id: 'haste', amp: 0, ticks: 400 },
];
/** Big Candy: two different ones of these. */
export const BIG_BUFFS: readonly CandyEffect[] = [
  { id: 'speed', amp: 0, ticks: 900 },
  { id: 'jump_boost', amp: 0, ticks: 900 },
  { id: 'haste', amp: 0, ticks: 900 },
];
/** King-Sized Candy's strong buffs (all of them). */
export const KING_BUFFS: readonly CandyEffect[] = [
  { id: 'speed', amp: 1, ticks: 1200 },
  { id: 'haste', amp: 1, ticks: 1200 },
  { id: 'jump_boost', amp: 1, ticks: 1200 },
  { id: 'regeneration', amp: 0, ticks: 200 },
];
/** What a King-Sized Candy does (weights out of 100). With nothing to enchant, the enchantment becomes the buffs. */
export const KING_OUTCOMES: readonly { kind: 'buffs' | 'enchant' | 'payout'; weight: number }[] = [
  { kind: 'buffs', weight: 50 },
  { kind: 'enchant', weight: 30 },
  { kind: 'payout', weight: 20 },
];
/** The payout (weights out of 10). */
export const KING_PAYOUTS: readonly { item: string; min: number; max: number; weight: number }[] = [
  { item: 'gold_ingot', min: 2, max: 4, weight: 7 },
  { item: 'diamond', min: 1, max: 1, weight: 3 },
];
/** Poisoned Candy: one of these (weights out of 3). `damage` is health lost at once. */
export const POISON_OUTCOMES: readonly { effects: readonly CandyEffect[]; damage: number; weight: number }[] = [
  { effects: [{ id: 'poison', amp: 0, ticks: 160 }, { id: 'blindness', amp: 0, ticks: 60 }], damage: 0, weight: 1 },
  { effects: [{ id: 'wither', amp: 0, ticks: 80 }, { id: 'nausea', amp: 0, ticks: 160 }], damage: 0, weight: 1 },
  { effects: [{ id: 'blindness', amp: 0, ticks: 80 }], damage: 4, weight: 1 },
];
/**
 * The most a Poisoned Candy can take from someone at full health (half
 * hearts): poison never takes the last half heart; wither at level I hurts
 * once every 40 ticks.
 */
export function poisonWorstCase(): number {
  let worst = 0;
  for (const o of POISON_OUTCOMES) {
    let d = o.damage;
    for (const e of o.effects) if (e.id === 'wither') d += Math.ceil(e.ticks / Math.max(1, 40 >> e.amp));
    for (const e of o.effects) if (e.id === 'poison') d += Math.ceil(e.ticks / Math.max(1, 25 >> e.amp));
    worst = Math.max(worst, d);
  }
  return worst;
}

/** What eating one candy does (the server applies it). */
export interface CandyBite {
  effects: CandyEffect[];
  damage: number;
  /** King-Sized: a temporary enchantment on something held or worn (the server picks it; buffs if nothing can take one). */
  enchant?: boolean;
  /** King-Sized: items given. */
  payout?: { item: string; count: number };
}

export interface Rng {
  next(): number;
  int(n: number): number;
}

function weighted<T extends { weight: number }>(rng: Rng, list: readonly T[]): T {
  const total = list.reduce((a, b) => a + b.weight, 0);
  let r = rng.next() * total;
  for (const x of list) {
    r -= x.weight;
    if (r < 0) return x;
  }
  return list[list.length - 1]!;
}

export function rollBite(kind: CandyKind, rng: Rng): CandyBite {
  switch (kind) {
    case 'regular':
      return { effects: [{ ...REGULAR_BUFFS[rng.int(REGULAR_BUFFS.length)]! }], damage: 0 };
    case 'big': {
      const a = rng.int(BIG_BUFFS.length);
      const b = (a + 1 + rng.int(BIG_BUFFS.length - 1)) % BIG_BUFFS.length;
      return { effects: [{ ...BIG_BUFFS[a]! }, { ...BIG_BUFFS[b]! }], damage: 0 };
    }
    case 'king': {
      const o = weighted(rng, KING_OUTCOMES).kind;
      if (o === 'enchant') return { effects: [], damage: 0, enchant: true };
      if (o === 'payout') {
        const p = weighted(rng, KING_PAYOUTS);
        return { effects: [], damage: 0, payout: { item: p.item, count: p.min + rng.int(p.max - p.min + 1) } };
      }
      return { effects: KING_BUFFS.map((e) => ({ ...e })), damage: 0 };
    }
    case 'poisoned': {
      const o = weighted(rng, POISON_OUTCOMES);
      return { effects: o.effects.map((e) => ({ ...e })), damage: o.damage };
    }
  }
}

// ---------------------------------------------------------------------------
// Candy Homes
// ---------------------------------------------------------------------------

/** Each candy a Candy Home gives is one of these (weights out of 100). */
export const CANDY_HOME_ODDS: Readonly<Record<CandyKind, number>> = { regular: 62, big: 25, king: 5, poisoned: 8 };
/** How many candies a Candy Home gives (weights out of 100): 1.8 on average. */
export const CANDY_HOME_COUNT: readonly { n: number; weight: number }[] = [
  { n: 1, weight: 40 },
  { n: 2, weight: 40 },
  { n: 3, weight: 20 },
];

export function rollCandyKind(rng: Rng): CandyKind {
  return weighted(
    rng,
    CANDY_KINDS.map((k) => ({ k, weight: CANDY_HOME_ODDS[k] })),
  ).k;
}

/** A Candy Home's handful: 1 to 3 candies. */
export function rollCandyHome(rng: Rng): CandyKind[] {
  const n = weighted(rng, CANDY_HOME_COUNT).n;
  const out: CandyKind[] = [];
  for (let i = 0; i < n; i++) out.push(rollCandyKind(rng));
  return out;
}

// ---------------------------------------------------------------------------
// The sack
// ---------------------------------------------------------------------------

/** Candies a sack holds, all kinds together. */
export const SACK_CAPACITY = 128;

export type CandyCounts = Record<CandyKind, number>;
export interface SackContents {
  counts: CandyCounts;
  /** How many of each kind are cheat-made (never more than counts). */
  cheat: CandyCounts;
}

const zero = (): CandyCounts => ({ regular: 0, big: 0, king: 0, poisoned: 0 });

export function isSack(s: ItemStack | null | undefined, sackNum: number): boolean {
  return !!s && s.id === sackNum && s.count > 0;
}

/** A sack's contents, read safely (anything malformed or over capacity is cut back). */
export function sackContents(s: ItemStack | null | undefined): SackContents {
  const out: SackContents = { counts: zero(), cheat: zero() };
  const d = s?.tag?.data;
  const c = d?.candy as Record<string, unknown> | undefined;
  const ch = d?.cheat as Record<string, unknown> | undefined;
  let room = SACK_CAPACITY;
  for (const k of CANDY_KINDS) {
    const v = c && typeof c[k] === 'number' && Number.isFinite(c[k]) ? Math.max(0, Math.floor(c[k] as number)) : 0;
    const n = Math.min(v, room);
    room -= n;
    out.counts[k] = n;
    const w = ch && typeof ch[k] === 'number' && Number.isFinite(ch[k]) ? Math.max(0, Math.floor(ch[k] as number)) : 0;
    out.cheat[k] = Math.min(n, w);
  }
  // A whole sack made by cheats: everything in it is
  if (s?.tag?.admin) for (const k of CANDY_KINDS) out.cheat[k] = out.counts[k];
  return out;
}

export function sackTotal(c: SackContents): number {
  return CANDY_KINDS.reduce((a, k) => a + c.counts[k], 0);
}

export function sackRoom(c: SackContents): number {
  return Math.max(0, SACK_CAPACITY - sackTotal(c));
}

/** Adds up to `n` candies of a kind; returns how many went in. */
export function sackAdd(c: SackContents, kind: CandyKind, n: number, cheat: boolean): number {
  const put = Math.max(0, Math.min(Math.floor(n), sackRoom(c)));
  c.counts[kind] += put;
  if (cheat) c.cheat[kind] += put;
  return put;
}

/** Takes up to `n` candies of a kind out (honest ones first); returns how many of each came out. */
export function sackTake(c: SackContents, kind: CandyKind, n: number): { legit: number; cheat: number } {
  const take = Math.max(0, Math.min(Math.floor(n), c.counts[kind]));
  const legitIn = c.counts[kind] - c.cheat[kind];
  const legit = Math.min(take, legitIn);
  const cheat = take - legit;
  c.counts[kind] -= take;
  c.cheat[kind] -= cheat;
  return { legit, cheat };
}

/** The sack stack with these contents written back (a new stack; the old one is not changed). */
export function withContents(s: ItemStack, c: SackContents): ItemStack {
  const data: Record<string, unknown> = { ...(s.tag?.data ?? {}) };
  const counts: Partial<CandyCounts> = {};
  const cheat: Partial<CandyCounts> = {};
  for (const k of CANDY_KINDS) {
    if (c.counts[k] > 0) counts[k] = c.counts[k];
    if (c.cheat[k] > 0) cheat[k] = Math.min(c.cheat[k], c.counts[k]);
  }
  if (Object.keys(counts).length) data.candy = counts;
  else delete data.candy;
  if (Object.keys(cheat).length) data.cheat = cheat;
  else delete data.cheat;
  const tag = { ...(s.tag ?? {}), data };
  if (!Object.keys(data).length) delete (tag as { data?: unknown }).data;
  return { id: s.id, count: 1, ...(s.damage ? { damage: s.damage } : {}), ...(Object.keys(tag).length ? { tag } : {}) };
}

/** A sack's tooltip line: "n / 128 candy". */
export function sackLine(c: SackContents): string {
  return `${sackTotal(c)} / ${SACK_CAPACITY} candy`;
}
