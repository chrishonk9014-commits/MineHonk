/**
 * The Haunting (every world, any time: not seasonal), the shared core. A
 * haunting is one character from the old stories over a timeline
 * (src/common/game/haunting.ts and hauntCast.ts): Herobrine by default, or
 * (V7 phase 4, the Admin Panel only) Null, Green Steve or the Cave Dweller.
 * The core runs what every haunting has in common; each character's part
 * (haunts/*.ts) decides what happens on it:
 *
 *  - the timeline: it only moves while someone is in the world, and it is
 *    saved (level.flags.haunts), so a reload carries on where it was; a reload
 *    during the end goes back to the start of the end (never into the middle
 *    of a cutscene);
 *  - V7.1: several at once, one of each character (all four, if the panel
 *    starts them all), each on its own timeline; their ends take turns: while
 *    one plays its end, the others wait, and the next carries on when
 *    everyone is back;
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
import type { DimensionId } from '../../common/data/biomes';
import { Mob } from '../entity/Mob';
import { stateOf, blocks, STATE_BLOCK, STATE_SOLID } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { biomeOf } from '../../common/registry/biomes';
import { Random } from '../../common/math/rng';
import { ChatFilter } from '../moderation/ChatFilter';
import { floorNear as floorAt, openAt, solidGround as solidAt } from '../world/drag';
import { cleanVoiceLine, scriptedReply, VOICE_SPEAKER, type VoiceRequest, type VoiceAnswer } from '../../common/game/herobrineVoice';
import { HAUNT_CHARACTERS, HAUNT_MAX_ANSWERS, HAUNT_MAX_MINUTES, HAUNT_BAN, HAUNT_CHASE_AT, AUTO_HAUNT_MINUTES, AUTO_HAUNT_ENDING, type HauntStatus, type HauntOp, type HauntCharacter, type AutoHauntRoll } from '../../common/game/haunting';
import { HAUNT_CAST, castStage, castEnding, defaultEnding, type HauntNotice } from '../../common/game/hauntCast';
import type { HauntState, Figure, HauntPart, HauntFinish } from './haunts/types';
import { HerobrineHaunt } from './haunts/herobrine';
import { NullHaunt } from './haunts/null';
import { GreenSteveHaunt } from './haunts/greenSteve';
import { CaveDwellerHaunt } from './haunts/caveDweller';
import { HAUNT_MAX_CHANGES } from './hauntSave';

export type { HauntState } from './haunts/types';

/** A block it changed: dimension, position, what was there, what it put, and (V7.1) whose haunting changed it. */
type Change = [string, number, number, number, number, number, HauntCharacter?];
/** Whose haunting changed a block (Herobrine's, for one recorded before V7.1 without a name). */
const changeOf = (c: Change): HauntCharacter => (c[6] && HAUNT_CHARACTERS.includes(c[6]) ? c[6] : 'herobrine');
/** A saved haunting that can run. */
const valid = (st: HauntState | undefined | null): st is HauntState => !!st && typeof st.t === 'number' && typeof st.total === 'number' && st.total > 0;
/** Who a haunting is (Herobrine for one from before V7 phase 4). */
export const charOf = (st: HauntState | null | undefined): HauntCharacter => (st?.char && HAUNT_CHARACTERS.includes(st.char) ? st.char : 'herobrine');
/** Its random block-changing events stop here (an ending can go on to HAUNT_MAX_CHANGES). */
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
/** How a player names each character in chat (V7.1: with several haunting, the one named answers). */
const NAMED: Record<HauntCharacter, RegExp> = {
  herobrine: /\b(herobrine|hero|hb)\b/i,
  null: /\bnull\b/i,
  green_steve: /\b(green|steve)\b/i,
  cave_dweller: /\b(dweller|cave)\b/i,
};

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
  /** The haunting being run right now (its part's calls on the core are about it). */
  private cur: HauntState | null = null;
  /** This tick's darkness for each player, while several hauntings each ask for theirs (the darkest wins). */
  private darkWant: Map<string, number> | null = null;
  /** The characters' parts. */
  readonly parts: Readonly<Record<HauntCharacter, HauntPart>>;

  constructor(readonly server: GameServer) {
    this.parts = { herobrine: new HerobrineHaunt(this), null: new NullHaunt(this), green_steve: new GreenSteveHaunt(this), cave_dweller: new CaveDwellerHaunt(this) };
  }

  /**
   * Every haunting running now (level.flags.haunts), at most one of each
   * character. A world from before V7.1 kept one, as level.flags.haunt: it
   * becomes the first (and the blocks it changed are marked as its).
   */
  get states(): HauntState[] {
    const f = this.server.level.flags;
    if (f.haunt !== undefined) {
      const old = f.haunt as HauntState | undefined;
      delete f.haunt;
      if (valid(old)) {
        const c = charOf(old);
        for (const ch of this.changes) if (!ch[6]) ch[6] = c;
        const rest = Array.isArray(f.haunts) ? (f.haunts as HauntState[]).filter((x) => charOf(x) !== c) : [];
        f.haunts = [{ ...old, char: c }, ...rest];
      }
    }
    return Array.isArray(f.haunts) ? (f.haunts as HauntState[]).filter(valid) : [];
  }

  private setStates(list: HauntState[]): void {
    const f = this.server.level.flags;
    if (list.length) f.haunts = list;
    else delete f.haunts;
  }

  /** A character's haunting, if it is running. */
  stateOf(c: HauntCharacter): HauntState | null {
    return this.states.find((st) => charOf(st) === c) ?? null;
  }

  /** The haunting being run right now, or the first of those running (or null). */
  get state(): HauntState | null {
    return this.cur ?? this.states[0] ?? null;
  }

  /** A haunting is running. */
  get active(): boolean {
    return this.states.length > 0;
  }

  /** Who is haunting (the one being run right now, or the first; Herobrine when nobody is). */
  get character(): HauntCharacter {
    return charOf(this.state);
  }

  /** The part of whoever is haunting. */
  get part(): HauntPart {
    return this.parts[this.character];
  }

  /** Runs `fn` as `st`'s haunting (what its part asks of the core is about it). */
  private as<T>(st: HauntState, fn: () => T): T {
    const prev = this.cur;
    this.cur = st;
    try {
      return fn();
    } finally {
      this.cur = prev;
    }
  }

  /** A haunting is playing its end. */
  private inEnd(st: HauntState): boolean {
    return st.t / st.total >= HAUNT_CAST[charOf(st)].finaleAt;
  }

  get herobrine(): HerobrineHaunt {
    return this.parts.herobrine as HerobrineHaunt;
  }

  /** A player is leaving: anything that moved them lets go, so they are saved where they were taken from. */
  onLeave(p: ServerPlayer): void {
    for (const part of Object.values(this.parts)) part.release?.(p);
  }

  /** Where a player it holds right now was taken from (their save keeps them there), or null. */
  originOf(p: ServerPlayer): { dim: DimensionId; x: number; y: number; z: number; yaw: number } | null {
    for (const part of Object.values(this.parts)) {
      const at = part.originOf?.(p);
      if (at) return at;
    }
    return null;
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
    named?: HauntCharacter,
    text?: string,
  ): { ok: boolean; text: string; data?: unknown } | Promise<{ ok: boolean; text: string; data?: unknown }> {
    // (V7.1: the panel always names who it means; an older one names nobody but Herobrine's others)
    const character: HauntCharacter = named ?? 'herobrine';
    const reply = (ok: boolean, msg: string, extra?: Record<string, unknown>): { ok: boolean; text: string; data: unknown } => ({ ok, text: msg, data: { ...this.status(p), ...extra } });
    const cast = HAUNT_CAST[character];
    switch (op) {
      case 'status':
        return reply(true, '');
      case 'start': {
        // V7.1: one of each character at a time (several characters at once)
        if (this.stateOf(character)) return reply(false, `${cast.name} is already haunting this world.`);
        if (erase && this.server.roleOf(p) !== 'owner') return reply(false, "Only the world's owner can choose to have the world deleted at the end.");
        const end = ending ?? defaultEnding(character);
        if (!castEnding(character, end)) return reply(false, `${cast.name} has no such ending.`);
        const mins = minutes ?? cast.defaultMinutes;
        this.begin(this.newState(character, mins, !!erase, end, p.uuid));
        const endName = cast.endings.find((e) => e.id === end)!.name;
        const others = this.states.length - 1;
        return reply(true, `The haunting has begun${character === 'herobrine' ? '' : ` (${cast.name})`}. It ends in ${mins} minute${mins === 1 ? '' : 's'} (${endName.toLowerCase()})${erase ? ', and then the world is deleted' : ', and the world is kept'}.${others ? ` ${others + 1} hauntings are running now; their ends take turns.` : ''}`);
      }
      case 'start_all': {
        // Every character not haunting yet, each its own length (or the one given) and its usual ending
        const started: HauntCharacter[] = [];
        for (const c of HAUNT_CHARACTERS) {
          if (this.stateOf(c)) continue;
          this.begin(this.newState(c, minutes ?? HAUNT_CAST[c].defaultMinutes, false, defaultEnding(c), p.uuid));
          started.push(c);
        }
        if (!started.length) return reply(false, 'All four are already haunting this world.');
        return reply(true, `${started.map((c) => HAUNT_CAST[c].name).join(', ')} ${started.length === 1 ? 'is' : 'are'} haunting the world now (${this.states.length} at once). Their ends take turns, and the world is kept.`);
      }
      case 'stop': {
        // The chosen one; from an older panel that names nobody, the only one running
        const sts = this.states;
        const st = this.target(named);
        if (!st) {
          if (sts.length) return reply(false, `${cast.name} is not haunting this world.`);
          if (!this.changes.length && !this.anyHeld()) return reply(false, 'No haunting is running.');
          const n = this.stop();
          return reply(true, `Put back ${n} block${n === 1 ? '' : 's'} a haunting had changed.`);
        }
        const c = charOf(st);
        if (st.auto) this.autoOver();
        const n = this.stopOne(c);
        const left = this.states.length;
        return reply(true, `${c === 'herobrine' ? 'The haunting' : `${HAUNT_CAST[c].name}'s haunting`} is over.${n ? ` Put back ${n} block${n === 1 ? '' : 's'} it changed.` : ''}${left ? ` ${left} still haunting.` : ''}`);
      }
      case 'stop_all': {
        const sts = this.states;
        if (!sts.length && !this.changes.length && !this.anyHeld()) return reply(false, 'No haunting is running.');
        if (sts.some((x) => x.auto)) this.autoOver();
        const n = this.stop();
        return reply(true, `${sts.length > 1 ? `All ${sts.length} hauntings are` : 'The haunting is'} over.${n ? ` Put back ${n} block${n === 1 ? '' : 's'} they changed.` : ''}`);
      }
      case 'skip': {
        const st = this.target(named);
        if (!st) return reply(false, this.states.length ? `${cast.name} is not haunting this world.` : 'No haunting is running.');
        st.touched = true;
        const c = HAUNT_CAST[charOf(st)];
        const f = st.t / st.total;
        const next = c.stages.find((s) => s.at > f + 1e-9);
        const to = next ? (next.id === 'finale' ? Math.max(next.at, this.skipToEnd(charOf(st))) : next.at) : 1;
        this.moveTo(st, to);
        return reply(true, next ? `Skipped to: ${next.name}.` : 'Skipped to the end.');
      }
      case 'finale': {
        const st = this.target(named);
        if (!st) return reply(false, this.states.length ? `${cast.name} is not haunting this world.` : 'No haunting is running.');
        st.touched = true;
        const c = HAUNT_CAST[charOf(st)];
        if (st.t / st.total < c.finaleAt) this.moveTo(st, Math.max(c.finaleAt, this.skipToEnd(charOf(st))));
        const waits = this.states.some((o) => o !== st && this.inEnd(o));
        return reply(true, `Straight to the end: ${c.stages.find((s) => s.id === 'finale')!.name}.${waits ? ' (Another end is playing: this one comes next.)' : ''}`);
      }
      case 'finale_in': {
        const st = this.target(named);
        if (!st) return reply(false, this.states.length ? `${cast.name} is not haunting this world.` : 'No haunting is running.');
        const c = HAUNT_CAST[charOf(st)];
        const m = Math.max(0, Math.min(HAUNT_MAX_MINUTES, minutes ?? 0));
        if (st.t / st.total >= c.finaleAt) return reply(false, 'The end has already begun.');
        st.touched = true;
        // The whole stretched or squeezed so that the end begins `m` minutes from now
        const left = Math.max(1, Math.round(m * 60 * 20));
        st.total = Math.max(st.t + 1, Math.ceil((st.t + left) / c.finaleAt));
        return reply(true, m === 0 ? 'The end begins now.' : `The end begins in ${m} minute${m === 1 ? '' : 's'}.`);
      }
      case 'restart': {
        const roll = this.autoRoll;
        if (!roll?.haunted) return reply(false, 'This world has no automatic haunting.');
        const hb = this.stateOf('herobrine');
        if (hb && !hb.auto) return reply(false, "Herobrine is already haunting this world from the panel. Stop that first.");
        this.stopOne('herobrine');
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
        // As often as a player may be answered in a haunting (each answer can be a call to Claude)
        const key = 'test:' + p.uuid;
        if (this.server.tickNo - (this.lastAnswer.get(key) ?? -1e9) < 100) return reply(false, 'Wait a few seconds before asking again.');
        this.lastAnswer.set(key, this.server.tickNo);
        return this.testTalk(p, character, said).then((r) => reply(true, `${r.speaker}: ${r.line} (${r.source === 'claude' ? 'Claude answered' : 'the scripted lines answered'})`, { talk: r }));
      }
    }
  }

  /**
   * The haunting the panel means: the one it names (only that one: a second
   * click on Stop never stops another), or, from an older panel naming
   * nobody, Herobrine's or the only one.
   */
  private target(named: HauntCharacter | undefined): HauntState | null {
    if (named) return this.stateOf(named);
    const sts = this.states;
    return this.stateOf('herobrine') ?? (sts.length === 1 ? sts[0]! : null);
  }

  /** A new haunting's saved state. */
  private newState(c: HauntCharacter, minutes: number, erase: boolean, ending: string, by: string): HauntState {
    return { t: 0, total: Math.round(minutes * 60 * 20), erase, by, done: [], ending, char: c };
  }

  /** A haunting begins (alongside any others running). */
  private begin(st: HauntState): void {
    const sts = this.states;
    if (!sts.length) this.history.length = 0;
    this.setStates([...sts.filter((x) => charOf(x) !== charOf(st)), st]);
  }

  /** Where a skip to the end lands (Herobrine: just before his chase). */
  private skipToEnd(c: HauntCharacter): number {
    return c === 'herobrine' ? HAUNT_CHASE_AT - 0.01 : HAUNT_CAST[c].finaleAt;
  }

  /** Moves a haunting along to share `to`; what was skipped is not played all at once. */
  private moveTo(st: HauntState, to: number): void {
    const ch = charOf(st);
    const c = HAUNT_CAST[ch];
    st.t = Math.ceil(to * st.total);
    // Another one's end is playing: this one waits on the edge of its own
    if (this.inEnd(st) && this.states.some((o) => o !== st && this.inEnd(o))) st.t = Math.ceil(c.finaleAt * st.total) - 1;
    for (const l of c.lines) if (l.at < to - 1e-9 && !st.done.includes(`line:${l.at}`)) st.done.push(`line:${l.at}`);
    for (const j of this.joinsOf(ch)) if (j < to - 1e-9 && !st.done.includes(`join:${j}`)) st.done.push(`join:${j}`, `left:${j}`);
  }

  status(p: ServerPlayer): HauntStatus {
    const sts = this.states;
    const st = sts[0] ?? null;
    const c0 = charOf(st);
    const roll = this.autoRoll;
    const changes = this.changes;
    const ending = sts.find((x) => this.inEnd(x)) ?? null;
    return {
      active: !!st,
      stage: st ? castStage(c0, st.t / st.total).id : null,
      character: c0,
      auto: !!st?.auto,
      // V7.1: every one running (the fields around describe the first)
      hauntings: sts.map((x) => {
        const c = charOf(x);
        return {
          character: c,
          stage: castStage(c, x.t / x.total).id,
          auto: !!x.auto,
          elapsed: Math.floor(x.t / 20),
          total: Math.floor(x.total / 20),
          erase: !!x.erase,
          ending: x.ending ?? defaultEnding(c),
          changes: changes.filter((ch) => changeOf(ch) === c).length,
          ...(ending && ending !== x && x.t / x.total >= HAUNT_CAST[c].finaleAt - 0.002 ? { waiting: true } : {}),
        };
      }),
      ...(roll?.haunted && !roll.begun && !roll.over ? { autoIn: Math.max(0, Math.floor((roll.after - roll.played) / 20)) } : {}),
      autoState: !roll?.haunted ? 'none' : roll.over ? 'over' : sts.some((x) => x.auto) ? 'running' : roll.begun ? 'over' : 'waiting',
      elapsed: st ? Math.floor(st.t / 20) : 0,
      total: st ? Math.floor(st.total / 20) : 0,
      erase: !!st?.erase,
      changes: this.changes.length,
      canErase: this.server.roleOf(p) === 'owner',
      ending: st?.ending ?? defaultEnding(c0),
    };
  }

  private anyHeld(): boolean {
    return [...this.server.players.values()].some((p) => this.holds(p));
  }

  /** Ends every haunting and puts back every block they changed (and their monsters, the time, the weather). Returns how many blocks. */
  stop(): number {
    const s = this.server;
    const sts = this.states;
    // The sky as it was before the first of them touched it
    const sky = sts.find((x) => x.sky)?.sky;
    for (const st of sts) st.sky = undefined;
    if (sky) this.setSky(sky);
    for (const part of Object.values(this.parts)) part.reset('stop');
    this.setStates([]);
    this.clearFigures();
    this.clearMobs();
    this.glitchedNames.clear();
    const n = this.putBack();
    for (const p of s.players.values()) this.calm(p);
    this.dark.clear();
    return n;
  }

  /**
   * Ends one character's haunting (V7.1: the others carry on) and puts back
   * what it changed: its blocks, its figures and monsters, anyone it holds;
   * the time and weather only once no other haunting is keeping them.
   */
  stopOne(c: HauntCharacter): number {
    const s = this.server;
    const st = this.stateOf(c);
    if (st) this.restoreSky(st);
    this.parts[c].reset('stop');
    this.setStates(this.states.filter((x) => charOf(x) !== c));
    this.clearFigures(c);
    this.clearMobs(c);
    if (c === 'herobrine') this.glitchedNames.clear();
    const n = this.putBack(c);
    // The dark lifted; any others still darkening send theirs again within a second (an end playing keeps its own)
    if (!this.states.some((x) => this.inEnd(x))) {
      for (const p of s.players.values()) this.calm(p);
      this.dark.clear();
    }
    return n;
  }

  /**
   * Every block it changed put back, if nobody changed it since. Those in
   * chunks not loaded now are put back when their chunk is next loaded (the
   * list is saved with the world: level.flags.hauntRestore).
   */
  putBack(who?: HauntCharacter): number {
    const s = this.server;
    let n = 0;
    const list = this.changes;
    const later = this.pendingRestore;
    const keep: Change[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      // (V7.1: only one character's, when only it stops)
      if (who && changeOf(c) !== who) {
        keep.unshift(c);
        continue;
      }
      const dim = s.dims.get(c[0] as never);
      if (dim && !dim.isLoaded(c[1], c[3])) {
        if (later.length < HAUNT_MAX_CHANGES) later.push(c);
        continue;
      }
      if (dim && this.restoreOne(dim, c)) n++;
    }
    s.level.flags.hauntBlocks = keep;
    return n;
  }

  /** One recorded change undone, if the block is still as it was left (a player may have changed it since). */
  private restoreOne(dim: Dimension, [, x, y, z, prev, now]: Change): boolean {
    if (dim.getState(x, y, z) !== now) return false;
    dim.setBlock(x, y, z, prev);
    this.server.admin.setBlockMark(dim, x, y, z, false);
    return true;
  }

  /** Changes still to be put back once their chunks load (after Stop or an end, with their chunks unloaded). */
  get pendingRestore(): Change[] {
    const f = this.server.level.flags;
    if (!Array.isArray(f.hauntRestore)) f.hauntRestore = [];
    return f.hauntRestore as Change[];
  }

  /** Puts back what waited for its chunk (every second, only while anything waits). */
  private restorePending(): void {
    const f = this.server.level.flags;
    const later = f.hauntRestore as Change[] | undefined;
    if (!Array.isArray(later) || !later.length || this.server.tickNo % 20 !== 0) return;
    const keep: Change[] = [];
    for (const c of later) {
      const dim = this.server.dims.get(c[0] as never);
      if (!dim) continue;
      if (!dim.isLoaded(c[1], c[3])) keep.push(c);
      else this.restoreOne(dim, c);
    }
    if (keep.length) f.hauntRestore = keep;
    else delete f.hauntRestore;
  }

  /** A player changed this block: whatever the haunting recorded there is theirs now, never undone over them. */
  private forget(dim: string, x: number, y: number, z: number): void {
    const f = this.server.level.flags;
    for (const key of ['hauntBlocks', 'hauntRestore'] as const) {
      const list = f[key] as Change[] | undefined;
      if (!Array.isArray(list) || !list.length) continue;
      // Every change recorded there (it may have changed the same block more than once)
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        if (c[1] === x && c[2] === y && c[3] === z && c[0] === dim) list.splice(i, 1);
      }
    }
  }

  /** The dark gone, for one player (a part takes back anything else it did to the screen). */
  calm(p: ServerPlayer): void {
    p.send({ t: 'fx', kind: 'haunt', strength: 0 });
  }

  /** Sends a player the dark (0..1), when it changed (V7.1: with several hauntings darkening, the darkest). */
  sendDark(p: ServerPlayer, dark: number, every = 200): void {
    if (this.darkWant) {
      this.darkWant.set(p.uuid, Math.max(this.darkWant.get(p.uuid) ?? -1, dark));
      return;
    }
    this.sendDarkNow(p, dark, every);
  }

  private sendDarkNow(p: ServerPlayer, dark: number, every = 200): void {
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
    this.restorePending();
    if (!this.resumed) {
      this.resumed = true;
      // A world loaded in the middle of an end: back to its start (the ending already decided is kept;
      // only ever one end at a time, any other waiting on the edge of its own)
      let one = false;
      for (const st of this.states) {
        const at = HAUNT_CAST[charOf(st)].finaleAt;
        if (!this.inEnd(st)) continue;
        st.t = Math.ceil(at * st.total) - (one ? 1 : 0);
        one = true;
      }
    }
    this.stepFigures();
    this.autoTick(players);
    const sts = this.states;
    const running = new Set(sts.map(charOf));
    for (const part of Object.values(this.parts)) if (!running.has(part.id)) part.reset('stop');
    // The timelines only move while someone is here
    if (!sts.length || !players.length) return;
    const seen = this.watchPlayers(players);
    // One end at a time: while one plays its end, the others wait for their turn
    const ending = sts.find((st) => this.inEnd(st));
    this.darkWant = new Map();
    try {
      for (const st of ending ? [ending] : sts) {
        this.as(st, () => this.tickOne(st, players, seen));
        // Its end threw everyone out: the rest carry on when they are back
        if (!this.states.includes(st) || !s.players.size) break;
      }
    } finally {
      const want = this.darkWant;
      this.darkWant = null;
      for (const p of players) {
        const d = want.get(p.uuid);
        if (d !== undefined && s.players.has(p.conn.id)) this.sendDarkNow(p, d);
      }
    }
  }

  /** One haunting's tick (V7.1: each runs on its own timeline). */
  private tickOne(st: HauntState, players: ServerPlayer[], seen: [ServerPlayer, HauntNotice][]): void {
    const s = this.server;
    const c = charOf(st);
    const part = this.parts[c];
    const cast = HAUNT_CAST[c];
    // Its end waits while another one's is playing
    // (and nothing of the others moves while one plays, from the tick it begins)
    const before = this.inEnd(st);
    if (!before && this.states.some((o) => o !== st && this.inEnd(o))) return;
    st.t++;
    // Its end begins: the others let go of everyone (their traps, cutscenes, figures, monsters and dark) while they wait
    if (!before && this.inEnd(st) && this.states.length > 1) {
      for (const o of this.states) {
        const oc = charOf(o);
        if (oc === c) continue;
        this.parts[oc].reset('stop');
        this.clearFigures(oc);
        this.clearMobs(oc);
      }
      for (const p of players) this.calm(p);
      this.dark.clear();
      this.darkWant?.clear();
    }
    const f = Math.min(1, st.t / st.total);
    const stage = castStage(c, f).id;
    for (const [p, what] of seen) {
      if (what === 'death') {
        st.deaths ??= {};
        st.deaths[p.uuid] = (st.deaths[p.uuid] ?? 0) + 1;
      }
      this.noticeNow(p, what, st, stage, f);
    }
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

  /**
   * Where everyone has been (the fake lag) and what they have been doing;
   * what is worth noticing this tick (a death, running, being underground or
   * asleep a while), for each haunting to count or remark on.
   */
  private watchPlayers(players: ServerPlayer[]): [ServerPlayer, HauntNotice][] {
    const s = this.server;
    const out: [ServerPlayer, HauntNotice][] = [];
    for (const p of players) {
      if (p.dead) {
        if (!this.deadNow.has(p.uuid)) {
          this.deadNow.add(p.uuid);
          out.push([p, 'death']);
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
      if (d.runSince >= 0 && now - d.runSince > 8 * 20) out.push([p, 'run']);
      if (d.belowSince >= 0 && now - d.belowSince > 90 * 20) out.push([p, 'underground']);
      if (d.sleepSince >= 0 && now - d.sleepSince > 2 * 20) {
        d.slept = true;
        out.push([p, 'sleep']);
      }
    }
    return out;
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
    this.forget(p.dim.id, x, y, z);
    const sts = this.states;
    if (!sts.length) return;
    const d = this.doingsOf(p);
    const now = this.server.tickNo;
    const torch = what === 'place' && (blockId === 'torch' || blockId === 'wall_torch');
    if (what === 'break') d.broken.push(now);
    else {
      d.placed.push(now);
      if (torch) d.torches.push(now);
    }
    const kind: HauntNotice = what === 'break' ? 'break' : torch ? 'torch' : 'build';
    const remark = what === 'break' ? d.broken.filter((t) => t > now - 60 * 20).length >= 12 : torch || d.placed.filter((t) => t > now - 60 * 20).length >= 20;
    // Each haunting running sees it
    for (const st of sts)
      this.as(st, () => {
        const f = st.t / st.total;
        const stage = castStage(charOf(st), f).id;
        this.parts[charOf(st)].notice?.(p, kind, st, stage, f, [x, y, z]);
        if (remark) this.noticeNow(p, kind, st, stage, f, [x, y, z]);
      });
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
    // (V7.1: others may be haunting the world; Herobrine himself may not be already)
    if (roll.played < roll.after || this.stateOf('herobrine')) return;
    this.beginAuto(roll, false);
  }

  /** Herobrine comes by himself: quietly, nothing announces it. */
  private beginAuto(roll: AutoHauntRoll, touched: boolean): void {
    roll.begun = true;
    roll.over = false;
    this.begin({ t: 0, total: AUTO_HAUNT_MINUTES * 60 * 20, erase: false, by: 'auto', done: [], ending: AUTO_HAUNT_ENDING, auto: true, char: 'herobrine', ...(touched ? { touched: true } : {}) } satisfies HauntState);
    if (this.states.length === 1) this.doings.clear();
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
    const c = charOf(st);
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
    this.parts[c].oneOffs(st, f, players, once);
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
      // (as its own haunting: whatever it does is that one's)
      const st = this.stateOf(fg.owner);
      const own = <T>(fn: () => T): T => (st ? this.as(st, fn) : fn());
      if (!gone) {
        const age = s.tickNo - fg.since;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        m.body.vx = m.body.vz = 0;
        vanish = !own(() => part.stepFigure(fg, age, d));
      }
      if (!vanish) continue;
      if (!m.removed) {
        own(() => part.vanish?.(fg, gone));
        if (!m.removed) m.remove();
      }
      if (this.figures[i] === fg) this.figures.splice(i, 1);
    }
  }

  /** Its figures gone (a stage that clears them, Stop, the end); `c`: only that character's. */
  clearFigures(c?: HauntCharacter): void {
    for (let i = this.figures.length - 1; i >= 0; i--) {
      const f = this.figures[i]!;
      if (c && f.owner !== c) continue;
      if (!f.m.removed) f.m.remove();
      this.figures.splice(i, 1);
    }
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
    if (this.server.tickNo > until || !this.stateOf('herobrine')) {
      this.glitchedNames.delete(p.uuid);
      return null;
    }
    return this.herobrine.glitchName(p);
  }

  /** What a player said, as everyone sees it (a character may change it: Null erases words). */
  chatText(p: ServerPlayer, text: string): string {
    let out = text;
    for (const st of this.states) out = this.as(st, () => this.parts[charOf(st)].chatText?.(p, out) ?? out);
    return out;
  }

  // ------------------------------------------------------------------ the sky, monsters

  /** The time and weather before it first touches them (V7.1: before any haunting running touched them). */
  rememberSky(st: HauntState): void {
    const l = this.server.level;
    st.sky ??= this.states.find((o) => o !== st && o.sky)?.sky ?? { dayTime: l.dayTime, raining: l.raining, thundering: l.thundering, rainTime: l.rainTime, thunderTime: l.thunderTime };
  }

  /** The time and weather put back, unless another haunting still has them (it puts them back when it ends). */
  restoreSky(st: HauntState): void {
    if (!st.sky) return;
    const sky = st.sky;
    st.sky = undefined;
    if (this.states.some((o) => o !== st && o.sky)) return;
    this.setSky(sky);
  }

  private setSky(sky: NonNullable<HauntState['sky']>): void {
    const l = this.server.level;
    l.dayTime = sky.dayTime;
    l.raining = sky.raining;
    l.thundering = sky.thundering;
    l.rainTime = sky.rainTime;
    l.thunderTime = sky.thunderTime;
    this.server.sendTime();
  }

  /** A monster it sent: cheat-made, never saved, dropping nothing (see Mobs.onMobDeath). */
  markMob(m: Mob, target: ServerPlayer | null): void {
    m.admin = true;
    m.persistent = false;
    // (whose: V7.1, so that one haunting stopping takes only its own)
    m.data.hauntMob = this.character;
    if (target) m.target = target;
  }

  /** Its monsters gone (Stop, the end); `c`: only that character's. */
  clearMobs(c?: HauntCharacter): void {
    for (const d of this.server.dims.values())
      for (const e of [...d.entities.values()]) {
        if (!(e instanceof Mob) || !e.data.hauntMob || e.removed) continue;
        if (c && e.data.hauntMob !== c && !(c === 'herobrine' && e.data.hauntMob === true)) continue;
        this.server.particles(d, 'glitch', e.x, e.y + 1, e.z, 10, 0.5);
        e.remove();
      }
  }

  // ------------------------------------------------------------------ talking to it

  /** Somebody said something in chat: from its "Talks back" moment on, it may answer. */
  onChat(p: ServerPlayer, text: string): void {
    const s = this.server;
    const sts = this.states;
    if (!sts.length) return;
    this.remember(p.name, text);
    if (this.talking || s.tickNo - (this.lastAnswer.get(p.uuid) ?? -1e9) < 100) return;
    // Who may answer: those past their "talks back" moment (and, but for Herobrine, not in their end;
    // while one plays its end, only that one)
    const ending = sts.find((st) => this.inEnd(st));
    const can = sts.filter((st) => {
      if (ending && st !== ending) return false;
      const c = charOf(st);
      const cast = HAUNT_CAST[c];
      const f = st.t / st.total;
      if (f < cast.talkAt || this.parts[c].silent?.(false)) return false;
      if (c !== 'herobrine' && f >= cast.finaleAt) return false;
      return (st.said ?? 0) < HAUNT_MAX_ANSWERS;
    });
    if (!can.length) return;
    // Talking to it nearly always gets an answer; talking about anything else, sometimes
    const addressed = /\b(herobrine|hero|hb|null|green|steve|dweller|cave|you|u|ur|your|yours)\b|\?/i.test(text);
    if (this.rng.next() > (addressed ? 0.9 : 0.35)) return;
    // V7.1, with several haunting at once: the one named answers, otherwise one of them
    const named = can.find((st) => NAMED[charOf(st)].test(text));
    const st = named ?? can[this.rng.int(can.length)]!;
    const c = charOf(st);
    const cast = HAUNT_CAST[c];
    const f = st.t / st.total;
    this.talking = true;
    this.lastAnswer.set(p.uuid, s.tickNo);
    st.said = (st.said ?? 0) + 1;
    const req = this.as(st, () => this.voiceRequest(p, text, c, castStage(c, f).name));
    const started = s.tickNo;
    void this.answer(req).then(({ line }) => {
      // A moment to "type", however fast the answer came
      s.later(Math.max(1, 30 + this.rng.int(30) - (s.tickNo - started)), () => {
        this.talking = false;
        const now = this.stateOf(c);
        if (!now || this.parts[c].silent?.(true)) return;
        this.as(now, () => {
          for (const o of s.players.values()) this.say(o, line, true, false, c);
        });
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
    const c = charOf(st);
    const erase = st.erase && !st.auto;
    this.restoreSky(st);
    // Nobody stays wherever its end took them: a kept world finds them where they were (V7.1: any
    // others haunting wait, and carry on when everyone is back)
    this.parts[c].reset('end');
    if (st.auto) {
      this.autoOver();
      // The advancement (hidden until earned) comes with the flag, before everyone is shown out
      if (!st.touched)
        for (const p of s.players.values())
          if (!s.admin.inContext(p)) {
            p.addStat('haunting.experienced');
            s.interaction.grant(p, 'experience_haunting');
          }
    }
    this.setStates(this.states.filter((x) => charOf(x) !== c));
    // What Null took is given back; the others' marks are left in the world (and forgotten)
    if (c === 'null') this.putBack('null');
    s.level.flags.hauntBlocks = this.changes.filter((ch) => changeOf(ch) !== c);
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

  /** Changes a block (if its chunk is loaded and it holds no block entity) and records it (never one it could not record). */
  set(dim: Dimension, x: number, y: number, z: number, state: number): boolean {
    const prev = dim.getState(x, y, z);
    if (prev === state || !dim.isLoaded(x, z) || dim.getBlockEntity(x, y, z) || this.changes.length >= HAUNT_MAX_CHANGES) return false;
    const old = dim.setBlock(x, y, z, state);
    if (old < 0) return false;
    this.changes.push([dim.id, x, y, z, old, state, this.character]);
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

