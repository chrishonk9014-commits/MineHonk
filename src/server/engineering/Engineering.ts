/**
 * V5 - The Engineering Update: the server side.
 *
 * Keeps an index of the engineering blocks in loaded chunks (built from
 * their block entities when a chunk loads, kept up to date as blocks are
 * placed and broken) and runs them in steps every ENG_STEP ticks:
 *
 *   1. generators make energy into their buffers;
 *   2. energy networks share it out;
 *   3. machines work (processing, multiblocks, mining, farming, pumps);
 *   4. items move (hoppers, chutes, pipes, sorters);
 *   5. fluids move along fluid networks;
 *   6. sensors and timers update their signals;
 *   7. computers run (V5.5) and server racks keep their drives spinning;
 *   8. monitors, control panels and open windows are refreshed.
 *
 * Conveyors move items every tick (as part of the items' own physics).
 * Idle machines sleep for a few steps and wake when something reaches them.
 * Unloaded chunks don't run: their machines wait in their block entities.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Chunk } from '../../common/world/chunk';
import { blocks, STATE_BLOCK, getProp, withProp, hasProp } from '../../common/registry/blocks';
import { itemById, items } from '../../common/registry/items';
import { type ItemStack, isAdminStack } from '../../common/game/itemstack';
import { COMPONENT_BY_ID, type ComponentDef } from '../../common/engineering/catalog';
import type { BeltContact } from '../../common/engineering/conveyor';
import { EnergyNets } from './energy';
import { newBE, compOf, rangesOf, upgradeEffect, isUpgrade, type EngBE, type UpgradeEffect } from './state';
import { MachineLogic } from './machines';
import { ItemTransport } from './transport';
import { FluidNets } from './fluids';
import { EngWindows } from './windows';
import { ControlRoom } from './control';
import { SignalParts } from './signals';
import { Computers } from './computer/Computers';
import type { ItemEntity } from '../entity/ItemEntity';

export const ENG_STEP = 4;

export interface EngNode {
  key: string;
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  c: ComponentDef;
  removed: boolean;
  /** Block entity changed this step (saved at the end of the step). */
  dirty: boolean;
  /** Steps left to sleep (idle machines). */
  sleep: number;
  /** Energy made last step (EU/t), for monitors. */
  rate: number;
  be(): EngBE | undefined;
}

export class Engineering {
  readonly nodes = new Map<string, EngNode>();
  readonly energy: EnergyNets;
  readonly machines: MachineLogic;
  readonly transport: ItemTransport;
  readonly fluids: FluidNets;
  readonly windows: EngWindows;
  readonly control: ControlRoom;
  readonly signals: SignalParts;
  readonly computers: Computers;
  /** Time spent in the last step (ms), for the Admin Panel. */
  lastStepMs = 0;

  constructor(readonly server: GameServer) {
    this.energy = new EnergyNets((dim, x, y, z) => this.nodes.get(Engineering.key(dim, x, y, z)));
    this.machines = new MachineLogic(this);
    this.transport = new ItemTransport(this);
    this.fluids = new FluidNets(this);
    this.windows = new EngWindows(this);
    this.control = new ControlRoom(this);
    this.signals = new SignalParts(this);
    this.computers = new Computers(this);
    // Chunks loaded before the system was installed (spawn chunks)
    for (const dim of server.dims.values()) for (const c of dim.chunks.values()) this.onChunkLoaded(dim, c);
  }

  static key(dim: Dimension, x: number, y: number, z: number): string {
    return `${dim.id}|${x},${y},${z}`;
  }

  node(dim: Dimension, x: number, y: number, z: number): EngNode | undefined {
    return this.nodes.get(Engineering.key(dim, x, y, z));
  }

  private addNode(dim: Dimension, x: number, y: number, z: number, c: ComponentDef): EngNode {
    const key = Engineering.key(dim, x, y, z);
    const old = this.nodes.get(key);
    if (old && old.c === c && !old.removed) return old;
    if (old) old.removed = true;
    const node: EngNode = {
      key,
      dim,
      x,
      y,
      z,
      c,
      removed: false,
      dirty: false,
      sleep: 0,
      rate: 0,
      be: () => {
        const be = dim.getBlockEntity(x, y, z) as EngBE | undefined;
        return be && be.type === 'eng' ? be : undefined;
      },
    };
    this.nodes.set(key, node);
    return node;
  }

  private removeNode(dim: Dimension, x: number, y: number, z: number): void {
    const key = Engineering.key(dim, x, y, z);
    const n = this.nodes.get(key);
    if (!n) return;
    n.removed = true;
    this.nodes.delete(key);
    this.windows.closeAt(dim, x, y, z);
    if (n.c.kind === 'computer') {
      this.computers.closeAt(n);
      this.server.herobrine?.onComputerGone(n);
    }
  }

  // ------------------------------------------------------------------ hooks

  onChunkLoaded(dim: Dimension, c: Chunk): void {
    for (const [k, be] of c.blockEntities) {
      if (be.type !== 'eng') continue;
      const x = (c.cx << 4) + (k & 15);
      const y = k >> 8;
      const z = (c.cz << 4) + ((k >> 4) & 15);
      const comp = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[c.get(k & 15, y, (k >> 4) & 15)]!]!.id);
      if (comp) this.addNode(dim, x, y, z, comp);
    }
    this.energy.invalidateChunk(dim, c.cx, c.cz);
    this.fluids.invalidateChunk(dim, c.cx, c.cz);
  }

  onChunkUnloaded(dim: Dimension, c: Chunk): void {
    // Save what changed, then forget the chunk's machines until it loads again
    for (const n of [...this.nodes.values()]) {
      if (n.dim !== dim || n.x >> 4 !== c.cx || n.z >> 4 !== c.cz) continue;
      this.flush(n);
      n.removed = true;
      this.nodes.delete(n.key);
    }
    this.energy.invalidateChunk(dim, c.cx, c.cz);
    this.fluids.invalidateChunk(dim, c.cx, c.cz);
  }

  /** Every authoritative block change. */
  onBlockChanged(dim: Dimension, x: number, y: number, z: number, old: number, state: number): void {
    const oldC = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[old]!]!.id);
    const newC = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[state]!]!.id);
    // Peripherals, monitors and parts around computers
    this.computers.invalidateAround(dim.id, x, y, z);
    if (!oldC && !newC) {
      // A neighbour of a machine changed (water for a wheel, crops for a harvester...)
      return;
    }
    if (oldC && oldC !== newC) this.removeNode(dim, x, y, z);
    if (newC && newC !== oldC && blocks[STATE_BLOCK[state]!]!.def.entity === 'eng') {
      // Placed by a player (onPlaced sets it up) or by anything else: make sure it has its state
      let be = dim.getBlockEntity(x, y, z) as EngBE | undefined;
      if (!be || be.type !== 'eng' || be.id !== newC.id) {
        be = newBE(newC);
        dim.setBlockEntity(x, y, z, be);
      }
      this.addNode(dim, x, y, z, newC);
    }
    if ((oldC && oldC.nets.includes('energy')) || (newC && newC.nets.includes('energy')) || oldC?.kind === 'cable' || newC?.kind === 'cable') this.energy.invalidateAt(dim, x, y, z);
    this.fluids.invalidateAt(dim, x, y, z);
    this.transport.invalidateAt(dim, x, y, z);
    this.control.invalidate();
  }

  /** A player placed an engineering block: who placed it, and what its item carried (battery charge, tank contents). */
  onPlaced(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number, stack: ItemStack): void {
    const c = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.id);
    if (!c) return;
    const be = (dim.getBlockEntity(x, y, z) as EngBE | undefined) ?? newBE(c);
    be.by = p.uuid;
    const data = stack.tag?.data as { energy?: number; fluid?: EngBE['fluid'] } | undefined;
    if (data && typeof data.energy === 'number' && c.energy) be.energy = Math.max(0, Math.min(c.energy.capacity, data.energy));
    if (data?.fluid && c.fluid && (data.fluid.id === 'water' || data.fluid.id === 'lava')) be.fluid = { id: data.fluid.id, amount: Math.max(0, Math.min(c.fluid.capacity, Math.floor(data.fluid.amount))) };
    if (isAdminStack(stack) || this.server.admin.inContext(p)) be.cheat = 1;
    dim.setBlockEntity(x, y, z, be);
    this.addNode(dim, x, y, z, c);
    this.machines.refreshVisual(this.node(dim, x, y, z)!);
    if (c.kind === 'tank') this.fluids.updateTankVisual(dim, x, y, z, be);
  }

  /** Batteries keep their charge and tanks their contents when broken. */
  decorateDrops(be: unknown, dropped: ItemStack[]): void {
    const b = be as EngBE | undefined;
    if (!b || b.type !== 'eng') return;
    const c = compOf(b.id);
    if (!c || (c.kind !== 'battery' && c.kind !== 'tank')) return;
    const st = dropped.find((s) => items[s.id]?.id === c.id);
    if (!st) return;
    const data: Record<string, unknown> = {};
    if (c.kind === 'battery' && (b.energy ?? 0) > 0) data.energy = Math.floor(b.energy ?? 0);
    if (c.kind === 'tank' && b.fluid?.id && b.fluid.amount > 0) data.fluid = { id: b.fluid.id, amount: Math.floor(b.fluid.amount) };
    if (Object.keys(data).length) st.tag = { ...(st.tag ?? {}), data };
  }

  /** Using an engineering block (or the Engineering Crafting Table). Returns true when handled. */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const id = blocks[STATE_BLOCK[state]!]!.id;
    if (id === 'engineering_table') {
      if (p.gamemode === 'spectator') return true;
      this.server.interaction.containers.openEngineeringTable(p, p.dim, x, y, z);
      return true;
    }
    const c = COMPONENT_BY_ID.get(id);
    if (!c) return false;
    const held = p.inventory.get(p.selectedSlot);
    const heldId = held ? items[held.id]!.id : '';
    // The Engineering Book opens this block's page (on the client)
    if (heldId === 'engineering_book') return true;
    // A keyboard, mouse or screen beside a computer is a way to use it
    if (c.kind === 'peripheral' || (c.kind === 'monitor' && !p.sneaking && this.computers.drivenMonitor(p.dim, x, y, z))) {
      const pc = this.computers.besides(p.dim, x, y, z);
      if (!pc) return c.kind !== 'peripheral' ? false : true;
      if (p.gamemode !== 'spectator') this.computers.openFor(p, pc);
      return true;
    }
    const n = this.node(p.dim, x, y, z);
    if (!n) return false;
    if (p.gamemode === 'spectator') return true;
    if (c.kind === 'computer') {
      this.computers.openFor(p, n);
      return true;
    }
    if ((heldId === 'bucket' || heldId === 'water_bucket' || heldId === 'lava_bucket') && this.fluids.useBucket(p, n)) return true;
    if (c.kind === 'fluid_filter' && (heldId === 'water_bucket' || heldId === 'lava_bucket')) {
      const be = n.be();
      if (be) {
        (be.cfg ??= {}).fluid = heldId === 'water_bucket' ? 'water' : 'lava';
        p.dim.setBlockEntity(x, y, z, be);
        this.fluids.invalidateAt(p.dim, x, y, z);
        p.send({ t: 'chat', text: `Fluid Filter: passes ${be.cfg.fluid} only.`, kind: 'system' });
      }
      return true;
    }
    this.windows.quickUse(p, n);
    return true;
  }

  /** Something arrived at a machine: let it work on the next step. */
  wake(dim: Dimension, x: number, y: number, z: number): void {
    const n = this.node(dim, x, y, z);
    if (n) n.sleep = 0;
  }

  refreshWindows(dim: Dimension, x: number, y: number, z: number): void {
    this.windows.refreshAt(dim, x, y, z);
  }

  /** An item on a conveyor; returns true when it was handed on (and the entity is gone). */
  onBelt(e: ItemEntity, belt: BeltContact): boolean {
    return this.transport.onBelt(e, belt);
  }

  isRecipeInput(c: ComponentDef, s: ItemStack): boolean {
    return this.machines.isInput(c, s);
  }

  // ------------------------------------------------------------------ helpers

  /** Writes a changed block entity back (marks its chunk for saving). */
  flush(n: EngNode): void {
    if (!n.dirty || n.removed) return;
    n.dirty = false;
    const be = n.be();
    if (be) n.dim.setBlockEntity(n.x, n.y, n.z, be);
  }

  /** Upgrades installed in a machine. */
  upgrades(n: EngNode): UpgradeEffect {
    const r = rangesOf(n.c);
    if (r.upgrades[1] === r.upgrades[0]) return upgradeEffect({});
    const be = n.be();
    const counts: Record<string, number> = {};
    for (let i = r.upgrades[0]; i < r.upgrades[1]; i++) {
      const s = be?.items?.[i];
      if (s && isUpgrade(s.id)) counts[s.id] = (counts[s.id] ?? 0) + s.count;
    }
    return upgradeEffect(counts);
  }

  /** Energy capacity with upgrades. */
  capacityOf(n: EngNode): number {
    const base = n.c.energy?.capacity ?? 0;
    return n.c.kind === 'battery' ? base : base * this.upgrades(n).capacity;
  }

  /** Whether a machine may run: switched on, and its signal mode satisfied. */
  allowed(n: EngNode): boolean {
    const cfg = n.be()?.cfg;
    if (cfg?.enabled === false) return false;
    const mode = cfg?.signal ?? 'ignore';
    if (mode === 'ignore') return true;
    const powered = !!this.server.power?.powered(n.dim, n.x, n.y, n.z);
    return mode === 'on' ? powered : !powered;
  }

  /** Sets a block's visual status (front lights) without disturbing its block entity. */
  setBlockProp(n: EngNode, prop: string, value: string): void {
    const s = n.dim.getState(n.x, n.y, n.z);
    if (!hasProp(s, prop) || getProp(s, prop) === value) return;
    n.dim.setBlock(n.x, n.y, n.z, withProp(s, prop, value), { keepBlockEntity: true, updateNeighbors: false });
  }

  /** The player who placed a block, if online (advancements are credited to them). */
  owner(n: EngNode): ServerPlayer | null {
    const be = n.be();
    if (!be?.by || be.cheat) return null;
    if (this.server.admin.blockMarked(n.dim, n.x, n.y, n.z)) return null;
    for (const p of this.server.players.values()) if (p.uuid === be.by) return p;
    return null;
  }

  grant(n: EngNode, id: string): void {
    const p = this.owner(n);
    if (p && !p.achievements.has(id)) this.server.interaction.grant(p, id);
  }

  itemNum(id: string): number {
    return itemById.get(id)!.num;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const now = this.server.tickNo;
    // Forget machines whose block went away without a neighbour update
    if (now % 100 === 50) for (const n of [...this.nodes.values()]) if (!n.be() || COMPONENT_BY_ID.get(n.dim.blockId(n.x, n.y, n.z)) !== n.c) this.removeNode(n.dim, n.x, n.y, n.z);
    this.signals.tick(now);
    if (now % ENG_STEP !== 0) return;
    const t0 = performance.now();
    const nodes = [...this.nodes.values()];
    this.machines.generate(nodes, ENG_STEP);
    this.energy.step(ENG_STEP, nodes, (n) => this.capacityOf(n));
    this.machines.work(nodes, ENG_STEP);
    this.transport.step(nodes, ENG_STEP);
    this.fluids.step(nodes, ENG_STEP);
    this.signals.step(nodes);
    this.computers.step(nodes, ENG_STEP);
    if (now % 20 === 0) this.control.refresh(nodes);
    this.windows.step();
    for (const n of nodes) this.flush(n);
    this.lastStepMs = performance.now() - t0;
  }
}
