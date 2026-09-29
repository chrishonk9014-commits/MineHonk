import type { ToolType } from './blockTypes';

export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'glitched';

export interface FoodDef {
  hunger: number;
  saturation: number;
  alwaysEdible?: boolean;
  /** Ticks to eat (default 32). */
  eatTime?: number;
  effects?: { effect: string; duration: number; amplifier?: number; chance?: number }[];
  /** Item left over after eating (bowl). */
  remainder?: string;
  special?: 'chorus_teleport' | 'milk';
}

export type UseKind =
  | 'place_block'
  | 'bow'
  | 'crossbow'
  | 'flint_and_steel'
  | 'fire_charge'
  | 'bucket'
  | 'water_bucket'
  | 'lava_bucket'
  | 'milk_bucket'
  | 'ender_eye'
  | 'ender_pearl'
  | 'rift_pearl'
  | 'snowball'
  | 'egg'
  | 'bone_meal'
  | 'hoe'
  | 'shovel'
  | 'axe'
  | 'spawn_egg'
  | 'glass_bottle'
  | 'potion'
  | 'splash_potion'
  | 'shears'
  | 'experience_bottle'
  | 'shield'
  | 'trident'
  | 'fishing_rod'
  | 'carrot_on_a_stick'
  | 'compass'
  | 'recovery_compass'
  | 'clock'
  | 'spyglass'
  | 'farlands_compass'
  | 'music_disc'
  | 'totem'
  | 'elytra'
  | 'firework';

export interface ItemDef {
  id: string;
  name: string;
  tex?: string;
  maxStack?: number;
  durability?: number;
  tool?: { type: ToolType; tier: number; speed: number };
  weapon?: { damage: number; speed: number };
  armor?: { slot: ArmorSlot; defense: number; toughness?: number; knockbackRes?: number; material: string };
  food?: FoodDef;
  /** Block placed by this item. */
  block?: string;
  /** Alternative block when placed against a wall (torches, signs). */
  wallBlock?: string;
  /** Burn time in ticks when used as furnace fuel. */
  fuel?: number;
  rarity?: Rarity;
  use?: UseKind;
  enchantability?: number;
  creative?: string;
  tags?: string[];
  /** Mob id for spawn eggs. */
  spawns?: string;
  /** Item shows enchant glint. */
  glint?: boolean;
  /** Repair material for anvils. */
  repair?: string;
  fireResistant?: boolean;
  data?: Record<string, unknown>;
}
