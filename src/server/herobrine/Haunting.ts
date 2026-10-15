/**
 * The Haunting (every world, any time: not seasonal), the shared core. A
 * haunting is one character from the old stories over a timeline
 * (src/common/game/haunting.ts and hauntCast.ts): Herobrine by default, or
 * (V7 phase 4, the Admin Panel only) Null, Green Steve or the Cave Dweller.
 * The core runs what every haunting has in common; each character's part
 * (haunts/*.ts) decides what happens on it:
 *
 *  - the timeline: it only moves while someone is in the world, and it is
 *    saved (level.flags.haunt), so a reload carries on where it was; a reload
 *    during the end goes back to the start of the end (never into the middle
 *    of a cutscene);
 *  - the stages, and each stage's budget of random events per player (more
 *    and more as it goes on), rolled every 10 ticks;
 *  - the character's lines in chat and its fake joins, each once;
 *  - its figures: untouchable, AI-less, never saved copies of its model,
 *    each shown to one player, gone again when the part says so;
 *  - every block it places or takes, recorded (level.flags.hauntBlocks) so
 *    Stop can put the world back exactly; blocks it places are cheat-marked
 *    so they count for nothing; Stop also takes back its monsters, the time
 *    and the weather, and anyone it is holding in a cutscene;
 *  - talking to it: from its "Talks back" moment on, a player's chat may get
 *    an answer, through the voice the server was given (Claude through the
 *    hub, see herobrineVoice.ts) or the character's scripted brain, and only
 *    ever as one line of chat;
 *  - the end: everyone thrown out on the character's end screen; the world
 *    deleted afterwards only if its owner chose that (never an automatic one);
 *  - nobody loses their things to a death while the world is haunted.
 *
 * V7 phase 4, the automatic haunting: Herobrine comes by himself, once, to
 * one world in ten made by a player who beat him for real
 * (level.flags.autoHaunt, rolled when the world was made). It begins
 * quietly after a while of play, runs about 45 minutes, notices what players
 * do, always keeps the world, and is over for good when it ends.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { Mob } from '../entity/Mob';
import { stateOf, blocks, STATE_BLOCK, STATE_SOLID } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { biomeOf } from '../../common/registry/biomes';
import { Random } from '../../common/math/rng';
import { ChatFilter } from '../moderation/ChatFilter';
import { floorNear as floorAt, openAt, solidGround as solidAt } from '../world/drag';
import { cleanVoiceLine, scriptedReply, VOICE_SPEAKER, type VoiceRequest, type VoiceAnswer } from '../../common/game/herobrineVoice';
import { HAUNT_MAX_ANSWERS, HAUNT_MAX_MINUTES, HAUNT_BAN, HAUNT_CHASE_AT, AUTO_HAUNT_MINUTES, AUTO_HAUNT_ENDING, type HauntStatus, type HauntOp, type HauntCharacter, type AutoHauntRoll } from '../../common/game/haunting';
import { HAUNT_CAST, castStage, castEnding, defaultEnding, type HauntNotice } from '../../common/game/hauntCast';
import type { HauntState, Figure, HauntPart, HauntFinish } from './haunts/types';
import { HerobrineHaunt } from './haunts/herobrine';
import { NullHaunt } from './haunts/null';
import { GreenSteveHaunt } from './haunts/greenSteve';
import { CaveDwellerHaunt } from './haunts/caveDweller';

export type { HauntState } from './haunts/types';

/** A block it changed: dimension, position, what was there, what it put. */
type Change = [string, number, number, number, number, number];
const MAX_CHANGES = 4000;

const filter = new ChatFilter([]);

/** What a player has been doing lately (for its noticing, and for what its voice is told). */
interface Doings {
  broken: number[];
  placed: number[];
  torches: number[];
  slept: boolean;
  /** Since when they have been running, been underground, been asleep (ticks; -1: not). */
  runSince: number;
  belowSince: number;
  sleepSince: number;
  /** What has already been noticed (so it is not noticed again at once). */
  noticed: Map<string, number>;
}

/** How long what players did is remembered (ticks). */
const DOINGS_WINDOW = 3 * 60 * 20;
/** Its remarks on what players do (the automatic haunting): at most one this often (ticks). */
const REMARK_EVERY = 60 * 20;

export class HauntingSystem {
  readonly figures: Figure[] = [];
  rng: { next(): number; int(n: number): number } = new Random();
  /** The last darkness each player was sent. */
  readonly dark = new Map<string, number>();
  /** Where each player was over the last few seconds (for the fake lag). */
  readonly trail = new Map<string, [string, number, number, number][]>();
  /** Players whose name has been glitched in chat, until when. */
  readonly glitchedNames = new Map<string, number>();
  private readonly deadNow = new Set<string>();
  /** The last lines of chat (what it is told when someone speaks to it). */
  private readonly history: { from: string; text: string }[] = [];
  private readonly lastAnswer = new Map<string, number>();
  private talking = false;
  private readonly doings = new Map<string, Doings>();
  private lastRemark = -1e9;
  /** A reload during the end goes back to its start (checked once, on the first tick). */
  private resumed = false;
  /** The characters' parts. */
  readonly parts: Readonly<Record<HauntCharacter, HauntPart>>;

  constructor(readonly server: GameServer) {
    this.parts = { herobrine: new HerobrineHaunt(this), null: new NullHaunt(this), green_steve: new GreenSteveHaunt(this), cave_dweller: new CaveDwellerHaunt(this) };
  }

  get state(): HauntState | null {
    const st = this.server.level.flags.haunt as HauntState | undefined;
    return st && typeof st.t === 'number' && typeof st.total === 'number' && st.total > 0 ? st : null;
  }

  /** A haunting is running. */
  get active(): boolean {
    return !!this.state;
  }

  /** Who is haunting (Herobrine when nobody is, or for a haunting from before V7 phase 4). */
  get character(): HauntCharacter {
    const c = this.state?.char;
    return c && c in HAUNT_CAST ? c : 'herobrine';
  }

  /** The part of whoever is haunting. */
  get part(): HauntPart {
    return this.parts[this.character];
  }

  get herobrine(): HerobrineHaunt {
    return this.parts.herobrine as HerobrineHaunt;
  }

  /** A cutscene of its end has this player (the Herobrine story leaves them alone). */
  holds(p: ServerPlayer): boolean {
    return Object.values(this.parts).some((x) => !!x.holds?.(p));
  }

  get changes(): Change[] {
    const f = this.server.level.flags;
    if (!Array.isArray(f.hauntBlocks)) f.hauntBlocks = [];
    return f.hauntBlocks as Change[];
  }

  /** The automatic haunting's roll, if this world had one. */
  get autoRoll(): AutoHauntRoll | null {
    const r = this.server.level.flags.autoHaunt as AutoHauntRoll | undefined;
    return r && typeof r === 'object' && typeof r.after === 'number' ? r : null;
  }

  // ------------------------------------------------------------------ Herobrine's tricks, by their old names

  glitchy(p: ServerPlayer): void {
    this.herobrine.glitchy(p);
  }

  chaos(p: ServerPlayer, st: HauntState, stage: string): void {
    this.herobrine.chaos(p, st, stage);
  }

  summon(p: ServerPlayer, st: HauntState, f: number): void {
    this.herobrine.summon(p, st, f);
  }

  // ------------------------------------------------------------------ the Admin Panel

  admin(
    p: ServerPlayer,
    op: HauntOp,
    minutes?: number,
    erase?: boolean,
    ending?: string,
    character: HauntCharacter = 'herobrine',
    text?: string,
  ): { ok: boolean; text: string; data?: unknown } | Promise<{ ok: boolean; text: string; data?: unknown }> {
    const reply = (ok: boolean, msg: string, extra?: Record<string, unknown>): { ok: boolean; text: string; data: unknown } => ({ ok, text: msg, data: { ...this.status(p), ...extra } });
    const cast = HAUNT_CAST[character];
    switch (op) {
      case 'status':
        return reply(true, '');
      case 'start': {
        if (this.state) return reply(false, 'A haunting is already running. Stop it first.');
        if (erase && this.server.roleOf(p) !== 'owner') return reply(false, "Only the world's owner can choose to have the world deleted at the end.");
        const end = ending ?? defaultEnding(character);
        if (!castEnding(character, end)) return reply(false, `${cast.name} has no such ending.`);
        const mins = minutes ?? cast.defaultMinutes;
        this.server.level.flags.haunt = { t: 0, total: Math.round(mins * 60 * 20), erase: !!erase, by: p.uuid, done: [], ending: end, ...(character !== 'herobrine' ? { char: character } : {}) } satisfies HauntState;
        this.history.length = 0;
        const endName = cast.endings.find((e) => e.id === end)!.name;
        return reply(true, `The haunting has begun${character === 'herobrine' ? '' : ` (${cast.name})`}. It ends in ${mins} minute${mins === 1 ? '' : 's'} (${endName.toLowerCase()})${erase ? ', and then the world is deleted' : ', and the world is kept'}.`);
      }
      case 'stop': {
        const st = this.state;
        if (!st && !this.changes.length && !this.anyHeld()) return reply(false, 'No haunting is running.');
        if (st?.auto) this.autoOver();
        const n = this.stop();
        return reply(true, `The haunting is over.${n ? ` Put back ${n} block${n === 1 ? '' : 's'} it changed.` : ''}`);
      }
      case 'skip': {
        const st = this.state;
        if (!st) return reply(false, 'No haunting is running.');
        st.touched = true;
        const c = HAUNT_CAST[this.character];
        const f = st.t / st.total;
        const next = c.stages.find((s) => s.at > f + 1e-9);
        const to = next ? (next.id === 'finale' ? Math.max(next.at, this.skipToEnd()) : next.at) : 1;
        this.moveTo(st, to);
        return reply(true, next ? `Skipped to: ${next.name}.` : 'Skipped to the end.');
      }
      case 'finale': {
        const st = this.state;
        if (!st) return reply(false, 'No haunting is running.');
        st.touched = true;
        const c = HAUNT_CAST[this.character];
        if (st.t / st.total < c.finaleAt) this.moveTo(st, Math.max(c.finaleAt, this.skipToEnd()));
        return reply(true, `Straight to the end: ${c.stages.find((s) => s.id === 'finale')!.name}.`);
      }
      case 'finale_in': {
        const st = this.state;
        if (!st) return reply(false, 'No haunting is running.');
        const c = HAUNT_CAST[this.character];
        const m = Math.max(0, Math.min(HAUNT_MAX_MINUTES, minutes ?? 0));
        if (st.t / st.total >= c.finaleAt) return reply(false, 'The end has already begun.');
        st.touched = true;
        // The whole stretched or squeezed so that the end begins `m` minutes from now
        const left = Math.max(1, Math.round(m * 60 * 20));
        st.total = Math.max(st.t + 1, Math.ceil((st.t + left) / c.finaleAt));
        return reply(true, m === 0 ? 'The end begins now.' : `The end begins in ${m} minute${m === 1 ? '' : 's'}.`);
      }
      case 'restart': {
        const st = this.state;
        const roll = this.autoRoll;
        if (!roll?.haunted) return reply(false, 'This world has no automatic haunting.');
        if (st && !st.auto) return reply(false, 'Another haunting is running. Stop it first.');
        this.stop();
        this.beginAuto(roll, true);
        return reply(true, 'The automatic haunting starts again from the beginning (put back what it had changed).');
      }
      case 'appear': {
        const ok = this.parts[character].appear(p);
        return reply(ok, ok ? `${cast.name} shows itself near you for a moment.` : 'There was nowhere near you to show it. Try somewhere more open.');
      }
      case 'talk': {
        const said = (text ?? '').trim().slice(0, 200);
        if (!said) return reply(false, 'Say something first.');
        return this.testTalk(p, character, said).then((r) => reply(true, `${r.speaker}: ${r.line} (${r.source === 'claude' ? 'Claude answered' : 'the scripted lines answered'})`, { talk: r }));
      }
    }
  }

  /** Where a skip to the end lands (Herobrine: just before his chase). */
  private skipToEnd(): number {
    return this.character === 'herobrine' ? HAUNT_CHASE_AT - 0.01 : HAUNT_CAST[this.character].finaleAt;
  }

  /** Moves a haunting along to share `to`; what was skipped is not played all at once. */
  private moveTo(st: HauntState, to: number): void {
    st.t = Math.ceil(to * st.total);
    const c = HAUNT_CAST[this.character];
    for (const l of c.lines) if (l.at < to - 1e-9 && !st.done.includes(`line:${l.at}`)) st.done.push(`line:${l.at}`);
    for (const j of this.joinsOf(this.character)) if (j < to - 1e-9 && !st.done.includes(`join:${j}`)) st.done.push(`join:${j}`, `left:${j}`);
  }

  status(p: ServerPlayer): HauntStatus {
    const st = this.state;
    const roll = this.autoRoll;
    return {
      active: !!st,
      stage: st ? castStage(this.character, st.t / st.total).id : null,
      character: this.character,
      auto: !!st?.auto,
      ...(roll?.haunted && !roll.begun && !roll.over ? { autoIn: Math.max(0, Math.floor((roll.after - roll.played) / 20)) } : {}),
      autoState: !roll?.haunted ? 'none' : roll.over ? 'over' : st?.auto ? 'running' : roll.begun ? 'over' : 'waiting',
      elapsed: st ? Math.floor(st.t / 20) : 0,
      total: st ? Math.floor(st.total / 20) : 0,
      erase: !!st?.erase,
      changes: this.changes.length,
      canErase: this.server.roleOf(p) === 'owner',
      ending: st?.ending ?? defaultEnding(this.character),
    };
  }

  private anyHeld(): boolean {
    return [...this.server.players.values()].some((p) => this.holds(p));
  }

  /** Ends the haunting and puts back every block it changed (and its monsters, the time, the weather). Returns how many blocks. */
  stop(): number {
    const s = this.server;
    const st = this.state;
    if (st) this.restoreSky(st);
    for (const part of Object.values(this.parts)) part.reset('stop');
    this.server.level.flags.haunt = undefined;
    this.clearFigures();
    this.clearMobs();
    this.glitchedNames.clear();
    const n = this.putBack();
    for (const p of s.players.values()) this.calm(p);
    this.dark.clear();
    return n;
  }

  /** Every block it changed put back, if nobody changed it since (blocks in chunks not loaded are forgotten). */
  putBack(): number {
    const s = this.server;
    let n = 0;
    const list = this.changes;
    for (let i = list.length - 1; i >= 0; i--) {
      const [d, x, y, z, prev, now] = list[i]!;
      const dim = s.dims.get(d as never);
      if (!dim || !dim.isLoaded(x, z)) continue;
      // Only what is still as it was left (a player may have changed it since)
      if (dim.getState(x, y, z) === now) {
        dim.setBlock(x, y, z, prev);
        s.admin.setBlockMark(dim, x, y, z, false);
        n++;
      }
      list.splice(i, 1);
    }
    // Blocks in chunks that are not loaded are forgotten: the record stays small
    s.level.flags.hauntBlocks = [];
    return n;
  }

  /** The dark gone, for one player (a part takes back anything else it did to the screen). */
  calm(p: ServerPlayer): void {
    p.send({ t: 'fx', kind: 'haunt', strength: 0 });
  }

  /** Sends a player the dark (0..1), when it changed. */
  sendDark(p: ServerPlayer, dark: number, every = 200): void {
    const s = this.server;
    const last = this.dark.get(p.uuid) ?? -1;
    if (Math.abs(last - dark) >= 0.02 || (s.tickNo % every === 0 && dark > 0)) {
      this.dark.set(p.uuid, dark);
      p.send({ t: 'fx', kind: 'haunt', strength: dark * 0.85 });
    }
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    const players = [...s.players.values()];
    if (!this.resumed) {
      this.resumed = true;
      // A world loaded in the middle of the end: back to its start (the ending already decided is kept)
      const st = this.state;
      const at = HAUNT_CAST[this.character].finaleAt;
      if (st && st.t / st.total > at + 1e-9) st.t = Math.ceil(at * st.total);
    }
    this.stepFigures();
    this.autoTick(players);
    const st = this.state;
    if (!st) {
      for (const part of Object.values(this.parts)) part.reset('stop');
      return;
    }
    // The timeline only moves while someone is here
    if (!players.length) return;
    const part = this.part;
    const cast = HAUNT_CAST[this.character];
    st.t++;
    const f = Math.min(1, st.t / st.total);
    const stage = castStage(this.character, f).id;
    this.watchPlayers(st, players, stage, f);
    this.oneOffs(st, f, players);
    if (stage === 'finale') {
      part.finale(st, f, players);
      return;
    }
    // Random events, judged every 10 ticks
    if (s.tickNo % 10 === 0) {
      const i = cast.stages.findIndex((x) => x.id === stage);
      const span = ((cast.stages[i + 1]?.at ?? 1) - cast.stages[i]!.at) * st.total;
      const b = part.budget[stage] ?? {};
      for (const p of players) {
        if (p.dead) continue;
        for (const [kind, n] of Object.entries(b)) {
          // (the block-changing ones stop once it has changed enough)
          if (!n || (BLOCKY.has(kind) && this.changes.length >= MAX_CHANGES)) continue;
          if (this.rng.next() < (n * 10) / Math.max(200, span)) part.event(kind, p, st, stage, f);
        }
      }
    }
    if (s.tickNo % 20 === 0) part.atmosphere(st, f, players);
    part.everyTick?.(st, f, players);
  }

  /** Where everyone has been (the fake lag), who has died since it began, and what they have been doing. */
  private watchPlayers(st: HauntState, players: ServerPlayer[], stage: string, f: number): void {
    const s = this.server;
    for (const p of players) {
      if (p.dead) {
        if (!this.deadNow.has(p.uuid)) {
          this.deadNow.add(p.uuid);
          st.deaths ??= {};
          st.deaths[p.uuid] = (st.deaths[p.uuid] ?? 0) + 1;
          this.noticeNow(p, 'death', st, stage, f);
        }
        continue;
      }
      this.deadNow.delete(p.uuid);
      if (s.tickNo % 10 === 0) {
        const tr = this.trail.get(p.uuid) ?? [];
        tr.push([p.dim.id, p.x, p.y, p.z]);
        if (tr.length > 6) tr.shift();
        this.trail.set(p.uuid, tr);
      }
      if (s.tickNo % 20 !== 0) continue;
      // Running, underground and asleep for a while
      const d = this.doingsOf(p);
      const now = s.tickNo;
      d.runSince = p.sprinting ? (d.runSince < 0 ? now : d.runSince) : -1;
      const below = p.dim.id === 'overworld' && p.dim.getHeight(Math.floor(p.x), Math.floor(p.z)) > p.y + 6;
      d.belowSince = below ? (d.belowSince < 0 ? now : d.belowSince) : -1;
      d.sleepSince = p.sleepingTicks > 0 ? (d.sleepSince < 0 ? now : d.sleepSince) : -1;
      if (d.runSince >= 0 && now - d.runSince > 8 * 20) this.noticeNow(p, 'run', st, stage, f);
      if (d.belowSince >= 0 && now - d.belowSince > 90 * 20) this.noticeNow(p, 'underground', st, stage, f);
      if (d.sleepSince >= 0 && now - d.sleepSince > 2 * 20) {
        d.slept = true;
        this.noticeNow(p, 'sleep', st, stage, f);
      }
    }
  }

  // ------------------------------------------------------------------ what players do

  private doingsOf(p: ServerPlayer): Doings {
    let d = this.doings.get(p.uuid);
    if (!d) this.doings.set(p.uuid, (d = { broken: [], placed: [], torches: [], slept: false, runSince: -1, belowSince: -1, sleepSince: -1, noticed: new Map() }));
    const cut = this.server.tickNo - DOINGS_WINDOW;
    for (const a of [d.broken, d.placed, d.torches]) while (a.length && a[0]! < cut) a.shift();
    return d;
  }

  /** A player broke or placed a block (Mining, Interaction): remembered while the world is haunted. */
  onBlock(p: ServerPlayer, what: 'break' | 'place', blockId: string, x: number, y: number, z: number): void {
    const st = this.state;
    if (!st) return;
    const d = this.doingsOf(p);
    const now = this.server.tickNo;
    const f = st.t / st.total;
    const stage = castStage(this.character, f).id;
    if (what === 'break') {
      d.broken.push(now);
      this.part.notice?.(p, 'break', st, stage, f, [x, y, z]);
      if (d.broken.filter((t) => t > now - 60 * 20).length >= 12) this.noticeNow(p, 'break', st, stage, f, [x, y, z]);
      return;
    }
    d.placed.push(now);
    const torch = blockId === 'torch' || blockId === 'wall_torch';
    if (torch) d.torches.push(now);
    this.part.notice?.(p, torch ? 'torch' : 'build', st, stage, f, [x, y, z]);
    if (torch) this.noticeNow(p, 'torch', st, stage, f, [x, y, z]);
    else if (d.placed.filter((t) => t > now - 60 * 20).length >= 20) this.noticeNow(p, 'build', st, stage, f, [x, y, z]);
  }

  /**
   * Something worth remarking on (the automatic haunting: Herobrine notices
   * what players do). The same thing is not noticed again for a few minutes,
   * and he remarks at most once a minute or so; his remarks are scripted.
   */
  private noticeNow(p: ServerPlayer, what: HauntNotice, st: HauntState, stage: string, f: number, at?: [number, number, number]): void {
    if (!st.auto) return;
    const d = this.doingsOf(p);
    const now = this.server.tickNo;
    if (now - (d.noticed.get(what) ?? -1e9) < 4 * 60 * 20) return;
    d.noticed.set(what, now);
    this.herobrine.react(p, what, stage, now - this.lastRemark >= REMARK_EVERY ? () => (this.lastRemark = now) : null, at);
  }

  /** What a player did lately, for its voice. */
  doingsFacts(p: ServerPlayer): { broken: number; placed: number; torches: number; slept: boolean; running: boolean } {
    const d = this.doingsOf(p);
    return { broken: d.broken.length, placed: d.placed.length, torches: d.torches.length, slept: d.slept, running: p.sprinting };
  }

  // ------------------------------------------------------------------ the automatic haunting

  /** An automatic haunting waiting to begin counts the time played; it begins once there has been enough. */
  private autoTick(players: ServerPlayer[]): void {
    const roll = this.autoRoll;
    if (!roll?.haunted || roll.begun || roll.over || !players.length) return;
    roll.played = (roll.played ?? 0) + 1;
    if (roll.played < roll.after || this.state) return;
    this.beginAuto(roll, false);
  }

  /** Herobrine comes by himself: quietly, nothing announces it. */
  private beginAuto(roll: AutoHauntRoll, touched: boolean): void {
    roll.begun = true;
    roll.over = false;
    this.server.level.flags.haunt = { t: 0, total: AUTO_HAUNT_MINUTES * 60 * 20, erase: false, by: 'auto', done: [], ending: AUTO_HAUNT_ENDING, auto: true, ...(touched ? { touched: true } : {}) } satisfies HauntState;
    this.history.length = 0;
    this.doings.clear();
    this.server.log('[haunting] the automatic haunting has begun');
  }

  /** An automatic haunting is over, for good. */
  private autoOver(): void {
    const roll = this.autoRoll;
    if (roll) roll.over = true;
  }

  // ------------------------------------------------------------------ lines, joins, one-offs

  /** When its fake "joined the world" lines come. */
  joinsOf(c: HauntCharacter): readonly number[] {
    return c === 'herobrine' ? [0.3, 0.6, 0.945] : c === 'green_steve' ? [0.01, 0.3, 0.62] : [];
  }

  /** Its lines in chat and its fake joins, each once, at its moment; then the part's own. */
  private oneOffs(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.server;
    const c = this.character;
    const cast = HAUNT_CAST[c];
    const once = (key: string, at: number): boolean => {
      if (f < at || st.done.includes(key)) return false;
      st.done.push(key);
      return true;
    };
    for (const at of this.joinsOf(c)) {
      if (once(`join:${at}`, at)) s.broadcastChat(`${cast.speaker} joined the world`, 'join');
      // Gone again a few seconds later (sooner in a short haunting)
      if (once(`left:${at}`, at + Math.min(0.01, 120 / st.total))) s.broadcastChat(`${cast.speaker} left the world`, 'leave');
    }
    for (const l of cast.lines) {
      if (!once(`line:${l.at}`, l.at)) continue;
      for (const p of players) this.say(p, l.text.replace('{name}', this.nameFor(c, p.name)), l.loud);
      this.remember(cast.speaker, l.text.replace('{name}', c === 'herobrine' ? 'YOU' : 'you'));
    }
    this.part.oneOffs(st, f, players, once);
  }

  /** A player's name the way a character writes it. */
  nameFor(c: HauntCharacter, name: string): string {
    return c === 'herobrine' ? name.toUpperCase() : c === 'green_steve' ? name : name.toLowerCase();
  }

  /**
   * One line of chat from whoever is haunting, to one player, the way it
   * speaks; `fx`: with its glitch, drain or breath (its loud lines).
   */
  say(p: ServerPlayer, text: string, loud: boolean, fx = loud, c: HauntCharacter = this.character): void {
    const cast = HAUNT_CAST[c];
    // Herobrine's quiet first word comes as ordinary chat; the others always in their own voice
    const kind = c === 'herobrine' ? (loud ? 'herobrine' : 'chat') : c === 'null' ? 'null' : c === 'green_steve' ? 'greensteve' : 'dweller';
    p.send({ t: 'chat', text, kind, from: cast.speaker });
    if (!fx) return;
    if (c === 'herobrine') p.send({ t: 'fx', kind: 'glitch', strength: 0.55, ticks: 18 });
    else if (c === 'cave_dweller') p.send({ t: 'sound', name: 'dweller.breath', x: p.x, y: p.y + 1, z: p.z, volume: 0.7, pitch: 0.9 });
    else if (c === 'null') p.send({ t: 'fx', kind: 'drain', strength: 0.9, ticks: 30 });
  }

  // ------------------------------------------------------------------ figures

  /** An untouchable, AI-less figure of a character (never saved). */
  apparition(dim: Dimension, mob: string, x: number, y: number, z: number, yaw: number, anim: string, extra: Record<string, unknown> = {}): Mob | null {
    const m = this.server.mobs?.spawn(dim, mob, x, y, z, { reason: 'boss', data: { apparition: true, haunting: true, ...extra } });
    if (!m) return null;
    m.noAi = true;
    m.persistent = false;
    m.data.untouchable = true;
    m.data.apparition = true;
    m.data.hbAnim = anim;
    m.yaw = yaw;
    m.headYaw = yaw;
    m.metaDirty = true;
    return m;
  }

  /** One of the current character's figures, for one player. */
  spawnFigure(p: ServerPlayer, kind: string, x: number, y: number, z: number, anim = 'stare', data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, c: HauntCharacter = this.character, mob = HAUNT_CAST[c].mob): Mob | null {
    const m = this.apparition(p.dim, mob, x, y, z, Math.atan2(-(p.x - x), -(p.z - z)), anim, extra);
    if (!m) return null;
    this.figures.push({ m, p, kind, since: this.server.tickNo, seen: 0, data, owner: c });
    return m;
  }

  private stepFigures(): void {
    const s = this.server;
    for (let i = this.figures.length - 1; i >= 0; i--) {
      const fg = this.figures[i]!;
      const { m, p } = fg;
      const gone = m.removed || !s.players.has(p.conn.id) || p.dim !== m.dim;
      let vanish = gone;
      const part = this.parts[fg.owner];
      if (!gone) {
        const age = s.tickNo - fg.since;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        m.body.vx = m.body.vz = 0;
        vanish = !part.stepFigure(fg, age, d);
      }
      if (!vanish) continue;
      if (!m.removed) {
        part.vanish?.(fg, gone);
        if (!m.removed) m.remove();
      }
      if (this.figures[i] === fg) this.figures.splice(i, 1);
    }
  }

  /** Its figures gone (a stage that clears them, Stop, the end). */
  clearFigures(): void {
    for (const f of this.figures) if (!f.m.removed) f.m.remove();
    this.figures.length = 0;
  }

  /** Walks (or runs) a figure towards a player, along the ground, through anything in the way. */
  moveTowards(m: Mob, p: ServerPlayer, speed: number): void {
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(speed, d);
    const nx = m.x + (dx / d) * step;
    const nz = m.z + (dz / d) * step;
    const fy = this.floorNear(m.dim, Math.floor(nx), Math.floor(nz), Math.floor(m.y), 3);
    const ny = fy ?? m.y + Math.sign(p.y - m.y) * Math.min(0.5, Math.abs(p.y - m.y));
    m.setPos(nx, ny, nz);
    m.metaDirty = true;
  }

  /** The name a player's chat appears under: torn up, or Herobrine's, while he has it. */
  chatName(p: ServerPlayer): string | null {
    const until = this.glitchedNames.get(p.uuid);
    if (until === undefined) return null;
    if (this.server.tickNo > until || !this.state) {
      this.glitchedNames.delete(p.uuid);
      return null;
    }
    return this.herobrine.glitchName(p);
  }

  /** What a player said, as everyone sees it (a character may change it: Null erases words). */
  chatText(p: ServerPlayer, text: string): string {
    if (!this.state) return text;
    return this.part.chatText?.(p, text) ?? text;
  }

  // ------------------------------------------------------------------ the sky, monsters

  rememberSky(st: HauntState): void {
    const l = this.server.level;
    st.sky ??= { dayTime: l.dayTime, raining: l.raining, thundering: l.thundering, rainTime: l.rainTime, thunderTime: l.thunderTime };
  }

  restoreSky(st: HauntState): void {
    if (!st.sky) return;
    const l = this.server.level;
    l.dayTime = st.sky.dayTime;
    l.raining = st.sky.raining;
    l.thundering = st.sky.thundering;
    l.rainTime = st.sky.rainTime;
    l.thunderTime = st.sky.thunderTime;
    st.sky = undefined;
    this.server.sendTime();
  }

  /** A monster it sent: cheat-made, never saved, dropping nothing (see Mobs.onMobDeath). */
  markMob(m: Mob, target: ServerPlayer | null): void {
    m.admin = true;
    m.persistent = false;
    m.data.hauntMob = true;
    if (target) m.target = target;
  }

  /** Its monsters gone (Stop, the end). */
  clearMobs(): void {
    for (const d of this.server.dims.values())
      for (const e of [...d.entities.values()]) {
        if (!(e instanceof Mob) || !e.data.hauntMob || e.removed) continue;
        this.server.particles(d, 'glitch', e.x, e.y + 1, e.z, 10, 0.5);
        e.remove();
      }
  }

  // ------------------------------------------------------------------ talking to it

  /** Somebody said something in chat: from its "Talks back" moment on, it may answer. */
  onChat(p: ServerPlayer, text: string): void {
    const s = this.server;
    const st = this.state;
    if (!st) return;
    this.remember(p.name, text);
    const c = this.character;
    const cast = HAUNT_CAST[c];
    const f = st.t / st.total;
    if (f < cast.talkAt || this.talking || this.part.silent?.(false)) return;
    if (c !== 'herobrine' && f >= cast.finaleAt) return;
    if ((st.said ?? 0) >= HAUNT_MAX_ANSWERS) return;
    if (s.tickNo - (this.lastAnswer.get(p.uuid) ?? -1e9) < 100) return;
    // Talking to it nearly always gets an answer; talking about anything else, sometimes
    const addressed = /\b(herobrine|hero|hb|null|green|steve|dweller|cave|you|u|ur|your|yours)\b|\?/i.test(text);
    if (this.rng.next() > (addressed ? 0.9 : 0.35)) return;
    this.talking = true;
    this.lastAnswer.set(p.uuid, s.tickNo);
    st.said = (st.said ?? 0) + 1;
    const req = this.voiceRequest(p, text, c, castStage(c, f).name);
    const started = s.tickNo;
    void this.answer(req).then(({ line }) => {
      // A moment to "type", however fast the answer came
      s.later(Math.max(1, 30 + this.rng.int(30) - (s.tickNo - started)), () => {
        this.talking = false;
        if (!this.state || this.character !== c || this.part.silent?.(true)) return;
        for (const o of s.players.values()) this.say(o, line, true, false);
        if (s.players.has(p.conn.id)) p.send({ t: 'fx', kind: c === 'herobrine' ? 'glitch' : c === 'null' ? 'drain' : 'shake', strength: 0.4, ticks: 12 });
        this.remember(cast.speaker, line);
      });
    });
  }

  /**
   * An answer for a request: the voice's line, cleaned and filtered, or the
   * character's scripted one (and which it was, and why). The voice's text
   * is only ever this one line of chat; nothing in it is acted on.
   */
  private async answer(req: VoiceRequest): Promise<{ line: string; source: 'claude' | 'scripted'; reason?: string }> {
    const s = this.server;
    const c = req.character ?? 'herobrine';
    const timeout = new Promise<null>((res) => setTimeout(() => res(null), 10_000));
    let got: string | VoiceAnswer | null = null;
    if (s.herobrineVoice) got = await Promise.race([s.herobrineVoice(req).catch(() => null), timeout]);
    else got = { text: null, reason: 'off' };
    const raw = typeof got === 'string' ? got : (got?.text ?? null);
    let line = cleanVoiceLine(raw, c);
    let reason = typeof got === 'object' && got && !got.text ? got.reason : got === null ? 'none' : undefined;
    // The same filter as everyone's chat: if it would mask anything, it says something else
    if (line && filter.mask(line).changed) {
      line = null;
      reason = 'unsaid';
    }
    if (line) return { line, source: 'claude' };
    return { line: scriptedReply(req, () => this.rng.next()), source: 'scripted', reason: reason ?? 'none' };
  }

  /** The Admin Panel's test: says `text` to a character, no haunting needed; which voice answered. */
  private async testTalk(p: ServerPlayer, c: HauntCharacter, text: string): Promise<{ line: string; source: 'claude' | 'scripted'; reason?: string; character: HauntCharacter; speaker: string }> {
    const req = this.voiceRequest(p, text, c, 'a test from the Admin Panel (nothing is haunting the world)', true);
    const r = await this.answer(req);
    return { ...r, character: c, speaker: VOICE_SPEAKER[c] };
  }

  remember(from: string, text: string): void {
    this.history.push({ from, text: text.slice(0, 200) });
    if (this.history.length > 10) this.history.shift();
  }

  /**
   * What it knows when someone speaks to it: only things in the game (the
   * player's name in the game, the stage, what is around them, what they
   * have been doing); never anything about the person or their account.
   */
  private voiceRequest(p: ServerPlayer, text: string, c: HauntCharacter, stage: string, test = false): VoiceRequest {
    const s = this.server;
    const st = this.state;
    const held = p.inventory.get(p.selectedSlot);
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const t = s.level.dayTime;
    const d = this.doingsFacts(p);
    return {
      ...(c !== 'herobrine' ? { character: c } : {}),
      player: p.name,
      message: text,
      history: test ? [] : this.history.slice(-9, -1),
      facts: {
        holding: held ? items[held.id]?.def.name : undefined,
        health: Math.round(p.health),
        dimension: p.dim.id === 'overworld' ? 'the overworld' : p.dim.id === 'computer' ? 'the computer' : `the ${p.dim.id}`,
        biome: biomeOf(p.dim.getBiome(x, z)).name,
        night: p.dim.id === 'overworld' ? t > 13000 && t < 23000 : undefined,
        underground: p.dim.getHeight(x, z) > p.y + 5,
        others: [...s.players.values()].filter((o) => o !== p).map((o) => o.name),
        deaths: st?.deaths?.[p.uuid] ?? 0,
        x,
        y: Math.floor(p.y),
        z,
        stage,
        ...(d.broken ? { broken: d.broken } : {}),
        ...(d.placed ? { placed: d.placed } : {}),
        ...(d.torches ? { torches: d.torches } : {}),
        ...(d.slept ? { slept: true } : {}),
        ...(d.running ? { running: true } : {}),
      },
    };
  }

  // ------------------------------------------------------------------ the end

  /**
   * Everyone out, on the character's end screen; the world deleted (by its
   * owner's client) if that was chosen, which an automatic haunting never is.
   * An automatic haunting is over for good, and everyone who saw it through
   * honestly has now experienced a haunting.
   */
  finish(st: HauntState, end: HauntFinish): void {
    const s = this.server;
    const erase = st.erase && !st.auto;
    this.restoreSky(st);
    // Nobody stays wherever its end took them: a kept world finds them where they were
    for (const part of Object.values(this.parts)) part.reset('end');
    if (st.auto) {
      this.autoOver();
      if (!st.touched) for (const p of s.players.values()) if (!s.admin.inContext(p)) p.addStat('haunting.experienced');
    }
    s.level.flags.haunt = undefined;
    // What Null took is given back; the others' marks are left in the world
    if (this.character === 'null' || st.char === 'null') this.putBack();
    s.level.flags.hauntBlocks = [];
    this.clearFigures();
    this.dark.clear();
    this.clearMobs();
    this.glitchedNames.clear();
    // Owners last: a host leaving takes everyone else with it
    const all = [...s.players.values()].sort((a, b) => Number(s.roleOf(a) === 'owner') - Number(s.roleOf(b) === 'owner'));
    for (const p of all) {
      const own = erase && s.roleOf(p) === 'owner';
      if (end.kind === 'ban') s.kick(p, HAUNT_BAN.title, { ban: { ...HAUNT_BAN, deleted: erase }, erase: own });
      else if (end.kind === 'corrupted') s.kick(p, 'SERVER MEMORY CORRUPTED', { corrupted: true, erase: own });
      else s.kick(p, end.screen.title, { screen: { ...end.screen, deleted: erase }, erase: own });
    }
  }

  // ------------------------------------------------------------------ the world

  /** Changes a block (if its chunk is loaded and it holds no block entity) and records it. */
  set(dim: Dimension, x: number, y: number, z: number, state: number): boolean {
    const prev = dim.getState(x, y, z);
    if (prev === state || !dim.isLoaded(x, z) || dim.getBlockEntity(x, y, z)) return false;
    const old = dim.setBlock(x, y, z, state);
    if (old < 0) return false;
    this.changes.push([dim.id, x, y, z, old, state]);
    if (state !== 0) this.server.admin.setBlockMark(dim, x, y, z, true);
    return true;
  }

  idAt(dim: Dimension, x: number, y: number, z: number): string {
    return blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.id;
  }

  /** Air, or a plant or snow layer that can be replaced. */
  open(dim: Dimension, x: number, y: number, z: number): boolean {
    return openAt(dim, x, y, z);
  }

  solidGround(dim: Dimension, x: number, y: number, z: number): boolean {
    return solidAt(dim, x, y, z);
  }

  /**
   * The y to stand at near (x, z): solid ground below, two open blocks above,
   * searched from `range` above the hint downwards (the surface, or a cave floor).
   */
  floorNear(dim: Dimension, x: number, z: number, yHint: number, range: number): number | null {
    return floorAt(dim, x, z, yHint, range);
  }

  /** A spot around a player, mostly behind or beside them (so it is there when they turn round). */
  around(p: ServerPlayer, lo: number, hi: number): [number, number] {
    const behind = this.rng.next() < 0.7;
    const a = behind ? p.yaw + Math.PI + (this.rng.next() - 0.5) * 2.4 : this.rng.next() * Math.PI * 2;
    const r = lo + this.rng.next() * (hi - lo);
    return [Math.floor(p.x - Math.sin(a) * r), Math.floor(p.z - Math.cos(a) * r)];
  }

  /** A sign facing the player, with these words, somewhere `lo`..`hi` blocks around them. */
  placeSign(p: ServerPlayer, lines: readonly string[], lo = 6, hi = 16): [number, number, number] | null {
    const dim = p.dim;
    for (let tries = 0; tries < 16; tries++) {
      const [x, z] = this.around(p, lo, hi);
      const y = this.floorNear(dim, x, z, Math.floor(p.y), 10);
      if (y === null) continue;
      if (this.signAt(p, x, y, z, lines)) return [x, y, z];
    }
    return null;
  }

  /** A sign at this spot, turned towards the player (the way a sign faces whoever placed it). */
  signAt(p: ServerPlayer, x: number, y: number, z: number, lines: readonly string[]): boolean {
    const dim = p.dim;
    const yaw = Math.atan2(-(x + 0.5 - p.x), -(z + 0.5 - p.z));
    const rot = Math.round(((((-yaw * 180) / Math.PI + 180) % 360) + 360) % 360 / 22.5) % 16;
    if (!this.set(dim, x, y, z, stateOf('sign', { rotation: String(rot) }))) return false;
    dim.setBlockEntity(x, y, z, { type: 'sign', lines: [...lines] });
    this.server.sendToWatchers(dim, x, z, { t: 'block_entity', x, y, z, data: { type: 'sign', lines: [...lines] } });
    return true;
  }

  /** The torches around a player go out, `n` of them at most. Returns how many. */
  torchesOut(p: ServerPlayer, n: number, r = 12): number {
    const dim = p.dim;
    let out = 0;
    for (let tries = 0; tries < 400 && out < n; tries++) {
      const x = Math.floor(p.x) + this.rng.int(r * 2 + 1) - r;
      const y = Math.floor(p.y) + this.rng.int(9) - 4;
      const z = Math.floor(p.z) + this.rng.int(r * 2 + 1) - r;
      const id = this.idAt(dim, x, y, z);
      if ((id === 'torch' || id === 'wall_torch') && this.set(dim, x, y, z, 0)) {
        this.server.playSound(dim, 'fire.extinguish', x + 0.5, y + 0.5, z + 0.5, 0.4, 0.6);
        out++;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ looking

  lookingAt(p: ServerPlayer, x: number, y: number, z: number, cos: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const dx = x - ex;
    const dy = y - ey;
    const dz = z - ez;
    const d = Math.hypot(dx, dy, dz) || 1;
    const cp = Math.cos(p.pitch);
    return ((-Math.sin(p.yaw) * cp) * dx + -Math.sin(p.pitch) * dy + (-Math.cos(p.yaw) * cp) * dz) / d > cos;
  }

  /** Nothing solid between the player's eyes and a point. */
  clearLine(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const d = Math.hypot(x - ex, y - ey, z - ez);
    const n = Math.ceil(d);
    for (let i = 2; i < n - 1; i++) {
      const k = i / n;
      const st = p.dim.getState(Math.floor(ex + (x - ex) * k), Math.floor(ey + (y - ey) * k), Math.floor(ez + (z - ez) * k));
      if (STATE_SOLID[st]) return false;
    }
    return true;
  }

  /** A spot to show a figure `lo`..`hi` blocks from a player, in view (or behind them), on the ground. */
  spotNear(p: ServerPlayer, lo: number, hi: number, inView: boolean, behind = false, clear = true): [number, number, number] | null {
    const max = Math.max(lo + 4, Math.min(hi, p.viewDistance * 16 - 12));
    for (let tries = 0; tries < 14; tries++) {
      const a = behind ? p.yaw + Math.PI + (this.rng.next() - 0.5) * 0.9 : inView ? p.yaw + (this.rng.next() - 0.5) * 1.1 : this.rng.next() * Math.PI * 2;
      const r = lo + this.rng.next() * (max - lo);
      const x = Math.floor(p.x - Math.sin(a) * r);
      const z = Math.floor(p.z - Math.cos(a) * r);
      const y = this.floorNear(p.dim, x, z, Math.floor(p.y), behind ? 4 : 20);
      if (y === null) continue;
      if (clear && !behind && !this.clearLine(p, x + 0.5, y + 1.6, z + 0.5)) continue;
      return [x + 0.5, y, z + 0.5];
    }
    return null;
  }
}

/** Events that change blocks (they stop once it has changed enough). */
const BLOCKY = new Set(['torch', 'cross', 'tunnel', 'tree', 'pyramid', 'sign', 'dark', 'erase', 'take', 'hole', 'house', 'trap', 'burrow', 'knock', 'door']);

/** For the Admin Panel's action: whether an ending is one of a character's (validated before it gets here too). */
export function hauntEndingOk(c: HauntCharacter, ending: string | undefined): boolean {
  return ending === undefined || castEnding(c, ending);
}

