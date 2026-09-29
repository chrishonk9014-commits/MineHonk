/**
 * The hidden endgame (V3).
 *
 * - The mysterious potion (found in witch's hut chests) is used on mobs.
 *   Most react strangely and harmlessly; an Enderman is changed for good:
 *   it becomes Voidbound and, in the End, hunts the Ender Dragon.
 * - A Voidbound Enderman blinks up beside the flying dragon to strike it and
 *   fights it on the ground while it perches. While any pillar crystal
 *   stands its blows can't finish the dragon.
 * - If it lands the killing blow with every crystal destroyed, the End
 *   breaks: the world falls silent, glitches, corrupts, fails, and everyone
 *   there is thrown back to the stronghold they came from. The potion's user
 *   receives the Corrupted Eye, the only legitimate way to get one.
 *
 * Nothing here is ever explained to the player.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Entity } from '../entity/Entity';
import type { Dimension } from '../world/Dimension';
import { stackOf, markAdmin, isAdminStack, type ItemStack } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { STATE_SOLID } from '../../common/registry/blocks';
import { Mob } from '../entity/Mob';
import { Random } from '../../common/math/rng';
import { exitPortalY, type EndGenerator } from '../../common/gen/end';
import type { DragonFight } from './TheEnd';

/** Health of a Voidbound Enderman (a normal one has 40). */
export const VOID_HEALTH = 80;
/** Damage of each of its blows against the dragon. */
export const STRIKE_DAMAGE = 12;
const PERCH_STRIKE_EVERY = 25;
const BLINK_EVERY = 70;
/** Ticks it hangs in the air beside the dragon after a blink strike. */
const HANG_TICKS = 10;

// The secret ending's timeline (ticks after the dragon's death)
const SEQ_SILENCE = 30;
const SEQ_CORRUPT = 50;
const SEQ_INTEGRITY = 200;
const SEQ_RETURN = 250;

interface VoidState {
  /** Tick of its next blow or blink. */
  next: number;
  /** Ticks left hanging in the air beside the dragon. */
  hang: number;
}

interface SecretRun {
  tick: number;
  /** uuid of the player whose potion changed the Enderman. */
  owner: string | null;
  cheat: boolean;
  /** Everyone who was in the End when it broke. */
  players: Set<string>;
  enderman: Mob | null;
}

interface Arrival {
  x: number;
  y: number;
  z: number;
  since: number;
  cheat: boolean;
  /** This player's potion did it: they get the Corrupted Eye. */
  eye: boolean;
}

export class EndgameSystem {
  private readonly rng = new Random();
  private readonly voidbound = new Set<Mob>();
  private readonly states = new WeakMap<Mob, VoidState>();
  private secret: SecretRun | null = null;
  private readonly arrivals = new Map<ServerPlayer, Arrival>();

  constructor(private readonly server: GameServer) {}

  private get flags(): Record<string, unknown> {
    return this.server.level.flags;
  }

  // ------------------------------------------------------------------ the potion

  /** Right click on a mob while holding the mysterious potion. */
  useOnEntity(p: ServerPlayer, target: Entity, hand: 0 | 1): boolean {
    const slot = hand === 1 ? 40 : p.selectedSlot;
    const stack = p.inventory.get(slot);
    if (!stack || items[stack.id]?.id !== 'mysterious_potion') return false;
    if (!(target instanceof Mob) || target.dead || target.removed) return false;
    // Bosses and changed Endermen shrug it off (the bottle isn't used up)
    if (target.def.category === 'boss' || target.data.voidbound) {
      this.server.playSound(target.dim, 'glitch.zap', target.x, target.y + 1, target.z, 0.4, 0.5);
      return true;
    }
    const cheat = this.server.interaction.isCheat(p, stack);
    if (p.gamemode !== 'creative') {
      p.inventory.set(slot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
      this.server.interaction.syncInventory(p);
    }
    this.server.playSound(target.dim, 'glass.break', target.x, target.y + 1, target.z, 0.7, 0.6);
    if (target.type === 'enderman') this.transform(target, p, cheat);
    else this.oddReaction(target);
    return true;
  }

  /** Trying to drink it: the liquid pulls away. It is not used up. */
  useItem(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]?.id !== 'mysterious_potion') return false;
    const [ex, ey, ez] = this.server.eyePos(p);
    this.server.particles(p.dim, 'void_aura', ex - Math.sin(p.yaw) * 0.5, ey - 0.3, ez - Math.cos(p.yaw) * 0.5, 8, 0.15);
    this.server.playSound(p.dim, 'glitch.zap', p.x, p.y + 1, p.z, 0.25, 0.45);
    return true;
  }

  /** The Enderman changes: stronger, calm towards players, and bound to the void. */
  transform(e: Mob, owner: ServerPlayer | null, cheat: boolean): void {
    e.data.voidbound = true;
    if (owner) e.data.voidOwner = owner.uuid;
    if (cheat) e.data.voidCheat = true;
    e.maxHealth = VOID_HEALTH;
    e.health = VOID_HEALTH;
    e.persistenceRequired = true;
    e.angryAt = null;
    e.target = null;
    e.revengeTarget = null;
    e.metaDirty = true;
    this.voidbound.add(e);
    this.states.set(e, { next: this.server.tickNo + 40, hang: 0 });
    this.server.particles(e.dim, 'void_burst', e.x, e.y + 1.5, e.z, 60, 0.9);
    this.server.playSound(e.dim, 'enderman.voidbound', e.x, e.y + 2, e.z, 1.6, 1);
  }

  /** Any other mob: a flicker sideways, a lurch into the air, static. Nothing lasting. */
  private oddReaction(m: Mob): void {
    this.server.particles(m.dim, 'glitch', m.x, m.y + m.def.height / 2, m.z, 30, 0.6);
    this.server.playSound(m.dim, 'glitch.zap', m.x, m.y + 1, m.z, 0.8, 0.6);
    const a = this.rng.next() * Math.PI * 2;
    const nx = m.x + Math.cos(a) * 2;
    const nz = m.z + Math.sin(a) * 2;
    const feet = m.dim.getState(Math.floor(nx), Math.floor(m.y), Math.floor(nz));
    const head = m.dim.getState(Math.floor(nx), Math.floor(m.y + m.def.height), Math.floor(nz));
    if (!STATE_SOLID[feet] && !STATE_SOLID[head]) m.setPos(nx, m.y, nz);
    m.body.vy = 0.55;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    // Pick up Voidbound Endermen restored from saved chunks
    if (s.tickNo % 100 === 1) this.rescan();
    for (const e of this.voidbound) {
      if (e.removed || e.dead) {
        this.voidbound.delete(e);
        continue;
      }
      this.think(e);
    }
    if (this.secret) this.stepSecret();
    if (this.flags.secretPending && !this.secret && s.tickNo > 5) this.recoverSecret();
    this.runArrivals();
    if (s.tickNo % 20 === 0) {
      for (const p of s.players.values()) this.checkPlayer(p);
    }
  }

  private rescan(): void {
    for (const d of this.server.dims.values()) {
      for (const e of d.entities.values()) {
        if (e instanceof Mob && e.type === 'enderman' && e.data.voidbound && !e.dead && !this.voidbound.has(e)) {
          this.voidbound.add(e);
          this.states.set(e, { next: this.server.tickNo + 40, hang: 0 });
        }
      }
    }
  }

  /** Things that come to a player: the potion found, a held ending or eye. */
  private checkPlayer(p: ServerPlayer): void {
    for (let i = 0; i < 41; i++) {
      const st = p.inventory.get(i);
      if (st && items[st.id]?.id === 'mysterious_potion' && !isAdminStack(st)) {
        this.server.interaction.grant(p, 'mysterious_potion');
        break;
      }
    }
    // The secret ending happened while this player was away
    const pend = this.flags.pendingSecret as Record<string, { cheat: boolean; eye: boolean }> | undefined;
    const mine = pend?.[p.uuid];
    if (mine && !p.dead && !this.arrivals.has(p)) {
      delete pend![p.uuid];
      if (!Object.keys(pend!).length) delete this.flags.pendingSecret;
      this.awardSecret(p, mine.cheat, mine.eye);
    }
  }

  // ------------------------------------------------------------------ voidbound AI

  private think(e: Mob): void {
    const fight = this.server.theEnd?.fight;
    const dragon = fight?.dragon;
    const hunting = !!fight && !!dragon && !dragon.dead && e.dim.id === 'end' && e.dim === dragon.dim;
    const st = this.states.get(e) ?? { next: 0, hang: 0 };
    this.states.set(e, st);
    if (!hunting) {
      // Restless: ordinary Enderman habits, but it never minds players, and it blinks about
      e.noAi = false;
      e.controlled = false;
      st.hang = 0;
      if (this.server.tickNo >= st.next) {
        st.next = this.server.tickNo + 160 + this.rng.int(200);
        if (this.rng.chance(0.5)) this.server.mobs?.teleportMob(e, null);
      }
      return;
    }
    e.noAi = true;
    e.target = null;
    const now = this.server.tickNo;
    if (st.hang > 0) {
      // Hanging in the air beside the dragon after a blink strike
      e.controlled = true;
      e.body.vx = e.body.vy = e.body.vz = 0;
      if (--st.hang === 0) {
        e.controlled = false;
        this.blinkToGround(e, 0, 0, 8, 24);
      }
      return;
    }
    e.controlled = false;
    if (fight!.phase === 'perch') {
      // Fight it on the ground beside the portal
      const d = Math.hypot(e.x - dragon!.x, e.z - dragon!.z);
      if (d > 9 || Math.abs(e.y - dragon!.y) > 8) this.blinkToGround(e, dragon!.x, dragon!.z, 4, 7);
      e.yaw = Math.atan2(-(dragon!.x - e.x), -(dragon!.z - e.z));
      e.headYaw = e.yaw;
      if (now >= st.next) {
        st.next = now + PERCH_STRIKE_EVERY;
        this.strike(e, dragon!, fight!);
      }
      return;
    }
    // The dragon is flying: blink up beside it, strike, hang a moment, drop back down
    if (now >= st.next && e.distanceSq(dragon!.x, dragon!.y, dragon!.z) < 140 * 140) {
      st.next = now + BLINK_EVERY + this.rng.int(30);
      const a = this.rng.next() * Math.PI * 2;
      this.blinkTo(e, dragon!.x + Math.cos(a) * 5, dragon!.y + 1, dragon!.z + Math.sin(a) * 5);
      e.yaw = Math.atan2(-(dragon!.x - e.x), -(dragon!.z - e.z));
      this.strike(e, dragon!, fight!);
      st.hang = HANG_TICKS;
      return;
    }
    // Keep to the main island between strikes
    if (Math.hypot(e.x, e.z) > 70 || e.y < 20) this.blinkToGround(e, 0, 0, 8, 24);
  }

  /**
   * A Voidbound blow. While any pillar crystal stands it can't take the
   * dragon's last hit point: the secret ending needs them all destroyed.
   */
  private strike(e: Mob, dragon: Mob, fight: DragonFight): void {
    let dmg = STRIKE_DAMAGE;
    if (!fight.allCrystalsDestroyed()) dmg = Math.min(dmg, dragon.health - 1);
    this.server.broadcastNear(e.dim, e.x, e.y, e.z, 64, { t: 'anim', id: e.id, anim: 'swing' });
    this.server.particles(e.dim, 'void_burst', (e.x + dragon.x) / 2, e.y + 2, (e.z + dragon.z) / 2, 14, 0.8);
    this.server.playSound(e.dim, 'voidbound.strike', e.x, e.y + 2, e.z, 1.4, 0.9 + this.rng.next() * 0.2);
    if (dmg <= 0) return;
    const before = dragon.health;
    dragon.hurt(dmg, { source: 'mob', attacker: e });
    fight.noteVoidHit(before - dragon.health);
  }

  private blinkTo(e: Mob, x: number, y: number, z: number): void {
    this.server.particles(e.dim, 'portal', e.x, e.y + 1.5, e.z, 24, 0.5);
    e.setPos(x, y, z);
    e.body.vx = e.body.vy = e.body.vz = 0;
    e.body.fallDistance = 0;
    this.server.particles(e.dim, 'portal', x, y + 1.5, z, 24, 0.5);
    this.server.playSound(e.dim, 'teleport', x, y + 1, z, 1, 0.8);
  }

  /** Blinks to standing ground on the main island, `r0`-`r1` blocks from (cx, cz). */
  private blinkToGround(e: Mob, cx: number, cz: number, r0: number, r1: number): void {
    const dim = e.dim;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = r0 + this.rng.next() * (r1 - r0);
      const x = Math.floor(cx + Math.cos(a) * r);
      const z = Math.floor(cz + Math.sin(a) * r);
      if (!dim.isLoaded(x, z)) continue;
      const y = dim.getHeight(x, z);
      if (y <= 1 || !STATE_SOLID[dim.getState(x, y - 1, z)]) continue;
      if (STATE_SOLID[dim.getState(x, y, z)] || STATE_SOLID[dim.getState(x, y + 1, z)] || STATE_SOLID[dim.getState(x, y + 2, z)]) continue;
      this.blinkTo(e, x + 0.5, y, z + 0.5);
      return;
    }
    // Fall back to the rim of the exit portal
    const py = exitPortalY((this.server.dim('end').generator as EndGenerator).terrain);
    this.blinkTo(e, 4.5, py + 1, 0.5);
  }

  // ------------------------------------------------------------------ the secret ending

  /** Called by the dragon fight when a Voidbound Enderman kills the dragon with every crystal gone. */
  beginSecretEnding(dragon: Mob, enderman: Mob, cheat: boolean): void {
    const owner = typeof enderman.data.voidOwner === 'string' ? enderman.data.voidOwner : null;
    const endDim = this.server.dim('end');
    const players = new Set<string>();
    for (const p of this.server.players.values()) if (p.dim === endDim && !p.dead) players.add(p.uuid);
    this.secret = { tick: 0, owner, cheat, players, enderman };
    this.flags.secretPending = { owner, cheat, players: [...players] };
    const st = this.server.endings?.state;
    if (st) st.dragonDeath = cheat ? 'cheat' : 'enderman';
    // The first crack
    this.toEnd({ t: 'fx', kind: 'glitch', strength: 0.35, ticks: 16 });
    void dragon;
  }

  private toEnd(msg: Parameters<ServerPlayer['send']>[0]): void {
    const endDim = this.server.dim('end');
    for (const p of this.server.players.values()) if (p.dim === endDim) p.send(msg);
  }

  private stepSecret(): void {
    const s = this.secret!;
    s.tick++;
    const endDim = this.server.dim('end');
    if (s.tick === SEQ_SILENCE) this.toEnd({ t: 'fx', kind: 'silence', ticks: SEQ_RETURN - SEQ_SILENCE + 40 });
    if (s.tick === SEQ_CORRUPT) this.toEnd({ t: 'fx', kind: 'corrupt_world', strength: 0.8, ticks: SEQ_INTEGRITY - SEQ_CORRUPT + 30 });
    if (s.tick > SEQ_CORRUPT && s.tick < SEQ_RETURN && s.tick % 8 === 0) {
      // Static bleeding out of the island
      for (const p of this.server.players.values()) {
        if (p.dim !== endDim) continue;
        const a = this.rng.next() * Math.PI * 2;
        const r = 4 + this.rng.next() * 20;
        this.server.particles(endDim, 'glitch', p.x + Math.cos(a) * r, p.y + this.rng.next() * 8, p.z + Math.sin(a) * r, 12, 1.2);
      }
    }
    if (s.tick === SEQ_INTEGRITY) {
      this.toEnd({ t: 'fx', kind: 'integrity', text: 'WORLD INTEGRITY FAILURE', ticks: 44 });
      // The Enderman that did it is gone with the dragon
      const e = s.enderman;
      if (e && !e.removed) {
        this.server.particles(e.dim, 'void_burst', e.x, e.y + 1.5, e.z, 80, 1);
        e.remove();
      }
    }
    if (s.tick >= SEQ_RETURN) this.finishSecretNow();
  }

  /** Ends the sequence right away (also when everyone left the End mid-way). */
  finishSecretNow(): void {
    const s = this.secret ?? this.pendingFromFlags();
    if (!s) return;
    this.secret = null;
    const endDim = this.server.dim('end');
    for (const p of [...this.server.players.values()]) {
      if (p.dim !== endDim || p.dead) continue;
      s.players.add(p.uuid);
      this.returnToStronghold(p, s.cheat, p.uuid === s.owner);
    }
    this.server.theEnd?.fight.completeSecret();
    if (s.enderman && !s.enderman.removed) s.enderman.remove();
    const st = this.server.endings?.state;
    if (st) {
      st.dragonDeath = s.cheat ? 'cheat' : 'enderman';
      if (!s.cheat) st.eyeAwarded = true;
    }
    // Players who were there but aren't coming back through the stronghold (logged out) get it on return
    const pend = (this.flags.pendingSecret as Record<string, { cheat: boolean; eye: boolean }> | undefined) ?? {};
    for (const uuid of s.players) {
      const online = [...this.server.players.values()].find((p) => p.uuid === uuid);
      if (online && this.arrivals.has(online)) continue;
      pend[uuid] = { cheat: s.cheat, eye: uuid === s.owner };
    }
    // The potion's user gets the Eye even if they weren't in the End at the end
    if (s.owner && !s.players.has(s.owner)) {
      const owner = [...this.server.players.values()].find((p) => p.uuid === s.owner);
      if (owner) this.giveEye(owner, s.cheat);
      else pend[s.owner] = { cheat: s.cheat, eye: true };
    }
    if (Object.keys(pend).length) this.flags.pendingSecret = pend;
    delete this.flags.secretPending;
  }

  private pendingFromFlags(): SecretRun | null {
    const f = this.flags.secretPending as { owner?: unknown; cheat?: unknown; players?: unknown } | undefined;
    if (!f) return null;
    const players = new Set<string>(Array.isArray(f.players) ? f.players.filter((u): u is string => typeof u === 'string') : []);
    return { tick: SEQ_RETURN, owner: typeof f.owner === 'string' ? f.owner : null, cheat: f.cheat === true, players, enderman: null };
  }

  /** The server stopped mid-sequence: finish it on the next start. */
  private recoverSecret(): void {
    const fight = this.server.theEnd?.fight;
    if (fight?.dragon && !fight.dragon.dead) fight.dragon.remove();
    this.finishSecretNow();
  }

  /** Throws a player out of the End, back to the stronghold portal they came in through. */
  private returnToStronghold(p: ServerPlayer, cheat: boolean, eye: boolean): void {
    const ow = this.server.dim('overworld');
    let t = p.endEntry;
    if (!t) {
      const sp = this.server.level.spawn ?? [0, 64, 0];
      const sh = ow.generator.locate?.('stronghold', Math.floor(sp[0]), Math.floor(sp[2]));
      t = sh ? { x: sh.x, y: sh.y, z: sh.z } : { x: sp[0], y: sp[1], z: sp[2] };
    }
    this.server.changeDimension(p, 'overworld', t.x + 0.5, t.y + 0.2, t.z + 0.5, p.yaw, { admin: cheat });
    p.portalCooldown = 400;
    this.arrivals.set(p, { x: t.x, y: t.y, z: t.z, since: this.server.tickNo, cheat, eye });
  }

  /** Waits for the stronghold to load, sets the player down safely beside the portal, then the card. */
  private runArrivals(): void {
    for (const [p, a] of this.arrivals) {
      if (!this.server.players.has(p.conn.id)) {
        this.arrivals.delete(p);
        continue;
      }
      const dim = p.dim;
      let loaded = true;
      for (let dx = -1; dx <= 1 && loaded; dx++) for (let dz = -1; dz <= 1 && loaded; dz++) if (!dim.isLoaded(a.x + dx * 16, a.z + dz * 16)) loaded = false;
      if (!loaded && this.server.tickNo - a.since < 600) continue;
      this.arrivals.delete(p);
      const spot = loaded ? this.server.admin.safeSpot(dim, a.x, a.y, a.z, false) : null;
      if (spot) this.server.teleport(p, spot.x + 0.5, spot.y, spot.z + 0.5);
      else (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
      p.portalCooldown = Math.max(p.portalCooldown, 100);
      p.send({ t: 'fx', kind: 'unsilence', ticks: 60 });
      p.send({ t: 'fx', kind: 'glitch', strength: 0.5, ticks: 24 });
      this.server.later(50, () => {
        if (this.server.players.has(p.conn.id)) this.awardSecret(p, a.cheat, a.eye);
      });
    }
  }

  /** The secret ending reached: advancements, the card, and the Eye for the potion's user. */
  private awardSecret(p: ServerPlayer, cheat: boolean, eye: boolean): void {
    const it = this.server.interaction;
    if (!cheat) {
      it.grant(p, 'kill_dragon');
      it.grant(p, 'enderman_kills_dragon');
    }
    this.server.endings?.reach(p, 'farlands_remains', { cheat, show: 'now' });
    if (eye) this.giveEye(p, cheat);
  }

  private giveEye(p: ServerPlayer, cheat: boolean): void {
    const st = stackOf('corrupted_eye', 1);
    const rest = p.inventory.add(cheat ? markAdmin(st) : st);
    if (rest) this.server.interaction.dropStack(p, rest);
    this.server.interaction.syncInventory(p);
    if (!cheat) this.server.interaction.grant(p, 'corrupted_eye');
    this.server.particles(p.dim, 'void_burst', p.x, p.y + 1, p.z, 30, 0.6);
    this.server.playSound(p.dim, 'glitch.zap', p.x, p.y + 1, p.z, 0.8, 0.4);
  }

  /** Voidbound Endermen currently known (tests, the Admin Panel). */
  list(dim?: Dimension): Mob[] {
    this.rescan();
    return [...this.voidbound].filter((e) => !e.removed && !e.dead && (!dim || e.dim === dim));
  }
}
