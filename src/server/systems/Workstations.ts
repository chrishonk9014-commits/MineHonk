/**
 * Enchanting tables, anvils, brewing stands, glass bottles and potions.
 * All costs and results are computed and validated server-side.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Window } from './Containers';
import { Inventory } from '../player/Inventory';
import { items, itemById } from '../../common/registry/items';
import { blocks, STATE_BLOCK, S, STATE_SOLID, STATE_FLUID, withProp, getProp } from '../../common/registry/blocks';
import { Random } from '../../common/math/rng';
import { selectEnchantments, tableCosts, canApply, compatible, enchantLevel } from '../../common/game/enchanting';
import { ENCHANT_BY_ID } from '../../common/data/enchantments';
import { stackOf, cloneStack, type ItemStack, type Slot, toSaved, fromSaved, type SavedStack, isAdminStack, markAdmin, maxDurability } from '../../common/game/itemstack';
import { POTION_BY_ID, brewResult, isIngredient } from '../../common/data/potions';
import type { C2S } from '../../common/net/protocol';
import { raycastBlocks } from '../../common/physics/raycast';
import { lookDir } from './Interaction';

const BREW_TIME = 400;

export class Workstations {
  private readonly rng = new Random();
  private readonly stands = new Map<string, { dim: Dimension; x: number; y: number; z: number; inv: Inventory }>();

  constructor(private readonly server: GameServer) {}

  /** Resumes brewing stands with pending work when their chunk loads. */
  onChunk(dim: Dimension, c: import('../../common/world/chunk').Chunk): void {
    for (const [k, be] of c.blockEntities) {
      if (be.type !== 'brewing' || !((be.brew as number) > 0 || (be.fuel as number) > 0)) continue;
      this.standInventory(dim, (c.cx << 4) + (k & 15), k >> 8, (c.cz << 4) + ((k >> 4) & 15));
    }
  }

  /** hooks.useBlock */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const def = blocks[STATE_BLOCK[state]!]!.def;
    switch (def.interact) {
      case 'enchanting':
        this.openEnchanting(p, x, y, z);
        return true;
      case 'anvil':
        this.openAnvil(p, x, y, z);
        return true;
      case 'brewing':
        this.openBrewing(p, x, y, z);
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ enchanting
  private bookshelves(dim: Dimension, x: number, y: number, z: number): number {
    const shelf = S('bookshelf');
    let n = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        // The block between the table and the shelf ring must be empty
        if (dim.getState(x + dx, y, z + dz) !== 0 || dim.getState(x + dx, y + 1, z + dz) !== 0) continue;
        for (const dy of [0, 1]) {
          if (dim.getState(x + dx * 2, y + dy, z + dz * 2) === shelf) n++;
          if (dx !== 0 && dz !== 0) {
            if (dim.getState(x + dx * 2, y + dy, z + dz) === shelf) n++;
            if (dim.getState(x + dx, y + dy, z + dz * 2) === shelf) n++;
          }
        }
      }
    return Math.min(15, n);
  }

  private enchantSeed(p: ServerPlayer): number {
    const pp = p as ServerPlayer & { enchantSeed?: number };
    if (pp.enchantSeed === undefined) pp.enchantSeed = (Math.random() * 0x7fffffff) | 0;
    return pp.enchantSeed;
  }

  private openEnchanting(p: ServerPlayer, x: number, y: number, z: number): void {
    const cont = this.server.interaction.containers;
    const dim = p.dim;
    const w = cont.allocWindow('enchanting', 'Enchant', 2);
    const inv = new Inventory(2);
    let offers: { cost: number; ench: Record<string, number> }[] = [];
    const refresh = (): void => {
      const item = inv.get(0);
      offers = [];
      if (item && !item.tag?.ench && (items[item.id]!.def.enchantability ?? (items[item.id]!.id === 'book' ? 1 : 0)) > 0 && item.count === 1) {
        const shelves = this.bookshelves(dim, x, y, z);
        const rng = new Random(this.enchantSeed(p));
        const costs = tableCosts(rng, shelves, items[item.id]!.def.enchantability ?? 1);
        costs.forEach((c, i) => {
          const r = new Random(this.enchantSeed(p) + i * 7919);
          const ench = c > 0 ? selectEnchantments(r, item, c) : {};
          offers.push({ cost: Object.keys(ench).length ? c : 0, ench });
        });
      }
      const lapis = inv.get(1)?.count ?? 0;
      w.props = {
        options: offers.map((o, i) => {
          const first = Object.entries(o.ench)[0];
          return { cost: o.cost, lapis: i + 1, hint: first ? { id: first[0], level: first[1] } : null, ok: o.cost > 0 && (p.gamemode === 'creative' || (p.xpLevel().level >= o.cost && lapis >= i + 1)) };
        }),
      };
    };
    w.refresh = refresh;
    const lapisId = itemById.get('lapis_lazuli')!.num;
    w.slots.push({ get: () => inv.get(0), set: (s) => (inv.set(0, s), refresh()), mayPlace: (s) => (items[s.id]!.def.enchantability ?? 0) > 0 || items[s.id]!.id === 'book', max: () => 1, group: 'input' });
    w.slots.push({ get: () => inv.get(1), set: (s) => (inv.set(1, s), refresh()), mayPlace: (s) => s.id === lapisId, max: () => 64, group: 'input' });
    (w as Window & { enchant?: (i: number) => void }).enchant = (i: number) => {
      const o = offers[i];
      const item = inv.get(0);
      if (!o || !item || o.cost <= 0) return;
      const creative = p.gamemode === 'creative';
      const lapis = inv.get(1);
      if (!creative && (p.xpLevel().level < o.cost || !lapis || lapis.count < i + 1)) return;
      const isBook = items[item.id]!.id === 'book';
      // Cheat items, lapis or levels make the result cheat-made too
      const cheat = isAdminStack(item) || isAdminStack(lapis) || p.cheat.xp > 0 || this.server.admin.inContext(p);
      const result: ItemStack = isBook ? { id: itemById.get('enchanted_book')!.num, count: 1, tag: { stored: { ...o.ench }, ...(cheat ? { admin: true } : {}) } } : { ...cloneStack(item), tag: { ...(item.tag ?? {}), ench: { ...o.ench }, ...(cheat ? { admin: true } : {}) } };
      inv.set(0, result);
      if (!creative) {
        inv.set(1, lapis!.count > i + 1 ? { ...lapis!, count: lapis!.count - (i + 1) } : null);
        this.removeLevels(p, i + 1);
      }
      (p as ServerPlayer & { enchantSeed?: number }).enchantSeed = (Math.random() * 0x7fffffff) | 0;
      this.server.playSound(dim, 'block.chime', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      this.server.particles(dim, 'magic_crit', x + 0.5, y + 1.2, z + 0.5, 20, 0.5);
      p.addStat('enchanted');
      if (!cheat) this.server.interaction.grant(p, 'enchant_item');
      refresh();
    };
    cont.addPlayerSlots(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = (pl) => this.returnItems(pl, inv);
    refresh();
    this.server.interaction.openCustomWindow(p, w);
  }

  private removeLevels(p: ServerPlayer, levels: number): void {
    const target = Math.max(0, p.xpLevel().level - levels);
    // Recompute total XP for the target level keeping progress at zero
    let total = 0;
    for (let l = 0; l < target; l++) total += xpForLevel(l);
    const lost = p.xpTotal - total;
    p.xpTotal = total;
    this.server.admin.onXpLost(p, lost);
    p.statsDirty = true;
  }

  private returnItems(p: ServerPlayer, inv: Inventory): void {
    for (let i = 0; i < inv.size; i++) {
      const s = inv.get(i);
      if (!s) continue;
      const rem = p.inventory.add(s);
      if (rem) this.server.interaction.dropStack(p, rem);
      inv.set(i, null);
    }
  }

  // ------------------------------------------------------------------ anvil
  private openAnvil(p: ServerPlayer, x: number, y: number, z: number): void {
    const cont = this.server.interaction.containers;
    const dim = p.dim;
    const w = cont.allocWindow('anvil', 'Repair & Name', 3);
    const inv = new Inventory(2);
    let name = '';
    let out: { stack: Slot; cost: number; material: number } = { stack: null, cost: 0, material: 0 };
    const refresh = (): void => {
      out = this.anvilResult(inv.get(0), inv.get(1), name);
      if (out.stack && (isAdminStack(inv.get(0)) || isAdminStack(inv.get(1)) || p.cheat.xp > 0 || this.server.admin.inContext(p))) out.stack = markAdmin({ ...out.stack });
      const creative = p.gamemode === 'creative';
      w.props = { cost: out.cost, tooExpensive: !creative && out.cost >= 40, name, affordable: creative || p.xpLevel().level >= out.cost };
    };
    w.refresh = refresh;
    w.slots.push({ get: () => inv.get(0), set: (s) => (inv.set(0, s), refresh()), mayPlace: () => true, max: (s) => items[s.id]!.maxStack, group: 'input' });
    w.slots.push({ get: () => inv.get(1), set: (s) => (inv.set(1, s), refresh()), mayPlace: () => true, max: (s) => items[s.id]!.maxStack, group: 'input' });
    w.slots.push({
      get: () => {
        const creative = p.gamemode === 'creative';
        if (!out.stack || out.cost <= 0) return null;
        if (!creative && (out.cost >= 40 || p.xpLevel().level < out.cost)) return null;
        return out.stack;
      },
      set: () => {},
      mayPlace: () => false,
      max: (s) => items[s.id]!.maxStack,
      output: true,
      group: 'result',
      onTake: () => {
        if (p.gamemode !== 'creative') this.removeLevels(p, out.cost);
        inv.set(0, null);
        const right = inv.get(1);
        if (right) inv.set(1, out.material > 0 && right.count > out.material ? { ...right, count: right.count - out.material } : null);
        name = '';
        // The anvil wears down
        if (p.gamemode !== 'creative' && this.rng.chance(0.12)) {
          const st = dim.getState(x, y, z);
          const id = blocks[STATE_BLOCK[st]!]!.id;
          const next = id === 'anvil' ? 'chipped_anvil' : id === 'chipped_anvil' ? 'damaged_anvil' : null;
          if (next) dim.setBlock(x, y, z, withProp(S(next), 'facing', getProp(st, 'facing') ?? 'north'));
          else {
            dim.setBlock(x, y, z, 0);
            this.server.interaction.closeWindow(p, w.id);
          }
          this.server.playSound(dim, 'anvil.land', x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
        } else this.server.playSound(dim, 'smithing', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        refresh();
      },
    });
    (w as Window & { rename?: (n: string) => void }).rename = (n: string) => {
      name = n.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 35);
      refresh();
    };
    cont.addPlayerSlots(w, p);
    w.pos = { dim, x, y, z };
    w.onClose = (pl) => this.returnItems(pl, inv);
    refresh();
    this.server.interaction.openCustomWindow(p, w);
  }

  /** Classic-style anvil combination rules (simplified). */
  anvilResult(left: Slot, right: Slot, name: string): { stack: Slot; cost: number; material: number } {
    if (!left) return { stack: null, cost: 0, material: 0 };
    const ldef = items[left.id]!;
    const result: ItemStack = cloneStack(left);
    let cost = 0;
    let material = 0;
    const baseCost = left.tag?.repairCost ?? 0;
    if (right) {
      const rdef = items[right.id]!;
      const maxDur = maxDurability(left);
      // The repair material is an item id or an item tag (planks; V6: either membrane for Elytra)
      const rep = ldef.def.repair;
      if (maxDur > 0 && rep && (rdef.id === rep || rdef.tags.has(rep))) {
        // Repair with material: each unit restores a quarter
        let dmg = left.damage ?? 0;
        if (dmg <= 0) return { stack: null, cost: 0, material: 0 };
        let used = 0;
        while (dmg > 0 && used < right.count) {
          dmg = Math.max(0, dmg - Math.floor(maxDur / 4));
          used++;
        }
        result.damage = dmg || undefined;
        cost += used;
        material = used;
      } else if (right.id === left.id || rdef.id === 'enchanted_book') {
        // Combine durability
        if (maxDur > 0 && right.id === left.id) {
          const remain = maxDur - (left.damage ?? 0) + (maxDur - (right.damage ?? 0)) + Math.floor(maxDur * 0.12);
          const dmg = Math.max(0, maxDur - remain);
          result.damage = dmg || undefined;
          if ((left.damage ?? 0) > 0) cost += 2;
        }
        // Merge enchantments
        const src = rdef.id === 'enchanted_book' ? right.tag?.stored ?? {} : right.tag?.ench ?? {};
        const isBook = ldef.id === 'enchanted_book';
        const into: Record<string, number> = { ...(isBook ? left.tag?.stored ?? {} : left.tag?.ench ?? {}) };
        let any = false;
        for (const [id, lvl] of Object.entries(src)) {
          const e = ENCHANT_BY_ID.get(id);
          if (!e) continue;
          if (!isBook && !canApply(e, left)) continue;
          if (Object.keys(into).some((k) => k !== id && !compatible(k, id))) {
            cost += 1;
            continue;
          }
          const cur = into[id] ?? 0;
          const next = cur === lvl ? Math.min(e.maxLevel, lvl + 1) : Math.max(cur, lvl);
          if (next !== cur) any = true;
          into[id] = next;
          cost += next * (rdef.id === 'enchanted_book' ? 1 : 2);
        }
        if (!any && !(maxDur > 0 && (left.damage ?? 0) > 0)) return { stack: null, cost: 0, material: 0 };
        result.tag = { ...(result.tag ?? {}), ...(isBook ? { stored: into } : { ench: into }) };
        material = 1;
      } else return { stack: null, cost: 0, material: 0 };
    }
    const cleanName = name.trim();
    const curName = left.tag?.name ?? '';
    if (cleanName && cleanName !== curName) {
      result.tag = { ...(result.tag ?? {}), name: cleanName };
      cost += 1;
    } else if (!cleanName && curName && !right) {
      const t = { ...(result.tag ?? {}) };
      delete t.name;
      result.tag = Object.keys(t).length ? t : undefined;
      cost += 1;
    }
    if (cost === 0) return { stack: null, cost: 0, material: 0 };
    cost += baseCost;
    result.tag = { ...(result.tag ?? {}), repairCost: baseCost * 2 + 1 };
    return { stack: result, cost, material };
  }

  // ------------------------------------------------------------------ brewing
  private standKey(dim: Dimension, x: number, y: number, z: number): string {
    return `${dim.id}:${x},${y},${z}`;
  }

  private standInventory(dim: Dimension, x: number, y: number, z: number): Inventory {
    const key = this.standKey(dim, x, y, z);
    const cur = this.stands.get(key);
    if (cur) return cur.inv;
    const inv = new Inventory(5);
    const be = dim.getBlockEntity(x, y, z) as { items?: (SavedStack | null)[] } | undefined;
    if (be?.items) for (let i = 0; i < 5; i++) inv.slots[i] = fromSaved(be.items[i]);
    this.stands.set(key, { dim, x, y, z, inv });
    return inv;
  }

  private persistStand(dim: Dimension, x: number, y: number, z: number, inv: Inventory, extra: Record<string, number> = {}): void {
    const be = (dim.getBlockEntity(x, y, z) ?? { type: 'brewing' }) as Record<string, unknown> & { type: string };
    be.type = 'brewing';
    be.items = inv.slots.map(toSaved);
    Object.assign(be, extra);
    dim.setBlockEntity(x, y, z, be);
  }

  private openBrewing(p: ServerPlayer, x: number, y: number, z: number): void {
    const cont = this.server.interaction.containers;
    const dim = p.dim;
    const inv = this.standInventory(dim, x, y, z);
    const w = cont.allocWindow('brewing', 'Brewing Stand', 5);
    const bottleOk = (s: ItemStack): boolean => ['potion', 'splash_potion', 'glass_bottle'].includes(items[s.id]!.id);
    const save = (): void => this.persistStand(dim, x, y, z, inv);
    for (let i = 0; i < 3; i++) w.slots.push({ get: () => inv.get(i), set: (s) => (inv.set(i, s), save()), mayPlace: bottleOk, max: () => 1, group: 'input' });
    w.slots.push({ get: () => inv.get(3), set: (s) => (inv.set(3, s), save()), mayPlace: (s) => isIngredient(items[s.id]!.id), max: (s) => items[s.id]!.maxStack, group: 'input' });
    w.slots.push({ get: () => inv.get(4), set: (s) => (inv.set(4, s), save()), mayPlace: (s) => items[s.id]!.id === 'blaze_powder', max: () => 64, group: 'fuel' });
    const be = dim.getBlockEntity(x, y, z) as Record<string, number> | undefined;
    w.props = { brew: be?.brew ?? 0, fuel: be?.fuel ?? 0 };
    cont.addPlayerSlots(w, p);
    w.pos = { dim, x, y, z };
    this.server.interaction.openCustomWindow(p, w);
  }

  /** Ticks brewing stands that are loaded and have work. */
  tick(): void {
    for (const [key, st] of this.stands) {
      const { dim, x, y, z, inv } = st;
      if (!dim.isLoaded(x, z) || blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.def.interact !== 'brewing') {
        this.stands.delete(key);
        continue;
      }
      const be = (dim.getBlockEntity(x, y, z) ?? { type: 'brewing' }) as Record<string, number>;
      let fuel = be.fuel ?? 0;
      let brew = be.brew ?? 0;
      const ingredient = inv.get(3);
      const canBrew = !!ingredient && this.brewable(inv);
      // Refuel with blaze powder
      if (fuel <= 0 && canBrew) {
        const f = inv.get(4);
        if (f && items[f.id]!.id === 'blaze_powder') {
          inv.set(4, f.count > 1 ? { ...f, count: f.count - 1 } : null);
          fuel = 20;
          be.cheatFuel = isAdminStack(f) ? 1 : 0;
        }
      }
      let changed = false;
      if (canBrew && fuel > 0) {
        if (brew <= 0) {
          brew = BREW_TIME;
          fuel--;
        }
        brew--;
        changed = true;
        if (brew <= 0) {
          this.finishBrew(inv, be.cheatFuel === 1);
          this.server.playSound(dim, 'drink', x + 0.5, y + 0.5, z + 0.5, 0.6, 1.4);
        }
      } else if (brew > 0) {
        brew = 0;
        changed = true;
      }
      if (changed || fuel !== (be.fuel ?? 0)) {
        this.persistStand(dim, x, y, z, inv, { fuel, brew, cheatFuel: be.cheatFuel ?? 0 });
        for (const p of this.server.players.values()) {
          const w = this.server.interaction.containers.windowOf(p);
          if (w.kind === 'brewing' && w.pos && w.pos.x === x && w.pos.y === y && w.pos.z === z && w.pos.dim === dim) {
            p.send({ t: 'window_prop', window: w.id, prop: 'all', value: { brew, brewTotal: BREW_TIME, fuel } });
            if (brew <= 0) this.server.interaction.containers.sync(p);
          }
        }
      }
    }
  }

  private brewable(inv: Inventory): boolean {
    const ing = inv.get(3);
    if (!ing) return false;
    const iid = items[ing.id]!.id;
    for (let i = 0; i < 3; i++) {
      const b = inv.get(i);
      if (!b) continue;
      const bid = items[b.id]!.id;
      if (bid === 'glass_bottle') continue;
      if (iid === 'gunpowder' && bid === 'potion') return true;
      if (brewResult(b.tag?.potion ?? 'water', iid)) return true;
    }
    return false;
  }

  private finishBrew(inv: Inventory, cheatFuel = false): void {
    const ing = inv.get(3)!;
    const iid = items[ing.id]!.id;
    // A cheat ingredient or fuel makes every brewed potion cheat-made
    const cheat = cheatFuel || isAdminStack(ing);
    for (let i = 0; i < 3; i++) {
      const b = inv.get(i);
      if (!b) continue;
      const bid = items[b.id]!.id;
      if (bid === 'glass_bottle') continue;
      if (iid === 'gunpowder') {
        if (bid === 'potion') inv.set(i, { id: itemById.get('splash_potion')!.num, count: 1, tag: { ...(b.tag ?? {}), ...(cheat ? { admin: true } : {}) } });
        continue;
      }
      const r = brewResult(b.tag?.potion ?? 'water', iid);
      if (r) inv.set(i, { ...b, tag: { ...(b.tag ?? {}), potion: r, ...(cheat ? { admin: true } : {}) } });
    }
    inv.set(3, ing.count > 1 ? { ...ing, count: ing.count - 1 } : null);
  }

  // ------------------------------------------------------------------ bottles & potions
  /** hooks.useItemOnBlock / useItem: fill bottles from water. */
  fillBottle(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]!.id !== 'glass_bottle') return false;
    const [ex, ey, ez] = this.server.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const hit = raycastBlocks(p.dim, ex, ey, ez, d[0], d[1], d[2], 5, { fluids: true });
    if (!hit || STATE_FLUID[hit.state] !== 1) return false;
    const water: ItemStack = { ...stackOf('potion', 1), tag: { potion: 'water' } };
    if (p.gamemode !== 'creative') {
      p.inventory.set(p.selectedSlot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
      const rem = p.inventory.add(water);
      if (rem) this.server.interaction.dropStack(p, rem);
    }
    this.server.playSound(p.dim, 'bucket.fill', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0.6, 1.4);
    return true;
  }

  /** Applies a potion's effects to a player (drinking or splash with a strength factor). */
  applyPotion(p: ServerPlayer, potionId: string, factor = 1): void {
    const def = POTION_BY_ID.get(potionId);
    if (!def) return;
    const sv = this.server.interaction.survival;
    for (const e of def.effects) {
      if (e.id === 'instant_health' || e.id === 'instant_damage') {
        if (e.id === 'instant_health') sv.heal(p, Math.round((4 << e.amp) * factor));
        else sv.damage(p, Math.round((6 << e.amp) * factor), { source: 'magic' });
        continue;
      }
      const ticks = Math.round(e.duration * factor);
      if (ticks > 20) sv.addEffect(p, e.id, e.amp, ticks);
    }
  }

  /** Throws a splash potion. */
  throwSplash(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]!.id !== 'splash_potion' || !this.server.mobs) return false;
    const [ex, ey, ez] = this.server.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const pr = this.server.mobs.projectile(p.dim, 'potion', ex + d[0] * 0.3, ey - 0.1, ez + d[2] * 0.3, p);
    pr.shoot(d[0], d[1] + 0.15, d[2], 0.6, 1, () => this.rng.next());
    pr.potion = cloneStack(stack);
    pr.data = { potion: stack.tag?.potion ?? 'water' };
    if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
    this.server.playSound(p.dim, 'bow.shoot', p.x, p.y + 1.5, p.z, 0.5, 0.4);
    return true;
  }

  /** hooks.windowAction for 'enchant' and 'rename'. */
  windowAction(p: ServerPlayer, m: C2S): void {
    const w = this.server.interaction.containers.windowOf(p) as Window & { enchant?: (i: number) => void; rename?: (n: string) => void };
    if (w.id === 0 || w.id !== p.windowId) return;
    if (m.t === 'enchant' && w.enchant && Number.isInteger(m.option) && m.option >= 0 && m.option < 3) w.enchant(m.option);
    else if (m.t === 'rename' && w.rename && typeof m.name === 'string') w.rename(m.name);
    else return;
    this.server.interaction.containers.sync(p);
  }
}

function xpForLevel(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

export { enchantLevel, STATE_SOLID };
