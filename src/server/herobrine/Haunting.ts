/**
 * The Haunting (Admin Panel, every world): Herobrine as the old stories
 * tell it, over a timeline the panel chose (src/common/game/haunting.ts).
 *
 *   watching  far off in the fog, gone when you look again; a redstone torch nobody placed
 *   signs     cobblestone crosses in the air, 2x2 tunnels that lead nowhere, trees without
 *             leaves, sand pyramids in the water, signs, torches going out, "Herobrine joined"
 *   closer    he walks towards you, then is gone; the music stops, the dark closes in; a shrine;
 *             "YOU ARE NOT SAFE"
 *   speaks    he talks, stands right behind you, and the signs are everywhere
 *   finale    he comes for everyone at once: a jumpscare each, then everyone is thrown out
 *             with a fake ban screen, and the world is deleted if its owner chose that
 *
 * The timeline only moves while someone is in the world, and it is saved
 * (level.flags.haunt), so a reload carries on where it was. Herobrine
 * himself is never saved: his figures are untouchable, AI-less copies of the
 * V5.5 model, the way its sightings in the fog are made. Every block he
 * places or takes is recorded (level.flags.hauntBlocks) so Stop can put the
 * world back exactly; blocks he places are marked as cheat-made, so they
 * count for nothing.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import type { Mob } from '../entity/Mob';
import type { DimensionId } from '../../common/data/biomes';
import { S, stateOf, blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID } from '../../common/registry/blocks';
import { canSurvive } from '../../common/game/placement';
import { Random } from '../../common/math/rng';
import {
  HAUNT_STAGES,
  HAUNT_LINES,
  HAUNT_JOIN_AT,
  HAUNT_SIGNS,
  HAUNT_BAN,
  HAUNT_CHASE_AT,
  HAUNT_CHASE_MAX_TICKS,
  hauntStage,
  type HauntStage,
  type HauntStatus,
  type HauntOp,
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
}

/** A block he changed: dimension, position, what was there, what he put. */
type Change = [DimensionId, number, number, number, number, number];
const MAX_CHANGES = 4000;

type FigureKind = 'far' | 'mid' | 'approach' | 'behind' | 'chase';

interface Figure {
  m: Mob;
  p: ServerPlayer;
  kind: FigureKind;
  since: number;
  /** Ticks the player has been looking straight at him. */
  seen: number;
}

/** Ground he may dig a tunnel through (never anything a player made). */
const NATURAL = /^(stone|dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|sand|red_sand|sandstone|red_sandstone|gravel|granite|diorite|andesite|deepslate|tuff|calcite|clay|terracotta|[a-z_]+_terracotta|snow_block|mud|moss_block|netherrack|end_stone)$/;
/** What a figure may stand on, or a cross float over, as ground. */
const PLANT = /(^|_)(grass|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|bush|sapling|mushroom|snow|marigold|reeds?|sprouts|roots|petals|clover|vine|vines)$/;

/** Events per player over each stage (spread at random through it): more and more as it goes on. */
const BUDGET: Record<HauntStage, Partial<Record<'sight' | 'torch' | 'cross' | 'tunnel' | 'tree' | 'pyramid' | 'sign' | 'dark' | 'sound' | 'glitch', number>>> = {
  watching: { sight: 3, torch: 1, tree: 1, sound: 2 },
  signs: { sight: 3, torch: 4, cross: 3, tunnel: 2, tree: 2, pyramid: 1, sign: 2, dark: 1, sound: 3 },
  closer: { sight: 3, torch: 5, cross: 4, tunnel: 2, tree: 2, sign: 3, dark: 2, sound: 3, glitch: 2 },
  speaks: { sight: 4, torch: 6, cross: 8, tunnel: 1, tree: 2, sign: 4, dark: 2, sound: 4, glitch: 6 },
  finale: {},
};

export class HauntingSystem {
  private readonly figures: Figure[] = [];
  private readonly rng = new Random();
  /** Players whose music has been stopped, and the last darkness each was sent. */
  private readonly silenced = new Set<string>();
  private readonly dark = new Map<string, number>();
  private chase: { since: number; caught: Set<string> } | null = null;
  /** When everyone has been caught: the tick the end comes. */
  private endAt = -1;

  constructor(readonly server: GameServer) {}

  get state(): HauntState | null {
    const st = this.server.level.flags.haunt as HauntState | undefined;
    return st && typeof st.t === 'number' && typeof st.total === 'number' && st.total > 0 ? st : null;
  }

  private get changes(): Change[] {
    const f = this.server.level.flags;
    if (!Array.isArray(f.hauntBlocks)) f.hauntBlocks = [];
    return f.hauntBlocks as Change[];
  }

  // ------------------------------------------------------------------ the Admin Panel

  admin(p: ServerPlayer, op: HauntOp, minutes?: number, erase?: boolean): { ok: boolean; text: string; data?: unknown } {
    const reply = (ok: boolean, text: string): { ok: boolean; text: string; data: HauntStatus } => ({ ok, text, data: this.status(p) });
    switch (op) {
      case 'status':
        return reply(true, '');
      case 'start': {
        if (this.state) return reply(false, 'A haunting is already running. Stop it first.');
        if (erase && this.server.roleOf(p) !== 'owner') return reply(false, "Only the world's owner can choose to have the world deleted at the end.");
        this.server.level.flags.haunt = { t: 0, total: Math.round((minutes ?? 30) * 60 * 20), erase: !!erase, by: p.uuid, done: [] } satisfies HauntState;
        return reply(true, `The haunting has begun. It ends in ${minutes} minute${minutes === 1 ? '' : 's'}${erase ? ', and then the world is deleted' : ' (the world is kept)'}.`);
      }
      case 'stop': {
        if (!this.state && !this.changes.length) return reply(false, 'No haunting is running.');
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
    };
  }

  /** Ends the haunting and puts back every block he changed. Returns how many. */
  stop(): number {
    const s = this.server;
    this.server.level.flags.haunt = undefined;
    for (const f of this.figures) if (!f.m.removed) f.m.remove();
    this.figures.length = 0;
    this.chase = null;
    this.endAt = -1;
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
    this.silenced.clear();
    this.dark.clear();
    return n;
  }

  /** The music back and the dark gone, for one player. */
  private calm(p: ServerPlayer): void {
    if (this.silenced.has(p.uuid)) p.send({ t: 'fx', kind: 'unsilence' });
    p.send({ t: 'fx', kind: 'haunt', strength: 0 });
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    const st = this.state;
    this.stepFigures();
    if (!st) return;
    const players = [...s.players.values()];
    // The timeline only moves while someone is here
    if (!players.length) return;
    st.t++;
    const f = Math.min(1, st.t / st.total);
    const stage = hauntStage(f);
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
      }
    }
    // The dark closes in from "closer" on, and the music stops
    if (s.tickNo % 20 === 0) {
      const dark = Math.max(0, Math.min(1, (f - 0.45) / (0.94 - 0.45)));
      for (const p of players) {
        if (f >= 0.45 && !this.silenced.has(p.uuid)) {
          this.silenced.add(p.uuid);
          p.send({ t: 'fx', kind: 'silence' });
        }
        const last = this.dark.get(p.uuid) ?? -1;
        if (Math.abs(last - dark) >= 0.02 || (s.tickNo % 200 === 0 && dark > 0)) {
          this.dark.set(p.uuid, dark);
          p.send({ t: 'fx', kind: 'haunt', strength: dark * 0.85 });
        }
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

  private spawnFigure(p: ServerPlayer, kind: FigureKind, x: number, y: number, z: number): Mob | null {
    const m = this.server.mobs?.spawn(p.dim, 'herobrine', x, y, z, { reason: 'boss', data: { apparition: true, haunting: true } });
    if (!m) return null;
    m.noAi = true;
    m.persistent = false;
    m.data.untouchable = true;
    m.data.apparition = true;
    m.data.hbAnim = kind === 'chase' || kind === 'approach' ? 'idle' : 'stare';
    m.yaw = Math.atan2(-(p.x - x), -(p.z - z));
    m.headYaw = m.yaw;
    m.metaDirty = true;
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

  // ------------------------------------------------------------------ the end

  private finale(st: HauntState, f: number, players: ServerPlayer[]): void {
    const s = this.server;
    if (!this.silenced.size) for (const p of players) (this.silenced.add(p.uuid), p.send({ t: 'fx', kind: 'silence' }));
    if (s.tickNo % 20 === 0) for (const p of players) p.send({ t: 'fx', kind: 'haunt', strength: 0.95 });
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
    if (this.endAt >= 0 && s.tickNo >= this.endAt) this.finish(st);
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

  /** Everyone out, with a fake ban; the world deleted (by its owner's client) if that was chosen. */
  private finish(st: HauntState): void {
    const s = this.server;
    const erase = st.erase;
    s.level.flags.haunt = undefined;
    s.level.flags.hauntBlocks = [];
    for (const f of this.figures) if (!f.m.removed) f.m.remove();
    this.figures.length = 0;
    this.chase = null;
    this.endAt = -1;
    this.silenced.clear();
    this.dark.clear();
    // Owners last: a host leaving takes everyone else with it
    const all = [...s.players.values()].sort((a, b) => Number(s.roleOf(a) === 'owner') - Number(s.roleOf(b) === 'owner'));
    for (const p of all) s.kick(p, HAUNT_BAN.title, { ban: { ...HAUNT_BAN, deleted: erase }, erase: erase && s.roleOf(p) === 'owner' });
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
    const st = dim.getState(x, y, z);
    return st === 0 || (!STATE_SOLID[st] && !STATE_FLUID[st] && PLANT.test(blocks[STATE_BLOCK[st]!]!.id));
  }

  private solidGround(dim: Dimension, x: number, y: number, z: number): boolean {
    const st = dim.getState(x, y, z);
    return !!STATE_SOLID[st] && !STATE_FLUID[st] && !/leaves$/.test(blocks[STATE_BLOCK[st]!]!.id);
  }

  /**
   * The y to stand at near (x, z): solid ground below, two open blocks above,
   * searched from `range` above the hint downwards (the surface, or a cave floor).
   */
  private floorNear(dim: Dimension, x: number, z: number, yHint: number, range: number): number | null {
    if (!dim.isLoaded(x, z)) return null;
    const top = Math.min(dim.getHeight(x, z) + 1, yHint + range);
    for (let y = top; y >= Math.max(1, yHint - range); y--) {
      if (this.solidGround(dim, x, y - 1, z) && this.open(dim, x, y, z) && this.open(dim, x, y + 1, z)) return y;
    }
    return null;
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
