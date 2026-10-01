/**
 * Engineering windows. One builder serves every engineering block: storage
 * opens as a chest-style window; everything else as a 'machine' window whose
 * layout (input, output, fuel, tool, upgrade and filter slots, energy and
 * fluid bars, progress, status, information lines and setting buttons) is
 * described in the window props, so the client draws them all the same way.
 */
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import type { Window, WSlot } from '../systems/Containers';
import { blocks, STATE_BLOCK, getProp, withProp } from '../../common/registry/blocks';
import { items, itemById } from '../../common/registry/items';
import { type ItemStack, type Slot, cloneStack, maxStack, toSaved, fromSaved, canStack } from '../../common/game/itemstack';
import { fuelTicks, engRecipes } from '../../common/game/crafting';
import { GATE_MODES } from '../../common/engineering/catalog';
import type { MachineProps } from '../../common/engineering/window';
import { STATUS_TEXT } from './machines';
import { rangesOf, isUpgrade, type EngBE } from './state';
import { BARREL_MAX } from './ports';
import type { Engineering, EngNode } from './Engineering';

export type { MachineProps };

const fmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const SIGNAL_TEXT = { ignore: 'Ignores signals', on: 'Runs while powered', off: 'Runs while unpowered' };

interface Open {
  w: Window;
  node: EngNode;
  sent: string;
}

export class EngWindows {
  private readonly open = new Map<ServerPlayer, Open>();

  constructor(private readonly eng: Engineering) {}

  private get ct() {
    return this.eng.server.interaction.containers;
  }

  // ------------------------------------------------------------------ opening

  openFor(p: ServerPlayer, n: EngNode): void {
    const be = n.be();
    if (!be) return;
    const c = n.c;
    const r = rangesOf(c);
    const ct = this.ct;
    if (c.kind === 'storage' && c.id !== 'storage_barrel') {
      const inv = ct.containerAt(n.dim, n.x, n.y, n.z, r.size, 'eng');
      const w = ct.allocWindow('chest', c.name, r.size);
      for (let i = 0; i < r.size; i++) w.slots.push(this.slot(n, inv, i, 'container', () => true));
      this.track(p, w, n);
      return;
    }
    const w = ct.allocWindow('machine', c.name, (c.id === 'storage_barrel' ? 2 : r.size) + (c.slots?.ghost ?? 0));
    if (c.id === 'storage_barrel') this.barrelSlots(w, n, be);
    else if (r.size) {
      const inv = ct.containerAt(n.dim, n.x, n.y, n.z, r.size, 'eng');
      const may = (i: number): ((s: ItemStack) => boolean) => {
        if (i >= r.output[0] && i < r.output[1]) return () => false;
        if (i >= r.fuel[0] && i < r.fuel[1]) return (s) => fuelTicks(s) > 0;
        if (i >= r.tool[0] && i < r.tool[1]) return (s) => items[s.id]?.def.tool?.type === 'pickaxe';
        if (i >= r.upgrades[0] && i < r.upgrades[1]) return (s) => isUpgrade(items[s.id]?.id ?? '');
        if (c.kind === 'machine' || c.kind === 'multiblock') {
          if (c.machine === 'planter') return (s) => this.isSeed(s);
          if (c.machine === 'feeder' || c.machine === 'assembler') return () => true;
          if (c.machine) return (s) => this.eng.machines.isInput(c, s);
        }
        return () => true;
      };
      for (let i = 0; i < r.size; i++) {
        const out = i >= r.output[0] && i < r.output[1];
        const single = (i >= r.tool[0] && i < r.tool[1]) || (i >= r.upgrades[0] && i < r.upgrades[1]);
        const sl = this.slot(n, inv, i, out ? 'result' : i >= r.fuel[0] && i < r.fuel[1] ? 'fuel' : 'input', may(i), single ? 1 : 64);
        if (out) {
          sl.output = true;
          sl.onTake = () => undefined;
        }
        w.slots.push(sl);
      }
    }
    // Filter / target slots
    for (let g = 0; g < (c.slots?.ghost ?? 0); g++) w.slots.push(this.ghostSlot(n, g));
    w.props = this.props(n) as unknown as Record<string, unknown>;
    this.track(p, w, n);
  }

  private isSeed(s: ItemStack): boolean {
    const id = items[s.id]?.id;
    return blocks.some((bt) => bt.def.model === 'crop' && bt.def.data?.seed === id);
  }

  private track(p: ServerPlayer, w: Window, n: EngNode): void {
    w.pos = { dim: n.dim, x: n.x, y: n.y, z: n.z };
    w.onClose = (pl) => this.open.delete(pl);
    this.ct.openCustom(p, w);
    this.open.set(p, { w, node: n, sent: JSON.stringify(w.props) });
  }

  private slot(n: EngNode, inv: import('../player/Inventory').Inventory, i: number, group: WSlot['group'], mayPlace: (s: ItemStack) => boolean, max = 64): WSlot {
    return {
      get: () => inv.get(i),
      set: (s) => {
        inv.set(i, s);
        this.ct.persist(n.dim, n.x, n.y, n.z, inv);
        n.sleep = 0;
        this.eng.refreshWindows(n.dim, n.x, n.y, n.z);
      },
      mayPlace,
      max: (s) => Math.min(maxStack(s), max),
      group,
    };
  }

  private ghostSlot(n: EngNode, g: number): WSlot {
    return {
      get: () => fromSaved(n.be()?.ghost?.[g] ?? null),
      set: (s) => {
        const be = n.be();
        if (!be) return;
        const ghost = (be.ghost ??= []);
        ghost[g] = s ? toSaved({ ...cloneStack(s), count: 1, tag: undefined }) : null;
        n.dim.setBlockEntity(n.x, n.y, n.z, be);
        n.sleep = 0;
        this.eng.transport.invalidateAt(n.dim, n.x, n.y, n.z);
      },
      mayPlace: () => false,
      max: () => 1,
      group: 'result',
      ghost: true,
    };
  }

  /** The storage barrel: an insert slot and a take slot over its one counted stack. */
  private barrelSlots(w: Window, n: EngNode, be: EngBE): void {
    const st = (be.stored ??= { item: null, count: 0 });
    const save = (): void => {
      n.dim.setBlockEntity(n.x, n.y, n.z, be);
      this.eng.refreshWindows(n.dim, n.x, n.y, n.z);
    };
    const kind = (): ItemStack | null => (st.item && st.count > 0 ? fromSaved(st.item) : null);
    w.slots.push({
      get: () => null,
      set: (s) => {
        if (!s) return;
        const k = kind();
        if (k && !canStack(k, s)) return;
        if (!k) st.item = toSaved({ ...cloneStack(s), count: 1 });
        st.count = Math.min(BARREL_MAX, st.count + s.count);
        save();
      },
      mayPlace: (s) => {
        const k = kind();
        return maxStack(s) > 1 && (!k || canStack(k, s)) && st.count + 1 <= BARREL_MAX;
      },
      max: (s) => Math.min(maxStack(s), BARREL_MAX - st.count),
      group: 'input',
    });
    w.slots.push({
      get: () => {
        const k = kind();
        return k ? { ...k, count: Math.min(st.count, maxStack(k)) } : null;
      },
      set: (s) => {
        const k = kind();
        if (!k) return;
        const shown = Math.min(st.count, maxStack(k));
        const left = s ? s.count : 0;
        st.count = Math.max(0, st.count - (shown - left));
        if (st.count <= 0) {
          st.count = 0;
          st.item = null;
        }
        save();
      },
      mayPlace: () => false,
      max: (s) => maxStack(s),
      group: 'container',
    });
  }

  // ------------------------------------------------------------------ props

  props(n: EngNode): MachineProps {
    const be = n.be() ?? ({ type: 'eng', id: n.c.id } as EngBE);
    const c = n.c;
    const s = c.slots ?? {};
    const status = (be.status ?? 'idle').split(':')[0]!;
    const detail = be.status?.includes(':') ? be.status.slice(be.status.indexOf(':') + 1) : '';
    const p: MachineProps = {
      comp: c.id,
      name: c.name,
      tier: c.tier,
      kind: c.kind,
      layout: { input: s.input ?? 0, output: s.output ?? 0, fuel: s.fuel ?? 0, tool: s.tool ?? 0, upgrades: s.upgrades ?? 0, ghost: s.ghost ?? 0 },
      info: [],
      buttons: [],
      guide: c.guide,
    };
    if (c.id === 'storage_barrel') p.layout = { input: 1, output: 1, fuel: 0, tool: 0, upgrades: 0, ghost: 0 };
    if (c.energy) {
      p.energy = Math.floor(be.energy ?? 0);
      p.energyMax = Math.floor(this.eng.capacityOf(n));
    }
    if (c.time && (c.kind === 'machine' || c.kind === 'multiblock' || c.kind === 'pump')) {
      p.progress = be.progress ?? 0;
      p.time = c.time;
    }
    if (c.kind !== 'storage' && c.kind !== 'battery' && c.kind !== 'signal' && c.kind !== 'item_filter' && c.kind !== 'fluid_filter' && c.kind !== 'valve' && c.kind !== 'tank') {
      p.status = status;
      p.statusText = STATUS_TEXT[status] ?? status;
      if (detail) p.statusText += ': ' + detail;
    }
    if (c.fluid) p.fluid = { id: be.fluid?.id ?? null, amount: Math.floor(be.fluid?.amount ?? 0), cap: c.fluid.capacity * (c.kind === 'tank' ? 1 : this.eng.upgrades(n).capacity) };
    const info = p.info;
    const fx = this.eng.upgrades(n);
    if (c.energy?.gen) info.push(`Making ${n.rate.toFixed(1)} EU/t (best ${c.energy.gen} EU/t)`);
    else if (c.energy?.use) info.push(`Uses ${(c.energy.use * fx.power).toFixed(1)} EU/t while working${fx.speed > 1 ? `, ${fx.speed.toFixed(1)}x speed` : ''}`);
    if (c.energy) {
      const net = this.eng.energy.netAt(n.dim, n.x, n.y, n.z);
      if (net) {
        const st = net.stats;
        info.push(`Network: +${st.gen.toFixed(1)} / -${st.use.toFixed(1)} EU/t${net.cap !== Infinity ? `, carries ${net.cap} EU/t` : ''}`);
        if (st.capacity > 0) info.push(`Batteries: ${fmt(st.stored)} / ${fmt(st.capacity)} EU (${Math.round((st.stored / st.capacity) * 100)}%)`);
        if (st.limited) info.push('The network is at its cable limit: use thicker cable');
      }
    }
    if (c.kind === 'battery') info.push(`Charge: ${fmt(be.energy ?? 0)} / ${fmt(c.energy!.capacity)} EU`);
    if (c.id === 'storage_barrel') {
      const k = be.stored?.item ? fromSaved(be.stored.item) : null;
      info.push(k ? `${items[k.id]!.def.name}: ${be.stored!.count} / ${BARREL_MAX}` : `Empty (holds ${BARREL_MAX} of one item)`);
    }
    if (c.kind === 'multiblock') info.push(be.formed ? 'Structure complete' : `Structure incomplete${be.missing ? ': needs ' + be.missing : ''}`);
    if (c.machine === 'scanner') {
      if (!be.scan) info.push('No scan yet');
      else if (!be.scan.length) info.push('No ores in range');
      else for (const o of be.scan.slice(0, 6)) info.push(`${o.count} ${o.ore.replace(/_/g, ' ')} (nearest at ${o.nearest.join(', ')})`);
    }
    if (c.machine === 'drill' || c.machine === 'quarry') {
      const r = (c.area ?? 1) + fx.range;
      info.push(`Digs a ${r * 2 + 1}x${r * 2 + 1} area${be.cursor ? `, now at y ${be.cursor[1]}` : ''}`);
    }
    if (c.machine === 'assembler') p.ghostLabel = 'Target (what to make)';
    if (c.kind === 'item_filter' || c.kind === 'extractor' || c.kind === 'sorter') {
      p.ghostLabel = c.kind === 'sorter' ? 'Items for the front (the rest go out the back)' : 'Filter (empty lets everything through)';
      p.buttons.push({ key: 'whitelist', label: be.cfg?.whitelist === false ? 'Blacklist: everything but these' : 'Whitelist: only these', on: be.cfg?.whitelist !== false });
    }
    // Settings
    if (c.signal) p.buttons.push({ key: 'signal', label: 'Signal: ' + SIGNAL_TEXT[be.cfg?.signal ?? 'ignore'] });
    if (c.kind === 'machine' || c.kind === 'multiblock' || c.kind === 'generator' || c.kind === 'pump' || c.kind === 'extractor') p.buttons.push({ key: 'enabled', label: be.cfg?.enabled === false ? 'Switched off' : 'Switched on', on: be.cfg?.enabled !== false });
    if ((c.kind === 'machine' || c.kind === 'multiblock') && (c.slots?.output ?? 0) > 0) p.buttons.push({ key: 'eject', label: be.cfg?.eject === false ? 'Output: stays inside' : 'Output: pushed out the back', on: be.cfg?.eject !== false });
    if (c.kind === 'valve') p.buttons.push({ key: 'enabled', label: be.cfg?.enabled === false ? 'Closed (by hand)' : 'Open (by hand)', on: be.cfg?.enabled !== false });
    if (c.id === 'timer') {
      const sec = (be.cfg?.period ?? 40) / 20;
      p.info.push(`Pulses every ${sec} s`);
      p.buttons.push({ key: 'period-', label: '- 0.5 s' }, { key: 'period+', label: '+ 0.5 s' });
    }
    if (c.id === 'level_sensor') {
      const mode = be.cfg?.mode ?? 'level';
      const th = be.cfg?.threshold ?? 50;
      p.info.push(mode === 'level' ? 'Signal strength follows how full the block behind is' : mode === 'above' ? `Signal while the block behind is at least ${th}% full` : `Signal while the block behind is under ${th}% full`);
      p.info.push(`Output now: ${be.out ?? 0}`);
      p.buttons.push({ key: 'mode', label: 'Mode: ' + mode }, { key: 'threshold-', label: '- 10%' }, { key: 'threshold+', label: '+ 10%' });
    }
    if (c.id === 'logic_gate') p.info.push('Mode: ' + (getProp(n.dim.getState(n.x, n.y, n.z), 'mode') ?? 'and').toUpperCase());
    if (c.kind === 'fluid_filter') p.buttons.push({ key: 'fluid', label: 'Passes: ' + (be.cfg?.fluid ?? 'nothing') });
    if (c.kind === 'tank') p.buttons.push({ key: 'drain', label: 'Empty the tank' });
    if (c.kind === 'monitor') p.buttons.push({ key: 'page', label: 'Page: ' + this.eng.control.pageName(be.cfg?.page ?? 0) });
    if (c.kind === 'control_panel') this.eng.control.panelInto(n, p);
    return p;
  }

  // ------------------------------------------------------------------ updates

  step(): void {
    for (const [pl, o] of this.open) {
      if (o.node.removed || pl.windowId !== o.w.id) {
        this.open.delete(pl);
        continue;
      }
      const props = this.props(o.node);
      const json = JSON.stringify(props);
      if (json === o.sent) continue;
      o.sent = json;
      o.w.props = props as unknown as Record<string, unknown>;
      (o.w as Window & { sentProps?: string }).sentProps = json;
      pl.send({ t: 'window_prop', window: o.w.id, prop: 'all', value: props });
    }
  }

  refreshAt(dim: Dimension, x: number, y: number, z: number): void {
    for (const [pl, o] of this.open) if (o.node.dim === dim && o.node.x === x && o.node.y === y && o.node.z === z && pl.windowId === o.w.id) this.ct.sync(pl);
  }

  closeAt(dim: Dimension, x: number, y: number, z: number): void {
    for (const [pl, o] of [...this.open]) if (o.node.dim === dim && o.node.x === x && o.node.y === y && o.node.z === z) this.ct.closeWindow(pl, o.w.id);
  }

  // ------------------------------------------------------------------ settings

  handleCfg(p: ServerPlayer, windowId: number, key: string, value: string | number): void {
    const o = this.open.get(p);
    if (!o || o.w.id !== windowId || p.windowId !== windowId || o.node.removed) return;
    const n = o.node;
    if (p.dim !== n.dim || p.distanceSq(n.x + 0.5, n.y + 0.5, n.z + 0.5) > 64) return;
    if (this.eng.server.roleOf(p) === 'visitor') return;
    const be = n.be();
    if (!be) return;
    const cfg = (be.cfg ??= {});
    const c = n.c;
    if (key === 'signal' && c.signal) cfg.signal = cfg.signal === 'ignore' || !cfg.signal ? 'on' : cfg.signal === 'on' ? 'off' : 'ignore';
    else if (key === 'enabled') cfg.enabled = cfg.enabled === false;
    else if (key === 'eject' && (c.slots?.output ?? 0) > 0) cfg.eject = cfg.eject === false;
    else if ((key === 'period-' || key === 'period+') && c.id === 'timer') cfg.period = Math.max(10, Math.min(1200, (cfg.period ?? 40) + (key === 'period+' ? 10 : -10)));
    else if (key === 'mode' && c.id === 'level_sensor') cfg.mode = cfg.mode === 'level' || !cfg.mode ? 'above' : cfg.mode === 'above' ? 'below' : 'level';
    else if ((key === 'threshold-' || key === 'threshold+') && c.id === 'level_sensor') cfg.threshold = Math.max(0, Math.min(100, (cfg.threshold ?? 50) + (key === 'threshold+' ? 10 : -10)));
    else if (key === 'whitelist') cfg.whitelist = cfg.whitelist === false;
    else if (key === 'fluid' && c.kind === 'fluid_filter') cfg.fluid = cfg.fluid === 'water' ? 'lava' : cfg.fluid === 'lava' ? undefined : 'water';
    else if (key === 'drain' && c.kind === 'tank') {
      be.fluid = { id: null, amount: 0 };
      this.eng.fluids.updateTankVisual(n.dim, n.x, n.y, n.z, be);
    } else if (key === 'page' && c.kind === 'monitor') cfg.page = ((cfg.page ?? 0) + 1) % this.eng.control.pageCount;
    else if (c.kind === 'control_panel') this.eng.control.panelCommand(p, n, key);
    else return;
    n.sleep = 0;
    n.dim.setBlockEntity(n.x, n.y, n.z, be);
    this.eng.transport.invalidateAt(n.dim, n.x, n.y, n.z);
    this.eng.fluids.invalidateAt(n.dim, n.x, n.y, n.z);
    this.eng.server.playSound(n.dim, 'ui.click', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.5, 1.2);
    this.step();
  }

  // ------------------------------------------------------------------ the Engineering Book's Craft button

  /** Moves a recipe's ingredients from the player's inventory into the open Engineering Crafting Table's grid. */
  fill(p: ServerPlayer, recipeIndex: number, all: boolean): void {
    const w = this.ct.windowFor(p);
    if (!w || w.kind !== 'eng_crafting' || p.windowId !== w.id || !w.craftGrid) {
      p.send({ t: 'chat', text: 'Open an Engineering Crafting Table to craft from the Engineering Book.', kind: 'error' });
      return;
    }
    const recipe = engRecipes().find((r) => r.index === recipeIndex);
    if (!recipe) return;
    const grid = w.craftGrid;
    // Put back whatever is in the grid first
    for (let i = 0; i < 9; i++) {
      const s = grid.get(i);
      if (!s) continue;
      grid.set(i, null);
      const rest = p.inventory.add(s);
      if (rest) this.eng.server.interaction.dropStack(p, rest);
    }
    const cells: (Set<number> | null)[] = new Array(9).fill(null);
    if (recipe.shaped) {
      for (let y = 0; y < recipe.height; y++) for (let x = 0; x < recipe.width; x++) cells[y * 3 + x] = recipe.cells[y * recipe.width + x] ?? null;
    } else recipe.cells.forEach((c, i) => (cells[i] = c));
    // How many crafts the inventory allows (one, or as many as fit in a stack)
    const want = all ? 64 : 1;
    let crafts = 0;
    for (let k = 0; k < want; k++) {
      const plan: number[] = [];
      const used = new Map<number, number>();
      let ok = true;
      for (const cell of cells) {
        if (!cell) continue;
        let found = -1;
        for (let i = 0; i < 36; i++) {
          const s = p.inventory.get(i);
          if (s && cell.has(s.id) && s.count - (used.get(i) ?? 0) > 0) {
            found = i;
            break;
          }
        }
        if (found < 0) {
          ok = false;
          break;
        }
        used.set(found, (used.get(found) ?? 0) + 1);
        plan.push(found);
      }
      if (!ok) break;
      // Grid slots must have room for another item
      let room = true;
      let ci = 0;
      for (let g = 0; g < 9; g++) {
        if (!cells[g]) continue;
        const cur = grid.get(g);
        const src = p.inventory.get(plan[ci++]!)!;
        if (cur && (!canStack(cur, src) || cur.count >= maxStack(cur))) room = false;
      }
      if (!room) break;
      ci = 0;
      for (let g = 0; g < 9; g++) {
        if (!cells[g]) continue;
        const si = plan[ci++]!;
        const src = p.inventory.get(si)!;
        const cur = grid.get(g);
        grid.set(g, cur ? { ...cur, count: cur.count + 1 } : { ...cloneStack(src), count: 1 });
        p.inventory.set(si, src.count > 1 ? { ...src, count: src.count - 1 } : null);
      }
      crafts++;
    }
    if (!crafts) p.send({ t: 'chat', text: 'You don\'t have everything that recipe needs.', kind: 'error' });
    w.refresh?.();
    this.ct.sync(p);
  }

  /** The block's own window, or its quick action (logic gates change mode, monitors change page). */
  quickUse(p: ServerPlayer, n: EngNode): void {
    const be = n.be();
    if (n.c.id === 'logic_gate') {
      const s = n.dim.getState(n.x, n.y, n.z);
      const i = GATE_MODES.indexOf((getProp(s, 'mode') ?? 'and') as (typeof GATE_MODES)[number]);
      const next = GATE_MODES[(i + 1) % GATE_MODES.length]!;
      n.dim.setBlock(n.x, n.y, n.z, withProp(s, 'mode', next), { keepBlockEntity: true });
      this.eng.server.power?.touch(n.dim, n.x, n.y, n.z);
      p.send({ t: 'chat', text: 'Logic Gate mode: ' + next.toUpperCase(), kind: 'system' });
      this.eng.server.playSound(n.dim, 'machine.switch', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.4, 1);
      return;
    }
    if (n.c.kind === 'monitor' && be && !p.sneaking) {
      const cfg = (be.cfg ??= {});
      cfg.page = ((cfg.page ?? 0) + 1) % this.eng.control.pageCount;
      n.dim.setBlockEntity(n.x, n.y, n.z, be);
      this.eng.control.updateMonitor(n);
      this.eng.server.playSound(n.dim, 'ui.click', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.4, 1.3);
      return;
    }
    this.openFor(p, n);
  }
}

export { itemById, STATE_BLOCK, type Slot };
