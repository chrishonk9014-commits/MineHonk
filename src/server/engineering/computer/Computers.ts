/**
 * V5.5: computers, as engineering machines.
 *
 * A computer is an engineering block on an energy network with twelve
 * slots: power supply, motherboard, CPU, four RAM, two hard drives,
 * graphics card, network card and a USB slot for a flash drive. It boots
 * (POST) when switched on with the core parts in and the power to run them,
 * then runs HonkOS from a hard drive (or only its BIOS without one).
 * Peripherals count when they stand within a block of the case: monitors
 * (they show what the computer runs), a keyboard (needed to use it), a mouse
 * (graphics programs), speakers (sounds) and LEDs (status lights).
 *
 * Programs (programs.ts) monitor and control the network the computer is
 * cabled to, keep data on drives and send it over network cable to other
 * computers and server racks. Computers emit a signal (their output, and a
 * running light into LEDs beside them) and read the signals coming in.
 *
 * The Herobrine story reaches computers in two places: a Corrupted Flash
 * Drive in a USB slot, and the computer he goes back into (story state on
 * the computer: a takeover, then a way in).
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { Window, WSlot } from '../../systems/Containers';
import type { Inventory } from '../../player/Inventory';
import type { Engineering, EngNode } from '../Engineering';
import type { EngBE } from '../state';
import type { Scope } from '../control';
import { blocks, STATE_BLOCK, getProp } from '../../../common/registry/blocks';
import { items } from '../../../common/registry/items';
import { FACE_DX, FACE_DY, FACE_DZ } from '../../../common/world/constants';
import { COMPONENT_BY_ID } from '../../../common/engineering/catalog';
import { joins } from '../../../common/engineering/connect';
import { PC_SLOTS, PC_SLOT_LABEL, PC_SLOT_ITEMS, type PcView, type PcState, type UiBlock, type Tone, type PcApp } from '../../../common/digital/view';
import { type AutomationRule, type Disk, type MapData } from '../../../common/digital/data';
import { DiskStore } from './disks';
import { screenOf, command, cannotRun, installed, runRules, type Ctx } from './programs';
import type { ItemStack } from '../../../common/game/itemstack';

/** Ticks a computer takes to start up. */
export const POST_TICKS = 60;
const LOG_LINES = 60;

export interface PcData {
  on: boolean;
  /** Ticks of start-up left (0 = running). */
  boot: number;
  /** Open program ('' = desktop). */
  app: string;
  log: string[];
  /** Signal output. */
  out: boolean;
  /** Running (powered and started up): the LEDs beside it light. */
  run?: boolean;
  rules: AutomationRule[];
  ruleState?: boolean[];
  draft?: AutomationRule;
  sel?: { file?: string; view?: string; machine?: string; remote?: string; rfile?: string };
  /** Drive key new files are saved to. */
  target?: string;
  bpR?: number;
  flash?: { text: string; tone?: Tone; until: number };
  /** The Herobrine story's hold on this computer. */
  story?: 'takeover' | 'gateway' | 'haunted';
  /** Lines the takeover has printed so far. */
  storyLines?: string[];
  /** Disk id of the drive last seen in the USB slot (so a drive is noticed once per insertion). */
  usbSeen?: string;
}

export interface Hw {
  psu: boolean;
  mobo: boolean;
  cpu: boolean;
  ram: number;
  hdds: (ItemStack | null)[];
  gpu: boolean;
  net: boolean;
  usb: ItemStack | null;
  keyboard: boolean;
  mouse: boolean;
  speaker: boolean;
  monitors: [number, number, number][];
  leds: [number, number, number][];
}

export interface DriveRef {
  key: string;
  name: string;
  disk: Disk;
  /** Writes the drive's tag (label, usage) back into the item where it sits. */
  save(): void;
}

export interface RemoteDevice {
  name: string;
  at: [number, number, number];
  drives: DriveRef[];
}

interface OpenWindow {
  w: Window;
  node: EngNode;
  sent: string;
}

export class Computers {
  readonly disks: DiskStore;
  private readonly open = new Map<ServerPlayer, OpenWindow>();
  private readonly hwCache = new Map<string, { at: number; hw: Hw }>();
  readonly mapCache = new Map<string, { at: number; map: MapData }>();

  constructor(readonly eng: Engineering) {
    this.disks = new DiskStore(eng.server);
  }

  // ------------------------------------------------------------------ state

  pcOf(be: EngBE): PcData {
    let pc = be.pc as PcData | undefined;
    if (!pc || typeof pc !== 'object') {
      pc = { on: false, boot: POST_TICKS, app: '', log: [], out: false, rules: [] };
      be.pc = pc;
    }
    pc.log ??= [];
    pc.rules ??= [];
    return pc;
  }

  private inv(n: EngNode): Inventory {
    return this.eng.server.interaction.containers.containerAt(n.dim, n.x, n.y, n.z, PC_SLOTS.length, 'eng');
  }

  private persist(n: EngNode, inv: Inventory): void {
    this.eng.server.interaction.containers.persist(n.dim, n.x, n.y, n.z, inv);
  }

  /** What is installed, and what stands around it (re-read every half second, or after a change). */
  hw(n: EngNode): Hw {
    const now = this.eng.server.tickNo;
    const c = this.hwCache.get(n.key);
    if (c && now - c.at < 10) return c.hw;
    const inv = this.inv(n);
    const id = (i: number): string => (inv.get(i) ? (items[inv.get(i)!.id]?.id ?? '') : '');
    const hw: Hw = {
      psu: id(0) === 'power_supply',
      mobo: id(1) === 'motherboard',
      cpu: id(2) === 'cpu',
      ram: [3, 4, 5, 6].filter((i) => id(i) === 'ram_module').length,
      hdds: [7, 8].map((i) => (id(i) === 'hard_drive' ? inv.get(i) : null)),
      gpu: id(9) === 'gpu',
      net: id(10) === 'network_card',
      usb: inv.get(11),
      keyboard: false,
      mouse: false,
      speaker: false,
      monitors: [],
      leds: [],
    };
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          const x = n.x + dx;
          const y = n.y + dy;
          const z = n.z + dz;
          const comp = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[n.dim.getState(x, y, z)]!]!.id);
          if (!comp) continue;
          if (comp.kind === 'monitor') hw.monitors.push([x, y, z]);
          else if (comp.peripheral === 'keyboard') hw.keyboard = true;
          else if (comp.peripheral === 'mouse') hw.mouse = true;
          else if (comp.peripheral === 'speaker') hw.speaker = true;
          else if (comp.peripheral === 'led') hw.leds.push([x, y, z]);
        }
    this.hwCache.set(n.key, { at: now, hw });
    return hw;
  }

  invalidate(n: EngNode): void {
    this.hwCache.delete(n.key);
  }

  /** Something changed near (x,y,z): computers within a block re-read their surroundings. */
  invalidateAround(dimId: string, x: number, y: number, z: number): void {
    for (const k of [...this.hwCache.keys()]) {
      const i = k.indexOf('|');
      if (k.slice(0, i) !== dimId) continue;
      const [cx, cy, cz] = k.slice(i + 1).split(',').map(Number) as [number, number, number];
      if (Math.abs(cx - x) <= 1 && Math.abs(cy - y) <= 1 && Math.abs(cz - z) <= 1) this.hwCache.delete(k);
    }
  }

  /** The computer a peripheral (or screen) at (x,y,z) belongs to: the nearest within a block. */
  besides(dim: import('../../world/Dimension').Dimension, x: number, y: number, z: number): EngNode | null {
    let best: EngNode | null = null;
    let bd = 99;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const m = this.eng.node(dim, x + dx, y + dy, z + dz);
          if (!m || m.c.kind !== 'computer') continue;
          const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
          if (d < bd) {
            bd = d;
            best = m;
          }
        }
    return best;
  }

  /** A monitor a computer is drawing on (clicking it uses the computer, not the monitor's pages). */
  drivenMonitor(dim: import('../../world/Dimension').Dimension, x: number, y: number, z: number): boolean {
    const be = dim.getBlockEntity(x, y, z) as EngBE | undefined;
    return !!be && be.type === 'eng' && typeof be.pcAt === 'number' && this.eng.server.tickNo - be.pcAt < 80;
  }

  /** The first core part missing (the computer can't start without it), or null. */
  missing(hw: Hw): string | null {
    if (!hw.psu) return 'POWER SUPPLY';
    if (!hw.mobo) return 'MOTHERBOARD';
    if (!hw.cpu) return 'CPU';
    if (!hw.ram) return 'RAM';
    return null;
  }

  useOf(hw: Hw): number {
    return 1.5 + (hw.cpu ? 1 : 0) + hw.ram * 0.25 + hw.hdds.filter(Boolean).length * 0.25 + (hw.gpu ? 2 : 0) + (hw.net ? 0.5 : 0);
  }

  /** The local drives: hard drives 1 and 2 and the USB slot. */
  drives(n: EngNode): DriveRef[] {
    const inv = this.inv(n);
    const out: DriveRef[] = [];
    const add = (slot: number, key: string, name: string): void => {
      const st = inv.get(slot);
      const disk = this.disks.diskOf(st);
      if (!st || !disk) return;
      out.push({
        key,
        name,
        disk,
        save: () => {
          const cur = inv.get(slot);
          if (cur) {
            this.disks.syncTag(cur, disk);
            inv.set(slot, cur);
          }
          this.persist(n, inv);
        },
      });
    };
    add(7, 'hdd0', 'HDD 1');
    add(8, 'hdd1', 'HDD 2');
    add(11, 'usb', 'USB');
    // A drive used for the first time got a disk id in its tag: keep it
    if (out.length) this.persist(n, inv);
    return out;
  }

  hasOs(drives: DriveRef[]): boolean {
    return drives.some((d) => d.disk.kind === 'hdd' && d.disk.files.some((f) => f.name === 'honkos.sys' && f.kind === 'system'));
  }

  scope(n: EngNode): Scope | null {
    return this.eng.control.scopeAt(n.dim, n.x, n.y, n.z);
  }

  /** Running: switched on, parts in, powered and started up. */
  running(n: EngNode): boolean {
    const be = n.be();
    return !!be && this.pcOf(be).run === true;
  }

  state(n: EngNode): PcState {
    const be = n.be();
    if (!be) return 'off';
    const pc = this.pcOf(be);
    if (pc.story === 'takeover') return 'takeover';
    if (pc.story === 'gateway') return 'gateway';
    if (!pc.on) return 'off';
    const hw = this.hw(n);
    if (this.missing(hw)) return 'missing';
    if (!pc.run) return (be.energy ?? 0) <= 0 ? 'no_power' : 'post';
    if (pc.boot > 0) return 'post';
    return this.hasOs(this.drives(n)) ? 'desktop' : 'bios';
  }

  log(n: EngNode, line: string): void {
    const be = n.be();
    if (!be) return;
    const pc = this.pcOf(be);
    const t = this.eng.server.level.time ?? this.eng.server.tickNo;
    const day = Math.floor(t / 24000);
    const hh = Math.floor(((t % 24000) / 1000 + 6) % 24);
    pc.log.push(`[day ${day} ${String(hh).padStart(2, '0')}:00] ${line}`);
    if (pc.log.length > LOG_LINES) pc.log.splice(0, pc.log.length - LOG_LINES);
    n.dirty = true;
  }

  /** A sound from the computer, if it has a speaker. */
  sound(n: EngNode, name: string, volume: number, pitch = 1): void {
    if (!this.hw(n).speaker) return;
    this.eng.server.playSound(n.dim, name, n.x + 0.5, n.y + 0.5, n.z + 0.5, volume, pitch);
  }

  setOutput(n: EngNode, on: boolean): void {
    const be = n.be();
    if (!be) return;
    const pc = this.pcOf(be);
    if (pc.out === on) return;
    pc.out = on;
    n.dim.setBlockEntity(n.x, n.y, n.z, be);
    this.eng.server.power?.touch(n.dim, n.x, n.y, n.z);
    this.log(n, `signal output ${on ? 'on' : 'off'}`);
  }

  /** Signal a computer sends into a neighbour (Power): its output, or its running light into an LED. */
  emitted(dim: import('../../world/Dimension').Dimension, x: number, y: number, z: number, face: number): number {
    const be = dim.getBlockEntity(x, y, z) as EngBE | undefined;
    if (!be || be.type !== 'eng' || be.id !== 'computer') return 0;
    const pc = be.pc as PcData | undefined;
    if (!pc) return 0;
    if (pc.out && pc.run) return 15;
    if (pc.run || pc.story) {
      const s = dim.getState(x + FACE_DX[face], y + FACE_DY[face], z + FACE_DZ[face]);
      if (blocks[STATE_BLOCK[s]!]!.id === 'led_light') return 15;
    }
    return 0;
  }

  grantNet(c: Ctx): void {
    this.eng.grant(c.n, 'network_transfer');
    if (c.p) this.eng.server.interaction.grant(c.p, 'network_transfer');
  }

  // ------------------------------------------------------------------ networking

  /** Computers (with network cards) and server racks on this computer's data network. */
  network(n: EngNode): RemoteDevice[] {
    const out: RemoteDevice[] = [];
    if (!this.hw(n).net) return out;
    const dim = n.dim;
    const key = (x: number, y: number, z: number): string => x + ',' + y + ',' + z;
    const seen = new Set([key(n.x, n.y, n.z)]);
    const queue: [number, number, number][] = [[n.x, n.y, n.z]];
    while (queue.length && seen.size < 2048) {
      const [x, y, z] = queue.shift()!;
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const ny = y + FACE_DY[f];
        const nz = z + FACE_DZ[f];
        const k = key(nx, ny, nz);
        if (seen.has(k) || !dim.isLoaded(nx, nz)) continue;
        const s = dim.getState(nx, ny, nz);
        if (!joins(s, 'data')) continue;
        seen.add(k);
        const comp = COMPONENT_BY_ID.get(blocks[STATE_BLOCK[s]!]!.id);
        if (comp?.kind === 'data_cable') {
          queue.push([nx, ny, nz]);
          continue;
        }
        const other = this.eng.node(dim, nx, ny, nz);
        if (!other) continue;
        if (comp?.kind === 'computer') {
          if (!this.hw(other).net) continue;
          out.push({ name: `Computer ${out.filter((r) => r.name.startsWith('Computer')).length + 1}`, at: [nx, ny, nz], drives: this.drives(other).filter((d) => d.key !== 'usb') });
        } else if (comp?.kind === 'server') out.push({ name: `Server Rack ${out.filter((r) => r.name.startsWith('Server')).length + 1}`, at: [nx, ny, nz], drives: this.rackDrives(other) });
        // Racks and computers pass the network on through themselves too
        queue.push([nx, ny, nz]);
      }
    }
    return out;
  }

  /** A server rack's four drives (only while it has power). */
  rackDrives(n: EngNode): DriveRef[] {
    const be = n.be();
    if (!be || (be.energy ?? 0) <= 0) return [];
    const ct = this.eng.server.interaction.containers;
    const inv = ct.containerAt(n.dim, n.x, n.y, n.z, 4, 'eng');
    const out: DriveRef[] = [];
    for (let i = 0; i < 4; i++) {
      const st = inv.get(i);
      const disk = this.disks.diskOf(st);
      if (!st || !disk) continue;
      out.push({
        key: `rack${i}`,
        name: `Bay ${i + 1}`,
        disk,
        save: () => {
          const cur = inv.get(i);
          if (cur) {
            this.disks.syncTag(cur, disk);
            inv.set(i, cur);
          }
          ct.persist(n.dim, n.x, n.y, n.z, inv);
        },
      });
    }
    if (out.length) ct.persist(n.dim, n.x, n.y, n.z, inv);
    return out;
  }

  // ------------------------------------------------------------------ the step

  /** Runs every computer (each engineering step). */
  step(nodes: EngNode[], N: number): void {
    const now = this.eng.server.tickNo;
    for (const n of nodes) {
      if (n.removed) continue;
      if (n.c.kind === 'server') {
        this.rack(n, N);
        continue;
      }
      if (n.c.kind !== 'computer') continue;
      const be = n.be();
      if (!be) continue;
      const pc = this.pcOf(be);
      // Story state left on a computer the story no longer has (a restart, a reset)
      if (pc.story && !this.eng.server.herobrine?.holds(n)) {
        pc.story = undefined;
        pc.storyLines = undefined;
        n.dirty = true;
      }
      const wasRun = !!pc.run;
      let screen: string = 'off';
      const hw = this.hw(n);
      if (pc.story === 'takeover') screen = 'glitch';
      else if (pc.story === 'gateway') screen = 'portal';
      if (!pc.on || this.missing(hw)) {
        pc.run = false;
        pc.boot = POST_TICKS;
        if (pc.on && this.missing(hw) && screen === 'off') screen = 'err';
      } else {
        const need = this.useOf(hw) * N;
        if ((be.energy ?? 0) < need) {
          if (pc.run) this.log(n, 'power lost');
          pc.run = false;
          pc.boot = POST_TICKS;
        } else {
          be.energy = (be.energy ?? 0) - need;
          n.dirty = true;
          if (!pc.run) {
            pc.run = true;
            pc.boot = POST_TICKS;
          }
          if (pc.boot > 0) {
            pc.boot = Math.max(0, pc.boot - N);
            if (screen === 'off') screen = 'boot';
            if (pc.boot === 0) this.booted(n);
          } else if (screen === 'off') screen = 'on';
        }
      }
      if (pc.run !== wasRun) {
        n.dim.setBlockEntity(n.x, n.y, n.z, be);
        this.eng.server.power?.touch(n.dim, n.x, n.y, n.z);
      }
      this.eng.setBlockProp(n, 'screen', screen);
      be.status = pc.run ? 'working' : pc.on ? 'error' : 'idle';
      const ready = pc.run && pc.boot === 0;
      // A drive in the USB slot is looked at once per insertion
      const usbDisk = hw.usb ? this.disks.diskOf(hw.usb) : null;
      if ((usbDisk?.id ?? undefined) !== pc.usbSeen) {
        if (usbDisk && ready) {
          pc.usbSeen = usbDisk.id;
          this.log(n, `USB device: ${usbDisk.label}`);
          this.eng.server.herobrine?.onUsbDrive(n, hw.usb!, this.lastUser.get(n.key) ?? null);
        } else if (!usbDisk) pc.usbSeen = undefined;
      }
      if (ready && now % 20 === 0) {
        runRules({ pcs: this, n, pc });
        this.alerts(n, pc);
      }
      if (now % 20 === 0) this.monitors(n, pc, hw);
    }
    this.windows();
  }

  private booted(n: EngNode): void {
    this.log(n, 'started up');
    this.sound(n, 'computer.boot', 0.7);
    this.eng.grant(n, 'boot_computer');
    if (!this.hasOs(this.drives(n))) this.log(n, 'no operating system found');
  }

  /** Machines in trouble get a line in the log (once per trouble) and the alarm, if there is a speaker. */
  private alerts(n: EngNode, pc: PcData): void {
    const sc = this.scope(n);
    if (!sc) return;
    const now = this.eng.control.alerts(sc);
    const key = now.join('|');
    const prev = (pc as { lastAlerts?: string }).lastAlerts ?? '';
    if (key === prev) return;
    (pc as { lastAlerts?: string }).lastAlerts = key;
    for (const a of now) if (!prev.includes(a)) this.log(n, `ALERT ${a}`);
    if (now.length && !prev) this.sound(n, 'computer.alert', 0.6);
  }

  private rack(n: EngNode, N: number): void {
    const be = n.be();
    if (!be) return;
    const use = (n.c.energy?.use ?? 2) * N;
    const on = (be.energy ?? 0) >= use;
    if (on) {
      be.energy = (be.energy ?? 0) - use;
      n.dirty = true;
    }
    this.eng.machines.setStatus(n, on ? 'working' : 'no_power');
  }

  /** Monitors beside a computer show what it is doing. */
  private monitors(n: EngNode, pc: PcData, hw: Hw): void {
    if (!hw.monitors.length) return;
    const lines = this.screenLines(n, pc);
    const json = JSON.stringify(lines);
    for (const [x, y, z] of hw.monitors) {
      const m = this.eng.node(n.dim, x, y, z);
      const mbe = m?.be();
      if (!m || !mbe) continue;
      mbe.pcAt = this.eng.server.tickNo;
      if (JSON.stringify(mbe.lines ?? null) === json) continue;
      mbe.lines = lines;
      n.dim.setBlockEntity(x, y, z, mbe);
      this.eng.server.sendToWatchers(n.dim, x, z, { t: 'block_entity', x, y, z, data: { type: 'eng', id: 'monitor', lines, page: 0 } });
    }
  }

  /** Up to seven short lines for a monitor. */
  private screenLines(n: EngNode, pc: PcData): string[] {
    const st = this.state(n);
    if (st === 'takeover') return (pc.storyLines ?? []).slice(-6).map((l) => l.slice(0, 20));
    if (st === 'gateway') return ['', '', '      . . .', '', ''];
    if (st === 'off') return [];
    if (st === 'missing') return ['', ` NO ${this.missing(this.hw(n))}`];
    if (st === 'no_power') return ['', '  NO POWER'];
    if (st === 'post') return ['HonkBIOS 5.5', 'Memory test... OK', `RAM: ${this.hw(n).ram} module(s)`, 'Starting...'];
    if (st === 'bios') return ['HonkBIOS 5.5', 'No operating system', 'Run Disk Utility'];
    if (!pc.app) return ['HonkOS', '', ...installed(this.drives(n), true).slice(0, 5).map((p) => '> ' + p.name.slice(0, 17))];
    const scr = screenOf(this.ctx(n, null), pc.app);
    const out = [scr.title.toUpperCase().slice(0, 20)];
    for (const b of scr.blocks) {
      if (out.length >= 7) break;
      if (b.t === 'kv') out.push(`${b.k}: ${b.v}`.slice(0, 20));
      else if (b.t === 'bar') out.push(`${b.label}`.slice(0, 20));
      else if (b.t === 'p' || b.t === 'h') out.push(b.text.slice(0, 20));
      else if (b.t === 'text') out.push(...b.lines.slice(0, 7 - out.length).map((l) => l.slice(0, 20)));
      else if (b.t === 'list') out.push(...b.rows.slice(0, 7 - out.length).map((r) => r.text.slice(0, 20)));
    }
    return out;
  }

  ctx(n: EngNode, p: ServerPlayer | null): Ctx {
    const be = n.be()!;
    return { pcs: this, n, be, pc: this.pcOf(be), hw: this.hw(n), p };
  }

  // ------------------------------------------------------------------ the window

  /** Who last used each computer (the story credits them). */
  private readonly lastUser = new Map<string, ServerPlayer>();

  openFor(p: ServerPlayer, n: EngNode): void {
    const be = n.be();
    if (!be) return;
    const ct = this.eng.server.interaction.containers;
    const inv = this.inv(n);
    const w = ct.allocWindow('computer', 'Computer', PC_SLOTS.length);
    PC_SLOTS.forEach((kind, i) => {
      const accepts = PC_SLOT_ITEMS[kind];
      const slot: WSlot = {
        get: () => inv.get(i),
        set: (s) => {
          inv.set(i, s);
          this.persist(n, inv);
          this.invalidate(n);
          this.lastUser.set(n.key, p);
          n.sleep = 0;
        },
        mayPlace: (s) => accepts.includes(items[s.id]?.id ?? '') && !this.locked(n),
        max: () => 1,
        group: 'input',
        locked: () => this.locked(n),
      };
      w.slots.push(slot);
    });
    w.pos = { dim: n.dim, x: n.x, y: n.y, z: n.z };
    w.onClose = (pl) => this.open.delete(pl);
    w.props = this.view(n, p) as unknown as Record<string, unknown>;
    ct.openCustom(p, w);
    this.open.set(p, { w, node: n, sent: JSON.stringify(w.props) });
    this.lastUser.set(n.key, p);
  }

  /** While Herobrine has the computer (and while it is his way back), nothing goes in or comes out. */
  locked(n: EngNode): boolean {
    const be = n.be();
    const st = (be?.pc as PcData | undefined)?.story;
    return st === 'takeover' || st === 'gateway';
  }

  private windows(): void {
    for (const [pl, o] of this.open) {
      if (o.node.removed || pl.windowId !== o.w.id) {
        this.open.delete(pl);
        continue;
      }
      const v = this.view(o.node, pl);
      const json = JSON.stringify(v);
      if (json === o.sent) continue;
      o.sent = json;
      o.w.props = v as unknown as Record<string, unknown>;
      (o.w as Window & { sentProps?: string }).sentProps = json;
      pl.send({ t: 'window_prop', window: o.w.id, prop: 'all', value: v });
    }
  }

  /** Sends the screen to everyone looking at this computer now (after a command). */
  private refresh(n: EngNode): void {
    for (const o of this.open.values()) if (o.node === n) o.sent = '';
    this.windows();
  }

  closeAt(n: EngNode): void {
    const ct = this.eng.server.interaction.containers;
    for (const [pl, o] of [...this.open]) if (o.node === n) ct.closeWindow(pl, o.w.id);
  }

  /** A button on the screen. */
  handleCmd(p: ServerPlayer, windowId: number, cmd: string, arg: string | number | undefined): boolean {
    const o = this.open.get(p);
    if (!o || o.w.id !== windowId || p.windowId !== windowId || o.node.removed) return false;
    const n = o.node;
    if (p.dim !== n.dim || p.distanceSq(n.x + 0.5, n.y + 0.5, n.z + 0.5) > 64) return true;
    const be = n.be();
    if (!be) return true;
    const pc = this.pcOf(be);
    this.lastUser.set(n.key, p);
    // The way in: only while it is one
    if (cmd === 'enter') {
      if (pc.story === 'gateway') this.eng.server.herobrine?.enterComputer(p, n);
      return true;
    }
    if (pc.story === 'takeover' || pc.story === 'gateway') return true;
    // Visitors may look, not touch
    if (this.eng.server.roleOf(p) === 'visitor') return true;
    if (cmd === 'power') {
      pc.on = !pc.on;
      if (!pc.on) {
        pc.run = false;
        pc.app = '';
        this.eng.server.power?.touch(n.dim, n.x, n.y, n.z);
      }
      this.eng.server.playSound(n.dim, 'machine.switch', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.4, 1);
      this.log(n, pc.on ? 'switched on' : 'switched off');
    } else if (this.state(n) === 'desktop' || this.state(n) === 'bios') {
      const hw = this.hw(n);
      if (!hw.keyboard) return true;
      if (cmd === 'home') pc.app = '';
      else if (cmd === 'app') {
        const id = String(arg ?? '');
        if (id === 'viewer' || id === 'files') pc.app = id;
        else {
          const prog = installed(this.drives(n), this.hasOs(this.drives(n))).find((q) => q.id === id);
          const why = prog ? cannotRun(prog, hw) : 'is not installed';
          if (!prog || why) pc.flash = { text: `${prog?.name ?? id} ${why}`, tone: 'bad', until: this.eng.server.tickNo + 60 };
          else pc.app = prog.id;
        }
      } else {
        const r = command(this.ctx(n, p), cmd, arg);
        if (r) pc.flash = { text: r.text, tone: r.tone, until: this.eng.server.tickNo + 70 };
      }
    }
    n.dim.setBlockEntity(n.x, n.y, n.z, be);
    this.refresh(n);
    return true;
  }

  // ------------------------------------------------------------------ the screen

  view(n: EngNode, p: ServerPlayer | null): PcView {
    const be = n.be()!;
    const pc = this.pcOf(be);
    const hw = this.hw(n);
    const st = this.state(n);
    const now = this.eng.server.tickNo;
    const drives = st === 'off' || st === 'missing' || st === 'no_power' ? [] : this.drives(n);
    const os = this.hasOs(drives);
    const progs = st === 'desktop' || st === 'bios' ? installed(drives, os) : [];
    const apps: PcApp[] = progs.map((q) => {
      const why = cannotRun(q, hw);
      return { id: q.id, name: q.name, ok: !why, ...(why ? { why } : {}) };
    });
    const v: PcView = {
      name: 'Computer',
      state: st,
      power: pc.on,
      energy: Math.floor(be.energy ?? 0),
      energyMax: n.c.energy?.capacity ?? 0,
      use: this.useOf(hw),
      hw: [
        { label: 'Power Supply', ok: hw.psu },
        { label: 'Motherboard', ok: hw.mobo },
        { label: 'CPU', ok: hw.cpu },
        { label: 'RAM', ok: hw.ram > 0, detail: `${hw.ram}/4` },
        { label: 'Hard Drive', ok: hw.hdds.some(Boolean), detail: `${hw.hdds.filter(Boolean).length}/2` },
        { label: 'Graphics', ok: hw.gpu },
        { label: 'Network', ok: hw.net },
      ],
      periph: { keyboard: hw.keyboard, mouse: hw.mouse, speaker: hw.speaker, monitors: hw.monitors.length, leds: hw.leds.length },
      apps,
      app: pc.app,
      title: '',
      blocks: [],
      slots: PC_SLOTS.map((k) => PC_SLOT_LABEL[k]),
    };
    switch (st) {
      case 'off':
        v.message = 'Press the power button to start it.';
        break;
      case 'missing':
        v.message = `${this.missing(hw)} NOT FOUND. Open the case (Hardware) and install one.`;
        break;
      case 'no_power':
        v.message = 'NO POWER. Cable the computer to a powered network.';
        break;
      case 'post':
        v.title = 'HonkBIOS 5.5';
        v.blocks = [{ t: 'text', lines: ['HonkBIOS 5.5', `CPU ......... ${hw.cpu ? 'OK' : '--'}`, `MEMORY ...... ${hw.ram * 512} MB`, `DRIVES ...... ${hw.hdds.filter(Boolean).length + (hw.usb ? 1 : 0)}`, `KEYBOARD .... ${hw.keyboard ? 'OK' : 'NOT FOUND'}`, '', `Starting${'.'.repeat(1 + ((now >> 3) % 3))}`] }];
        break;
      case 'takeover':
        v.title = '?';
        v.blocks = [{ t: 'text', lines: pc.storyLines ?? [], tone: 'glitch' }];
        v.glitch = Math.min(1, (pc.storyLines?.length ?? 0) / 8);
        break;
      case 'gateway':
        v.title = '';
        v.message = 'The screen is not a screen any more. It goes in.';
        v.blocks = [{ t: 'btns', items: [{ label: 'ENTER', cmd: 'enter', tone: 'glitch' }] }];
        v.glitch = 0.6;
        break;
      default: {
        if (!hw.keyboard) {
          v.message = 'KEYBOARD NOT DETECTED. Place a keyboard next to the computer. Press F1 to continue.';
          break;
        }
        if (st === 'bios' && !pc.app) v.message = 'No operating system found. Open Disk Utility and install HonkOS onto a hard drive.';
        if (pc.app) {
          const scr = screenOf(this.ctx(n, p), pc.app);
          v.title = scr.title;
          v.blocks = scr.blocks;
        } else {
          v.title = os ? 'HonkOS 5.5' : 'HonkBIOS 5.5';
          v.blocks = desktop(this, n, os);
        }
      }
    }
    if (pc.flash && pc.flash.until > now) v.blocks = [{ t: 'p', text: pc.flash.text, tone: pc.flash.tone }, ...v.blocks];
    return v;
  }
}

/** The desktop: a few facts at a glance. */
function desktop(pcs: Computers, n: EngNode, os: boolean): UiBlock[] {
  const sc = pcs.scope(n);
  const out: UiBlock[] = [];
  if (sc) {
    const st = sc.net.stats;
    out.push({ t: 'kv', k: 'Network', v: `+${st.gen.toFixed(1)} / -${st.use.toFixed(1)} EU/t, ${sc.machines.length} machines`, tone: st.gen >= st.use ? 'ok' : 'warn' });
    const al = pcs.eng.control.alerts(sc);
    if (al.length) out.push({ t: 'kv', k: 'Alerts', v: String(al.length), tone: 'bad' });
  }
  const drives = pcs.drives(n);
  for (const d of drives) out.push({ t: 'kv', k: d.name, v: `${d.disk.label} · ${d.disk.files.length} files` });
  if (!os) out.push({ t: 'p', text: 'Programs need HonkOS on a hard drive.', tone: 'dim' });
  const be = n.be();
  const log = (be?.pc as PcData | undefined)?.log ?? [];
  if (log.length) out.push({ t: 'h', text: 'Recent' }, { t: 'text', lines: log.slice(-4) });
  return out;
}

