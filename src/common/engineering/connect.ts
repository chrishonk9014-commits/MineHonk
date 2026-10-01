/**
 * The one connection rule of engineering: a conduit (cable, item pipe, fluid
 * pipe, filter or valve) connects on each side to whatever joins the same
 * network there: another conduit of that network, or a component that joins
 * it (machines, batteries, tanks; for item pipes also chests, barrels and
 * furnaces). Shared by placement (the client's prediction) and the server.
 */
import { blocks, STATE_BLOCK, withProp } from '../registry/blocks';
import { COMPONENT_BY_ID, type Net } from './catalog';
import { FACE_DX, FACE_DY, FACE_DZ, FACE_NAMES } from '../world/constants';

let NETS: (number | undefined)[] = [];
let CONDUIT: (number | undefined)[] = [];

const BIT: Record<Net, number> = { energy: 1, item: 2, fluid: 4 };

/** Networks a block joins, as bits (1 energy, 2 item, 4 fluid). */
export function netBits(state: number): number {
  const num = STATE_BLOCK[state]!;
  let v = NETS[num];
  if (v !== undefined) return v;
  const def = blocks[num]!.def;
  const c = COMPONENT_BY_ID.get(def.id);
  v = 0;
  if (c) for (const n of c.nets) v |= BIT[n];
  // Vanilla inventories join item networks
  if (def.entity === 'chest' || def.entity === 'barrel' || def.entity === 'furnace') if (def.id !== 'ender_chest') v |= BIT.item;
  NETS[num] = v;
  return v;
}

/** The network a conduit carries (bit), or 0 if the block is not a conduit. */
export function conduitBit(state: number): number {
  const num = STATE_BLOCK[state]!;
  let v = CONDUIT[num];
  if (v !== undefined) return v;
  const c = COMPONENT_BY_ID.get(blocks[num]!.def.id);
  v = 0;
  if (c?.kind === 'cable') v = BIT.energy;
  else if (c?.kind === 'item_pipe' || c?.kind === 'item_filter') v = BIT.item;
  else if (c?.kind === 'fluid_pipe' || c?.kind === 'valve' || c?.kind === 'fluid_filter') v = BIT.fluid;
  CONDUIT[num] = v;
  return v;
}

export function joins(state: number, net: Net): boolean {
  return (netBits(state) & BIT[net]) !== 0;
}

export function netBit(net: Net): number {
  return BIT[net];
}

/** A conduit's shape: an arm towards every neighbour on its network. */
export function conduitShape(w: { getState(x: number, y: number, z: number): number }, x: number, y: number, z: number, state: number): number {
  const bit = conduitBit(state);
  if (!bit) return state;
  for (let f = 0; f < 6; f++) {
    const n = w.getState(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]);
    state = withProp(state, FACE_NAMES[f]!, (netBits(n) & bit) !== 0 ? 'true' : 'false');
  }
  return state;
}

/** Forget cached tables (the registry was rebuilt). */
export function resetConnectTables(): void {
  NETS = [];
  CONDUIT = [];
}
