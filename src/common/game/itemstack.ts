/** Item stack representation and helpers (numeric ids in memory/wire, string ids in saves). */
import { items, itemById } from '../registry/items';

export interface ItemTag {
  /** Enchantments id -> level. */
  ench?: Record<string, number>;
  /** Stored enchantments (enchanted books). */
  stored?: Record<string, number>;
  name?: string;
  potion?: string;
  repairCost?: number;
  color?: number;
  /** Written/extra free-form data (e.g. compass target). */
  data?: Record<string, unknown>;
}

export interface ItemStack {
  id: number;
  count: number;
  damage?: number;
  tag?: ItemTag;
}

export type Slot = ItemStack | null;

export function stackOf(id: string, count = 1, extra?: Partial<ItemStack>): ItemStack {
  const it = itemById.get(id);
  if (!it) throw new Error(`Unknown item ${id}`);
  return { id: it.num, count, ...extra };
}

export function maxStack(s: ItemStack): number {
  return items[s.id]?.maxStack ?? 64;
}

export function itemIdOf(s: ItemStack): string {
  return items[s.id]?.id ?? 'air';
}

export function cloneStack<T extends Slot>(s: T): T {
  if (!s) return s;
  return { id: s.id, count: s.count, ...(s.damage ? { damage: s.damage } : {}), ...(s.tag ? { tag: JSON.parse(JSON.stringify(s.tag)) } : {}) } as T;
}

function tagsEqual(a?: ItemTag, b?: ItemTag): boolean {
  if (!a && !b) return true;
  if (!a || !b) return (!a || Object.keys(a).length === 0) && (!b || Object.keys(b).length === 0);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two stacks may merge into one. */
export function canStack(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && tagsEqual(a.tag, b.tag) && maxStack(a) > 1;
}

export function sameItem(a: Slot, b: Slot): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && tagsEqual(a.tag, b.tag);
}

export function isEmpty(s: Slot): s is null {
  return !s || s.count <= 0 || s.id === 0;
}

export function normalize(s: Slot): Slot {
  return isEmpty(s) ? null : s;
}

/** Save format */
export interface SavedStack {
  id: string;
  count: number;
  damage?: number;
  tag?: ItemTag;
}

export function toSaved(s: Slot): SavedStack | null {
  if (isEmpty(s)) return null;
  return { id: itemIdOf(s), count: s.count, ...(s.damage ? { damage: s.damage } : {}), ...(s.tag ? { tag: s.tag } : {}) };
}

export function fromSaved(s: SavedStack | null | undefined): Slot {
  if (!s || typeof s !== 'object') return null;
  const it = itemById.get(String(s.id));
  if (!it) return null;
  const count = Math.max(1, Math.min(it.maxStack, Math.floor(Number(s.count) || 1)));
  const out: ItemStack = { id: it.num, count };
  if (s.damage && Number.isFinite(s.damage)) out.damage = Math.max(0, Math.floor(s.damage));
  if (s.tag && typeof s.tag === 'object') out.tag = s.tag;
  return out;
}

/** Validates an item stack received over the network (creative mode only). */
export function sanitizeStack(s: unknown): Slot {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isInteger(id) || id <= 0 || id >= items.length) return null;
  const it = items[id]!;
  const count = Math.max(1, Math.min(it.maxStack, Math.floor(Number(o.count) || 1)));
  const out: ItemStack = { id, count };
  const dmg = Number(o.damage);
  if (Number.isFinite(dmg) && dmg > 0 && it.def.durability) out.damage = Math.min(it.def.durability - 1, Math.floor(dmg));
  return out;
}
