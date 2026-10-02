/**
 * V6 - The End Expansion, phase 4: End engineering on the server.
 *
 * End Power is EU: the Crystal Generator, the Void Collector and a restored
 * Ancient Core make it into their buffers, and the energy networks carry it
 * like any other. This module is called from the shared machine logic for
 * what only End blocks do:
 *
 * - the three End generators (fuel, the open void below, forever);
 * - the Crystal Grower (a cluster on Crystalline End Stone beside it);
 * - the Restored Ancient Lens (The Lost Observatory: 256 EU/t for 30 s wakes it);
 * - the Crystal Pedestals (The Crystal Vault: powered from a Crystal Generator);
 * - the Ender Bridge Projector (a bridge of Ender Light; it flickers and
 *   fades over 3 seconds without power or its signal);
 * - the Ender Rail (powered by a signal, or 1 EU/t);
 * - the Teleportation Node's window (the trips themselves are in
 *   systems/EndTransport.ts).
 *
 * Phase 5 hook: `voidStormFactor` multiplies the Void Collector (x4 during a
 * Void Storm); it is 1 until then.
 */
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { blocks, STATE_BLOCK, getProp, withProp, S } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { isAdminStack } from '../../common/game/itemstack';
import { CRYSTAL_GEN, VOID_COLLECTOR, COMPONENT_BY_ID } from '../../common/engineering/catalog';
import { BRIDGE, NODE, nodeCost } from '../../common/endExpansion/transport';
import { QUEST } from '../../common/endExpansion/quests';
import type { MachineProps } from '../../common/engineering/window';
import type { Engineering, EngNode } from './Engineering';
import { rangesOf, type EngBE } from './state';

const FACE: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** A bridge left behind by a projector that was broken: it fades on its own. */
interface Orphan {
  dim: Dimension;
  cells: [number, number, number][];
  left: number;
}

export class EndEngineering {
  private readonly orphans: Orphan[] = [];

  constructor(private readonly eng: Engineering) {}

  private get server() {
    return this.eng.server;
  }

  /** Phase 5 hook: how strongly the void gives (x4 in a Void Storm). Always 1 in phase 4. */
  voidStormFactor(dim: Dimension, x: number, z: number): number {
    return this.server.endEvents?.voidStormFactor(dim, x, z) ?? 1;
  }

  /** Nothing but air under (x,y,z), all the way down, and at least VOID_COLLECTOR.air blocks of it. */
  voidBelow(dim: Dimension, x: number, y: number, z: number): boolean {
    if (y < VOID_COLLECTOR.air) return false;
    for (let yy = y - 1; yy >= 0; yy--) if (dim.getState(x, yy, z) !== 0) return false;
    return true;
  }

  // ------------------------------------------------------------------ generators

  /** EU/t an End generator makes this step, or null when it can't (its status is set). */
  generate(n: EngNode, be: EngBE, N: number): number | null {
    const m = this.eng.machines;
    switch (n.c.id) {
      case 'crystal_generator': {
        if ((be.burn ?? 0) <= 0) {
          const ct = this.server.interaction.containers;
          const r = rangesOf(n.c);
          const inv = ct.containerAt(n.dim, n.x, n.y, n.z, r.size, 'eng');
          const fuel = inv.get(r.fuel[0]);
          if (!fuel || items[fuel.id]!.id !== 'end_crystal_fragment') {
            m.setStatus(n, 'no_fuel');
            return null;
          }
          inv.set(r.fuel[0], fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null);
          if (isAdminStack(fuel)) be.cheat = 1;
          be.burn = be.burnTotal = CRYSTAL_GEN.burn;
          ct.persist(n.dim, n.x, n.y, n.z, inv);
          this.eng.windows.refreshAt(n.dim, n.x, n.y, n.z);
        }
        be.burn = Math.max(0, (be.burn ?? 0) - N);
        if (!be.cheat) this.eng.grant(n, 'run_crystal_generator');
        return CRYSTAL_GEN.gen;
      }
      case 'void_collector':
        if (!this.voidBelow(n.dim, n.x, n.y, n.z)) {
          m.setStatus(n, 'no_void');
          return null;
        }
        return VOID_COLLECTOR.gen * this.voidStormFactor(n.dim, n.x, n.z);
      case 'restored_ancient_core':
        return n.c.energy!.gen!;
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ machines and transport

  /** End machines and transport blocks that aren't processing machines. */
  work(nodes: EngNode[], N: number): void {
    for (const n of nodes) {
      if (n.removed) continue;
      // A Void Cell filled to the brim (by its owner's own power)
      if (n.c.id === 'void_cell') {
        const be = n.be();
        if (be && !be.cheat && !be.full && (be.energy ?? 0) >= (n.c.energy?.capacity ?? Infinity)) {
          be.full = 1;
          this.eng.grant(n, 'fill_void_cell');
        }
        continue;
      }
      const mc = n.c.machine;
      if (mc !== 'grower' && mc !== 'lens' && mc !== 'pedestal' && mc !== 'bridge' && mc !== 'rail') continue;
      const be = n.be();
      if (!be) continue;
      switch (mc) {
        case 'grower':
          this.grow(n, be, N);
          break;
        case 'lens':
          this.lens(n, be, N);
          break;
        case 'pedestal':
          this.pedestal(n, be, N);
          break;
        case 'bridge':
          this.bridge(n, be, N);
          break;
        case 'rail':
          this.rail(n, be, N);
          break;
      }
    }
    this.fadeOrphans(N);
    this.hum(nodes);
  }

  /** The End machines' working sounds: each hums now and then while it works (staggered, so a room of them isn't a chord). */
  private hum(nodes: EngNode[]): void {
    const t = this.server.tickNo >> 2;
    for (const n of nodes) {
      if (n.removed || !HUMS.has(n.c.id)) continue;
      if ((t + ((n.x * 7 + n.z * 13 + n.y) & 31)) % 20 !== 0) continue;
      if (!String(n.be()?.status ?? '').startsWith('working')) continue;
      this.server.playSound(n.dim, `machine.${n.c.id}`, n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.35, 1);
    }
  }

  /** Crystalline End Stone beside the grower with room on top for a cluster. */
  private growSpot(n: EngNode): [number, number, number] | null {
    const spots: [number, number, number][] = [];
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
      [0, 1, 0],
    ] as const) {
      const x = n.x + dx;
      const y = n.y + dy;
      const z = n.z + dz;
      if (blocks[STATE_BLOCK[n.dim.getState(x, y, z)]!]!.id !== 'crystalline_end_stone') continue;
      if (n.dim.getState(x, y + 1, z) === 0) spots.push([x, y + 1, z]);
    }
    return spots.length ? spots[(this.server.tickNo >> 2) % spots.length]! : null;
  }

  private grow(n: EngNode, be: EngBE, N: number): void {
    const m = this.eng.machines;
    if (!this.eng.allowed(n)) return m.setStatus(n, 'disabled');
    const spot = this.growSpot(n);
    if (!spot) {
      if (be.progress) be.progress = 0;
      n.dirty = true;
      return m.setStatus(n, 'no_stone');
    }
    const use = (n.c.energy?.use ?? 0) * N * this.eng.upgrades(n).power;
    if ((be.energy ?? 0) < use) return m.setStatus(n, 'no_power');
    be.energy = (be.energy ?? 0) - use;
    be.progress = (be.progress ?? 0) + N * this.eng.upgrades(n).speed;
    n.dirty = true;
    m.setStatus(n, 'working');
    if (be.progress < (n.c.time ?? 6000)) return;
    be.progress = 0;
    n.dim.setBlock(spot[0], spot[1], spot[2], S('end_crystal_cluster'));
    this.server.playSound(n.dim, 'block.crystal_grow', spot[0] + 0.5, spot[1] + 0.5, spot[2] + 0.5, 0.8, 1);
    this.server.particles(n.dim, 'portal', spot[0] + 0.5, spot[1] + 0.5, spot[2] + 0.5, 10, 0.4);
  }

  /** The Restored Ancient Lens: 256 EU/t for 30 seconds without a break wakes it, for good. */
  private lens(n: EngNode, be: EngBE, N: number): void {
    const m = this.eng.machines;
    if (be.awake) {
      m.setStatus(n, 'working');
      return;
    }
    const use = QUEST.lensEU * N;
    if ((be.energy ?? 0) < use) {
      if (be.charge) {
        be.charge = 0;
        n.dirty = true;
      }
      return m.setStatus(n, 'no_power');
    }
    be.energy = (be.energy ?? 0) - use;
    be.charge = Number(be.charge ?? 0) + N;
    n.dirty = true;
    if (Number(be.charge) >= QUEST.lensTicks) {
      be.awake = true;
      this.server.playSound(n.dim, 'block.lens_wake', n.x + 0.5, n.y + 0.5, n.z + 0.5, 1.2, 1);
      this.server.particles(n.dim, 'end_rod', n.x + 0.5, n.y + 0.5, n.z + 0.5, 30, 0.8);
      this.server.endQuests?.onLensAwake(n.dim, n.x, n.y, n.z);
      m.setStatus(n, 'working');
    } else m.setStatus(n, 'charging');
  }

  /** Crystal Pedestals: with a crystal, they draw 64 EU/t; powered only from a network with a working Crystal Generator. */
  private pedestal(n: EngNode, be: EngBE, N: number): void {
    const st = n.dim.getState(n.x, n.y, n.z);
    const crystal = getProp(st, 'crystal') === 'true';
    let powered = false;
    if (crystal) {
      const use = QUEST.pedestalEU * N;
      const net = this.eng.energy.netAt(n.dim, n.x, n.y, n.z);
      const crystalGen = !!net?.devices.some((d) => !d.removed && d.c.id === 'crystal_generator' && ((d.be()?.burn ?? 0) > 0 || d.rate > 0));
      if (crystalGen && (be.energy ?? 0) >= use) {
        be.energy = (be.energy ?? 0) - use;
        powered = true;
      }
    }
    if (!!be.powered !== powered) {
      be.powered = powered;
      n.dirty = true;
    }
    this.eng.machines.setStatus(n, !crystal ? 'no_crystal' : powered ? 'working' : 'no_crystal_power');
  }

  /** The cells a projector's bridge would fill now (to the first block in the way, 64 at most, loaded only). */
  private bridgePath(n: EngNode): [number, number, number][] {
    const f = FACE[getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'north'] ?? FACE.north!;
    const out: [number, number, number][] = [];
    const light = S('ender_light');
    for (let i = 1; i <= BRIDGE.max; i++) {
      const x = n.x + f[0] * i;
      const z = n.z + f[1] * i;
      if (!n.dim.isLoaded(x, z)) break;
      const s = n.dim.getState(x, n.y, z);
      if (s !== 0 && STATE_BLOCK[s] !== STATE_BLOCK[light]) break;
      out.push([x, n.y, z]);
    }
    return out;
  }

  /** EU/t a bridge of `len` blocks draws. */
  static bridgeUse(len: number): number {
    return BRIDGE.euPer16 * Math.ceil(len / 16);
  }

  private bridge(n: EngNode, be: EngBE, N: number): void {
    const m = this.eng.machines;
    const path = this.bridgePath(n);
    const len = path.length;
    const use = EndEngineering.bridgeUse(len) * N;
    const ok = this.eng.allowed(n) && len > 0 && (be.energy ?? 0) >= use;
    const light = S('ender_light');
    const old = Number(be.len ?? 0);
    const f = FACE[getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'north'] ?? FACE.north!;
    // Cells beyond a shortened bridge go at once
    for (let i = len + 1; i <= old; i++) {
      const x = n.x + f[0] * i;
      const z = n.z + f[1] * i;
      if (n.dim.isLoaded(x, z) && STATE_BLOCK[n.dim.getState(x, n.y, z)] === STATE_BLOCK[light]) n.dim.setBlock(x, n.y, z, 0);
    }
    if (ok) {
      be.energy = (be.energy ?? 0) - use;
      if (be.fade || old !== len) {
        for (const [x, y, z] of path) {
          const s = n.dim.getState(x, y, z);
          if (s === 0 || getProp(s, 'fade') !== '0') n.dim.setBlock(x, y, z, light, { updateNeighbors: false });
        }
        if (old < len) this.server.playSound(n.dim, 'block.bridge_on', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.8, 1);
      }
      be.len = len;
      be.fade = 0;
      n.dirty = true;
      (n as EngNode & { bridge?: unknown }).bridge = { len, facing: getProp(n.dim.getState(n.x, n.y, n.z), 'facing') };
      m.setStatus(n, 'working');
      return;
    }
    // Without power or its signal the bridge flickers, then fades over 3 seconds
    if (old > 0) {
      const t = Number(be.fade ?? 0) + N;
      be.fade = t;
      n.dirty = true;
      if (t >= BRIDGE.fadeTicks) {
        for (const [x, y, z] of path) if (STATE_BLOCK[n.dim.getState(x, y, z)] === STATE_BLOCK[light]) n.dim.setBlock(x, y, z, 0, { updateNeighbors: false });
        be.len = 0;
        be.fade = 0;
        this.server.playSound(n.dim, 'block.bridge_off', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.8, 1);
      } else {
        // Flicker: the stage steps up as it fades, blinking back now and then
        const stage = Math.min(3, 1 + Math.floor((t / BRIDGE.fadeTicks) * 3));
        const blink = (t >> 2) % 3 === 0 ? Math.max(1, stage - 1) : stage;
        const fs = withProp(light, 'fade', String(blink));
        for (const [x, y, z] of path) if (STATE_BLOCK[n.dim.getState(x, y, z)] === STATE_BLOCK[light]) n.dim.setBlock(x, y, z, fs, { updateNeighbors: false });
        if (t <= N) this.server.playSound(n.dim, 'block.bridge_flicker', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.8, 1);
      }
    }
    m.setStatus(n, !this.eng.allowed(n) ? 'disabled' : len === 0 ? 'blocked' : 'no_power');
  }

  /** A projector was broken (or its chunk unloaded): its bridge fades on its own. */
  onRemoved(n: EngNode): void {
    const info = (n as EngNode & { bridge?: { len: number; facing?: string } }).bridge;
    if (n.c.id !== 'ender_bridge_projector' || !info?.len) return;
    const f = FACE[info.facing ?? 'north'] ?? FACE.north!;
    const cells: [number, number, number][] = [];
    for (let i = 1; i <= info.len; i++) cells.push([n.x + f[0] * i, n.y, n.z + f[1] * i]);
    this.orphans.push({ dim: n.dim, cells, left: BRIDGE.fadeTicks });
  }

  private fadeOrphans(N: number): void {
    const light = S('ender_light');
    for (let i = this.orphans.length - 1; i >= 0; i--) {
      const o = this.orphans[i]!;
      o.left -= N;
      const done = o.left <= 0;
      const stage = done ? 0 : Math.min(3, 1 + Math.floor(((BRIDGE.fadeTicks - o.left) / BRIDGE.fadeTicks) * 3));
      for (const [x, y, z] of o.cells) {
        if (!o.dim.isLoaded(x, z) || STATE_BLOCK[o.dim.getState(x, y, z)] !== STATE_BLOCK[light]) continue;
        o.dim.setBlock(x, y, z, done ? 0 : withProp(light, 'fade', String(stage)), { updateNeighbors: false });
      }
      if (done) this.orphans.splice(i, 1);
    }
  }

  /** Ender Rail: powered by a signal, or by 1 EU/t from the network. */
  private rail(n: EngNode, be: EngBE, N: number): void {
    const signal = !!this.server.power?.powered(n.dim, n.x, n.y, n.z) || !!this.server.power?.powered(n.dim, n.x, n.y - 1, n.z);
    let on = signal;
    if (!on) {
      const use = (n.c.energy?.use ?? 1) * N;
      if ((be.energy ?? 0) >= use) {
        be.energy = (be.energy ?? 0) - use;
        n.dirty = true;
        on = true;
      }
    }
    this.eng.setBlockProp(n, 'powered', on ? 'true' : 'false');
  }

  // ------------------------------------------------------------------ windows

  /** Extra lines and buttons in an End block's machine window. */
  props(n: EngNode, p: MachineProps, viewer?: ServerPlayer): void {
    const be = n.be();
    if (!be) return;
    const c = n.c;
    switch (c.id) {
      case 'crystal_generator':
        p.info.push(be.burn ? `Burning: ${Math.ceil(Number(be.burn) / 20)} s left on this fragment` : 'Burns End Crystal Fragments (20 s each)');
        break;
      case 'void_collector':
        p.info.push(this.voidBelow(n.dim, n.x, n.y, n.z) ? 'Open void below: collecting' : `Needs nothing but air below it, all the way down (at least ${VOID_COLLECTOR.air} blocks)`);
        break;
      case 'crystal_grower':
        p.info.push(this.growSpot(n) ? `Next cluster in ${Math.ceil(((c.time ?? 6000) - Number(be.progress ?? 0)) / 20)} s` : 'Put Crystalline End Stone beside it, with air above');
        break;
      case 'restored_ancient_lens':
        p.info.push(be.awake ? 'Awake: look through the telescope' : `Waking: ${Math.round((Number(be.charge ?? 0) / QUEST.lensTicks) * 100)}% (needs ${QUEST.lensEU} EU/t for 30 s without a break)`);
        break;
      case 'crystal_pedestal':
        p.info.push(be.powered ? 'Powered by a Crystal Generator' : 'Needs an End Crystal, and power from a network with a Crystal Generator');
        break;
      case 'ender_bridge_projector': {
        const len = Number(be.len ?? 0);
        p.info.push(len ? `Bridge: ${len} blocks, ${EndEngineering.bridgeUse(len)} EU/t` : 'No bridge');
        if (be.fade) p.info.push('Fading...');
        break;
      }
      case 'ender_rail':
        p.info.push(getProp(n.dim.getState(n.x, n.y, n.z), 'powered') === 'true' ? 'Powered' : 'Unpowered: give it a signal, or cable it to power');
        break;
      case 'teleport_node':
        this.server.endTransport?.nodeProps(n, p, viewer);
        break;
    }
  }

  /** A setting from an End block's window (true when handled). */
  cfg(pl: ServerPlayer, n: EngNode, key: string, value: string | number): boolean {
    if (n.c.id === 'teleport_node') return this.server.endTransport?.nodeCfg(pl, n, key, value) ?? false;
    return false;
  }
}

/** Statuses of the End blocks (shown in windows, monitors and control panels). */
/** End machines with a working sound of their own (synth.ts: machine.<id>). */
const HUMS = new Set(['crystal_generator', 'void_collector', 'restored_ancient_core', 'end_processor', 'crystal_grower', 'ender_bridge_projector', 'teleport_node', 'restored_ancient_lens']);

export const END_STATUS_TEXT: Record<string, string> = {
  no_void: 'No open void below',
  no_stone: 'No Crystalline End Stone beside it',
  charging: 'Waking',
  no_crystal: 'Needs an End Crystal',
  no_crystal_power: 'Needs power from a Crystal Generator',
  blocked: 'Something blocks the way',
};

/** Whether a block is an End engineering component (phase 4). */
export function isEndComponent(id: string): boolean {
  const c = COMPONENT_BY_ID.get(id);
  return !!c && (c.guide === 'end_engineering' || c.guide === 'end_transport');
}

export { NODE, nodeCost, fmt };
