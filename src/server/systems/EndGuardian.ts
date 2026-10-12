/**
 * V6 - The End Expansion, phase 5: the End Guardian's fight, in the arena at
 * the bottom of the Void Citadel (src/common/endExpansion/guardian.ts).
 *
 * Four Eclipse Shards on the altar wake it (the first time the altar is
 * already charged). 1,000 health (+400 for each player beyond the first),
 * armor 16, never knocked back. Three phases, every attack named on a banner
 * and shown before it lands (24 ticks at least, 32 with company), resolved
 * here when it does:
 *  1. AWAKENING: CRYSTAL LANCE (a charge line, then the beam), GROUND
 *     FRACTURE (a ring of cracks, then those tiles drop to the lower floor for
 *     three seconds), CONSTRUCT CALL (two Sentinels, at most every 45 s).
 *  2. VOID SHIFT: VOID ORBS (slow, homing, can be shot or struck down),
 *     GRAVITY WELL (a low-gravity pocket), CRYSTAL SHIELD (four pylons halve
 *     the damage it takes until they are broken; they come back once).
 *  3. CORE EXPOSED: faster, attacks in pairs, COLLAPSE (the outer ring drops
 *     for eight seconds) and FINAL LANCE (a slow sweep at chest height: jump
 *     or duck).
 * After every fourth attack it kneels with its core exposed for five seconds
 * and takes half as much again from everything.
 *
 * The arena is put back when the fight ends (and survives restarts until it
 * is). A fight is never saved: a restart or everyone gone for a minute resets
 * it (the altar stays charged). Defeated, it re-forms after seven days, and
 * the altar wants four shards each time. Its fall is a victory title, never an
 * ending.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { HurtInfo } from '../entity/Living';
import { Mob, isPlayer, isAlive, type Target } from '../entity/Mob';
import { LivingEntity } from '../entity/Living';
import { lookDir } from './Interaction';
import { items } from '../../common/registry/items';
import { S, getProp, withProp, blocks, STATE_BLOCK, STATE_SOLID } from '../../common/registry/blocks';
import { stackOf, itemIdOf, markAdmin, type ItemStack } from '../../common/game/itemstack';
import { Random } from '../../common/math/rng';
import { DAY } from '../../common/endExpansion/events';
import { GUARDIAN, GUARDIAN_LOOT, LANCE } from '../../common/endExpansion/guardian';
import { isSurvivalLike } from '../../common/game/gamemode';
import { rollLoot } from '../../common/game/loot';

type P3 = [number, number, number];
type Attack = 'lance' | 'fracture' | 'call' | 'orbs' | 'well' | 'shield' | 'collapse' | 'final';

const BANNERS: Record<Attack, string> = {
  lance: 'CRYSTAL LANCE',
  fracture: 'GROUND FRACTURE',
  call: 'CONSTRUCT CALL',
  orbs: 'VOID ORBS',
  well: 'GRAVITY WELL',
  shield: 'CRYSTAL SHIELD',
  collapse: 'COLLAPSE',
  final: 'JUMP OR DUCK',
};
const PHASE_NAMES = ['AWAKENING', 'VOID SHIFT', 'CORE EXPOSED'];

const WARN_LANCE = 0xc8b8ff;
const WARN_FLOOR = 0xc8a0ff;
const WARN_CALL = 0x7ae0ff;

interface Hazard {
  kind: 'lance' | 'drop' | 'call' | 'final';
  id: number;
  at: number;
  until: number;
  /** Lance: from (x, y, z) to (x1, y1, z1); drops: the cells. */
  x: number;
  y: number;
  z: number;
  x1: number;
  y1: number;
  z1: number;
  dmg: number;
  cells?: P3[];
  dropped?: boolean;
  hit?: Set<ServerPlayer>;
  target?: ServerPlayer;
}

interface Fight {
  dim: Dimension;
  center: P3;
  floorY: number;
  boss: Mob;
  phase: number;
  state: 'rise' | 'fight' | 'exposed' | 'transition' | 'dying';
  t: number;
  cooldown: number;
  attacks: number;
  hazards: Hazard[];
  bar: Set<ServerPlayer>;
  party: Set<string>;
  /** Players a Final Lance struck (uuids). */
  lanced: Set<string>;
  absent: number;
  cheat: boolean;
  callAt: number;
  pylons: Mob[];
  /** Pylons raised this phase (they come back once). */
  pylonRaises: number;
  pylonsBackAt: number;
  orbs: { m: Mob; target: ServerPlayer; formedAt: number; until: number }[];
  last: Attack | null;
}

/** What `level.flags.guardian` holds. */
interface GuardianState {
  /** The altar holds its charge (first time, and after a fight that never ended). */
  charged: boolean;
  /** When it was last defeated (level time), or null. */
  defeatedAt: number | null;
  defeats: number;
}

export class EndGuardianSystem {
  fight: Fight | null = null;
  rng: { next(): number; int(n: number): number; chance(p: number): boolean } = new Random();
  private nextFx = 9_800_000;
  /** The arena's changed blocks and what was there (saved until put back). */
  private readonly restore = new Map<string, number>();

  constructor(readonly server: GameServer) {
    const saved = (server.level.flags as { guardianRestore?: [string, number][] }).guardianRestore;
    if (Array.isArray(saved)) for (const [k, s] of saved) if (typeof k === 'string' && Number.isFinite(s)) this.restore.set(k, s);
  }

  get state(): GuardianState {
    const f = this.server.level.flags as { guardian?: GuardianState };
    if (!f.guardian || typeof f.guardian !== 'object') f.guardian = { charged: true, defeatedAt: null, defeats: 0 };
    return f.guardian;
  }

  private get end(): Dimension {
    return this.server.dim('end');
  }

  private arena(): { center: P3; y: number; radius: number; altar: P3; pylons: P3[] } | null {
    return this.server.citadel?.plan?.arena ?? null;
  }

  telegraph(players: number): number {
    return players > 1 ? 32 : 24;
  }

  // ------------------------------------------------------------------ the Guardian's Lance

  private readonly lanceReady = new Map<ServerPlayer, number>();

  /** The Guardian's Lance: a short Crystal Lance straight ahead (stopped by blocks), then a cooldown. */
  useItem(p: ServerPlayer, stack: ItemStack, hand: number): boolean {
    if (items[stack.id]?.id !== 'guardians_lance') return false;
    const s = this.server;
    if ((this.lanceReady.get(p) ?? 0) > s.tickNo) return true;
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    // As far as the beam goes before something solid
    let len = 0;
    for (let t = 0.25; t <= LANCE.beam; t += 0.25) {
      if (STATE_SOLID[p.dim.getState(Math.floor(ex + d[0] * t), Math.floor(ey + d[1] * t), Math.floor(ez + d[2] * t))]) break;
      len = t;
    }
    const to: P3 = [ex + d[0] * len, ey + d[1] * len, ez + d[2] * len];
    const cheat = s.interaction.isCheat(p, stack);
    for (const e of p.dim.entitiesNear(ex, ey, ez, LANCE.beam + 2)) {
      if (e === p || !(isPlayer(e) || e instanceof LivingEntity) || !isAlive(e as Target)) continue;
      if (isPlayer(e) && (!s.level.pvp || e.gamemode === 'creative')) continue;
      // Within reach of the beam's line (measured to the middle of the body)
      const h = (e as LivingEntity).body.height / 2;
      const cx = e.x - ex;
      const cy = e.y + h - ey;
      const cz = e.z - ez;
      const t = Math.max(0, Math.min(len, cx * d[0] + cy * d[1] + cz * d[2]));
      const dist = Math.hypot(cx - d[0] * t, cy - d[1] * t, cz - d[2] * t);
      if (dist > (e as LivingEntity).body.width / 2 + 0.6) continue;
      const l = Math.hypot(cx, cz) || 1;
      s.mobs!.damage(e as Target, LANCE.damage, { source: 'player', attacker: p, kbx: cx / l, kbz: cz / l, knockback: 0.4 });
    }
    for (const pl of s.players.values()) if (pl.dim === p.dim && pl.distanceSq(p.x, p.y, p.z) < 64 * 64) pl.send({ t: 'fx', kind: 'laser', id: this.nextFx++, x: ex + d[0] * 0.8, y: ey - 0.2, z: ez + d[2] * 0.8, x1: to[0], y1: to[1], z1: to[2], ticks: 6, color: 0xc8b8ff });
    s.particles(p.dim, 'crystal_glint', to[0], to[1], to[2], 10, 0.3);
    s.playSound(p.dim, 'guardian.lance', p.x, p.y + 1.5, p.z, 0.8, 1.4);
    this.lanceReady.set(p, s.tickNo + LANCE.cooldown);
    p.send({ t: 'cooldown', item: stack.id, ticks: LANCE.cooldown });
    if (p.gamemode !== 'creative') s.interaction.damageStack(p, hand === 1 ? 40 : p.selectedSlot, 1);
    void cheat;
    return true;
  }

  // ------------------------------------------------------------------ the altar

  /** Re-forming after a defeat: ticks left (0 when it is ready). */
  reformsIn(): number {
    const d = this.state.defeatedAt;
    if (d === null) return 0;
    return Math.max(0, d + GUARDIAN.respawnDays * DAY - this.server.level.time);
  }

  useAltar(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const dim = p.dim;
    const st0 = dim.getState(x, y, z);
    if (this.fight) {
      p.send({ t: 'chat', text: 'The Guardian is already awake.', kind: 'system' });
      return true;
    }
    const wait = this.reformsIn();
    if (wait > 0) {
      p.send({ t: 'chat', text: `The Guardian has not re-formed yet (${Math.ceil(wait / DAY)} more days).`, kind: 'system' });
      return true;
    }
    const st = this.state;
    if (getProp(st0, 'charged') === 'true' && st.charged) {
      this.begin(p, this.server.admin.inContext(p));
      return true;
    }
    const held = p.inventory.get(p.selectedSlot);
    let shards = Number(getProp(st0, 'shards') ?? 0);
    if (!held || itemIdOf(held) !== 'eclipse_shard') {
      p.send({ t: 'chat', text: `The altar wants ${GUARDIAN.shards} Eclipse Shards (${shards}/${GUARDIAN.shards}).`, kind: 'system' });
      return true;
    }
    if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    this.server.interaction.syncInventory(p);
    shards++;
    this.server.playSound(dim, 'guardian.altar', x + 0.5, y + 1, z + 0.5, 1, 0.8 + shards * 0.1);
    this.server.particles(dim, 'crystal_glint', x + 0.5, y + 1.2, z + 0.5, 12, 0.4);
    if (shards >= GUARDIAN.shards) {
      dim.setBlock(x, y, z, withProp(withProp(st0, 'shards', '0'), 'charged', true));
      st.charged = true;
      this.begin(p, this.server.admin.inContext(p) || held.tag?.admin === true);
    } else dim.setBlock(x, y, z, withProp(st0, 'shards', String(shards)));
    return true;
  }

  // ------------------------------------------------------------------ starting and ending

  private arenaPlayers(f: { center: P3; floorY: number; dim: Dimension }): ServerPlayer[] {
    return [...this.server.players.values()].filter((p) => !p.dead && p.dim === f.dim && p.gamemode !== 'spectator' && Math.hypot(p.x - f.center[0] - 0.5, p.z - f.center[2] - 0.5) < GUARDIAN.leash && p.y > f.floorY - 14 && p.y < f.floorY + 20);
  }

  /** Wakes the Guardian (the Admin Panel's is a cheat: nothing it does counts). */
  begin(p: ServerPlayer | null, cheat: boolean): boolean {
    const a = this.arena();
    if (!a || this.fight) return false;
    const dim = this.end;
    const [cx, , cz] = a.center;
    if (!dim.isLoaded(cx, cz)) return false;
    const m = this.server.mobs?.spawn(dim, 'end_guardian', cx + 0.5, a.y + 1, cz + 0.5, { persistent: false, reason: 'boss' });
    if (!m) return false;
    m.controlled = true;
    m.noAi = true;
    m.persistent = false;
    m.admin = cheat;
    const f: Fight = { dim, center: a.center, floorY: a.y, boss: m, phase: 1, state: 'rise', t: 0, cooldown: 60, attacks: 0, hazards: [], bar: new Set(), party: new Set(), lanced: new Set(), absent: 0, cheat, callAt: -Infinity, pylons: [], pylonRaises: 0, pylonsBackAt: 0, orbs: [], last: null };
    this.fight = f;
    const n = Math.max(1, this.arenaPlayers(f).length);
    m.maxHealth = GUARDIAN.health + GUARDIAN.perPlayer * (n - 1);
    m.health = m.maxHealth;
    m.data.phase = 1;
    m.data.state = 'rise';
    m.metaDirty = true;
    for (const pl of this.arenaPlayers(f)) {
      f.party.add(pl.uuid);
      pl.send({ t: 'fx', kind: 'hack', text: 'THE END GUARDIAN AWAKENS', strength: 0, ticks: 60 });
    }
    this.server.playSound(dim, 'guardian.awaken', cx + 0.5, a.y + 2, cz + 0.5, 4, 1);
    this.server.particles(dim, 'portal', cx + 0.5, a.y + 3, cz + 0.5, 80, 2);
    void p;
    return true;
  }

  /** The fight is over (won, reset or abandoned): its pieces go, the arena comes back. */
  private finishFight(f: Fight): void {
    for (const h of f.hazards) this.endHazard(f, h);
    f.hazards.length = 0;
    for (const pm of f.pylons) if (!pm.removed) pm.remove();
    for (const o of f.orbs) if (!o.m.removed) o.m.remove();
    for (const e of f.dim.entitiesNear(f.center[0], f.floorY, f.center[2], 40)) if (e instanceof Mob && e.data.guardianCall && !e.dead) e.remove();
    if (!f.boss.removed) f.boss.remove();
    for (const p of f.bar) p.send({ t: 'boss', id: f.boss.id, action: 'remove' });
    f.bar.clear();
    for (const p of this.arenaPlayers(f)) p.send({ t: 'fx', kind: 'zone_end', id: 9_799_999 });
    this.restoreAll();
    this.fight = null;
  }

  /** Admin Panel: an end to the fight without a winner (the altar stays charged). */
  reset(): string {
    if (this.fight) this.finishFight(this.fight);
    this.restoreAll();
    const st = this.state;
    st.charged = true;
    st.defeatedAt = null;
    const a = this.arena();
    if (a && this.end.isLoaded(a.altar[0], a.altar[2])) {
      const s = this.end.getState(...a.altar);
      if (blocks[STATE_BLOCK[s]!]!.id === 'guardian_altar') this.end.setBlock(a.altar[0], a.altar[1], a.altar[2], withProp(withProp(s, 'charged', true), 'shards', '0'));
    }
    return 'Reset the End Guardian: the arena is back, the altar charged, and it can be fought again at once.';
  }

  /** Admin Panel: its defeat, now, awarding nothing. */
  forceDefeat(): string {
    const f = this.fight;
    if (!f) return 'The Guardian is not awake.';
    f.cheat = true;
    f.boss.admin = true;
    f.boss.data.forced = true;
    this.defeated(f, true);
    return 'The End Guardian falls (cheat: no advancements, no loot).';
  }

  /** Admin Panel: on to its next phase now (the fight becomes a cheat: nothing it gives counts). */
  nextPhase(): string {
    const f = this.fight;
    if (!f) return 'The Guardian is not awake.';
    if (f.phase >= 3) return 'The Guardian is already in its last phase.';
    f.cheat = true;
    f.boss.admin = true;
    f.boss.health = f.boss.maxHealth * (f.phase === 1 ? GUARDIAN.phase2 - 0.01 : GUARDIAN.phase3 - 0.01);
    f.boss.metaDirty = true;
    if (f.state === 'exposed' || f.state === 'rise') this.setState(f, 'fight');
    return `The Guardian moves on to phase ${f.phase + 1} (a cheat: nothing it gives counts).`;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    // Changed arena blocks a restart left behind go back once the fight is over
    if (!this.fight && this.restore.size && this.server.tickNo % 40 === 0) this.restoreAll();
    const f = this.fight;
    if (!f) return;
    const m = f.boss;
    if (m.removed && f.state !== 'dying') {
      this.finishFight(f);
      return;
    }
    f.t++;
    const players = this.arenaPlayers(f);
    for (const p of players) f.party.add(p.uuid);
    this.bars(f, players);
    this.hazardTick(f, players);
    this.orbTick(f);
    if (f.state === 'dying') {
      if (f.t % 4 === 0) this.server.particles(f.dim, 'explosion', m.x + (this.rng.next() - 0.5) * 3, m.y + 1 + this.rng.next() * 4, m.z + (this.rng.next() - 0.5) * 3, 1, 0.4);
      if (f.t >= 60) this.finishFight(f);
      return;
    }
    // Everyone gone (dead or left): after a minute it resets
    if (!players.length) {
      if (++f.absent >= GUARDIAN.resetTicks) {
        this.finishFight(f);
        const st = this.state;
        st.charged = true;
      }
      return;
    }
    f.absent = 0;
    // Face (and drift towards) the nearest player, never far from the middle
    const t = this.nearest(f, players);
    if (t) {
      m.yaw = Math.atan2(-(t.x - m.x), -(t.z - m.z));
      m.headYaw = m.yaw;
      if (f.state === 'fight') {
        const [cx, , cz] = f.center;
        const dx = t.x - m.x;
        const dz = t.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 5) {
          const nx = m.x + (dx / d) * 0.05;
          const nz = m.z + (dz / d) * 0.05;
          if (Math.hypot(nx - cx - 0.5, nz - cz - 0.5) < 7) m.setPos(nx, f.floorY + 1, nz);
        }
      }
    }
    m.body.vx = m.body.vy = m.body.vz = 0;
    if (f.state === 'rise') {
      if (f.t >= 60) this.setState(f, 'fight');
      return;
    }
    if (f.state === 'transition') {
      if (f.t >= 40) this.setState(f, 'fight');
      return;
    }
    if (f.state === 'exposed') {
      if (f.t >= GUARDIAN.windowTicks) this.setState(f, 'fight');
      return;
    }
    // Phases
    const share = m.health / m.maxHealth;
    const want = share <= GUARDIAN.phase3 ? 3 : share <= GUARDIAN.phase2 ? 2 : 1;
    if (want > f.phase) {
      f.phase = want;
      m.data.phase = want;
      f.pylonRaises = 0;
      for (const p of players) p.send({ t: 'fx', kind: 'hack', text: PHASE_NAMES[want - 1]!, strength: 1, ticks: 50 });
      this.server.playSound(f.dim, 'guardian.phase', m.x, m.y + 3, m.z, 4, 0.8);
      if (want === 2) this.raisePylons(f, players);
      if (want === 3) for (const pm of f.pylons) if (!pm.removed) pm.remove();
      this.setState(f, 'transition');
      return;
    }
    // Pylons come back once in phase 2
    if (f.phase === 2 && f.pylonsBackAt && f.t >= f.pylonsBackAt && f.pylonRaises < 2) this.raisePylons(f, players);
    if (--f.cooldown > 0) return;
    // A core window after every fourth attack
    if (f.attacks >= GUARDIAN.attacksPerWindow) {
      f.attacks = 0;
      for (const p of players) p.send({ t: 'fx', kind: 'hack', text: 'CORE EXPOSED', strength: 0, ticks: 40 });
      this.setState(f, 'exposed');
      f.cooldown = 30;
      return;
    }
    const tele = this.telegraph(players.length);
    const a = this.pick(f);
    this.attack(f, a, players, tele);
    f.attacks++;
    f.last = a;
    // Phase 3: a second attack hard on the first's heels (telegraphed all the same)
    if (f.phase === 3 && (a === 'lance' || a === 'fracture') && this.rng.chance(0.6)) {
      const b = a === 'lance' ? 'fracture' : 'lance';
      this.attack(f, b, players, tele + 10);
    }
    f.cooldown = (f.phase === 3 ? 50 : f.phase === 2 ? 64 : 76) + tele + (players.length > 1 ? 8 : 0);
  }

  private setState(f: Fight, s: Fight['state']): void {
    f.state = s;
    f.t = 0;
    f.boss.data.state = s;
    f.boss.metaDirty = true;
  }

  private nearest(f: Fight, players: ServerPlayer[]): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bd = Infinity;
    for (const p of players) {
      if (!isSurvivalLike(p.gamemode)) continue;
      const d = p.distanceSq(f.boss.x, f.boss.y, f.boss.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private pick(f: Fight): Attack {
    const pool: Attack[] = f.phase === 1 ? ['lance', 'fracture', 'lance', 'fracture'] : f.phase === 2 ? ['orbs', 'well', 'lance', 'orbs', 'fracture'] : ['collapse', 'final', 'lance', 'fracture', 'final'];
    if (f.phase === 1 && f.t - f.callAt >= GUARDIAN.constructEvery && this.rng.chance(0.4)) return 'call';
    let a = pool[this.rng.int(pool.length)]!;
    if (a === f.last && pool.length > 1) a = pool[(pool.indexOf(a) + 1) % pool.length]!;
    return a;
  }

  // ------------------------------------------------------------------ attacks

  private banner(players: ServerPlayer[], a: Attack, ticks: number): void {
    for (const p of players) p.send({ t: 'fx', kind: 'hack', text: BANNERS[a], strength: 0, ticks: Math.max(30, ticks) });
  }

  private fx(players: ServerPlayer[], msg: Record<string, unknown>): void {
    for (const p of players) p.send({ t: 'fx', ...msg } as never);
  }

  private attack(f: Fight, a: Attack, players: ServerPlayer[], tele: number): void {
    const now = this.server.tickNo;
    const m = f.boss;
    const target = this.nearest(f, players) ?? players[0]!;
    this.banner(players, a, tele);
    m.data.attack = a;
    m.metaDirty = true;
    switch (a) {
      case 'lance': {
        // A charge line from its chest to where the target stands; the beam follows exactly that line
        const charge = Math.max(GUARDIAN.lanceCharge, tele);
        const ex = m.x;
        const ey = f.floorY + 2.6;
        const ez = m.z;
        const dx = target.x - ex;
        const dz = target.z - ez;
        const d = Math.hypot(dx, dz) || 1;
        const h: Hazard = { kind: 'lance', id: this.nextFx++, at: now + charge, until: now + charge + 6, x: ex, y: ey, z: ez, x1: ex + (dx / d) * 30, y1: f.floorY + 1.2, z1: ez + (dz / d) * 30, dmg: GUARDIAN.lanceDamage, hit: new Set() };
        f.hazards.push(h);
        this.fx(players, { kind: 'warn_beam', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: charge, color: WARN_LANCE });
        this.server.playSound(f.dim, 'guardian.charge', m.x, m.y + 3, m.z, 3, 1);
        break;
      }
      case 'fracture': {
        // A ring of cracks round the target: those tiles drop to the lower floor for three seconds
        const warn = Math.max(GUARDIAN.fractureWarn, tele);
        const cx = Math.floor(target.x);
        const cz = Math.floor(target.z);
        const cells = this.floorCells(f, (x, z) => {
          const r = Math.hypot(x - cx, z - cz);
          return r <= 3.5;
        });
        const h: Hazard = { kind: 'drop', id: this.nextFx++, at: now + warn, until: now + warn + GUARDIAN.fractureDrop, x: cx + 0.5, y: f.floorY + 1, z: cz + 0.5, x1: 0, y1: 0, z1: 0, dmg: 0, cells };
        f.hazards.push(h);
        this.fx(players, { kind: 'warn_cracks', id: h.id, x: h.x, y: h.y + 0.02, z: h.z, r: 3.5, ticks: warn, color: WARN_FLOOR });
        break;
      }
      case 'call': {
        f.callAt = f.t;
        for (const off of [-1, 1]) {
          const ang = m.yaw + off * 1.2;
          const x = Math.floor(m.x - Math.sin(ang) * 6);
          const z = Math.floor(m.z - Math.cos(ang) * 6);
          const h: Hazard = { kind: 'call', id: this.nextFx++, at: now + tele, until: now + tele, x: x + 0.5, y: f.floorY + 1, z: z + 0.5, x1: 0, y1: 0, z1: 0, dmg: 0 };
          f.hazards.push(h);
          this.fx(players, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y + 0.05, z: h.z, r: 1.2, ticks: tele, color: WARN_CALL });
        }
        break;
      }
      case 'orbs': {
        // Three orbs form at its hands, then drift after their targets
        for (let i = 0; i < 3; i++) {
          const pt = players[i % players.length]!;
          const ang = m.yaw + (i - 1) * 0.8;
          const o = this.server.mobs?.spawn(f.dim, 'void_orb', m.x - Math.sin(ang) * 2, f.floorY + 3, m.z - Math.cos(ang) * 2, { persistent: false, reason: 'boss' });
          if (!o) continue;
          o.controlled = true;
          o.noAi = true;
          o.admin = f.cheat;
          f.orbs.push({ m: o, target: pt, formedAt: now + tele, until: now + tele + 240 });
        }
        this.fx(players, { kind: 'warn_circle', id: this.nextFx++, x: m.x, y: f.floorY + 1.05, z: m.z, r: 3, ticks: tele, color: 0xb070ff });
        break;
      }
      case 'well': {
        const ev = this.server.endEvents;
        if (ev) ev.addPocket(f.dim, target.x, f.floorY + 1, target.z, 5, Math.max(GUARDIAN.wellWarn, tele), 200);
        break;
      }
      case 'shield':
        this.raisePylons(f, players);
        break;
      case 'collapse': {
        // The outer ring flashes, then drops for eight seconds
        const warn = Math.max(GUARDIAN.collapseWarn, tele);
        const R = this.arena()!.radius;
        const [cx, , cz] = f.center;
        const cells = this.floorCells(f, (x, z) => Math.hypot(x - cx, z - cz) >= R - 3.5);
        const h: Hazard = { kind: 'drop', id: this.nextFx++, at: now + warn, until: now + warn + GUARDIAN.collapseDrop, x: cx + 0.5, y: f.floorY + 1, z: cz + 0.5, x1: 0, y1: 0, z1: 0, dmg: 0, cells };
        f.hazards.push(h);
        this.fx(players, { kind: 'warn_cracks', id: h.id, x: h.x, y: h.y + 0.02, z: h.z, r: R, ticks: warn, color: 0xff6aa0 });
        break;
      }
      case 'final': {
        // A slow sweep all the way round at chest height: jump or duck
        const warn = Math.max(GUARDIAN.finalLanceWarn, tele);
        const h: Hazard = { kind: 'final', id: this.nextFx++, at: now + warn, until: now + warn + 80, x: m.x, y: f.floorY + 2.2, z: m.z, x1: this.rng.next() * Math.PI * 2, y1: 0, z1: 0, dmg: GUARDIAN.finalLanceDamage, hit: new Set() };
        f.hazards.push(h);
        this.fx(players, { kind: 'warn_circle', id: h.id, x: h.x, y: h.y, z: h.z, r: 16, ticks: warn, color: 0xffe0ff });
        this.server.playSound(f.dim, 'guardian.charge', m.x, m.y + 3, m.z, 4, 0.6);
        break;
      }
    }
  }

  /** Arena floor tiles matching a test (the platform's own tiles, still there). */
  private floorCells(f: Fight, test: (x: number, z: number) => boolean): P3[] {
    const a = this.arena()!;
    const [cx, , cz] = f.center;
    const out: P3[] = [];
    const floor = S('guardian_floor');
    for (let x = cx - a.radius; x <= cx + a.radius; x++)
      for (let z = cz - a.radius; z <= cz + a.radius; z++) {
        if (!test(x, z)) continue;
        if (f.dim.getState(x, f.floorY, z) === floor) out.push([x, f.floorY, z]);
      }
    return out;
  }

  private raisePylons(f: Fight, players: ServerPlayer[]): void {
    const a = this.arena();
    if (!a) return;
    f.pylonRaises++;
    f.pylonsBackAt = 0;
    for (const pm of f.pylons) if (!pm.removed) pm.remove();
    f.pylons = [];
    for (const [x, y, z] of a.pylons) {
      const pm = this.server.mobs?.spawn(f.dim, 'guardian_pylon', x + 0.5, y, z + 0.5, { persistent: false, reason: 'boss' });
      if (!pm) continue;
      pm.controlled = true;
      pm.noAi = true;
      pm.admin = f.cheat;
      f.pylons.push(pm);
    }
    f.boss.data.shield = true;
    f.boss.metaDirty = true;
    this.banner(players, 'shield', 50);
    this.server.playSound(f.dim, 'guardian.shield', f.boss.x, f.boss.y + 3, f.boss.z, 3, 1);
  }

  private shieldUp(f: Fight): boolean {
    return f.pylons.some((p) => !p.removed && !p.dead);
  }

  private hazardTick(f: Fight, players: ServerPlayer[]): void {
    const now = this.server.tickNo;
    const survival = this.server.interaction.survival;
    // The shield drops when its last pylon breaks (and comes back once, after a while)
    if (f.boss.data.shield && !this.shieldUp(f)) {
      delete f.boss.data.shield;
      f.boss.metaDirty = true;
      if (f.phase === 2 && f.pylonRaises < 2) f.pylonsBackAt = f.t + 600;
      this.server.playSound(f.dim, 'guardian.shield_down', f.boss.x, f.boss.y + 3, f.boss.z, 3, 1);
    }
    for (let i = f.hazards.length - 1; i >= 0; i--) {
      const h = f.hazards[i]!;
      if (now < h.at) continue;
      switch (h.kind) {
        case 'lance':
          if (now === h.at) {
            this.fx(players, { kind: 'laser', id: h.id, x: h.x, y: h.y, z: h.z, x1: h.x1, y1: h.y1, z1: h.z1, ticks: 8, color: WARN_LANCE });
            this.server.playSound(f.dim, 'guardian.lance', h.x, h.y, h.z, 3, 1);
            for (const p of players) {
              if (h.hit!.has(p) || !isSurvivalLike(p.gamemode)) continue;
              if (segDist(p.x, p.y + 1, p.z, h.x, h.y, h.z, h.x1, h.y1, h.z1) < 1.1) {
                h.hit!.add(p);
                survival.damage(p, h.dmg, { source: 'guardian', attacker: f.boss });
              }
            }
          }
          break;
        case 'drop':
          if (!h.dropped) {
            h.dropped = true;
            for (const [x, y, z] of h.cells ?? []) this.change(f.dim, x, y, z, 0);
            this.server.playSound(f.dim, 'guardian.fracture', h.x, h.y, h.z, 3, 0.8);
            this.server.particles(f.dim, 'explosion_smoke', h.x, h.y, h.z, 30, 3);
          }
          break;
        case 'call':
          if (now === h.at) {
            const s = this.server.mobs?.spawn(f.dim, 'guardian_sentinel', h.x, h.y, h.z, { persistent: false, reason: 'boss', data: { guardianCall: true, home: [Math.floor(h.x), Math.floor(h.y), Math.floor(h.z)] } });
            if (s) s.admin = f.cheat;
            this.server.particles(f.dim, 'portal', h.x, h.y + 1, h.z, 30, 0.6);
          }
          break;
        case 'final': {
          // The beam turns a full circle over the sweep
          const k = (now - h.at) / (h.until - h.at);
          const ang = h.x1 + k * Math.PI * 2;
          const ex = h.x + Math.cos(ang) * 18;
          const ez = h.z + Math.sin(ang) * 18;
          if ((now - h.at) % 3 === 0) this.fx(players, { kind: 'laser', id: h.id, x: h.x, y: h.y, z: h.z, x1: ex, y1: h.y, z1: ez, ticks: 4, color: 0xffe0ff });
          for (const p of players) {
            if (h.hit!.has(p) || !isSurvivalLike(p.gamemode)) continue;
            const pa = Math.atan2(p.z - h.z, p.x - h.x);
            const diff = Math.abs(((pa - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            const r = Math.hypot(p.x - h.x, p.z - h.z);
            if (diff > 0.12 || r > 18) continue;
            // Jumping over it or ducking under it: safe
            const air = p.y > f.floorY + 1 + 0.75;
            if (air || p.sneaking) continue;
            h.hit!.add(p);
            f.lanced.add(p.uuid);
            survival.damage(p, h.dmg, { source: 'guardian', attacker: f.boss });
          }
          break;
        }
      }
      if (now >= h.until) {
        this.endHazard(f, h);
        f.hazards.splice(i, 1);
      }
    }
  }

  private endHazard(f: Fight, h: Hazard): void {
    if (h.kind === 'drop' && h.dropped) for (const [x, y, z] of h.cells ?? []) this.putBack(f.dim, x, y, z);
    for (const p of f.bar) p.send({ t: 'fx', kind: 'warn_end', id: h.id });
  }

  private orbTick(f: Fight): void {
    const now = this.server.tickNo;
    for (let i = f.orbs.length - 1; i >= 0; i--) {
      const o = f.orbs[i]!;
      const m = o.m;
      if (m.removed || m.dead || now > o.until) {
        if (!m.removed) m.remove();
        f.orbs.splice(i, 1);
        continue;
      }
      if (now < o.formedAt) continue;
      const t = o.target;
      if (t.dead || t.dim !== f.dim) {
        m.remove();
        continue;
      }
      const dx = t.x - m.x;
      const dy = t.y + 1 - m.y;
      const dz = t.z - m.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const sp = 0.13;
      m.setPos(m.x + (dx / d) * sp, m.y + (dy / d) * sp, m.z + (dz / d) * sp);
      if (d < 1.1) {
        if (isSurvivalLike(t.gamemode)) this.server.interaction.survival.damage(t, GUARDIAN.orbDamage, { source: 'guardian', attacker: f.boss });
        this.server.particles(f.dim, 'void_burst', m.x, m.y, m.z, 16, 0.5);
        m.remove();
      }
    }
  }

  // ------------------------------------------------------------------ damage, death

  /** What a hit does to it (from Mob.hurt): half behind the shield, half as much again with the core exposed. */
  scaleDamage(m: Mob, amount: number, info: HurtInfo): number {
    const f = this.fight;
    if (!f || f.boss !== m) return amount;
    if (f.state === 'rise' || f.state === 'transition' || f.state === 'dying') return info.source === 'kill' ? amount : 0;
    if (this.shieldUp(f)) amount *= GUARDIAN.shieldFactor;
    if (f.state === 'exposed') amount *= GUARDIAN.exposedFactor;
    return amount;
  }

  /** Bosses' deaths (from the mob system): true when it was the Guardian's (or its pylons' and orbs'). */
  onDeath(m: Mob, killer: ServerPlayer | null): boolean {
    if (m.type === 'guardian_pylon' || m.type === 'void_orb') {
      this.server.particles(m.dim, 'void_burst', m.x, m.y + 1, m.z, 20, 0.6);
      this.server.playSound(m.dim, 'guardian.pylon_break', m.x, m.y + 1, m.z, 2, 1);
      return true;
    }
    if (m.type !== 'end_guardian') return false;
    const f = this.fight;
    if (!f || f.boss !== m) return true;
    void killer;
    this.defeated(f, m.admin || f.cheat);
    return true;
  }

  private defeated(f: Fight, cheat: boolean): void {
    if (f.state === 'dying') return;
    this.setState(f, 'dying');
    const st = this.state;
    st.charged = false;
    st.defeatedAt = this.server.level.time;
    st.defeats++;
    const it = this.server.interaction;
    const party = [...this.server.players.values()].filter((p) => f.party.has(p.uuid) && p.dim === f.dim);
    for (const p of party) {
      p.send({ t: 'title', text: 'THE END GUARDIAN HAS FALLEN', ticks: 120 });
      p.send({ t: 'sound', name: 'music.guardian_victory', x: p.x, y: p.y, z: p.z, volume: 1, pitch: 1 });
      if (cheat || this.server.admin.inContext(p)) continue;
      it.grant(p, 'defeat_end_guardian');
      if (!f.lanced.has(p.uuid)) it.grant(p, 'guardian_no_final_lance');
    }
    // Loot, each player their own (a forced defeat gives none)
    if (!f.boss.data.forced) for (const p of party) this.loot(p, cheat || this.server.admin.inContext(p));
    this.server.playSound(f.dim, 'guardian.death', f.boss.x, f.boss.y + 3, f.boss.z, 5, 1);
    for (const e of f.dim.entitiesNear(f.center[0], f.floorY, f.center[2], 40)) if (e instanceof Mob && e.data.guardianCall && !e.dead) e.remove();
    // The altar wants shards again
    const a = this.arena();
    if (a && f.dim.isLoaded(a.altar[0], a.altar[2])) {
      const s = f.dim.getState(...a.altar);
      if (blocks[STATE_BLOCK[s]!]!.id === 'guardian_altar') f.dim.setBlock(a.altar[0], a.altar[1], a.altar[2], withProp(withProp(s, 'charged', false), 'shards', '0'));
    }
  }

  private loot(p: ServerPlayer, cheat: boolean): void {
    const out: ItemStack[] = [stackOf('end_guardian_head', 1)];
    if (!p.endRewards.has('guardian_core') && !cheat) {
      p.endRewards.add('guardian_core');
      out.push(stackOf('guardian_core', 1));
    } else if (this.rng.chance(GUARDIAN_LOOT.coreChance)) out.push(stackOf('guardian_core', 1));
    if (this.rng.chance(GUARDIAN_LOOT.lanceChance)) out.push(stackOf('guardians_lance', 1));
    if (this.rng.chance(GUARDIAN_LOOT.veilChance)) out.push(stackOf('eclipse_veil_module', 1));
    out.push(...rollLoot('chest/end_guardian', { rng: new Random(this.rng.int(1 << 30)), difficulty: this.server.level.difficulty }));
    for (const s of out) {
      const st = cheat ? markAdmin(s) : s;
      const rest = p.inventory.add(st);
      if (rest) this.server.interaction.dropStack(p, rest);
    }
    this.server.interaction.syncInventory(p);
  }

  // ------------------------------------------------------------------ the arena's blocks

  private change(dim: Dimension, x: number, y: number, z: number, state: number): void {
    const key = `${x},${y},${z}`;
    if (!this.restore.has(key)) this.restore.set(key, dim.getState(x, y, z));
    dim.setBlock(x, y, z, state);
    this.save();
  }

  private putBack(dim: Dimension, x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    const st = this.restore.get(key);
    if (st === undefined || !dim.isLoaded(x, z)) return;
    dim.setBlock(x, y, z, st);
    this.restore.delete(key);
    this.save();
  }

  private restoreAll(): void {
    const dim = this.end;
    for (const [key, st] of [...this.restore]) {
      const [x, y, z] = key.split(',').map(Number) as P3;
      if (!dim.isLoaded(x, z)) continue;
      dim.setBlock(x, y, z, st);
      this.restore.delete(key);
    }
    this.save();
  }

  private save(): void {
    const flags = this.server.level.flags as { guardianRestore?: [string, number][] };
    if (this.restore.size) flags.guardianRestore = [...this.restore];
    else delete flags.guardianRestore;
  }

  // ------------------------------------------------------------------ boss bar

  private bars(f: Fight, players: ServerPlayer[]): void {
    if (this.server.tickNo % 5 !== 0 && f.state !== 'dying') return;
    const m = f.boss;
    const progress = Math.max(0, m.health / m.maxHealth);
    for (const p of players) {
      if (!f.bar.has(p)) {
        f.bar.add(p);
        p.send({ t: 'boss', id: m.id, action: 'add', title: 'The End Guardian', progress, color: 'purple' });
      } else p.send({ t: 'boss', id: m.id, action: 'update', progress });
    }
    for (const p of [...f.bar])
      if (!players.includes(p)) {
        f.bar.delete(p);
        p.send({ t: 'boss', id: m.id, action: 'remove' });
      }
  }

  status(): Record<string, unknown> {
    const f = this.fight;
    return { awake: !!f, phase: f?.phase ?? 0, state: f?.state ?? null, health: f ? Math.round(f.boss.health) : null, maxHealth: f ? f.boss.maxHealth : null, charged: this.state.charged, reformsIn: this.reformsIn(), defeats: this.state.defeats };
  }
}

/** Distance from a point to a segment. */
function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const len = vx * vx + vy * vy + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / len));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t), pz - (az + vz * t));
}

void isPlayer;
