/** Enchantment definitions (data-driven). */
export type EnchantTarget = 'armor' | 'helmet' | 'chestplate' | 'leggings' | 'boots' | 'sword' | 'digger' | 'pickaxe' | 'axe' | 'bow' | 'crossbow' | 'trident' | 'fishing_rod' | 'breakable' | 'weapon';

export interface EnchantDef {
  id: string;
  name: string;
  maxLevel: number;
  targets: EnchantTarget[];
  /** Selection weight: 10 common, 5 uncommon, 2 rare, 1 very rare. */
  weight: number;
  minCost: (lvl: number) => number;
  maxCost: (lvl: number) => number;
  conflicts?: string[];
  treasure?: boolean;
  curse?: boolean;
}

const lin = (base: number, per: number) => (l: number): number => base + (l - 1) * per;

export const ENCHANTMENTS: EnchantDef[] = [
  { id: 'protection', name: 'Protection', maxLevel: 4, targets: ['armor'], weight: 10, minCost: lin(1, 11), maxCost: lin(12, 11), conflicts: ['fire_protection', 'blast_protection', 'projectile_protection'] },
  { id: 'fire_protection', name: 'Fire Protection', maxLevel: 4, targets: ['armor'], weight: 5, minCost: lin(10, 8), maxCost: lin(18, 8), conflicts: ['protection', 'blast_protection', 'projectile_protection'] },
  { id: 'feather_falling', name: 'Feather Falling', maxLevel: 4, targets: ['boots'], weight: 5, minCost: lin(5, 6), maxCost: lin(11, 6) },
  { id: 'blast_protection', name: 'Blast Protection', maxLevel: 4, targets: ['armor'], weight: 2, minCost: lin(5, 8), maxCost: lin(13, 8), conflicts: ['protection', 'fire_protection', 'projectile_protection'] },
  { id: 'projectile_protection', name: 'Projectile Protection', maxLevel: 4, targets: ['armor'], weight: 5, minCost: lin(3, 6), maxCost: lin(9, 6), conflicts: ['protection', 'fire_protection', 'blast_protection'] },
  { id: 'respiration', name: 'Respiration', maxLevel: 3, targets: ['helmet'], weight: 2, minCost: lin(10, 10), maxCost: lin(40, 10) },
  { id: 'aqua_affinity', name: 'Aqua Affinity', maxLevel: 1, targets: ['helmet'], weight: 2, minCost: () => 1, maxCost: () => 41 },
  { id: 'thorns', name: 'Thorns', maxLevel: 3, targets: ['chestplate'], weight: 1, minCost: lin(10, 20), maxCost: lin(60, 20) },
  { id: 'depth_strider', name: 'Depth Strider', maxLevel: 3, targets: ['boots'], weight: 2, minCost: lin(10, 10), maxCost: lin(25, 10), conflicts: ['frost_walker'] },
  { id: 'frost_walker', name: 'Frost Walker', maxLevel: 2, targets: ['boots'], weight: 2, minCost: lin(10, 10), maxCost: lin(25, 10), conflicts: ['depth_strider'], treasure: true },
  { id: 'stride', name: 'Stride', maxLevel: 3, targets: ['boots'], weight: 2, minCost: lin(8, 9), maxCost: lin(30, 9) },
  { id: 'sharpness', name: 'Sharpness', maxLevel: 5, targets: ['weapon'], weight: 10, minCost: lin(1, 11), maxCost: lin(21, 11), conflicts: ['smite', 'bane_of_arthropods', 'glitchbane'] },
  { id: 'smite', name: 'Smite', maxLevel: 5, targets: ['weapon'], weight: 5, minCost: lin(5, 8), maxCost: lin(25, 8), conflicts: ['sharpness', 'bane_of_arthropods', 'glitchbane'] },
  { id: 'bane_of_arthropods', name: 'Bane of Arthropods', maxLevel: 5, targets: ['weapon'], weight: 5, minCost: lin(5, 8), maxCost: lin(25, 8), conflicts: ['sharpness', 'smite', 'glitchbane'] },
  { id: 'glitchbane', name: 'Glitchbane', maxLevel: 5, targets: ['weapon'], weight: 1, minCost: lin(12, 9), maxCost: lin(40, 9), conflicts: ['sharpness', 'smite', 'bane_of_arthropods'], treasure: true },
  { id: 'knockback', name: 'Knockback', maxLevel: 2, targets: ['sword'], weight: 5, minCost: lin(5, 20), maxCost: lin(55, 20) },
  { id: 'fire_aspect', name: 'Fire Aspect', maxLevel: 2, targets: ['sword'], weight: 2, minCost: lin(10, 20), maxCost: lin(60, 20) },
  { id: 'looting', name: 'Looting', maxLevel: 3, targets: ['sword'], weight: 2, minCost: lin(15, 9), maxCost: lin(65, 9) },
  { id: 'sweeping', name: 'Sweeping Edge', maxLevel: 3, targets: ['sword'], weight: 2, minCost: lin(5, 9), maxCost: lin(20, 9) },
  { id: 'efficiency', name: 'Efficiency', maxLevel: 5, targets: ['digger'], weight: 10, minCost: lin(1, 10), maxCost: lin(51, 10) },
  { id: 'silk_touch', name: 'Silk Touch', maxLevel: 1, targets: ['digger'], weight: 1, minCost: () => 15, maxCost: () => 65, conflicts: ['fortune'] },
  { id: 'fortune', name: 'Fortune', maxLevel: 3, targets: ['digger'], weight: 2, minCost: lin(15, 9), maxCost: lin(65, 9), conflicts: ['silk_touch'] },
  { id: 'prospector', name: 'Prospector', maxLevel: 3, targets: ['pickaxe'], weight: 2, minCost: lin(10, 9), maxCost: lin(50, 9) },
  { id: 'unbreaking', name: 'Unbreaking', maxLevel: 3, targets: ['breakable'], weight: 5, minCost: lin(5, 8), maxCost: lin(55, 8) },
  { id: 'power', name: 'Power', maxLevel: 5, targets: ['bow'], weight: 10, minCost: lin(1, 10), maxCost: lin(16, 10) },
  { id: 'punch', name: 'Punch', maxLevel: 2, targets: ['bow'], weight: 2, minCost: lin(12, 20), maxCost: lin(37, 20) },
  { id: 'flame', name: 'Flame', maxLevel: 1, targets: ['bow'], weight: 2, minCost: () => 20, maxCost: () => 50 },
  { id: 'infinity', name: 'Infinity', maxLevel: 1, targets: ['bow'], weight: 1, minCost: () => 20, maxCost: () => 50, conflicts: ['mending'] },
  { id: 'mending', name: 'Mending', maxLevel: 1, targets: ['breakable'], weight: 2, minCost: () => 25, maxCost: () => 75, conflicts: ['infinity'], treasure: true },
  { id: 'loyalty', name: 'Loyalty', maxLevel: 3, targets: ['trident'], weight: 5, minCost: lin(12, 7), maxCost: () => 50 },
  { id: 'luck_of_the_sea', name: 'Luck of the Sea', maxLevel: 3, targets: ['fishing_rod'], weight: 2, minCost: lin(15, 9), maxCost: lin(65, 9) },
  { id: 'lure', name: 'Lure', maxLevel: 3, targets: ['fishing_rod'], weight: 2, minCost: lin(15, 9), maxCost: lin(65, 9) },
  { id: 'binding_curse', name: 'Curse of Binding', maxLevel: 1, targets: ['armor'], weight: 1, minCost: () => 25, maxCost: () => 50, treasure: true, curse: true },
  { id: 'vanishing_curse', name: 'Curse of Vanishing', maxLevel: 1, targets: ['breakable'], weight: 1, minCost: () => 25, maxCost: () => 50, treasure: true, curse: true },
];

export const ENCHANT_BY_ID = new Map(ENCHANTMENTS.map((e) => [e.id, e]));

export function romanNumeral(n: number): string {
  const r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return r[n] ?? String(n);
}
