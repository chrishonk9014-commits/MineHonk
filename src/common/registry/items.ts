/**
 * Item registry. Combines auto-generated block items with explicit item
 * definitions. Numeric ids are stable for a given build (used in memory and on
 * the wire); string ids are used in save files.
 */
import type { ItemDef } from './itemTypes';
import { ITEM_DEFS } from '../data/items';
import { blocks, initBlocks } from './blocks';
import { MOB_DEFS } from '../data/mobs';

export interface ItemType {
  readonly num: number;
  readonly id: string;
  readonly def: ItemDef;
  readonly maxStack: number;
  readonly tags: ReadonlySet<string>;
}

export const items: ItemType[] = [];
export const itemById = new Map<string, ItemType>();

export const CREATIVE_TABS = [
  { id: 'building', name: 'Building Blocks', icon: 'bricks' },
  { id: 'colored', name: 'Colored Blocks', icon: 'cyan_wool' },
  { id: 'nature', name: 'Natural Blocks', icon: 'grass_block' },
  { id: 'functional', name: 'Functional Blocks', icon: 'crafting_table' },
  { id: 'redstone', name: 'Redstone', icon: 'redstone' },
  { id: 'tools', name: 'Tools & Utilities', icon: 'diamond_pickaxe' },
  { id: 'combat', name: 'Combat', icon: 'netherite_sword' },
  { id: 'food', name: 'Food & Drinks', icon: 'golden_apple' },
  { id: 'materials', name: 'Ingredients', icon: 'iron_ingot' },
  { id: 'brewing', name: 'Brewing', icon: 'potion' },
  { id: 'spawn_eggs', name: 'Spawn Eggs', icon: 'spawn_egg_zombie' },
  { id: 'farlands', name: 'Farlands', icon: 'glitch_block' },
  { id: 'engineering', name: 'Engineering', icon: 'crusher' },
] as const;

function autoTab(def: { id: string; tags?: string[]; interact?: string; entity?: string; light?: number; model: string; creative?: string }): string {
  if (def.creative) return def.creative;
  const id = def.id;
  if (/^(far_|farstone|corrupted|glitch|static|overflow|null_|fractal|echo_lamp|data_crystal|stretched|missing|stripped_null)/.test(id)) return 'farlands';
  if (def.tags?.some((t) => ['wool', 'carpets', 'stained_glass', 'concrete', 'terracotta', 'beds'].includes(t))) return 'colored';
  if (def.tags?.includes('redstone') || ['button', 'pressure_plate', 'lever'].includes(def.model) || id === 'tnt' || id === 'note_block' || id === 'redstone_block' || id === 'iron_door' || id === 'iron_trapdoor') return 'redstone';
  if (def.interact || def.entity || (def.light ?? 0) > 0 || ['ladder', 'torch', 'lantern', 'chain', 'scaffolding', 'bookshelf', 'tnt', 'cauldron'].includes(def.model) || id === 'tnt') return 'functional';
  if (def.tags?.some((t) => ['ore', 'dirt', 'leaves', 'saplings', 'flowers', 'logs', 'base_stone', 'sand', 'mushrooms', 'nylium', 'coral_blocks'].includes(t))) return 'nature';
  if (['cross', 'double_plant', 'crop', 'vine', 'lily_pad', 'cactus', 'hanging_plant'].includes(def.model)) return 'nature';
  if (/^(snow|ice|packed_ice|blue_ice|gravel|clay|mud|obsidian|netherrack|soul_|basalt|blackstone|end_stone|magma|glowstone|pumpkin|melon|moss|bone_block|dripstone|amethyst|calcite|tuff|bedrock|sculk)/.test(id)) return 'nature';
  return 'building';
}

let initialised = false;

export function initItems(): void {
  if (initialised) return;
  initialised = true;
  initBlocks();
  const explicit = new Map<string, ItemDef>();
  for (const d of ITEM_DEFS) {
    if (explicit.has(d.id)) throw new Error(`Duplicate item ${d.id}`);
    explicit.set(d.id, d);
  }
  const register = (def: ItemDef): void => {
    if (itemById.has(def.id)) throw new Error(`Duplicate item ${def.id}`);
    const it: ItemType = {
      num: items.length,
      id: def.id,
      def,
      maxStack: def.maxStack ?? (def.durability ? 1 : 64),
      tags: new Set(def.tags ?? []),
    };
    items.push(it);
    itemById.set(def.id, it);
  };
  // 0 = empty placeholder
  register({ id: 'air', name: 'Air', creative: 'hidden' });
  for (const b of blocks) {
    const bd = b.def;
    if (bd.item === false || bd.id === 'air') continue;
    const ex = explicit.get(bd.id);
    if (ex) {
      register({ block: bd.id, creative: autoTab(bd), ...ex });
      explicit.delete(bd.id);
      continue;
    }
    const maxStack = bd.model === 'bed' || bd.model === 'door' ? (bd.model === 'bed' ? 1 : 64) : 64;
    register({
      id: bd.id,
      name: bd.name,
      block: bd.id,
      maxStack: bd.model === 'bed' ? 1 : maxStack,
      creative: autoTab(bd),
      fuel: typeof bd.data?.fuel === 'number' ? bd.data.fuel : bd.flammable && ['planks', 'logs'].some((t) => bd.tags?.includes(t)) ? 300 : bd.flammable && bd.tags?.includes('wooden_slabs') ? 150 : bd.id === 'coal_block' ? 16000 : undefined,
      tags: [...(bd.tags ?? []), 'block'],
    });
  }
  for (const d of explicit.values()) register(d);
  // Spawn eggs generated from the mob registry
  for (const m of MOB_DEFS) {
    if (m.id === 'ender_dragon') continue;
    register({ id: 'spawn_egg_' + m.id, name: m.name + ' Spawn Egg', use: 'spawn_egg', spawns: m.id, creative: 'spawn_eggs', rarity: m.category === 'boss' ? 'epic' : undefined });
  }
}

export function getItem(id: string): ItemType {
  const it = itemById.get(id);
  if (!it) throw new Error(`Unknown item ${id}`);
  return it;
}

export function hasItem(id: string): boolean {
  return itemById.has(id);
}

export function itemNum(id: string): number {
  return getItem(id).num;
}

export function itemOf(num: number): ItemType | undefined {
  return items[num];
}

/** Registers extra items at init time (spawn eggs, generated from the mob registry). */
export function registerExtraItem(def: ItemDef): void {
  if (itemById.has(def.id)) return;
  const it: ItemType = {
    num: items.length,
    id: def.id,
    def,
    maxStack: def.maxStack ?? (def.durability ? 1 : 64),
    tags: new Set(def.tags ?? []),
  };
  items.push(it);
  itemById.set(def.id, it);
}
