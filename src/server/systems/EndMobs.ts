/**
 * V6 phase 2: the Expanded End's mobs.
 *
 * Their goals (src/server/ai/endGoals.ts) decide when to attack; this
 * system does the rest on the server, which is the only side that decides
 * anything: where they may spawn and how many, telegraphs and the hits that
 * follow them (no hit ever knocks a player towards the void), the Void
 * Stalker's void slip and return, the Endlings' blinking and scattering, the
 * Chorus Beast's temper, the mites' swarm and burrowing, the End Phantom's
 * dive and stun, and the advancements they give.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import { Mob, isAlive, isPlayer, overVoid, type Target } from '../entity/Mob';
import type { Entity } from '../entity/Entity';
import type { HurtInfo } from '../entity/Living';
import { LivingEntity } from '../entity/Living';
import type { ServerPlayer } from '../player/ServerPlayer';
import { lookDir } from './Interaction';
import { canSee } from '../ai/goals';
import { collisionShape } from '../../common/physics/shapes';
import { STATE_FLUID, S } from '../../common/registry/blocks';
import { biomeOf } from '../../common/registry/biomes';
import { isSurvivalLike } from '../../common/game/gamemode';
import { isAdminStack, itemIdOf } from '../../common/game/itemstack';
import { inExpansion } from '../../common/endExpansion/region';
import { EXPANSION_BIOME_IDS } from '../../common/endExpansion/biomes';
import { EXPANSION_MOBS, EXPANSION_MOB_CAPS, MITE_FORMATION_RANGE, PHANTOM_COOLDOWN, PHANTOM_MIN_DISTANCE, SPAWN_AREA, isExpansionMob, type ExpansionMob } from '../../common/endExpansion/mobs';
import { TELEGRAPH_CROWD_RANGE, TELEGRAPH_TICKS, TELEGRAPH_TICKS_CROWD, arcVelocity } from '../../common/endExpansion/combat';

/** Colours of the telegraph markers (the client's warning rings, lines and arcs). */
const WARN_SLAM = 0xd070ff;
const WARN_ARC = 0xe8a8ff;
const WARN_DIVE = 0xf0f4ff;
const WARN_RISE = 0x7a3ae0;

/** Ticks without a target after which an angry Chorus Beast calms down. */
const BEAST_CALM = 600;
/** How long a player must look straight at a Void Stalker before it slips away. */
const STARE_TICKS = 60;
/** Ticks before a Void Stalker can slip again after coming back. */
const SLIP_COOLDOWN = 300;
/** Chance that mining an End Crystal Cluster lets mites out. */
const CLUSTER_MITE_CHANCE = 0.25;

export class EndMobsSystem {
  private nextFx = 0x6e000000;
  /** When each player last had an End Phantom spawn around them. */
  private readonly phantomAt = new Map<string, number>();

  constructor(private readonly server: GameServer) {}

  private get now(): number {
    return this.server.tickNo;
  }

  /** Whether natural spawning of the expansion's mobs is on (the Admin Panel can switch it off). */
  get spawning(): boolean {
    return this.server.level.flags.expansionMobSpawning !== false;
  }

  set spawning(on: boolean) {
    this.server.level.flags.expansionMobSpawning = on ? undefined : false;
  }

  // ------------------------------------------------------------------ telegraphs

  /** How long an attack is telegraphed: 24 ticks, or 32 when more than one player is near. */
  telegraph(m: Mob): number {
    let n = 0;
    for (const p of this.server.players.values()) if (p.dim === m.dim && !p.dead && p.gamemode !== 'spectator' && p.distanceSq(m.x, m.y, m.z) < TELEGRAPH_CROWD_RANGE ** 2) n++;
    return n > 1 ? TELEGRAPH_TICKS_CROWD : TELEGRAPH_TICKS;
  }

  fx(dim: Dimension, x: number, y: number, z: number, msg: Record<string, unknown>): number {
    const id = this.nextFx++;
    this.server.broadcastNear(dim, x, y, z, 96, { t: 'fx', id, ...msg } as never);
    return id;
  }

  // ------------------------------------------------------------------ ground

  private solid(dim: Dimension, x: number, y: number, z: number): boolean {
    return collisionShape(dim.getState(x, y, z)).length > 0;
  }

  /** A place to stand: room for `h` blocks, solid ground under it, and no void edge right beside it. */
  safeSpot(dim: Dimension, x: number, y: number, z: number, h = 1): boolean {
    if (!dim.isLoaded(x, z) || y < 2) return false;
    if (!this.solid(dim, x, y - 1, z) || STATE_FLUID[dim.getState(x, y - 1, z)]) return false;
    for (let i = 0; i < Math.ceil(h); i++) if (this.solid(dim, x, y + i, z) || STATE_FLUID[dim.getState(x, y + i, z)]) return false;
    for (const [dx, dz] of N4) if (overVoid(dim, x + dx + 0.5, y, z + dz + 0.5)) return false;
    return true;
  }

  /** A safe standing height in column (x, z) near `y`, or null. */
  spotNear(dim: Dimension, x: number, y: number, z: number, h = 1, range = 4): number | null {
    for (let d = 0; d <= range; d++) {
      if (this.safeSpot(dim, x, y + d, z, h)) return y + d;
      if (d && this.safeSpot(dim, x, y - d, z, h)) return y - d;
    }
    return null;
  }

  /** The nearest safe ground (the top of the land) to column (x, z) within r blocks, in loaded chunks. */
  groundNear(dim: Dimension, x: number, z: number, r: number): { x: number; y: number; z: number } | null {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    for (let d = 0; d <= r; d++)
      for (let dz = -d; dz <= d; dz++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
          const px = cx + dx;
          const pz = cz + dz;
          if (!dim.isLoaded(px, pz)) continue;
          const y = dim.getHeight(px, pz);
          if (y > 2 && this.safeSpot(dim, px, y, pz, 0.5)) return { x: px, y, z: pz };
        }
    return null;
  }

  /** True when knocking `t` this way would send it towards the void within a few blocks. */
  private towardsVoid(t: Entity, dx: number, dz: number): boolean {
    for (let k = 1; k <= 4; k++) if (overVoid(t.dim as Dimension, t.x + dx * k, t.y, t.z + dz * k)) return true;
    return false;
  }

  /**
   * A knockback direction for `t` close to (dx, dz) that does not lead into
   * the void: (dx, dz) itself when it is safe, otherwise (when `redirect`)
   * the nearest safe one of eight, otherwise none.
   */
  safeKnock(t: Entity, dx: number, dz: number, redirect: boolean): [number, number] | null {
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    if (!this.towardsVoid(t, dx, dz)) return [dx, dz];
    if (!redirect) return null;
    const base = Math.atan2(dz, dx);
    for (const off of [0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.142]) {
      const a = base + off;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      if (!this.towardsVoid(t, ox, oz)) return [ox, oz];
    }
    return null;
  }

  /** A hit, resolved now: damage, and knockback only in a direction that keeps the target out of the void. */
  strike(m: Mob, t: Target, amount: number, knockback: number, redirect = false): number {
    const s = this.server;
    if (!isAlive(t)) return 0;
    s.broadcastNear(m.dim, m.x, m.y, m.z, 64, { t: 'anim', id: m.id, anim: 'swing' });
    const dir = this.safeKnock(t, t.x - m.x, t.z - m.z, redirect);
    return s.mobs!.damage(t, amount, { source: 'mob', attacker: m, kbx: dir?.[0] ?? 0, kbz: dir?.[1] ?? 0, knockback: dir ? knockback : 0 });
  }

  /** Whether `t` is within a mob's reach (`extra` blocks past touching), at about the same height. */
  inReach(m: Mob, t: Entity, extra: number): boolean {
    const reach = m.def.width / 2 + t.body.width / 2 + extra;
    return (m.x - t.x) ** 2 + (m.z - t.z) ** 2 <= reach * reach && t.y < m.y + m.def.height + 0.5 && t.y + t.body.height > m.y - 0.5;
  }

  /** A short teleport onto safe ground, away from (fx, fz) when given (Endlings, chorus). */
  blink(e: Entity, rMin: number, rMax: number, away: { x: number; z: number } | null, sound = 'teleport'): boolean {
    const dim = e.dim as Dimension;
    const rng = Math.random;
    const h = e.body.height;
    for (let i = 0; i < 20; i++) {
      const base = away ? Math.atan2(e.z - away.z, e.x - away.x) : rng() * Math.PI * 2;
      const a = base + (away ? (rng() - 0.5) * 2.2 : 0);
      const r = rMin + rng() * (rMax - rMin);
      const x = Math.floor(e.x + Math.cos(a) * r);
      const z = Math.floor(e.z + Math.sin(a) * r);
      const y = this.spotNear(dim, x, Math.floor(e.y), z, h, 4);
      if (y === null) continue;
      this.server.particles(dim, 'portal', e.x, e.y + h / 2, e.z, 16, 0.4);
      if (isPlayer(e)) this.server.teleport(e, x + 0.5, y, z + 0.5);
      else {
        e.setPos(x + 0.5, y, z + 0.5);
        if (e instanceof Mob) e.stopNavigation();
      }
      e.body.vx = e.body.vz = 0;
      this.server.particles(dim, 'portal', x + 0.5, y + h / 2, z + 0.5, 16, 0.4);
      this.server.playSound(dim, sound, x + 0.5, y, z + 0.5, 0.8, 1.5);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ spawning

  /**
   * Natural spawning of an expansion mob for player `p` near (x, y, z): the
   * height to spawn at and how many more of that kind may come, or null.
   */
  allowSpawn(p: ServerPlayer, type: string, x: number, y: number, z: number): { y: number; limit: number } | null {
    if (!this.spawning || p.dim.id !== 'end' || !inExpansion(x, z) || !isExpansionMob(type)) return null;
    let near = 0;
    for (const e of p.dim.entitiesNear(p.x, p.y, p.z, SPAWN_AREA)) if (e.type === type && !(e as Mob).dead) near++;
    const limit = EXPANSION_MOB_CAPS[type] - near;
    if (limit <= 0) return null;
    if (type === 'end_phantom') {
      // Rare: only far out in the band, and seldom around any one player
      if (Math.hypot(x, z) < PHANTOM_MIN_DISTANCE) return null;
      if (this.now < (this.phantomAt.get(p.uuid) ?? -Infinity) + PHANTOM_COOLDOWN) return null;
      return { y: Math.min(240, Math.floor(p.y) + 20 + Math.floor(Math.random() * 10)), limit: 1 };
    }
    return { y, limit };
  }

  /** Where an expansion mob may appear: firm ground (never over the void) and, for mites, a crystal formation close by. */
  spawnConditions(dim: Dimension, type: string, x: number, y: number, z: number): boolean {
    if (!inExpansion(x, z)) return false;
    const st = dim.getState(x, y, z);
    if (STATE_FLUID[st]) return false;
    if (type === 'end_phantom') return !this.solid(dim, x, y, z) && !this.solid(dim, x, y + 1, z);
    if (!this.safeSpot(dim, x, y, z, 1)) return false;
    if (type === 'end_crystal_mite') return this.nearFormation(dim, x, y, z, MITE_FORMATION_RANGE);
    return true;
  }

  private nearFormation(dim: Dimension, x: number, y: number, z: number, r: number): boolean {
    const prism = S('prism_crystal');
    const cluster = S('end_crystal_cluster');
    for (let dy = -2; dy <= 3; dy++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const s = dim.getState(x + dx, y + dy, z + dz);
          if (s === prism || s === cluster) return true;
        }
    return false;
  }

  onNaturalSpawn(p: ServerPlayer, m: Mob): void {
    if (m.type === 'end_phantom') {
      m.data.homeX = m.x;
      m.data.homeY = m.y;
      m.data.homeZ = m.z;
      for (const o of this.server.players.values()) if (o.dim === p.dim && o.distanceSq(m.x, m.y, m.z) < SPAWN_AREA * SPAWN_AREA) this.phantomAt.set(o.uuid, this.now);
    }
  }

  /** After loading: attacks in progress are forgotten; a stalker that was in the void comes back (or does not). */
  onRestore(m: Mob): void {
    for (const k of ['tele', 'leapUntil', 'leapHit', 'slipping', 'wantSlip', 'diving', 'diveEnd', 'diveDir', 'diveHit', 'stunUntil', 'stun', 'scatterAt', 'calmAt', 'stare', 'slipReady', 'burrowTo', 'burrowScan']) delete m.data[k];
    if (m.data.slip) {
      m.data.slip = 'gone';
      m.data.returnAt = 60;
      m.data.slipTries = 0;
      m.controlled = true;
      m.noAi = true;
      m.data.untouchable = true;
    }
    if (m.data.angerAt) m.data.calmAt = 0;
  }

  // ------------------------------------------------------------------ per-mob ticks

  mobTick(m: Mob): void {
    if (m.dead || m.removed) return;
    switch (m.type as ExpansionMob) {
      case 'endling':
        if ((m.age + m.id) % 10 === 0) this.scatter(m);
        break;
      case 'void_stalker':
        this.stalkerTick(m);
        break;
      case 'chorus_beast':
        this.beastTick(m);
        break;
      case 'end_phantom':
        this.phantomTick(m);
        break;
      case 'end_crystal_mite':
        if (m.data.tele && m.age % 3 === 0) this.server.particles(m.dim, 'crystal_glint', m.x, m.y + 0.3, m.z, 1, 0.2);
        break;
    }
  }

  // ------------------------------------------------------------------ Endlings

  /** A Void Stalker in sight within 16 blocks: every Endling nearby chirps and blinks away. */
  private scatter(m: Mob): void {
    if (Number(m.data.scatterAt ?? -Infinity) > this.now) return;
    const stalker = m.dim.entitiesNear(m.x, m.y, m.z, 16, (e) => e.type === 'void_stalker' && !(e as Mob).dead && !(e as Mob).data.slip)[0] as Mob | undefined;
    if (!stalker) return;
    for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 16, (o) => o.type === 'endling' && !(o as Mob).dead)) {
      const en = e as Mob;
      if (Number(en.data.scatterAt ?? -Infinity) > this.now) continue;
      en.data.scatterAt = this.now + 160;
      this.server.playSound(en.dim, 'mob.endling.chirp', en.x, en.y + 0.4, en.z, 1, 1.1 + Math.random() * 0.3);
      this.blink(en, 8, 14, stalker, 'mob.endling.blink');
    }
  }

  // ------------------------------------------------------------------ Void Stalker

  private stalkerTick(m: Mob): void {
    const s = this.server;
    const slip = m.data.slip as string | undefined;
    if (slip === 'fall') {
      // Gone once it has dropped well below the edge
      if (m.y < Number(m.data.slipFrom ?? m.y) - 4 || this.now - Number(m.data.slipAt ?? this.now) > 30) this.vanish(m);
      return;
    }
    if (slip === 'gone') {
      m.controlled = true;
      m.noAi = true;
      m.body.vx = m.body.vy = m.body.vz = 0;
      if (this.now >= Number(m.data.returnAt ?? 0)) this.tryReturn(m);
      return;
    }
    if (slip === 'rise') {
      const x = Number(m.data.riseX);
      const y = Number(m.data.riseY);
      const z = Number(m.data.riseZ);
      // Rising void particles and a low rising sound where it will climb back
      s.particles(m.dim, 'void_aura', x + 0.5, y + 0.2, z + 0.5, 3, 0.45);
      if (this.now >= Number(m.data.riseAt ?? 0)) this.land(m, x, y, z);
      return;
    }
    // Fell into the void some other way: it slips away from there too
    if (m.y < 0) {
      this.vanish(m);
      return;
    }
    if (m.data.slipping) return;
    // The lunge: one hit, at the moment of contact
    if (m.data.leapUntil !== undefined) {
      const t = m.target;
      if (this.now > Number(m.data.leapUntil)) {
        delete m.data.leapUntil;
        delete m.data.leapHit;
      } else if (!m.data.leapHit && t && isAlive(t) && this.inReach(m, t, 0.6)) {
        m.data.leapHit = true;
        this.strike(m, t, m.def.damage ?? 7, 0.4);
      }
    }
    // A player looking straight at it for three seconds
    if (m.age % 2 === 0 && this.now >= Number(m.data.slipReady ?? 0)) {
      const stared = this.staredAt(m);
      m.data.stare = stared ? Number(m.data.stare ?? 0) + 2 : 0;
      if (Number(m.data.stare) >= STARE_TICKS) {
        m.data.stare = 0;
        m.data.wantSlip = true;
      }
    }
    if (m.data.tele === 'lunge' && m.age % 2 === 0) s.particles(m.dim, 'void_aura', m.x, m.y + 1.9, m.z, 1, 0.2);
  }

  /** Whether a player is looking straight at a stalker's body (within a body's width of the centre). */
  private staredAt(m: Mob): boolean {
    for (const p of this.server.players.values()) {
      if (p.dim !== m.dim || p.dead || p.gamemode === 'spectator') continue;
      const ey = p.y + p.eyeHeight;
      const tx = m.x - p.x;
      const ty = m.y + 1.2 - ey;
      const tz = m.z - p.z;
      const d = Math.hypot(tx, ty, tz);
      if (d > 32 || d < 0.5) continue;
      const [lx, ly, lz] = lookDir(p.yaw, p.pitch);
      const dot = (lx * tx + ly * ty + lz * tz) / d;
      if (dot > Math.cos(Math.atan(0.7 / d)) && canSee(m, p)) return true;
    }
    return false;
  }

  /** The nearest island edge within reach: the last firm ground before open void, and the way out. */
  findEdge(m: Mob): { x: number; y: number; z: number; dx: number; dz: number } | null {
    let best: { x: number; y: number; z: number; dx: number; dz: number } | null = null;
    let bd = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (let k = 1; k <= 20; k++) {
        const x = m.x + dx * k;
        const z = m.z + dz * k;
        if (!overVoid(m.dim, x, m.y, z)) continue;
        // Open void (not a ledge with ground further down)
        if (!this.deepVoid(m.dim, x, m.y, z)) break;
        if (k - 1 < 1) break;
        if (k < bd) {
          bd = k;
          best = { x: m.x + dx * (k - 1), y: m.y, z: m.z + dz * (k - 1), dx, dz };
        }
        break;
      }
    }
    return best;
  }

  private deepVoid(dim: Dimension, x: number, y: number, z: number): boolean {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let yy = Math.floor(y); yy >= Math.max(0, Math.floor(y) - 48); yy--) if (this.solid(dim, bx, yy, bz)) return false;
    return true;
  }

  /** Into the void: hidden and out of reach until it climbs back. */
  private vanish(m: Mob): void {
    const s = this.server;
    s.particles(m.dim, 'void_burst', m.x, m.y + 1, m.z, 24, 0.6);
    s.playSound(m.dim, 'mob.void_stalker.vanish', m.x, m.y + 1, m.z, 1.2, 0.8);
    m.data.slip = 'gone';
    delete m.data.slipping;
    delete m.data.tele;
    m.data.untouchable = true;
    m.data.returnAt = this.now + 80 + Math.floor(Math.random() * 81);
    m.data.slipTries = 0;
    if (m.target && isPlayer(m.target)) m.data.returnFor = m.target.uuid;
    m.target = null;
    m.controlled = true;
    m.noAi = true;
    m.stopNavigation();
    m.body.vx = m.body.vy = m.body.vz = 0;
    m.metaDirty = true;
  }

  /** Picks a spot behind the nearest player to climb back to, or gives up and is gone for good. */
  private tryReturn(m: Mob): void {
    const s = this.server;
    const pick = this.returnPlayer(m);
    const spot = pick ? this.behind(pick, m.def.height) : null;
    if (!pick || !spot) {
      m.data.slipTries = Number(m.data.slipTries ?? 0) + 1;
      m.data.returnAt = this.now + 10;
      // In the void with nowhere to come back to: despawns
      if (Number(m.data.slipTries) > 20) m.remove();
      return;
    }
    m.data.slip = 'rise';
    m.data.riseX = spot.x;
    m.data.riseY = spot.y;
    m.data.riseZ = spot.z;
    m.data.riseFor = pick.uuid;
    const ticks = this.telegraph(m);
    m.data.riseAt = this.now + ticks;
    m.metaDirty = true;
    this.fx(m.dim, spot.x, spot.y, spot.z, { kind: 'warn_circle', x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5, r: 1.1, ticks, color: WARN_RISE });
    s.playSound(m.dim, 'mob.void_stalker.rise', spot.x + 0.5, spot.y + 0.5, spot.z + 0.5, 1.4, 1);
  }

  private returnPlayer(m: Mob): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bd = 64 * 64;
    for (const p of this.server.players.values()) {
      if (p.dim !== m.dim || !isAlive(p)) continue;
      const d = p.distanceSq(m.x, m.y, m.z) * (p.uuid === m.data.returnFor ? 0.25 : 1);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Safe ground 2-4 blocks behind a player (the way they are not looking). */
  private behind(p: ServerPlayer, h: number): { x: number; y: number; z: number } | null {
    const [lx, , lz] = lookDir(p.yaw, 0);
    const base = Math.atan2(-lz, -lx);
    for (const r of [2.5, 3.5, 2, 4])
      for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
        const x = Math.floor(p.x + Math.cos(base + off) * r);
        const z = Math.floor(p.z + Math.sin(base + off) * r);
        const y = this.spotNear(p.dim, x, Math.floor(p.y), z, h, 3);
        if (y !== null) return { x, y, z };
      }
    return null;
  }

  /** Climbs out of the void at the warned spot (if it is still safe), facing the player. */
  private land(m: Mob, x: number, y: number, z: number): void {
    const s = this.server;
    if (!this.safeSpot(m.dim, x, y, z, m.def.height)) {
      m.data.slip = 'gone';
      m.data.returnAt = this.now + 10;
      return;
    }
    const p = [...s.players.values()].find((o) => o.uuid === m.data.riseFor);
    m.setPos(x + 0.5, y, z + 0.5);
    m.body.vx = m.body.vy = m.body.vz = 0;
    m.controlled = false;
    m.noAi = false;
    for (const k of ['slip', 'untouchable', 'returnAt', 'riseX', 'riseY', 'riseZ', 'riseAt', 'slipTries', 'returnFor', 'riseFor']) delete m.data[k];
    m.data.slipReady = this.now + SLIP_COOLDOWN;
    if (p && isAlive(p) && p.dim === m.dim) {
      m.target = p;
      m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
      m.headYaw = m.yaw;
      const victims = Array.isArray(m.data.slipVictims) ? (m.data.slipVictims as string[]) : [];
      if (!victims.includes(p.uuid)) victims.push(p.uuid);
      m.data.slipVictims = victims;
    }
    m.metaDirty = true;
    s.particles(m.dim, 'void_burst', m.x, m.y + 1, m.z, 20, 0.5);
    s.playSound(m.dim, 'mob.void_stalker.emerge', m.x, m.y + 1, m.z, 1.2, 1);
  }

  /** Whether the leap from the stalker to (x, z) crosses only firm ground. */
  leapSafe(m: Mob, x: number, z: number): boolean {
    const d = Math.hypot(x - m.x, z - m.z);
    const n = Math.max(1, Math.ceil(d));
    for (let i = 1; i <= n + 1; i++) {
      const f = Math.min(1.15, i / n);
      if (overVoid(m.dim, m.x + (x - m.x) * f, m.y, m.z + (z - m.z) * f)) return false;
    }
    return true;
  }

  /** Leaps at (x, z): airborne at once (no ground friction on the first tick), landing about there. */
  leap(m: Mob, x: number, z: number): void {
    const dx = x - m.x;
    const dz = z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    const v = Math.min(1.1, d / 7.5);
    m.body.vx = (dx / d) * v;
    m.body.vz = (dz / d) * v;
    m.body.vy = 0.42;
    m.body.onGround = false;
    m.yaw = Math.atan2(-dx, -dz);
    m.data.leapUntil = this.now + 18;
    m.data.leapHit = false;
    this.server.playSound(m.dim, 'mob.void_stalker.leap', m.x, m.y + 1, m.z, 1, 1);
  }

  // ------------------------------------------------------------------ Chorus Beast

  private angerList(m: Mob): string[] {
    return Array.isArray(m.data.angerAt) ? (m.data.angerAt as string[]) : [];
  }

  /** Makes a Chorus Beast angry with a player (they hit it, or broke chorus near it). */
  angerBeast(m: Mob, p: ServerPlayer): void {
    if (!isAlive(p)) return;
    const list = this.angerList(m);
    if (!list.includes(p.uuid)) list.push(p.uuid);
    m.data.angerAt = list;
    m.data.calmAt = this.now + BEAST_CALM;
    if (!m.target) m.target = p;
    m.metaDirty = true;
  }

  isAngryAt(m: Mob, p: Target): boolean {
    return isPlayer(p) && this.angerList(m).includes(p.uuid);
  }

  angryTarget(m: Mob): ServerPlayer | null {
    const list = this.angerList(m);
    if (!list.length) return null;
    let best: ServerPlayer | null = null;
    let bd = 24 * 24;
    for (const p of this.server.players.values()) {
      if (p.dim !== m.dim || !isAlive(p) || !list.includes(p.uuid)) continue;
      const d = p.distanceSq(m.x, m.y, m.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private beastTick(m: Mob): void {
    const list = this.angerList(m);
    if (!list.length) return;
    const t = m.target;
    if (t && isAlive(t) && t.dim === m.dim && (t.x - m.x) ** 2 + (t.z - m.z) ** 2 < 28 * 28) {
      m.data.calmAt = this.now + BEAST_CALM;
      return;
    }
    // Lost them: thirty seconds later it calms down
    if (t) {
      m.target = null;
      m.metaDirty = true;
    }
    if (this.now >= Number(m.data.calmAt ?? 0)) this.calm(m);
  }

  /** Thirty seconds without a target: the beast settles; whoever angered it (and is still around) has calmed it. */
  calm(m: Mob): void {
    const s = this.server;
    for (const uuid of this.angerList(m)) {
      const p = [...s.players.values()].find((o) => o.uuid === uuid);
      if (p && isAlive(p) && p.dim === m.dim && p.distanceSq(m.x, m.y, m.z) < 64 * 64 && !m.admin) s.interaction.grant(p, 'chorus_beast');
    }
    delete m.data.angerAt;
    delete m.data.calmAt;
    m.target = null;
    m.revengeTarget = null;
    m.metaDirty = true;
    s.particles(m.dim, 'happy', m.x, m.y + m.def.height, m.z, 8, 0.8);
    s.playSound(m.dim, 'mob.chorus_beast.calm', m.x, m.y + 2, m.z, 1, 1);
  }

  warnSlam(m: Mob, ticks: number): void {
    this.fx(m.dim, m.x, m.y, m.z, { kind: 'warn_circle', x: m.x, y: Math.floor(m.y), z: m.z, r: 4, ticks, color: WARN_SLAM });
    this.server.playSound(m.dim, 'mob.chorus_beast.rear', m.x, m.y + 2, m.z, 1.4, 1);
  }

  /** The slam lands: everyone within four blocks is hit and thrown away from the beast, or along the island if that way is the void. */
  slam(m: Mob): void {
    const s = this.server;
    s.playSound(m.dim, 'mob.chorus_beast.slam', m.x, m.y, m.z, 1.6, 1);
    s.particles(m.dim, 'explosion_smoke', m.x, m.y + 0.2, m.z, 16, 2.4);
    for (const p of s.players.values()) {
      if (p.dim !== m.dim || !isAlive(p)) continue;
      if (Math.hypot(p.x - m.x, p.z - m.z) > 4 + p.body.width / 2 || Math.abs(p.y - m.y) > 2.5) continue;
      this.strike(m, p, m.def.damage ?? 12, 0.9, true);
    }
  }

  warnThrow(m: Mob, x: number, y: number, z: number, flight: number, ticks: number): void {
    this.fx(m.dim, m.x, m.y, m.z, { kind: 'warn_arc', x: m.x, y: m.y + 2.7, z: m.z, x1: x, y1: y + 0.6, z1: z, strength: flight, ticks, color: WARN_ARC });
    this.server.playSound(m.dim, 'mob.chorus_beast.windup', m.x, m.y + 2, m.z, 1.2, 1);
  }

  /** Lobs chorus along the arc it showed; a hit hurts and shifts the target 2-4 blocks like chorus fruit. */
  throwChorus(m: Mob, x: number, y: number, z: number, flight: number): void {
    const s = this.server;
    const ax = m.x;
    const ay = m.y + 2.7;
    const az = m.z;
    const pr = s.mobs!.projectile(m.dim, 'chorus_glob', ax, ay, az, m);
    const v = arcVelocity(ax, ay, az, x, y + 0.6, z, flight);
    pr.vx = v[0];
    pr.vy = v[1];
    pr.vz = v[2];
    pr.life = flight + 60;
    pr.onHit = (p, hit) => {
      const e = hit.entity;
      if (e && e !== m && (isPlayer(e) || e instanceof LivingEntity) && isAlive(e as Target)) {
        this.strike(m, e as Target, 6, 0);
        this.blink(e, 2, 4, null);
      }
      s.particles(p.dim as Dimension, 'portal', hit.x, hit.y, hit.z, 20, 0.5);
      s.playSound(p.dim as Dimension, 'mob.chorus_beast.splat', hit.x, hit.y, hit.z, 1, 1);
      return true;
    };
    s.playSound(m.dim, 'mob.chorus_beast.throw', ax, ay, az, 1.2, 1);
  }

  // ------------------------------------------------------------------ End Crystal Mites

  /** The nearest End Crystal Cluster within r (remembered between looks). */
  nearestCluster(m: Mob, r: number): { x: number; y: number; z: number } | null {
    const cluster = S('end_crystal_cluster');
    const c = m.data.burrowTo as [number, number, number] | undefined;
    if (c && m.dim.getState(c[0], c[1], c[2]) === cluster) return { x: c[0], y: c[1], z: c[2] };
    if (this.now < Number(m.data.burrowScan ?? 0)) return null;
    m.data.burrowScan = this.now + 40;
    let best: [number, number, number] | null = null;
    let bd = Infinity;
    const bx = Math.floor(m.x);
    const by = Math.floor(m.y);
    const bz = Math.floor(m.z);
    for (let dy = -6; dy <= 6; dy++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (m.dim.getState(bx + dx, by + dy, bz + dz) !== cluster) continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) {
            bd = d;
            best = [bx + dx, by + dy, bz + dz];
          }
        }
    if (!best) {
      delete m.data.burrowTo;
      return null;
    }
    m.data.burrowTo = best;
    return { x: best[0], y: best[1], z: best[2] };
  }

  burrow(m: Mob, x: number, y: number, z: number): void {
    this.server.particles(m.dim, 'crystal_glint', x + 0.5, y + 0.4, z + 0.5, 14, 0.4);
    this.server.playSound(m.dim, 'mob.end_crystal_mite.burrow', x + 0.5, y + 0.5, z + 0.5, 0.8, 1.2);
    m.remove();
  }

  // ------------------------------------------------------------------ End Phantom

  /** The line of a dive: from the phantom through the target, on past it. */
  diveLine(m: Mob, t: Target): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } {
    const tx = t.x;
    const ty = t.y + 1;
    const tz = t.z;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const dz = tz - m.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return { x0: m.x, y0: m.y, z0: m.z, x1: tx + (dx / d) * 5, y1: ty + (dy / d) * 5, z1: tz + (dz / d) * 5 };
  }

  warnDive(m: Mob, line: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, ticks: number): void {
    this.fx(m.dim, m.x, m.y, m.z, { kind: 'warn_beam', x: line.x0, y: line.y0, z: line.z0, x1: line.x1, y1: line.y1, z1: line.z1, ticks, color: WARN_DIVE });
    this.server.playSound(m.dim, 'mob.end_phantom.screech', m.x, m.y, m.z, 2.5, 1);
  }

  dive(m: Mob, line: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }): void {
    const dx = line.x1 - m.x;
    const dy = line.y1 - m.y;
    const dz = line.z1 - m.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    m.data.diving = true;
    m.data.diveDir = [dx / d, dy / d, dz / d];
    m.data.diveEnd = this.now + Math.ceil(d / 1.1) + 2;
    m.data.diveHit = false;
    m.wantPos = null;
    this.server.playSound(m.dim, 'mob.end_phantom.dive', m.x, m.y, m.z, 2, 1);
  }

  private phantomTick(m: Mob): void {
    const s = this.server;
    const stunUntil = Number(m.data.stunUntil ?? 0);
    if (stunUntil) {
      if (this.now < stunUntil) {
        // Stunned: drifts down, wings folded
        m.body.vx *= 0.8;
        m.body.vz *= 0.8;
        m.body.vy = Math.max(m.body.vy - 0.02, -0.12);
        if (m.age % 4 === 0) s.particles(m.dim, 'crit', m.x, m.y + 0.6, m.z, 2, 0.6);
        return;
      }
      delete m.data.stunUntil;
      delete m.data.stun;
      m.metaDirty = true;
      m.wantPos = { x: m.x, y: m.y + 16, z: m.z, speed: 1.2 };
    }
    if (!m.data.diving) return;
    const dir = m.data.diveDir as [number, number, number];
    m.body.vx = dir[0] * 1.1;
    m.body.vy = dir[1] * 1.1;
    m.body.vz = dir[2] * 1.1;
    if (!m.data.diveHit) {
      for (const p of s.players.values()) {
        if (p.dim !== m.dim || !isAlive(p)) continue;
        if (Math.hypot(p.x - m.x, p.z - m.z) < m.def.width / 2 + 0.5 && p.y < m.y + 0.8 && p.y + p.body.height > m.y - 0.4) {
          m.data.diveHit = true;
          this.strike(m, p, m.def.damage ?? 9, 0.5);
          break;
        }
      }
    }
    if (this.now >= Number(m.data.diveEnd ?? 0) || m.body.collidedH || m.body.collidedV) this.endDive(m);
  }

  private endDive(m: Mob): void {
    const dir = (m.data.diveDir as [number, number, number] | undefined) ?? [0, 0, 0];
    delete m.data.diving;
    delete m.data.diveDir;
    delete m.data.diveEnd;
    delete m.data.diveHit;
    // Climb away along the way it was going
    m.wantPos = { x: m.x + dir[0] * 10, y: m.y + 18, z: m.z + dir[2] * 10, speed: 1.4 };
  }

  // ------------------------------------------------------------------ events

  /** Hits on an expansion mob (it survived them). */
  onHurt(m: Mob, info: HurtInfo): void {
    const a = info.attacker;
    switch (m.type as ExpansionMob) {
      case 'endling':
        // Blinks a short way off (an Enderman's trick, closer)
        this.blink(m, 3, 8, a ?? null, 'mob.endling.blink');
        break;
      case 'void_stalker':
        if (m.health < m.maxHealth / 2 && !m.data.lowSlip && !m.data.slip) {
          m.data.lowSlip = true;
          m.data.wantSlip = true;
        }
        break;
      case 'chorus_beast':
        if (a && isPlayer(a)) this.angerBeast(m, a);
        break;
      case 'end_crystal_mite':
        // One is hit: every mite within 12 blocks joins in
        if (a && (isPlayer(a) || a instanceof LivingEntity))
          for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 12, (o) => o.type === 'end_crystal_mite' && !(o as Mob).dead)) {
            const o = e as Mob;
            o.target = a as Target;
            delete o.data.burrow;
            o.metaDirty = true;
          }
        break;
      case 'end_phantom':
        if (m.data.diving && a && isPlayer(a)) {
          this.endDive(m);
          m.wantPos = null;
          m.data.stunUntil = this.now + 40;
          m.data.stun = true;
          m.metaDirty = true;
          this.server.playSound(m.dim, 'mob.end_phantom.stun', m.x, m.y, m.z, 1.5, 1);
        }
        break;
    }
  }

  /** A player breaks a block (any game mode): chorus angers beasts nearby; a crystal cluster may let mites out. */
  onBlockBroken(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number, blockId: string): void {
    if (dim.id !== 'end') return;
    if (blockId === 'chorus_plant' || blockId === 'chorus_flower' || blockId === 'chorus_stalk') {
      for (const e of dim.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 8, (o) => o.type === 'chorus_beast' && !(o as Mob).dead)) this.angerBeast(e as Mob, p);
      return;
    }
    if (blockId !== 'end_crystal_cluster' || !isSurvivalLike(p.gamemode)) return;
    const cheat = this.server.interaction.isCheat(p, p.heldItem() ?? undefined);
    // Mites near a mined-out cluster go back into the nearest other one
    for (const e of dim.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 8, (o) => o.type === 'end_crystal_mite' && !(o as Mob).dead && !(o as Mob).target)) (e as Mob).data.burrow = true;
    if (Math.random() >= CLUSTER_MITE_CHANCE) return;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const m = this.server.mobs!.spawn(dim, 'end_crystal_mite', x + 0.3 + Math.random() * 0.4, y, z + 0.3 + Math.random() * 0.4, { reason: 'cluster' });
      if (!m) continue;
      m.admin = cheat;
      m.data.burrow = true;
      if (isAlive(p)) m.target = p;
    }
    this.server.particles(dim, 'crystal_glint', x + 0.5, y + 0.5, z + 0.5, 16, 0.5);
    this.server.playSound(dim, 'mob.end_crystal_mite.burrow', x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
  }

  /** Advancements for killing the expansion's mobs (never for cheat-spawned ones). */
  onDeath(m: Mob, killer: ServerPlayer | null): void {
    if (!killer || m.admin) return;
    const it = this.server.interaction;
    if (m.type === 'void_stalker' && Array.isArray(m.data.slipVictims) && (m.data.slipVictims as string[]).includes(killer.uuid)) it.grant(killer, 'void_slip');
    if (m.type === 'chorus_beast') it.grant(killer, 'chorus_beast');
    if (m.type === 'end_phantom') it.grant(killer, 'kill_end_phantom');
    if (this.server.admin.inContext(killer)) return;
    killer.expansionKills.add(m.type);
    if (EXPANSION_MOBS.every((t) => killer.expansionKills.has(t))) it.grant(killer, 'expansion_hunter');
  }

  /** Every second: advancements for what players wear. */
  tick(): void {
    if (this.now % 20 !== 0) return;
    for (const p of this.server.players.values()) if (!p.dead) this.checkArmor(p);
  }

  /** "Wear a full set of Ender Alloy armor" (cheat-made pieces never count). */
  checkArmor(p: ServerPlayer): void {
    if (p.achievements.has('ender_alloy_armor')) return;
    for (let i = 36; i < 40; i++) {
      const st = p.inventory.get(i);
      if (!st || isAdminStack(st)) return;
      const id = itemIdOf(st);
      if (!id.startsWith('ender_alloy_')) return;
    }
    this.server.interaction.grant(p, 'ender_alloy_armor');
  }

  // ------------------------------------------------------------------ Admin Panel

  /** Expansion mobs per Expanded End biome around a point (loaded chunks only). */
  countsByBiome(dim: Dimension): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const b of EXPANSION_BIOME_IDS) out[b] = {};
    for (const e of dim.entities.values()) {
      if (!(e instanceof Mob) || e.dead || !isExpansionMob(e.type) || !inExpansion(e.x, e.z)) continue;
      const b = biomeOf(dim.getBiome(Math.floor(e.x), Math.floor(e.z))).id;
      const row = (out[b] ??= {});
      row[e.type] = (row[e.type] ?? 0) + 1;
    }
    return out;
  }

  /** Removes the expansion's mobs within r of a point (no drops, no experience). */
  killNear(dim: Dimension, x: number, y: number, z: number, r: number): number {
    let n = 0;
    for (const e of dim.entitiesNear(x, y, z, r, (o) => o instanceof Mob && isExpansionMob(o.type) && !o.dead)) {
      e.remove();
      n++;
    }
    return n;
  }
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
