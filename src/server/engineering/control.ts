/**
 * Control rooms: monitors and control panels.
 *
 * Both sit on an energy network (cabled in, drawing 1 EU/t). What they see is
 * that network: its generators, batteries and machines, plus the storage and
 * tanks touching it. Monitors show one page at a time on their screen
 * (power, batteries, machines, storage, fluids, alerts); control panels list
 * every machine and generator with a switch for each.
 */
import type { ServerPlayer } from '../player/ServerPlayer';
import { blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import { COMPONENT_BY_ID } from '../../common/engineering/catalog';
import { STATUS_TEXT } from './machines';
import { portAt } from './ports';
import type { EnergyNet } from './energy';
import type { Engineering, EngNode } from './Engineering';
import type { MachineProps } from './windows';

const PAGES = ['Power', 'Batteries', 'Machines', 'Storage', 'Fluids', 'Alerts'] as const;
const PROBLEMS = new Set(['no_power', 'output_full', 'incomplete', 'no_tool', 'no_water', 'no_lava', 'no_fuel', 'no_recipe']);

const fmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const bar = (f: number, w = 12): string => '[' + '#'.repeat(Math.round(Math.max(0, Math.min(1, f)) * w)).padEnd(w, '-') + ']';
const statusOf = (n: EngNode): string => (n.be()?.status ?? 'idle').split(':')[0]!;

export interface Scope {
  net: EnergyNet;
  generators: EngNode[];
  batteries: EngNode[];
  machines: EngNode[];
  storage: [number, number, number][];
  tanks: EngNode[];
}

export class ControlRoom {
  readonly pageCount = PAGES.length;
  private scopes = new Map<EnergyNet, Scope>();

  constructor(private readonly eng: Engineering) {}

  pageName(i: number): string {
    return PAGES[i % PAGES.length]!;
  }

  invalidate(): void {
    this.scopes.clear();
  }

  /** V5.5: what the energy network at a position can see (computers' programs), or null off any network. */
  scopeAt(dim: import('../world/Dimension').Dimension, x: number, y: number, z: number): Scope | null {
    const net = this.eng.energy.netAt(dim, x, y, z);
    return net ? this.scopeOf(net) : null;
  }

  /** V5.5: the alerts a monitor's Alerts page would show for a scope. */
  alerts(sc: Scope): string[] {
    const out: string[] = [];
    for (const m of [...sc.machines, ...sc.generators]) if (PROBLEMS.has(statusOf(m))) out.push(`${m.c.name} at ${m.x}, ${m.y}, ${m.z}: ${STATUS_TEXT[statusOf(m)] ?? statusOf(m)}`);
    if (sc.net.stats.limited) out.push('The network is at its cable limit');
    if (sc.net.stats.capacity && sc.net.stats.stored / sc.net.stats.capacity < 0.1) out.push('Batteries low');
    return out;
  }

  /** V5.5: a computer next to a monitor drives its screen; the monitor's own pages wait. */
  private pcDriven(n: EngNode): boolean {
    const at = n.be()?.pcAt;
    return typeof at === 'number' && this.eng.server.tickNo - at < 80;
  }

  /** What a network can see: its devices, and storage and tanks touching it. */
  private scopeOf(net: EnergyNet): Scope {
    let s = this.scopes.get(net);
    if (s) return s;
    s = { net, generators: [], batteries: [], machines: [], storage: [], tanks: [] };
    for (const d of net.devices) {
      if (d.removed) continue;
      if (d.c.kind === 'battery') s.batteries.push(d);
      else if (d.c.energy?.gen) s.generators.push(d);
      else if (d.c.kind === 'machine' || d.c.kind === 'multiblock' || d.c.kind === 'pump' || d.c.kind === 'extractor') s.machines.push(d);
    }
    const seen = new Set<string>();
    for (const m of net.members) {
      const [x, y, z] = m.slice(m.indexOf('|') + 1).split(',').map(Number) as [number, number, number];
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const ny = y + FACE_DY[f];
        const nz = z + FACE_DZ[f];
        const k = nx + ',' + ny + ',' + nz;
        if (seen.has(k) || !net.dim.isLoaded(nx, nz)) continue;
        seen.add(k);
        const st = net.dim.getState(nx, ny, nz);
        const def = blocks[STATE_BLOCK[st]!]!.def;
        const c = COMPONENT_BY_ID.get(def.id);
        if (c?.kind === 'storage' || def.entity === 'chest' || def.entity === 'barrel') s.storage.push([nx, ny, nz]);
        else if (c?.kind === 'tank') {
          const t = this.eng.node(net.dim, nx, ny, nz);
          if (t) s.tanks.push(t);
        }
      }
    }
    this.scopes.set(net, s);
    return s;
  }

  /** Draws power for monitors and panels; updates screens; checks control room advancements. */
  refresh(nodes: EngNode[]): void {
    this.scopes.clear();
    const panels = new Map<EnergyNet, EngNode[]>();
    const monitors = new Map<EnergyNet, EngNode[]>();
    for (const n of nodes) {
      if (n.removed || (n.c.kind !== 'monitor' && n.c.kind !== 'control_panel')) continue;
      const be = n.be();
      if (!be) continue;
      const powered = (be.energy ?? 0) >= 20;
      if (powered) {
        be.energy = (be.energy ?? 0) - 20;
        n.dirty = true;
      }
      this.eng.machines.setStatus(n, powered ? 'working' : 'no_power');
      const net = this.eng.energy.netAt(n.dim, n.x, n.y, n.z);
      if (net && powered) (n.c.kind === 'monitor' ? monitors : panels).set(net, [...((n.c.kind === 'monitor' ? monitors : panels).get(net) ?? []), n]);
      if (n.c.kind === 'monitor' && !this.pcDriven(n)) this.updateMonitor(n, powered);
    }
    // A control room: a monitor and a control panel watching the same network of three or more machines
    for (const [net, mons] of monitors) {
      const pans = panels.get(net);
      if (!pans) continue;
      const sc = this.scopeOf(net);
      if (sc.machines.length + sc.generators.length < 3) continue;
      for (const m of [...mons, ...pans]) this.eng.grant(m, 'control_room');
      // ...and a factory: five machines at work, fed by automation
      const working = sc.machines.filter((m) => statusOf(m) === 'working');
      if (working.length >= 5 && working.filter((m) => m.be()?.auto).length >= 3) for (const m of working) this.eng.grant(m, 'automated_factory');
    }
  }

  /** Writes a monitor's screen into its block entity and sends it to whoever can see it. */
  updateMonitor(n: EngNode, powered = (n.be()?.energy ?? 0) > 0): void {
    const be = n.be();
    if (!be) return;
    const page = (be.cfg?.page ?? 0) % PAGES.length;
    const net = this.eng.energy.netAt(n.dim, n.x, n.y, n.z);
    const lines = !powered ? ['', '   NO POWER', '', '  Cable it to a', '  powered network'] : !net ? ['NOT CONNECTED'] : this.page(page, this.scopeOf(net));
    const json = JSON.stringify(lines);
    if (JSON.stringify(be.lines ?? null) === json) return;
    be.lines = lines;
    n.dim.setBlockEntity(n.x, n.y, n.z, be);
    this.eng.server.sendToWatchers(n.dim, n.x, n.z, { t: 'block_entity', x: n.x, y: n.y, z: n.z, data: { type: 'eng', id: n.c.id, lines, page } });
  }

  private page(page: number, sc: Scope): string[] {
    const st = sc.net.stats;
    switch (PAGES[page]) {
      case 'Power': {
        const state = st.gen >= st.use ? 'OK' : st.short <= 0 && st.stored > 0 ? 'ON BATTERY' : 'SHORT';
        const out = [`POWER  ${state}`, `Gen  ${st.gen.toFixed(1)} EU/t`, `Use  ${st.use.toFixed(1)} EU/t`];
        for (const g of sc.generators.slice(0, 3)) out.push(`${g.c.name.slice(0, 14)} ${g.rate.toFixed(1)}`);
        if (!sc.generators.length) out.push('No generators');
        return out;
      }
      case 'Batteries': {
        if (!st.capacity) return ['BATTERIES', '', 'No batteries', 'on this network'];
        const f = st.stored / st.capacity;
        return ['BATTERIES', `${Math.round(f * 100)}% ${bar(f, 10)}`, `${fmt(st.stored)} / ${fmt(st.capacity)} EU`, `${sc.batteries.length} connected`, st.short > 0 ? `Short ${st.short.toFixed(1)} EU/t` : ''];
      }
      case 'Machines': {
        const counts = new Map<string, number>();
        for (const m of sc.machines) counts.set(statusOf(m), (counts.get(statusOf(m)) ?? 0) + 1);
        const out = [`MACHINES  ${sc.machines.length}`, `Working ${counts.get('working') ?? 0}  Idle ${(counts.get('idle') ?? 0) + (counts.get('no_input') ?? 0)}`];
        const bad = sc.machines.filter((m) => PROBLEMS.has(statusOf(m)));
        if (bad.length) out.push(`Problems ${bad.length}:`);
        for (const m of bad.slice(0, 3)) out.push(`${m.c.name.slice(0, 11)} ${(STATUS_TEXT[statusOf(m)] ?? '').slice(0, 10)}`);
        return out;
      }
      case 'Storage': {
        const total = new Map<number, number>();
        let fill = 0;
        let n = 0;
        for (const [x, y, z] of sc.storage) {
          const p = portAt(this.eng.server, sc.net.dim, x, y, z, 1);
          if (!p) continue;
          fill += p.fill();
          n++;
          for (const [id, c] of p.contents()) total.set(id, (total.get(id) ?? 0) + c);
        }
        if (!n) return ['STORAGE', '', 'No storage', 'next to this network'];
        const top = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return [`STORAGE  ${n} box${n > 1 ? 'es' : ''}`, `${Math.round((fill / n) * 100)}% full`, ...top.map(([id, c]) => `${items[id]!.def.name.slice(0, 13)} ${fmt(c)}`)];
      }
      case 'Fluids': {
        if (!sc.tanks.length) return ['FLUIDS', '', 'No tanks', 'next to this network'];
        const out = ['FLUIDS'];
        for (const t of sc.tanks.slice(0, 4)) {
          const f = t.be()?.fluid;
          out.push(`${f?.id ? f.id[0]!.toUpperCase() + f.id.slice(1) : 'Empty'} ${((f?.amount ?? 0) / 1000).toFixed(1)}/${(t.c.fluid!.capacity / 1000).toFixed(0)} B`);
        }
        return out;
      }
      default: {
        const out = ['ALERTS'];
        for (const m of [...sc.machines, ...sc.generators]) if (PROBLEMS.has(statusOf(m))) out.push(`! ${m.c.name.slice(0, 12)}: ${(STATUS_TEXT[statusOf(m)] ?? '').slice(0, 12)}`);
        if (st.limited) out.push('! Cable limit reached');
        if (st.capacity && st.stored / st.capacity < 0.1) out.push('! Batteries low');
        if (out.length === 1) out.push('', 'All systems normal');
        return out.slice(0, 6);
      }
    }
  }

  // ------------------------------------------------------------------ control panels

  panelInto(n: EngNode, p: MachineProps): void {
    const net = this.eng.energy.netAt(n.dim, n.x, n.y, n.z);
    if (!net) {
      p.info.push('Not connected: cable it to a network');
      return;
    }
    const sc = this.scopeOf(net);
    const list = [...sc.generators, ...sc.machines].slice(0, 24);
    p.info.push(`${list.length} machine${list.length === 1 ? '' : 's'} on this network. Use a switch to turn one on or off.`);
    p.buttons.push({ key: 'all_on', label: 'All on' }, { key: 'all_off', label: 'All off' });
    for (const m of list) {
      const be = m.be();
      const on = be?.cfg?.enabled !== false;
      p.buttons.push({ key: `toggle:${m.x},${m.y},${m.z}`, label: `${m.c.name} (${m.x}, ${m.y}, ${m.z}): ${STATUS_TEXT[statusOf(m)] ?? statusOf(m)}`, on });
    }
  }

  panelCommand(_p: ServerPlayer, n: EngNode, key: string): void {
    const net = this.eng.energy.netAt(n.dim, n.x, n.y, n.z);
    if (!net) return;
    const sc = this.scopeOf(net);
    const list = [...sc.generators, ...sc.machines];
    const set = (m: EngNode, on: boolean): void => {
      const be = m.be();
      if (!be) return;
      (be.cfg ??= {}).enabled = on;
      m.sleep = 0;
      m.dim.setBlockEntity(m.x, m.y, m.z, be);
    };
    if (key === 'all_on' || key === 'all_off') for (const m of list) set(m, key === 'all_on');
    else if (key.startsWith('toggle:')) {
      const [x, y, z] = key.slice(7).split(',').map(Number);
      const m = list.find((d) => d.x === x && d.y === y && d.z === z);
      if (m) set(m, m.be()?.cfg?.enabled === false);
    }
  }
}
