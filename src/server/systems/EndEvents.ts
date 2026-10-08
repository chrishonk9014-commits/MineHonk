/**
 * V6 - The End Expansion, phase 5: the End's events (src/common/endExpansion/
 * events.ts), on the server. They take the place of weather in the Expanded
 * End only: the classic End's rings never see a storm or an eclipse.
 *
 * The schedule lives in `level.flags.endEvents`; the temporary blocks the
 * events put down (Storm Remnants, Eclipse Monoliths, Eclipse Shards) in
 * `level.flags.endEventBlocks`, so whatever a restart interrupts is still put
 * back once its chunks load. Players in the End are told the state
 * (`end_event` messages) and draw it themselves in the band.
 *
 * Every hazard follows the fairness pattern: shown first (24 ticks, 32 with
 * company), resolved here when it lands. Debris never breaks a block, the
 * low-gravity pockets never pull anyone anywhere, and nobody is ever left
 * standing on a remnant or a monolith when it goes.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob, isAlive } from '../entity/Mob';
import { FallingBlock } from '../entity/FallingBlock';
import { S, STATE_SOLID, STATE_REPLACEABLE, STATE_FLUID, blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { stackOf, markAdmin, type ItemStack } from '../../common/game/itemstack';
import { Random, hashInts } from '../../common/math/rng';
import { inExpansion } from '../../common/endExpansion/region';
import { DAY, STORM, ECLIPSE, eventTelegraph, type EndEventState, type EndEventsView } from '../../common/endExpansion/events';
import { isSurvivalLike } from '../../common/game/gamemode';

type P3 = [number, number, number];

/** A temporary structure an event put down. */
interface TempStruct {
  id: number;
  kind: 'remnant' | 'monolith';
  /** Each cell and what was there before. */
  cells: [number, number, number, number][];
  box: [number, number, number, number, number, number];
  chest: P3 | null;
  /** Set by the Admin Panel's events (nothing about it counts). */
  cheat?: boolean;
  fading?: boolean;
}

interface EventBlocks {
  structs: TempStruct[];
  /** Eclipse Shards and what was there before. */
  shards: [number, number, number, number][];
  nextId: number;
}

interface Hazard {
  kind: 'debris';
  at: number;
  x: number;
  y: number;
  z: number;
  r: number;
  dmg: number;
  cheat: boolean;
}

/** A low-gravity pocket (storms and the End Guardian's Gravity Well). */
export interface Pocket {
  id: number;
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  r: number;
  from: number;
  until: number;
}

const WARN_DEBRIS = 0x9a6aff;
const WARN_POCKET = 0x7ae0ff;

export class EndEventsSystem {
  /** Randomness (replaceable in tests). */
  rng: { next(): number; int(n: number): number; chance(p: number): boolean };
  private readonly hazards: Hazard[] = [];
  readonly pockets: Pocket[] = [];
  private nextFx = 9_000_000;
  /** Who was out in the band during the storm (uuids). */
  private readonly stormSeen = new Set<string>();
  /** Who has had the eclipse's title (uuids), and who has had monoliths raised near them. */
  private readonly eclipseSeen = new Set<string>();
  private readonly monolithsFor = new Set<string>();
  private remnantsLeft = 0;
  private lastView = '';

  constructor(readonly server: GameServer) {
    this.rng = new Random(hashInts(server.level.seedNum, 0xe7e47));
  }

  private get time(): number {
    return this.server.level.time;
  }

  private get end(): Dimension {
    return this.server.dim('end');
  }

  // ------------------------------------------------------------------ state

  get state(): EndEventState {
    const f = this.server.level.flags as { endEvents?: EndEventState };
    if (!f.endEvents || typeof f.endEvents !== 'object' || !f.endEvents.storm || !f.endEvents.eclipse) {
      const t = this.time;
      f.endEvents = {
        storm: { phase: 'calm', warnAt: t + this.stormGap(), startAt: 0, endAt: 0 },
        eclipse: { active: false, startAt: 0, endAt: 0, rolledDay: Math.floor(t / DAY), lastDay: -1 },
      };
    }
    return f.endEvents;
  }

  private get blocks(): EventBlocks {
    const f = this.server.level.flags as { endEventBlocks?: EventBlocks };
    const b = f.endEventBlocks;
    if (!b || !Array.isArray(b.structs) || !Array.isArray(b.shards)) f.endEventBlocks = { structs: [], shards: [], nextId: 1 };
    return f.endEventBlocks!;
  }

  /** Ticks to the next storm's warning: 2-4 days on. */
  private stormGap(): number {
    return Math.floor((STORM.minGapDays + this.rng.next() * (STORM.maxGapDays - STORM.minGapDays)) * DAY) - STORM.warnTicks;
  }

  /** Whether the storm is raging at a place (the Expanded End only). */
  storming(dim: { id: string }, x: number, z: number): boolean {
    return dim.id === 'end' && this.state.storm.phase === 'active' && inExpansion(x, z);
  }

  eclipsed(dim: { id: string }, x: number, z: number): boolean {
    return dim.id === 'end' && this.state.eclipse.active && inExpansion(x, z);
  }

  /** The phase 4 hook: the Void Collector draws four times as much in a storm. */
  voidStormFactor(dim: Dimension, x: number, z: number): number {
    return this.storming(dim, x, z) ? STORM.voidBoost : 1;
  }

  /** Crystal Generators burn hotter in a storm. */
  crystalFactor(dim: Dimension, x: number, z: number): number {
    return this.storming(dim, x, z) ? STORM.crystalBoost : 1;
  }

  /** Void Stalkers and Chorus Beasts follow further in a storm. */
  followFactor(m: Mob): number {
    return (m.type === 'void_stalker' || m.type === 'chorus_beast') && this.storming(m.dim, m.x, m.z) ? STORM.followBoost : 1;
  }

  /** In a low-gravity pocket (storms, the Guardian's well)? */
  pocketAt(dim: Dimension, x: number, y: number, z: number): Pocket | null {
    const now = this.server.tickNo;
    for (const p of this.pockets) if (p.dim === dim && now >= p.from && now < p.until && Math.hypot(x - p.x, z - p.z) <= p.r && y >= p.y - 2 && y <= p.y + p.r + 4) return p;
    return null;
  }

  view(): EndEventsView {
    const st = this.state;
    const t = this.time;
    const v: EndEventsView = {
      storm: st.storm.phase,
      stormLeft: st.storm.phase === 'warning' ? Math.max(0, st.storm.startAt - t) : st.storm.phase === 'active' ? Math.max(0, st.storm.endAt - t) : 0,
      eclipse: st.eclipse.active,
      eclipseLeft: st.eclipse.active ? Math.max(0, st.eclipse.endAt - t) : 0,
    };
    const c = this.server.citadel?.plan;
    if (st.eclipse.active && c) v.citadel = c.entrance;
    return v;
  }

  private inBand(p: ServerPlayer): boolean {
    return !p.dead && p.dim.id === 'end' && inExpansion(p.x, p.z);
  }

  private bandPlayers(): ServerPlayer[] {
    return [...this.server.players.values()].filter((p) => this.inBand(p));
  }

  private company(p: ServerPlayer): boolean {
    for (const o of this.server.players.values()) if (o !== p && o.dim === p.dim && !o.dead && o.distanceSq(p.x, p.y, p.z) < 32 * 32) return true;
    return false;
  }

  private fxNear(dim: Dimension, x: number, z: number, msg: Record<string, unknown>): void {
    for (const p of this.server.players.values()) if (p.dim === dim && (p.x - x) ** 2 + (p.z - z) ** 2 < 96 * 96) p.send({ t: 'fx', ...msg } as never);
  }

  private banner(p: ServerPlayer, text: string, ticks = 60): void {
    p.send({ t: 'fx', kind: 'hack', text, strength: 0, ticks });
  }

  // ------------------------------------------------------------------ the schedule

  tick(): void {
    const st = this.state;
    const t = this.time;
    // Storms
    const s = st.storm;
    if (s.phase === 'calm' && t >= s.warnAt) {
      // Never during an eclipse (nor while one is due): it comes the day after
      if (st.eclipse.active || (st.eclipse.startAt > t && st.eclipse.startAt - t < STORM.warnTicks + STORM.maxTicks)) s.warnAt = Math.max(st.eclipse.endAt, st.eclipse.startAt + ECLIPSE.ticks) + DAY / 2;
      else this.warnStorm(false);
    } else if (s.phase === 'warning' && t >= s.startAt) this.beginStorm();
    else if (s.phase === 'active') {
      if (t >= s.endAt) this.endStorm();
      else this.stormTick();
    }
    // Eclipses: rolled once a day, at least 20 days apart
    const e = st.eclipse;
    const day = Math.floor(t / DAY);
    if (!e.active && day > e.rolledDay) {
      for (let d = Math.max(e.rolledDay + 1, day - 30); d <= day; d++) {
        if (e.startAt > t) break;
        if (e.lastDay >= 0 && d - e.lastDay < ECLIPSE.minGapDays) continue;
        if (this.rng.chance(ECLIPSE.chancePerDay)) {
          e.startAt = Math.max(t, d * DAY + ECLIPSE.startOfDay);
          e.lastDay = d;
          break;
        }
      }
      e.rolledDay = day;
    }
    if (!e.active && e.startAt > 0 && t >= e.startAt && t < e.startAt + ECLIPSE.ticks) {
      // A storm in progress gives way first
      if (s.phase === 'calm') this.beginEclipse(false);
    } else if (!e.active && e.startAt > 0 && t >= e.startAt + ECLIPSE.ticks) e.startAt = 0;
    if (e.active) {
      if (t >= e.endAt) this.endEclipse();
      else this.eclipseTick();
    }
    this.hazardTick();
    this.restoreTick();
    // Everyone in the End hears of changes, and every few seconds anyway
    const view = this.view();
    const key = JSON.stringify({ ...view, stormLeft: 0, eclipseLeft: 0 });
    if (key !== this.lastView || this.server.tickNo % 100 === 0) {
      this.lastView = key;
      for (const p of this.server.players.values()) if (p.dim.id === 'end') p.send({ t: 'end_event', ...view });
    }
  }

  /** A player arrived in the End (or joined): tell them now. */
  sync(p: ServerPlayer): void {
    if (p.dim.id === 'end') p.send({ t: 'end_event', ...this.view() });
  }

  // ------------------------------------------------------------------ Void Storms

  /** A minute's warning: the sky dims, the void rumbles, a banner. */
  warnStorm(cheat: boolean): void {
    const s = this.state.storm;
    s.phase = 'warning';
    s.warnAt = this.time;
    s.startAt = this.time + STORM.warnTicks;
    s.endAt = 0;
    if (cheat) s.cheat = true;
    else delete s.cheat;
    for (const p of this.bandPlayers()) {
      this.banner(p, 'VOID STORM APPROACHING', 80);
      p.send({ t: 'sound', name: 'storm.rumble', x: p.x, y: p.y, z: p.z, volume: 1, pitch: 0.8 });
    }
  }

  beginStorm(): void {
    const s = this.state.storm;
    s.phase = 'active';
    s.startAt = this.time;
    s.endAt = this.time + STORM.minTicks + this.rng.int(STORM.maxTicks - STORM.minTicks + 1);
    this.stormSeen.clear();
    this.remnantsLeft = STORM.remnants[0] + this.rng.int(STORM.remnants[1] - STORM.remnants[0] + 1);
    for (const p of this.bandPlayers()) p.send({ t: 'sound', name: 'storm.break', x: p.x, y: p.y, z: p.z, volume: 1, pitch: 1 });
  }

  /** Admin Panel: a storm now (with its warning cut short), or stop the one there is. */
  startStorm(cheat: boolean): void {
    this.warnStorm(cheat);
    this.state.storm.startAt = this.time + 60;
  }

  stopStorm(): void {
    const s = this.state.storm;
    if (s.phase === 'calm') return;
    s.endAt = this.time;
    if (s.phase === 'warning') {
      s.phase = 'calm';
      s.warnAt = this.time + this.stormGap();
    } else this.endStorm();
  }

  private endStorm(): void {
    const s = this.state.storm;
    const cheat = !!s.cheat;
    s.phase = 'calm';
    // The next one: 2-4 days after this one began
    s.warnAt = Math.max(this.time + DAY / 2, s.startAt + this.stormGap() + STORM.warnTicks) - STORM.warnTicks;
    delete s.cheat;
    // Remnants fade (anyone on them is set down safely; what their chests held is dropped)
    for (const r of this.blocks.structs.filter((x) => x.kind === 'remnant')) this.removeStruct(r);
    // Everyone who weathered it out in the band
    if (!cheat)
      for (const p of this.bandPlayers()) {
        if (!this.stormSeen.has(p.uuid) || this.server.admin.inContext(p) || !isSurvivalLike(p.gamemode)) continue;
        this.server.interaction.grant(p, 'survive_void_storm');
      }
    this.stormSeen.clear();
    this.pockets.length = 0;
    for (const p of this.server.players.values()) if (p.dim.id === 'end') p.send({ t: 'sound', name: 'storm.end', x: p.x, y: p.y, z: p.z, volume: 0.8, pitch: 1 });
  }

  private stormTick(): void {
    const s = this.state.storm;
    const now = this.server.tickNo;
    const players = this.bandPlayers();
    for (const p of players) this.stormSeen.add(p.uuid);
    for (const p of players) {
      if (!isSurvivalLike(p.gamemode) && p.gamemode !== 'creative') continue;
      if (this.rng.chance(1 / STORM.debrisEvery)) this.debris(p, !!s.cheat);
      if (this.rng.chance(1 / STORM.pocketEvery)) this.pocketNear(p);
    }
    // Storm Remnants near players (1-2 a storm)
    if (this.remnantsLeft > 0 && players.length && now % 40 === 0) {
      const p = players[this.rng.int(players.length)]!;
      if (this.buildRemnant(p, !!s.cheat)) this.remnantsLeft--;
    }
    // Their last 30 seconds: they flicker, with a warning
    const left = s.endAt - this.time;
    if (left <= STORM.fadeWarnTicks)
      for (const r of this.blocks.structs) {
        if (r.kind !== 'remnant') continue;
        if (!r.fading) {
          r.fading = true;
          for (const p of this.nearStruct(r, 40)) this.banner(p, 'THE REMNANT IS FADING', 60);
        }
        if (now % 10 === 0) this.flicker(r, S('remnant_stone'), S('fading_remnant'));
      }
    // Endlings hide; the mobs' boldness is read from storming()
    if (now % 40 === 0) this.endlingsHide(players);
  }

  /** Void Debris: a marked impact near a player, then the stone falling onto it. */
  private debris(p: ServerPlayer, cheat: boolean): void {
    const dim = p.dim;
    const x = Math.floor(p.x + (this.rng.next() * 2 - 1) * STORM.debrisRange);
    const z = Math.floor(p.z + (this.rng.next() * 2 - 1) * STORM.debrisRange);
    if (!dim.isLoaded(x, z) || !inExpansion(x, z)) return;
    // Lands on the first solid block from above (over the void: nothing to land on)
    let y = -1;
    for (let yy = Math.min(250, Math.floor(p.y) + 30); yy >= Math.max(1, Math.floor(p.y) - 30); yy--) {
      if (STATE_SOLID[dim.getState(x, yy, z)]) {
        y = yy + 1;
        break;
      }
    }
    if (y < 0) return;
    const tele = eventTelegraph(this.company(p));
    const at = this.server.tickNo + tele;
    this.hazards.push({ kind: 'debris', at, x: x + 0.5, y, z: z + 0.5, r: STORM.debrisRadius, dmg: STORM.debrisDamage, cheat });
    this.fxNear(dim, x, z, { kind: 'warn_circle', id: this.nextFx++, x: x + 0.5, y: y + 0.05, z: z + 0.5, r: STORM.debrisRadius, ticks: tele, color: WARN_DEBRIS });
    // The stone itself, timed to land as the warning ends (it shatters, never settles)
    const fall = this.fallHeight(tele);
    const fb = new FallingBlock(S('remnant_stone'));
    fb.shatter = true;
    fb.persistent = false;
    fb.setPos(x + 0.5, y + fall, z + 0.5);
    dim.addEntity(fb);
  }

  /** How far a falling block drops in `ticks` (its own gravity and drag). */
  private fallHeight(ticks: number): number {
    let vy = 0;
    let y = 0;
    for (let i = 0; i < ticks; i++) {
      vy -= 0.04;
      y += vy;
      vy *= 0.98;
    }
    return -y;
  }

  private pocketNear(p: ServerPlayer): void {
    const dim = p.dim;
    const a = this.rng.next() * Math.PI * 2;
    const d = 3 + this.rng.next() * 8;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    this.addPocket(dim, x, p.y, z, STORM.pocketRadius, eventTelegraph(this.company(p)), STORM.pocketTicks);
  }

  /** A low-gravity pocket: marked first, then swirling for its time (the client floats inside it). */
  addPocket(dim: Dimension, x: number, y: number, z: number, r: number, tele: number, ticks: number): Pocket {
    const now = this.server.tickNo;
    const pk: Pocket = { id: this.nextFx++, dim, x, y, z, r, from: now + tele, until: now + tele + ticks };
    this.pockets.push(pk);
    this.fxNear(dim, x, z, { kind: 'warn_circle', id: pk.id, x, y: y + 0.05, z, r, ticks: tele, color: WARN_POCKET });
    return pk;
  }

  private hazardTick(): void {
    const now = this.server.tickNo;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]!;
      if (now < h.at) continue;
      this.hazards.splice(i, 1);
      const dim = this.end;
      this.server.particles(dim, 'explosion_smoke', h.x, h.y + 0.3, h.z, 14, 0.8);
      this.server.particles(dim, 'void_burst', h.x, h.y + 0.3, h.z, 10, 0.6);
      this.server.playSound(dim, 'storm.debris', h.x, h.y, h.z, 1.2, 0.8 + this.rng.next() * 0.3);
      for (const p of this.server.players.values()) {
        if (p.dim !== dim || p.dead || !isSurvivalLike(p.gamemode)) continue;
        if (Math.hypot(p.x - h.x, p.z - h.z) <= h.r && p.y >= h.y - 1 && p.y <= h.y + 2.5) this.server.interaction.survival.damage(p, h.dmg, { source: 'void_debris' });
      }
    }
    // Pockets: activated (the swirl), expired
    for (let i = this.pockets.length - 1; i >= 0; i--) {
      const pk = this.pockets[i]!;
      if (now === pk.from) this.fxNear(pk.dim, pk.x, pk.z, { kind: 'zone', id: pk.id, x: pk.x, y: pk.y, z: pk.z, r: pk.r, ticks: pk.until - pk.from, text: 'lowgrav' });
      if (now >= pk.until) {
        this.pockets.splice(i, 1);
        this.fxNear(pk.dim, pk.x, pk.z, { kind: 'zone_end', id: pk.id });
      }
    }
  }

  /** Endlings out under the storm teleport into cover. */
  private endlingsHide(players: ServerPlayer[]): void {
    const seen = new Set<Mob>();
    for (const p of players)
      for (const e of p.dim.entitiesNear(p.x, p.y, p.z, 48)) {
        if (!(e instanceof Mob) || e.type !== 'endling' || e.dead || seen.has(e)) continue;
        seen.add(e);
        if (this.covered(e.dim, Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))) continue;
        const spot = this.coverNear(e.dim, Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
        if (!spot) continue;
        this.server.particles(e.dim, 'portal', e.x, e.y + 0.4, e.z, 10, 0.3);
        e.setPos(spot[0] + 0.5, spot[1], spot[2] + 0.5);
        e.stopNavigation();
        this.server.playSound(e.dim, 'mob.endling.blink', e.x, e.y, e.z, 0.6, 1.4);
      }
  }

  private covered(dim: Dimension, x: number, y: number, z: number): boolean {
    for (let dy = 1; dy <= 6; dy++) if (STATE_SOLID[dim.getState(x, y + dy, z)]) return true;
    return false;
  }

  private coverNear(dim: Dimension, x: number, y: number, z: number): P3 | null {
    for (let r = 1; r <= 10; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (let dy = -3; dy <= 3; dy++) {
            const sx = x + dx;
            const sy = y + dy;
            const sz = z + dz;
            if (!dim.isLoaded(sx, sz)) continue;
            if (STATE_SOLID[dim.getState(sx, sy - 1, sz)] && !STATE_SOLID[dim.getState(sx, sy, sz)] && !STATE_FLUID[dim.getState(sx, sy, sz)] && this.covered(dim, sx, sy, sz)) return [sx, sy, sz];
          }
        }
    return null;
  }

  // ------------------------------------------------------------------ the End Eclipse

  beginEclipse(cheat: boolean): void {
    const e = this.state.eclipse;
    e.active = true;
    e.startAt = this.time;
    e.endAt = this.time + ECLIPSE.ticks;
    if (cheat) e.cheat = true;
    else delete e.cheat;
    this.eclipseSeen.clear();
    this.monolithsFor.clear();
  }

  /** Admin Panel: an eclipse now, or end the one there is. */
  startEclipse(cheat: boolean): void {
    const s = this.state.storm;
    if (s.phase !== 'calm') this.stopStorm();
    this.beginEclipse(cheat);
  }

  stopEclipse(): void {
    if (!this.state.eclipse.active) return;
    this.state.eclipse.endAt = this.time;
    this.endEclipse();
  }

  private endEclipse(): void {
    const e = this.state.eclipse;
    e.active = false;
    e.startAt = 0;
    delete e.cheat;
    // Shards dissolve; monoliths fade (safely)
    const b = this.blocks;
    const keep: EventBlocks['shards'] = [];
    for (const c of b.shards) if (!this.unset(c, 'eclipse_shard_growth')) keep.push(c);
    b.shards = keep;
    for (const m of b.structs.filter((x) => x.kind === 'monolith')) this.removeStruct(m);
    this.eclipseSeen.clear();
    this.monolithsFor.clear();
  }

  private eclipseTick(): void {
    const e = this.state.eclipse;
    const now = this.server.tickNo;
    const cheat = !!e.cheat;
    for (const p of this.bandPlayers()) {
      // The title, once each (and the advancement for seeing it)
      if (!this.eclipseSeen.has(p.uuid)) {
        this.eclipseSeen.add(p.uuid);
        p.send({ t: 'title', text: 'THE END ECLIPSE', ticks: 100 });
        p.send({ t: 'sound', name: 'music.eclipse', x: p.x, y: p.y, z: p.z, volume: 1, pitch: 1 });
        if (!cheat && !this.server.admin.inContext(p)) this.server.interaction.grant(p, 'witness_end_eclipse');
      }
      // Monoliths rise near each player (2-3 each)
      if (!this.monolithsFor.has(p.uuid) && now % 20 === 0) {
        const want = ECLIPSE.monoliths[0] + this.rng.int(ECLIPSE.monoliths[1] - ECLIPSE.monoliths[0] + 1);
        let n = 0;
        for (let i = 0; i < 12 && n < want; i++) if (this.buildMonolith(p, cheat)) n++;
        if (n > 0) this.monolithsFor.add(p.uuid);
      }
      // Shards grow on the islands
      if (this.rng.chance(1 / ECLIPSE.shardEvery)) this.growShard(p);
      // Eclipsed End Phantoms are common now (two at most around anyone)
      if (now % 200 === 0 && this.server.level.rules.doMobSpawning && this.server.endMobs?.spawning) this.eclipsePhantom(p, cheat);
    }
    // Dawn: the monoliths flicker, with a warning
    if (e.endAt - this.time <= ECLIPSE.fadeWarnTicks)
      for (const m of this.blocks.structs) {
        if (m.kind !== 'monolith') continue;
        if (!m.fading) {
          m.fading = true;
          for (const p of this.nearStruct(m, 40)) this.banner(p, 'THE MONOLITH IS FADING', 60);
        }
        if (now % 10 === 0) this.flicker(m, S('monolith_obsidian'), S('fading_monolith'));
      }
  }

  private eclipsePhantom(p: ServerPlayer, cheat: boolean): void {
    const near = p.dim.entitiesNear(p.x, p.y, p.z, 48).filter((e) => e instanceof Mob && e.type === 'end_phantom' && !e.dead && e.data.eclipsed).length;
    if (near >= ECLIPSE.phantomsPerPlayer) return;
    const a = this.rng.next() * Math.PI * 2;
    const x = p.x + Math.cos(a) * 24;
    const z = p.z + Math.sin(a) * 24;
    const y = Math.min(240, p.y + 18 + this.rng.int(8));
    if (!p.dim.isLoaded(x, z) || STATE_SOLID[p.dim.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) return;
    const m = this.server.mobs?.spawn(p.dim, 'end_phantom', x, y, z, { reason: 'natural' });
    if (!m) return;
    m.data.homeX = m.x;
    m.data.homeY = m.y;
    m.data.homeZ = m.z;
    m.data.eclipsed = true;
    if (cheat) m.admin = true;
    m.metaDirty = true;
  }

  private growShard(p: ServerPlayer): void {
    const dim = p.dim;
    const b = this.blocks;
    let near = 0;
    for (const [x, , z] of b.shards) if ((x - p.x) ** 2 + (z - p.z) ** 2 < ECLIPSE.shardRange ** 2) near++;
    if (near >= ECLIPSE.shardsNear) return;
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(p.x + (this.rng.next() * 2 - 1) * ECLIPSE.shardRange);
      const z = Math.floor(p.z + (this.rng.next() * 2 - 1) * ECLIPSE.shardRange);
      if (!dim.isLoaded(x, z) || !inExpansion(x, z)) continue;
      const y = this.surface(dim, x, Math.floor(p.y), z);
      if (y === null || dim.getState(x, y, z) !== 0) continue;
      if (this.server.citadel?.covers(x, y, z)) continue;
      dim.setBlock(x, y, z, S('eclipse_shard_growth'));
      b.shards.push([x, y, z, 0]);
      this.server.particles(dim, 'crystal_glint', x + 0.5, y + 0.4, z + 0.5, 6, 0.3);
      return;
    }
  }

  /** An Eclipse Shard mined (the advancement). */
  onMined(p: ServerPlayer, id: string, cheat: boolean): void {
    if (id !== 'eclipse_shard_growth') return;
    const b = this.blocks;
    b.shards = b.shards.filter(([x, y, z]) => p.dim.getState(x, y, z) === S('eclipse_shard_growth'));
    if (!cheat && !this.state.eclipse.cheat && !this.server.admin.inContext(p)) this.server.interaction.grant(p, 'mine_eclipse_shard');
  }

  /** A chest opened: a Storm Remnant's counts as looting one. */
  onChestOpened(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): void {
    const r = this.blocks.structs.find((s) => s.chest && s.chest[0] === x && s.chest[1] === y && s.chest[2] === z);
    if (!r || r.kind !== 'remnant' || r.cheat || this.server.admin.inContext(p)) return;
    void dim;
    this.server.interaction.grant(p, 'loot_storm_remnant');
  }

  // ------------------------------------------------------------------ temporary structures

  /** The top of the land in a column near a height (where something can stand), or null. */
  private surface(dim: Dimension, x: number, y: number, z: number): number | null {
    for (let yy = Math.min(250, y + 12); yy >= Math.max(2, y - 20); yy--) {
      const s = dim.getState(x, yy, z);
      if (STATE_SOLID[s] && dim.getState(x, yy + 1, z) === 0 && dim.getState(x, yy + 2, z) === 0) return yy + 1;
    }
    return null;
  }

  private free(dim: Dimension, cells: P3[]): boolean {
    for (const [x, y, z] of cells) {
      if (!dim.isLoaded(x, z) || y < 1 || y > 250) return false;
      const s = dim.getState(x, y, z);
      if (s !== 0 && !STATE_REPLACEABLE[s]) return false;
      if (this.server.citadel?.covers(x, y, z)) return false;
    }
    return true;
  }

  private place(dim: Dimension, kind: TempStruct['kind'], cells: [number, number, number, number][], chest: P3 | null, loot: string, cheat: boolean): TempStruct {
    const b = this.blocks;
    const prev: TempStruct['cells'] = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, y, z, s] of cells) {
      prev.push([x, y, z, dim.getState(x, y, z)]);
      dim.setBlock(x, y, z, s);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      z1 = Math.max(z1, z);
    }
    const st: TempStruct = { id: b.nextId++, kind, cells: prev, box: [x0, y0, z0, x1, y1, z1], chest, ...(cheat ? { cheat: true } : {}) };
    if (chest) {
      prev.push([chest[0], chest[1], chest[2], dim.getState(chest[0], chest[1], chest[2])]);
      dim.setBlock(chest[0], chest[1], chest[2], S('chest'));
      dim.setBlockEntity(chest[0], chest[1], chest[2], { type: 'chest', loot, lootSeed: hashInts(this.server.level.seedNum, chest[0], chest[1], chest[2], this.time) });
      if (cheat) this.server.admin.setBlockMark(dim, chest[0], chest[1], chest[2], true);
    }
    b.structs.push(st);
    this.server.particles(dim, 'portal', (x0 + x1) / 2 + 0.5, (y0 + y1) / 2, (z0 + z1) / 2 + 0.5, 60, 2.5);
    this.server.playSound(dim, kind === 'remnant' ? 'storm.remnant' : 'eclipse.monolith', (x0 + x1) / 2, y0, (z0 + z1) / 2, 2, 1);
    return st;
  }

  /** A Storm Remnant: a small floating ruin with a chest, out in the air near a player. */
  buildRemnant(p: ServerPlayer, cheat: boolean): TempStruct | null {
    const dim = p.dim;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = 12 + this.rng.next() * 12;
      const ox = Math.floor(p.x + Math.cos(a) * d);
      const oz = Math.floor(p.z + Math.sin(a) * d);
      const oy = Math.floor(p.y) + this.rng.int(5);
      if (!inExpansion(ox, oz)) continue;
      const cells: [number, number, number, number][] = [];
      const bricks = S('remnant_bricks');
      const stone = S('remnant_stone');
      const salt = hashInts(ox, oy, oz);
      const r = (x: number, z: number, k: number): number => (hashInts(salt, x, z, k) >>> 0) / 4294967296;
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++) {
          if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
          if ((dx || dz) && r(dx, dz, 1) < 0.08) continue;
          cells.push([ox + dx, oy, oz + dz, bricks]);
          if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) cells.push([ox + dx, oy - 1, oz + dz, stone]);
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) cells.push([ox + dx, oy - 2, oz + dz, stone]);
          // Broken walls round the edge
          if ((Math.abs(dx) === 3 || Math.abs(dz) === 3) && r(dx, dz, 2) < 0.45) {
            const h = 1 + Math.floor(r(dx, dz, 3) * 3);
            for (let dy = 1; dy <= h; dy++) cells.push([ox + dx, oy + dy, oz + dz, stone]);
          }
        }
      for (const [px, pz] of [
        [-2, -2],
        [2, 2],
      ] as const)
        for (let dy = 1; dy <= 4; dy++) cells.push([ox + px, oy + dy, oz + pz, bricks]);
      const chest: P3 = [ox, oy + 1, oz];
      if (!this.free(dim, [...cells.map(([x, y, z]) => [x, y, z] as P3), chest])) continue;
      return this.place(dim, 'remnant', cells, chest, 'chest/storm_remnant', cheat);
    }
    return null;
  }

  /** An Eclipse Monolith: an obsidian and astral pillar on an island near a player, a cache at its foot. */
  buildMonolith(p: ServerPlayer, cheat: boolean): TempStruct | null {
    const dim = p.dim;
    if (this.blocks.structs.filter((s) => s.kind === 'monolith').length >= 12) return null;
    const a = this.rng.next() * Math.PI * 2;
    const d = 14 + this.rng.next() * 22;
    const ox = Math.floor(p.x + Math.cos(a) * d);
    const oz = Math.floor(p.z + Math.sin(a) * d);
    if (!dim.isLoaded(ox, oz) || !inExpansion(ox, oz)) return null;
    const g = this.surface(dim, ox, Math.floor(p.y), oz);
    if (g === null) return null;
    // On firm ground: a 3x3 of solid land under it
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!STATE_SOLID[dim.getState(ox + dx, g - 1, oz + dz)]) return null;
    const cells: [number, number, number, number][] = [];
    const obs = S('monolith_obsidian');
    const astral = S('monolith_astral');
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells.push([ox + dx, g, oz + dz, obs]);
    const h = 8 + this.rng.int(5);
    for (let dy = 1; dy <= h; dy++) for (const [px, pz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) cells.push([ox + px, g + dy, oz + pz, dy % 3 === 0 ? astral : obs]);
    cells.push([ox, g + h + 1, oz, astral]);
    const chest: P3 = [ox - 2, g, oz];
    if (!STATE_SOLID[dim.getState(chest[0], chest[1] - 1, chest[2])]) return null;
    if (!this.free(dim, [...cells.map(([x, y, z]) => [x, y, z] as P3), chest])) return null;
    return this.place(dim, 'monolith', cells, chest, 'chest/eclipse_monolith', cheat);
  }

  private nearStruct(s: TempStruct, r: number): ServerPlayer[] {
    const [x0, , z0, x1, , z1] = s.box;
    return [...this.server.players.values()].filter((p) => p.dim.id === 'end' && !p.dead && p.x > x0 - r && p.x < x1 + r && p.z > z0 - r && p.z < z1 + r);
  }

  /** Its blocks flicker between two looks (solid all the while). */
  private flicker(s: TempStruct, a: number, b: number): void {
    const dim = this.end;
    const remnantish = new Set([S('remnant_stone'), S('remnant_bricks'), S('monolith_obsidian'), S('monolith_astral'), S('fading_remnant'), S('fading_monolith')]);
    const on = Math.floor(this.server.tickNo / 10) % 2 === 0;
    for (const [x, y, z] of s.cells) {
      if (!dim.isLoaded(x, z)) continue;
      const cur = dim.getState(x, y, z);
      if (!remnantish.has(cur)) continue;
      // Every other block, alternating
      if ((x + y + z) % 2 === (on ? 0 : 1)) dim.setBlock(x, y, z, b);
      else dim.setBlock(x, y, z, a);
    }
  }

  /** Puts a temporary structure away: players on it set down on solid ground, its chest's contents dropped there. */
  private removeStruct(s: TempStruct): boolean {
    const dim = this.end;
    for (const [x, , z] of s.cells) if (!dim.isLoaded(x, z)) return false;
    const [x0, y0, z0, x1, y1, z1] = s.box;
    const own = new Set(s.cells.map(([x, y, z]) => `${x},${y},${z}`));
    for (const p of this.server.players.values()) {
      if (p.dim !== dim || p.dead) continue;
      if (p.x >= x0 - 1 && p.x <= x1 + 2 && p.z >= z0 - 1 && p.z <= z1 + 2 && p.y >= y0 - 1 && p.y <= y1 + 4) {
        const to = this.safeGround(dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), own);
        if (to) this.server.teleport(p, to[0] + 0.5, to[1], to[2] + 0.5);
      }
    }
    if (s.chest) {
      const [cx, cy, cz] = s.chest;
      const ct = this.server.interaction.containers;
      if (dim.getState(cx, cy, cz) === S('chest')) {
        const inv = ct.containerAt(dim, cx, cy, cz, 27, 'chest');
        const to = this.safeGround(dim, cx, cy, cz, own) ?? [cx, cy, cz];
        for (let i = 0; i < inv.size; i++) {
          const st = inv.get(i) as ItemStack | null;
          if (!st) continue;
          this.server.mining.dropItem(dim, to[0] + 0.5, to[1] + 0.3, to[2] + 0.5, s.cheat ? markAdmin({ ...st }) : st);
          inv.set(i, null);
        }
        ct.forget(dim, cx, cy, cz);
        dim.setBlockEntity(cx, cy, cz, undefined);
      }
    }
    const temp = new Set([S('remnant_stone'), S('remnant_bricks'), S('fading_remnant'), S('monolith_obsidian'), S('monolith_astral'), S('fading_monolith'), S('chest')]);
    for (const [x, y, z, prev] of s.cells) if (temp.has(dim.getState(x, y, z))) dim.setBlock(x, y, z, prev);
    if (s.chest) this.server.admin.setBlockMark(dim, s.chest[0], s.chest[1], s.chest[2], false);
    this.server.particles(dim, 'portal', (x0 + x1) / 2 + 0.5, (y0 + y1) / 2, (z0 + z1) / 2 + 0.5, 60, 2.5);
    this.server.playSound(dim, 'storm.fade', (x0 + x1) / 2, y0, (z0 + z1) / 2, 1.5, 1);
    const b = this.blocks;
    b.structs = b.structs.filter((x) => x !== s);
    return true;
  }

  /** Puts an Eclipse Shard's cell back (true when it is done with). */
  private unset(c: [number, number, number, number], id: string): boolean {
    const dim = this.end;
    const [x, y, z, prev] = c;
    if (!dim.isLoaded(x, z)) return false;
    if (dim.getState(x, y, z) === S(id)) {
      dim.setBlock(x, y, z, prev);
      this.server.particles(dim, 'crystal_glint', x + 0.5, y + 0.4, z + 0.5, 4, 0.3);
    }
    return true;
  }

  /** The nearest place to stand on solid ground that isn't part of a temporary structure. */
  safeGround(dim: Dimension, x: number, y: number, z: number, own: Set<string>): P3 | null {
    const ok = (sx: number, sy: number, sz: number): boolean => {
      if (own.has(`${sx},${sy - 1},${sz}`) || own.has(`${sx},${sy},${sz}`) || own.has(`${sx},${sy + 1},${sz}`)) return false;
      return STATE_SOLID[dim.getState(sx, sy - 1, sz)] === 1 && !STATE_SOLID[dim.getState(sx, sy, sz)] && !STATE_SOLID[dim.getState(sx, sy + 1, sz)] && !STATE_FLUID[dim.getState(sx, sy, sz)];
    };
    for (let r = 0; r <= 48; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const sx = x + dx;
          const sz = z + dz;
          if (!dim.isLoaded(sx, sz)) continue;
          for (let dy = 0; dy <= 24; dy++) {
            if (ok(sx, y - dy, sz)) return [sx, y - dy, sz];
            if (dy && ok(sx, y + dy, sz)) return [sx, y + dy, sz];
          }
        }
    // Nothing near: the arrival platform
    return this.server.endExpansion?.arrivalSpot() ?? null;
  }

  /** Temporary blocks of events that are over (a restart, an unloaded chunk) go back as their chunks load. */
  private restoreTick(): void {
    if (this.server.tickNo % 40 !== 0) return;
    const st = this.state;
    const b = this.blocks;
    for (const s of [...b.structs]) {
      if (s.kind === 'remnant' && st.storm.phase !== 'active') this.removeStruct(s);
      else if (s.kind === 'monolith' && !st.eclipse.active) this.removeStruct(s);
    }
    if (!st.eclipse.active && b.shards.length) {
      const keep: EventBlocks['shards'] = [];
      for (const c of b.shards) if (!this.unset(c, 'eclipse_shard_growth')) keep.push(c);
      b.shards = keep;
    }
  }

  /** The Admin Panel's status. */
  status(): Record<string, unknown> {
    const b = this.blocks;
    return { ...this.view(), remnants: b.structs.filter((s) => s.kind === 'remnant').length, monoliths: b.structs.filter((s) => s.kind === 'monolith').length, shards: b.shards.length, nextStorm: Math.max(0, this.state.storm.warnAt - this.time) };
  }
}

/** Damage an eclipsed Void Stalker takes. */
export function eclipsedDamage(m: Mob, amount: number): number {
  return m.data.eclipsed && m.type === 'void_stalker' ? amount * ECLIPSE.stalkerDamageTaken : amount;
}

void isAlive;
void blocks;
void STATE_BLOCK;
void stackOf;
