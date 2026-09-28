/**
 * Utility items and blocks that act on their own rules: firework rockets,
 * fishing, and (installed alongside) the compass, bell, jukebox, respawn
 * anchor, beacon, leads and riding helpers.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { type ItemStack, stackOf, markAdmin, toSaved, fromSaved, type SavedStack } from '../../common/game/itemstack';
import { blocks, STATE_BLOCK, getProp, withProp } from '../../common/registry/blocks';
import { Mob } from '../entity/Mob';
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
    if (id === 'compass' && p.dim.blockId(x, y, z) === 'lodestone') return this.linkLodestone(p, stack, x, y, z);
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

  // ------------------------------------------------------------------ compasses

  /** A compass used on a lodestone points at it from then on (in that dimension). */
  private linkLodestone(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number): boolean {
    const linked: ItemStack = { id: stack.id, count: 1, tag: { ...(stack.tag ?? {}), data: { ...(stack.tag?.data ?? {}), lodestone: [x, y, z], dim: p.dim.id } } };
    const slot = p.selectedSlot;
    const cur = p.inventory.get(slot);
    if (!cur || cur.id !== stack.id) return false;
    if (cur.count > 1 && p.gamemode !== 'creative') {
      p.inventory.set(slot, { ...cur, count: cur.count - 1 });
      const rem = p.inventory.add(linked);
      if (rem) this.server.interaction.dropStack(p, rem);
    } else p.inventory.set(slot, { ...cur, tag: linked.tag });
    this.server.playSound(p.dim, 'lodestone.lock', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  // ------------------------------------------------------------------ jukebox

  /** Playing jukeboxes: key "dim|x,y,z" -> track and who has been told. */
  private readonly records = new Map<string, { dim: Dimension; x: number; y: number; z: number; track: string; told: Set<ServerPlayer> }>();

  useJukebox(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const dim = p.dim;
    const be = dim.getBlockEntity(x, y, z);
    const stored = Array.isArray(be?.items) ? (be!.items as (SavedStack | null)[])[0] : null;
    if (stored) {
      // Eject the record
      dim.setBlockEntity(x, y, z, { type: 'jukebox', items: [null] });
      dim.setBlock(x, y, z, withProp(state, 'has_record', false));
      const st = fromSaved(stored);
      if (st) this.server.mining.dropItem(dim, x + 0.5, y + 1.1, z + 0.5, st);
      this.stopRecord(dim, x, y, z);
      return true;
    }
    const slot = p.selectedSlot;
    const held = p.inventory.get(slot);
    const def = held ? items[held.id]!.def : null;
    if (!held || def?.use !== 'music_disc') return false;
    const track = String(def.data?.track ?? 'meadow');
    dim.setBlockEntity(x, y, z, { type: 'jukebox', items: [toSaved({ ...held, count: 1 })] });
    dim.setBlock(x, y, z, withProp(state, 'has_record', true));
    if (p.gamemode !== 'creative') p.inventory.set(slot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    this.records.set(`${dim.id}|${x},${y},${z}`, { dim, x, y, z, track, told: new Set() });
    p.addStat('played_record');
    return true;
  }

  private stopRecord(dim: Dimension, x: number, y: number, z: number): void {
    const k = `${dim.id}|${x},${y},${z}`;
    const r = this.records.get(k);
    if (!r) return;
    for (const pl of r.told) pl.send({ t: 'record', x, y, z, track: null });
    this.records.delete(k);
  }

  // ------------------------------------------------------------------ respawn anchor & bell

  useRespawnAnchor(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const dim = p.dim;
    const charges = parseInt(getProp(state, 'charges') ?? '0', 10);
    const held = p.inventory.get(p.selectedSlot);
    if (held && items[held.id]!.id === 'glowstone' && charges < 4) {
      dim.setBlock(x, y, z, withProp(state, 'charges', charges + 1));
      if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
      this.server.playSound(dim, 'respawn_anchor.charge', x + 0.5, y + 0.5, z + 0.5, 1, 0.8 + charges * 0.1);
      this.server.particles(dim, 'portal', x + 0.5, y + 1, z + 0.5, 8, 0.4);
      return true;
    }
    if (charges === 0) return false;
    if (!dim.rules.respawnAnchorWorks) {
      // Anchors only hold in the Nether; anywhere else a charged one blows up
      dim.setBlock(x, y, z, 0);
      this.server.interaction.explode?.(dim, x + 0.5, y + 0.5, z + 0.5, 5, true, null);
      return true;
    }
    p.spawnPoint = { dim: dim.id, x: x + 0.5, y: y + 1, z: z + 0.5, forced: false, block: [x, y, z] };
    p.send({ t: 'chat', text: 'Respawn point set', kind: 'system' });
    this.server.playSound(dim, 'respawn_anchor.set', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  /**
   * Whether the bed or anchor a spawn point depends on still holds it (an
   * anchor spends one charge). Unloaded blocks are trusted.
   */
  claimSpawnBlock(p: ServerPlayer): boolean {
    const sp = p.spawnPoint;
    if (!sp?.block) return true;
    const dim = this.server.dim(sp.dim);
    const [x, y, z] = sp.block;
    if (!dim.isLoaded(x, z)) return true;
    const st = dim.getState(x, y, z);
    const id = blocks[STATE_BLOCK[st]!]!.id;
    if (id.endsWith('_bed')) return true;
    if (id !== 'respawn_anchor') return false;
    const charges = parseInt(getProp(st, 'charges') ?? '0', 10);
    if (charges <= 0) return false;
    dim.setBlock(x, y, z, withProp(st, 'charges', charges - 1));
    this.server.playSound(dim, 'respawn_anchor.set', x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
    return true;
  }

  /** Rings a bell: nearby villagers hurry, hidden monsters are revealed for a moment. */
  ringBell(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const s = this.server;
    const dim = p.dim;
    const now = s.tickNo;
    const k = `${dim.id}|${x},${y},${z}`;
    if ((this.bellRung.get(k) ?? -100) > now - 20) return true;
    this.bellRung.set(k, now);
    s.playSound(dim, 'bell.ring', x + 0.5, y + 0.5, z + 0.5, 3, 1);
    s.broadcastNear(dim, x, y, z, 48, { t: 'anim', id: -1, anim: 'swing' });
    for (const e of dim.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 32)) {
      if (!(e instanceof Mob) || e.dead) continue;
      if (e.def.category === 'monster') s.mobs?.glow(e, 60);
      else if (e.type === 'villager') {
        e.revengeTarget = null;
        e.data.alarmTicks = 200;
      }
    }
    p.addStat('bells_rung');
    return true;
  }
  private readonly bellRung = new Map<string, number>();

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
    // Jukeboxes: tell players who come within earshot; stop when the jukebox is gone
    if (s.tickNo % 20 === 0) {
      for (const [k, r] of this.records) {
        if (!r.dim.isLoaded(r.x, r.z) || r.dim.blockId(r.x, r.y, r.z) !== 'jukebox' || !r.dim.getBlockEntity(r.x, r.y, r.z)?.items || !(r.dim.getBlockEntity(r.x, r.y, r.z)!.items as unknown[])[0]) {
          for (const pl of r.told) pl.send({ t: 'record', x: r.x, y: r.y, z: r.z, track: null });
          this.records.delete(k);
          continue;
        }
        for (const pl of s.players.values()) {
          const near = pl.dim === r.dim && pl.distanceSq(r.x + 0.5, r.y + 0.5, r.z + 0.5) < 64 * 64;
          if (near && !r.told.has(pl)) {
            r.told.add(pl);
            pl.send({ t: 'record', x: r.x, y: r.y, z: r.z, track: r.track });
          } else if (!near && r.told.has(pl)) {
            r.told.delete(pl);
            pl.send({ t: 'record', x: r.x, y: r.y, z: r.z, track: null });
          }
        }
        for (const pl of r.told) if (!s.players.has(pl.conn.id)) r.told.delete(pl);
      }
    }
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
