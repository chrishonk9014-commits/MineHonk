/**
 * Being grabbed and dragged along the ground: the camera cutscene the
 * Haunting's lair ending began with (src/server/herobrine/Haunting.ts), and
 * V7 phase 3's Trick Homes, where a monster pulls whoever knocked in through
 * the door. The ground queries and the 'scene' steps both share live here;
 * each caller keeps its own timeline and does the actual moving.
 *
 * The client side is Game.playScene/sceneCamera and src/client/ui/HauntScene.ts:
 *  - grab: the camera turns to face (x1, y1, z1), red at the edges;
 *  - drag: the camera runs along the ground from (x, y, z) to (x1, y1, z1)
 *    over `ticks`, on your back looking up (strength 0: nowhere to drag, so
 *    on your feet facing the grabber);
 *  - end: back to the game.
 */
import type { Dimension } from './Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID } from '../../common/registry/blocks';

/** Plants and snow layers a figure (or a dragged player) may stand in. */
export const PLANT = /(^|_)(grass|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|bush|sapling|mushroom|snow|marigold|reeds?|sprouts|roots|petals|clover|vine|vines)$/;

/** Air, or a plant or snow layer that can be replaced. */
export function openAt(dim: Dimension, x: number, y: number, z: number): boolean {
  const st = dim.getState(x, y, z);
  return st === 0 || (!STATE_SOLID[st] && !STATE_FLUID[st] && PLANT.test(blocks[STATE_BLOCK[st]!]!.id));
}

/** Something solid to stand on (not water, not leaves). */
export function solidGround(dim: Dimension, x: number, y: number, z: number): boolean {
  const st = dim.getState(x, y, z);
  return !!STATE_SOLID[st] && !STATE_FLUID[st] && !/leaves$/.test(blocks[STATE_BLOCK[st]!]!.id);
}

/**
 * The y to stand at near (x, z): solid ground below, two open blocks above,
 * searched from `range` above the hint downwards (the surface, or a cave floor).
 */
export function floorNear(dim: Dimension, x: number, z: number, yHint: number, range: number): number | null {
  if (!dim.isLoaded(x, z)) return null;
  const top = Math.min(dim.getHeight(x, z) + 1, yHint + range);
  for (let y = top; y >= Math.max(1, yHint - range); y--) {
    if (solidGround(dim, x, y - 1, z) && openAt(dim, x, y, z) && openAt(dim, x, y + 1, z)) return y;
  }
  return null;
}

/**
 * Which way to drag a player: the way they face if the ground there is open
 * and level for a good way, otherwise the most open way round. Returns the
 * direction and how far it is clear (blocks).
 */
export function dragWay(p: ServerPlayer): [[number, number], number] {
  let best: [number, number] = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
  let most = -1;
  for (let i = 0; i < 16; i++) {
    const a = p.yaw + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
    const ux = -Math.sin(a);
    const uz = -Math.cos(a);
    const y0 = Math.floor(p.y);
    let clear = 0;
    for (let step = 1; step <= 11; step++) {
      // Level ground (a block up or down at most) with room above it
      const fy = floorNear(p.dim, Math.floor(p.x + ux * step), Math.floor(p.z + uz * step), y0, 1);
      if (fy === null || Math.abs(fy - y0) > 1 || STATE_SOLID[p.dim.getState(Math.floor(p.x + ux * step), fy + 2, Math.floor(p.z + uz * step))]) break;
      clear = step;
    }
    if (clear >= 11) return [[ux, uz], 11];
    if (clear > most) {
      most = clear;
      best = [ux, uz];
    }
  }
  return [best, Math.max(0, most)];
}

/** The camera turns to whoever grabbed the player (at x1, y1, z1), for `ticks`. */
export function sendGrab(p: ServerPlayer, x1: number, y1: number, z1: number, ticks: number, skip = false): void {
  p.send({ t: 'fx', kind: 'scene', text: 'grab', ticks, x: p.x, y: p.y, z: p.z, x1, y1, z1, ...(skip ? { skip } : {}) });
}

/** The camera is dragged along the ground from `from` to `to` over `ticks` (moves: false when there is nowhere to go). */
export function sendDrag(p: ServerPlayer, from: [number, number, number], to: [number, number, number], ticks: number, moves: boolean, skip = false): void {
  p.send({ t: 'fx', kind: 'scene', text: 'drag', ticks, x: from[0], y: from[1], z: from[2], x1: to[0], y1: to[1], z1: to[2], strength: moves ? 1 : 0, ...(skip ? { skip } : {}) });
}

/** Back to the game. */
export function sendSceneEnd(p: ServerPlayer): void {
  p.send({ t: 'fx', kind: 'scene', text: 'end', ticks: 1 });
}

/** Smoothstep: how far along a pull is at k (0..1). */
export function ease(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}
