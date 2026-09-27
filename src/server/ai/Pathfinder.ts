/**
 * A* pathfinding over the block grid for ground (and swimming) mobs.
 * Nodes are the block positions a mob's feet can occupy. Moves: the four
 * horizontal directions (plus diagonals when both sides are free), step up
 * one block, and drops of up to `maxFall` blocks.
 */
import { collisionShape } from '../../common/physics/shapes';
import { STATE_FLUID, STATE_BLOCK, blocks } from '../../common/registry/blocks';
import type { BlockAccess } from '../../common/physics/movement';

export interface PathNode {
  x: number;
  y: number;
  z: number;
}

export interface PathOptions {
  /** Mob height in blocks (rounded up for clearance). */
  height: number;
  maxFall: number;
  canSwim: boolean;
  /** Aquatic mobs path through water only. */
  aquatic?: boolean;
  avoidWater?: boolean;
  canOpenDoors?: boolean;
  maxNodes?: number;
}

const DANGER = new Set(['lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'sweet_berry_bush', 'campfire', 'wither_rose', 'powder_snow']);

let dangerCache: Uint8Array | null = null;
/** 0 unknown, 1 danger, 2 safe */
function isDanger(s: number): boolean {
  dangerCache ??= new Uint8Array(65536);
  const c = dangerCache[s];
  if (c) return c === 1;
  const id = blocks[STATE_BLOCK[s]!]!.id;
  const d = DANGER.has(id) || STATE_FLUID[s] === 2;
  dangerCache[s] = d ? 1 : 2;
  return d;
}

function topOf(s: number): number {
  const shape = collisionShape(s);
  let top = 0;
  for (const b of shape) if (b[4] > top) top = b[4];
  return top;
}

export class Pathfinder {
  constructor(private readonly world: BlockAccess & { isLoaded(x: number, z: number): boolean }) {}

  private passable(x: number, y: number, z: number, opts: PathOptions): boolean {
    const s = this.world.getState(x, y, z);
    if (s === 0) return true;
    if (isDanger(s)) return false;
    if (STATE_FLUID[s] === 1) return opts.canSwim || !!opts.aquatic;
    const id = blocks[STATE_BLOCK[s]!]!.def.model;
    if (id === 'door' && opts.canOpenDoors) return true;
    return collisionShape(s).length === 0;
  }

  private clear(x: number, y: number, z: number, opts: PathOptions): boolean {
    const h = Math.ceil(opts.height);
    for (let i = 0; i < h; i++) if (!this.passable(x, y + i, z, opts)) return false;
    return true;
  }

  private standable(x: number, y: number, z: number, opts: PathOptions): boolean {
    if (!this.world.isLoaded(x, z)) return false;
    if (!this.clear(x, y, z, opts)) return false;
    const feet = this.world.getState(x, y, z);
    if (STATE_FLUID[feet] === 1) return opts.canSwim || !!opts.aquatic;
    if (opts.aquatic) return false;
    const below = this.world.getState(x, y - 1, z);
    if (below === 0 || isDanger(below)) return false;
    if (STATE_FLUID[below] === 1) return opts.canSwim && !opts.avoidWater;
    const t = topOf(below);
    return t > 0 && t <= 1.0;
  }

  /** Finds a path from the start block position to (near) the goal. Returns null if unreachable. */
  find(sx: number, sy: number, sz: number, gx: number, gy: number, gz: number, opts: PathOptions, reach = 1.5): PathNode[] | null {
    const maxNodes = opts.maxNodes ?? 400;
    // Snap the start to a standable position
    if (!this.standable(sx, sy, sz, opts)) {
      if (this.standable(sx, sy + 1, sz, opts)) sy++;
      else if (this.standable(sx, sy - 1, sz, opts)) sy--;
    }
    const key = (x: number, y: number, z: number): number => ((x - sx + 512) * 1024 + (z - sz + 512)) * 512 + y;
    const open: { k: number; x: number; y: number; z: number; g: number; f: number }[] = [];
    const came = new Map<number, number>();
    const gScore = new Map<number, number>();
    const pos = new Map<number, PathNode>();
    const h = (x: number, y: number, z: number): number => Math.hypot(x - gx, (y - gy) * 1.2, z - gz);
    const k0 = key(sx, sy, sz);
    open.push({ k: k0, x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz) });
    gScore.set(k0, 0);
    pos.set(k0, { x: sx, y: sy, z: sz });
    let best = open[0]!;
    let bestH = best.f;
    let expanded = 0;
    const r2 = reach * reach;
    while (open.length && expanded < maxNodes) {
      // pop lowest f (small open lists: linear scan is fine and allocation free)
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
      const cur = open[bi]!;
      open[bi] = open[open.length - 1]!;
      open.pop();
      expanded++;
      const dh = h(cur.x, cur.y, cur.z);
      if (dh < bestH) {
        bestH = dh;
        best = cur;
      }
      if ((cur.x - gx) ** 2 + (cur.z - gz) ** 2 <= r2 && Math.abs(cur.y - gy) <= 1.5) {
        best = cur;
        bestH = 0;
        break;
      }
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d]![0];
        const dz = DIRS[d]![1];
        const diag = dx !== 0 && dz !== 0;
        const nx = cur.x + dx;
        const nz = cur.z + dz;
        if (diag && (!this.clear(cur.x + dx, cur.y, cur.z, opts) || !this.clear(cur.x, cur.y, cur.z + dz, opts))) continue;
        let ny = -999;
        if (this.standable(nx, cur.y, nz, opts)) ny = cur.y;
        else if (!diag && this.standable(nx, cur.y + 1, nz, opts) && this.clear(cur.x, cur.y + Math.ceil(opts.height), cur.z, opts)) ny = cur.y + 1;
        else if (!diag && this.clear(nx, cur.y, nz, opts)) {
          for (let f = 1; f <= opts.maxFall; f++) {
            if (this.standable(nx, cur.y - f, nz, opts)) {
              ny = cur.y - f;
              break;
            }
            if (!this.passable(nx, cur.y - f, nz, opts)) break;
          }
        } else if (opts.aquatic || opts.canSwim) {
          // Vertical swimming
          if (STATE_FLUID[this.world.getState(nx, cur.y + 1, nz)] === 1 && this.standable(nx, cur.y + 1, nz, opts)) ny = cur.y + 1;
          else if (STATE_FLUID[this.world.getState(nx, cur.y - 1, nz)] === 1 && this.standable(nx, cur.y - 1, nz, opts)) ny = cur.y - 1;
        }
        if (ny === -999) continue;
        const nk = key(nx, ny, nz);
        let cost = diag ? 1.414 : 1;
        if (ny > cur.y) cost += 0.5;
        if (ny < cur.y) cost += (cur.y - ny) * 0.4;
        const inWater = STATE_FLUID[this.world.getState(nx, ny, nz)] === 1;
        if (inWater && !opts.aquatic) cost += opts.avoidWater ? 8 : 2;
        const g = cur.g + cost;
        const old = gScore.get(nk);
        if (old !== undefined && old <= g) continue;
        gScore.set(nk, g);
        came.set(nk, cur.k);
        pos.set(nk, { x: nx, y: ny, z: nz });
        open.push({ k: nk, x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz) * 1.1 });
      }
    }
    if (best.k === k0) return null;
    const path: PathNode[] = [];
    let k: number | undefined = best.k;
    while (k !== undefined && k !== k0) {
      path.push(pos.get(k)!);
      k = came.get(k);
    }
    path.reverse();
    return path;
  }

  /** A random standable position near (x, y, z) within `r` horizontally (for wandering). */
  randomTarget(x: number, y: number, z: number, r: number, vr: number, opts: PathOptions, rnd: () => number): PathNode | null {
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(x + (rnd() * 2 - 1) * r);
      const tz = Math.floor(z + (rnd() * 2 - 1) * r);
      for (let dy = vr; dy >= -vr; dy--) {
        const ty = Math.floor(y) + dy;
        if (this.standable(tx, ty, tz, opts)) return { x: tx, y: ty, z: tz };
      }
    }
    return null;
  }
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
