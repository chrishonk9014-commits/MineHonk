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
  | 'engineering_book'
  /** V5.5: the witch's grimoire (opens its pages on the client). */
  | 'grimoire'
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
  | 'firework'
  /** V6: opens the pack's nine slots. */
  | 'void_pack'
  /** V6 phase 3: a compass needle towards the giant structure the map was drawn for. */
  | 'ancient_map'
  /** V6 phase 3: fires a slow crystal shard (with a cooldown). */
  | 'shardstaff';

export interface ItemDef {
  id: string;
  name: string;
  tex?: string;
  maxStack?: number;
  durability?: number;
  /** `material` is the tier's id (iron, netherite, ender_alloy...) for blocks that need one material. */
  tool?: { type: ToolType; tier: number; speed: number; material?: string };
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
  /** V6: a short line under the name in the tooltip (for blocks: their def's `data.tooltip`). */
  tooltip?: string;
  data?: Record<string, unknown>;
}
