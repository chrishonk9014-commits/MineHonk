/**
 * V7 - The Halloween Update: the dimension pumpkins' definitions (plain data:
 * the block registry reads these, so nothing here may import it). Where
 * they grow and how is in pumpkins.ts.
 */
import type { BlockDef } from '../registry/blockTypes';
import type { DimensionId } from '../data/biomes';

export interface DimensionPumpkin {
  id: string;
  name: string;
  dim: DimensionId;
  /** Where it grows, as players read it. */
  where: string;
  look: string;
  light: number;
  mapColor: number;
}

export const DIMENSION_PUMPKINS: readonly DimensionPumpkin[] = [
  { id: 'hallow_pumpkin', name: 'Hallow Pumpkin', dim: 'overworld', where: 'the Overworld', look: 'The classic: an orange jack o\'lantern with a candle grin.', light: 15, mapColor: 0xe07a12 },
  { id: 'ember_pumpkin', name: 'Ember Pumpkin', dim: 'nether', where: 'the Nether', look: 'Charred black and red, glowing through its cracks, a face full of fire.', light: 15, mapColor: 0x8a1e10 },
  { id: 'ender_pumpkin', name: 'Ender Pumpkin', dim: 'end', where: 'the End and the Expanded End', look: 'Pale and violet, with too many eyes. Nobody planted it.', light: 12, mapColor: 0xb8a8d8 },
  { id: 'glitched_pumpkin', name: 'Glitched Pumpkin', dim: 'farlands', where: 'the Farlands', look: 'Corrupted: missing-texture patches and a face that keeps tearing.', light: 11, mapColor: 0xc020c0 },
  { id: 'data_pumpkin', name: 'Data Pumpkin', dim: 'computer', where: 'inside the computer', look: 'A circuit-board rind and a face drawn on a screen.', light: 12, mapColor: 0x1e6a3a },
];

export const PUMPKIN_IDS: readonly string[] = DIMENSION_PUMPKINS.map((p) => p.id);

export const PUMPKIN_FACING = ['north', 'south', 'west', 'east'] as const;

/** The block registry's entries (appended in their own V7 section). */
export function pumpkinBlockDefs(): BlockDef[] {
  const sound = { hallow_pumpkin: 'wood', ember_pumpkin: 'netherrack', ender_pumpkin: 'wood', glitched_pumpkin: 'glitch', data_pumpkin: 'metal' } as const;
  return DIMENSION_PUMPKINS.map((p) => ({
    id: p.id,
    name: p.name,
    hardness: 1,
    sound: sound[p.id as keyof typeof sound],
    model: 'cube',
    props: { facing: PUMPKIN_FACING },
    tex: { top: p.id + '_top', side: p.id + '_side', front: p.id + '_face' },
    tool: 'axe',
    light: p.light,
    mapColor: p.mapColor,
    creative: 'halloween',
    data: { tooltip: `Halloween: found in ${p.where}.` },
  }));
}

