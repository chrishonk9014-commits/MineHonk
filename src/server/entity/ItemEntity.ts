/** Dropped item stack in the world. */
import { Entity } from './Entity';
import { moveBody, updateEnvironment } from '../../common/physics/movement';
import { type ItemStack, canStack, maxStack, toSaved, fromSaved, type SavedStack, itemIdOf, markAdmin } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import type { ServerPlayer } from '../player/ServerPlayer';
import { STATE_FLUID, blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { beltUnder } from '../../common/engineering/conveyor';
import { isEnderAlloy } from '../../common/endExpansion/resources';

export const ITEM_DESPAWN_TICKS = 6000;

export class ItemEntity extends Entity {
  readonly type = 'item';
  pickupDelay = 10;
  /** Only this player may pick it up until the delay passes (thrown items). */
  owner: string | null = null;
  health = 5;

  constructor(public stack: ItemStack) {
    super(0.25, 0.25);
    this.persistent = true;
    this.body.stepHeight = 0;
  }

  override meta(): Record<string, unknown> {
    return { item: this.stack.id, count: this.stack.count, ench: !!this.stack.tag?.ench };
  }

  override tick(): void {
    super.tick();
    const b = this.body;
    if (this.pickupDelay > 0) this.pickupDelay--;
    updateEnvironment(this.dim, b, 0.1);
    if (b.inWater) {
      b.vy += 0.01;
      b.vx *= 0.99;
      b.vz *= 0.99;
      if (b.vy > 0.06) b.vy = 0.06;
    } else if (b.inLava) {
      const fireproof = items[this.stack.id]?.def.fireResistant;
      if (fireproof) b.vy += 0.03;
      else {
        this.dim.server.playSound(this.dim, 'fizz', this.x, this.y, this.z, 0.4, 2);
        this.remove();
        return;
      }
    } else b.vy -= 0.04;
    // V5: carried along by conveyors (and handed to whatever the belt points into)
    const belt = b.onGround ? beltUnder(this.dim, b.x, b.y, b.z) : null;
    if (belt) {
      this.age = Math.min(this.age, ITEM_DESPAWN_TICKS - 1200);
      this.pickupDelay = Math.max(this.pickupDelay, 2);
      moveBody(this.dim, b, b.vx + belt.px, b.vy, b.vz + belt.pz);
      if (this.dim.server.engineering?.onBelt(this, belt)) return;
    } else {
      const moving = Math.abs(b.vx) > 1e-4 || Math.abs(b.vy) > 1e-4 || Math.abs(b.vz) > 1e-4 || !b.onGround;
      if (moving) moveBody(this.dim, b, b.vx, b.vy, b.vz);
    }
    const f = b.onGround ? (blocks[STATE_BLOCK[this.dim.getState(Math.floor(b.x), Math.floor(b.y - 0.99), Math.floor(b.z))]!]!.def.slipperiness ?? 0.6) * 0.98 : 0.98;
    b.vx *= f;
    b.vz *= f;
    b.vy *= 0.98;
    if (b.onGround && b.vy < 0) b.vy *= -0.5;
    if (b.onGround && this.age % 10 === 0) this.lastGround = { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
    if (b.y < -64) {
      // V6: Ender Alloy comes back out of the void, onto the nearest safe ground
      if (isEnderAlloy(itemIdOf(this.stack)) && this.returnFromVoid()) return;
      this.remove();
      return;
    }
    // Merge with nearby identical stacks
    if (this.age % 20 === 0 && this.stack.count < maxStack(this.stack)) {
      for (const o of this.dim.entitiesNear(this.x, this.y, this.z, 0.75)) {
        if (o === this || !(o instanceof ItemEntity) || o.removed) continue;
        if (!canStack(o.stack, this.stack)) continue;
        const space = maxStack(this.stack) - this.stack.count;
        const n = Math.min(space, o.stack.count);
        if (n <= 0) continue;
        this.stack.count += n;
        o.stack.count -= n;
        this.metaDirty = true;
        o.metaDirty = true;
        if (o.stack.count <= 0) o.remove();
        this.age = Math.min(this.age, o.age);
      }
    }
    if (this.age >= ITEM_DESPAWN_TICKS) this.remove();
    // Burn in fire
    const inside = this.dim.getState(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z));
    if (STATE_FLUID[inside] === 0 && blocks[STATE_BLOCK[inside]!]!.def.model === 'fire' && !items[this.stack.id]?.def.fireResistant) this.remove();
  }

  /** Where it last lay on the ground (for Ender Alloy's way back out of the void). */
  private lastGround: { x: number; y: number; z: number } | null = null;

  /**
   * Puts an Ender Alloy item that fell into the void back on the nearest safe
   * ground (or where it last lay); with nowhere loaded to go yet, it waits
   * just above the void's floor and tries again.
   */
  private returnFromVoid(): boolean {
    const b = this.body;
    const spot = this.dim.server.endMobs?.groundNear(this.dim, b.x, b.z, 48) ?? this.lastGround;
    b.vx = b.vy = b.vz = 0;
    if (!spot) {
      b.y = -63;
      return true;
    }
    this.setPos(spot.x + 0.5, spot.y + 0.1, spot.z + 0.5);
    this.dim.server.particles(this.dim, 'portal', spot.x + 0.5, spot.y + 0.4, spot.z + 0.5, 20, 0.4);
    this.dim.server.playSound(this.dim, 'teleport', spot.x + 0.5, spot.y, spot.z + 0.5, 0.6, 1.4);
    return true;
  }

  /** Attempts pickup by a player; returns true if anything was collected. */
  tryPickup(p: ServerPlayer): boolean {
    if (this.removed || this.pickupDelay > 0) return false;
    if (this.owner && this.owner !== p.uuid && this.age < 200) return false;
    // Items picked up under a cheat (e.g. at a place reached by a cheat teleport) are cheat-made
    if (this.admin || this.dim.server.admin.inContext(p)) markAdmin(this.stack);
    const before = this.stack.count;
    const rem = p.inventory.add(this.stack, [[0, 9], [9, 36], [40, 41]]);
    const taken = before - (rem?.count ?? 0);
    if (taken <= 0) return false;
    p.addStat('picked.' + itemIdOf(this.stack), taken);
    this.dim.server.broadcastNear(this.dim, this.x, this.y, this.z, 32, { t: 'take_item', item: this.id, by: p.id });
    this.dim.server.playSound(this.dim, 'pop', this.x, this.y, this.z, 0.2, 1.4 + Math.random() * 0.6);
    if (!rem) this.remove();
    else {
      this.stack = rem;
      this.metaDirty = true;
    }
    this.dim.server.interaction.onItemPickedUp(p, this.stack);
    return true;
  }

  override save(): Record<string, unknown> | null {
    return { type: 'item', x: this.x, y: this.y, z: this.z, item: toSaved(this.stack), age: this.age };
  }

  static load(d: Record<string, unknown>): ItemEntity | null {
    const s = fromSaved(d.item as SavedStack);
    if (!s) return null;
    const e = new ItemEntity(s);
    e.setPos(Number(d.x) || 0, Number(d.y) || 0, Number(d.z) || 0);
    e.age = Math.max(0, Number(d.age) || 0);
    e.pickupDelay = 0;
    return e;
  }
}

/** Experience orb. */
export class XpOrb extends Entity {
  readonly type = 'xp_orb';
  constructor(public value: number) {
    super(0.5, 0.5);
    this.body.stepHeight = 0;
  }

  override meta(): Record<string, unknown> {
    return { value: this.value };
  }

  override tick(): void {
    super.tick();
    const b = this.body;
    b.vy -= 0.03;
    // Seek nearest player within 8 blocks
    let best: ServerPlayer | null = null;
    let bd = 64;
    for (const p of this.dim.server.players.values()) {
      if (p.dim !== this.dim || p.dead || p.gamemode === 'spectator') continue;
      const d = p.distanceSq(this.x, this.y + 0.5, this.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      const dx = best.x - this.x;
      const dy = best.y + 0.9 - this.y;
      const dz = best.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const f = 1 - d / 8;
      if (f > 0) {
        b.vx += (dx / d) * f * f * 0.1;
        b.vy += (dy / d) * f * f * 0.1;
        b.vz += (dz / d) * f * f * 0.1;
      }
      if (d < 1.2 && this.age > 5) {
        this.dim.server.interaction.survival.giveXp(best, this.value, true, this.admin);
        this.dim.server.playSound(this.dim, 'orb', this.x, this.y, this.z, 0.2, 0.6 + Math.random() * 0.8);
        this.remove();
        return;
      }
    }
    moveBody(this.dim, b, b.vx, b.vy, b.vz);
    b.vx *= b.onGround ? 0.58 : 0.98;
    b.vz *= b.onGround ? 0.58 : 0.98;
    b.vy *= 0.98;
    if (this.age > 6000 || b.y < -64) this.remove();
  }
}

/** Splits an XP amount into orb values (classic denominations). */
export function splitXp(total: number): number[] {
  const out: number[] = [];
  const denoms = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  let rem = Math.floor(total);
  while (rem > 0 && out.length < 40) {
    const d = denoms.find((v) => v <= rem)!;
    out.push(d);
    rem -= d;
  }
  if (rem > 0) out[out.length - 1]! += rem;
  return out;
}
