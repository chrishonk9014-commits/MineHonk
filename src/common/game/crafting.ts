/**
 * Recipe matching for crafting grids, furnaces, stonecutters and smithing.
 * Resolves ingredient tags to item ids at init time for fast matching.
 */
import { CRAFTING, SMELTING, STONECUTTING, SMITHING, RECIPE_TAGS, EXTRA_FUEL, type SmeltRecipe, type ShapedRecipe, type ShapelessRecipe } from '../data/recipes';
import { ENG_CRAFTING } from '../engineering/catalog';
import { items, itemById, initItems } from '../registry/items';
import type { ItemStack, Slot } from './itemstack';

export interface CompiledRecipe {
  index: number;
  shaped: boolean;
  width: number;
  height: number;
  /** Shaped: per-cell allowed item nums (null = empty). Shapeless: list of ingredient sets. */
  cells: (Set<number> | null)[];
  result: number;
  count: number;
}

let compiled: CompiledRecipe[] | null = null;
let compiledEng: CompiledRecipe[] | null = null;
let smeltIndex: Map<number, SmeltRecipe & { resultNum: number }> | null = null;

function resolve(ing: string): Set<number> {
  const out = new Set<number>();
  if (ing.startsWith('#')) {
    const tag = ing.slice(1);
    const extra = RECIPE_TAGS[tag];
    if (extra) for (const id of extra) if (itemById.has(id)) out.add(itemById.get(id)!.num);
    for (const it of items) if (it.tags.has(tag)) out.add(it.num);
  } else if (itemById.has(ing)) out.add(itemById.get(ing)!.num);
  return out;
}

/** Forgets compiled recipes so recipes registered at runtime are picked up. */
export function resetRecipes(): void {
  compiled = null;
  compiledEng = null;
  smeltIndex = null;
}

function compile(list: readonly (ShapedRecipe | ShapelessRecipe)[]): CompiledRecipe[] {
  initItems();
  const out: CompiledRecipe[] = [];
  list.forEach((r, index) => {
    if (!itemById.has(r.result)) return;
    const result = itemById.get(r.result)!.num;
    if (r.type === 'shaped') {
      const h = r.pattern.length;
      const w = Math.max(...r.pattern.map((p) => p.length));
      const cells: (Set<number> | null)[] = [];
      let ok = true;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = r.pattern[y]![x] ?? ' ';
          if (ch === ' ') cells.push(null);
          else {
            const set = resolve(r.key[ch]!);
            if (set.size === 0) ok = false;
            cells.push(set);
          }
        }
      }
      if (ok) out.push({ index, shaped: true, width: w, height: h, cells, result, count: r.count ?? 1 });
    } else {
      const cells = r.ingredients.map(resolve);
      if (cells.every((c) => c.size > 0)) out.push({ index, shaped: false, width: 0, height: 0, cells, result, count: r.count ?? 1 });
    }
  });
  return out;
}

/** Crafting table and inventory recipes. */
export function recipes(): CompiledRecipe[] {
  return (compiled ??= compile(CRAFTING));
}

/** V5: Engineering Crafting Table recipes (a separate list: never matched by the normal table). */
export function engRecipes(): CompiledRecipe[] {
  return (compiledEng ??= compile(ENG_CRAFTING));
}

/** Finds the recipe matching a grid (row-major, size gw*gh). */
export function matchCrafting(grid: Slot[], gw: number, gh: number, list: CompiledRecipe[] = recipes()): CompiledRecipe | null {
  // bounding box of non-empty cells
  let minX = gw;
  let minY = gh;
  let maxX = -1;
  let maxY = -1;
  const nonEmpty: ItemStack[] = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const s = grid[y * gw + x];
      if (s && s.count > 0) {
        nonEmpty.push(s);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (nonEmpty.length === 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  for (const r of list) {
    if (r.shaped) {
      if (r.width !== bw || r.height !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++) {
          for (let x = 0; x < bw && ok; x++) {
            const rx = mirror ? bw - 1 - x : x;
            const cell = r.cells[y * bw + rx]!;
            const s = grid[(minY + y) * gw + (minX + x)];
            if (!cell) ok = !s || s.count <= 0;
            else ok = !!s && s.count > 0 && cell.has(s.id);
          }
        }
        if (ok) return r;
      }
    } else {
      if (r.cells.length !== nonEmpty.length) continue;
      const used = new Array(nonEmpty.length).fill(false);
      let ok = true;
      for (const cell of r.cells) {
        const i = nonEmpty.findIndex((s, k) => !used[k] && cell!.has(s.id));
        if (i < 0) {
          ok = false;
          break;
        }
        used[i] = true;
      }
      if (ok) return r;
    }
  }
  return null;
}

/** Items left in the grid after crafting (buckets from milk etc). */
export function craftingRemainder(s: ItemStack): ItemStack | null {
  const id = items[s.id]!.id;
  if (id === 'milk_bucket' || id === 'water_bucket' || id === 'lava_bucket') return { id: itemById.get('bucket')!.num, count: 1 };
  if (id === 'honey_bottle') return { id: itemById.get('glass_bottle')!.num, count: 1 };
  // The Corrupted Eye is only ever lent to a recipe (it can't be replaced)
  if (id === 'corrupted_eye') return { ...s, count: 1 };
  return null;
}

export function smeltingFor(itemNum: number): (SmeltRecipe & { resultNum: number }) | null {
  if (!smeltIndex) {
    initItems();
    smeltIndex = new Map();
    for (const r of SMELTING) {
      const inp = itemById.get(r.input);
      const res = itemById.get(r.result);
      if (inp && res) smeltIndex.set(inp.num, { ...r, resultNum: res.num });
    }
  }
  return smeltIndex.get(itemNum) ?? null;
}

export function fuelTicks(s: ItemStack | null): number {
  if (!s) return 0;
  const it = items[s.id]!;
  return it.def.fuel ?? EXTRA_FUEL[it.id] ?? 0;
}

export function stonecutterOptions(itemNum: number): { result: number; count: number }[] {
  const id = items[itemNum]?.id;
  return STONECUTTING.filter((r) => r.input === id && itemById.has(r.result)).map((r) => ({ result: itemById.get(r.result)!.num, count: r.count }));
}

export function smithingResult(base: ItemStack | null, addition: ItemStack | null): number | null {
  if (!base || !addition) return null;
  const b = items[base.id]!.id;
  const a = items[addition.id]!.id;
  const r = SMITHING.find((x) => x.base === b && x.addition === a);
  return r && itemById.has(r.result) ? itemById.get(r.result)!.num : null;
}

/** All recipes producing an item (recipe book). */
export function recipesFor(itemNum: number): CompiledRecipe[] {
  return recipes().filter((r) => r.result === itemNum);
}
