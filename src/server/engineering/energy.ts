/**
 * Energy networks.
 *
 * A network is every cable and energy component connected to each other
 * (adjacent components connect directly too). Networks are found by flood
 * fill the first time they are needed and cached; any change to a block on a
 * network, or next to one, or a chunk loading or unloading under one, drops
 * the cache and the network is found again on the next step.
 *
 * Each step, generators offer what is in their buffers, consumers ask for
 * what fits in theirs, and the network shares the energy out in proportion.
 * Batteries take the surplus or cover the shortfall (never both in one
 * step, so batteries don't shuffle energy among themselves). Everything that
 * moves through the network in a step counts against its throughput: the
 * weakest cable's capacity.
 */
import type { Dimension } from '../world/Dimension';
import { blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import { COMPONENT_BY_ID } from '../../common/engineering/catalog';
import { joins } from '../../common/engineering/connect';
import type { EngNode } from './Engineering';

export interface EnergyStats {
  /** EU/t produced and used in the last step. */
  gen: number;
  use: number;
  /** Battery energy stored and capacity. */
  stored: number;
  capacity: number;
  /** EU/t the network can carry. */
  cap: number;
  /** Throughput was the limit last step. */
  limited: boolean;
  /** Demand (EU/t) that went unmet. */
  short: number;
}

export interface EnergyNet {
  id: number;
  dim: Dimension;
  members: Set<string>;
  chunks: Set<string>;
  devices: EngNode[];
  cables: number;
  cap: number;
  stats: EnergyStats;
}

let nextId = 1;
const key = (dim: Dimension, x: number, y: number, z: number): string => `${dim.id}|${x},${y},${z}`;
const MAX_MEMBERS = 20000;

export class EnergyNets {
  private readonly netOf = new Map<string, EnergyNet>();
  readonly nets = new Set<EnergyNet>();

  constructor(private readonly nodeAt: (dim: Dimension, x: number, y: number, z: number) => EngNode | undefined) {}

  /** Something changed at (x,y,z): drop the networks there and next to it. */
  invalidateAt(dim: Dimension, x: number, y: number, z: number): void {
    this.dropAt(key(dim, x, y, z));
    for (let f = 0; f < 6; f++) this.dropAt(key(dim, x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]));
  }

  /** A chunk loaded or unloaded: networks reaching into it or its neighbours are found again. */
  invalidateChunk(dim: Dimension, cx: number, cz: number): void {
    for (const n of [...this.nets]) {
      if (n.dim !== dim) continue;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          if (n.chunks.has(cx + dx + ',' + (cz + dz))) {
            this.drop(n);
            dx = 2;
            break;
          }
    }
  }

  invalidateAll(): void {
    for (const n of [...this.nets]) this.drop(n);
  }

  private dropAt(k: string): void {
    const n = this.netOf.get(k);
    if (n) this.drop(n);
  }

  private drop(n: EnergyNet): void {
    if (!this.nets.delete(n)) return;
    for (const m of n.members) if (this.netOf.get(m) === n) this.netOf.delete(m);
  }

  /** The network at a position (found now if needed), or null if nothing there joins one. */
  netAt(dim: Dimension, x: number, y: number, z: number): EnergyNet | null {
    const k = key(dim, x, y, z);
    const n = this.netOf.get(k);
    if (n) return n;
    if (!dim.isLoaded(x, z) || !joins(dim.getState(x, y, z), 'energy')) return null;
    return this.build(dim, x, y, z);
  }

  private build(dim: Dimension, x0: number, y0: number, z0: number): EnergyNet {
    const net: EnergyNet = { id: nextId++, dim, members: new Set(), chunks: new Set(), devices: [], cables: 0, cap: Infinity, stats: { gen: 0, use: 0, stored: 0, capacity: 0, cap: 0, limited: false, short: 0 } };
    const stack: [number, number, number][] = [[x0, y0, z0]];
    net.members.add(key(dim, x0, y0, z0));
    while (stack.length) {
      const [x, y, z] = stack.pop()!;
      const s = dim.getState(x, y, z);
      const c = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[s]!]!.id);
      net.chunks.add((x >> 4) + ',' + (z >> 4));
      if (c?.kind === 'cable') {
        net.cables++;
        net.cap = Math.min(net.cap, c.cableCap ?? 64);
      } else {
        const node = this.nodeAt(dim, x, y, z);
        if (node?.c.energy) net.devices.push(node);
      }
      if (net.members.size >= MAX_MEMBERS) continue;
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const ny = y + FACE_DY[f];
        const nz = z + FACE_DZ[f];
        const k = key(dim, nx, ny, nz);
        if (net.members.has(k) || !dim.isLoaded(nx, nz)) continue;
        if (!joins(dim.getState(nx, ny, nz), 'energy')) continue;
        net.members.add(k);
        stack.push([nx, ny, nz]);
      }
    }
    for (const m of net.members) {
      const old = this.netOf.get(m);
      if (old && old !== net) this.drop(old);
      this.netOf.set(m, net);
    }
    this.nets.add(net);
    return net;
  }

  /**
   * Shares energy out over every network with something on it. `cap` gives a
   * device's energy capacity (upgrades can raise it).
   */
  step(N: number, nodes: Iterable<EngNode>, capOf: (n: EngNode) => number): void {
    const seen = new Set<EnergyNet>();
    for (const node of nodes) {
      if (!node.c.energy) continue;
      const net = this.netAt(node.dim, node.x, node.y, node.z);
      if (!net || seen.has(net)) continue;
      seen.add(net);
      this.distribute(net, N, capOf);
    }
  }

  private distribute(net: EnergyNet, N: number, capOf: (n: EngNode) => number): void {
    const gens: [EngNode, number][] = [];
    const cons: [EngNode, number][] = [];
    const batOut: [EngNode, number][] = [];
    const batIn: [EngNode, number][] = [];
    let G = 0;
    let D = 0;
    let BO = 0;
    let BI = 0;
    let stored = 0;
    let capacity = 0;
    for (const d of net.devices) {
      if (d.removed) continue;
      const be = d.be();
      if (!be) continue;
      const e = d.c.energy!;
      const cur = be.energy ?? 0;
      const cap = capOf(d);
      if (d.c.kind === 'battery') {
        stored += cur;
        capacity += cap;
        const o = Math.min(cur, (e.maxOut ?? 0) * N);
        const i = Math.min(cap - cur, (e.maxIn ?? 0) * N);
        if (o > 0) (batOut.push([d, o]), (BO += o));
        if (i > 0) (batIn.push([d, i]), (BI += i));
      } else if (e.gen) {
        const o = Math.min(cur, (e.maxOut ?? e.gen) * N);
        if (o > 0) (gens.push([d, o]), (G += o));
      } else {
        const need = Math.min(cap - cur, (e.maxIn ?? 0) * N);
        if (need > 0) (cons.push([d, need]), (D += need));
      }
    }
    const T = net.cap === Infinity ? Infinity : net.cap * N;
    const direct = Math.min(G, D, T);
    const fromBat = Math.min(BO, D - direct, T - direct);
    const toBat = Math.min(G - direct, BI, T - direct - fromBat);
    const add = (n: EngNode, v: number): void => {
      const be = n.be()!;
      be.energy = Math.max(0, (be.energy ?? 0) + v);
      n.dirty = true;
    };
    if (D > 0) for (const [n, need] of cons) add(n, (need * (direct + fromBat)) / D);
    if (G > 0) for (const [n, o] of gens) add(n, -(o * (direct + toBat)) / G);
    if (fromBat > 0 && BO > 0) for (const [n, o] of batOut) add(n, -(o * fromBat) / BO);
    if (toBat > 0 && BI > 0) for (const [n, i] of batIn) add(n, (i * toBat) / BI);
    net.stats = {
      gen: (direct + toBat) / N,
      use: (direct + fromBat) / N,
      stored: stored - fromBat + toBat,
      capacity,
      cap: net.cap,
      limited: T !== Infinity && direct + fromBat + toBat >= T - 1e-6 && (D > direct + fromBat || G > direct + toBat),
      short: Math.max(0, D - direct - fromBat) / N,
    };
  }
}
