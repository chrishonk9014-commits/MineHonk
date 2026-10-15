/**
 * The Haunting (Admin Panel, every world): Herobrine as the old stories
 * tell it, over a timeline the panel chose (src/common/game/haunting.ts).
 *
 *   watching  far off in the fog, gone when you look again; a redstone torch nobody placed
 *   signs     cobblestone crosses in the air, 2x2 tunnels that lead nowhere, trees without
 *             leaves, sand pyramids in the water, signs, torches going out, "Herobrine joined",
 *             fake admin messages
 *   closer    he walks towards you, then is gone; the dark closes in; a shrine; players
 *             glitch; monsters come for them; "YOU ARE NOT SAFE"
 *   speaks    he talks, and answers when spoken to; midnight, thunder, lightning, players
 *             moved, wardens; he stands right behind you
 *   finale    he comes for everyone at once: a jumpscare each and a fake ban screen, or he
 *             drags everyone into his lair inside the computer (wired into chairs, shocked,
 *             SERVER MEMORY CORRUPTED). The world is deleted after either if its owner chose that.
 *
 * The timeline only moves while someone is in the world, and it is saved
 * (level.flags.haunt), so a reload carries on where it was. Herobrine
 * himself is never saved: his figures are untouchable, AI-less copies of the
 * V5.5 model, the way its sightings in the fog are made. Every block he
 * places or takes is recorded (level.flags.hauntBlocks) so Stop can put the
 * world back exactly; blocks he places are marked as cheat-made, so they
 * count for nothing. Stop also takes back his monsters, the time and the
 * weather. Nobody loses their things to a death while the world is haunted.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { Mob } from '../entity/Mob';
import type { DimensionId } from '../../common/data/biomes';
import type { ComputerWorldGenerator } from '../../common/gen/computer';
import { S, stateOf, blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID, getProp } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { biomeOf } from '../../common/registry/biomes';
import { canSurvive } from '../../common/game/placement';
import { Random } from '../../common/math/rng';
import { ChatFilter } from '../moderation/ChatFilter';
import { dragWay, floorNear as floorAt, openAt, solidGround as solidAt } from '../world/drag';
import { cleanVoiceLine, scriptedReply, type VoiceRequest } from '../../common/game/herobrineVoice';
import {
  HAUNT_STAGES,
  HAUNT_LINES,
  HAUNT_JOIN_AT,
  HAUNT_SIGNS,
  HAUNT_BAN,
  HAUNT_CHASE_AT,
  HAUNT_CHASE_MAX_TICKS,
  HAUNT_TALK_AT,
  HAUNT_MAX_ANSWERS,
  HAUNT_CORRUPT_CHANCE,
  HAUNT_SCENE,
  HAUNT_ADMIN_LINES,
  HAUNT_ENDING_NAMES,
  hauntStage,
  type HauntStage,
  type HauntStatus,
  type HauntOp,
  type HauntEnding,
} from '../../common/game/haunting';

/** What the world keeps of a haunting. */
interface HauntState {
  /** Ticks in, and of the whole. */
  t: number;
  total: number;
  erase: boolean;
  /** Who started it. */
  by: string;
  /** One-off moments already played (lines, joins, the shrine). */
  done: string[];
  /** How it ends as chosen, and as decided when the end begins. */
  ending?: HauntEnding;
  final?: 'ban' | 'corrupted';
  /** Times he has answered someone. */
  said?: number;
  /** The time and weather before he first touched them (put back by Stop and at the end). */
  sky?: { dayTime: number; raining: boolean; thundering: boolean; rainTime: number; thunderTime: number };
  /** Deaths per player since it began. */
  deaths?: Record<string, number>;
}

/** A block he changed: dimension, position, what was there, what he put. */
type Change = [DimensionId, number, number, number, number, number];
const MAX_CHANGES = 4000;
/** His monsters near one player at once. */
const MAX_MOBS = 6;

type FigureKind = 'far' | 'mid' | 'approach' | 'behind' | 'chase';

interface Figure {
  m: Mob;
  p: ServerPlayer;
  kind: FigureKind;
  since: number;
  /** Ticks the player has been looking straight at him. */
  seen: number;
}

/** The lair ending, while it plays. */
interface Scene {
  /** Ticks into it (only while someone is here). */
  t: number;
  /** Everyone he took: where they were, the figure dragging them, the drag, their chair in the hall. */
  taken: Map<string, { p: ServerPlayer; from: [DimensionId, number, number, number, number]; drag: Mob | null; dir: [number, number]; len: number; lead: number; chair: [number, number, number] | null; i: number }>;
  /** Him, at the throne in his hall. */
  lair: Mob | null;
}

/** Ground he may dig a tunnel through (never anything a player made). */
const NATURAL = /^(stone|dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|sand|red_sand|sandstone|red_sandstone|gravel|granite|diorite|andesite|deepslate|tuff|calcite|clay|terracotta|[a-z_]+_terracotta|snow_block|mud|moss_block|netherrack|end_stone)$/;

type Budget = 'sight' | 'torch' | 'cross' | 'tunnel' | 'tree' | 'pyramid' | 'sign' | 'dark' | 'sound' | 'glitch' | 'glitchy' | 'chaos' | 'mob';
/** Events per player over each stage (spread at random through it): more and more as it goes on. */
const BUDGET: Record<HauntStage, Partial<Record<Budget, number>>> = {
  watching: { sight: 3, torch: 1, tree: 1, sound: 2 },
  signs: { sight: 3, torch: 4, cross: 3, tunnel: 2, tree: 2, pyramid: 1, sign: 2, dark: 1, sound: 3, glitchy: 1, chaos: 1 },
  closer: { sight: 3, torch: 5, cross: 4, tunnel: 2, tree: 2, sign: 3, dark: 2, sound: 3, glitch: 2, glitchy: 3, chaos: 2, mob: 1 },
  speaks: { sight: 4, torch: 6, cross: 8, tunnel: 1, tree: 2, sign: 4, dark: 2, sound: 4, glitch: 6, glitchy: 5, chaos: 4, mob: 3 },
  finale: {},
};

/** Words torn across a glitched player's screen. */
const HACKS = ['HE IS HERE', 'YOU CANNOT LEAVE', 'I AM IN YOUR WORLD', 'DO NOT LOOK BEHIND YOU', 'HEROBRINE.EXE', 'PLAYER DATA OVERWRITTEN'];
const GLYPHS = '#%&@$?!/\\|<>=+*0123456789';

const filter = new ChatFilter([]);

export class HauntingSystem {
  private readonly figures: Figure[] = [];
  private readonly rng = new Random();
  /** The last darkness each player was sent. */
  private readonly dark = new Map<string, number>();
  private chase: { since: number; caught: Set<string> } | null = null;
  /** When everyone has been caught: the tick the end comes. */
  private endAt = -1;
  private scene: Scene | null = null;
  /** Where each player was over the last few seconds (for the fake lag). */
  private readonly trail = new Map<string, [DimensionId, number, number, number][]>();
  /** Players whose name he has glitched in chat, until when. */
  private readonly glitchedNames = new Map<string, number>();
  private readonly deadNow = new Set<string>();
  /** The last lines of chat (what he is told when someone speaks to him). */
  private readonly history: { from: string; text: string }[] = [];
  private readonly lastAnswer = new Map<string, number>();
  private talking = false;

  constructor(readonly server: GameServer) {}

  get state(): HauntState | null {
    const st = this.server.level.flags.haunt as HauntState | undefined;
    return st && typeof st.t === 'number' && typeof st.total === 'number' && st.total > 0 ? st : null;
  }

  /** A haunting is running. */
  get active(): boolean {
    return !!this.state;
  }

  /** The lair ending has this player (the Herobrine story leaves them alone). */
  holds(p: ServerPlayer): boolean {
    return !!this.scene?.taken.has(p.uuid);
  }

  private get changes(): Change[] {
    const f = this.server.level.flags;
    if (!Array.isArray(f.hauntBlocks)) f.hauntBlocks = [];
    return f.hauntBlocks as Change[];
  }

  // ------------------------------------------------------------------ the Admin Panel

  admin(p: ServerPlayer, op: HauntOp, minutes?: number, erase?: boolean, ending?: HauntEnding): { ok: boolean; text: string; data?: unknown } {
    const reply = (ok: boolean, text: string): { ok: boolean; text: string; data: HauntStatus } => ({ ok, text, data: this.status(p) });
    switch (op) {
      case 'status':
        return reply(true, '');
      case 'start': {
        if (this.state) return reply(false, 'A haunting is already running. Stop it first.');
        if (erase && this.server.roleOf(p) !== 'owner') return reply(false, "Only the world's owner can choose to have the world deleted at the end.");
        const end = ending ?? 'random';
        this.server.level.flags.haunt = { t: 0, total: Math.round((minutes ?? 30) * 60 * 20), erase: !!erase, by: p.uuid, done: [], ending: end } satisfies HauntState;
        this.history.length = 0;
        return reply(true, `The haunting has begun. It ends in ${minutes} minute${minutes === 1 ? '' : 's'} (${HAUNT_ENDING_NAMES[end].toLowerCase()})${erase ? ', and then the world is deleted' : ', and the world is kept'}.`);
      }
      case 'stop': {
        if (!this.state && !this.changes.length && !this.scene) return reply(false, 'No haunting is running.');
        const n = this.stop();
        return reply(true, `The haunting is over.${n ? ` Put back ${n} block${n === 1 ? '' : 's'} he changed.` : ''}`);
      }
      case 'skip': {
        const st = this.state;
        if (!st) return reply(false, 'No haunting is running.');
        const f = st.t / st.total;
        const next = HAUNT_STAGES.find((s) => s.at > f + 1e-9);
        const to = next ? (next.id === 'finale' ? Math.max(next.at, HAUNT_CHASE_AT - 0.01) : next.at) : 1;
        st.t = Math.ceil(to * st.total);
        // What was skipped is not played all at once
        for (const l of HAUNT_LINES) if (l.at < to - 1e-9 && !st.done.includes(`line:${l.at}`)) st.done.push(`line:${l.at}`);
        for (const j of HAUNT_JOIN_AT) if (j < to - 1e-9 && !st.done.includes(`join:${j}`)) st.done.push(`join:${j}`, `left:${j}`);
        return reply(true, next ? `Skipped to: ${next.name}.` : 'Skipped to the end.');
      }
    }
  }

  status(p: ServerPlayer): HauntStatus {
    const st = this.state;
    return {
      active: !!st,
      stage: st ? hauntStage(st.t / st.total) : null,
      elapsed: st ? Math.floor(st.t / 20) : 0,
      total: st ? Math.floor(st.total / 20) : 0,
      erase: !!st?.erase,
      changes: this.changes.length,
      canErase: this.server.roleOf(p) === 'owner',
      ending: st?.ending ?? 'random',
    };
  }

  /** Ends the haunting and puts back every block he changed (and his monsters, the time, the weather). Returns how many blocks. */
  stop(): number {
    const s = this.server;
    const st = this.state;
    if (st) this.restoreSky(st);
    this.endScene(true, true);
    this.server.level.flags.haunt = undefined;
    for (const f of this.figures) if (!f.m.removed) f.m.remove();
    this.figures.length = 0;
    this.chase = null;
    this.endAt = -1;
    this.clearMobs();
    this.glitchedNames.clear();
    let n = 0;
    const list = this.changes;
    for (let i = list.length - 1; i >= 0; i--) {
      const [d, x, y, z, prev, now] = list[i]!;
      const dim = s.dims.get(d);
      if (!dim || !dim.isLoaded(x, z)) continue;
      // Only what is still as he left it (a player may have changed it since)
      if (dim.getState(x, y, z) === now) {
        dim.setBlock(x, y, z, prev);
        s.admin.setBlockMark(dim, x, y, z, false);
        n++;
      }
      list.splice(i, 1);
    }
    // Blocks in chunks that are not loaded are forgotten: the record stays small
    s.level.flags.hauntBlocks = [];
    for (const p of s.players.values()) this.calm(p);
    this.dark.clear();
    return n;
  }

  /** The dark gone, for one player. */
  private calm(p: ServerPlayer): void {
    p.send({ t: 'fx', kind: 'haunt', strength: 0 });
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    const st = this.state;
    this.stepFigures();
    if (!st) {
      if (this.scene) this.endScene(true, true);
      return;
    }
    const players = [...s.players.values()];
    // The timeline only moves while someone is here
    if (!players.length) return;
    st.t++;
    const f = Math.min(1, st.t / st.total);
    const stage = hauntStage(f);
    this.watchPlayers(st, players);
    this.oneOffs(st, f, players);
    if (stage === 'finale') {
      this.finale(st, f, players);
      return;
    }
    // Random events, judged every 10 ticks
    if (s.tickNo % 10 === 0) {
      const i = HAUNT_STAGES.findIndex((x) => x.id === stage);
      const span = ((HAUNT_STAGES[i + 1]?.at ?? 1) - HAUNT_STAGES[i]!.at) * st.total;
      const roll = (n: number | undefined): boolean => !!n && this.rng.next() < (n * 10) / Math.max(200, span);
      const b = BUDGET[stage];
      for (const p of players) {
        if (p.dead) continue;
        if (roll(b.sight)) this.sight(p, stage);
        if (this.changes.length < MAX_CHANGES) {
          if (roll(b.torch)) for (let k = stage === 'watching' ? 1 : 1 + this.rng.int(3); k > 0; k--) this.placeTorch(p);
          if (roll(b.cross)) this.placeCross(p, stage === 'speaks');
          if (roll(b.tunnel)) this.digTunnel(p);
          if (roll(b.tree)) this.stripTree(p);
          if (roll(b.pyramid)) this.sandPyramid(p);
          if (roll(b.sign)) this.placeSign(p);
          if (roll(b.dark)) this.torchesOut(p);
        }
        if (roll(b.sound)) this.creepySound(p);
        if (roll(b.glitch)) p.send({ t: 'fx', kind: 'glitch', strength: 0.25 + this.rng.next() * 0.25, ticks: 8 + this.rng.int(10) });
        if (roll(b.glitchy)) this.glitchy(p);
        if (roll(b.chaos)) this.chaos(p, st, stage);
        if (roll(b.mob)) this.summon(p, st, f);
      }
    }
    // The dark closes in from "closer" on
    if (s.tickNo % 20 === 0) {
      const dark = Math.max(0, Math.min(1, (f - 0.45) / (0.94 - 0.45)));
      for (const p of players) {
        const last = this.dark.get(p.uuid) ?? -1;
        if (Math.abs(last - dark) >= 0.02 || (s.tickNo % 200 === 0 && dark > 0)) {
          this.dark.set(p.uuid, dark);
          p.send({ t: 'fx', kind: 'haunt', strength: dark * 0.85 });
        }
      }
    }
  }

  /** Where everyone has been (the fake lag) and who has died since it began. */
  private watchPlayers(st: HauntState, players: ServerPlayer[]): void {
    const s = this.server;
    for (const p of players) {
      if (p.dead) {
        if (!this.deadNow.has(p.uuid)) {
          this.deadNow.add(p.uuid);
          st.deaths ??= {};
          st.deaths[p.uuid] = (st.deaths[p.uuid] ?? 0) + 1;
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
    }
  }

  /** Lines in chat, the fake joins and the shrine, each once, at its moment. */
  private oneOffs(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.server;
    const once = (key: string, at: number): boolean => {
      if (f < at || st.done.includes(key)) return false;
      st.done.push(key);
      return true;
    };
    for (const at of HAUNT_JOIN_AT) {
      if (once(`join:${at}`, at)) s.broadcastChat('Herobrine joined the world', 'join');
      // He leaves again a few seconds later (sooner in a short haunting)
      if (once(`left:${at}`, at + Math.min(0.01, 120 / st.total))) s.broadcastChat('Herobrine left the world', 'leave');
    }
    for (const l of HAUNT_LINES) {
      if (!once(`line:${l.at}`, l.at)) continue;
      for (const p of players) p.send({ t: 'chat', text: l.text.replace('{name}', p.name.toUpperCase()), kind: l.glitch ? 'herobrine' : 'chat', from: 'Herobrine' });
      if (l.glitch) for (const p of players) p.send({ t: 'fx', kind: 'glitch', strength: 0.55, ticks: 18 });
      this.remember('Herobrine', l.text.replace('{name}', 'YOU'));
    }
    if (once('shrine', 0.5)) {
      const p = players[this.rng.int(players.length)]!;
      this.buildShrine(p);
    }
  }

  // ------------------------------------------------------------------ the figure

  private sight(p: ServerPlayer, stage: HauntStage): void {
    if (this.figures.some((f) => f.p === p)) return;
    const kind: FigureKind = stage === 'watching' ? 'far' : stage === 'signs' ? 'mid' : stage === 'closer' ? 'approach' : 'behind';
    const [lo, hi] = kind === 'far' ? [40, 64] : kind === 'mid' ? [24, 40] : kind === 'approach' ? [16, 24] : [4, 7];
    const max = Math.max(lo + 4, Math.min(hi, p.viewDistance * 16 - 12));
    for (let tries = 0; tries < 12; tries++) {
      // In view (so it can be seen), or right behind for "behind"
      const a = kind === 'behind' ? p.yaw + Math.PI + (this.rng.next() - 0.5) * 0.9 : p.yaw + (this.rng.next() - 0.5) * 1.1;
      const r = lo + this.rng.next() * (max - lo);
      const x = Math.floor(p.x - Math.sin(a) * r);
      const z = Math.floor(p.z - Math.cos(a) * r);
      const y = this.floorNear(p.dim, x, z, Math.floor(p.y), kind === 'behind' ? 4 : 20);
      if (y === null) continue;
      // The first sightings must be possible to see: nothing solid between
      if (kind !== 'behind' && !this.clearLine(p, x + 0.5, y + 1.6, z + 0.5)) continue;
      this.spawnFigure(p, kind, x + 0.5, y, z + 0.5);
      return;
    }
  }

  /** An untouchable, AI-less copy of him (never saved). */
  private apparition(dim: Dimension, x: number, y: number, z: number, yaw: number, anim: 'stare' | 'idle'): Mob | null {
    const m = this.server.mobs?.spawn(dim, 'herobrine', x, y, z, { reason: 'boss', data: { apparition: true, haunting: true } });
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

  private spawnFigure(p: ServerPlayer, kind: FigureKind, x: number, y: number, z: number): Mob | null {
    const m = this.apparition(p.dim, x, y, z, Math.atan2(-(p.x - x), -(p.z - z)), kind === 'chase' || kind === 'approach' ? 'idle' : 'stare');
    if (!m) return null;
    this.figures.push({ m, p, kind, since: this.server.tickNo, seen: 0 });
    return m;
  }

  private stepFigures(): void {
    const s = this.server;
    for (let i = this.figures.length - 1; i >= 0; i--) {
      const fg = this.figures[i]!;
      const { m, p } = fg;
      const gone = m.removed || !s.players.has(p.conn.id) || p.dim !== m.dim;
      let vanish = gone;
      if (!gone) {
        const age = s.tickNo - fg.since;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
        m.headYaw = m.yaw;
        m.body.vx = m.body.vz = 0;
        if (this.lookingAt(p, m.x, m.y + 1.6, m.z, fg.kind === 'behind' ? 0.8 : 0.975)) fg.seen++;
        if (fg.kind === 'chase') {
          if (d < 1.5 || age > HAUNT_CHASE_MAX_TICKS) {
            this.catch(p);
            m.remove();
            this.figures.splice(i, 1);
            continue;
          }
          this.moveTowards(m, p, 0.55);
          continue;
        }
        if (fg.kind === 'approach' && age > 20) this.moveTowards(m, p, 0.16);
        vanish =
          fg.kind === 'far'
            ? d < 20 || fg.seen >= 30 || age > 300
            : fg.kind === 'mid'
              ? d < 14 || fg.seen >= 20 || age > 300
              : fg.kind === 'approach'
                ? d < 5 || age > 110
                : fg.seen >= 3 || d < 2 || age > 200;
      }
      if (!vanish) continue;
      if (!gone) {
        p.send({ t: 'fx', kind: 'afterimage', id: m.id, ticks: 14 });
        s.playSound(m.dim, fg.kind === 'behind' ? 'herobrine.presence' : 'herobrine.whisper', m.x, m.y + 1, m.z, fg.kind === 'far' ? 0.4 : 0.7, 0.8);
        if (fg.kind === 'approach' || fg.kind === 'behind') p.send({ t: 'fx', kind: 'glitch', strength: 0.45, ticks: 12 });
      }
      if (!m.removed) {
        s.particles(m.dim, 'glitch', m.x, m.y + 1, m.z, 12, 0.4);
        m.remove();
      }
      this.figures.splice(i, 1);
    }
  }

  /** Walks (or runs) him towards a player, along the ground, through anything in the way. */
  private moveTowards(m: Mob, p: ServerPlayer, speed: number): void {
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

  // ------------------------------------------------------------------ glitching players

  /** One of his tricks on a player: controls reversed, the fake lag, the hotbar shuffled, the name glitched, the world tearing. */
  private glitchy(p: ServerPlayer): void {
    const s = this.server;
    const kinds = ['reverse', 'lag', 'hotbar', 'name', 'corrupt', 'hack'] as const;
    let kind: (typeof kinds)[number] = kinds[this.rng.int(kinds.length)]!;
    if (kind === 'lag') {
      // Pulled back to where they were a few seconds ago, as if the connection hitched
      const back = this.trail.get(p.uuid)?.[0];
      if (back && back[0] === p.dim.id && Math.hypot(back[1] - p.x, back[3] - p.z) > 1.5 && Math.hypot(back[1] - p.x, back[3] - p.z) < 16 && !STATE_SOLID[p.dim.getState(Math.floor(back[1]), Math.floor(back[2]), Math.floor(back[3]))]) {
        s.teleport(p, back[1], back[2], back[3]);
        p.send({ t: 'fx', kind: 'glitch', strength: 0.5, ticks: 10 });
        return;
      }
      kind = 'corrupt';
    }
    if (kind === 'hotbar') {
      const full = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => p.inventory.get(i));
      if (full.length) {
        const a = full[this.rng.int(full.length)]!;
        let b = this.rng.int(9);
        if (b === a) b = (a + 1 + this.rng.int(8)) % 9;
        const sa = p.inventory.get(a);
        p.inventory.set(a, p.inventory.get(b));
        p.inventory.set(b, sa);
        p.send({ t: 'fx', kind: 'glitch', strength: 0.4, ticks: 10 });
        return;
      }
      kind = 'hack';
    }
    switch (kind) {
      case 'reverse':
        p.send({ t: 'fx', kind: 'controls_reversed', ticks: 60 + this.rng.int(60) });
        p.send({ t: 'fx', kind: 'hack', text: 'PLAYER CONTROL OVERRIDE', strength: 1, ticks: 30 });
        break;
      case 'name':
        // For a minute everyone sees their messages come from someone else
        this.glitchedNames.set(p.uuid, s.tickNo + 20 * 60);
        p.send({ t: 'fx', kind: 'player_glitch' });
        break;
      case 'corrupt':
        p.send({ t: 'fx', kind: 'corrupt_world', strength: 0.45, ticks: 50 });
        break;
      case 'hack':
        p.send({ t: 'fx', kind: 'hack', text: HACKS[this.rng.int(HACKS.length)]!, strength: 1, ticks: 36 });
        break;
    }
  }

  /** The name a player's chat appears under: torn up, or his, while he has it. */
  chatName(p: ServerPlayer): string | null {
    const until = this.glitchedNames.get(p.uuid);
    if (until === undefined) return null;
    if (this.server.tickNo > until || !this.state) {
      this.glitchedNames.delete(p.uuid);
      return null;
    }
    if (this.rng.next() < 0.35) return 'Herobrine';
    return [...p.name].map((c) => (this.rng.next() < 0.45 ? GLYPHS[this.rng.int(GLYPHS.length)]! : c)).join('');
  }

  // ------------------------------------------------------------------ playing admin

  /** He uses the world like an admin: messages, midnight, thunder, lightning, a player moved, torches turned red. */
  private chaos(p: ServerPlayer, st: HauntState, stage: HauntStage): void {
    const s = this.server;
    const kinds = stage === 'signs' ? (['admin', 'admin', 'op'] as const) : (['admin', 'midnight', 'thunder', 'lightning', 'lightning', 'blink', 'torches', 'op'] as const);
    const kind = kinds[this.rng.int(kinds.length)]!;
    const players = [...s.players.values()];
    const someone = players[this.rng.int(players.length)]!;
    switch (kind) {
      case 'admin':
        s.broadcastChat(`[Admin] Herobrine used: ${HAUNT_ADMIN_LINES[this.rng.int(HAUNT_ADMIN_LINES.length)]!.replace('{name}', someone.name)}`, 'system');
        break;
      case 'op':
        s.broadcastChat(this.rng.next() < 0.5 ? 'Herobrine is now an operator' : 'Herobrine changed the difficulty to Hard', 'system');
        break;
      case 'midnight':
        if (p.dim.id !== 'overworld') return;
        this.rememberSky(st);
        s.level.dayTime = 18000;
        s.admin.markSky();
        s.sendTime();
        p.send({ t: 'fx', kind: 'glitch', strength: 0.35, ticks: 10 });
        break;
      case 'thunder':
        if (p.dim.id !== 'overworld') return;
        this.rememberSky(st);
        s.interaction.weather.set('thunder', 1200 + this.rng.int(1800));
        s.admin.markSky();
        break;
      case 'lightning': {
        // Close, never on anyone: the flash and the sound, nothing burns
        const [x, z] = this.around(p, 7, 16);
        if (!p.dim.isLoaded(x, z)) return;
        const y = p.dim.getHeight(x, z);
        s.broadcastNear(p.dim, x, y, z, 256, { t: 'particles', kind: 'lightning', x: x + 0.5, y, z: z + 0.5, count: 1 });
        s.broadcastNear(p.dim, x, y, z, 512, { t: 'sound', name: 'thunder', x, y, z, volume: 10, pitch: 0.7 + this.rng.next() * 0.2 });
        break;
      }
      case 'blink': {
        // Moved a few blocks behind where they stood, between one frame and the next
        for (let tries = 0; tries < 10; tries++) {
          const a = p.yaw + Math.PI + (this.rng.next() - 0.5) * 1.2;
          const r = 8 + this.rng.next() * 6;
          const x = Math.floor(p.x - Math.sin(a) * r);
          const z = Math.floor(p.z - Math.cos(a) * r);
          const y = this.floorNear(p.dim, x, z, Math.floor(p.y), 6);
          if (y === null) continue;
          s.teleport(p, x + 0.5, y, z + 0.5);
          p.send({ t: 'fx', kind: 'glitch', strength: 0.6, ticks: 14 });
          s.playSound(p.dim, 'herobrine.teleport', x + 0.5, y + 1, z + 0.5, 0.8, 0.7);
          return;
        }
        break;
      }
      case 'torches':
        this.redTorches(p);
        break;
    }
  }

  private rememberSky(st: HauntState): void {
    const l = this.server.level;
    st.sky ??= { dayTime: l.dayTime, raining: l.raining, thundering: l.thundering, rainTime: l.rainTime, thunderTime: l.thunderTime };
  }

  private restoreSky(st: HauntState): void {
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

  /** Every torch around a player turned into a redstone torch. */
  private redTorches(p: ServerPlayer): void {
    const dim = p.dim;
    const r = 14;
    let n = 0;
    for (let x = Math.floor(p.x) - r; x <= p.x + r && n < 40; x++)
      for (let z = Math.floor(p.z) - r; z <= p.z + r && n < 40; z++)
        for (let y = Math.floor(p.y) - 6; y <= p.y + 8 && n < 40; y++) {
          const st = dim.getState(x, y, z);
          if (!st) continue;
          const id = blocks[STATE_BLOCK[st]!]!.id;
          if (id === 'torch' && this.set(dim, x, y, z, S('redstone_torch'))) n++;
          else if (id === 'wall_torch' && this.set(dim, x, y, z, stateOf('redstone_wall_torch', { facing: String(getProp(st, 'facing') ?? 'north') }))) n++;
        }
    if (n) this.server.playSound(dim, 'herobrine.presence', p.x, p.y + 1, p.z, 0.6, 0.8);
  }

  // ------------------------------------------------------------------ his monsters

  /** Monsters out of the dark: glitched ones at first, then wither skeletons, a warden, once a Glitch Beast. */
  private summon(p: ServerPlayer, st: HauntState, f: number): void {
    const s = this.server;
    if (!s.mobs || p.dim.id === 'computer') return;
    const near = p.dim.entitiesNear(p.x, p.y, p.z, 48, (e) => e instanceof Mob && !!e.data.hauntMob && !e.removed).length;
    if (near >= MAX_MOBS) return;
    let type: string;
    let count = 1;
    if (f < HAUNT_TALK_AT) {
      type = ['glitch_zombie', 'glitch_skeleton', 'zombie', 'skeleton'][this.rng.int(4)]!;
      count = 2 + this.rng.int(2);
    } else if (f > 0.85 && !st.done.includes('beast')) {
      type = 'glitch_beast';
      st.done.push('beast');
    } else {
      const wardens = [...s.dims.values()].some((d) => [...d.entities.values()].some((e) => e instanceof Mob && e.type === 'warden' && !!e.data.hauntMob && !e.removed));
      const pool = wardens ? ['wither_skeleton', 'wither_skeleton', 'glitch_zombie', 'glitch_skeleton'] : ['wither_skeleton', 'wither_skeleton', 'warden', 'glitch_zombie', 'glitch_skeleton'];
      type = pool[this.rng.int(pool.length)]!;
      count = type === 'wither_skeleton' ? 2 : 1;
    }
    for (let k = 0; k < Math.min(count, MAX_MOBS - near); k++) {
      for (let tries = 0; tries < 10; tries++) {
        const [x, z] = this.around(p, 10, 18);
        const y = this.floorNear(p.dim, x, z, Math.floor(p.y), 10);
        if (y === null) continue;
        const m = type === 'warden' && s.warden ? s.warden.summon(p.dim, x + 0.5, y, z + 0.5, null, { admin: true }) : s.mobs.spawn(p.dim, type, x + 0.5, y, z + 0.5, { reason: 'haunting' });
        if (!m) continue;
        m.admin = true;
        m.persistent = false;
        m.data.hauntMob = true;
        m.target = p;
        s.particles(p.dim, 'glitch', x + 0.5, y + 1, z + 0.5, 16, 0.6);
        s.playSound(p.dim, 'herobrine.presence', x + 0.5, y + 1, z + 0.5, 0.7, 0.6);
        break;
      }
    }
  }

  /** His monsters gone (Stop, the end). */
  private clearMobs(): void {
    for (const d of this.server.dims.values())
      for (const e of [...d.entities.values()]) {
        if (!(e instanceof Mob) || !e.data.hauntMob || e.removed) continue;
        this.server.particles(d, 'glitch', e.x, e.y + 1, e.z, 10, 0.5);
        e.remove();
      }
  }

  // ------------------------------------------------------------------ talking to him

  /** Somebody said something in chat: from "He speaks" on, he may answer. */
  onChat(p: ServerPlayer, text: string): void {
    const s = this.server;
    const st = this.state;
    if (!st) return;
    this.remember(p.name, text);
    const f = st.t / st.total;
    if (f < HAUNT_TALK_AT || this.scene || this.chase || this.talking) return;
    if ((st.said ?? 0) >= HAUNT_MAX_ANSWERS) return;
    if (s.tickNo - (this.lastAnswer.get(p.uuid) ?? -1e9) < 100) return;
    // Talking to him nearly always gets an answer; talking about anything else, sometimes
    const addressed = /\b(herobrine|hero|hb|you|u|ur|your|yours)\b|\?/i.test(text);
    if (this.rng.next() > (addressed ? 0.9 : 0.35)) return;
    this.talking = true;
    this.lastAnswer.set(p.uuid, s.tickNo);
    st.said = (st.said ?? 0) + 1;
    const req = this.voiceRequest(p, text, st);
    const started = s.tickNo;
    const timeout = new Promise<null>((res) => setTimeout(() => res(null), 10_000));
    const ask = s.herobrineVoice ? Promise.race([s.herobrineVoice(req).catch(() => null), timeout]) : Promise.resolve(null);
    void ask.then((reply) => {
      let line = cleanVoiceLine(reply);
      // The same filter as everyone's chat: if it would mask anything, he says something else
      if (line && filter.mask(line).changed) line = null;
      const said = line ?? scriptedReply(req, () => this.rng.next());
      // A moment to "type", however fast the answer came
      s.later(Math.max(1, 30 + this.rng.int(30) - (s.tickNo - started)), () => {
        this.talking = false;
        if (!this.state || this.scene) return;
        for (const o of s.players.values()) o.send({ t: 'chat', text: said, kind: 'herobrine', from: 'Herobrine' });
        if (s.players.has(p.conn.id)) p.send({ t: 'fx', kind: 'glitch', strength: 0.4, ticks: 12 });
        this.remember('Herobrine', said);
      });
    });
  }

  private remember(from: string, text: string): void {
    this.history.push({ from, text: text.slice(0, 200) });
    if (this.history.length > 10) this.history.shift();
  }

  /** What he knows when someone speaks to him. */
  private voiceRequest(p: ServerPlayer, text: string, st: HauntState): VoiceRequest {
    const s = this.server;
    const held = p.inventory.get(p.selectedSlot);
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const t = s.level.dayTime;
    return {
      player: p.name,
      message: text,
      history: this.history.slice(-9, -1),
      facts: {
        holding: held ? items[held.id]?.def.name : undefined,
        health: Math.round(p.health),
        dimension: p.dim.id === 'overworld' ? 'the overworld' : p.dim.id === 'computer' ? 'the computer' : `the ${p.dim.id}`,
        biome: biomeOf(p.dim.getBiome(x, z)).name,
        night: p.dim.id === 'overworld' ? t > 13000 && t < 23000 : undefined,
        underground: p.dim.getHeight(x, z) > p.y + 5,
        others: [...s.players.values()].filter((o) => o !== p).map((o) => o.name),
        deaths: st.deaths?.[p.uuid] ?? 0,
        x,
        y: Math.floor(p.y),
        z,
      },
    };
  }

  // ------------------------------------------------------------------ the end

  private finale(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.server;
    if (!st.final) {
      // Decided as the end begins (and kept, so a reload ends the same way)
      st.final = (st.ending ?? 'random') === 'random' ? (this.rng.next() < HAUNT_CORRUPT_CHANCE ? 'corrupted' : 'ban') : (st.ending as 'ban' | 'corrupted');
      this.clearMobs();
    }
    if (s.tickNo % 20 === 0 && (!this.scene || this.scene.t < HAUNT_SCENE.arrive)) for (const p of players) p.send({ t: 'fx', kind: 'haunt', strength: 0.95 });
    if (st.final === 'corrupted') {
      this.corruptedEnd(st, f, players);
      return;
    }
    if (f >= HAUNT_CHASE_AT && !this.chase) {
      this.chase = { since: s.tickNo, caught: new Set() };
      for (const fg of this.figures) if (!fg.m.removed) fg.m.remove();
      this.figures.length = 0;
      for (const p of players) this.startChase(p);
    }
    if (this.chase) {
      // Anyone who joined during the chase is hunted too
      for (const p of players) if (!this.chase.caught.has(p.uuid) && !this.figures.some((x) => x.p === p)) this.startChase(p);
      const all = players.every((p) => this.chase!.caught.has(p.uuid));
      if (all && this.endAt < 0) this.endAt = s.tickNo + 50;
      if (s.tickNo - this.chase.since > HAUNT_CHASE_MAX_TICKS + 40 && this.endAt < 0) {
        for (const p of players) this.catch(p);
        this.endAt = s.tickNo + 50;
      }
    } else if (st.t >= st.total) {
      // The timeline ran out before the chase could start (a very short haunting)
      this.chase = { since: s.tickNo, caught: new Set() };
    }
    if (this.endAt >= 0 && s.tickNo >= this.endAt) this.finish(st, 'ban');
  }

  private startChase(p: ServerPlayer): void {
    if (this.chase?.caught.has(p.uuid)) return;
    for (let tries = 0; tries < 16; tries++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = 22 + this.rng.next() * 6;
      const x = Math.floor(p.x - Math.sin(a) * r);
      const z = Math.floor(p.z - Math.cos(a) * r);
      const y = this.floorNear(p.dim, x, z, Math.floor(p.y), 16);
      if (y === null) continue;
      if (this.spawnFigure(p, 'chase', x + 0.5, y, z + 0.5)) {
        this.server.playSound(p.dim, 'herobrine.charge', x + 0.5, y + 1, z + 0.5, 1.5, 0.7);
        return;
      }
    }
    // Nowhere to stand: he is simply there
    this.catch(p);
  }

  /** He reached a player: the jumpscare. */
  private catch(p: ServerPlayer): void {
    if (!this.chase || this.chase.caught.has(p.uuid)) return;
    this.chase.caught.add(p.uuid);
    p.send({ t: 'fx', kind: 'jumpscare', ticks: 60 });
  }

  // ------------------------------------------------------------------ the lair ending

  private computerLayout(): ReturnType<ComputerWorldGenerator['layout']> {
    return (this.server.dim('computer').generator as ComputerWorldGenerator).layout();
  }

  /**
   * He grabs everyone and drags them along the ground, pulls them into the
   * computer, and they wake up wired into chairs in his hall: three shocks,
   * death, SERVER MEMORY CORRUPTED, the title screen.
   */
  private corruptedEnd(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.server;
    if (!this.scene) {
      if (f < HAUNT_CHASE_AT && st.t < st.total) return;
      this.scene = { t: -1, taken: new Map(), lair: null };
      for (const fg of this.figures) if (!fg.m.removed) fg.m.remove();
      this.figures.length = 0;
    }
    const sc = this.scene;
    sc.t++;
    const t = sc.t;
    const T = HAUNT_SCENE;
    const L = this.computerLayout();
    const cw = s.dim('computer');
    // His hall is loaded and ready by the time anyone arrives
    if (t <= T.wake) cw.want(L.throne.x >> 4, L.throne.z >> 4, 2, s.tickNo);
    if (t === T.grab) {
      let i = 0;
      for (const p of players) {
        if (p.dead || p.gamemode === 'spectator') continue;
        // Right in front of them, on the way he will drag them (open, level ground; in a tight
        // spot he stays close and pulls without getting anywhere)
        const [dir, clear] = dragWay(p);
        const len = Math.max(0, Math.min(8, clear - 2.5));
        const lead = Math.max(1, Math.min(1.7, clear - len - 0.3));
        const fx = p.x + dir[0] * lead;
        const fz = p.z + dir[1] * lead;
        const fy = this.floorNear(p.dim, Math.floor(fx), Math.floor(fz), Math.floor(p.y), 1) ?? p.y;
        const drag = this.apparition(p.dim, fx, fy, fz, Math.atan2(-(p.x - fx), -(p.z - fz)), 'idle');
        sc.taken.set(p.uuid, { p, from: [p.dim.id, p.x, p.y, p.z, p.yaw], drag, dir, len, lead, chair: null, i: i++ });
        // The camera turns to him
        p.send({ t: 'fx', kind: 'scene', text: 'grab', ticks: T.drag - T.grab, x: p.x, y: p.y, z: p.z, x1: fx, y1: fy + 1.6, z1: fz });
        p.send({ t: 'fx', kind: 'shake', strength: 0.8, ticks: 12 });
        s.playSound(p.dim, 'herobrine.charge', p.x, p.y + 1, p.z, 1.4, 0.8);
      }
    }
    for (const e of sc.taken.values()) {
      const p = e.p;
      if (!s.players.has(p.conn.id)) continue;
      if (t === T.drag) {
        // Dragged along the ground behind him
        const [ux, uz] = e.dir;
        const ex = e.from[1] + ux * e.len;
        const ez = e.from[3] + uz * e.len;
        const ey = this.floorNear(p.dim, Math.floor(ex), Math.floor(ez), Math.floor(p.y), 6) ?? p.y;
        // strength 0: nowhere to drag them (a tight spot), they stay on their feet facing him
        p.send({ t: 'fx', kind: 'scene', text: 'drag', ticks: T.dragTicks, x: e.from[1], y: e.from[2], z: e.from[3], x1: ex, y1: ey, z1: ez, strength: e.len > 0.5 ? 1 : 0 });
      }
      if (t > T.drag && t < T.pull && e.drag && !e.drag.removed) {
        // He walks backwards ahead of them, pulling
        const k = Math.min(1, (t - T.drag) / T.dragTicks);
        const e2 = k * k * (3 - 2 * k);
        const [ux, uz] = e.dir;
        const x = e.from[1] + ux * (e.lead + e.len * e2);
        const z = e.from[3] + uz * (e.lead + e.len * e2);
        // Along the same ground as them, never down a hole out of sight
        const y = this.floorNear(e.drag.dim, Math.floor(x), Math.floor(z), Math.floor(e.drag.y), 1) ?? e.drag.y;
        e.drag.setPos(x, y, z);
        e.drag.yaw = Math.atan2(ux, uz);
        e.drag.headYaw = e.drag.yaw;
        e.drag.metaDirty = true;
        if ((t - T.drag) % 18 === 0) s.playSound(p.dim, 'herobrine.whisper', x, y + 1, z, 0.6, 0.6 + k * 0.3);
      }
      if (t === T.pull) {
        p.send({ t: 'fx', kind: 'enter_computer', ticks: 36 });
        p.send({ t: 'sound', name: 'computer.enter', x: p.x, y: p.y + 1, z: p.z, volume: 1.2, pitch: 0.8 });
      }
      if (t === T.arrive) {
        if (e.drag && !e.drag.removed) e.drag.remove();
        e.drag = null;
        // A row of chairs in front of his throne, one for each of them
        const row = Math.floor(e.i / 6);
        const col = e.i % 6;
        const n = Math.min(6, sc.taken.size - row * 6);
        const cx = L.throne.x - 8 - row * 3;
        const cz = Math.round(L.throne.z + (col - (n - 1) / 2) * 3);
        e.chair = [cx, L.hall.y, cz];
        this.buildChair(cw, cx, L.hall.y, cz);
        // Facing east, towards him
        s.changeDimension(p, 'computer', cx + 0.5, L.hall.y + 0.5, cz + 0.5, -Math.PI / 2, { admin: true });
        p.send({ t: 'fx', kind: 'scene', text: 'black', ticks: T.wake - T.arrive });
      }
    }
    if (t === T.arrive && !sc.lair) sc.lair = this.apparition(cw, L.throne.x + 0.5, L.throne.y, L.throne.z + 0.5, Math.PI / 2, 'stare');
    // Chairs whose chunk was not there yet
    if (t > T.arrive && t <= T.wake) for (const e of sc.taken.values()) if (e.chair) this.buildChair(cw, ...e.chair);
    if (t === T.wake)
      for (const e of sc.taken.values()) {
        if (!s.players.has(e.p.conn.id)) continue;
        e.p.send({ t: 'fx', kind: 'scene', text: 'wake', ticks: 60 });
        e.p.send({ t: 'fx', kind: 'haunt', strength: 0.35 });
      }
    // The wires: a current running into each of them from the chains above
    if (t >= T.wake && t < T.die && (t - T.wake) % 20 === 0)
      for (const e of sc.taken.values()) {
        if (!e.chair || !s.players.has(e.p.conn.id)) continue;
        const [cx, cy, cz] = e.chair;
        for (const o of s.players.values()) if (o.dim === cw) o.send({ t: 'fx', kind: 'arc', id: 900000 + e.i, x: cx + 1.5, y: cy + 2, z: cz + 0.5, x1: e.p.x, y1: e.p.y + 1.1, z1: e.p.z, ticks: 24, strength: 0 });
      }
    if ((T.shocks as readonly number[]).includes(t))
      for (const e of sc.taken.values()) {
        if (!e.chair || !s.players.has(e.p.conn.id)) continue;
        const p = e.p;
        const [cx, cy, cz] = e.chair;
        const coil = [...L.coils].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
        p.send({ t: 'fx', kind: 'scene', text: 'shock', ticks: 14 });
        p.send({ t: 'fx', kind: 'shake', strength: 0.9, ticks: 12 });
        for (const o of s.players.values()) {
          if (o.dim !== cw) continue;
          o.send({ t: 'fx', kind: 'arc', id: 900100 + e.i, x: cx + 1.5, y: cy + 2, z: cz + 0.5, x1: p.x, y1: p.y + 1.1, z1: p.z, ticks: 12, strength: 1 });
          if (coil) o.send({ t: 'fx', kind: 'arc', id: 900200 + e.i, x: coil.x + 0.5, y: coil.y + 2, z: coil.z + 0.5, x1: p.x, y1: p.y + 1, z1: p.z, ticks: 12, strength: 1 });
        }
        s.playSound(cw, 'tesla.zap', p.x, p.y + 1, p.z, 1.4, 0.8 + this.rng.next() * 0.3);
        s.particles(cw, 'crit', p.x, p.y + 1, p.z, 14, 0.5);
      }
    if (t === T.die)
      for (const e of sc.taken.values()) {
        if (!s.players.has(e.p.conn.id)) continue;
        e.p.send({ t: 'fx', kind: 'scene', text: 'die', ticks: T.corrupt - T.die });
        s.playSound(cw, 'herobrine.slam', e.p.x, e.p.y + 1, e.p.z, 1, 0.6);
      }
    // Everyone sees the end, taken or not (someone who joined during it too)
    if (t === T.corrupt) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'corrupt', ticks: T.end - T.corrupt });
    if (t >= T.end) this.finish(st, 'corrupted');
  }

  /** A chair facing his throne (east), chains hanging from the roof over it and right in front of the face. */
  private buildChair(dim: Dimension, x: number, y: number, z: number): void {
    if (!dim.isLoaded(x, z) || !dim.isLoaded(x + 1, z)) return;
    const chair = stateOf('dark_oak_stairs', { facing: 'west' });
    if (dim.getState(x, y, z) !== chair) {
      for (let dy = 1; dy < 3; dy++) if (dim.getState(x, y + dy, z) !== 0) this.set(dim, x, y + dy, z, 0);
      this.set(dim, x, y, z, chair);
    }
    const chain = stateOf('chain', { axis: 'y' });
    for (const [cx, from] of [
      [x, y + 3],
      [x + 1, y + 2],
    ] as const)
      for (let cy = from; cy < y + 16; cy++) {
        const st = dim.getState(cx, cy, z);
        if (st === chain) continue;
        if (st !== 0) break;
        this.set(dim, cx, cy, z, chain);
      }
  }

  /** The lair ending stops: his figures gone; `restore` puts everyone he took back where they were; `tell` clears their screen. */
  private endScene(restore: boolean, tell: boolean): void {
    const sc = this.scene;
    if (!sc) return;
    this.scene = null;
    const s = this.server;
    if (sc.lair && !sc.lair.removed) sc.lair.remove();
    for (const e of sc.taken.values()) {
      if (e.drag && !e.drag.removed) e.drag.remove();
      const p = e.p;
      if (!s.players.has(p.conn.id)) continue;
      if (tell) p.send({ t: 'fx', kind: 'scene', text: 'end', ticks: 1 });
      if (!restore) continue;
      const [d, x, y, z, yaw] = e.from;
      if (p.dim.id !== d) s.changeDimension(p, d, x, y, z, yaw, { admin: true });
      else if (Math.hypot(p.x - x, p.z - z) > 0.5) s.teleport(p, x, y, z, yaw);
    }
  }

  /** Everyone out: the fake ban, or straight back to the title after SERVER MEMORY CORRUPTED; the world deleted (by its owner's client) if that was chosen. */
  private finish(st: HauntState, kind: 'ban' | 'corrupted'): void {
    const s = this.server;
    const erase = st.erase;
    this.restoreSky(st);
    // Nobody stays inside the computer: a kept world finds them where they were
    this.endScene(true, false);
    s.level.flags.haunt = undefined;
    s.level.flags.hauntBlocks = [];
    for (const f of this.figures) if (!f.m.removed) f.m.remove();
    this.figures.length = 0;
    this.chase = null;
    this.endAt = -1;
    this.dark.clear();
    this.clearMobs();
    this.glitchedNames.clear();
    // Owners last: a host leaving takes everyone else with it
    const all = [...s.players.values()].sort((a, b) => Number(s.roleOf(a) === 'owner') - Number(s.roleOf(b) === 'owner'));
    for (const p of all) {
      const own = erase && s.roleOf(p) === 'owner';
      if (kind === 'ban') s.kick(p, HAUNT_BAN.title, { ban: { ...HAUNT_BAN, deleted: erase }, erase: own });
      else s.kick(p, 'SERVER MEMORY CORRUPTED', { corrupted: true, erase: own });
    }
  }

  // ------------------------------------------------------------------ the signs he leaves

  /** Changes a block (if its chunk is loaded and it holds no block entity) and records it. */
  private set(dim: Dimension, x: number, y: number, z: number, state: number): boolean {
    const prev = dim.getState(x, y, z);
    if (prev === state || !dim.isLoaded(x, z) || dim.getBlockEntity(x, y, z)) return false;
    const old = dim.setBlock(x, y, z, state);
    if (old < 0) return false;
    this.changes.push([dim.id, x, y, z, old, state]);
    if (state !== 0) this.server.admin.setBlockMark(dim, x, y, z, true);
    return true;
  }

  private idAt(dim: Dimension, x: number, y: number, z: number): string {
    return blocks[STATE_BLOCK[dim.getState(x, y, z)]!]!.id;
  }

  /** Air, or a plant or snow layer that can be replaced. */
  private open(dim: Dimension, x: number, y: number, z: number): boolean {
    return openAt(dim, x, y, z);
  }

  private solidGround(dim: Dimension, x: number, y: number, z: number): boolean {
    return solidAt(dim, x, y, z);
  }

  /**
   * The y to stand at near (x, z): solid ground below, two open blocks above,
   * searched from `range` above the hint downwards (the surface, or a cave floor).
   */
  private floorNear(dim: Dimension, x: number, z: number, yHint: number, range: number): number | null {
    return floorAt(dim, x, z, yHint, range);
  }

  /** A spot around a player, mostly behind or beside them (so it is there when they turn round). */
  private around(p: ServerPlayer, lo: number, hi: number): [number, number] {
    const behind = this.rng.next() < 0.7;
    const a = behind ? p.yaw + Math.PI + (this.rng.next() - 0.5) * 2.4 : this.rng.next() * Math.PI * 2;
    const r = lo + this.rng.next() * (hi - lo);
    return [Math.floor(p.x - Math.sin(a) * r), Math.floor(p.z - Math.cos(a) * r)];
  }

  private placeTorch(p: ServerPlayer): void {
    const dim = p.dim;
    const underground = dim.getHeight(Math.floor(p.x), Math.floor(p.z)) > p.y + 6;
    for (let tries = 0; tries < 24; tries++) {
      if (underground) {
        // In a cave: on the walls around you
        const x = Math.floor(p.x) + this.rng.int(21) - 10;
        const y = Math.floor(p.y) + this.rng.int(7) - 2;
        const z = Math.floor(p.z) + this.rng.int(21) - 10;
        if (Math.hypot(x - p.x, z - p.z) < 4 || !this.open(dim, x, y, z)) continue;
        for (const facing of ['north', 'south', 'west', 'east']) {
          const st = stateOf('redstone_wall_torch', { facing });
          if (canSurvive(st, dim, x, y, z) && this.set(dim, x, y, z, st)) return;
        }
        continue;
      }
      const [x, z] = this.around(p, 6, 22);
      const y = this.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (y === null) continue;
      const st = S('redstone_torch');
      if (canSurvive(st, dim, x, y, z) && this.set(dim, x, y, z, st)) return;
    }
  }

  /** A cobblestone cross floating in the air, turned to face the player. */
  private placeCross(p: ServerPlayer, ring: boolean): void {
    const dim = p.dim;
    for (let n = ring ? 2 + this.rng.int(3) : 1; n > 0; n--) {
      for (let tries = 0; tries < 12; tries++) {
        const [x, z] = this.around(p, ring ? 10 : 14, ring ? 18 : 32);
        const g = this.floorNear(dim, x, z, Math.floor(p.y), 16);
        if (g === null) continue;
        const base = g + 2 + this.rng.int(3);
        const alongX = Math.abs(p.z - z) > Math.abs(p.x - x);
        const cells: [number, number, number][] = [];
        for (let h = 0; h < 5; h++) cells.push([x, base + h, z]);
        for (const o of [-1, 1]) cells.push(alongX ? [x + o, base + 3, z] : [x, base + 3, z + o]);
        if (!cells.every(([cx, cy, cz]) => dim.getState(cx, cy, cz) === 0 && dim.isLoaded(cx, cz))) continue;
        const st = S(this.rng.next() < 0.25 ? 'mossy_cobblestone' : 'cobblestone');
        for (const [cx, cy, cz] of cells) this.set(dim, cx, cy, cz, st);
        break;
      }
    }
  }

  /** A perfectly straight 2x2 tunnel into a hillside that ends nowhere (or a 2x2 hole on flat ground). */
  private digTunnel(p: ServerPlayer): void {
    const dim = p.dim;
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let tries = 0; tries < 10; tries++) {
      const [sx, sz] = this.around(p, 10, 28);
      const g = this.floorNear(dim, sx, sz, Math.floor(p.y), 16);
      if (g === null) continue;
      const [dx, dz] = dirs[this.rng.int(4)]!;
      const ahead = this.floorNear(dim, sx + dx * 5, sz + dz * 5, g, 12);
      if (ahead === null || ahead < g + 3) continue;
      // Into the hill, two wide and two high, until something isn't plain ground
      const len = 10 + this.rng.int(9);
      let dug = 0;
      let end: [number, number] | null = null;
      for (let i = 0; i < len; i++) {
        const cells: [number, number, number][] = [];
        for (let w = 0; w < 2; w++) for (let h = 0; h < 2; h++) cells.push([sx + dx * i + dz * w, g + h, sz + dz * i + dx * w]);
        if (!cells.every(([x, y, z]) => this.open(dim, x, y, z) || (NATURAL.test(this.idAt(dim, x, y, z)) && !dim.getBlockEntity(x, y, z)))) break;
        for (const [x, y, z] of cells) if (!this.open(dim, x, y, z) && this.set(dim, x, y, z, 0)) dug++;
        end = [sx + dx * i, sz + dz * i];
      }
      if (dug >= 6 && end) {
        const st = S('redstone_torch');
        if (canSurvive(st, dim, end[0], g, end[1])) this.set(dim, end[0], g, end[1], st);
        return;
      }
    }
    // No hillside around: a 2x2 hole straight down, not deep enough to hurt much
    for (let tries = 0; tries < 6; tries++) {
      const [x, z] = this.around(p, 10, 24);
      const g = this.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (g === null) continue;
      let ok = true;
      for (let w = 0; w < 2 && ok; w++) for (let v = 0; v < 2 && ok; v++) for (let d = 1; d <= 4; d++) if (!NATURAL.test(this.idAt(dim, x + w, g - d, z + v))) ok = false;
      if (!ok) continue;
      for (let w = 0; w < 2; w++) for (let v = 0; v < 2; v++) for (let d = 1; d <= 4; d++) this.set(dim, x + w, g - d, z + v, 0);
      return;
    }
  }

  /** Every leaf of a nearby tree gone, the trunk left standing. */
  private stripTree(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 30; tries++) {
      const [x, z] = this.around(p, 12, 36);
      if (!dim.isLoaded(x, z)) continue;
      const top = dim.getHeight(x, z) - 1;
      if (!/leaves$/.test(this.idAt(dim, x, top, z))) continue;
      // Every connected leaf within reach of that one
      const seen = new Set<string>();
      const queue: [number, number, number][] = [[x, top, z]];
      let n = 0;
      while (queue.length && n < 160) {
        const [cx, cy, cz] = queue.shift()!;
        const k = `${cx},${cy},${cz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (Math.abs(cx - x) > 5 || Math.abs(cz - z) > 5 || cy < top - 8 || !/leaves$/.test(this.idAt(dim, cx, cy, cz))) continue;
        if (this.set(dim, cx, cy, cz, 0)) n++;
        queue.push([cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy + 1, cz], [cx, cy - 1, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
      }
      if (n) return;
    }
  }

  /** A small sand pyramid rising out of the water, redstone torches at its corners. */
  private sandPyramid(p: ServerPlayer): void {
    const dim = p.dim;
    const water = S('water');
    const isWater = (x: number, y: number, z: number): boolean => STATE_BLOCK[dim.getState(x, y, z)] === STATE_BLOCK[water];
    for (let tries = 0; tries < 30; tries++) {
      const [x, z] = this.around(p, 14, 40);
      if (!dim.isLoaded(x - 2, z - 2) || !dim.isLoaded(x + 2, z + 2)) continue;
      const surface = dim.getHeight(x, z) - 1;
      if (!isWater(x, surface, z)) continue;
      // The sea floor under every cell of the base, no deeper than 8
      const floors: number[] = [];
      let ok = true;
      for (let dx = -2; dx <= 2 && ok; dx++)
        for (let dz = -2; dz <= 2 && ok; dz++) {
          let y = surface;
          while (y > surface - 9 && isWater(x + dx, y, z + dz)) y--;
          if (y <= surface - 9 || !STATE_SOLID[dim.getState(x + dx, y, z + dz)] || dim.getState(x + dx, surface + 1, z + dz) !== 0) ok = false;
          floors.push(y);
        }
      if (!ok) continue;
      const sand = S('sand');
      let i = 0;
      // From the sea floor up (sand falls), then two steps above the water
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = floors[i++]! + 1; y <= surface; y++) this.set(dim, x + dx, y, z + dz, sand);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.set(dim, x + dx, surface + 1, z + dz, sand);
      this.set(dim, x, surface + 2, z, sand);
      const torch = S('redstone_torch');
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const)
        if (canSurvive(torch, dim, x + dx, surface + 2, z + dz)) this.set(dim, x + dx, surface + 2, z + dz, torch);
      return;
    }
  }

  /** A sign facing the player: STOP, I SEE YOU... */
  private placeSign(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 16; tries++) {
      const [x, z] = this.around(p, 6, 16);
      const y = this.floorNear(dim, x, z, Math.floor(p.y), 10);
      if (y === null) continue;
      // Turned towards where the player stands (the way a sign faces whoever placed it)
      const yaw = Math.atan2(-(x + 0.5 - p.x), -(z + 0.5 - p.z));
      const rot = Math.round(((((-yaw * 180) / Math.PI + 180) % 360) + 360) % 360 / 22.5) % 16;
      if (!this.set(dim, x, y, z, stateOf('sign', { rotation: String(rot) }))) continue;
      const lines = HAUNT_SIGNS[this.rng.int(HAUNT_SIGNS.length)]!;
      dim.setBlockEntity(x, y, z, { type: 'sign', lines: [...lines] });
      this.server.sendToWatchers(dim, x, z, { t: 'block_entity', x, y, z, data: { type: 'sign', lines: [...lines] } });
      return;
    }
  }

  /** The torches around a player go out, one to three of them. */
  private torchesOut(p: ServerPlayer): void {
    const dim = p.dim;
    let n = 1 + this.rng.int(3);
    for (let tries = 0; tries < 400 && n > 0; tries++) {
      const x = Math.floor(p.x) + this.rng.int(25) - 12;
      const y = Math.floor(p.y) + this.rng.int(9) - 4;
      const z = Math.floor(p.z) + this.rng.int(25) - 12;
      const id = this.idAt(dim, x, y, z);
      if ((id === 'torch' || id === 'wall_torch') && this.set(dim, x, y, z, 0)) {
        this.server.playSound(dim, 'fire.extinguish', x + 0.5, y + 0.5, z + 0.5, 0.4, 0.6);
        n--;
      }
    }
  }

  /** The old summoning shrine: gold, mossy cobblestone, redstone torches, netherrack burning on top. */
  private buildShrine(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 24; tries++) {
      const [x, z] = this.around(p, 12, 22);
      const g = this.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (g === null) continue;
      // Level ground for the 3x3 base, open air above it
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++)
        for (let dz = -1; dz <= 1 && ok; dz++) {
          if (!this.solidGround(dim, x + dx, g - 1, z + dz)) ok = false;
          for (let h = 0; h < 5 && ok; h++) if (!this.open(dim, x + dx, g + h, z + dz)) ok = false;
        }
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.set(dim, x + dx, g, z + dz, S('gold_block'));
      this.set(dim, x, g + 1, z, S('mossy_cobblestone'));
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        this.set(dim, x + dx, g + 1, z + dz, S('redstone_torch'));
      this.set(dim, x, g + 2, z, S('netherrack'));
      this.set(dim, x, g + 3, z, S('fire'));
      this.server.playSound(dim, 'herobrine.presence', x + 0.5, g + 2, z + 0.5, 1, 0.7);
      return;
    }
  }

  private creepySound(p: ServerPlayer): void {
    const a = p.yaw + Math.PI + (this.rng.next() - 0.5) * 1.5;
    const r = 6 + this.rng.next() * 10;
    const x = p.x - Math.sin(a) * r;
    const z = p.z - Math.cos(a) * r;
    const name = ['cave.rumble', 'cave.drip', 'herobrine.whisper', 'herobrine.presence'][this.rng.int(4)]!;
    p.send({ t: 'sound', name, x, y: p.y + 1, z, volume: 0.5, pitch: 0.7 + this.rng.next() * 0.2 });
  }

  // ------------------------------------------------------------------ looking

  private lookingAt(p: ServerPlayer, x: number, y: number, z: number, cos: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const dx = x - ex;
    const dy = y - ey;
    const dz = z - ez;
    const d = Math.hypot(dx, dy, dz) || 1;
    const cp = Math.cos(p.pitch);
    return ((-Math.sin(p.yaw) * cp) * dx + -Math.sin(p.pitch) * dy + (-Math.cos(p.yaw) * cp) * dz) / d > cos;
  }

  /** Nothing solid between the player's eyes and a point. */
  private clearLine(p: ServerPlayer, x: number, y: number, z: number): boolean {
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
}
