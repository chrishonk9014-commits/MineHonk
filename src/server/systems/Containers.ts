/**
 * Container windows and authoritative inventory click handling.
 *
 * The client may predict clicks locally, but after every click the server
 * sends the full authoritative window contents, so any desync or tampering
 * is corrected immediately.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Inventory, ARMOR_START, OFFHAND } from '../player/Inventory';
import { type ItemStack, type Slot, canStack, cloneStack, maxStack, isEmpty, sameItem, toSaved, fromSaved, type SavedStack, itemIdOf, isAdminStack, markAdmin } from '../../common/game/itemstack';
import { items, itemById } from '../../common/registry/items';
import type { C2S, WindowKind } from '../../common/net/protocol';
import { matchCrafting, craftingRemainder, smeltingFor, fuelTicks, stonecutterOptions, smithingResult, engRecipes, type CompiledRecipe } from '../../common/game/crafting';
import type { Dimension } from '../world/Dimension';
import { getProp, blocks, STATE_BLOCK, withProp } from '../../common/registry/blocks';
import { FACE_DX, FACE_DZ } from '../../common/world/constants';
import { isSurvivalLike } from '../../common/game/gamemode';
import { rollLoot } from '../../common/game/loot';
import { Random } from '../../common/math/rng';

export interface WSlot {
  get(): Slot;
  set(s: Slot): void;
  mayPlace(s: ItemStack): boolean;
  max(s: ItemStack): number;
  output?: boolean;
  /** Called after items were taken from an output slot. */
  onTake?(p: ServerPlayer, taken: ItemStack): void;
  /** Group for shift-click routing. */
  group: 'container' | 'main' | 'hotbar' | 'armor' | 'offhand' | 'craft' | 'result' | 'fuel' | 'input';
  /** V5 filter / target slots: clicking puts a copy of the cursor item (one) there, never the item itself. */
  ghost?: boolean;
}

export class Window {
  readonly slots: WSlot[] = [];
  props: Record<string, unknown> = {};
  dragSlots: number[] = [];
  dragButton = 0;
  /** Block position backing this window (for distance checks). */
  pos: { dim: Dimension; x: number; y: number; z: number } | null = null;
  onChange?: () => void;
  onClose?: (p: ServerPlayer) => void;
  /** Recompute outputs after any change. */
  refresh?: () => void;
  /** Crafting grid of crafting windows (the Engineering Book fills it). */
  craftGrid?: Inventory;

  constructor(
    readonly id: number,
    readonly kind: WindowKind,
    readonly title: string,
    readonly containerSize: number,
  ) {}
}

function invSlot(inv: Inventory, i: number, group: WSlot['group'], mayPlace: (s: ItemStack) => boolean = () => true, maxOverride?: number, onSet?: () => void): WSlot {
  return {
    get: () => inv.get(i),
    set: (s) => {
      inv.set(i, s);
      onSet?.();
    },
    mayPlace,
    max: (s) => Math.min(maxStack(s), maxOverride ?? 64),
    group,
  };
}

const ARMOR_ORDER = ['head', 'chest', 'legs', 'feet'] as const;
const ARMOR_INDEX: Record<string, number> = { head: 39, chest: 38, legs: 37, feet: 36 };

function armorOk(slot: string) {
  return (s: ItemStack): boolean => {
    const a = items[s.id]?.def.armor;
    if (a) return a.slot === slot;
    const id = items[s.id]?.id;
    return slot === 'head' && (id === 'carved_pumpkin' || id === 'turtle_helmet');
  };
}

export class Containers {
  private nextWindowId = 1;
  /** Live container inventories keyed by "dim:x,y,z". */
  private readonly live = new Map<string, Inventory>();
  /** Furnaces that are burning or have work (ticked every tick). */
  private readonly activeFurnaces = new Map<string, { dim: Dimension; x: number; y: number; z: number }>();
  private readonly windows = new Map<ServerPlayer, Window>();
  private readonly playerCraft = new Map<ServerPlayer, Inventory>();

  constructor(private readonly server: GameServer) {}

  windowOf(p: ServerPlayer): Window {
    let w = this.windows.get(p);
    if (!w || (p.windowId === 0 && w.id !== 0)) {
      w = this.playerWindow(p);
      this.windows.set(p, w);
    }
    return w;
  }

  /** Appends the player's main inventory and hotbar to a custom window. */
  addPlayerSlots(w: Window, p: ServerPlayer): void {
    this.addPlayerInventory(w, p);
  }

  private addPlayerInventory(w: Window, p: ServerPlayer): void {
    const inv = p.inventory;
    for (let i = 9; i < 36; i++) w.slots.push(invSlot(inv, i, 'main'));
    for (let i = 0; i < 9; i++) w.slots.push(invSlot(inv, i, 'hotbar'));
  }

  private craftGrid(p: ServerPlayer, size: number): Inventory {
    if (size === 4) {
      let g = this.playerCraft.get(p);
      if (!g) {
        g = new Inventory(4);
        this.playerCraft.set(p, g);
      }
      return g;
    }
    return new Inventory(size);
  }

  /** Adds result + grid slots for a crafting window. */
  private addCrafting(w: Window, p: ServerPlayer, grid: Inventory, gw: number, list?: CompiledRecipe[]): void {
    const result: { stack: Slot } = { stack: null };
    w.craftGrid = grid;
    const refresh = (): void => {
      const r = matchCrafting(grid.slots, gw, gw, list);
      // Anything crafted from cheat items (or in a cheat context) is cheat-made
      const cheat = !!r && (grid.slots.some((s) => isAdminStack(s)) || this.server.admin.inContext(p));
      result.stack = r ? { id: r.result, count: r.count, ...(cheat ? { tag: { admin: true } } : {}) } : null;
    };
    w.refresh = refresh;
    w.slots.push({
      get: () => result.stack,
      set: () => {},
      mayPlace: () => false,
      max: (s) => maxStack(s),
      output: true,
      group: 'result',
      onTake: (pl, taken) => {
        // consume one of each ingredient
        for (let i = 0; i < grid.size; i++) {
          const s = grid.get(i);
          if (!s) continue;
          const rem = craftingRemainder(s);
          if (s.count <= 1) grid.set(i, rem);
          else {
            grid.set(i, { ...s, count: s.count - 1 });
            if (rem) {
              const left = pl.inventory.add(rem);
              if (left) this.server.interaction.dropStack(pl, left);
            }
          }
        }
        pl.addStat('crafted.' + itemIdOf(taken), taken.count);
        this.server.interaction.onCrafted(pl, taken);
        refresh();
      },
    });
    for (let i = 0; i < grid.size; i++) w.slots.push(invSlot(grid, i, 'craft', () => true, 64, refresh));
    refresh();
  }

  private playerWindow(p: ServerPlayer): Window {
    const w = new Window(0, 'player', 'Inventory', 5);
    this.addCrafting(w, p, this.craftGrid(p, 4), 2);
    for (const a of ARMOR_ORDER) w.slots.push(invSlot(p.inventory, ARMOR_INDEX[a]!, 'armor', armorOk(a), 1, () => this.server.interaction.survival.updateArmor(p)));
    this.addPlayerInventory(w, p);
    w.slots.push(invSlot(p.inventory, OFFHAND, 'offhand'));
    return w;
  }

  // ------------------------------------------------------------------ opening

  private open(p: ServerPlayer, w: Window): void {
    this.closeWindow(p, p.windowId, false);
    this.windows.set(p, w);
    p.windowId = w.id;
    p.send({ t: 'open_window', window: w.id, kind: w.kind, title: w.title, size: w.containerSize, data: w.props });
    (w as Window & { sentProps?: string }).sentProps = JSON.stringify(w.props);
    this.sync(p);
  }

  private newId(): number {
    this.nextWindowId = (this.nextWindowId % 100) + 1;
    return this.nextWindowId;
  }

  openCrafting(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const w = new Window(this.newId(), 'crafting', 'Crafting', 10);
    const grid = new Inventory(9);
    this.addCrafting(w, p, grid, 3);
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = (pl) => {
      for (let i = 0; i < 9; i++) {
        const s = grid.get(i);
        if (s) {
          const rem = pl.inventory.add(s);
          if (rem) this.server.interaction.dropStack(pl, rem);
        }
      }
    };
    this.open(p, w);
  }

  /** V5: the Engineering Crafting Table (its own recipes; the Engineering Book fills its grid). */
  openEngineeringTable(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const w = new Window(this.newId(), 'eng_crafting', 'Engineering Crafting Table', 10);
    const grid = new Inventory(9);
    this.addCrafting(w, p, grid, 3, engRecipes());
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = (pl) => {
      for (let i = 0; i < 9; i++) {
        const st = grid.get(i);
        if (st) {
          const rem = pl.inventory.add(st);
          if (rem) this.server.interaction.dropStack(pl, rem);
        }
      }
    };
    this.open(p, w);
  }

  private keyOf(dim: Dimension, x: number, y: number, z: number): string {
    return `${dim.id}:${x},${y},${z}`;
  }

  /**
   * Generated containers carry a loot table reference instead of items; the
   * loot is rolled (deterministically from the stored seed) the first time the
   * container is opened or broken.
   */
  materializeLoot(dim: Dimension, x: number, y: number, z: number, size = 27, cheat = false): void {
    const be = dim.getBlockEntity(x, y, z) as (Record<string, unknown> & { type: string }) | undefined;
    if (!be || typeof be.loot !== 'string') return;
    const rng = new Random(Number(be.lootSeed ?? 0) >>> 0);
    const stacks = rollLoot(be.loot, { rng, difficulty: this.server.level.difficulty });
    // Loot first opened under a cheat (e.g. after a cheat teleport) is cheat-made
    if (cheat || this.server.admin.blockMarked(dim, x, y, z)) for (const st of stacks) markAdmin(st);
    // Spread stacks over random slots, splitting some stacks like a hand-packed chest
    const slots: Slot[] = new Array(size).fill(null);
    const pieces: ItemStack[] = [];
    for (const st of stacks) {
      let rest = { ...st };
      while (rest.count > 1 && pieces.length + stacks.length < size && rng.chance(0.3)) {
        const n = 1 + rng.int(rest.count - 1);
        pieces.push({ ...rest, count: n });
        rest = { ...rest, count: rest.count - n };
      }
      pieces.push(rest);
    }
    const free = [...Array(size).keys()];
    for (const pc of pieces) {
      if (!free.length) break;
      const i = free.splice(rng.int(free.length), 1)[0]!;
      slots[i] = pc;
    }
    delete be.loot;
    delete be.lootSeed;
    be.items = slots.map(toSaved);
    dim.setBlockEntity(x, y, z, be);
  }

  /** Live inventory for a block entity container (created on demand). */
  containerAt(dim: Dimension, x: number, y: number, z: number, size: number, type: string, cheat = false): Inventory {
    const key = this.keyOf(dim, x, y, z);
    let inv = this.live.get(key);
    if (inv && inv.size === size) return inv;
    inv = new Inventory(size);
    this.materializeLoot(dim, x, y, z, size, cheat);
    const be = dim.getBlockEntity(x, y, z) as { items?: (SavedStack | null)[] } | undefined;
    if (be?.items) for (let i = 0; i < Math.min(size, be.items.length); i++) inv.slots[i] = fromSaved(be.items[i]);
    else dim.setBlockEntity(x, y, z, { type, items: new Array(size).fill(null) });
    this.live.set(key, inv);
    return inv;
  }

  /** Writes a live inventory back into its block entity. */
  persist(dim: Dimension, x: number, y: number, z: number, inv: Inventory, extra?: Record<string, unknown>): void {
    const be = (dim.getBlockEntity(x, y, z) ?? { type: 'chest' }) as Record<string, unknown> & { type: string };
    be.items = inv.slots.map(toSaved);
    if (extra) Object.assign(be, extra);
    dim.setBlockEntity(x, y, z, be);
  }

  openChest(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const state = dim.getState(x, y, z);
    const def = blocks[STATE_BLOCK[state]!]!.def;
    const type = getProp(state, 'type');
    // Find partner for double chests
    let parts: [number, number, number][] = [[x, y, z]];
    if (type === 'left' || type === 'right') {
      for (let f = 2; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const nz = z + FACE_DZ[f];
        const ns = dim.getState(nx, y, nz);
        if (STATE_BLOCK[ns] === STATE_BLOCK[state] && getProp(ns, 'type') !== 'single' && getProp(ns, 'facing') === getProp(state, 'facing') && getProp(ns, 'type') !== type) {
          parts = type === 'right' ? [[x, y, z], [nx, y, nz]] : [[nx, y, nz], [x, y, z]];
          break;
        }
      }
    }
    // Blocked chest (solid block above) cannot open
    for (const [cx, cy, cz] of parts) {
      const above = dim.getState(cx, cy + 1, cz);
      if (blocks[STATE_BLOCK[above]!]!.def.model === 'cube' && above !== 0 && def.id !== 'barrel') return;
    }
    const size = parts.length * 27;
    const w = new Window(this.newId(), 'chest', parts.length > 1 ? 'Large Chest' : def.name, size);
    for (const [cx, cy, cz] of parts) {
      const inv = this.containerAt(dim, cx, cy, cz, 27, 'chest', this.server.admin.inContext(p));
      for (let i = 0; i < 27; i++) w.slots.push(invSlot(inv, i, 'container', () => true, 64, () => this.persist(dim, cx, cy, cz, inv)));
    }
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = () => {
      this.server.playSound(dim, 'chest.close', x + 0.5, y + 0.5, z + 0.5, 0.5, 1);
      this.server.interaction.onChestViewers(dim, parts, -1);
    };
    this.server.playSound(dim, 'chest.open', x + 0.5, y + 0.5, z + 0.5, 0.5, 1);
    this.server.interaction.onChestViewers(dim, parts, 1);
    this.open(p, w);
  }

  openBarrel(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const inv = this.containerAt(dim, x, y, z, 27, 'barrel', this.server.admin.inContext(p));
    const shulker = dim.blockId(x, y, z) === 'shulker_box';
    const w = new Window(this.newId(), 'chest', shulker ? 'Shulker Box' : 'Barrel', 27);
    // A shulker box cannot hold another shulker box
    const may = shulker ? (st: ItemStack) => items[st.id]?.id !== 'shulker_box' : () => true;
    for (let i = 0; i < 27; i++) w.slots.push(invSlot(inv, i, 'container', may, 64, () => this.persist(dim, x, y, z, inv)));
    if (shulker) {
      this.server.playSound(dim, 'shulker.open', x + 0.5, y + 0.5, z + 0.5, 0.5, 1);
      w.onClose = () => this.server.playSound(dim, 'shulker.close', x + 0.5, y + 0.5, z + 0.5, 0.5, 1);
    }
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    this.open(p, w);
  }

  openEnderChest(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const w = new Window(this.newId(), 'chest', 'Ender Chest', 27);
    for (let i = 0; i < 27; i++) w.slots.push(invSlot(p.enderChest, i, 'container'));
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    this.open(p, w);
  }

  openFurnace(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number, kind: 'furnace' | 'blast_furnace' | 'smoker'): void {
    const inv = this.containerAt(dim, x, y, z, 3, 'furnace');
    const w = new Window(this.newId(), kind, blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.def.name, 3);
    const onSet = (): void => {
      this.persist(dim, x, y, z, inv);
      this.activeFurnaces.set(this.keyOf(dim, x, y, z), { dim, x, y, z });
    };
    w.slots.push(invSlot(inv, 0, 'input', (s) => !!smeltingFor(s.id), 64, onSet));
    w.slots.push(invSlot(inv, 1, 'fuel', (s) => fuelTicks(s) > 0 || items[s.id]?.id === 'bucket', 64, onSet));
    w.slots.push({
      ...invSlot(inv, 2, 'result', () => false, 64, onSet),
      output: true,
      onTake: (pl, taken) => {
        const be = dim.getBlockEntity(x, y, z) as { xp?: number; cheatXp?: number } | undefined;
        const xp = be?.xp ?? 0;
        const cxp = be?.cheatXp ?? 0;
        const round = (v: number): number => Math.floor(v) + (Math.random() < v % 1 ? 1 : 0);
        if (xp > 0) this.server.interaction.survival.giveXp(pl, round(xp));
        if (cxp > 0) this.server.interaction.survival.giveXp(pl, round(cxp), false, true);
        if (xp > 0 || cxp > 0) this.persist(dim, x, y, z, inv, { xp: 0, cheatXp: 0 });
        pl.addStat('smelted.' + itemIdOf(taken), taken.count);
        this.server.interaction.onSmelted(pl, taken);
      },
    });
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    const be = dim.getBlockEntity(x, y, z) as Record<string, number> | undefined;
    w.props = { burn: be?.burn ?? 0, burnTotal: be?.burnTotal ?? 0, cook: be?.cook ?? 0, cookTotal: be?.cookTotal ?? 200 };
    this.open(p, w);
  }

  openStonecutter(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const w = new Window(this.newId(), 'stonecutter', 'Stonecutter', 2);
    const input = new Inventory(1);
    const out: { stack: Slot; sel: number } = { stack: null, sel: -1 };
    const refresh = (): void => {
      const s = input.get(0);
      const opts = s ? stonecutterOptions(s.id) : [];
      w.props = { options: opts.map((o) => o.result), selected: out.sel };
      const o = opts[out.sel];
      out.stack = o && s ? { id: o.result, count: o.count, ...(isAdminStack(s) || this.server.admin.inContext(p) ? { tag: { admin: true } } : {}) } : null;
    };
    w.refresh = refresh;
    w.slots.push(invSlot(input, 0, 'input', (s) => stonecutterOptions(s.id).length > 0, 64, () => {
      out.sel = -1;
      refresh();
    }));
    w.slots.push({
      get: () => out.stack,
      set: () => {},
      mayPlace: () => false,
      max: (s) => maxStack(s),
      output: true,
      group: 'result',
      onTake: () => {
        const s = input.get(0);
        if (s) input.set(0, s.count > 1 ? { ...s, count: s.count - 1 } : null);
        refresh();
      },
    });
    (w as Window & { select?: (i: number) => void }).select = (i: number) => {
      out.sel = i;
      refresh();
    };
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = (pl) => {
      const s = input.get(0);
      if (s) {
        const rem = pl.inventory.add(s);
        if (rem) this.server.interaction.dropStack(pl, rem);
      }
    };
    refresh();
    this.open(p, w);
  }

  openSmithing(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const w = new Window(this.newId(), 'smithing', 'Upgrade Gear', 3);
    const inv = new Inventory(2);
    const out: { stack: Slot } = { stack: null };
    const refresh = (): void => {
      const base = inv.get(0);
      const r = smithingResult(base, inv.get(1));
      out.stack = r !== null && base ? { ...cloneStack(base), id: r, count: 1 } : null;
      if (out.stack && (isAdminStack(inv.get(1)) || this.server.admin.inContext(p))) out.stack = markAdmin(out.stack);
    };
    w.refresh = refresh;
    w.slots.push(invSlot(inv, 0, 'input', () => true, 64, refresh));
    w.slots.push(invSlot(inv, 1, 'input', () => true, 64, refresh));
    w.slots.push({
      get: () => out.stack,
      set: () => {},
      mayPlace: () => false,
      max: () => 1,
      output: true,
      group: 'result',
      onTake: (pl, taken) => {
        inv.set(0, null);
        const a = inv.get(1);
        if (a) inv.set(1, a.count > 1 ? { ...a, count: a.count - 1 } : null);
        this.server.playSound(dim, 'smithing', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        this.server.interaction.onCrafted(pl, taken);
        refresh();
      },
    });
    this.addPlayerInventory(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = (pl) => {
      for (let i = 0; i < 2; i++) {
        const s = inv.get(i);
        if (s) {
          const rem = pl.inventory.add(s);
          if (rem) this.server.interaction.dropStack(pl, rem);
        }
      }
    };
    this.open(p, w);
  }

  /** Opens a generic window built by another system (enchanting, anvil, brewing, merchant). */
  openCustom(p: ServerPlayer, w: Window): void {
    this.addPlayerInventory(w, p);
    this.open(p, w);
  }

  allocWindow(kind: WindowKind, title: string, size: number): Window {
    return new Window(this.newId(), kind, title, size);
  }

  closeWindow(p: ServerPlayer, id: number, silent = false): void {
    const w = this.windows.get(p);
    // Return cursor item to inventory
    if (p.cursor) {
      const rem = p.inventory.add(p.cursor);
      p.cursor = null;
      if (rem) this.server.interaction.dropStack(p, rem);
    }
    if (w && w.id !== 0 && (id === w.id || silent)) {
      w.onClose?.(p);
      this.windows.delete(p);
      p.windowId = 0;
      if (!silent) p.send({ t: 'close_window', window: w.id });
    } else if (w && w.id === 0) {
      // Closing the player inventory returns crafting grid items
      const g = this.playerCraft.get(p);
      if (g) {
        for (let i = 0; i < 4; i++) {
          const s = g.get(i);
          if (s) {
            g.set(i, null);
            const rem = p.inventory.add(s);
            if (rem) this.server.interaction.dropStack(p, rem);
          }
        }
        w.refresh?.();
      }
    }
    if (!silent) this.syncInventory(p);
  }

  // ------------------------------------------------------------------ sync

  sync(p: ServerPlayer, seq = 0): void {
    const w = this.windowOf(p);
    w.refresh?.();
    p.send({ t: 'inventory', window: w.id, slots: w.slots.map((s) => cloneStack(s.get())), cursor: cloneStack(p.cursor), seq });
    // Recipe / offer lists live in window props; resend them when they change
    if (w.id !== 0 && w.kind !== 'furnace' && w.kind !== 'blast_furnace' && w.kind !== 'smoker') {
      const json = JSON.stringify(w.props);
      if (json !== (w as Window & { sentProps?: string }).sentProps) {
        (w as Window & { sentProps?: string }).sentProps = json;
        p.send({ t: 'window_prop', window: w.id, prop: 'all', value: w.props });
      }
    }
    if (w.id !== 0) this.syncInventory(p, false);
  }

  /** Sends the player's own inventory (window 0) if anything changed. */
  syncInventory(p: ServerPlayer, force = true): void {
    if (!force && p.inventory.changed.size === 0) return;
    p.inventory.changed.clear();
    const w = this.playerWindowFor(p);
    w.refresh?.();
    p.send({ t: 'inventory', window: 0, slots: w.slots.map((s) => cloneStack(s.get())), cursor: p.windowId === 0 ? cloneStack(p.cursor) : null, seq: 0 });
    this.server.interaction.survival.updateArmor(p);
    p.metaDirty = true;
  }

  private playerWindowFor(p: ServerPlayer): Window {
    const w = this.windows.get(p);
    if (w && w.id === 0) return w;
    return this.playerWindow(p);
  }

  // ------------------------------------------------------------------ clicks

  handleClick(p: ServerPlayer, m: C2S & { t: 'click' }): void {
    const w = this.windowOf(p);
    if (m.window !== w.id) {
      this.sync(p, m.seq);
      return;
    }
    if (w.pos) {
      if (w.pos.dim !== p.dim || p.distanceSq(w.pos.x + 0.5, w.pos.y + 0.5, w.pos.z + 0.5) > 64) {
        this.closeWindow(p, w.id);
        return;
      }
    }
    const creative = p.gamemode === 'creative';
    try {
      this.applyClick(p, w, m.slot, m.button, m.mode, creative);
    } finally {
      w.refresh?.();
      this.sync(p, m.seq);
      if (w.id === 0) this.server.interaction.survival.updateArmor(p);
    }
  }

  private applyClick(p: ServerPlayer, w: Window, slotIndex: number, button: number, mode: string, creative: boolean): void {
    if (mode === 'drag_start') {
      w.dragSlots = [];
      w.dragButton = button;
      return;
    }
    if (mode === 'drag_add') {
      if (slotIndex >= 0 && slotIndex < w.slots.length && !w.dragSlots.includes(slotIndex)) w.dragSlots.push(slotIndex);
      return;
    }
    if (mode === 'drag_end') {
      this.finishDrag(p, w, creative);
      return;
    }
    if (slotIndex === -999) {
      if (mode === 'pickup' && p.cursor) {
        const n = button === 1 ? 1 : p.cursor.count;
        this.server.interaction.dropStack(p, { ...cloneStack(p.cursor), count: n });
        p.cursor = p.cursor.count - n > 0 ? { ...p.cursor, count: p.cursor.count - n } : null;
      }
      return;
    }
    if (slotIndex < 0 || slotIndex >= w.slots.length) return;
    const slot = w.slots[slotIndex]!;
    if (slot.ghost) {
      // Filter slots hold a copy of what was clicked in (or nothing); real items never move
      if (mode === 'pickup' || mode === 'quick' || mode === 'drop') slot.set(mode !== 'drop' && p.cursor ? { ...cloneStack(p.cursor), count: 1 } : null);
      return;
    }
    switch (mode) {
      case 'pickup':
        if (slot.output) this.takeOutput(p, w, slot, false);
        else this.pickup(p, slot, button);
        break;
      case 'quick':
        if (slot.output) this.takeOutput(p, w, slot, true);
        else this.quickMove(p, w, slotIndex);
        break;
      case 'swap': {
        const hotbarIdx = button === 40 ? OFFHAND : button;
        if (hotbarIdx < 0 || (hotbarIdx > 8 && hotbarIdx !== OFFHAND)) return;
        const hs = p.inventory.get(hotbarIdx);
        const cur = slot.get();
        if (slot.output) {
          if (!cur || hs) return;
          p.inventory.set(hotbarIdx, cloneStack(cur));
          slot.onTake?.(p, cur);
          return;
        }
        if (hs && !slot.mayPlace(hs)) return;
        if (hs && hs.count > slot.max(hs)) return;
        slot.set(hs ? cloneStack(hs) : null);
        p.inventory.set(hotbarIdx, cur ? cloneStack(cur) : null);
        break;
      }
      case 'drop': {
        const cur = slot.get();
        if (!cur || p.cursor) return;
        if (slot.output) {
          this.server.interaction.dropStack(p, cloneStack(cur));
          slot.onTake?.(p, cur);
          return;
        }
        const n = button === 1 ? cur.count : 1;
        this.server.interaction.dropStack(p, { ...cloneStack(cur), count: n });
        slot.set(cur.count - n > 0 ? { ...cur, count: cur.count - n } : null);
        break;
      }
      case 'collect': {
        if (!p.cursor) return;
        const target = p.cursor;
        for (let pass = 0; pass < 2; pass++) {
          for (const s of w.slots) {
            if (s.output || s.ghost) continue;
            const v = s.get();
            if (!v || !canStack(v, target)) continue;
            if (pass === 0 && v.count === maxStack(v)) continue;
            const take = Math.min(v.count, maxStack(target) - target.count);
            if (take <= 0) break;
            target.count += take;
            s.set(v.count - take > 0 ? { ...v, count: v.count - take } : null);
          }
        }
        break;
      }
      case 'clone': {
        if (!creative || p.cursor) return;
        const cur = slot.get();
        if (cur) p.cursor = { ...cloneStack(cur), count: maxStack(cur) };
        break;
      }
    }
  }

  private pickup(p: ServerPlayer, slot: WSlot, button: number): void {
    const cur = slot.get();
    const cursor = p.cursor;
    if (!cursor) {
      if (!cur) return;
      const take = button === 1 ? Math.ceil(cur.count / 2) : cur.count;
      p.cursor = { ...cloneStack(cur), count: take };
      slot.set(cur.count - take > 0 ? { ...cur, count: cur.count - take } : null);
      return;
    }
    if (!slot.mayPlace(cursor)) {
      // allow picking up into cursor when identical & slot not placeable
      return;
    }
    const max = slot.max(cursor);
    if (!cur) {
      const n = Math.min(button === 1 ? 1 : cursor.count, max);
      slot.set({ ...cloneStack(cursor), count: n });
      p.cursor = cursor.count - n > 0 ? { ...cursor, count: cursor.count - n } : null;
      return;
    }
    if (canStack(cur, cursor)) {
      const space = Math.min(max, maxStack(cur)) - cur.count;
      const n = Math.min(space, button === 1 ? 1 : cursor.count);
      if (n <= 0) return;
      slot.set({ ...cur, count: cur.count + n });
      p.cursor = cursor.count - n > 0 ? { ...cursor, count: cursor.count - n } : null;
      return;
    }
    if (cursor.count <= max) {
      slot.set(cloneStack(cursor));
      p.cursor = cloneStack(cur);
    }
  }

  private takeOutput(p: ServerPlayer, w: Window, slot: WSlot, shift: boolean): void {
    let guard = 0;
    do {
      const out = slot.get();
      if (!out) return;
      if (shift) {
        const fits = p.inventory.canFit(out);
        if (fits < out.count) return;
        const taken = cloneStack(out);
        slot.onTake?.(p, taken);
        // furnace output slot is a real slot: clear it
        if (slot.group === 'result' && w.kind !== 'crafting' && w.kind !== 'player' && w.kind !== 'stonecutter' && w.kind !== 'smithing') slot.set(null);
        p.inventory.add(taken, [[9, 36], [0, 9]]);
      } else {
        if (p.cursor && (!canStack(p.cursor, out) || p.cursor.count + out.count > maxStack(out))) return;
        const taken = cloneStack(out);
        slot.onTake?.(p, taken);
        if (slot.group === 'result' && w.kind !== 'crafting' && w.kind !== 'player' && w.kind !== 'stonecutter' && w.kind !== 'smithing') slot.set(null);
        if (p.cursor) p.cursor.count += taken.count;
        else p.cursor = taken;
        return;
      }
      w.refresh?.();
    } while (shift && ++guard < 64 && (w.kind === 'crafting' || w.kind === 'player' || w.kind === 'stonecutter'));
  }

  /** Shift-click routing between container and player inventory sections. */
  private quickMove(p: ServerPlayer, w: Window, index: number): void {
    const slot = w.slots[index]!;
    const stack = slot.get();
    if (!stack) return;
    let moving: ItemStack = cloneStack(stack);
    const targets: number[] = [];
    const idx = (g: WSlot['group']): number[] => w.slots.map((s, i) => (s.group === g ? i : -1)).filter((i) => i >= 0);
    const g = slot.group;
    const inPlayer = g === 'main' || g === 'hotbar' || g === 'armor' || g === 'offhand';
    if (w.kind === 'player') {
      const armor = items[stack.id]?.def.armor;
      if (g === 'main' || g === 'hotbar') {
        if (armor) {
          const ai = idx('armor').find((i) => w.slots[i]!.mayPlace(stack) && !w.slots[i]!.get());
          if (ai !== undefined) targets.push(ai);
        }
        targets.push(...(g === 'main' ? idx('hotbar') : idx('main')));
      } else targets.push(...idx('main'), ...idx('hotbar'));
    } else if (inPlayer) {
      // into the container: prefer specialised slots
      const special = w.slots.map((s, i) => ({ s, i })).filter(({ s }) => (s.group === 'input' || s.group === 'fuel' || s.group === 'container' || s.group === 'craft') && s.mayPlace(stack));
      if (w.kind === 'furnace' || w.kind === 'blast_furnace' || w.kind === 'smoker') {
        const input = w.slots[0]!;
        const fuel = w.slots[1]!;
        if (input.mayPlace(stack)) targets.push(0);
        else if (fuel.mayPlace(stack)) targets.push(1);
      } else targets.push(...special.map((x) => x.i));
      if (targets.length === 0) targets.push(...(g === 'main' ? idx('hotbar') : idx('main')));
    } else {
      targets.push(...idx('main').concat(idx('hotbar')).reverse());
    }
    // merge pass then empty pass
    for (const pass of [0, 1]) {
      for (const t of targets) {
        if (t === index) continue;
        const ts = w.slots[t]!;
        if (!ts.mayPlace(moving)) continue;
        const cur = ts.get();
        const max = Math.min(ts.max(moving), maxStack(moving));
        if (pass === 0 && cur && canStack(cur, moving)) {
          const n = Math.min(max - cur.count, moving.count);
          if (n > 0) {
            ts.set({ ...cur, count: cur.count + n });
            moving = { ...moving, count: moving.count - n };
          }
        } else if (pass === 1 && !cur) {
          const n = Math.min(max, moving.count);
          ts.set({ ...cloneStack(moving), count: n });
          moving = { ...moving, count: moving.count - n };
        }
        if (moving.count <= 0) break;
      }
      if (moving.count <= 0) break;
    }
    slot.set(moving.count > 0 ? moving : null);
  }

  private finishDrag(p: ServerPlayer, w: Window, creative: boolean): void {
    const cursor = p.cursor;
    const slots = w.dragSlots.filter((i) => {
      const s = w.slots[i]!;
      if (s.output || !cursor || !s.mayPlace(cursor)) return false;
      const cur = s.get();
      return !cur || canStack(cur, cursor);
    });
    w.dragSlots = [];
    if (!cursor || slots.length === 0) return;
    if (w.dragButton === 2 && !creative) return;
    let remaining = cursor.count;
    const per = w.dragButton === 0 ? Math.floor(cursor.count / slots.length) : 1;
    for (const i of slots) {
      const s = w.slots[i]!;
      const cur = s.get();
      const max = Math.min(s.max(cursor), maxStack(cursor));
      const have = cur?.count ?? 0;
      let n = w.dragButton === 2 ? max - have : Math.min(per, remaining, max - have);
      if (n <= 0) continue;
      s.set({ ...cloneStack(cursor), count: have + n });
      if (w.dragButton !== 2) remaining -= n;
    }
    p.cursor = remaining > 0 ? { ...cursor, count: remaining } : null;
  }

  /** Creative inventory: set any slot of the player's own inventory. */
  creativeSet(p: ServerPlayer, slot: number, item: Slot): void {
    if (p.gamemode !== 'creative') {
      this.syncInventory(p);
      return;
    }
    // Items taken from the creative menu under a cheat (e.g. cheat Creative mode) are cheat-made
    if (item && this.server.admin.inContext(p)) markAdmin(item);
    if (slot === -1) {
      if (item) this.server.interaction.dropStack(p, item);
      return;
    }
    // map player-window slot to inventory index
    const w = this.playerWindowFor(p);
    const s = w.slots[slot];
    if (!s || s.output) return;
    if (item && !s.mayPlace(item)) return;
    s.set(item);
    this.syncInventory(p);
  }

  // ------------------------------------------------------------------ furnaces

  registerFurnace(dim: Dimension, x: number, y: number, z: number): void {
    this.activeFurnaces.set(this.keyOf(dim, x, y, z), { dim, x, y, z });
  }

  forget(dim: Dimension, x: number, y: number, z: number): void {
    const k = this.keyOf(dim, x, y, z);
    this.live.delete(k);
    this.activeFurnaces.delete(k);
  }

  /** Drops cached container inventories for unloaded chunks. */
  onChunkUnloaded(dim: Dimension, cx: number, cz: number): void {
    for (const [k, v] of this.activeFurnaces) if (v.dim === dim && v.x >> 4 === cx && v.z >> 4 === cz) this.activeFurnaces.delete(k);
    const prefix = dim.id + ':';
    for (const k of this.live.keys()) {
      if (!k.startsWith(prefix)) continue;
      const [x, , z] = k.slice(prefix.length).split(',').map(Number) as [number, number, number];
      if (x >> 4 === cx && z >> 4 === cz) this.live.delete(k);
    }
  }

  tickFurnaces(): void {
    for (const [key, f] of this.activeFurnaces) {
      const { dim, x, y, z } = f;
      if (!dim.isLoaded(x, z)) {
        this.activeFurnaces.delete(key);
        continue;
      }
      const state = dim.getState(x, y, z);
      const bid = blocks[STATE_BLOCK[state]!]!.id;
      if (bid !== 'furnace' && bid !== 'blast_furnace' && bid !== 'smoker') {
        this.activeFurnaces.delete(key);
        this.live.delete(key);
        continue;
      }
      const inv = this.containerAt(dim, x, y, z, 3, 'furnace');
      const be = dim.getBlockEntity(x, y, z) as Record<string, number> & { type: string };
      let burn = be.burn ?? 0;
      let burnTotal = be.burnTotal ?? 0;
      let cook = be.cook ?? 0;
      let xp = be.xp ?? 0;
      let cheatXp = be.cheatXp ?? 0;
      const input = inv.get(0);
      const recipe = input ? smeltingFor(input.id) : null;
      const allowed = recipe && (bid === 'furnace' || (bid === 'blast_furnace' && recipe.kind === 'ore') || (bid === 'smoker' && recipe.kind === 'food'));
      const speed = bid === 'furnace' ? 1 : 2;
      const cookTotal = Math.floor(200 / speed);
      const out = inv.get(2);
      // Cheat input or fuel makes the result cheat-made; it never mixes with normal items
      const cheat = isAdminStack(input) || (burn > 0 ? be.cheatFuel === 1 : isAdminStack(inv.get(1)));
      const canSmelt = !!(allowed && recipe && (!out || (out.id === recipe.resultNum && out.count < maxStack(out) && isAdminStack(out) === cheat)));
      let changed = false;
      if (burn > 0) burn--;
      if (burn <= 0 && canSmelt) {
        const fuel = inv.get(1);
        const ft = fuelTicks(fuel);
        if (ft > 0 && fuel) {
          burn = burnTotal = Math.floor(ft / speed);
          const fid = items[fuel.id]!.id;
          if (fid === 'lava_bucket') inv.set(1, { id: itemById.get('bucket')!.num, count: 1, ...(isAdminStack(fuel) ? { tag: { admin: true } } : {}) });
          else inv.set(1, fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null);
          be.cheatFuel = isAdminStack(fuel) ? 1 : 0;
          changed = true;
        }
      }
      if (burn > 0 && canSmelt && recipe) {
        cook++;
        if (cook >= cookTotal) {
          cook = 0;
          inv.set(0, input!.count > 1 ? { ...input!, count: input!.count - 1 } : null);
          inv.set(2, out ? { ...out, count: out.count + 1 } : { id: recipe.resultNum, count: 1, ...(cheat ? { tag: { admin: true } } : {}) });
          if (cheat) cheatXp += recipe.xp;
          else xp += recipe.xp;
          changed = true;
        }
      } else if (cook > 0) cook = Math.max(0, cook - 2);
      const lit = burn > 0;
      if ((getProp(state, 'lit') === 'true') !== lit) {
        dim.setBlock(x, y, z, withProp(state, 'lit', lit), { keepBlockEntity: true });
      }
      const nb = { ...be, type: 'furnace', burn, burnTotal, cook, cookTotal, xp, cheatXp, cheatFuel: be.cheatFuel ?? 0 };
      if (changed) this.persist(dim, x, y, z, inv, nb);
      else Object.assign(be, nb);
      // Update viewers
      for (const [pl, w] of this.windows) {
        if (w.pos && w.pos.dim === dim && w.pos.x === x && w.pos.y === y && w.pos.z === z && w.kind !== 'chest') {
          const props = { burn, burnTotal, cook, cookTotal };
          if (JSON.stringify(props) !== JSON.stringify(w.props)) {
            w.props = props;
            pl.send({ t: 'window_prop', window: w.id, prop: 'furnace', value: props });
          }
          if (changed) this.sync(pl);
        }
      }
      if (burn <= 0 && !canSmelt && cook === 0) this.activeFurnaces.delete(key);
    }
  }

  /** Forces a window refresh for all viewers of a container position. */
  refreshViewers(dim: Dimension, x: number, y: number, z: number): void {
    for (const [pl, w] of this.windows) if (w.pos && w.pos.dim === dim && w.pos.x === x && w.pos.y === y && w.pos.z === z) this.sync(pl);
  }

  isSurvivalPlayer(p: ServerPlayer): boolean {
    return isSurvivalLike(p.gamemode);
  }

  windowFor(p: ServerPlayer): Window | undefined {
    return this.windows.get(p);
  }

  forgetPlayer(p: ServerPlayer): void {
    this.windows.delete(p);
    this.playerCraft.delete(p);
  }

  sameStack(a: Slot, b: Slot): boolean {
    return sameItem(a, b);
  }

  empty(s: Slot): boolean {
    return isEmpty(s);
  }

  armorStart(): number {
    return ARMOR_START;
  }
}

