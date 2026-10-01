/**
 * Shape-connecting blocks (fences, walls, panes and iron bars, fence gates,
 * stairs and redstone wire) take their shape from their neighbours; see
 * connectState in placement.ts for the rules.
 *
 * Structures are built block by block, so V4 world generation reshapes every
 * connecting block of a chunk once it is decorated (`connectChunk`), and the
 * server reshapes the ones along a chunk border once the chunk on the other
 * side has loaded (`reconnectSeam`), since generation cannot see into it.
 */
import { blocks, stateCount, STATE_BLOCK } from '../registry/blocks';
import { connectState, type WorldReader } from './placement';
import { conduitBit } from '../engineering/connect';
import { SECTIONS_PER_CHUNK } from '../world/constants';
import type { Chunk } from '../world/chunk';

let CONNECTS: Uint8Array | undefined;

/** Per-state flag: the block's shape depends on its neighbours. */
export function connectsTable(): Uint8Array {
  if (CONNECTS) return CONNECTS;
  const n = stateCount();
  const t = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    const def = blocks[STATE_BLOCK[s]!]!.def;
    if (def.model === 'fence' || def.model === 'wall' || def.model === 'pane' || def.model === 'fence_gate' || def.model === 'stairs' || def.id === 'redstone_wire' || def.id === 'signal_cable' || conduitBit(s)) t[s] = 1;
  }
  CONNECTS = t;
  return t;
}

/**
 * Reshapes every connecting block in a chunk. `read` sees the whole world
 * the chunk is being generated in (its own blocks and whatever is known
 * around it); `write` stores a block inside the chunk.
 */
export function connectChunk(c: Chunk, read: WorldReader, write: (x: number, y: number, z: number, s: number) => void): number {
  const table = connectsTable();
  const bx = c.cx << 4;
  const bz = c.cz << 4;
  let changed = 0;
  for (let si = 0; si < SECTIONS_PER_CHUNK; si++) {
    if (!c.sections[si]) continue;
    for (let y = si * 16; y < si * 16 + 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const s = c.get(x, y, z);
          if (!table[s]) continue;
          const cs = connectState(read, bx + x, y, bz + z, s);
          if (cs !== s) {
            write(bx + x, y, bz + z, cs);
            changed++;
          }
        }
  }
  return changed;
}

/**
 * Reshapes the connecting blocks on both sides of the border between two
 * loaded chunks (a and its neighbour b, side by side). `set` applies a change
 * through the world so that clients hear about it.
 */
export function reconnectSeam(read: WorldReader, a: Chunk, b: Chunk, set: (x: number, y: number, z: number, s: number) => void): number {
  const table = connectsTable();
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  if (Math.abs(dx) + Math.abs(dz) !== 1) return 0;
  let changed = 0;
  const top = Math.max(a.topSection(), b.topSection()) * 16;
  for (const [c, edge] of [
    [a, dx === 1 ? 15 : dx === -1 ? 0 : dz === 1 ? 15 : 0],
    [b, dx === 1 ? 0 : dx === -1 ? 15 : dz === 1 ? 0 : 15],
  ] as const) {
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    for (let y = 0; y < top; y++)
      for (let i = 0; i < 16; i++) {
        const lx = dx !== 0 ? edge : i;
        const lz = dx !== 0 ? i : edge;
        const s = c.get(lx, y, lz);
        if (!table[s]) continue;
        const cs = connectState(read, bx + lx, y, bz + lz, s);
        if (cs !== s) {
          set(bx + lx, y, bz + lz, cs);
          changed++;
        }
      }
  }
  return changed;
}
