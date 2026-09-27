/**
 * Authoritative player inventory.
 * Slots: 0-8 hotbar, 9-35 main, 36-39 armor (feet, legs, chest, head), 40 offhand.
 */
import { type ItemStack, type Slot, canStack, cloneStack, maxStack, isEmpty, toSaved, fromSaved, type SavedStack } from '../../common/game/itemstack';

export const HOTBAR_START = 0;
export const MAIN_START = 9;
export const ARMOR_START = 36;
export const OFFHAND = 40;
export const INVENTORY_SIZE = 41;
export const ARMOR_SLOTS = { feet: 36, legs: 37, chest: 38, head: 39 } as const;

export class Inventory {
  readonly slots: Slot[];
  /** Slot indices changed since last sync. */
  readonly changed = new Set<number>();

  constructor(readonly size: number) {
    this.slots = new Array(size).fill(null);
  }

  get(i: number): Slot {
    return this.slots[i] ?? null;
  }

  set(i: number, s: Slot): void {
    if (i < 0 || i >= this.size) return;
    this.slots[i] = isEmpty(s) ? null : s;
    this.changed.add(i);
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.set(i, null);
  }

  /**
   * Adds as much of the stack as possible to the given slot ranges (in order).
   * Returns the remainder (null when everything fitted). Does not mutate input.
   */
  add(stack: ItemStack, ranges: [number, number][] = [[0, 9], [9, 36]]): Slot {
    let rem: Slot = cloneStack(stack);
    // merge into existing stacks first
    for (const [a, b] of ranges) {
      for (let i = a; i < b && rem; i++) {
        const s = this.slots[i];
        if (s && canStack(s, rem)) {
          const space = maxStack(s) - s.count;
          if (space <= 0) continue;
          const n = Math.min(space, rem.count);
          s.count += n;
          rem.count -= n;
          this.changed.add(i);
          if (rem.count <= 0) rem = null;
        }
      }
    }
    for (const [a, b] of ranges) {
      for (let i = a; i < b && rem; i++) {
        if (!this.slots[i]) {
          const n = Math.min(maxStack(rem), rem.count);
          this.slots[i] = { ...cloneStack(rem), count: n };
          rem.count -= n;
          this.changed.add(i);
          if (rem.count <= 0) rem = null;
        }
      }
    }
    return rem;
  }

  /** How many of `stack` could be added. */
  canFit(stack: ItemStack, ranges: [number, number][] = [[0, 9], [9, 36]]): number {
    let free = 0;
    for (const [a, b] of ranges) {
      for (let i = a; i < b; i++) {
        const s = this.slots[i];
        if (!s) free += maxStack(stack);
        else if (canStack(s, stack)) free += maxStack(s) - s.count;
      }
    }
    return Math.min(free, stack.count);
  }

  count(id: number, ranges: [number, number][] = [[0, 36], [OFFHAND, OFFHAND + 1]]): number {
    let n = 0;
    for (const [a, b] of ranges) for (let i = a; i < b && i < this.size; i++) if (this.slots[i]?.id === id) n += this.slots[i]!.count;
    return n;
  }

  /** Removes up to n items with id; returns number removed. */
  remove(id: number, n: number, ranges: [number, number][] = [[0, 36], [OFFHAND, OFFHAND + 1]]): number {
    let removed = 0;
    for (const [a, b] of ranges) {
      for (let i = a; i < b && i < this.size && removed < n; i++) {
        const s = this.slots[i];
        if (s?.id !== id) continue;
        const k = Math.min(s.count, n - removed);
        s.count -= k;
        removed += k;
        if (s.count <= 0) this.slots[i] = null;
        this.changed.add(i);
      }
    }
    return removed;
  }

  firstEmpty(a = 0, b = 36): number {
    for (let i = a; i < b; i++) if (!this.slots[i]) return i;
    return -1;
  }

  save(): (SavedStack | null)[] {
    return this.slots.map(toSaved);
  }

  load(data: unknown): void {
    this.clear();
    if (!Array.isArray(data)) return;
    for (let i = 0; i < Math.min(data.length, this.size); i++) this.slots[i] = fromSaved(data[i] as SavedStack);
    for (let i = 0; i < this.size; i++) this.changed.add(i);
  }
}
