/** V5 catalogue: every engineering block, item, recipe and machine recipe resolves; engineering stays out of normal crafting. */
import { describe, it, expect } from 'vitest';
import { initItems, itemById } from '../../src/common/registry/items';
import { blockById } from '../../src/common/registry/blocks';
import { COMPONENTS, ENG_CRAFTING, MACHINE_RECIPES, MULTIBLOCKS, ENG_MATERIALS, UPGRADES, RECYCLABLE } from '../../src/common/engineering/catalog';
import { engRecipes, recipes } from '../../src/common/game/crafting';
import { CRAFTING } from '../../src/common/data/recipes';

initItems();

describe('V5 engineering catalogue', () => {
  it('has a block and an item for every component', () => {
    for (const c of COMPONENTS) {
      expect(blockById.has(c.id), c.id).toBe(true);
      expect(itemById.has(c.id), c.id + ' item').toBe(true);
    }
    for (const id of [...ENG_MATERIALS, ...UPGRADES, 'engineering_book']) expect(itemById.has(id), id).toBe(true);
  });

  it('compiles every Engineering Crafting Table recipe', () => {
    const compiled = engRecipes();
    const missing = ENG_CRAFTING.filter((_, i) => !compiled.some((r) => r.index === i)).map((r) => r.result);
    expect(missing).toEqual([]);
  });

  it('makes every engineering item at the Engineering Crafting Table, and none at a normal table (except the table and the book)', () => {
    const engResults = new Set(ENG_CRAFTING.map((r) => r.result));
    for (const c of COMPONENTS) if (c.id !== 'engineering_table') expect(engResults.has(c.id), c.id).toBe(true);
    const normal = new Set(CRAFTING.map((r) => r.result));
    for (const c of COMPONENTS) if (c.id !== 'engineering_table') expect(normal.has(c.id), c.id).toBe(false);
    for (const id of [...ENG_MATERIALS, ...UPGRADES]) expect(normal.has(id), id).toBe(false);
    expect(normal.has('engineering_table')).toBe(true);
    expect(normal.has('engineering_book')).toBe(true);
    expect(recipes().length).toBeGreaterThan(100);
  });

  it('only names real items in machine recipes and multiblocks', () => {
    for (const [set, list] of Object.entries(MACHINE_RECIPES))
      for (const r of list) {
        expect(itemById.has(r.input), `${set}: ${r.input}`).toBe(true);
        expect(itemById.has(r.output), `${set}: ${r.output}`).toBe(true);
        if (r.bonus) expect(itemById.has(r.bonus.item)).toBe(true);
      }
    for (const id of RECYCLABLE) expect(itemById.has(id), id).toBe(true);
    for (const [id, m] of Object.entries(MULTIBLOCKS)) {
      expect(blockById.has(id)).toBe(true);
      for (const p of m.parts) for (const b of [p.block].flat()) expect(b === 'air' || blockById.has(b), `${id}: ${b}`).toBe(true);
    }
  });

  it('no longer crafts redstone torches or places redstone dust', () => {
    expect(CRAFTING.some((r) => r.result === 'redstone_torch')).toBe(false);
    expect(itemById.get('redstone')!.def.block).toBeUndefined();
    expect(blockById.has('redstone_wire')).toBe(true);
    expect(blockById.has('redstone_torch')).toBe(true);
  });
});
