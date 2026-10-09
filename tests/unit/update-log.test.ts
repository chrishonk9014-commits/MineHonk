/** The Update Log (Options > Update Log): every picture, item, recipe, advancement and link it shows exists. */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { UPDATE_LOG, entryImages, entryItems, imageUrl, advancementIcon } from '../../src/client/ui/updateLog';
import { initItems, itemById } from '../../src/common/registry/items';
import { engRecipes, recipes } from '../../src/common/game/crafting';
import { ACHIEVEMENTS } from '../../src/common/data/achievements';

initItems();

describe('the Update Log', () => {
  it('starts with V6, The End Expansion, and covers the new End and multiplayer', () => {
    const v6 = UPDATE_LOG[0]!;
    expect([v6.version, v6.name]).toEqual(['V6', 'The End Expansion']);
    const ids = v6.sections.map((s) => s.id);
    for (const id of ['overview', 'portal', 'biomes', 'mobs', 'resources', 'structures', 'ancient', 'nest', 'engineering', 'quests', 'elytra', 'events', 'dragon', 'citadel', 'guardian', 'advancements', 'multiplayer']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const entry of UPDATE_LOG) {
    it(`${entry.version}: every picture is in public/ and small`, () => {
      const images = entryImages(entry);
      expect(images.length).toBeGreaterThan(50);
      for (const name of images) {
        const file = `public/${imageUrl(entry, name)}`;
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeLessThan(250 * 1024);
      }
    });

    it(`${entry.version}: every item, recipe, advancement and link exists`, () => {
      for (const id of entryItems(entry)) expect(itemById.has(id), id).toBe(true);
      const sections = new Set(entry.sections.map((s) => s.id));
      for (const s of entry.sections)
        for (const b of s.blocks) {
          if (b.k === 'cards') for (const c of b.items) if (c.link) expect(sections.has(c.link), c.link).toBe(true);
          if (b.k === 'example' && b.recipe) {
            const n = itemById.get(b.recipe)!.num;
            expect(recipes().some((r) => r.result === n) || engRecipes().some((r) => r.result === n), b.recipe).toBe(true);
          }
          if (b.k === 'advancements') {
            const i0 = ACHIEVEMENTS.findIndex((a) => a.id === b.from);
            const i1 = ACHIEVEMENTS.findIndex((a) => a.id === b.to);
            expect(i0, b.from).toBeGreaterThanOrEqual(0);
            expect(i1, b.to).toBeGreaterThan(i0);
            for (const a of ACHIEVEMENTS.slice(i0, i1 + 1)) {
              expect(a.category).toBe('end');
              expect(itemById.has(advancementIcon(a.icon)), a.icon).toBe(true);
            }
          }
        }
    });
  }
});
