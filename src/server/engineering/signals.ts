/**
 * The engineering signal parts that need watching (redstone does the rest,
 * see Power): timers pulse, level sensors read the block behind them, item
 * sensors watch the block in front of them. When their output changes they
 * tell the redstone system, which carries the signal on.
 */
import { ItemEntity } from '../entity/ItemEntity';
import { blocks, STATE_BLOCK, getProp, withProp } from '../../common/registry/blocks';
import { FACE_DX, FACE_DZ } from '../../common/world/constants';
import { portAt } from './ports';
import type { Engineering, EngNode } from './Engineering';
import type { EngBE } from './state';

const FRONT: Record<string, number> = { north: 2, south: 3, west: 4, east: 5 };
/** Ticks a timer's pulse lasts. */
const PULSE = 4;

export class SignalParts {
  constructor(private readonly eng: Engineering) {}

  private emit(n: EngNode, be: EngBE, out: number): void {
    const lit = out > 0;
    const s = n.dim.getState(n.x, n.y, n.z);
    if (be.out === out && (getProp(s, 'lit') === 'true') === lit) return;
    be.out = out;
    n.dirty = true;
    if ((getProp(s, 'lit') === 'true') !== lit) n.dim.setBlock(n.x, n.y, n.z, withProp(s, 'lit', lit ? 'true' : 'false'), { keepBlockEntity: true, updateNeighbors: false });
    this.eng.server.power?.touch(n.dim, n.x, n.y, n.z);
  }

  /** Timers run every tick so their pulses keep time. */
  tick(now: number): void {
    void now;
    for (const n of this.eng.nodes.values()) {
      if (n.c.id !== 'timer' || n.removed) continue;
      const be = n.be();
      if (!be) continue;
      const period = Math.max(PULSE * 2, Math.min(1200, be.cfg?.period ?? 40));
      be.phase = ((be.phase ?? 0) + 1) % period;
      if (be.phase === 0) this.emit(n, be, 15);
      else if (be.phase === PULSE) this.emit(n, be, 0);
    }
  }

  step(nodes: EngNode[]): void {
    for (const n of nodes) {
      if (n.removed) continue;
      if (n.c.id === 'level_sensor') this.level(n);
      else if (n.c.id === 'item_sensor') this.items(n);
    }
  }

  /** How full the block at (x,y,z) is (0..1): energy, fluid, or items. */
  fillAt(n: EngNode, x: number, y: number, z: number, face: number): number | null {
    const target = this.eng.node(n.dim, x, y, z);
    const tbe = target?.be();
    if (target && tbe) {
      if (target.c.energy && (target.c.kind === 'battery' || !target.c.slots || target.c.kind === 'generator')) return (tbe.energy ?? 0) / Math.max(1, this.eng.capacityOf(target));
      if (target.c.fluid && target.c.kind === 'tank') return (tbe.fluid?.amount ?? 0) / target.c.fluid.capacity;
    }
    const port = portAt(this.eng.server, n.dim, x, y, z, face);
    if (port) return port.fill();
    if (target && tbe && target.c.energy) return (tbe.energy ?? 0) / Math.max(1, this.eng.capacityOf(target));
    return null;
  }

  private level(n: EngNode): void {
    const be = n.be();
    if (!be) return;
    const s = n.dim.getState(n.x, n.y, n.z);
    const front = FRONT[getProp(s, 'facing') ?? 'north'] ?? 2;
    const back = front ^ 1;
    const fill = this.fillAt(n, n.x + FACE_DX[back], n.y, n.z + FACE_DZ[back], front);
    const pct = (fill ?? 0) * 100;
    const mode = be.cfg?.mode ?? 'level';
    const th = be.cfg?.threshold ?? 50;
    const out = fill === null ? 0 : mode === 'above' ? (pct >= th ? 15 : 0) : mode === 'below' ? (pct < th ? 15 : 0) : Math.round((fill ?? 0) * 15);
    this.emit(n, be, out);
  }

  private items(n: EngNode): void {
    const be = n.be();
    if (!be) return;
    const s = n.dim.getState(n.x, n.y, n.z);
    const front = FRONT[getProp(s, 'facing') ?? 'north'] ?? 2;
    const x = n.x + FACE_DX[front] + 0.5;
    const z = n.z + FACE_DZ[front] + 0.5;
    const seen = n.dim.entitiesNear(x, n.y + 0.5, z, 1).some((e) => e instanceof ItemEntity && !e.removed && Math.abs(e.x - x) < 0.6 && Math.abs(e.z - z) < 0.6 && e.y >= n.y - 0.1 && e.y < n.y + 1.2);
    this.emit(n, be, seen ? 15 : 0);
  }
}

export { blocks, STATE_BLOCK };
