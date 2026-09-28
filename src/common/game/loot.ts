/**
 * Data-driven loot table evaluation (blocks, mobs, chests, bosses).
 */
import type { Random } from '../math/rng';
import { itemById, items } from '../registry/items';
import { stackOf, type ItemStack } from './itemstack';
import { selectEnchantments } from './enchanting';
import { ENCHANTMENTS } from '../data/enchantments';
import { LOOT_TABLES } from '../data/loot';

export type Range = number | [number, number];

export type LootCondition =
  | { c: 'chance'; chance: number; lootingBonus?: number }
  | { c: 'killed_by_player' }
  | { c: 'on_fire' }
  | { c: 'not_on_fire' }
  | { c: 'silk_touch' }
  | { c: 'no_silk_touch' }
  | { c: 'max_age' }
  | { c: 'not_max_age' }
  | { c: 'difficulty'; min: 'easy' | 'normal' | 'hard' };

export type LootFunction =
  | { fn: 'damage'; min: number; max: number }
  | { fn: 'enchant_randomly'; treasure?: boolean }
  | { fn: 'enchant_levels'; levels: Range; treasure?: boolean }
  | { fn: 'looting'; min: number; max: number; limit?: number }
  | { fn: 'fortune_ore' }
  | { fn: 'fortune_binomial'; extra: number; p: number }
  | { fn: 'smelt' }
  | { fn: 'potion'; potion: string }
  | { fn: 'name'; name: string }
  /** A specific enchantment (on a book: stored) at a level in the range. */
  | { fn: 'set_enchant'; id: string; levels: Range };

export interface LootEntry {
  item?: string;
  table?: string;
  empty?: boolean;
  weight?: number;
  count?: Range;
  functions?: LootFunction[];
  conditions?: LootCondition[];
}

export interface LootPool {
  rolls: Range;
  entries: LootEntry[];
  conditions?: LootCondition[];
}

export interface LootTable {
  pools: LootPool[];
  xp?: Range;
}

export interface LootContext {
  rng: Random;
  looting?: number;
  fortune?: number;
  silkTouch?: boolean;
  killedByPlayer?: boolean;
  onFire?: boolean;
  maxAge?: boolean;
  difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard';
  luck?: number;
}

const SMELT: Record<string, string> = {
  beef: 'cooked_beef',
  porkchop: 'cooked_porkchop',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
  rabbit: 'cooked_rabbit',
  cod: 'cooked_cod',
  salmon: 'cooked_salmon',
};

function roll(r: Range, rng: Random): number {
  return typeof r === 'number' ? r : rng.range(r[0], r[1]);
}

function checkConds(conds: LootCondition[] | undefined, ctx: LootContext): boolean {
  if (!conds) return true;
  const diffOrder = { peaceful: 0, easy: 1, normal: 2, hard: 3 };
  for (const c of conds) {
    switch (c.c) {
      case 'chance':
        if (ctx.rng.next() >= c.chance + (c.lootingBonus ?? 0) * (ctx.looting ?? 0)) return false;
        break;
      case 'killed_by_player':
        if (!ctx.killedByPlayer) return false;
        break;
      case 'on_fire':
        if (!ctx.onFire) return false;
        break;
      case 'not_on_fire':
        if (ctx.onFire) return false;
        break;
      case 'silk_touch':
        if (!ctx.silkTouch) return false;
        break;
      case 'no_silk_touch':
        if (ctx.silkTouch) return false;
        break;
      case 'max_age':
        if (!ctx.maxAge) return false;
        break;
      case 'not_max_age':
        if (ctx.maxAge) return false;
        break;
      case 'difficulty':
        if (diffOrder[ctx.difficulty ?? 'normal'] < diffOrder[c.min]) return false;
        break;
    }
  }
  return true;
}

function applyFns(stack: ItemStack, fns: LootFunction[] | undefined, ctx: LootContext): ItemStack | null {
  if (!fns) return stack;
  for (const f of fns) {
    switch (f.fn) {
      case 'damage': {
        const it = itemById.get(itemIdOf(stack));
        const dur = it?.def.durability;
        if (dur) stack.damage = Math.floor(dur * (1 - ctx.rng.float(f.min, f.max)));
        break;
      }
      case 'enchant_randomly': {
        const it = itemById.get(itemIdOf(stack))!;
        const opts = ENCHANTMENTS.filter((e) => (f.treasure || !e.treasure) && !e.exclusive && (it.id === 'book' || e.targets.length > 0));
        const e = ctx.rng.pick(opts);
        const lvl = ctx.rng.range(1, e.maxLevel);
        if (it.id === 'book') {
          stack.id = itemById.get('enchanted_book')!.num;
          stack.tag = { ...(stack.tag ?? {}), stored: { [e.id]: lvl } };
        } else {
          stack.tag = { ...(stack.tag ?? {}), ench: { [e.id]: lvl } };
        }
        break;
      }
      case 'enchant_levels': {
        const lv = roll(f.levels, ctx.rng);
        const it = itemById.get(itemIdOf(stack))!;
        const res = selectEnchantments(ctx.rng, stack, lv, f.treasure);
        if (Object.keys(res).length) {
          if (it.id === 'book') {
            stack.id = itemById.get('enchanted_book')!.num;
            stack.tag = { ...(stack.tag ?? {}), stored: res };
          } else stack.tag = { ...(stack.tag ?? {}), ench: res };
        }
        break;
      }
      case 'looting': {
        const n = ctx.looting ?? 0;
        if (n > 0) stack.count += Math.floor(ctx.rng.next() * (n * (f.max - f.min + 1))) + (f.min > 0 ? n * f.min : 0);
        if (f.limit) stack.count = Math.min(stack.count, f.limit);
        break;
      }
      case 'fortune_ore': {
        const n = ctx.fortune ?? 0;
        if (n > 0) {
          const bonus = ctx.rng.int(n + 2) - 1;
          if (bonus > 0) stack.count *= bonus + 1;
        }
        break;
      }
      case 'fortune_binomial': {
        const n = (ctx.fortune ?? 0) + f.extra;
        for (let i = 0; i < n; i++) if (ctx.rng.next() < f.p) stack.count++;
        break;
      }
      case 'smelt':
        if (ctx.onFire) {
          const cooked = SMELT[itemIdOf(stack)];
          if (cooked) stack.id = itemById.get(cooked)!.num;
        }
        break;
      case 'potion':
        stack.tag = { ...(stack.tag ?? {}), potion: f.potion };
        break;
      case 'name':
        stack.tag = { ...(stack.tag ?? {}), name: f.name };
        break;
      case 'set_enchant': {
        const lvl = roll(f.levels, ctx.rng);
        if (itemIdOf(stack) === 'book') {
          stack.id = itemById.get('enchanted_book')!.num;
          stack.tag = { ...(stack.tag ?? {}), stored: { [f.id]: lvl } };
        } else stack.tag = { ...(stack.tag ?? {}), ench: { ...(stack.tag?.ench ?? {}), [f.id]: lvl } };
        break;
      }
    }
  }
  return stack.count > 0 ? stack : null;
}

function itemIdOf(s: ItemStack): string {
  return items[s.id]?.id ?? 'air';
}

/** Evaluates a loot table into item stacks. Unknown tables yield nothing. */
export function rollLoot(tableId: string, ctx: LootContext, depth = 0): ItemStack[] {
  const table = LOOT_TABLES[tableId];
  if (!table || depth > 4) return [];
  const out: ItemStack[] = [];
  for (const pool of table.pools) {
    if (!checkConds(pool.conditions, ctx)) continue;
    const rolls = roll(pool.rolls, ctx.rng) + Math.floor(ctx.luck ?? 0);
    for (let r = 0; r < rolls; r++) {
      const valid = pool.entries.filter((e) => checkConds(e.conditions, ctx));
      if (valid.length === 0) continue;
      const e = ctx.rng.weighted(valid.map((v) => ({ ...v, weight: v.weight ?? 1 })));
      if (e.empty) continue;
      if (e.table) {
        out.push(...rollLoot(e.table, ctx, depth + 1));
        continue;
      }
      if (!e.item || !itemById.has(e.item)) continue;
      const count = roll(e.count ?? 1, ctx.rng);
      if (count <= 0) continue;
      const st = applyFns(stackOf(e.item, count), e.functions, ctx);
      if (st) out.push(st);
    }
  }
  return out;
}

export function rollXp(tableId: string, rng: Random): number {
  const t = LOOT_TABLES[tableId];
  return t?.xp ? roll(t.xp, rng) : 0;
}

export function hasLootTable(id: string): boolean {
  return id in LOOT_TABLES;
}
