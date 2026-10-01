/**
 * Fluid engineering, built on the world's own water and lava.
 *
 * Pumps take source blocks out of the pool they touch (the existing fluid
 * rules refill water pools of two or more sources; lava never refills) into
 * their buffer, 1,000 mB per block. Fluid pipes join pumps, tanks and fluid
 * machines; each step every provider (a pump, or a tank feeding machines)
 * sends fluid along the pipes to the nearest place that takes it. Valves
 * pass fluid only while open; fluid filters only their one fluid. Outlets
 * pour a source block back into the world for every 1,000 mB.
 *
 * Fluid only ever moves from one buffer to another, or between a buffer and
 * a source block in the world, so it is never created or lost.
 */
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { blocks, STATE_BLOCK, STATE_FLUID, STATE_REPLACEABLE, getProp, withProp, S } from '../../common/registry/blocks';
import { items, itemById } from '../../common/registry/items';
import { FACE_DX, FACE_DY, FACE_DZ, FACE_OPPOSITE, FACE_NAMES } from '../../common/world/constants';
import { COMPONENT_BY_ID } from '../../common/engineering/catalog';
import { isAdminStack } from '../../common/game/itemstack';
import type { Engineering, EngNode } from './Engineering';
import type { EngBE, FluidId } from './state';

/** mB a pipe network moves from one provider per tick. */
const FLOW = 100;
const BUCKET = 1000;

interface FluidDest {
  x: number;
  y: number;
  z: number;
  dist: number;
  /** Fluid filters on the way (they pass one fluid). */
  filters: [number, number, number][];
}

const fluidOf = (state: number): FluidId | null => (STATE_FLUID[state] === 1 ? 'water' : STATE_FLUID[state] === 2 ? 'lava' : null);
const isSource = (state: number): boolean => {
  const id = blocks[STATE_BLOCK[state]!]!.id;
  return (id === 'water' || id === 'lava') && getProp(state, 'level') === '0';
};

export class FluidNets {
  private readonly routes = new Map<string, FluidDest[]>();

  constructor(private readonly eng: Engineering) {}

  invalidateAt(_dim: Dimension, _x: number, _y: number, _z: number): void {
    this.routes.clear();
  }

  invalidateChunk(_dim: Dimension, _cx: number, _cz: number): void {
    this.routes.clear();
  }

  /** Room for a fluid in a buffer. */
  room(n: EngNode, be: EngBE, f: FluidId): number {
    const spec = n.c.fluid;
    if (!spec || !spec.accepts.includes(f)) return 0;
    const cur = be.fluid ?? { id: null, amount: 0 };
    if (cur.id && cur.id !== f && cur.amount > 0) return 0;
    const cap = spec.capacity * (n.c.kind === 'tank' ? 1 : this.eng.upgrades(n).capacity);
    return Math.max(0, cap - cur.amount);
  }

  private add(n: EngNode, be: EngBE, f: FluidId, amount: number): void {
    const cur = (be.fluid ??= { id: null, amount: 0 });
    cur.id = f;
    cur.amount += amount;
    n.dirty = true;
    if (n.c.kind === 'tank') this.updateTankVisual(n.dim, n.x, n.y, n.z, be);
  }

  private take(n: EngNode, be: EngBE, amount: number): void {
    const cur = be.fluid!;
    cur.amount = Math.max(0, cur.amount - amount);
    if (cur.amount <= 0) cur.id = null;
    n.dirty = true;
    if (n.c.kind === 'tank') this.updateTankVisual(n.dim, n.x, n.y, n.z, be);
  }

  /** A tank shows its fluid and how full it is. */
  updateTankVisual(dim: Dimension, x: number, y: number, z: number, be: EngBE): void {
    const s = dim.getState(x, y, z);
    const c = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[s]!]!.id);
    if (c?.kind !== 'tank' || !c.fluid) return;
    const f = be.fluid;
    const level = f?.id && f.amount > 0 ? Math.max(1, Math.round((f.amount / c.fluid.capacity) * 8)) : 0;
    const want = withProp(withProp(s, 'fluid', level ? f!.id! : 'none'), 'level', String(level));
    if (want !== s) dim.setBlock(x, y, z, want, { keepBlockEntity: true, updateNeighbors: false });
  }

  // ------------------------------------------------------------------ step

  step(nodes: EngNode[], N: number): void {
    for (const n of nodes) {
      if (n.removed) continue;
      if (n.c.kind === 'pump') this.pump(n, N);
      else if (n.c.kind === 'valve') this.valve(n);
      else if (n.c.kind === 'outlet') this.outlet(n, N);
    }
    for (const n of nodes) {
      if (n.removed) continue;
      if (n.c.kind === 'pump' || n.c.kind === 'tank') this.send(n, N);
    }
  }

  /** Pumps draw a source block from the pool they touch every operation. */
  private pump(n: EngNode, N: number): void {
    const be = n.be();
    if (!be) return;
    const ms = this.eng.machines;
    if (!this.eng.allowed(n)) return ms.setStatus(n, 'disabled');
    const fx = this.eng.upgrades(n);
    const want = be.fluid?.amount ? be.fluid.id! : null;
    if (want && this.room(n, be, want) < BUCKET) return ms.setStatus(n, 'output_full');
    be.progress = (be.progress ?? 0) + N * fx.speed;
    n.dirty = true;
    const use = (n.c.energy?.use ?? 8) * N * fx.power;
    if ((be.energy ?? 0) < use) return ms.setStatus(n, 'no_power');
    be.energy = (be.energy ?? 0) - use;
    if (be.progress < (n.c.time ?? 20)) return ms.setStatus(n, 'working');
    be.progress = 0;
    const src = this.findSource(n, want);
    if (!src) {
      ms.setStatus(n, 'no_input');
      n.sleep = 5;
      return;
    }
    const [x, y, z, f] = src;
    n.dim.setBlock(x, y, z, 0);
    this.add(n, be, f, BUCKET);
    ms.setStatus(n, 'working');
    this.eng.server.playSound(n.dim, 'bucket.fill', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.25, 1.2);
  }

  /** The farthest source block of the pool touching the pump (so the pool shrinks from its far side). */
  private findSource(n: EngNode, want: FluidId | null): [number, number, number, FluidId] | null {
    const dim = n.dim;
    const radius = (n.c.area ?? 6) + this.eng.upgrades(n).range;
    const seen = new Set<string>();
    const queue: [number, number, number][] = [];
    for (let f = 0; f < 6; f++) {
      const x = n.x + FACE_DX[f];
      const y = n.y + FACE_DY[f];
      const z = n.z + FACE_DZ[f];
      const fl = fluidOf(dim.getState(x, y, z));
      if (fl && (!want || fl === want)) {
        queue.push([x, y, z]);
        seen.add(x + ',' + y + ',' + z);
      }
    }
    let best: [number, number, number, FluidId] | null = null;
    let bestD = -1;
    while (queue.length && seen.size < 600) {
      const [x, y, z] = queue.shift()!;
      const s = dim.getState(x, y, z);
      const fl = fluidOf(s)!;
      if (isSource(s)) {
        const d = Math.abs(x - n.x) + Math.abs(y - n.y) + Math.abs(z - n.z);
        if (d > bestD) {
          bestD = d;
          best = [x, y, z, fl];
        }
      }
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const ny = y + FACE_DY[f];
        const nz = z + FACE_DZ[f];
        const k = nx + ',' + ny + ',' + nz;
        if (seen.has(k) || Math.abs(nx - n.x) > radius || Math.abs(nz - n.z) > radius || Math.abs(ny - n.y) > radius) continue;
        if (!dim.isLoaded(nx, nz) || fluidOf(dim.getState(nx, ny, nz)) !== fl) continue;
        seen.add(k);
        queue.push([nx, ny, nz]);
      }
    }
    return best;
  }

  /** A valve follows its signal mode; with no signal mode it stays as set by hand. */
  private valve(n: EngNode): void {
    const be = n.be();
    if (!be) return;
    const mode = be.cfg?.signal ?? 'ignore';
    const open = mode === 'ignore' ? be.cfg?.enabled !== false : this.eng.allowed(n);
    const s = n.dim.getState(n.x, n.y, n.z);
    if ((getProp(s, 'open') === 'true') !== open) {
      n.dim.setBlock(n.x, n.y, n.z, withProp(s, 'open', open ? 'true' : 'false'), { keepBlockEntity: true, updateNeighbors: false });
      this.routes.clear();
    }
  }

  /** Outlets pour a source block of their fluid in front of them. */
  private outlet(n: EngNode, N: number): void {
    const be = n.be();
    if (!be?.fluid?.id || be.fluid.amount < BUCKET || !this.eng.allowed(n)) return;
    be.progress = (be.progress ?? 0) + N;
    if (be.progress < (n.c.time ?? 10)) return;
    be.progress = 0;
    const facing = (FACE_NAMES as readonly string[]).indexOf(getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'north');
    const x = n.x + FACE_DX[facing];
    const y = n.y + FACE_DY[facing];
    const z = n.z + FACE_DZ[facing];
    const there = n.dim.getState(x, y, z);
    if (!(there === 0 || (STATE_REPLACEABLE[there] && !isSource(there)))) return;
    if (n.dim.id === 'nether' && be.fluid.id === 'water') {
      this.take(n, be, BUCKET);
      this.eng.server.particles(n.dim, 'smoke', x + 0.5, y + 0.5, z + 0.5, 8, 0.4);
      return;
    }
    n.dim.setBlock(x, y, z, S(be.fluid.id));
    this.take(n, be, BUCKET);
  }

  /** Sends fluid from a pump or tank along its pipes to whatever takes it, nearest first. */
  private send(n: EngNode, N: number): void {
    const be = n.be();
    const f = be?.fluid?.id;
    if (!be || !f || (be.fluid?.amount ?? 0) <= 0) return;
    let budget = Math.min(be.fluid!.amount, FLOW * N * (n.c.kind === 'pump' ? this.eng.upgrades(n).capacity : 1));
    for (const d of this.routesOf(n)) {
      if (budget <= 0) break;
      if (d.filters.some(([x, y, z]) => ((n.dim.getBlockEntity(x, y, z) as EngBE | undefined)?.cfg?.fluid ?? null) !== f)) continue;
      const t = this.eng.node(n.dim, d.x, d.y, d.z);
      const tbe = t?.be();
      if (!t || !tbe) continue;
      // Tanks only fill from pumps (so tanks never shuffle fluid back and forth)
      if (t.c.kind === 'tank' && n.c.kind !== 'pump') continue;
      if (t.c.kind === 'pump') continue;
      const room = this.room(t, tbe, f);
      const moved = Math.min(room, budget);
      if (moved <= 0) continue;
      this.add(t, tbe, f, moved);
      this.take(n, be, moved);
      budget -= moved;
      if (t.c.kind !== 'tank' || n.c.kind === 'pump') this.eng.grant(n, 'fluid_network');
    }
  }

  /** Fluid components reachable along the pipes (cached until something changes). */
  private routesOf(n: EngNode): FluidDest[] {
    let r = this.routes.get(n.key);
    if (r) return r;
    r = [];
    const dim = n.dim;
    const key = (x: number, y: number, z: number): string => x + ',' + y + ',' + z;
    const seen = new Set([key(n.x, n.y, n.z)]);
    const queue: { x: number; y: number; z: number; dist: number; filters: [number, number, number][] }[] = [{ x: n.x, y: n.y, z: n.z, dist: 0, filters: [] }];
    while (queue.length && r.length < 128) {
      const q = queue.shift()!;
      for (let f = 0; f < 6; f++) {
        const nx = q.x + FACE_DX[f];
        const ny = q.y + FACE_DY[f];
        const nz = q.z + FACE_DZ[f];
        const k = key(nx, ny, nz);
        if (seen.has(k) || !dim.isLoaded(nx, nz)) continue;
        const s = dim.getState(nx, ny, nz);
        const c = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[s]!]!.id);
        if (!c || !c.nets.includes('fluid')) continue;
        seen.add(k);
        if (c.kind === 'fluid_pipe' || c.kind === 'fluid_filter' || (c.kind === 'valve' && getProp(s, 'open') === 'true')) {
          queue.push({ x: nx, y: ny, z: nz, dist: q.dist + 1, filters: c.kind === 'fluid_filter' ? [...q.filters, [nx, ny, nz]] : q.filters });
        } else if (c.kind !== 'valve' && c.fluid) {
          // Fluid components only pass fluid on through pipes, never through each other
          if (q.dist > 0 || q.x !== n.x || q.y !== n.y || q.z !== n.z) r.push({ x: nx, y: ny, z: nz, dist: q.dist + 1, filters: q.filters });
          else r.push({ x: nx, y: ny, z: nz, dist: 1, filters: [] });
        }
      }
    }
    r.sort((a, b) => a.dist - b.dist);
    this.routes.set(n.key, r);
    return r;
  }

  // ------------------------------------------------------------------ buckets

  /** Buckets on fluid blocks: fill from or pour into their buffer. Returns true when handled. */
  useBucket(p: ServerPlayer, n: EngNode): boolean {
    const be = n.be();
    if (!be || !n.c.fluid) return false;
    const held = p.inventory.get(p.selectedSlot);
    const id = held ? items[held.id]!.id : '';
    const creative = p.gamemode === 'creative';
    if (id === 'bucket' && be.fluid?.id && be.fluid.amount >= BUCKET && n.c.kind !== 'outlet') {
      const f = be.fluid.id;
      this.take(n, be, BUCKET);
      if (!creative) {
        const full = { id: itemById.get(f + '_bucket')!.num, count: 1, ...(isAdminStack(held) ? { tag: { admin: true } } : {}) };
        if (held!.count > 1) {
          p.inventory.set(p.selectedSlot, { ...held!, count: held!.count - 1 });
          const rest = p.inventory.add(full);
          if (rest) this.eng.server.interaction.dropStack(p, rest);
        } else p.inventory.set(p.selectedSlot, full);
        this.eng.server.interaction.syncInventory(p);
      }
      this.eng.server.playSound(n.dim, 'bucket.fill', n.x + 0.5, n.y + 0.5, n.z + 0.5, 1, 1);
      return true;
    }
    if (id === 'water_bucket' || id === 'lava_bucket') {
      const f: FluidId = id === 'water_bucket' ? 'water' : 'lava';
      if (this.room(n, be, f) < BUCKET) return false;
      this.add(n, be, f, BUCKET);
      if (!creative) {
        p.inventory.set(p.selectedSlot, { id: itemById.get('bucket')!.num, count: 1 });
        this.eng.server.interaction.syncInventory(p);
      }
      this.eng.server.playSound(n.dim, 'bucket.empty', n.x + 0.5, n.y + 0.5, n.z + 0.5, 1, 1);
      return true;
    }
    return false;
  }
}

export { FACE_OPPOSITE };
