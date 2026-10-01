/**
 * Version 4.5: temple trials (worlds made with generator 5).
 *
 * A temple has three trials, one per chamber, done in order: awaken the
 * altars, bring the relic to its altar, light the braziers, set the levers to
 * the glyphs, or survive waves of the temple's guardians. Each trial breaks
 * the seal into the next chamber; the last opens the way up to the arena.
 *
 * Then the Champion's Trial. Whoever stands in the arena when it begins
 * takes part: alone, you fight the temple's champion. With others it is a
 * duel: PvP is on between the contestants (whatever the world's PvP rule),
 * a contestant who would die is knocked out instead (sent back down with a
 * little health, keeping everything), and so is one who leaves the arena.
 * The last one standing takes the temple's prize.
 *
 * Progress per temple is kept in the level data; a fight in progress is not
 * (if everyone leaves, its mobs vanish and it starts again later).
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob } from '../entity/Mob';
import { Random } from '../../common/math/rng';
import { blocks, STATE_BLOCK, getProp, withProp, stateOf } from '../../common/registry/blocks';
import { itemById } from '../../common/registry/items';
import { rollLoot } from '../../common/game/loot';
import { markAdmin } from '../../common/game/itemstack';
import type { Box, Start, TempleMission, TempleQuest } from '../../common/gen/structures/manager';
import type { QuestInfo } from '../../common/net/protocol';
import type { QuestRecord } from '../world/LevelData';

type P3 = [number, number, number];
const same = (a: P3, x: number, y: number, z: number): boolean => a[0] === x && a[1] === y && a[2] === z;
const inBox = (b: Box, x: number, y: number, z: number): boolean => x >= b.x0 && x < b.x1 + 1 && y >= b.y0 && y < b.y1 + 1 && z >= b.z0 && z < b.z1 + 1;
const inBoxP = (b: Box, p: ServerPlayer): boolean => inBox(b, p.x, p.y, p.z);

const MISSION_TEXT: Record<TempleMission['type'], string> = {
  altars: 'Awaken the four altars in this chamber (use them).',
  relic: 'Find the Temple Relic and place it on the altar.',
  braziers: 'Light the four braziers (flint and steel waits in the chest by the door).',
  levers: 'Set the levers: a lever under a bright glyph must be on, the others off.',
  guardians: 'Defeat the guardians of the temple.',
};
const MISSION_NAME: Record<TempleMission['type'], string> = {
  altars: 'The Altars',
  relic: 'The Relic',
  braziers: 'The Braziers',
  levers: 'The Glyphs',
  guardians: 'The Guardians',
};

interface Run {
  key: string;
  dim: Dimension;
  start: Start;
  q: TempleQuest;
  kind: 'guardians' | 'countdown' | 'champion' | 'duel';
  mobs: Mob[];
  maxHp: number;
  wave: number;
  waves: number;
  mission: number;
  /** Duel or champion fight: who is in it. */
  contestants: Set<ServerPlayer>;
  /** Ticks left before the Champion's Trial begins. */
  countdown: number;
  /** Ticks with nobody inside the temple. */
  empty: number;
  cheat: boolean;
  barId: number;
  barred: Set<ServerPlayer>;
}

let barIds = -9000;

export class TempleTrials {
  readonly runs = new Map<string, Run>();
  private readonly shown = new Map<ServerPlayer, string>();

  constructor(private readonly server: GameServer) {}

  private get on(): boolean {
    return this.server.level.generatorVersion >= 5;
  }

  static key(s: Start): string {
    return `${s.type}:${s.x},${s.y},${s.z}`;
  }

  record(s: Start): QuestRecord {
    return (this.server.level.quests.temple[TempleTrials.key(s)] ??= { stage: 0, done: false, rewarded: [], flags: [] });
  }

  /** Temples whose objectives involve chunk (x >> 4, z >> 4). */
  private templesNear(dim: Dimension, x: number, z: number): Start[] {
    if (dim.id !== 'overworld') return [];
    const g = dim.generator as { questStartsAt?(cx: number, cz: number): Start[] };
    return (g.questStartsAt?.(Math.floor(x) >> 4, Math.floor(z) >> 4) ?? []).filter((s) => s.quest?.kind === 'temple');
  }

  /** The temple a player is in, if any. */
  templeAt(p: ServerPlayer): Start | null {
    return this.templesNear(p.dim, p.x, p.z).find((s) => inBoxP((s.quest as TempleQuest).area, p)) ?? null;
  }

  private near(dim: Dimension, s: Start): ServerPlayer[] {
    const q = s.quest as TempleQuest;
    return [...this.server.players.values()].filter((p) => p.dim === dim && !p.dead && p.gamemode !== 'spectator' && inBoxP(q.area, p));
  }

  private online(p: ServerPlayer): boolean {
    return this.server.players.get(p.conn.id) === p;
  }

  private legit(p: ServerPlayer): boolean {
    return p.gamemode !== 'spectator' && !this.server.admin.inContext(p);
  }

  // -------------------------------------------------------------------- hooks

  /** PvP between two players is allowed while they duel each other in a temple's arena. */
  pvpBetween(a: unknown, b: unknown): boolean {
    for (const r of this.runs.values()) if (r.kind === 'duel' && r.contestants.has(a as ServerPlayer) && r.contestants.has(b as ServerPlayer)) return true;
    return false;
  }

  /** A duelling contestant who would die is knocked out of the duel instead. Returns true if spared. */
  spare(p: ServerPlayer, source: string): boolean {
    if (source === 'kill') return false;
    for (const r of this.runs.values()) {
      if (r.kind !== 'duel' || !r.contestants.has(p)) continue;
      p.health = Math.min(p.maxHealth, 6);
      (p as { fireTicks?: number }).fireTicks = 0;
      p.statsDirty = true;
      this.knockOut(r, p, 'was knocked out');
      const [x, y, z] = r.q.exit;
      this.server.teleport(p, x + 0.5, y, z + 0.5);
      return true;
    }
    return false;
  }

  /** Using an altar. Returns true when handled. */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    if (blocks[STATE_BLOCK[state]!]!.id !== 'temple_altar') return false;
    if (!this.on) return true;
    const s = this.templesNear(p.dim, x, z).find((t) => inBox((t.quest as TempleQuest).area, x, y, z));
    if (!s) return true;
    const q = s.quest as TempleQuest;
    const rec = this.record(s);
    const i = q.missions.findIndex((m) => (m.type === 'altars' && m.altars.some((a) => same(a, x, y, z))) || (m.type === 'relic' && same(m.altar, x, y, z)));
    if (i < 0) return true;
    if (getProp(state, 'lit') === 'true') return true;
    if (rec.done || rec.stage > i) return true;
    if (rec.stage < i) {
      p.send({ t: 'chat', text: 'The altar is dormant. Complete the trials before this one first.', kind: 'error' });
      return true;
    }
    const m = q.missions[i]!;
    const dim = p.dim;
    if (m.type === 'relic') {
      const held = p.inventory.get(p.selectedSlot);
      const relic = itemById.get('temple_relic')!.num;
      if (!held || held.id !== relic) {
        p.send({ t: 'chat', text: 'The altar waits for a Temple Relic.', kind: 'error' });
        this.server.playSound(dim, 'block.note.bass', x + 0.5, y + 0.5, z + 0.5, 0.8, 0.5);
        return true;
      }
      if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
      this.server.interaction.syncInventory(p);
    }
    dim.setBlock(x, y, z, withProp(state, 'lit', 'true'));
    this.server.particles(dim, 'flame', x + 0.5, y + 1.1, z + 0.5, 12, 0.3);
    this.server.playSound(dim, 'block.note.pling', x + 0.5, y + 0.5, z + 0.5, 1, 1.2);
    if (m.type === 'relic') this.completeMission(dim, s, i);
    else if (m.type === 'altars') {
      const lit = m.altars.filter((a) => getProp(dim.getState(...a), 'lit') === 'true').length;
      if (lit >= m.altars.length) this.completeMission(dim, s, i);
      else p.send({ t: 'chat', text: `An altar awakens (${lit}/${m.altars.length}).`, kind: 'system' });
    }
    return true;
  }

  /** A block changed: a lever flipped or a brazier lit may complete a trial. */
  onBlockChanged(dim: Dimension, x: number, y: number, z: number, state: number): void {
    if (!this.on) return;
    const id = blocks[STATE_BLOCK[state]!]!.id;
    if (id !== 'lever' && id !== 'campfire') return;
    for (const s of this.templesNear(dim, x, z)) {
      const q = s.quest as TempleQuest;
      const i = q.missions.findIndex((m) => (m.type === 'levers' && m.levers.some((l) => same(l.at, x, y, z))) || (m.type === 'braziers' && m.braziers.some((b) => same(b, x, y, z))));
      if (i >= 0) this.checkPuzzle(dim, s, i);
    }
  }

  /** Levers and braziers: done when every one is as it should be (only while it is the current trial). */
  private checkPuzzle(dim: Dimension, s: Start, i: number): void {
    const q = s.quest as TempleQuest;
    const rec = this.record(s);
    const m = q.missions[i];
    if (!m || rec.done || rec.stage !== i) return;
    if (m.type === 'levers') {
      for (const l of m.levers) if ((getProp(dim.getState(...l.at), 'powered') === 'true') !== l.on) return;
    } else if (m.type === 'braziers') {
      for (const b of m.braziers) {
        const st = dim.getState(...b);
        if (blocks[STATE_BLOCK[st]!]!.id !== 'campfire' || getProp(st, 'lit') !== 'true') return;
      }
    } else return;
    this.completeMission(dim, s, i);
  }

  /** A trial is done: break its seal and tell everyone in the temple. */
  completeMission(dim: Dimension, s: Start, i: number, cheat = false): void {
    const q = s.quest as TempleQuest;
    const rec = this.record(s);
    if (rec.stage > i) return;
    rec.stage = i + 1;
    this.openSeals(dim, q, i);
    const last = i + 1 >= q.missions.length;
    for (const p of this.near(dim, s)) {
      p.send({ t: 'title', text: `TRIAL ${i + 1} COMPLETE`, sub: last ? 'The way to the summit is open. The Champion awaits.' : 'The seal to the next chamber breaks', ticks: 60 });
      if (!cheat && this.legit(p)) this.server.interaction.grant(p, 'temple_trial');
    }
    // The next trial may already be solved (levers left in place)
    if (!last) this.checkPuzzle(dim, s, i + 1);
  }

  openSeals(dim: Dimension, q: TempleQuest, i: number): void {
    for (const seal of q.seals[i] ?? []) {
      const [x, y, z] = seal.at;
      if (!dim.getChunk(x >> 4, z >> 4)) continue;
      dim.setBlock(x, y, z, seal.ladder ? stateOf('ladder', { facing: seal.ladder }) : 0);
      this.server.particles(dim, 'block', x + 0.5, y + 0.5, z + 0.5, 10, 0.5);
    }
    const a = q.seals[i]?.[0]?.at;
    if (a) this.server.playSound(dim, 'block.stone.break', a[0] + 0.5, a[1] + 0.5, a[2] + 0.5, 1.4, 0.5);
  }

  // --------------------------------------------------------------------- tick

  tick(): void {
    const s = this.server;
    if (!this.on || s.tickNo % 10 !== 0) return;
    const inside = new Map<string, ServerPlayer[]>();
    for (const p of s.players.values()) {
      const t = !p.dead && p.dim.id === 'overworld' ? this.templeAt(p) : null;
      if (!t) {
        this.hud(p, null);
        continue;
      }
      const key = TempleTrials.key(t);
      const q = t.quest as TempleQuest;
      if (this.legit(p)) s.interaction.grant(p, 'find_temple');
      if (p.gamemode !== 'spectator') {
        const list = inside.get(key) ?? [];
        list.push(p);
        inside.set(key, list);
        const rec = this.record(t);
        const run = this.runs.get(key);
        const m = q.missions[rec.stage];
        if (!run && !rec.done && m?.type === 'guardians' && inBoxP(m.room, p)) this.startGuardians(p.dim, t, rec.stage);
        else if (!run && !rec.done && rec.stage >= q.missions.length && inBoxP(q.arena, p)) this.startCountdown(p.dim, t);
      }
      this.hud(p, this.info(t, p));
    }
    for (const r of [...this.runs.values()]) this.tickRun(r, inside.get(r.key) ?? []);
    if (s.tickNo % 100 === 0) this.sweepOrphans();
  }

  private newRun(dim: Dimension, start: Start, kind: Run['kind'], mission: number): Run {
    const q = start.quest as TempleQuest;
    const r: Run = { key: TempleTrials.key(start), dim, start, q, kind, mobs: [], maxHp: 0, wave: 0, waves: 0, mission, contestants: new Set(), countdown: 0, empty: 0, cheat: false, barId: barIds--, barred: new Set() };
    r.cheat = this.near(dim, start).some((p) => this.server.admin.inContext(p));
    this.runs.set(r.key, r);
    return r;
  }

  /** Starts the guardians' trial (also used by the Admin Panel, as a cheat). */
  startGuardians(dim: Dimension, start: Start, mission: number, cheat = false): Run | null {
    const q = start.quest as TempleQuest;
    const m = q.missions[mission];
    if (m?.type !== 'guardians' || this.runs.has(TempleTrials.key(start)) || !this.server.mobs) return null;
    const r = this.newRun(dim, start, 'guardians', mission);
    r.cheat ||= cheat;
    r.waves = m.waves;
    this.spawnWave(r);
    return r;
  }

  private spawnWave(r: Run): void {
    const s = this.server;
    const m = r.q.missions[r.mission] as Extract<TempleMission, { type: 'guardians' }>;
    const players = this.near(r.dim, r.start);
    const types = m.mob.split(',');
    const count = 3 + r.wave + 2 * Math.max(0, players.length - 1);
    const rng = new Random();
    r.wave++;
    r.mobs = [];
    for (let n = 0; n < count; n++) {
      const at = m.spawns[(n + rng.int(m.spawns.length)) % m.spawns.length]!;
      const mob = s.mobs!.spawn(r.dim, types[n % types.length]!, at[0] + 0.5, at[1], at[2] + 0.5, { persistent: true, reason: 'structure', data: { templeRun: r.key } });
      if (!mob) continue;
      mob.maxHealth = Math.round(mob.maxHealth * (1.2 + 0.2 * r.wave));
      mob.health = mob.maxHealth;
      mob.customName = m.name;
      if (r.cheat) s.admin.markEntity(mob);
      const target = players[rng.int(Math.max(1, players.length))];
      if (target) mob.target = target;
      mob.metaDirty = true;
      r.mobs.push(mob);
      s.particles(r.dim, 'smoke', mob.x, mob.y + 1, mob.z, 12, 0.5);
    }
    r.maxHp = r.mobs.reduce((a, x) => a + x.maxHealth, 0);
    for (const p of players) p.send({ t: 'title', text: `WAVE ${r.wave} / ${r.waves}`, sub: `${m.name}s rise`, ticks: 40 });
    s.playSound(r.dim, 'entity.wither.spawn', r.q.center[0], r.q.center[1], r.q.center[2], 0.6, 1.4);
  }

  /** The Champion's Trial: a short countdown gathers everyone in the arena. */
  private startCountdown(dim: Dimension, start: Start): void {
    const r = this.newRun(dim, start, 'countdown', -1);
    r.countdown = 100;
    for (const p of this.near(dim, start)) p.send({ t: 'title', text: "THE CHAMPION'S TRIAL", sub: 'Stand in the arena. It begins in 5 seconds.', ticks: 60 });
  }

  private begin(r: Run, here: ServerPlayer[]): void {
    const s = this.server;
    const contestants = here.filter((p) => inBoxP(r.q.arena, p));
    if (!contestants.length) {
      this.runs.delete(r.key);
      return;
    }
    r.contestants = new Set(contestants);
    r.cheat ||= contestants.some((p) => s.admin.inContext(p));
    if (contestants.length === 1) {
      r.kind = 'champion';
      const c = r.q.champion;
      const [x, y, z] = r.q.center;
      const mob = s.mobs?.spawn(r.dim, c.mob, x + 0.5, y, z + 0.5, { persistent: true, reason: 'structure', data: { templeRun: r.key } });
      if (!mob) {
        this.runs.delete(r.key);
        return;
      }
      mob.maxHealth = Math.round(mob.maxHealth * c.hp);
      mob.health = mob.maxHealth;
      mob.customName = c.name;
      if (c.dmg) mob.data.dmgBonus = c.dmg;
      if (r.cheat) s.admin.markEntity(mob);
      mob.target = contestants[0]!;
      mob.metaDirty = true;
      r.mobs = [mob];
      r.maxHp = mob.maxHealth;
      s.particles(r.dim, 'flame', mob.x, mob.y + 1, mob.z, 30, 0.8);
      contestants[0]!.send({ t: 'title', text: c.name.toUpperCase(), sub: 'Defeat the champion to claim the prize', ticks: 60 });
    } else {
      r.kind = 'duel';
      for (const p of contestants) p.send({ t: 'title', text: 'DUEL!', sub: `${contestants.length} contestants. The last one standing claims the prize.`, ticks: 70 });
      s.playSound(r.dim, 'block.bell.use', r.q.center[0], r.q.center[1], r.q.center[2], 1.5, 0.8);
    }
  }

  private tickRun(r: Run, here: ServerPlayer[]): void {
    this.bar(r, here);
    switch (r.kind) {
      case 'countdown': {
        r.countdown -= 10;
        if (r.countdown > 0 && r.countdown <= 60 && r.countdown % 20 === 0) for (const p of here) p.send({ t: 'title', text: String(r.countdown / 20), sub: "The Champion's Trial", ticks: 20 });
        if (r.countdown <= 0) this.begin(r, here);
        return;
      }
      case 'guardians': {
        r.mobs = r.mobs.filter((m) => !m.dead && !m.removed);
        if (!here.length) {
          r.empty += 10;
          if (r.empty >= 600) this.abandon(r);
          return;
        }
        r.empty = 0;
        if (r.mobs.length) return;
        if (r.wave < r.waves) return this.spawnWave(r);
        this.end(r);
        this.completeMission(r.dim, r.start, r.mission, r.cheat);
        return;
      }
      case 'champion': {
        const p = [...r.contestants][0]!;
        const alive = !p.dead && this.online(p) && inBoxP(r.q.area, p);
        const champ = r.mobs[0];
        if (!champ || champ.dead || champ.removed) {
          if (!p.dead && inBoxP(r.q.area, p)) return this.win(r, p, false);
          return this.abandon(r);
        }
        if (!alive) {
          r.empty += 10;
          if (r.empty >= 600) this.abandon(r);
        } else r.empty = 0;
        return;
      }
      case 'duel': {
        for (const p of [...r.contestants]) {
          if (p.dead || !this.online(p)) r.contestants.delete(p);
          else if (!inBoxP(r.q.arena, p)) this.knockOut(r, p, 'left the arena');
        }
        if (r.contestants.size === 1) return this.win(r, [...r.contestants][0]!, true);
        if (r.contestants.size === 0) {
          for (const p of here) p.send({ t: 'title', text: 'NO CHAMPION', sub: 'Nobody is left standing. Try again.', ticks: 50 });
          this.end(r);
        }
        return;
      }
    }
  }

  private knockOut(r: Run, p: ServerPlayer, why: string): void {
    if (!r.contestants.delete(p)) return;
    p.send({ t: 'title', text: 'KNOCKED OUT', sub: 'You are out of the duel', ticks: 50 });
    for (const o of this.near(r.dim, r.start)) if (o !== p) o.send({ t: 'chat', text: `${p.name} ${why} (${r.contestants.size} left).`, kind: 'system' });
  }

  /** The prize goes to the winner; the temple is complete. */
  private win(r: Run, p: ServerPlayer, duel: boolean): void {
    const s = this.server;
    this.end(r);
    const rec = this.record(r.start);
    rec.done = true;
    rec.stage = r.q.missions.length + 1;
    const cheat = r.cheat || s.admin.inContext(p) || !!rec.flags?.includes('cheat');
    if (!rec.rewarded.includes(p.uuid)) {
      rec.rewarded.push(p.uuid);
      const loot = rollLoot(r.q.reward, { rng: new Random(), difficulty: s.level.difficulty });
      for (const st of loot) {
        const rest = p.inventory.add(cheat ? markAdmin(st) : st);
        if (rest) s.interaction.dropStack(p, rest);
      }
      s.interaction.syncInventory(p);
    }
    rec.flags = [...(rec.flags ?? []).filter((f) => !f.startsWith('champion:')), 'champion:' + p.name.slice(0, 40)];
    if (!cheat) {
      s.interaction.grant(p, 'temple_champion');
      if (duel) s.interaction.grant(p, 'temple_duel');
    }
    p.send({ t: 'title', text: 'CHAMPION', sub: `${r.q.name}: the prize is yours`, ticks: 80 });
    for (const o of this.near(r.dim, r.start)) if (o !== p) o.send({ t: 'title', text: `${p.name.toUpperCase()} WINS`, sub: `The champion of the ${r.q.name}`, ticks: 70 });
    s.playSound(r.dim, 'ui.toast.challenge_complete', p.x, p.y + 1, p.z, 1.2, 1);
    s.particles(r.dim, 'firework', p.x, p.y + 1.5, p.z, 40, 1);
  }

  private end(r: Run): void {
    this.runs.delete(r.key);
    for (const p of r.barred) p.send({ t: 'boss', id: r.barId, action: 'remove' });
  }

  /** Nobody is left: the fight's mobs vanish and it starts again later. */
  private abandon(r: Run): void {
    for (const m of r.mobs) if (!m.dead && !m.removed) m.remove();
    this.end(r);
  }

  private sweepOrphans(): void {
    for (const dim of this.server.dims.values())
      for (const e of dim.entities.values()) {
        if (!(e instanceof Mob) || e.dead || typeof e.data.templeRun !== 'string') continue;
        const r = this.runs.get(e.data.templeRun);
        if (!r || !r.mobs.includes(e)) e.remove();
      }
  }

  private bar(r: Run, here: ServerPlayer[]): void {
    const show = r.kind === 'guardians' || r.kind === 'champion' ? here : [];
    for (const p of [...r.barred]) {
      if (show.includes(p)) continue;
      p.send({ t: 'boss', id: r.barId, action: 'remove' });
      r.barred.delete(p);
    }
    if (!show.length) return;
    const hp = r.mobs.reduce((a, m) => a + Math.max(0, m.dead || m.removed ? 0 : m.health), 0);
    const progress = r.maxHp > 0 ? hp / r.maxHp : 0;
    const title = r.kind === 'champion' ? r.q.champion.name : `${r.q.name}: wave ${r.wave} of ${r.waves}`;
    for (const p of show) {
      p.send({ t: 'boss', id: r.barId, action: r.barred.has(p) ? 'update' : 'add', title, progress, color: 'red' });
      r.barred.add(p);
    }
  }

  // ---------------------------------------------------------------- the tracker

  info(s: Start, p: ServerPlayer): QuestInfo {
    const q = s.quest as TempleQuest;
    const rec = this.record(s);
    const stages = q.missions.length + 1;
    const r = this.runs.get(TempleTrials.key(s));
    if (rec.done) {
      const champ = (rec.flags ?? []).find((f) => f.startsWith('champion:'))?.slice(9);
      return { title: q.name, text: champ ? `Complete. Champion: ${champ}.` : 'Complete.', stage: stages, stages };
    }
    if (r?.kind === 'guardians') return { title: q.name, text: `Trial ${r.mission + 1}: ${MISSION_NAME.guardians}. Wave ${r.wave} of ${r.waves}.`, stage: rec.stage, stages, remaining: r.mobs.length };
    if (r?.kind === 'countdown') return { title: q.name, text: "The Champion's Trial is about to begin. Stay in the arena to take part.", stage: rec.stage, stages };
    if (r?.kind === 'champion') return { title: q.name, text: `Defeat the ${q.champion.name}.`, stage: rec.stage, stages, remaining: r.mobs.filter((m) => !m.dead).length };
    if (r?.kind === 'duel') return { title: q.name, text: r.contestants.has(p) ? 'Duel! Be the last one standing in the arena.' : 'A duel is on in the arena.', stage: rec.stage, stages, remaining: r.contestants.size };
    const m = q.missions[rec.stage];
    if (!m) return { title: q.name, text: "Climb to the summit arena for the Champion's Trial. Alone you face the champion; with others, the last one standing wins.", stage: rec.stage, stages };
    const lit = m.type === 'altars' ? ` (${m.altars.filter((a) => getProp(p.dim.getState(...a), 'lit') === 'true').length}/${m.altars.length})` : '';
    return { title: q.name, text: `Trial ${rec.stage + 1}: ${MISSION_NAME[m.type]}. ${MISSION_TEXT[m.type]}${lit}`, stage: rec.stage, stages };
  }

  private hud(p: ServerPlayer, q: QuestInfo | null): void {
    const k = q ? JSON.stringify(q) : '';
    if ((this.shown.get(p) ?? '') === k) return;
    // Leaving a temple clears the tracker only if it is ours
    if (!q && !this.shown.has(p)) return;
    if (k) this.shown.set(p, k);
    else this.shown.delete(p);
    p.send({ t: 'quest', quest: q });
  }

  /** Whether this system's tracker is showing for a player (other trackers keep out of its way). */
  showing(p: ServerPlayer): boolean {
    return this.shown.has(p);
  }

  // --------------------------------------------------------------- Admin Panel

  /** Completes the current trial as a cheat (a fight in progress is cleared). */
  adminAdvance(dim: Dimension, s: Start): string {
    const q = s.quest as TempleQuest;
    const rec = this.record(s);
    const r = this.runs.get(TempleTrials.key(s));
    if (rec.done) return 'This temple is already complete.';
    // A prize won after a cheated trial is cheat-marked too
    if (!(rec.flags ??= []).includes('cheat')) rec.flags.push('cheat');
    if (r && (r.kind === 'guardians' || r.kind === 'champion')) {
      r.cheat = true;
      for (const m of r.mobs) m.remove();
      if (r.kind === 'guardians') {
        this.end(r);
        this.completeMission(dim, s, r.mission, true);
        return `Cleared trial ${r.mission + 1}.`;
      }
      return 'Removed the champion (the prize is cheat-marked).';
    }
    if (rec.stage < q.missions.length) {
      const i = rec.stage;
      this.completeMission(dim, s, i, true);
      return `Completed trial ${i + 1} (${MISSION_NAME[q.missions[i]!.type]}).`;
    }
    return "All trials are done: stand in the arena to start the Champion's Trial.";
  }

  /** Forgets a temple's progress and puts its seals and altars back. */
  adminReset(dim: Dimension, s: Start): void {
    const q = s.quest as TempleQuest;
    const r = this.runs.get(TempleTrials.key(s));
    if (r) this.abandon(r);
    delete this.server.level.quests.temple[TempleTrials.key(s)];
    for (const group of q.seals)
      for (const seal of group) {
        const [x, y, z] = seal.at;
        if (dim.getChunk(x >> 4, z >> 4)) dim.setBlock(x, y, z, stateOf('temple_seal', {}));
      }
    for (const m of q.missions) {
      const altars = m.type === 'altars' ? m.altars : m.type === 'relic' ? [m.altar] : [];
      for (const [x, y, z] of altars) if (dim.getChunk(x >> 4, z >> 4)) dim.setBlock(x, y, z, stateOf('temple_altar', { lit: 'false' }));
    }
  }

  onLeave(p: ServerPlayer): void {
    this.shown.delete(p);
    for (const r of this.runs.values()) {
      if (r.kind === 'duel') r.contestants.delete(p);
      r.barred.delete(p);
    }
  }
}
