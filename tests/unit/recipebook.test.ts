import { describe, it, expect, afterEach } from 'vitest';
import { initItems, itemById } from '../../src/common/registry/items';
import { recipeBook, resetRecipeBook, entryState, countItems, filterBook, categoryOf, type BookEntry } from '../../src/common/game/recipeBook';
import { recipes, resetRecipes } from '../../src/common/game/crafting';
import { CRAFTING, SMELTING, STONECUTTING, SMITHING } from '../../src/common/data/recipes';
import { stackOf, type ItemStack } from '../../src/common/game/itemstack';

initItems();
const num = (id: string): number => itemById.get(id)!.num;
const byResult = (id: string, station = 'crafting'): BookEntry[] => recipeBook().filter((e) => e.result.id === num(id) && e.station === station);

describe('recipe book contents', () => {
  it('contains every registered crafting recipe', () => {
    const book = recipeBook();
    const crafting = book.filter((e) => e.station === 'crafting');
    expect(crafting.length).toBe(recipes().length);
    const ids = new Set(crafting.map((e) => e.id));
    for (const r of recipes()) expect(ids.has(`craft:${r.index}`)).toBe(true);
  });

  it('includes smelting, stonecutting, smithing, brewing, anvil and enchanting', () => {
    const book = recipeBook();
    const count = (s: string) => book.filter((e) => e.station === s).length;
    expect(count('furnace')).toBe(SMELTING.filter((s) => itemById.has(s.input) && itemById.has(s.result)).length);
    expect(count('stonecutter')).toBe(STONECUTTING.filter((s) => itemById.has(s.input) && itemById.has(s.result)).length);
    expect(count('smithing')).toBe(SMITHING.filter((s) => itemById.has(s.base) && itemById.has(s.addition) && itemById.has(s.result)).length);
    expect(count('brewing')).toBeGreaterThan(30);
    expect(count('anvil')).toBeGreaterThan(3);
    expect(count('enchanting')).toBe(1);
    // Ores smelt in the blast furnace too, food in the smoker
    const iron = book.find((e) => e.station === 'furnace' && e.result.id === num('iron_ingot'))!;
    expect(iron.stations).toEqual(['furnace', 'blast_furnace']);
    const steak = book.find((e) => e.station === 'furnace' && e.result.id === num('cooked_beef'))!;
    expect(steak.stations).toContain('smoker');
    // Brewing entries carry the potion type
    const nv = book.find((e) => e.station === 'brewing' && e.result.tag?.potion === 'night_vision')!;
    expect(nv.requirements.map((r) => r.label)).toContain('Golden Carrot');
    expect(nv.requirements[0]!.potion).toBe('awkward');
  });

  it('shows the layout, ingredients and quantities', () => {
    const stick = byResult('stick')[0]!;
    expect(stick.result.count).toBe(4);
    expect(stick.requirements).toHaveLength(1);
    expect(stick.requirements[0]!.label).toBe('Any Planks');
    expect(stick.requirements[0]!.count).toBe(2);
    expect(stick.requirements[0]!.options.length).toBeGreaterThan(8);
    expect(stick.fits2x2).toBe(true);
    const pick = byResult('iron_pickaxe')[0]!;
    // MMM / .S. / .S.
    const g = pick.grid!;
    const ingot = pick.requirements.findIndex((r) => r.label === 'Iron Ingot');
    const s = pick.requirements.findIndex((r) => r.label === 'Stick');
    expect(g).toEqual([ingot, ingot, ingot, null, s, null, null, s, null]);
    expect(pick.requirements[ingot]!.count).toBe(3);
    expect(pick.requirements[s]!.count).toBe(2);
    expect(pick.fits2x2).toBe(false);
    const eye = byResult('ender_eye')[0]!;
    expect(eye.shapeless).toBe(true);
  });

  it('sorts results into useful categories', () => {
    const cat = (id: string) => categoryOf(itemById.get(id)!);
    expect(cat('diamond_pickaxe')).toBe('tools');
    expect(cat('diamond_sword')).toBe('weapons');
    expect(cat('bow')).toBe('weapons');
    expect(cat('diamond_chestplate')).toBe('armor');
    expect(cat('shield')).toBe('armor');
    expect(cat('bread')).toBe('food');
    expect(cat('lever')).toBe('redstone');
    expect(cat('stone_pressure_plate')).toBe('redstone');
    expect(cat('oak_door')).toBe('redstone');
    expect(cat('brewing_stand')).toBe('brewing');
    expect(cat('oak_stairs')).toBe('building');
    expect(cat('crafting_table')).toBe('utilities');
    expect(cat('stick')).toBe('other');
  });
});

describe('recipe book search and filters', () => {
  it('finds recipes by result or ingredient name', () => {
    const book = recipeBook();
    const hits = filterBook(book, { query: 'diamond pickaxe' });
    expect(hits.some((e) => e.result.id === num('diamond_pickaxe'))).toBe(true);
    expect(hits.every((e) => e.search.includes('diamond') && e.search.includes('pickaxe'))).toBe(true);
    // ingredient search
    const withBlaze = filterBook(book, { query: 'blaze rod' });
    expect(withBlaze.some((e) => e.result.id === num('blaze_powder'))).toBe(true);
    expect(filterBook(book, { query: 'zzzz-no-such-thing' })).toHaveLength(0);
  });

  it('filters by category', () => {
    const tools = filterBook(recipeBook(), { category: 'tools' });
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.every((e) => e.category === 'tools')).toBe(true);
    expect(tools.some((e) => e.result.id === num('iron_pickaxe'))).toBe(true);
  });

  it('can show only craftable recipes, craftable first', () => {
    const book = recipeBook();
    const counts = countItems([stackOf('oak_planks', 8)]);
    const states = new Map(book.map((e) => [e.id, entryState(e, counts, 'player')]));
    const only = filterBook(book, { craftableOnly: true, states });
    expect(only.some((e) => e.result.id === num('stick'))).toBe(true);
    expect(only.some((e) => e.result.id === num('diamond_pickaxe'))).toBe(false);
    const all = filterBook(book, { states });
    expect(states.get(all[0]!.id)!.status).toBe('ready');
  });
});

describe('recipe book craftability', () => {
  const state = (id: string, slots: ItemStack[], window = 'player') => entryState(byResult(id)[0]!, countItems(slots), window);

  it('reports missing ingredients with quantities', () => {
    const s = state('crafting_table', [stackOf('oak_planks', 3)]);
    expect(s.status).toBe('missing');
    expect(s.missing).toEqual([{ label: 'Any Planks', need: 4, have: 3 }]);
    expect(state('crafting_table', [stackOf('oak_planks', 2), stackOf('birch_planks', 2)]).status).toBe('ready');
  });

  it('knows which recipes need a crafting table', () => {
    expect(state('chest', [stackOf('oak_planks', 8)], 'player').status).toBe('station');
    expect(state('chest', [stackOf('oak_planks', 8)], 'crafting').status).toBe('ready');
    expect(state('stick', [stackOf('oak_planks', 2)], 'player').status).toBe('ready');
  });

  it('updates when the inventory changes', () => {
    const e = byResult('iron_pickaxe')[0]!;
    const inv: ItemStack[] = [stackOf('iron_ingot', 3)];
    expect(entryState(e, countItems(inv), 'crafting').missing.map((m) => m.label)).toEqual(['Stick']);
    inv.push(stackOf('stick', 2));
    expect(entryState(e, countItems(inv), 'crafting').status).toBe('ready');
  });

  it('does not count one item for two ingredients', () => {
    // Torch: coal or charcoal + stick; a stack of sticks alone is not enough
    const torch = byResult('torch')[0]!;
    expect(entryState(torch, countItems([stackOf('stick', 5)]), 'player').status).toBe('missing');
  });

  it('checks potion types for brewing', () => {
    const e = recipeBook().find((x) => x.station === 'brewing' && x.result.tag?.potion === 'awkward')!;
    const water = { ...stackOf('potion', 1), tag: { potion: 'water' } };
    const other = { ...stackOf('potion', 1), tag: { potion: 'thick' } };
    expect(entryState(e, countItems([water, stackOf('nether_wart', 1), stackOf('blaze_powder', 1)]), 'brewing').status).toBe('ready');
    expect(entryState(e, countItems([other, stackOf('nether_wart', 1), stackOf('blaze_powder', 1)]), 'brewing').status).toBe('missing');
  });
});

describe('recipe book registry', () => {
  afterEach(() => {
    resetRecipes();
    resetRecipeBook();
  });

  it('picks up newly registered recipes automatically', () => {
    const before = recipeBook().filter((e) => e.station === 'crafting').length;
    CRAFTING.push({ type: 'shapeless', ingredients: ['dirt', 'dirt', 'dirt'], result: 'diamond', count: 1 });
    try {
      resetRecipes();
      resetRecipeBook();
      const after = recipeBook().filter((e) => e.station === 'crafting');
      expect(after.length).toBe(before + 1);
      const added = after.find((e) => e.id === `craft:${CRAFTING.length - 1}`)!;
      expect(added.result.id).toBe(num('diamond'));
      expect(added.requirements).toEqual([expect.objectContaining({ label: 'Dirt', count: 3 })]);
    } finally {
      CRAFTING.pop();
    }
  });
});
