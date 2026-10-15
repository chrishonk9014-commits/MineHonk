/**
 * Herobrine's part of the Haunting, as it has always been:
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
 *             SERVER MEMORY CORRUPTED).
 *
 * His figures are untouchable, AI-less copies of the V5.5 model. V7 phase 4:
 * in the automatic haunting he also notices what players do (react()).
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { Dimension } from '../../world/Dimension';
import type { HauntingSystem } from '../Haunting';
import { Mob } from '../../entity/Mob';
import type { DimensionId } from '../../../common/data/biomes';
import type { ComputerWorldGenerator } from '../../../common/gen/computer';
import { S, stateOf, blocks, STATE_BLOCK, STATE_SOLID, getProp } from '../../../common/registry/blocks';
import { canSurvive } from '../../../common/game/placement';
import { dragWay } from '../../world/drag';
import { HAUNT_SIGNS, HAUNT_CHASE_AT, HAUNT_CHASE_MAX_TICKS, HAUNT_TALK_AT, HAUNT_CORRUPT_CHANCE, HAUNT_SCENE, HAUNT_ADMIN_LINES, type HauntStage } from '../../../common/game/haunting';
import { HEROBRINE_NOTICES, type HauntNotice } from '../../../common/game/hauntCast';
import type { HauntPart, HauntState, Figure } from './types';

/** His monsters near one player at once. */
const MAX_MOBS = 6;

type FigureKind = 'far' | 'mid' | 'approach' | 'behind' | 'chase' | 'test';

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

/** Events per player over each stage (spread at random through it): more and more as it goes on. */
const BUDGET: Record<HauntStage, Record<string, number>> = {
  watching: { sight: 3, torch: 1, tree: 1, sound: 2 },
  signs: { sight: 3, torch: 4, cross: 3, tunnel: 2, tree: 2, pyramid: 1, sign: 2, dark: 1, sound: 3, glitchy: 1, chaos: 1 },
  closer: { sight: 3, torch: 5, cross: 4, tunnel: 2, tree: 2, sign: 3, dark: 2, sound: 3, glitch: 2, glitchy: 3, chaos: 2, mob: 1 },
  speaks: { sight: 4, torch: 6, cross: 8, tunnel: 1, tree: 2, sign: 4, dark: 2, sound: 4, glitch: 6, glitchy: 5, chaos: 4, mob: 3 },
  finale: {},
};

/** Words torn across a glitched player's screen. */
const HACKS = ['HE IS HERE', 'YOU CANNOT LEAVE', 'I AM IN YOUR WORLD', 'DO NOT LOOK BEHIND YOU', 'HEROBRINE.EXE', 'PLAYER DATA OVERWRITTEN'];
const GLYPHS = '#%&@$?!/\\|<>=+*0123456789';

/** What he leaves where someone slept (the automatic haunting). */
const SLEEP_SIGN = ['', 'I WATCHED', 'YOU SLEEP', ''];

export class HerobrineHaunt implements HauntPart {
  readonly id = 'herobrine' as const;
  readonly budget = BUDGET;
  private chase: { since: number; caught: Set<string> } | null = null;
  /** When everyone has been caught: the tick the end comes. */
  private endAt = -1;
  private scene: Scene | null = null;

  constructor(private readonly h: HauntingSystem) {}

  private get rng(): { next(): number; int(n: number): number } {
    return this.h.rng;
  }

  /** He is chasing everyone down (the end). */
  get chasing(): boolean {
    return !!this.chase;
  }

  holds(p: ServerPlayer): boolean {
    return !!this.scene?.taken.has(p.uuid);
  }

  silent(delivering: boolean): boolean {
    return delivering ? !!this.scene : !!this.scene || !!this.chase;
  }

  reset(why: 'stop' | 'end'): void {
    this.endScene(true, why === 'stop');
    this.chase = null;
    this.endAt = -1;
  }

  event(kind: string, p: ServerPlayer, st: HauntState, stage: string, f: number): void {
    switch (kind) {
      case 'sight':
        this.sight(p, stage as HauntStage);
        break;
      case 'torch':
        for (let k = stage === 'watching' ? 1 : 1 + this.rng.int(3); k > 0; k--) this.placeTorch(p);
        break;
      case 'cross':
        this.placeCross(p, stage === 'speaks');
        break;
      case 'tunnel':
        this.digTunnel(p);
        break;
      case 'tree':
        this.stripTree(p);
        break;
      case 'pyramid':
        this.sandPyramid(p);
        break;
      case 'sign':
        this.placeSign(p);
        break;
      case 'dark':
        this.h.torchesOut(p, 1 + this.rng.int(3));
        break;
      case 'sound':
        this.creepySound(p);
        break;
      case 'glitch':
        p.send({ t: 'fx', kind: 'glitch', strength: 0.25 + this.rng.next() * 0.25, ticks: 8 + this.rng.int(10) });
        break;
      case 'glitchy':
        this.glitchy(p);
        break;
      case 'chaos':
        this.chaos(p, st, stage);
        break;
      case 'mob':
        this.summon(p, st, f);
        break;
    }
  }

  oneOffs(_st: HauntState, _f: number, players: ServerPlayer[], once: (key: string, at: number) => boolean): void {
    if (once('shrine', 0.5)) {
      const p = players[this.rng.int(players.length)]!;
      this.buildShrine(p);
    }
  }

  /** The dark closes in from "closer" on. */
  atmosphere(_st: HauntState, f: number, players: ServerPlayer[]): void {
    const dark = Math.max(0, Math.min(1, (f - 0.45) / (0.94 - 0.45)));
    for (const p of players) this.h.sendDark(p, dark);
  }

  // ------------------------------------------------------------------ the figure

  private sight(p: ServerPlayer, stage: HauntStage): void {
    if (this.h.figures.some((f) => f.p === p)) return;
    const kind: FigureKind = stage === 'watching' ? 'far' : stage === 'signs' ? 'mid' : stage === 'closer' ? 'approach' : 'behind';
    const [lo, hi] = kind === 'far' ? [40, 64] : kind === 'mid' ? [24, 40] : kind === 'approach' ? [16, 24] : [4, 7];
    const max = Math.max(lo + 4, Math.min(hi, p.viewDistance * 16 - 12));
    for (let tries = 0; tries < 12; tries++) {
      // In view (so it can be seen), or right behind for "behind"
      const a = kind === 'behind' ? p.yaw + Math.PI + (this.rng.next() - 0.5) * 0.9 : p.yaw + (this.rng.next() - 0.5) * 1.1;
      const r = lo + this.rng.next() * (max - lo);
      const x = Math.floor(p.x - Math.sin(a) * r);
      const z = Math.floor(p.z - Math.cos(a) * r);
      const y = this.h.floorNear(p.dim, x, z, Math.floor(p.y), kind === 'behind' ? 4 : 20);
      if (y === null) continue;
      // The first sightings must be possible to see: nothing solid between
      if (kind !== 'behind' && !this.h.clearLine(p, x + 0.5, y + 1.6, z + 0.5)) continue;
      this.figure(p, kind, x + 0.5, y, z + 0.5);
      return;
    }
  }

  private figure(p: ServerPlayer, kind: FigureKind, x: number, y: number, z: number): Mob | null {
    return this.h.spawnFigure(p, kind, x, y, z, kind === 'chase' || kind === 'approach' ? 'idle' : 'stare', {}, {}, 'herobrine');
  }

  /** The Admin Panel's test: he stands in view a little way off, and is gone when looked at for a moment. */
  appear(p: ServerPlayer): boolean {
    const at = this.h.spotNear(p, 12, 20, true);
    return !!at && !!this.figure(p, 'test', ...at);
  }

  stepFigure(fg: Figure, age: number, d: number): boolean {
    const { m, p } = fg;
    m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    m.headYaw = m.yaw;
    if (this.h.lookingAt(p, m.x, m.y + 1.6, m.z, fg.kind === 'behind' ? 0.8 : 0.975)) fg.seen++;
    if (fg.kind === 'chase') {
      if (d < 1.5 || age > HAUNT_CHASE_MAX_TICKS) {
        this.catch(p);
        m.remove();
        return false;
      }
      this.h.moveTowards(m, p, 0.55);
      return true;
    }
    if (fg.kind === 'approach' && age > 20) this.h.moveTowards(m, p, 0.16);
    const vanish =
      fg.kind === 'far'
        ? d < 20 || fg.seen >= 30 || age > 300
        : fg.kind === 'mid'
          ? d < 14 || fg.seen >= 20 || age > 300
          : fg.kind === 'test'
            ? d < 4 || fg.seen >= 40 || age > 240
            : fg.kind === 'approach'
              ? d < 5 || age > 110
              : fg.seen >= 3 || d < 2 || age > 200;
    return !vanish;
  }

  vanish(fg: Figure, gone: boolean): void {
    const s = this.h.server;
    const { m, p } = fg;
    if (!gone) {
      p.send({ t: 'fx', kind: 'afterimage', id: m.id, ticks: 14 });
      s.playSound(m.dim, fg.kind === 'behind' ? 'herobrine.presence' : 'herobrine.whisper', m.x, m.y + 1, m.z, fg.kind === 'far' ? 0.4 : 0.7, 0.8);
      if (fg.kind === 'approach' || fg.kind === 'behind') p.send({ t: 'fx', kind: 'glitch', strength: 0.45, ticks: 12 });
    }
    s.particles(m.dim, 'glitch', m.x, m.y + 1, m.z, 12, 0.4);
  }

  // ------------------------------------------------------------------ glitching players

  /** One of his tricks on a player: controls reversed, the fake lag, the hotbar shuffled, the name glitched, the world tearing. */
  glitchy(p: ServerPlayer): void {
    const s = this.h.server;
    const kinds = ['reverse', 'lag', 'hotbar', 'name', 'corrupt', 'hack'] as const;
    let kind: (typeof kinds)[number] = kinds[this.rng.int(kinds.length)]!;
    if (kind === 'lag') {
      // Pulled back to where they were a few seconds ago, as if the connection hitched
      const back = this.h.trail.get(p.uuid)?.[0];
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
        this.h.glitchedNames.set(p.uuid, s.tickNo + 20 * 60);
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

  /** A glitched player's name in chat: torn up, or his. */
  glitchName(p: ServerPlayer): string {
    if (this.rng.next() < 0.35) return 'Herobrine';
    return [...p.name].map((c) => (this.rng.next() < 0.45 ? GLYPHS[this.rng.int(GLYPHS.length)]! : c)).join('');
  }

  // ------------------------------------------------------------------ playing admin

  /** He uses the world like an admin: messages, midnight, thunder, lightning, a player moved, torches turned red. */
  chaos(p: ServerPlayer, st: HauntState, stage: string): void {
    const s = this.h.server;
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
        this.h.rememberSky(st);
        s.level.dayTime = 18000;
        s.admin.markSky();
        s.sendTime();
        p.send({ t: 'fx', kind: 'glitch', strength: 0.35, ticks: 10 });
        break;
      case 'thunder':
        if (p.dim.id !== 'overworld') return;
        this.h.rememberSky(st);
        s.interaction.weather.set('thunder', 1200 + this.rng.int(1800));
        s.admin.markSky();
        break;
      case 'lightning': {
        // Close, never on anyone: the flash and the sound, nothing burns
        const [x, z] = this.h.around(p, 7, 16);
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
          const y = this.h.floorNear(p.dim, x, z, Math.floor(p.y), 6);
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

  /** Every torch around a player turned into a redstone torch. */
  private redTorches(p: ServerPlayer): void {
    const dim = p.dim;
    const r = 14;
    let n = 0;
    for (let x = Math.floor(p.x) - r; x <= p.x + r && n < 40; x++)
      for (let z = Math.floor(p.z) - r; z <= p.z + r && n < 40; z++)
        for (let y = Math.floor(p.y) - 6; y <= p.y + 8 && n < 40; y++) {
          if (this.redden(dim, x, y, z)) n++;
        }
    if (n) this.h.server.playSound(dim, 'herobrine.presence', p.x, p.y + 1, p.z, 0.6, 0.8);
  }

  /** A torch here turned into a redstone torch. */
  private redden(dim: Dimension, x: number, y: number, z: number): boolean {
    const st = dim.getState(x, y, z);
    if (!st) return false;
    const id = blocks[STATE_BLOCK[st]!]!.id;
    if (id === 'torch') return this.h.set(dim, x, y, z, S('redstone_torch'));
    if (id === 'wall_torch') return this.h.set(dim, x, y, z, stateOf('redstone_wall_torch', { facing: String(getProp(st, 'facing') ?? 'north') }));
    return false;
  }

  // ------------------------------------------------------------------ his monsters

  /** Monsters out of the dark: glitched ones at first, then wither skeletons, a warden, once a Glitch Beast. */
  summon(p: ServerPlayer, st: HauntState, f: number): void {
    const s = this.h.server;
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
        const [x, z] = this.h.around(p, 10, 18);
        const y = this.h.floorNear(p.dim, x, z, Math.floor(p.y), 10);
        if (y === null) continue;
        const m = type === 'warden' && s.warden ? s.warden.summon(p.dim, x + 0.5, y, z + 0.5, null, { admin: true }) : s.mobs.spawn(p.dim, type, x + 0.5, y, z + 0.5, { reason: 'haunting' });
        if (!m) continue;
        this.h.markMob(m, p);
        s.particles(p.dim, 'glitch', x + 0.5, y + 1, z + 0.5, 16, 0.6);
        s.playSound(p.dim, 'herobrine.presence', x + 0.5, y + 1, z + 0.5, 0.7, 0.6);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ noticing (the automatic haunting)

  /**
   * He noticed what a player did. Until "Closer" he only answers with a sign
   * of himself (a sound behind them, the torch they placed turned red); from
   * then on with a remark in chat too, when `remark` lets him (at most one a
   * minute or so; it records that he spoke). His remarks are scripted.
   */
  react(p: ServerPlayer, what: HauntNotice, stage: string, remark: (() => void) | null, at?: [number, number, number]): void {
    if (stage === 'finale' || p.dead) return;
    switch (what) {
      case 'torch':
        if (at && stage !== 'watching') this.redden(p.dim, ...at);
        else this.creepySound(p);
        break;
      case 'run':
        if (stage !== 'watching') this.sight(p, 'signs');
        break;
      case 'underground':
        this.creepySound(p);
        if (stage === 'closer' || stage === 'speaks') this.h.torchesOut(p, 1, 10);
        break;
      case 'sleep':
        if (stage !== 'watching') this.h.placeSign(p, SLEEP_SIGN, 2, 5);
        break;
      default:
        this.creepySound(p);
    }
    if (!remark || stage === 'watching' || stage === 'signs') return;
    remark();
    const lines = HEROBRINE_NOTICES[what];
    const text = lines[this.rng.int(lines.length)]!.replace('{name}', p.name.toUpperCase());
    this.h.say(p, text, true);
    this.h.remember('Herobrine', text.replace(p.name.toUpperCase(), 'YOU'));
  }

  // ------------------------------------------------------------------ the end

  finale(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.h.server;
    if (!st.final) {
      // Decided as the end begins (and kept, so a reload ends the same way)
      st.final = (st.ending ?? 'random') === 'random' ? (this.rng.next() < HAUNT_CORRUPT_CHANCE ? 'corrupted' : 'ban') : st.ending;
      this.h.clearMobs();
    }
    if (s.tickNo % 20 === 0 && (!this.scene || this.scene.t < HAUNT_SCENE.arrive)) for (const p of players) p.send({ t: 'fx', kind: 'haunt', strength: 0.95 });
    if (st.final === 'corrupted') {
      this.corruptedEnd(st, f, players);
      return;
    }
    if (f >= HAUNT_CHASE_AT && !this.chase) {
      this.chase = { since: s.tickNo, caught: new Set() };
      this.h.clearFigures();
      for (const p of players) this.startChase(p);
    }
    if (this.chase) {
      // Anyone who joined during the chase is hunted too
      for (const p of players) if (!this.chase.caught.has(p.uuid) && !this.h.figures.some((x) => x.p === p)) this.startChase(p);
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
    if (this.endAt >= 0 && s.tickNo >= this.endAt) this.h.finish(st, { kind: 'ban' });
  }

  private startChase(p: ServerPlayer): void {
    if (this.chase?.caught.has(p.uuid)) return;
    for (let tries = 0; tries < 16; tries++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = 22 + this.rng.next() * 6;
      const x = Math.floor(p.x - Math.sin(a) * r);
      const z = Math.floor(p.z - Math.cos(a) * r);
      const y = this.h.floorNear(p.dim, x, z, Math.floor(p.y), 16);
      if (y === null) continue;
      if (this.figure(p, 'chase', x + 0.5, y, z + 0.5)) {
        this.h.server.playSound(p.dim, 'herobrine.charge', x + 0.5, y + 1, z + 0.5, 1.5, 0.7);
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
    return (this.h.server.dim('computer').generator as ComputerWorldGenerator).layout();
  }

  /**
   * He grabs everyone and drags them along the ground, pulls them into the
   * computer, and they wake up wired into chairs in his hall: three shocks,
   * death, SERVER MEMORY CORRUPTED, the title screen.
   */
  private corruptedEnd(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.h.server;
    if (!this.scene) {
      if (f < HAUNT_CHASE_AT && st.t < st.total) return;
      this.scene = { t: -1, taken: new Map(), lair: null };
      this.h.clearFigures();
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
        const fy = this.h.floorNear(p.dim, Math.floor(fx), Math.floor(fz), Math.floor(p.y), 1) ?? p.y;
        const drag = this.h.apparition(p.dim, 'herobrine', fx, fy, fz, Math.atan2(-(p.x - fx), -(p.z - fz)), 'idle');
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
        const ey = this.h.floorNear(p.dim, Math.floor(ex), Math.floor(ez), Math.floor(p.y), 6) ?? p.y;
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
        const y = this.h.floorNear(e.drag.dim, Math.floor(x), Math.floor(z), Math.floor(e.drag.y), 1) ?? e.drag.y;
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
    if (t === T.arrive && !sc.lair) sc.lair = this.h.apparition(cw, 'herobrine', L.throne.x + 0.5, L.throne.y, L.throne.z + 0.5, Math.PI / 2, 'stare');
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
    if (t >= T.end) this.h.finish(st, { kind: 'corrupted' });
  }

  /** A chair facing his throne (east), chains hanging from the roof over it and right in front of the face. */
  private buildChair(dim: Dimension, x: number, y: number, z: number): void {
    if (!dim.isLoaded(x, z) || !dim.isLoaded(x + 1, z)) return;
    const chair = stateOf('dark_oak_stairs', { facing: 'west' });
    if (dim.getState(x, y, z) !== chair) {
      for (let dy = 1; dy < 3; dy++) if (dim.getState(x, y + dy, z) !== 0) this.h.set(dim, x, y + dy, z, 0);
      this.h.set(dim, x, y, z, chair);
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
        this.h.set(dim, cx, cy, z, chain);
      }
  }

  /** The lair ending stops: his figures gone; `restore` puts everyone he took back where they were; `tell` clears their screen. */
  private endScene(restore: boolean, tell: boolean): void {
    const sc = this.scene;
    if (!sc) return;
    this.scene = null;
    const s = this.h.server;
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

  // ------------------------------------------------------------------ the signs he leaves

  private placeTorch(p: ServerPlayer): void {
    const dim = p.dim;
    const underground = dim.getHeight(Math.floor(p.x), Math.floor(p.z)) > p.y + 6;
    for (let tries = 0; tries < 24; tries++) {
      if (underground) {
        // In a cave: on the walls around you
        const x = Math.floor(p.x) + this.rng.int(21) - 10;
        const y = Math.floor(p.y) + this.rng.int(7) - 2;
        const z = Math.floor(p.z) + this.rng.int(21) - 10;
        if (Math.hypot(x - p.x, z - p.z) < 4 || !this.h.open(dim, x, y, z)) continue;
        for (const facing of ['north', 'south', 'west', 'east']) {
          const st = stateOf('redstone_wall_torch', { facing });
          if (canSurvive(st, dim, x, y, z) && this.h.set(dim, x, y, z, st)) return;
        }
        continue;
      }
      const [x, z] = this.h.around(p, 6, 22);
      const y = this.h.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (y === null) continue;
      const st = S('redstone_torch');
      if (canSurvive(st, dim, x, y, z) && this.h.set(dim, x, y, z, st)) return;
    }
  }

  /** A cobblestone cross floating in the air, turned to face the player. */
  private placeCross(p: ServerPlayer, ring: boolean): void {
    const dim = p.dim;
    for (let n = ring ? 2 + this.rng.int(3) : 1; n > 0; n--) {
      for (let tries = 0; tries < 12; tries++) {
        const [x, z] = this.h.around(p, ring ? 10 : 14, ring ? 18 : 32);
        const g = this.h.floorNear(dim, x, z, Math.floor(p.y), 16);
        if (g === null) continue;
        const base = g + 2 + this.rng.int(3);
        const alongX = Math.abs(p.z - z) > Math.abs(p.x - x);
        const cells: [number, number, number][] = [];
        for (let h = 0; h < 5; h++) cells.push([x, base + h, z]);
        for (const o of [-1, 1]) cells.push(alongX ? [x + o, base + 3, z] : [x, base + 3, z + o]);
        if (!cells.every(([cx, cy, cz]) => dim.getState(cx, cy, cz) === 0 && dim.isLoaded(cx, cz))) continue;
        const st = S(this.rng.next() < 0.25 ? 'mossy_cobblestone' : 'cobblestone');
        for (const [cx, cy, cz] of cells) this.h.set(dim, cx, cy, cz, st);
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
      const [sx, sz] = this.h.around(p, 10, 28);
      const g = this.h.floorNear(dim, sx, sz, Math.floor(p.y), 16);
      if (g === null) continue;
      const [dx, dz] = dirs[this.rng.int(4)]!;
      const ahead = this.h.floorNear(dim, sx + dx * 5, sz + dz * 5, g, 12);
      if (ahead === null || ahead < g + 3) continue;
      // Into the hill, two wide and two high, until something isn't plain ground
      const len = 10 + this.rng.int(9);
      let dug = 0;
      let end: [number, number] | null = null;
      for (let i = 0; i < len; i++) {
        const cells: [number, number, number][] = [];
        for (let w = 0; w < 2; w++) for (let h = 0; h < 2; h++) cells.push([sx + dx * i + dz * w, g + h, sz + dz * i + dx * w]);
        if (!cells.every(([x, y, z]) => this.h.open(dim, x, y, z) || (NATURAL.test(this.h.idAt(dim, x, y, z)) && !dim.getBlockEntity(x, y, z)))) break;
        for (const [x, y, z] of cells) if (!this.h.open(dim, x, y, z) && this.h.set(dim, x, y, z, 0)) dug++;
        end = [sx + dx * i, sz + dz * i];
      }
      if (dug >= 6 && end) {
        const st = S('redstone_torch');
        if (canSurvive(st, dim, end[0], g, end[1])) this.h.set(dim, end[0], g, end[1], st);
        return;
      }
    }
    // No hillside around: a 2x2 hole straight down, not deep enough to hurt much
    for (let tries = 0; tries < 6; tries++) {
      const [x, z] = this.h.around(p, 10, 24);
      const g = this.h.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (g === null) continue;
      let ok = true;
      for (let w = 0; w < 2 && ok; w++) for (let v = 0; v < 2 && ok; v++) for (let d = 1; d <= 4; d++) if (!NATURAL.test(this.h.idAt(dim, x + w, g - d, z + v))) ok = false;
      if (!ok) continue;
      for (let w = 0; w < 2; w++) for (let v = 0; v < 2; v++) for (let d = 1; d <= 4; d++) this.h.set(dim, x + w, g - d, z + v, 0);
      return;
    }
  }

  /** Every leaf of a nearby tree gone, the trunk left standing. */
  private stripTree(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 30; tries++) {
      const [x, z] = this.h.around(p, 12, 36);
      if (!dim.isLoaded(x, z)) continue;
      const top = dim.getHeight(x, z) - 1;
      if (!/leaves$/.test(this.h.idAt(dim, x, top, z))) continue;
      // Every connected leaf within reach of that one
      const seen = new Set<string>();
      const queue: [number, number, number][] = [[x, top, z]];
      let n = 0;
      while (queue.length && n < 160) {
        const [cx, cy, cz] = queue.shift()!;
        const k = `${cx},${cy},${cz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (Math.abs(cx - x) > 5 || Math.abs(cz - z) > 5 || cy < top - 8 || !/leaves$/.test(this.h.idAt(dim, cx, cy, cz))) continue;
        if (this.h.set(dim, cx, cy, cz, 0)) n++;
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
      const [x, z] = this.h.around(p, 14, 40);
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
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = floors[i++]! + 1; y <= surface; y++) this.h.set(dim, x + dx, y, z + dz, sand);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.h.set(dim, x + dx, surface + 1, z + dz, sand);
      this.h.set(dim, x, surface + 2, z, sand);
      const torch = S('redstone_torch');
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const)
        if (canSurvive(torch, dim, x + dx, surface + 2, z + dz)) this.h.set(dim, x + dx, surface + 2, z + dz, torch);
      return;
    }
  }

  /** A sign facing the player: STOP, I SEE YOU... */
  private placeSign(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 16; tries++) {
      const [x, z] = this.h.around(p, 6, 16);
      const y = this.h.floorNear(dim, x, z, Math.floor(p.y), 10);
      if (y === null) continue;
      // Turned towards where the player stands (the way a sign faces whoever placed it)
      const yaw = Math.atan2(-(x + 0.5 - p.x), -(z + 0.5 - p.z));
      const rot = Math.round(((((-yaw * 180) / Math.PI + 180) % 360) + 360) % 360 / 22.5) % 16;
      if (!this.h.set(dim, x, y, z, stateOf('sign', { rotation: String(rot) }))) continue;
      const lines = HAUNT_SIGNS[this.rng.int(HAUNT_SIGNS.length)]!;
      dim.setBlockEntity(x, y, z, { type: 'sign', lines: [...lines] });
      this.h.server.sendToWatchers(dim, x, z, { t: 'block_entity', x, y, z, data: { type: 'sign', lines: [...lines] } });
      return;
    }
  }

  /** The old summoning shrine: gold, mossy cobblestone, redstone torches, netherrack burning on top. */
  private buildShrine(p: ServerPlayer): void {
    const dim = p.dim;
    for (let tries = 0; tries < 24; tries++) {
      const [x, z] = this.h.around(p, 12, 22);
      const g = this.h.floorNear(dim, x, z, Math.floor(p.y), 12);
      if (g === null) continue;
      // Level ground for the 3x3 base, open air above it
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++)
        for (let dz = -1; dz <= 1 && ok; dz++) {
          if (!this.h.solidGround(dim, x + dx, g - 1, z + dz)) ok = false;
          for (let h = 0; h < 5 && ok; h++) if (!this.h.open(dim, x + dx, g + h, z + dz)) ok = false;
        }
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.h.set(dim, x + dx, g, z + dz, S('gold_block'));
      this.h.set(dim, x, g + 1, z, S('mossy_cobblestone'));
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        this.h.set(dim, x + dx, g + 1, z + dz, S('redstone_torch'));
      this.h.set(dim, x, g + 2, z, S('netherrack'));
      this.h.set(dim, x, g + 3, z, S('fire'));
      this.h.server.playSound(dim, 'herobrine.presence', x + 0.5, g + 2, z + 0.5, 1, 0.7);
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
}

