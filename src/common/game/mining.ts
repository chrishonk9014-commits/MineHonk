/**
 * Block breaking rules shared by client (progress prediction) and server
 * (authoritative validation).
 */
import { blocks, STATE_BLOCK } from '../registry/blocks';
import { items } from '../registry/items';
import type { ItemStack } from './itemstack';
import { enchantLevel } from './enchanting';

export interface MiningContext {
  tool: ItemStack | null;
  onGround: boolean;
  underwater: boolean;
  aquaAffinity: boolean;
  haste: number; // effect amplifier+1, 0 = none
  fatigue: number; // effect amplifier+1, 0 = none
  creative: boolean;
}

/** Whether the tool can harvest drops from this block state. */
export function canHarvest(state: number, tool: ItemStack | null): boolean {
  const def = blocks[STATE_BLOCK[state]!]!.def;
  if (!def.requiresTool) return true;
  const t = tool ? items[tool.id]?.def.tool : undefined;
  if (!t || t.type !== def.tool) return false;
  if (def.harvestMaterial && t.material !== def.harvestMaterial) return false;
  return t.tier >= (def.harvestLevel ?? 0);
}

/**
 * Adventure mode: a block may only be broken with the proper tool for it
 * (one that is faster than bare hands and can harvest its drops).
 */
export function adventureMayBreak(state: number, tool: ItemStack | null): boolean {
  if (!tool) return false;
  return toolSpeed(state, tool) > 1 && canHarvest(state, tool);
}

/** Tool speed multiplier against a block (1 if not the right tool). */
export function toolSpeed(state: number, tool: ItemStack | null): number {
  const def = blocks[STATE_BLOCK[state]!]!.def;
  const t = tool ? items[tool.id]?.def.tool : undefined;
  if (!t) return 1;
  if (t.type === 'sword') {
    if (def.id === 'cobweb') return 15;
    if (def.tags?.includes('leaves') || def.model === 'cross' || def.id === 'bamboo' || def.id === 'pumpkin' || def.id === 'melon') return 1.5;
    return 1;
  }
  if (t.type === 'shears') {
    if (def.id === 'cobweb' || def.tags?.includes('leaves')) return 15;
    if (def.tags?.includes('wool')) return 5;
    if (def.id === 'vine' || def.id === 'glow_lichen') return 2;
    return 1;
  }
  if (def.tool === t.type) return t.speed;
  // Axes/hoes are also efficient on some materials not tagged with that tool
  if (t.type === 'hoe' && (def.tags?.includes('leaves') || def.sound === 'moss')) return t.speed;
  return 1;
}

/**
 * Ticks needed to break the block (0 = instant). Returns Infinity for
 * unbreakable blocks.
 */
export function breakTicks(state: number, ctx: MiningContext): number {
  const def = blocks[STATE_BLOCK[state]!]!.def;
  if (def.hardness < 0) return Infinity;
  if (ctx.creative) return 0;
  if (def.hardness === 0) return 0;
  let speed = toolSpeed(state, ctx.tool);
  if (speed > 1) {
    const eff = enchantLevel(ctx.tool, 'efficiency');
    if (eff > 0) speed += eff * eff + 1;
  }
  if (ctx.haste > 0) speed *= 1 + 0.2 * ctx.haste;
  if (ctx.fatigue > 0) speed *= Math.pow(0.3, Math.min(4, ctx.fatigue));
  if (ctx.underwater && !ctx.aquaAffinity) speed /= 5;
  if (!ctx.onGround) speed /= 5;
  const harvest = canHarvest(state, ctx.tool);
  const perTick = speed / def.hardness / (harvest ? 30 : 100);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick);
}
