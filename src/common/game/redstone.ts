/**
 * Redstone roles of blocks and the dust connection shape, shared by the
 * client (placement prediction) and the server power system.
 */
import { blocks, STATE_BLOCK, STATE_OPAQUE, withProps } from '../registry/blocks';

export const H_DIRS = ['north', 'south', 'west', 'east'] as const;
export const H_DX = [0, 0, -1, 1];
export const H_DZ = [-1, 1, 0, 0];

export type Kind = 'wire' | 'lever' | 'button' | 'plate' | 'torch' | 'wall_torch' | 'block' | 'door' | 'trapdoor' | 'gate' | 'lamp' | 'note' | 'tnt' | 'sensor' | null;

let KIND: (Kind | undefined)[] = [];

/** Redstone role of a block (cached per block number). */
export function redstoneKind(state: number): Kind {
  const num = STATE_BLOCK[state]!;
  let k = KIND[num];
  if (k !== undefined) return k;
  const def = blocks[num]!.def;
  const id = def.id;
  if (id === 'redstone_wire') k = 'wire';
  else if (def.model === 'lever') k = 'lever';
  else if (def.model === 'button') k = 'button';
  else if (def.model === 'pressure_plate') k = 'plate';
  else if (id === 'redstone_torch') k = 'torch';
  else if (id === 'redstone_wall_torch') k = 'wall_torch';
  else if (id === 'redstone_block') k = 'block';
  else if (def.model === 'door') k = 'door';
  else if (def.model === 'trapdoor') k = 'trapdoor';
  else if (def.model === 'fence_gate') k = 'gate';
  else if (id === 'redstone_lamp') k = 'lamp';
  else if (id === 'note_block') k = 'note';
  else if (id === 'tnt') k = 'tnt';
  else if (id === 'sculk_sensor' || id === 'calibrated_sculk_sensor') k = 'sensor';
  else k = null;
  KIND[num] = k;
  return k;
}

/** Dust connection shape towards each side (shared with placement so both sides agree). */
export function wireShape(w: { getState(x: number, y: number, z: number): number }, x: number, y: number, z: number, state: number): number {
  const props: Record<string, string> = {};
  const aboveOpen = !STATE_OPAQUE[w.getState(x, y + 1, z)];
  for (let i = 0; i < 4; i++) {
    const nx = x + H_DX[i]!;
    const nz = z + H_DZ[i]!;
    const side = w.getState(nx, y, nz);
    const k = redstoneKind(side);
    let v = 'none';
    if (k && k !== 'door' && k !== 'trapdoor' && k !== 'gate' && k !== 'note' && k !== 'tnt' && k !== 'lamp') v = 'side';
    else if (!STATE_OPAQUE[side] && redstoneKind(w.getState(nx, y - 1, nz)) === 'wire') v = 'side';
    else if (aboveOpen && STATE_OPAQUE[side] && redstoneKind(w.getState(nx, y + 1, nz)) === 'wire') v = 'up';
    props[H_DIRS[i]!] = v;
  }
  return withProps(state, props);
}
