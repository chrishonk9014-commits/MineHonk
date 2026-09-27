/** Villager trades by profession (data-driven). Prices are in emeralds. */
export interface TradeDef {
  buy: [string, number];
  buy2?: [string, number];
  sell: [string, number];
  maxUses: number;
  /** Enchantment for enchanted books (random level up to max when omitted). */
  enchant?: string;
}

export const PROFESSIONS = ['farmer', 'librarian', 'toolsmith', 'cleric', 'fisherman', 'shepherd', 'butcher', 'mason'] as const;
export type Profession = (typeof PROFESSIONS)[number] | 'none';

export const TRADES: Record<Exclude<Profession, 'none'>, TradeDef[]> = {
  farmer: [
    { buy: ['wheat', 20], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['carrot', 22], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], sell: ['bread', 6], maxUses: 16 },
    { buy: ['pumpkin', 6], sell: ['emerald', 1], maxUses: 12 },
    { buy: ['emerald', 3], sell: ['cookie', 18], maxUses: 12 },
    { buy: ['emerald', 4], sell: ['golden_carrot', 3], maxUses: 12 },
    { buy: ['sunroot', 8], sell: ['emerald', 1], maxUses: 12 },
  ],
  librarian: [
    { buy: ['paper', 24], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 9], sell: ['bookshelf', 1], maxUses: 12 },
    { buy: ['emerald', 12], buy2: ['book', 1], sell: ['enchanted_book', 1], maxUses: 12 },
    { buy: ['emerald', 1], sell: ['lantern', 1], maxUses: 12 },
    { buy: ['book', 4], sell: ['emerald', 1], maxUses: 12 },
    { buy: ['emerald', 5], sell: ['glass', 4], maxUses: 12 },
  ],
  toolsmith: [
    { buy: ['coal', 15], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], sell: ['stone_axe', 1], maxUses: 12 },
    { buy: ['iron_ingot', 4], sell: ['emerald', 1], maxUses: 12 },
    { buy: ['emerald', 6], sell: ['iron_pickaxe', 1], maxUses: 3 },
    { buy: ['diamond', 1], sell: ['emerald', 1], maxUses: 12 },
    { buy: ['emerald', 24], buy2: ['ender_pearl', 1], sell: ['farlands_compass', 1], maxUses: 1 },
  ],
  cleric: [
    { buy: ['rotten_flesh', 32], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], sell: ['redstone', 2], maxUses: 12 },
    { buy: ['gold_ingot', 3], sell: ['emerald', 1], maxUses: 12 },
    { buy: ['emerald', 1], sell: ['lapis_lazuli', 1], maxUses: 12 },
    { buy: ['emerald', 5], sell: ['ender_pearl', 1], maxUses: 12 },
    { buy: ['emerald', 3], sell: ['experience_bottle', 1], maxUses: 12 },
  ],
  fisherman: [
    { buy: ['string', 20], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['coal', 10], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], buy2: ['cod', 6], sell: ['cooked_cod', 6], maxUses: 16 },
    { buy: ['salmon', 6], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 3], sell: ['fishing_rod', 1], maxUses: 3 },
  ],
  shepherd: [
    { buy: ['white_wool', 18], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 2], sell: ['shears', 1], maxUses: 12 },
    { buy: ['emerald', 1], sell: ['white_wool', 1], maxUses: 16 },
    { buy: ['emerald', 3], sell: ['white_bed', 1], maxUses: 12 },
    { buy: ['black_dye', 12], sell: ['emerald', 1], maxUses: 16 },
  ],
  butcher: [
    { buy: ['chicken', 14], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['porkchop', 7], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], sell: ['cooked_porkchop', 5], maxUses: 16 },
    { buy: ['coal', 15], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['sweet_berries', 10], sell: ['emerald', 1], maxUses: 12 },
  ],
  mason: [
    { buy: ['clay_ball', 10], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], sell: ['bricks', 10], maxUses: 16 },
    { buy: ['stone', 20], sell: ['emerald', 1], maxUses: 16 },
    { buy: ['emerald', 1], sell: ['chiseled_stone_bricks', 4], maxUses: 16 },
    { buy: ['quartz', 12], sell: ['emerald', 1], maxUses: 12 },
  ],
};
