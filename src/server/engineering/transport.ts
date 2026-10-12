/**
 * Item transport.
 *
 * - Conveyors carry item entities (see common/engineering/conveyor.ts); at
 *   the end of a belt an item goes into whatever the belt points into, or
 *   falls off.
 * - Hoppers pull from the inventory (or the floor) above and push one item
 *   at a time the way they point; a signal locks them.
 * - Chutes drop what they hold straight into the inventory below.
 * - Item pipes join inventories into a network. Extractors pull from the
 *   inventory they face and send items to the nearest inventory on the
 *   network that takes them, through item filters only when the item passes.
 * - Sorters send items matching their filter out of the front, the rest out
 *   of the back.
 *
 * All of it goes through item ports, so an item is always in exactly one
 * place: a slot, a belt, or the floor.
 */
import type { Dimension } from '../world/Dimension';
import { ItemEntity } from '../entity/ItemEntity';
import { blocks, STATE_BLOCK, getProp } from '../../common/registry/blocks';
import { type ItemStack, fromSaved, isAdminStack, canStack } from '../../common/game/itemstack';
import { FACE_DX, FACE_DY, FACE_DZ, FACE_NAMES, FACE_OPPOSITE } from '../../common/world/constants';
import { FACING_VEC, type BeltContact } from '../../common/engineering/conveyor';
import { COMPONENT_BY_ID } from '../../common/engineering/catalog';
import { joins } from '../../common/engineering/connect';
import { portAt, type Port } from './ports';
import type { Engineering, EngNode } from './Engineering';
import type { EngBE } from './state';

const faceIndex = (name: string): number => (FACE_NAMES as readonly string[]).indexOf(name);

interface Dest {
  x: number;
  y: number;
  z: number;
  /** Face of the destination the item enters through. */
  face: number;
  dist: number;
  /** Item filters on the way there. */
  filters: [number, number, number][];
}

export class ItemTransport {
  /** Extractor key -> destinations along its pipes, nearest first. */
  private readonly routes = new Map<string, Dest[]>();
  private turn = 0;

  constructor(private readonly eng: Engineering) {}

  invalidateAt(_dim: Dimension, _x: number, _y: number, _z: number): void {
    this.routes.clear();
  }

  private port(dim: Dimension, x: number, y: number, z: number, face: number): Port | null {
    return portAt(this.eng.server, dim, x, y, z, face);
  }

  private isBelt(dim: Dimension, x: number, y: number, z: number): boolean {
    const id = blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.id;
    return id === 'conveyor' || id === 'express_conveyor';
  }

  /** A machine got its input from automation (for the "automate a resource" advancement). */
  private markAuto(dim: Dimension, x: number, y: number, z: number): void {
    const be = dim.getBlockEntity(x, y, z) as EngBE | undefined;
    if (be?.type === 'eng' && !be.auto) be.auto = 1;
  }

  /**
   * Hands a stack to the block in direction `face` from (x,y,z): into its
   * inventory, or onto a conveyor there. Returns how many went.
   */
  give(dim: Dimension, x: number, y: number, z: number, face: number, st: ItemStack, simulate = false): number {
    const tx = x + FACE_DX[face];
    const ty = y + FACE_DY[face];
    const tz = z + FACE_DZ[face];
    if (!dim.isLoaded(tx, tz)) return 0;
    if (this.isBelt(dim, tx, ty, tz)) {
      // Only drop onto a belt that isn't crowded at that spot
      const crowded = dim.entitiesNear(tx + 0.5, ty + 0.3, tz + 0.5, 0.45).some((e) => e instanceof ItemEntity);
      if (crowded) return 0;
      if (!simulate) {
        const e = new ItemEntity({ ...st });
        e.setPos(tx + 0.5, ty + 0.3, tz + 0.5);
        e.pickupDelay = 10;
        dim.addEntity(e);
      }
      return st.count;
    }
    const p = this.port(dim, tx, ty, tz, FACE_OPPOSITE[face]);
    if (!p) return 0;
    const n = p.insert(st, simulate);
    if (n > 0 && !simulate) this.markAuto(dim, tx, ty, tz);
    return n;
  }

  // ------------------------------------------------------------------ conveyors

  onBelt(e: ItemEntity, belt: BeltContact): boolean {
    const facing = getProp(belt.state, 'facing') ?? 'north';
    const [fx, fz] = FACING_VEC[facing] ?? [0, -1];
    // How far along the belt (from its middle) the item is
    const along = (e.x - (belt.x + 0.5)) * fx + (e.z - (belt.z + 0.5)) * fz;
    if (along < 0.3) return false;
    const dim = e.dim;
    const nx = belt.x + fx;
    const nz = belt.z + fz;
    if (this.isBelt(dim, nx, belt.y, nz)) return false;
    const f = faceIndex(facing);
    const n = this.give(dim, belt.x, belt.y, belt.z, f, e.stack);
    if (n <= 0) return false;
    if (n >= e.stack.count) {
      e.remove();
      return true;
    }
    e.stack.count -= n;
    e.metaDirty = true;
    return false;
  }

  // ------------------------------------------------------------------ steps

  step(nodes: EngNode[], N: number): void {
    for (const n of nodes) {
      if (n.removed) continue;
      switch (n.c.kind) {
        case 'hopper':
        case 'chute':
          this.hopper(n, N);
          break;
        case 'extractor':
          this.extractor(n, N);
          break;
        case 'sorter':
          this.sorter(n, N);
          break;
        case 'machine':
        case 'multiblock':
          if ((n.c.slots?.output ?? 0) > 0 && this.eng.server.tickNo % 8 === 0) this.eject(n);
          break;
      }
    }
  }

  /** Machines push their results out of the back: into an inventory there, or onto a conveyor. */
  private eject(n: EngNode): void {
    const be = n.be();
    if (!be || be.cfg?.eject === false || !be.items?.some(Boolean)) return;
    const facing = getProp(n.dim.getState(n.x, n.y, n.z), 'facing');
    if (!facing) return;
    const back = FACE_OPPOSITE[faceIndex(facing)];
    const self = this.port(n.dim, n.x, n.y, n.z, back);
    const peek = self?.extract(16, undefined, true);
    if (!self || !peek) return;
    const moved = this.give(n.dim, n.x, n.y, n.z, back, peek, true);
    if (moved <= 0) return;
    const took = self.extract(moved, (s) => s.id === peek.id && isAdminStack(s) === isAdminStack(peek));
    if (!took) return;
    const put = this.give(n.dim, n.x, n.y, n.z, back, took);
    if (put < took.count) {
      // Should not happen (the same tick, the same room): never lose what is left
      const e = new ItemEntity({ ...took, count: took.count - put });
      e.setPos(n.x + 0.5, n.y + 1.1, n.z + 0.5);
      n.dim.addEntity(e);
    }
  }

  private due(n: EngNode, be: EngBE, N: number, time: number): boolean {
    be.progress = (be.progress ?? 0) + N;
    if (be.progress < time) {
      n.dirty = true;
      return false;
    }
    be.progress = 0;
    n.dirty = true;
    return true;
  }

  private hopper(n: EngNode, N: number): void {
    const be = n.be();
    if (!be) return;
    if (n.c.kind === 'hopper' && this.eng.server.power?.powered(n.dim, n.x, n.y, n.z)) return;
    if (!this.due(n, be, N, n.c.time ?? 8)) return;
    const self = this.port(n.dim, n.x, n.y, n.z, 1)!;
    if (!self) return;
    const chute = n.c.kind === 'chute';
    // Push first (the way it points; a chute always down)
    const out = chute ? 0 : faceIndex(getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'down');
    const peek = self.extract(1, undefined, true);
    if (peek) {
      const moved = this.give(n.dim, n.x, n.y, n.z, out, peek);
      if (moved > 0) self.extract(moved);
    }
    if (chute) return;
    // Then pull from above: an inventory, or items lying there
    const above = this.port(n.dim, n.x, n.y + 1, n.z, 0);
    if (above) {
      const st = above.extract(1, (s) => self.insert({ ...s, count: 1 }, true) > 0);
      if (st) self.insert(st);
      return;
    }
    for (const e of n.dim.entitiesNear(n.x + 0.5, n.y + 1.2, n.z + 0.5, 0.9)) {
      if (!(e instanceof ItemEntity) || e.removed || Math.floor(e.y) !== n.y + 1) continue;
      const k = self.insert(e.stack);
      if (k <= 0) continue;
      if (k >= e.stack.count) e.remove();
      else {
        e.stack.count -= k;
        e.metaDirty = true;
      }
      break;
    }
  }

  /** Whether a stack passes a filter (whitelist or blacklist of ghost items; an empty whitelist passes all). */
  passes(be: EngBE | undefined, st: ItemStack): boolean {
    const ghosts = (be?.ghost ?? []).map((g) => fromSaved(g)).filter((g): g is ItemStack => !!g);
    if (!ghosts.length) return true;
    const hit = ghosts.some((g) => g.id === st.id);
    return be?.cfg?.whitelist === false ? !hit : hit;
  }

  private extractor(n: EngNode, N: number): void {
    const be = n.be();
    if (!be) return;
    if (!this.eng.allowed(n)) {
      be.status = 'disabled';
      return;
    }
    const fx = this.eng.upgrades(n);
    if (!this.due(n, be, N * fx.speed, n.c.time ?? 10)) return;
    const use = (n.c.energy?.use ?? 1) * (n.c.time ?? 10) * fx.power;
    if ((be.energy ?? 0) < use) {
      be.status = 'no_power';
      return;
    }
    const facing = faceIndex(getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'north');
    const sx = n.x + FACE_DX[facing];
    const sy = n.y + FACE_DY[facing];
    const sz = n.z + FACE_DZ[facing];
    const src = this.port(n.dim, sx, sy, sz, FACE_OPPOSITE[facing]);
    if (!src) {
      be.status = 'no_input';
      return;
    }
    const dests = this.routesOf(n, [sx, sy, sz]);
    const amount = Math.min(64, Math.round(fx.capacity));
    // Find something to move and somewhere to put it
    const peek = src.extract(amount, (s) => this.passes(be, s) && this.pick(n.dim, dests, s) !== null, true);
    if (!peek) {
      be.status = 'no_input';
      return;
    }
    const dest = this.pick(n.dim, dests, peek)!;
    const room = this.port(n.dim, dest.x, dest.y, dest.z, dest.face)!.insert(peek, true);
    const took = src.extract(room, (s) => s.id === peek.id && isAdminStack(s) === isAdminStack(peek));
    if (!took) return;
    const put = this.port(n.dim, dest.x, dest.y, dest.z, dest.face)!.insert(took);
    if (put < took.count) src.insert({ ...took, count: took.count - put });
    this.markAuto(n.dim, dest.x, dest.y, dest.z);
    be.energy = (be.energy ?? 0) - use;
    be.status = 'working';
    if (!isAdminStack(took)) this.eng.grant(n, 'item_network');
  }

  /** The nearest destination that takes the item (rotating among equally near ones). */
  private pick(dim: Dimension, dests: Dest[], st: ItemStack): Dest | null {
    let best: Dest[] = [];
    for (const d of dests) {
      if (best.length && d.dist > best[0]!.dist) break;
      if (d.filters.some(([x, y, z]) => !this.passes(dim.getBlockEntity(x, y, z) as EngBE | undefined, st))) continue;
      const p = this.port(dim, d.x, d.y, d.z, d.face);
      if (!p || p.insert({ ...st, count: 1 }, true) <= 0) continue;
      best.push(d);
    }
    if (!best.length) {
      // Nothing at the nearest distance: look further out
      best = [];
      for (const d of dests) {
        if (d.filters.some(([x, y, z]) => !this.passes(dim.getBlockEntity(x, y, z) as EngBE | undefined, st))) continue;
        const p = this.port(dim, d.x, d.y, d.z, d.face);
        if (p && p.insert({ ...st, count: 1 }, true) > 0) return d;
      }
      return null;
    }
    return best[this.turn++ % best.length]!;
  }

  /** Inventories reachable along the pipes from an extractor (cached until something changes). */
  private routesOf(n: EngNode, source: [number, number, number]): Dest[] {
    let r = this.routes.get(n.key);
    if (r) return r;
    r = [];
    const dim = n.dim;
    const key = (x: number, y: number, z: number): string => x + ',' + y + ',' + z;
    const seen = new Set([key(n.x, n.y, n.z), key(...source)]);
    const queue: { x: number; y: number; z: number; dist: number; filters: [number, number, number][] }[] = [];
    // Pipes next to the extractor (any side but the one it pulls from)
    const visit = (x: number, y: number, z: number, dist: number, filters: [number, number, number][]): void => {
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const ny = y + FACE_DY[f];
        const nz = z + FACE_DZ[f];
        const k = key(nx, ny, nz);
        if (seen.has(k) || !dim.isLoaded(nx, nz)) continue;
        const s = dim.getState(nx, ny, nz);
        const c = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[s]!]!.id);
        if (c?.kind === 'item_pipe' || c?.kind === 'item_filter') {
          seen.add(k);
          queue.push({ x: nx, y: ny, z: nz, dist: dist + 1, filters: c.kind === 'item_filter' ? [...filters, [nx, ny, nz]] : filters });
        } else if (joins(s, 'item') && c?.kind !== 'extractor' && dist > 0) {
          seen.add(k);
          r!.push({ x: nx, y: ny, z: nz, face: FACE_OPPOSITE[f], dist, filters });
        }
      }
    };
    visit(n.x, n.y, n.z, 0, []);
    while (queue.length && r.length < 256) {
      const q = queue.shift()!;
      visit(q.x, q.y, q.z, q.dist, q.filters);
    }
    this.routes.set(n.key, r);
    return r;
  }

  private sorter(n: EngNode, N: number): void {
    const be = n.be();
    if (!be || !this.due(n, be, N, n.c.time ?? 2)) return;
    const self = this.port(n.dim, n.x, n.y, n.z, 1);
    const held = self?.extract(64, undefined, true);
    if (!self || !held) return;
    const facing = faceIndex(getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'north');
    const out = this.passes(be, held) ? facing : FACE_OPPOSITE[facing];
    const moved = this.give(n.dim, n.x, n.y, n.z, out, held);
    if (moved > 0) self.extract(moved);
  }
}
