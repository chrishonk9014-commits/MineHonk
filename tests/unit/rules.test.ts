import { describe, it, expect } from 'vitest';
import { initItems, itemById } from '../../src/common/registry/items';
import { S, stateOf } from '../../src/common/registry/blocks';
import { breakTicks, canHarvest } from '../../src/common/game/mining';
import { computeBlockDrops } from '../../src/common/game/drops';
import { stackOf } from '../../src/common/game/itemstack';
import { Random } from '../../src/common/math/rng';
import { LOOT_TABLES } from '../../src/common/data/loot';
import { rollLoot } from '../../src/common/game/loot';

initItems();
const ctx = (tool: string | null) => ({ tool: tool ? stackOf(tool) : null, onGround: true, underwater: false, aquaAffinity: false, haste: 0, fatigue: 0, creative: false });

describe('mining rules', () => {
  it('stone by hand is slow and yields nothing', () => {
    expect(breakTicks(S('stone'), ctx(null))).toBe(150);
    expect(canHarvest(S('stone'), null)).toBe(false);
    expect(computeBlockDrops(S('stone'), null, new Random(1)).items).toHaveLength(0);
  });
  it('wooden pickaxe mines stone into cobblestone', () => {
    expect(breakTicks(S('stone'), ctx('wooden_pickaxe'))).toBe(23);
    const d = computeBlockDrops(S('stone'), stackOf('wooden_pickaxe'), new Random(1));
    expect(d.items[0]?.id).toBe(itemById.get('cobblestone')!.num);
  });
  it('diamond ore needs an iron pickaxe', () => {
    expect(canHarvest(S('diamond_ore'), stackOf('stone_pickaxe'))).toBe(false);
    expect(canHarvest(S('diamond_ore'), stackOf('iron_pickaxe'))).toBe(true);
    const d = computeBlockDrops(S('diamond_ore'), stackOf('iron_pickaxe'), new Random(3));
    expect(d.items[0]?.id).toBe(itemById.get('diamond')!.num);
    expect(d.xp).toBeGreaterThanOrEqual(3);
  });
  it('silk touch keeps the ore block', () => {
    const pick = stackOf('diamond_pickaxe', 1, { tag: { ench: { silk_touch: 1 } } });
    const d = computeBlockDrops(S('diamond_ore'), pick, new Random(3));
    expect(d.items[0]?.id).toBe(itemById.get('diamond_ore')!.num);
    expect(d.xp).toBe(0);
  });
  it('dirt breaks quickly by hand and drops dirt', () => {
    expect(breakTicks(S('dirt'), ctx(null))).toBe(15);
    expect(computeBlockDrops(S('grass_block'), null, new Random(1)).items[0]?.id).toBe(itemById.get('dirt')!.num);
  });
  it('bedrock is unbreakable, creative is instant', () => {
    expect(breakTicks(S('bedrock'), ctx(null))).toBe(Infinity);
    expect(breakTicks(S('obsidian'), { ...ctx(null), creative: true })).toBe(0);
  });
  it('mature wheat drops wheat and seeds', () => {
    const d = computeBlockDrops(stateOf('wheat', { age: 7 }), null, new Random(9));
    expect(d.items.some((s) => s.id === itemById.get('wheat')!.num)).toBe(true);
  });
});

describe('loot tables', () => {
  it('reference only known items (for weighted entries)', () => {
    const missing: string[] = [];
    for (const [id, t] of Object.entries(LOOT_TABLES)) {
      for (const p of t.pools) for (const e of p.entries) if (e.item && (e.weight ?? 1) > 0 && !itemById.has(e.item)) missing.push(`${id}:${e.item}`);
    }
    expect(missing).toEqual([]);
  });
  it('roll deterministic with seed', () => {
    const a = rollLoot('chest/dungeon', { rng: new Random(5) });
    const b = rollLoot('chest/dungeon', { rng: new Random(5) });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

import { CRAFTING, SMELTING } from '../../src/common/data/recipes';
import { matchCrafting, recipes, smeltingFor } from '../../src/common/game/crafting';
describe('crafting', () => {
  it('all recipe results and ingredients resolve', () => {
    const bad: string[] = [];
    const known = (id: string) => id.startsWith('#') || itemById.has(id);
    for (const r of CRAFTING) {
      if (!itemById.has(r.result)) bad.push('result:' + r.result);
      const ings = r.type === 'shaped' ? Object.values(r.key) : r.ingredients;
      for (const i of ings) if (!known(i)) bad.push(`${r.result}<-${i}`);
    }
    for (const s of SMELTING) {
      if (!itemById.has(s.input)) bad.push('smelt in:' + s.input);
      if (!itemById.has(s.result)) bad.push('smelt out:' + s.result);
    }
    expect(bad).toEqual([]);
    expect(recipes().length).toBe(CRAFTING.length);
  });
  it('matches planks, crafting table, pickaxe (mirrored axe)', () => {
    const g = (ids: (string | null)[]) => ids.map((i) => (i ? stackOf(i) : null));
    expect(matchCrafting(g(['oak_log', null, null, null]), 2, 2)?.result).toBe(itemById.get('oak_planks')!.num);
    expect(matchCrafting(g(['oak_planks', 'birch_planks', 'spruce_planks', 'oak_planks']), 2, 2)?.result).toBe(itemById.get('crafting_table')!.num);
    const pick = g(['cobblestone', 'cobblestone', 'cobbled_deepslate', null, 'stick', null, null, 'stick', null]);
    expect(matchCrafting(pick, 3, 3)?.result).toBe(itemById.get('stone_pickaxe')!.num);
    const axeMirror = g(['iron_ingot', 'iron_ingot', null, 'stick', 'iron_ingot', null, 'stick', null, null]);
    expect(matchCrafting(axeMirror, 3, 3)?.result).toBe(itemById.get('iron_axe')!.num);
    expect(matchCrafting(g(['stick', null, null, null]), 2, 2)).toBeNull();
  });
  it('smelts raw iron', () => {
    expect(smeltingFor(itemById.get('raw_iron')!.num)?.resultNum).toBe(itemById.get('iron_ingot')!.num);
  });
});
