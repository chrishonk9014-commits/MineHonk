/**
 * Utility items and blocks that act on their own rules: firework rockets,
 * fishing, and (installed alongside) the compass, bell, jukebox, respawn
 * anchor, beacon, leads and riding helpers.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { type ItemStack, stackOf, markAdmin } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import { Firework } from '../entity/Firework';
import { FishingBobber } from '../entity/FishingBobber';
import { ItemEntity } from '../entity/ItemEntity';
import { Random } from '../../common/math/rng';
import { rollLoot } from '../../common/game/loot';
import { enchantLevel } from '../../common/game/enchanting';
import { lookDir } from './Interaction';

export class Gadgets {
  private readonly rng = new Random();
  /** Cast fishing lines by player. */
  private readonly bobbers = new Map<ServerPlayer, FishingBobber>();

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ item use (in the air)

  useItem(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    const id = items[stack.id]!.id;
    switch (id) {
      case 'firework_rocket':
        return this.boost(p, stack, hand);
      case 'fishing_rod':
        return this.fish(p, stack, hand);
    }
    return false;
  }

  /** Right click on a block face with an item. */
  useOnBlock(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number, face: number): boolean {
    const id = items[stack.id]!.id;
    if (id === 'firework_rocket') {
      if (p.gliding) return this.boost(p, stack, 0);
      this.launch(p.dim, x + FACE_DX[face] + 0.5, y + FACE_DY[face] + 0.1, z + FACE_DZ[face] + 0.5, this.server.interaction.isCheat(p, stack));
      this.consumeHeld(p, stack);
      return true;
    }
    // Fishing rods act on the plain 'use' the client sends as well; handling both would cast and reel at once
    return false;
  }

  private consumeHeld(p: ServerPlayer, stack: ItemStack, hand: 0 | 1 = 0): void {
    if (p.gamemode === 'creative') return;
    const slot = hand === 1 ? 40 : p.selectedSlot;
    const cur = p.inventory.get(slot);
    if (cur && cur.id === stack.id) p.inventory.set(slot, cur.count > 1 ? { ...cur, count: cur.count - 1 } : null);
  }

  // ------------------------------------------------------------------ fireworks

  /** Launches a decorative rocket that bursts after about a second and a half. */
  launch(dim: Dimension, x: number, y: number, z: number, cheat = false): Firework {
    const f = new Firework(28 + this.rng.int(10), this.rng.int(360));
    f.setPos(x, y, z);
    f.vx = (this.rng.next() - 0.5) * 0.002;
    f.vz = (this.rng.next() - 0.5) * 0.002;
    f.admin = cheat;
    dim.addEntity(f);
    this.server.playSound(dim, 'firework.launch', x, y, z, 2, 1);
    return f;
  }

  /** While gliding, a rocket pushes the player along their look direction. */
  private boost(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    if (!p.gliding) return false;
    const ticks = 22;
    p.boostUntil = this.server.tickNo + ticks + 20;
    p.send({ t: 'boost', ticks });
    this.consumeHeld(p, stack, hand);
    this.server.playSound(p.dim, 'firework.launch', p.x, p.y, p.z, 2, 1.1);
    this.boosting.set(p, this.server.tickNo + ticks);
    return true;
  }
  private readonly boosting = new Map<ServerPlayer, number>();

  // ------------------------------------------------------------------ fishing

  private fish(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    const s = this.server;
    const cur = this.bobbers.get(p);
    if (cur && !cur.removed) {
      this.reel(p, cur, hand);
      return true;
    }
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const b = new FishingBobber(p, enchantLevel(stack, 'lure'), enchantLevel(stack, 'luck_of_the_sea'));
    b.setPos(ex + d[0] * 0.4, ey - 0.2 + d[1] * 0.4, ez + d[2] * 0.4);
    b.body.vx = d[0] * 0.9 + (this.rng.next() - 0.5) * 0.05 + p.body.vx;
    b.body.vy = d[1] * 0.9 + 0.15;
    b.body.vz = d[2] * 0.9 + (this.rng.next() - 0.5) * 0.05 + p.body.vz;
    b.admin = s.interaction.isCheat(p, stack);
    p.dim.addEntity(b);
    this.bobbers.set(p, b);
    s.playSound(p.dim, 'fishing.cast', p.x, p.y + 1.5, p.z, 0.6, 0.8 + this.rng.next() * 0.3);
    return true;
  }

  private reel(p: ServerPlayer, b: FishingBobber, hand: 0 | 1): void {
    const s = this.server;
    const slot = hand === 1 ? 40 : p.selectedSlot;
    if (b.biting) {
      const drops = rollLoot('gameplay/fishing', { rng: b.rng, luck: b.luck });
      for (const st of drops) {
        // The catch flies to the angler
        const it = new ItemEntity(b.admin ? markAdmin(st) : st);
        it.setPos(b.x, b.y + 0.2, b.z);
        const dx = p.x - b.x;
        const dy = p.y + 1 - b.y;
        const dz = p.z - b.z;
        it.body.vx = dx * 0.1;
        it.body.vy = dy * 0.1 + Math.sqrt(Math.hypot(dx, dy, dz)) * 0.08;
        it.body.vz = dz * 0.1;
        b.dim.addEntity(it);
        p.addStat('fish_caught');
      }
      s.mining.dropXp(p.dim, p.x, p.y + 0.5, p.z, 1 + this.rng.int(6), b.admin);
      s.interaction.damageStack(p, slot, 1);
    } else if (b.state === 'ground') s.interaction.damageStack(p, slot, 2);
    s.playSound(p.dim, 'fishing.reel', p.x, p.y + 1.5, p.z, 0.6, 1);
    b.remove();
    this.bobbers.delete(p);
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    // Lines snap when the angler walks off, changes item or dimension
    for (const [p, b] of this.bobbers) {
      const held = [p.inventory.get(p.selectedSlot), p.inventory.get(40)].some((st) => st && items[st.id]!.id === 'fishing_rod');
      if (b.removed || p.dead || p.dim !== b.dim || !s.players.has(p.conn.id) || !held || p.distanceSq(b.x, b.y, b.z) > 32 * 32) {
        b.remove();
        this.bobbers.delete(p);
      }
    }
    // Rocket trails behind boosted gliders
    for (const [p, until] of this.boosting) {
      if (s.tickNo > until || !p.gliding) {
        this.boosting.delete(p);
        continue;
      }
      if (s.tickNo % 2 === 0) s.particles(p.dim, 'firework_trail', p.x, p.y + 0.4, p.z, 2, 0.1);
    }
  }

  /** The bobber a player has out, if any (tests and the client line). */
  bobberOf(p: ServerPlayer): FishingBobber | undefined {
    return this.bobbers.get(p);
  }
}

export { stackOf };
