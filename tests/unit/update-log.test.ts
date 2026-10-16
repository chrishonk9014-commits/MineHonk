/** The Update Log (Options > Update Log): every picture, item, recipe, advancement and link it shows exists. */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { UPDATE_LOG, entryImages, entryItems, imageUrl, advancementIcon } from '../../src/client/ui/updateLog';
import { initItems, itemById } from '../../src/common/registry/items';
import { engRecipes, recipes } from '../../src/common/game/crafting';
import { ACHIEVEMENTS } from '../../src/common/data/achievements';

initItems();

describe('the Update Log', () => {
  it('starts with V7, then V6.5, then V6, each with its own tab', () => {
    expect(UPDATE_LOG.map((e) => [e.version, e.name])).toEqual([
      ['V7', 'The Halloween Update'],
      ['V6.5', 'Play Together'],
      ['V6', 'The End Expansion'],
    ]);
    expect(new Set(UPDATE_LOG.map((e) => e.version.toLowerCase())).size).toBe(UPDATE_LOG.length);
  });

  it("V7 is the whole update: the season, the pumpkins, ghosts, the title screen, the villages, the heads, trick-or-treating, the hauntings, the advancements, playing together and the Admin Panel's tabs", () => {
    const ids = UPDATE_LOG[0]!.sections.map((s) => s.id);
    for (const id of ['overview', 'season', 'pumpkins', 'ghosts', 'menu', 'villages', 'abandoned', 'heads', 'sack', 'candy', 'knocking', 'trick-homes', 'quest', 'auto-haunting', 'null', 'green-steve', 'cave-dweller', 'voices', 'haunt-admin', 'advancements', 'together', 'admin']) expect(ids).toContain(id);
    // Every V7 advancement is shown (the hidden ones as ???)
    const adv = UPDATE_LOG[0]!.sections.find((s) => s.id === 'advancements')!.blocks.find((b) => b.k === 'advancements');
    expect(adv && adv.k === 'advancements' && [adv.from, adv.to, adv.hideSecret]).toEqual(['find_abandoned_village', 'experience_haunting', true]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('V6.5 has multiplayer, the Haunting and Auto Optimize; V6 keeps the End and no longer has multiplayer', () => {
    const v65 = UPDATE_LOG.find((e) => e.version === 'V6.5')!.sections.map((s) => s.id);
    for (const id of ['overview', 'multiplayer', 'haunting', 'auto_optimize']) expect(v65).toContain(id);
    const v6 = UPDATE_LOG.find((e) => e.version === 'V6')!;
    const ids = v6.sections.map((s) => s.id);
    for (const id of ['overview', 'portal', 'biomes', 'mobs', 'resources', 'structures', 'ancient', 'nest', 'engineering', 'quests', 'elytra', 'events', 'dragon', 'citadel', 'guardian', 'advancements', 'more']) expect(ids).toContain(id);
    expect(ids).not.toContain('multiplayer');
    expect(JSON.stringify(v6)).not.toMatch(/Auto Optimize|mp-/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const entry of UPDATE_LOG) {
    it(`${entry.version}: every picture is in public/ and small`, () => {
      const images = entryImages(entry);
      expect(images.length).toBeGreaterThan(entry.version === 'V6' ? 50 : 8);
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
            // One update's own advancements (V6: the End's, V7: Halloween's)
            for (const a of ACHIEVEMENTS.slice(i0, i1 + 1)) {
              expect(a.category).toBe(entry.version === 'V7' ? 'halloween' : 'end');
              expect(itemById.has(advancementIcon(a.icon)), a.icon).toBe(true);
            }
          }
        }
    });
  }
});
