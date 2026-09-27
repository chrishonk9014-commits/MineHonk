/** Block drop computation (pure). */
import { blocks, STATE_BLOCK, getProp } from '../registry/blocks';
import { itemById, items } from '../registry/items';
import type { Random } from '../math/rng';
import { stackOf, type ItemStack } from './itemstack';
import { canHarvest } from './mining';
import { enchantLevel } from './enchanting';
import { rollLoot } from './loot';

export interface DropResult {
  items: ItemStack[];
  xp: number;
}

/** Block item id that represents a state when silk-touched / picked. */
export function blockItemFor(state: number): string | null {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const id = bt.id;
  if (itemById.has(id) && itemById.get(id)!.def.block) return id;
  // variants without items map to their base block item
  const map: Record<string, string> = {
    wall_torch: 'torch',
    soul_wall_torch: 'soul_torch',
    wall_sign: 'sign',
    redstone_wall_torch: 'redstone_torch',
    carrots: 'carrot',
    potatoes: 'potato',
    wheat: 'wheat_seeds',
    beetroots: 'beetroot_seeds',
    sunroot: 'sunroot_seeds',
    nether_wart: 'nether_wart',
    sweet_berry_bush: 'sweet_berries',
    cave_vines: 'glow_berries',
  };
  return map[id] ?? null;
}

export function computeBlockDrops(state: number, tool: ItemStack | null, rng: Random): DropResult {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const def = bt.def;
  const result: DropResult = { items: [], xp: 0 };
  if (def.drops === 'none') return result;
  if (!canHarvest(state, tool)) return result;
  const silk = enchantLevel(tool, 'silk_touch') > 0;
  const shears = tool ? items[tool.id]?.def.tool?.type === 'shears' : false;
  const fortune = enchantLevel(tool, 'fortune');
  const spec = def.drops;
  // Double blocks only drop from the lower half.
  if (getProp(state, 'half') === 'upper' && (def.model === 'door' || def.model === 'double_plant')) return result;
  if (def.model === 'bed' && getProp(state, 'part') === 'head') return result;
  if (def.model === 'slab' && getProp(state, 'type') === 'double') {
    result.items.push(stackOf(bt.id, 2));
    return result;
  }
  if (spec?.table) {
    const maxAge = (def.data?.maxAge as number | undefined) ?? 0;
    const age = parseInt(getProp(state, 'age') ?? '0', 10);
    result.items.push(...rollLoot(spec.table, { rng, fortune, silkTouch: silk, maxAge: age >= maxAge }));
    return result;
  }
  if ((spec?.silkTouch && silk) || (shears && (def.tags?.includes('leaves') || spec?.item === 'none' && (def.model === 'cross' || def.model === 'vine' || def.model === 'double_plant' || def.id === 'cobweb')))) {
    const self = blockItemFor(state);
    if (self) result.items.push(stackOf(def.id === 'cobweb' && shears ? 'cobweb' : self, 1));
    return result;
  }
  const dropItem = spec?.item ?? blockItemFor(state);
  if (dropItem && dropItem !== 'none' && itemById.has(dropItem)) {
    let count = spec?.min !== undefined ? rng.range(spec.min, spec.max ?? spec.min) : 1;
    if (spec?.fortune && fortune > 0) {
      const bonus = rng.int(fortune + 2) - 1;
      if (bonus > 0) count *= bonus + 1;
    }
    if (count > 0) result.items.push(stackOf(dropItem, count));
  }
  if (spec?.extra) {
    for (const ex of spec.extra) {
      const chance = ex.chance * (1 + fortune * 0.5);
      if (rng.next() < chance && itemById.has(ex.item)) result.items.push(stackOf(ex.item, rng.range(ex.min ?? 1, ex.max ?? ex.min ?? 1)));
    }
  }
  if (spec?.xp && !silk) {
    result.xp = rng.range(spec.xp[0], spec.xp[1]);
    const pros = enchantLevel(tool, 'prospector');
    if (pros > 0) result.xp += rng.range(0, pros * 2);
  }
  return result;
}
