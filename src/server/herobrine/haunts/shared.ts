/** Bits the characters' parts share. */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { Dimension } from '../../world/Dimension';
import type { HauntingSystem } from '../Haunting';
import { blocks, STATE_BLOCK, STATE_SOLID, getProp, withProp } from '../../../common/registry/blocks';

/** Ground a haunting may dig through (never anything a player made). */
export const NATURAL = /^(stone|dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|sand|red_sand|sandstone|red_sandstone|gravel|granite|diorite|andesite|deepslate|tuff|calcite|clay|terracotta|[a-z_]+_terracotta|snow_block|mud|moss_block|netherrack|end_stone)$/;

/** A block that stays put whatever happens next to it: solid, and not sand or gravel. */
export function steady(dim: Dimension, x: number, y: number, z: number): boolean {
  const st = dim.getState(x, y, z);
  return !!STATE_SOLID[st] && !(blocks[STATE_BLOCK[st]!]!.def as { gravity?: boolean }).gravity;
}

/**
 * Taking this block away disturbs nothing else: nothing rests on it or
 * hangs off it (a torch, a flower, sand), and no water or lava runs in. So
 * whatever a haunting takes can be put back exactly, and nothing drops.
 */
export function safeToTake(dim: Dimension, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of [
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const) {
    if (dim.getState(x + dx, y + dy, z + dz) !== 0 && !steady(dim, x + dx, y + dy, z + dz)) return false;
  }
  return true;
}

/** Anyone in that dimension can see this point (looking that way, nothing solid between). */
export function seenByAnyone(h: HauntingSystem, dim: Dimension, x: number, y: number, z: number, cos = 0.55): boolean {
  for (const o of h.server.players.values()) {
    if (o.dim !== dim || o.dead) continue;
    if (Math.hypot(o.x - x, o.z - z) > 96) continue;
    if (h.lookingAt(o, x, y, z, cos) && h.clearLine(o, x, y, z)) return true;
  }
  return false;
}

/** A block a player placed (remembered for a while, for whoever takes things away). */
export interface Placed {
  p: string;
  dim: string;
  x: number;
  y: number;
  z: number;
  state: number;
  at: number;
}

/** A sound only one player hears, from somewhere around them. */
export function soundAround(h: HauntingSystem, p: ServerPlayer, name: string, lo: number, hi: number, volume: number, pitch: number, behind = true): void {
  const a = behind ? p.yaw + Math.PI + (h.rng.next() - 0.5) * 1.6 : h.rng.next() * Math.PI * 2;
  const r = lo + h.rng.next() * (hi - lo);
  p.send({ t: 'sound', name, x: p.x - Math.sin(a) * r, y: p.y + 0.5 + h.rng.next() * 1.5, z: p.z - Math.cos(a) * r, volume, pitch });
}

/** A closed door near a player opened (both halves), one nobody is looking at. */
export function openDoor(h: HauntingSystem, p: ServerPlayer, r: number): boolean {
  const dim = p.dim;
  for (let tries = 0; tries < 500; tries++) {
    const x = Math.floor(p.x) + h.rng.int(r * 2 + 1) - r;
    const y = Math.floor(p.y) + h.rng.int(7) - 3;
    const z = Math.floor(p.z) + h.rng.int(r * 2 + 1) - r;
    const st = dim.getState(x, y, z);
    if (!st || blocks[STATE_BLOCK[st]!]!.def.interact !== 'door' || getProp(st, 'open') === 'true') continue;
    if (seenByAnyone(h, dim, x + 0.5, y + 0.5, z + 0.5, 0.5)) continue;
    const oy = getProp(st, 'half') === 'upper' ? y - 1 : y + 1;
    const other = dim.getState(x, oy, z);
    if (!h.set(dim, x, y, z, withProp(st, 'open', true))) continue;
    if (STATE_BLOCK[other] === STATE_BLOCK[st]) h.set(dim, x, oy, z, withProp(other, 'open', true));
    h.server.playSound(dim, 'door.open', x + 0.5, y + 0.5, z + 0.5, 0.8, 0.85);
    return true;
  }
  return false;
}

/** Blocks a part put somewhere (and what was there), to take away again itself. */
export type Cells = [number, number, number, number, number][];

/** Puts a part's blocks back as they were, where nothing has changed them since. */
export function undoCells(h: HauntingSystem, dim: Dimension | undefined, cells: Cells): void {
  if (!dim) return;
  for (let i = cells.length - 1; i >= 0; i--) {
    const [x, y, z, prev, now] = cells[i]!;
    if (!dim.isLoaded(x, z) || dim.getState(x, y, z) !== now) continue;
    dim.setBlock(x, y, z, prev);
    h.server.admin.setBlockMark(dim, x, y, z, false);
  }
  cells.length = 0;
}

/** Sets a block through the haunting (recorded for Stop) and keeps it in `cells` too. */
export function putCell(h: HauntingSystem, dim: Dimension, cells: Cells, x: number, y: number, z: number, state: number): boolean {
  const prev = dim.getState(x, y, z);
  if (!h.set(dim, x, y, z, state)) return false;
  cells.push([x, y, z, prev, state]);
  return true;
}
