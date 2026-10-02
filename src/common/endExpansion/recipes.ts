/**
 * V6 - The End Expansion, phase 2: recipes for the Expanded End's resources.
 * Registered into the shared recipe lists (../data/recipes.ts), so they work
 * at the crafting table, furnace, stonecutter and smithing table and show up
 * in the Recipe Book like any other recipe.
 */
import { END_STONE_VARIANTS, endStoneForms } from './resources';

export interface RecipeKit {
  shaped(result: string, count: number, pattern: string[], key: Record<string, string>): void;
  shapeless(result: string, count: number, ...ingredients: string[]): void;
  smelt(input: string, result: string, xp: number, kind?: 'ore' | 'food' | 'misc'): void;
  cut(input: string, result: string, count?: number): void;
  smith(base: string, addition: string, result: string): void;
}

/** Stairs, slab and wall of a block, crafted and cut from it (and cut from the stones it is made from). */
function family(r: RecipeKit, base: string, from: string[] = []): void {
  r.shaped(`${base}_stairs`, 4, ['B  ', 'BB ', 'BBB'], { B: base });
  r.shaped(`${base}_slab`, 6, ['BBB'], { B: base });
  r.shaped(`${base}_wall`, 6, ['BBB', 'BBB'], { B: base });
  for (const src of [base, ...from]) {
    r.cut(src, `${base}_stairs`);
    r.cut(src, `${base}_slab`, 2);
    r.cut(src, `${base}_wall`);
  }
}

export function addExpansionRecipes(r: RecipeKit): void {
  // End stone variants: polished from the stone, bricks from polished; the stonecutter makes any form from the ones before it
  for (const v of END_STONE_VARIANTS) {
    const [natural, polished, bricks] = endStoneForms(v.id);
    r.shaped(polished, 4, ['SS', 'SS'], { S: natural });
    r.shaped(bricks, 4, ['SS', 'SS'], { S: polished });
    r.cut(natural, polished);
    r.cut(natural, bricks);
    r.cut(polished, bricks);
    family(r, natural);
    family(r, polished, [natural]);
    family(r, bricks, [natural, polished]);
  }

  // End Crystal Fragments
  r.shaped('crystal_lamp', 1, [' F ', 'FGF', ' F '], { F: 'end_crystal_fragment', G: 'glass' });
  r.shaped('crystal_glass', 8, ['GGG', 'GFG', 'GGG'], { G: 'glass', F: 'end_crystal_fragment' });
  // A second way to make an End Crystal (the original recipe stays)
  r.shaped('end_crystal', 1, ['FFF', 'FEF', 'FTF'], { F: 'end_crystal_fragment', E: 'ender_eye', T: 'ghast_tear' });

  // Void Shards
  r.shaped('void_glass', 8, ['GGG', 'GVG', 'GGG'], { G: 'glass', V: 'void_shard' });

  // Chorus wood (the same recipes as every other wood) and chorus fiber
  const planks = 'chorus_planks';
  r.shapeless(planks, 4, '#chorus_logs');
  r.shaped('chorus_stairs', 4, ['P  ', 'PP ', 'PPP'], { P: planks });
  r.shaped('chorus_slab', 6, ['PPP'], { P: planks });
  r.shaped('chorus_fence', 3, ['PSP', 'PSP'], { P: planks, S: 'stick' });
  r.shaped('chorus_fence_gate', 1, ['SPS', 'SPS'], { P: planks, S: 'stick' });
  r.shaped('chorus_door', 3, ['PP', 'PP', 'PP'], { P: planks });
  r.shaped('chorus_trapdoor', 2, ['PPP', 'PPP'], { P: planks });
  r.shapeless('chorus_button', 1, planks);
  r.shaped('chorus_pressure_plate', 1, ['PP'], { P: planks });
  r.smelt('chorus_stalk', 'charcoal', 0.15);
  r.shaped('chorus_cloth', 1, ['FF', 'FF'], { F: 'chorus_fiber' });
  r.shaped('chorus_rope', 2, ['F', 'F', 'F'], { F: 'chorus_fiber' });

  // Ender Alloy: Ender Ore smelts into scrap; the ingot upgrades netherite gear at a smithing table
  r.smelt('ender_ore', 'ender_scrap', 2, 'ore');
  r.shapeless('ender_alloy_ingot', 1, 'ender_scrap', 'ender_scrap', 'ender_scrap', 'ender_scrap', 'void_shard', 'void_shard', 'void_shard', 'void_shard', 'ender_pearl');
  for (const piece of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots']) r.smith(`netherite_${piece}`, 'ender_alloy_ingot', `ender_alloy_${piece}`);

  // Ancient fragments
  r.shaped('ancient_end_bricks', 4, ['FF', 'FF'], { F: 'ancient_fragment' });
  family(r, 'ancient_end_bricks');

  // Astral dust and shards
  r.shaped('astral_shard', 1, ['DDD', 'DDD', 'DDD'], { D: 'astral_dust' });
  r.shaped('astral_lantern', 1, ['NNN', 'NSN', 'NNN'], { N: 'iron_nugget', S: 'astral_shard' });
  r.shaped('astral_glass', 8, ['GGG', 'GDG', 'GGG'], { G: 'glass', D: 'astral_dust' });

  // Void Stalker hide, and the Endling
  r.shaped('void_leather', 1, ['HH', 'HH'], { H: 'void_stalker_hide' });
  r.shaped('void_pack', 1, [' S ', 'L L', ' L '], { S: 'string', L: 'void_leather' });
  r.smelt('raw_endling', 'cooked_endling', 0.35, 'food');
}
