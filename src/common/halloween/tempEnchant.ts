/**
 * V7 - The Halloween Update, phase 3: temporary enchantments (a King-Sized
 * Candy's gift). One at a time on an item, kept apart from its real
 * enchantments (ItemTag.temp), with the world time it runs out at. It counts
 * only before then, wherever the item is (a chest, the ground, another
 * player's hands, an unloaded chunk), because every check reads the clock
 * below; the server also strips expired ones from the items it touches.
 * It can never become permanent: nothing copies it into `ench`, and one that
 * claims to last longer than TEMP_ENCHANT_MAX_TICKS counts as expired.
 *
 * Plain data and a clock, no imports: the enchantment helpers read it.
 */
import type { ItemStack, ItemTag } from '../game/itemstack';

/** How long a candy's enchantment lasts (ticks): three minutes. */
export const TEMP_ENCHANT_TICKS = 3 * 60 * 20;
/** Anything claiming to last longer than this from now is broken (or tampered with) and counts as expired. */
export const TEMP_ENCHANT_MAX_TICKS = TEMP_ENCHANT_TICKS;

export interface TempEnchant {
  id: string;
  lvl: number;
  /** World time (LevelData.time, ticks) it ends at. */
  until: number;
}

/**
 * The world time the checks compare against: the server sets it every tick
 * (LevelData.time), the client from the server's time messages. Each side
 * has its own copy of this module.
 */
let clock = 0;
export function setTempClock(t: number): void {
  if (Number.isFinite(t)) clock = t;
}
export function tempClock(): number {
  return clock;
}

function valid(t: ItemTag['temp']): t is TempEnchant {
  return !!t && typeof t.id === 'string' && Number.isInteger(t.lvl) && t.lvl >= 1 && t.lvl <= 10 && typeof t.until === 'number' && Number.isFinite(t.until);
}

/** The item's temporary enchantment while it lasts (null: none, or run out). */
export function activeTemp(s: ItemStack | null | undefined, now = clock): TempEnchant | null {
  const t = s?.tag?.temp;
  if (!valid(t)) return null;
  return t.until > now && t.until - now <= TEMP_ENCHANT_MAX_TICKS ? t : null;
}

/** Ticks left on it (0: none). */
export function tempLeft(s: ItemStack | null | undefined, now = clock): number {
  const t = activeTemp(s, now);
  return t ? t.until - now : 0;
}

/**
 * Removes a malformed temporary enchantment (loading saved items: whether one
 * has run out is left to the server's sweep, which runs in its tick with its
 * own world's clock; until then an expired one simply counts for nothing).
 */
export function stripInvalidTemp(s: ItemStack | null | undefined): boolean {
  if (!s?.tag || s.tag.temp === undefined || valid(s.tag.temp)) return false;
  const tag = { ...s.tag };
  delete tag.temp;
  s.tag = Object.keys(tag).length ? tag : undefined;
  if (!s.tag) delete s.tag;
  return true;
}

/** Removes a temporary enchantment that has run out (or is malformed); true if it changed the stack. */
export function stripExpiredTemp(s: ItemStack | null | undefined, now = clock): boolean {
  if (!s?.tag || s.tag.temp === undefined) return false;
  if (activeTemp(s, now)) return false;
  const tag = { ...s.tag };
  delete tag.temp;
  s.tag = Object.keys(tag).length ? tag : undefined;
  if (!s.tag) delete s.tag;
  return true;
}
