/**
 * V7 - The Halloween Update, phase 3: the server's side of candy and the
 * Trick-or-Treat Sack (the rules in src/common/halloween/candy.ts).
 *
 * - Eating candy (from the hand, or straight out of a sack): its effects,
 *   a King-Sized Candy's temporary enchantment or payout, a Poisoned Candy's
 *   sickness.
 * - The sack's contents change only here, and every change is checked
 *   against the sack as the server has it: taking candy out (only what fits
 *   in the inventory; the rest stays in), eating one, putting candy in from
 *   the inventory or by clicking candy onto the sack (or the sack onto candy)
 *   in any inventory window. Counts move, they are never copied, so there is
 *   no way to make or lose candy through the sack.
 * - Awards (Candy Homes, the Admin Panel): straight into the player's sacks;
 *   what does not fit goes to the inventory, then to the ground at their feet,
 *   with "Your sack is full!".
 * - Temporary enchantments: chosen within the normal limits (an enchantment
 *   the item can take, no conflicts, no curses, never above its maximum) and
 *   cleared off items once they run out, wherever the server finds them.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { OFFHAND, ARMOR_START } from '../player/Inventory';
import { items, itemById } from '../../common/registry/items';
import { stackOf, isAdminStack, markAdmin, itemIdOf, type ItemStack, type Slot } from '../../common/game/itemstack';
import { ENCHANTMENTS, romanNumeral } from '../../common/data/enchantments';
import { canApply, compatible } from '../../common/game/enchanting';
import { Random } from '../../common/math/rng';
import { ItemEntity } from '../entity/ItemEntity';
import {
  CANDY_ITEM,
  CANDY_KINDS,
  CANDY_OF_ITEM,
  KING_BUFFS,
  CANDY_FOOD,
  SACK_ID,
  SACK_CAPACITY,
  rollBite,
  sackContents,
  sackAdd,
  sackTake,
  sackTotal,
  sackRoom,
  withContents,
  type CandyKind,
  type SackContents,
} from '../../common/halloween/candy';
import { TEMP_ENCHANT_TICKS, stripExpiredTemp, activeTemp } from '../../common/halloween/tempEnchant';
import type { SackOp, SpeechTone } from '../../common/net/protocol';

/** How often (ticks) run-out temporary enchantments are cleared off items. */
const SWEEP_TICKS = 20;

export interface AwardResult {
  /** Candies that went into a sack, into the inventory, onto the ground. */
  inSack: number;
  inInventory: number;
  dropped: number;
}

export class CandySystem {
  /** Randomness (replaceable in tests). */
  rng: { next(): number; int(n: number): number } = new Random();
  private tickNo = 0;
  /** When each player may next eat one straight from a sack (server tick). */
  private readonly nextBite = new WeakMap<ServerPlayer, number>();

  constructor(private readonly server: GameServer) {}

  get sackNum(): number {
    return itemById.get(SACK_ID)!.num;
  }

  isSack(s: Slot | undefined): boolean {
    return !!s && s.id === this.sackNum;
  }

  kindOf(s: Slot | undefined): CandyKind | null {
    return s ? CANDY_OF_ITEM[itemIdOf(s)] ?? null : null;
  }

  say(p: ServerPlayer, text: string, tone: SpeechTone = 'info', who?: string, ticks = 60): void {
    p.send({ t: 'speech', text, tone, ticks, ...(who ? { who } : {}) });
  }

  // ------------------------------------------------------------------ eating

  /** A candy was eaten (from the hand, or a sack): its effects. `cheat`: a cheat-made candy (what it pays out is cheat-made too). */
  eat(p: ServerPlayer, kind: CandyKind, cheat: boolean): void {
    const s = this.server;
    const surv = s.interaction.survival;
    const bite = rollBite(kind, this.rng);
    for (const e of bite.effects) surv.addEffect(p, e.id, e.amp, e.ticks);
    if (bite.damage > 0) surv.damage(p, bite.damage, { source: 'magic' });
    if (bite.enchant) {
      const got = this.enchantSomething(p);
      if (got) this.say(p, `Your ${got.item} glows: ${got.ench} for 3:00!`, 'info');
      else {
        // Nothing that could take one: the strong buffs instead
        for (const e of KING_BUFFS) surv.addEffect(p, e.id, e.amp, e.ticks);
      }
    }
    if (bite.payout) {
      const st = stackOf(bite.payout.item, bite.payout.count);
      if (cheat || s.admin.inContext(p)) markAdmin(st);
      const rem = p.inventory.add(st);
      if (rem) s.mining.dropItem(p.dim, p.x, p.y + 0.3, p.z, rem);
      const name = items[st.id]!.def.name;
      this.say(p, `Something clinks inside the wrapper: ${bite.payout.count} ${name}${bite.payout.count > 1 && !name.endsWith('s') ? 's' : ''}!`, 'info');
      s.playSound(p.dim, 'pickup', p.x, p.y + 1, p.z, 0.6, 1.4);
    }
    if (kind === 'poisoned') {
      this.say(p, 'Ugh. That candy was poisoned.', 'warn');
      s.particles(p.dim, 'witch', p.x, p.y + 1.6, p.z, 10, 0.3);
    }
    p.addStat('eaten.' + CANDY_ITEM[kind]);
    p.statsDirty = true;
  }

  /**
   * A King-Sized Candy's gift: a temporary enchantment on the first thing that
   * can take one (the item in hand, the offhand, armour, then the hotbar).
   * Only an enchantment the item could have, that conflicts with none it has,
   * no curse, at most its maximum level; above the item's own level if it has
   * that one already. It replaces any temporary one there already.
   */
  enchantSomething(p: ServerPlayer): { item: string; ench: string } | null {
    const order = [p.selectedSlot, OFFHAND, ARMOR_START + 3, ARMOR_START + 2, ARMOR_START + 1, ARMOR_START, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => i !== p.selectedSlot)];
    for (const slot of order) {
      const st = p.inventory.get(slot);
      if (!st || st.count !== 1) continue;
      const def = items[st.id]!.def;
      if (!(def.enchantability && def.enchantability > 0) || itemIdOf(st) === 'book' || itemIdOf(st) === 'enchanted_book') continue;
      const own = st.tag?.ench ?? {};
      const options = ENCHANTMENTS.filter((e) => !e.curse && !e.exclusive && canApply(e, st) && (own[e.id] ?? 0) < e.maxLevel && Object.keys(own).every((k) => k === e.id || compatible(k, e.id)));
      if (!options.length) continue;
      const total = options.reduce((a, e) => a + e.weight, 0);
      let r = this.rng.next() * total;
      let pick = options[options.length - 1]!;
      for (const e of options) {
        r -= e.weight;
        if (r < 0) {
          pick = e;
          break;
        }
      }
      const lvl = Math.min(pick.maxLevel, (own[pick.id] ?? 0) + 1 + (this.rng.next() < 0.4 ? 1 : 0));
      const tag = { ...(st.tag ?? {}), temp: { id: pick.id, lvl, until: this.server.level.time + TEMP_ENCHANT_TICKS } };
      p.inventory.set(slot, { ...st, tag });
      this.server.interaction.syncInventory(p);
      return { item: def.name, ench: `${pick.name}${pick.maxLevel > 1 ? ' ' + romanNumeral(lvl) : ''}` };
    }
    return null;
  }

  // ------------------------------------------------------------------ the sack

  /** Reads a sack; writes it back with `fn`'s changes (the slot gets a new stack). */
  private edit(get: () => Slot, set: (s: Slot) => void, fn: (c: SackContents) => void): void {
    const sack = get();
    if (!sack || !this.isSack(sack)) return;
    const c = sackContents(sack);
    fn(c);
    set(withContents(sack, c));
  }

  /** A sack window action (C2S 'sack'). */
  handle(p: ServerPlayer, slot: number, op: SackOp, kind?: CandyKind, n = 1): void {
    if (p.dead || p.gamemode === 'spectator') return;
    const inv = p.inventory;
    const sack = inv.get(slot);
    if (!this.isSack(sack)) {
      this.server.interaction.syncInventory(p);
      return;
    }
    const get = (): Slot => inv.get(slot);
    const set = (s: Slot): void => inv.set(slot, s);
    if (op === 'fill') {
      const moved = this.fillFromInventory(p, slot);
      if (moved.full) this.say(p, 'Your sack is full!', 'warn');
      if (moved.n) this.server.playSound(p.dim, 'sack.insert', p.x, p.y + 1, p.z, 0.6, 1);
    } else if (op === 'take' && kind) {
      // Only as many as there is room for; the rest stays in the sack
      this.edit(get, set, (c) => {
        const want = Math.min(n, c.counts[kind]);
        if (want <= 0) return;
        const taken = sackTake(c, kind, want);
        let back = 0;
        for (const [k, cheat] of [
          [taken.legit, false],
          [taken.cheat, true],
        ] as const) {
          if (k <= 0) continue;
          const st = stackOf(CANDY_ITEM[kind], k);
          if (cheat) markAdmin(st);
          const rem = inv.add(st, [
            [0, 9],
            [9, 36],
          ]);
          if (rem) {
            back += rem.count;
            sackAdd(c, kind, rem.count, cheat);
          }
        }
        if (back === want) this.say(p, 'No room in your inventory.', 'warn');
        else this.server.playSound(p.dim, 'sack.remove', p.x, p.y + 1, p.z, 0.6, 1);
      });
    } else if (op === 'eat' && kind) {
      // As long as eating one from the hand takes (a modified client cannot eat a sackful at once)
      if (this.server.tickNo < (this.nextBite.get(p) ?? 0)) {
        this.server.interaction.syncInventory(p);
        return;
      }
      let ate: { cheat: boolean } | null = null;
      this.edit(get, set, (c) => {
        if (c.counts[kind] <= 0) return;
        const t = sackTake(c, kind, 1);
        ate = { cheat: t.cheat > 0 };
      });
      if (ate) {
        const f = CANDY_FOOD[kind];
        this.nextBite.set(p, this.server.tickNo + f.eatTime);
        this.server.interaction.survival.feed(p, f.hunger, f.saturation);
        this.server.playSound(p.dim, 'eat', p.x, p.y + 1.5, p.z, 0.5, 1.1);
        this.server.playSound(p.dim, 'burp', p.x, p.y + 1, p.z, 0.5, 1);
        this.eat(p, kind, (ate as { cheat: boolean }).cheat || isAdminStack(sack));
      }
    }
    this.server.interaction.syncInventory(p);
  }

  /** Every candy in the inventory (hotbar, main, offhand) into one sack, as much as fits. */
  fillFromInventory(p: ServerPlayer, slot: number): { n: number; full: boolean } {
    const inv = p.inventory;
    let n = 0;
    let full = false;
    this.edit(
      () => inv.get(slot),
      (s) => inv.set(slot, s),
      (c) => {
        for (let i = 0; i <= OFFHAND; i++) {
          if (i >= ARMOR_START && i < OFFHAND) continue;
          const st = inv.get(i);
          const kind = this.kindOf(st);
          if (!st || !kind) continue;
          const put = sackAdd(c, kind, st.count, isAdminStack(st));
          n += put;
          if (put < st.count) full = true;
          inv.set(i, st.count - put > 0 ? { ...st, count: st.count - put } : null);
          if (sackRoom(c) <= 0) {
            // Anything left over stays where it is
            for (let j = i + 1; j <= OFFHAND; j++) if (this.kindOf(inv.get(j)) && (j < ARMOR_START || j === OFFHAND)) full = true;
            break;
          }
        }
      },
    );
    return { n, full };
  }

  /**
   * An inventory click with candy on the cursor onto a sack (or a sack on the
   * cursor onto candy): left click moves all that fits, right click one.
   * Returns true when it was such a click (handled, even if nothing fitted).
   */
  click(p: ServerPlayer, get: () => Slot, set: (s: Slot) => void, button: number): boolean {
    const cur = get();
    const cursor = p.cursor;
    if (!cursor || !cur) return false;
    if (this.isSack(cur) && this.kindOf(cursor)) {
      const kind = this.kindOf(cursor)!;
      const want = button === 1 ? 1 : cursor.count;
      let put = 0;
      this.edit(get, set, (c) => (put = sackAdd(c, kind, want, isAdminStack(cursor))));
      if (put === 0) this.say(p, 'Your sack is full!', 'warn');
      else this.server.playSound(p.dim, 'sack.insert', p.x, p.y + 1, p.z, 0.6, 1);
      p.cursor = cursor.count - put > 0 ? { ...cursor, count: cursor.count - put } : null;
      return true;
    }
    if (this.isSack(cursor) && this.kindOf(cur)) {
      const kind = this.kindOf(cur)!;
      const want = button === 1 ? 1 : cur.count;
      const c = sackContents(cursor);
      const put = sackAdd(c, kind, want, isAdminStack(cur));
      if (put === 0) this.say(p, 'Your sack is full!', 'warn');
      else this.server.playSound(p.dim, 'sack.insert', p.x, p.y + 1, p.z, 0.6, 1);
      p.cursor = withContents(cursor, c);
      set(cur.count - put > 0 ? { ...cur, count: cur.count - put } : null);
      return true;
    }
    return false;
  }

  /** The player's sacks, in the order candy goes into them: the one in hand, the offhand, the hotbar, the rest. */
  sackSlots(p: ServerPlayer): number[] {
    const out: number[] = [];
    for (const i of [p.selectedSlot, OFFHAND, 0, 1, 2, 3, 4, 5, 6, 7, 8, ...Array.from({ length: 27 }, (_, k) => 9 + k)]) if (!out.includes(i) && this.isSack(p.inventory.get(i))) out.push(i);
    return out;
  }

  /** Room left in all the player's sacks together. */
  room(p: ServerPlayer): number {
    return this.sackSlots(p).reduce((a, i) => a + sackRoom(sackContents(p.inventory.get(i))), 0);
  }

  /** Whether the player carries a sack at all (room() says whether it has space). */
  hasSack(p: ServerPlayer): boolean {
    return this.sackSlots(p).length > 0;
  }

  /**
   * Candy given to a player (Candy Homes, Trick Home chests aside, the Admin
   * Panel): straight into their sacks; the overflow into the inventory, then
   * onto the ground at their feet, with "Your sack is full!".
   */
  award(p: ServerPlayer, kinds: CandyKind[], cheat: boolean): AwardResult {
    const inv = p.inventory;
    const res: AwardResult = { inSack: 0, inInventory: 0, dropped: 0 };
    const left: Record<CandyKind, number> = { regular: 0, big: 0, king: 0, poisoned: 0 };
    for (const k of kinds) left[k]++;
    for (const slot of this.sackSlots(p))
      this.edit(
        () => inv.get(slot),
        (s) => inv.set(slot, s),
        (c) => {
          for (const k of CANDY_KINDS) {
            const put = sackAdd(c, k, left[k], cheat);
            left[k] -= put;
            res.inSack += put;
          }
        },
      );
    const over = CANDY_KINDS.reduce((a, k) => a + left[k], 0);
    if (over > 0) {
      this.say(p, 'Your sack is full!', 'warn');
      for (const k of CANDY_KINDS) {
        if (!left[k]) continue;
        const st = stackOf(CANDY_ITEM[k], left[k]);
        if (cheat) markAdmin(st);
        const rem = inv.add(st);
        res.inInventory += left[k] - (rem?.count ?? 0);
        if (rem) {
          this.server.mining.dropItem(p.dim, p.x, p.y + 0.3, p.z, rem);
          res.dropped += rem.count;
        }
      }
    }
    this.server.interaction.syncInventory(p);
    return res;
  }

  /** A sack stack holding these candies (the Admin Panel's full sack). */
  makeSack(fill: Partial<Record<CandyKind, number>> = {}, cheat = false): ItemStack {
    const c = sackContents(null);
    for (const k of CANDY_KINDS) sackAdd(c, k, fill[k] ?? 0, cheat);
    const st = withContents(stackOf(SACK_ID), c);
    return cheat ? markAdmin(st) : st;
  }

  /** Candies of every kind in a player's sacks and inventory (honest ones only, for the quest). */
  honestCandy(p: ServerPlayer): number {
    let n = 0;
    for (let i = 0; i <= OFFHAND; i++) {
      const st = p.inventory.get(i);
      if (!st) continue;
      if (this.isSack(st)) {
        const c = sackContents(st);
        for (const k of CANDY_KINDS) n += c.counts[k] - c.cheat[k];
      } else if (this.kindOf(st) && !isAdminStack(st)) n += st.count;
    }
    return n;
  }

  /** A full sack (for "Sweet Tooth"): any honest sack at capacity. */
  fullSack(p: ServerPlayer): boolean {
    for (let i = 0; i <= OFFHAND; i++) {
      const st = p.inventory.get(i);
      if (this.isSack(st) && !isAdminStack(st)) {
        const c = sackContents(st);
        if (sackTotal(c) >= SACK_CAPACITY && CANDY_KINDS.every((k) => c.cheat[k] === 0)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ temporary enchantments

  tick(): void {
    if (++this.tickNo % SWEEP_TICKS !== 0) return;
    const s = this.server;
    for (const p of s.players.values()) {
      let changed = false;
      for (const inv of [p.inventory, p.enderChest])
        for (let i = 0; i < inv.size; i++) {
          const st = inv.get(i);
          if (st?.tag?.temp && stripExpiredTemp(st)) {
            inv.set(i, { ...st });
            changed = true;
          }
        }
      if (p.cursor?.tag?.temp && stripExpiredTemp(p.cursor)) changed = true;
      if (changed) {
        s.interaction.syncInventory(p);
        if (p.windowId !== 0) s.interaction.containers.sync(p);
      }
    }
    // Items on the ground lose the glint
    for (const dim of s.dims.values())
      for (const e of dim.entities.values()) if (e instanceof ItemEntity && e.stack.tag?.temp && stripExpiredTemp(e.stack)) e.metaDirty = true;
    s.interaction.containers.stripExpiredTemp();
  }

  /** Whether a stack shows the enchantment glint (its own enchantments, or a temporary one while it lasts). */
  static glints(s: Slot): boolean {
    return !!s && ((!!s.tag?.ench && Object.keys(s.tag.ench).length > 0) || !!activeTemp(s));
  }
}
