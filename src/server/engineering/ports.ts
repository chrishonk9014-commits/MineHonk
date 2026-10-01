/**
 * Item ports: one way for conveyors, hoppers, chutes, pipes and machines to
 * put items into and take them out of anything that holds items: chests and
 * barrels, furnaces (input from above, fuel from the sides, results out),
 * crates and other storage, machines (inputs in, results out) and the
 * storage barrel (one kind of item, 4,096 of it).
 *
 * Every change goes straight back into the block entity, and windows open on
 * the block are refreshed, so items are never in two places at once.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { Inventory } from '../player/Inventory';
import { blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { type ItemStack, canStack, maxStack, cloneStack, toSaved, fromSaved, isAdminStack } from '../../common/game/itemstack';
import { fuelTicks, smeltingFor } from '../../common/game/crafting';
import { compOf, rangesOf, type EngBE } from './state';

export interface Port {
  /** Puts up to st.count in; returns how many went in (nothing changes when simulating). */
  insert(st: ItemStack, simulate?: boolean): number;
  /** Takes up to `max` of one kind of item (the first that matches). */
  extract(max: number, match?: (s: ItemStack) => boolean, simulate?: boolean): ItemStack | null;
  /** How full it is (0..1). */
  fill(): number;
  /** Item counts by item number (monitors, scanners). */
  contents(): Map<number, number>;
}

export const BARREL_MAX = 4096;

function slotPort(inv: Inventory, ins: number[], outs: number[], may: (slot: number, s: ItemStack) => boolean, changed: () => void, cap = 64): Port {
  return {
    insert(st, simulate) {
      let left = st.count;
      const plan: [number, number][] = [];
      // Fill matching stacks first, then empty slots
      for (const pass of [0, 1])
        for (const i of ins) {
          if (left <= 0) break;
          const cur = inv.get(i);
          if (pass === 0 ? !cur || !canStack(cur, st) : !!cur) continue;
          if (!may(i, st)) continue;
          const room = Math.min(cap, maxStack(st)) - (cur?.count ?? 0);
          const n = Math.min(room, left);
          if (n <= 0) continue;
          plan.push([i, n]);
          left -= n;
        }
      const moved = st.count - left;
      if (!simulate && moved > 0) {
        for (const [i, n] of plan) {
          const cur = inv.get(i);
          inv.set(i, cur ? { ...cur, count: cur.count + n } : { ...cloneStack(st), count: n });
        }
        changed();
      }
      return moved;
    },
    extract(max, match, simulate) {
      for (const i of outs) {
        const cur = inv.get(i);
        if (!cur || (match && !match(cur))) continue;
        const n = Math.min(max, cur.count);
        if (!simulate) {
          inv.set(i, cur.count > n ? { ...cur, count: cur.count - n } : null);
          changed();
        }
        return { ...cloneStack(cur), count: n };
      }
      return null;
    },
    fill() {
      let used = 0;
      for (const i of ins.length ? ins : outs) {
        const cur = inv.get(i);
        used += cur ? cur.count / maxStack(cur) : 0;
      }
      const n = (ins.length ? ins : outs).length;
      return n ? used / n : 0;
    },
    contents() {
      const m = new Map<number, number>();
      for (let i = 0; i < inv.size; i++) {
        const cur = inv.get(i);
        if (cur) m.set(cur.id, (m.get(cur.id) ?? 0) + cur.count);
      }
      return m;
    },
  };
}

const range = (r: [number, number]): number[] => Array.from({ length: r[1] - r[0] }, (_, i) => r[0] + i);

/** The storage barrel: one kind of item, counted. */
function barrelPort(server: GameServer, dim: Dimension, x: number, y: number, z: number, be: EngBE): Port {
  const st = (be.stored ??= { item: null, count: 0 });
  const save = (): void => {
    dim.setBlockEntity(x, y, z, be);
    server.engineering?.refreshWindows(dim, x, y, z);
  };
  const kind = (): ItemStack | null => (st.item && st.count > 0 ? fromSaved(st.item) : null);
  return {
    insert(s, simulate) {
      const k = kind();
      if (k && !canStack(k, s)) return 0;
      if (!k && maxStack(s) === 1) return 0;
      const n = Math.min(s.count, BARREL_MAX - st.count);
      if (n > 0 && !simulate) {
        if (!k) st.item = toSaved({ ...cloneStack(s), count: 1 });
        st.count += n;
        save();
      }
      return Math.max(0, n);
    },
    extract(max, match, simulate) {
      const k = kind();
      if (!k || (match && !match(k))) return null;
      const n = Math.min(max, st.count, maxStack(k));
      if (!simulate) {
        st.count -= n;
        if (st.count <= 0) {
          st.count = 0;
          st.item = null;
        }
        save();
      }
      return { ...k, count: n };
    },
    fill: () => st.count / BARREL_MAX,
    contents() {
      const k = kind();
      return new Map(k ? [[k.id, st.count]] : []);
    },
  };
}

/**
 * The port of the block at (x,y,z), for items arriving through (or leaving
 * by) its face `face` (0 down .. 5 east). Null if it holds no items.
 */
export function portAt(server: GameServer, dim: Dimension, x: number, y: number, z: number, face: number): Port | null {
  if (!dim.isLoaded(x, z)) return null;
  const state = dim.getState(x, y, z);
  const bt = blocks[STATE_BLOCK[state]!]!;
  const ct = server.interaction.containers;
  const id = bt.id;
  // Vanilla containers
  if (bt.def.entity === 'chest' || bt.def.entity === 'barrel') {
    if (id === 'ender_chest') return null;
    const inv = ct.containerAt(dim, x, y, z, 27, bt.def.entity);
    const all = range([0, 27]);
    return slotPort(inv, all, all, () => true, () => {
      ct.persist(dim, x, y, z, inv);
      ct.refreshViewers(dim, x, y, z);
    });
  }
  if (bt.def.entity === 'furnace') {
    const inv = ct.containerAt(dim, x, y, z, 3, 'furnace');
    const changed = (): void => {
      ct.persist(dim, x, y, z, inv);
      ct.registerFurnace(dim, x, y, z);
      ct.refreshViewers(dim, x, y, z);
    };
    // From above: what to smelt; from the sides: fuel; results come out
    if (face === 1) return slotPort(inv, [0], [2], (_i, s) => !!smeltingFor(s.id), changed);
    return slotPort(inv, face === 0 ? [] : [1], [2], (_i, s) => fuelTicks(s) > 0, changed);
  }
  // Engineering blocks
  const be = dim.getBlockEntity(x, y, z) as EngBE | undefined;
  if (!be || be.type !== 'eng') return null;
  const c = compOf(be.id);
  if (!c) return null;
  if (c.id === 'storage_barrel') return barrelPort(server, dim, x, y, z, be);
  // V5.5: computers and server racks keep their parts to themselves (drives move by hand only)
  if (c.kind === 'computer' || c.kind === 'server') return null;
  const r = rangesOf(c);
  if (!r.size) return null;
  const inv = ct.containerAt(dim, x, y, z, r.size, 'eng');
  const changed = (): void => {
    ct.persist(dim, x, y, z, inv);
    server.engineering?.wake(dim, x, y, z);
    server.engineering?.refreshWindows(dim, x, y, z);
  };
  if (c.kind === 'storage' || c.kind === 'hopper' || c.kind === 'chute') {
    const all = range([0, r.size]);
    return slotPort(inv, all, all, () => true, changed);
  }
  if (c.kind === 'sorter') return slotPort(inv, range(r.input), range(r.input), () => true, changed);
  // Machines and generators: inputs, fuel and tools in; results out
  const ins = [...range(r.input), ...range(r.fuel), ...range(r.tool)];
  const fuel = new Set(range(r.fuel));
  const tool = new Set(range(r.tool));
  const may = (i: number, s: ItemStack): boolean => {
    if (fuel.has(i)) return fuelTicks(s) > 0 && server.engineering?.isRecipeInput(c, s) !== true;
    if (tool.has(i)) return items[s.id]?.def.tool?.type === 'pickaxe';
    // Cheat-made items never mix into a machine's work with legit ones
    const other = inv.slots.find((o, k) => o && k >= r.input[0] && k < r.input[1] && isAdminStack(o) !== isAdminStack(s));
    return !other;
  };
  return slotPort(inv, ins, range(r.output), may, changed);
}
