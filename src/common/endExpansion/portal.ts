/**
 * V6: the Expansion Portal's shape, shared by the server (the portal on the
 * main island) and the generator (the return portal at the arrival site).
 *
 * An upright frame of Expansion Portal Frame blocks, 5 wide and 6 tall,
 * standing on an end stone brick plinth and spanning x - 2..x + 2 at one z.
 * Alive, the frame glows and its 3 x 4 opening holds the portal; dormant,
 * the frame is dark and the opening empty.
 */
import { S, stateOf } from '../registry/blocks';

export const PORTAL_HALF_WIDTH = 2;
export const PORTAL_HEIGHT = 6;

type Set = (x: number, y: number, z: number, state: number) => void;

/**
 * Builds the portal with its frame's bottom row at y, centred on x, in the
 * plane z. `clear` also empties the space a step in front of and behind it.
 */
export function buildExpansionPortal(set: Set, x: number, y: number, z: number, alive: boolean, clear = true): void {
  const frame = stateOf('expansion_portal_frame', { lit: alive });
  const portal = alive ? stateOf('expansion_portal', { axis: 'x' }) : 0;
  const plinth = S('end_stone_bricks');
  for (let dz = -1; dz <= 1; dz++) for (let dx = -PORTAL_HALF_WIDTH - 1; dx <= PORTAL_HALF_WIDTH + 1; dx++) set(x + dx, y - 1, z + dz, plinth);
  for (let dy = 0; dy < PORTAL_HEIGHT; dy++)
    for (let dx = -PORTAL_HALF_WIDTH; dx <= PORTAL_HALF_WIDTH; dx++) {
      const edge = Math.abs(dx) === PORTAL_HALF_WIDTH || dy === 0 || dy === PORTAL_HEIGHT - 1;
      set(x + dx, y + dy, z, edge ? frame : portal);
      if (clear) for (const dz of [-1, 1]) set(x + dx, y + dy, z + dz, 0);
    }
}

/** Sets only the parts that change between dormant and alive (frame glow, portal sheet). */
export function setExpansionPortalAlive(set: Set, x: number, y: number, z: number, alive: boolean): void {
  buildExpansionPortal(set, x, y, z, alive, false);
}

/** Every position of the portal's frame (to check it still stands). */
export function expansionPortalFrame(x: number, y: number, z: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let dy = 0; dy < PORTAL_HEIGHT; dy++)
    for (let dx = -PORTAL_HALF_WIDTH; dx <= PORTAL_HALF_WIDTH; dx++) if (Math.abs(dx) === PORTAL_HALF_WIDTH || dy === 0 || dy === PORTAL_HEIGHT - 1) out.push([x + dx, y + dy, z]);
  return out;
}
