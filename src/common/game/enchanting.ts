/** Enchantment helpers: queries on item stacks and the table/anvil logic. */
import { ENCHANTMENTS, ENCHANT_BY_ID, type EnchantDef, type EnchantTarget } from '../data/enchantments';
import { items } from '../registry/items';
import type { ItemStack } from './itemstack';
import type { Random } from '../math/rng';

export function enchantLevel(s: ItemStack | null | undefined, id: string): number {
  return s?.tag?.ench?.[id] ?? 0;
}

export function itemTargets(s: ItemStack): Set<EnchantTarget> {
  const d = items[s.id]!.def;
  const out = new Set<EnchantTarget>();
  if (d.durability) out.add('breakable');
  if (d.armor) {
    out.add('armor');
    out.add(({ head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' } as const)[d.armor.slot]);
  }
  const tt = d.tool?.type;
  if (tt === 'sword') {
    out.add('sword');
    out.add('weapon');
  }
  if (tt === 'axe') out.add('weapon');
  if (tt === 'pickaxe' || tt === 'axe' || tt === 'shovel' || tt === 'hoe') out.add('digger');
  if (tt === 'pickaxe') out.add('pickaxe');
  if (tt === 'axe') out.add('axe');
  if (d.use === 'bow') out.add('bow');
  if (d.use === 'crossbow') out.add('crossbow');
  if (d.use === 'trident') out.add('trident');
  if (d.use === 'fishing_rod') out.add('fishing_rod');
  return out;
}

export function canApply(e: EnchantDef, s: ItemStack): boolean {
  if (items[s.id]!.id === 'book' || items[s.id]!.id === 'enchanted_book') return true;
  const t = itemTargets(s);
  return e.targets.some((x) => t.has(x));
}

export function compatible(a: string, b: string): boolean {
  if (a === b) return false;
  const da = ENCHANT_BY_ID.get(a);
  const db = ENCHANT_BY_ID.get(b);
  return !(da?.conflicts?.includes(b) || db?.conflicts?.includes(a));
}

/** Table enchanting: pick enchantments for a given cost level (classic algorithm, simplified). */
export function selectEnchantments(rng: Random, s: ItemStack, level: number, allowTreasure = false): Record<string, number> {
  const d = items[s.id]!.def;
  const ench = d.enchantability ?? (items[s.id]!.id === 'book' ? 1 : 0);
  if (ench <= 0) return {};
  let mod = level + 1 + rng.int(Math.floor(ench / 4) + 1) + rng.int(Math.floor(ench / 4) + 1);
  const bonus = 1 + (rng.next() + rng.next() - 1) * 0.15;
  mod = Math.max(1, Math.round(mod * bonus));
  const candidates = (): { e: EnchantDef; lvl: number; weight: number }[] => {
    const out: { e: EnchantDef; lvl: number; weight: number }[] = [];
    for (const e of ENCHANTMENTS) {
      if ((e.treasure && !allowTreasure) || e.exclusive || !canApply(e, s)) continue;
      for (let l = e.maxLevel; l >= 1; l--) {
        if (mod >= e.minCost(l) && mod <= e.maxCost(l)) {
          out.push({ e, lvl: l, weight: e.weight });
          break;
        }
      }
    }
    return out;
  };
  const result: Record<string, number> = {};
  let pool = candidates();
  if (pool.length === 0) return result;
  const first = rng.weighted(pool);
  result[first.e.id] = first.lvl;
  while (rng.next() < (mod + 1) / 50) {
    pool = pool.filter((c) => Object.keys(result).every((k) => compatible(k, c.e.id)));
    if (pool.length === 0) break;
    const pick = rng.weighted(pool);
    result[pick.e.id] = pick.lvl;
    mod = Math.floor(mod / 2);
  }
  return result;
}

/** Enchanting table cost levels for the three options given bookshelf count. */
export function tableCosts(rng: Random, bookshelves: number, enchantability: number): [number, number, number] {
  if (enchantability <= 0) return [0, 0, 0];
  const b = Math.min(15, bookshelves);
  const base = rng.int(8) + 1 + (b >> 1) + rng.int(b + 1);
  return [Math.max(Math.floor(base / 3), 1), Math.floor((base * 2) / 3) + 1, Math.max(base, b * 2)];
}

export function enchantName(id: string): string {
  return ENCHANT_BY_ID.get(id)?.name ?? id;
}
