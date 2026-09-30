/**
 * V4: the Glitched Structure's five-stage fight.
 *
 * Stepping into an arena whose stage is next starts it: the stage's glitched
 * mobs (the Farlands' own mobs, made tougher stage by stage) appear around
 * the arena. When the last falls, the Firewall over the shaft down to the
 * next arena comes down. After the fifth, the vault opens and everyone who
 * fought receives one Glitched tool and one Glitched armor piece (the same
 * items the Farlands smithing table makes), rolled from a loot table.
 *
 * Progress per structure is kept in the level data. A stage in progress is
 * not: if everyone leaves, or the server restarts, its mobs vanish and the
 * stage starts again when someone steps back in.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob } from '../entity/Mob';
import { Random } from '../../common/math/rng';
import { stateOf } from '../../common/registry/blocks';
import { rollLoot } from '../../common/game/loot';
import { markAdmin } from '../../common/game/itemstack';
import type { QuestInfo } from '../../common/net/protocol';
import type { QuestRecord } from '../world/LevelData';
import { GLITCH_STAGES, arenaSpawns, levelAt, levelFloor, shaftAt, type ErrorChunk } from '../../common/gen/v4/errorBiome';

interface Spawn {
  mob: string;
  count: number;
  /** Health multiplier. */
  hp?: number;
  /** Extra melee damage. */
  dmg?: number;
  name?: string;
}

/** What each stage throws at the players. */
export const GLITCH_STAGE_DEFS: { name: string; spawns: Spawn[] }[] = [
  { name: 'Corrupted Memory', spawns: [{ mob: 'glitch_zombie', count: 4 }] },
  {
    name: 'Stack Trace',
    spawns: [
      { mob: 'glitch_zombie', count: 2, hp: 1.5, dmg: 1 },
      { mob: 'glitch_skeleton', count: 3 },
    ],
  },
  {
    name: 'Undefined Behaviour',
    spawns: [
      { mob: 'rift_walker', count: 2 },
      { mob: 'void_wisp', count: 3 },
      { mob: 'glitch_skeleton', count: 1, hp: 1.5 },
    ],
  },
  {
    name: 'Fatal Exception',
    spawns: [
      { mob: 'glitch_zombie', count: 3, hp: 2.5, dmg: 3, name: 'Corrupted Zombie' },
      { mob: 'glitch_skeleton', count: 2, hp: 2.5, name: 'Corrupted Skeleton' },
      { mob: 'rift_walker', count: 1, hp: 1.5, dmg: 2, name: 'Corrupted Rift Walker' },
    ],
  },
  {
    name: 'Kernel Panic',
    spawns: [
      { mob: 'glitch_beast', count: 1, hp: 0.65 },
      { mob: 'void_wisp', count: 2, hp: 1.5 },
    ],
  },
];

interface Fight {
  key: string;
  dim: Dimension;
  e: ErrorChunk;
  stage: number;
  mobs: Mob[];
  maxHp: number;
  /** Players who fought in this stage (rewarded if it is the last). */
  fighters: Set<ServerPlayer>;
  /** Ticks with nobody inside the structure. */
  empty: number;
  cheat: boolean;
  barId: number;
  /** Players currently shown the stage's boss bar. */
  barred: Set<ServerPlayer>;
}

let barIds = -7000;

export class GlitchedQuestSystem {
  readonly fights = new Map<string, Fight>();
  /** Everyone who has taken part in each structure since the server started (for the final reward). */
  private readonly participants = new Map<string, Set<string>>();
  /** What each player's quest tracker currently shows. */
  private readonly shown = new Map<ServerPlayer, string>();

  constructor(private readonly server: GameServer) {}

  static key(dim: Dimension, e: ErrorChunk): string {
    return `${dim.id}:${e.cx},${e.cz}`;
  }

  record(key: string): QuestRecord {
    const q = this.server.level.quests.glitch;
    return (q[key] ??= { stage: 0, done: false, rewarded: [] });
  }

  /** The Error chunk a player stands in, if any. */
  errorAt(p: ServerPlayer): ErrorChunk | null {
    const g = p.dim.generator;
    return g.errorChunk?.(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4) ?? null;
  }

  tick(): void {
    const s = this.server;
    if (s.level.generatorVersion < 4) return;
    if (s.tickNo % 10 !== 0) return;
    const inside = new Map<string, ServerPlayer[]>();
    for (const p of s.players.values()) {
      const e = !p.dead ? this.errorAt(p) : null;
      if (!e) {
        this.hud(p, null);
        continue;
      }
      const key = GlitchedQuestSystem.key(p.dim, e);
      const level = levelAt(e, p.x, p.y, p.z);
      const legit = p.gamemode !== 'spectator' && !s.admin.inContext(p);
      if (legit) s.interaction.grant(p, 'find_error_biome');
      if (level < 0) {
        this.hud(p, null);
        continue;
      }
      if (legit) s.interaction.grant(p, 'enter_glitched_structure');
      if (p.gamemode === 'spectator') continue;
      const list = inside.get(key) ?? [];
      list.push(p);
      inside.set(key, list);
      let set = this.participants.get(key);
      if (!set) this.participants.set(key, (set = new Set()));
      set.add(p.uuid);
      const rec = this.record(key);
      const fight = this.fights.get(key);
      if (fight) fight.fighters.add(p);
      else if (!rec.done && level >= 1 && level <= GLITCH_STAGES && rec.stage === level - 1) this.start(p.dim, e, level);
    }
    // Fights: count the survivors, end cleared stages, drop abandoned ones
    for (const f of [...this.fights.values()]) {
      f.mobs = f.mobs.filter((m) => !m.dead && !m.removed);
      const here = inside.get(f.key) ?? [];
      this.bar(f, here);
      if (here.length === 0) {
        f.empty += 10;
        if (f.empty >= 600) this.abandon(f);
        continue;
      }
      f.empty = 0;
      if (f.mobs.length === 0) this.clear(f);
    }
    for (const [key, list] of inside) for (const p of list) this.hud(p, this.info(key, p));
    if (s.tickNo % 100 === 0) this.sweepOrphans();
  }

  /** Starts a stage (also used by the Admin Panel, which marks it as a cheat). */
  start(dim: Dimension, e: ErrorChunk, stage: number, cheat = false): Fight | null {
    const s = this.server;
    const key = GlitchedQuestSystem.key(dim, e);
    if (this.fights.has(key) || !s.mobs) return null;
    const players = [...s.players.values()].filter((p) => p.dim === dim && levelAt(e, p.x, p.y, p.z) >= 0 && p.gamemode !== 'spectator');
    cheat ||= players.some((p) => s.admin.inContext(p));
    const def = GLITCH_STAGE_DEFS[stage - 1]!;
    // More players, tougher mobs
    const scale = 1 + 0.4 * Math.max(0, players.length - 1);
    const spots = arenaSpawns(e, stage);
    const rng = new Random();
    const mobs: Mob[] = [];
    let i = rng.int(spots.length);
    for (const sp of def.spawns)
      for (let n = 0; n < sp.count; n++) {
        const at = spots[i++ % spots.length]!;
        const m = s.mobs.spawn(dim, sp.mob, at.x, at.y + (sp.mob === 'void_wisp' ? 2 : 0), at.z, { persistent: true, reason: 'structure', data: { glitchQuest: key, glitchStage: stage } });
        if (!m) continue;
        m.maxHealth = Math.round(m.maxHealth * (sp.hp ?? 1) * scale);
        m.health = m.maxHealth;
        if (sp.dmg) m.data.dmgBonus = sp.dmg;
        if (sp.name) m.customName = sp.name;
        if (cheat) s.admin.markEntity(m);
        const target = players[rng.int(Math.max(1, players.length))];
        if (target) m.target = target;
        m.metaDirty = true;
        mobs.push(m);
        s.particles(dim, 'glitch', m.x, m.y + 1, m.z, 24, 0.6);
      }
    const f: Fight = { key, dim, e, stage, mobs, maxHp: mobs.reduce((a, m) => a + m.maxHealth, 0), fighters: new Set(players), empty: 0, cheat, barId: barIds--, barred: new Set() };
    this.fights.set(key, f);
    const cx = (e.cx << 4) + 8;
    const cz = (e.cz << 4) + 8;
    const fy = levelFloor(e, stage) + 2;
    s.playSound(dim, 'glitch.warn', cx, fy, cz, 1.2, 0.7);
    for (const p of players) {
      p.send({ t: 'title', text: `STAGE ${stage} / ${GLITCH_STAGES}`, sub: def.name, ticks: 60 });
      p.send({ t: 'fx', kind: 'glitch', strength: 0.25 + stage * 0.1, ticks: 16 });
    }
    return f;
  }

  /** Every mob of a stage is gone: open the way down, and after the last stage, the vault. */
  private clear(f: Fight): void {
    const s = this.server;
    this.fights.delete(f.key);
    const rec = this.record(f.key);
    rec.stage = Math.max(rec.stage, f.stage);
    this.openShaft(f.dim, f.e, f.stage);
    for (const p of f.barred) p.send({ t: 'boss', id: f.barId, action: 'remove' });
    const cx = (f.e.cx << 4) + 8;
    const cz = (f.e.cz << 4) + 8;
    if (f.stage < GLITCH_STAGES) {
      s.playSound(f.dim, 'glitch.static', cx, levelFloor(f.e, f.stage) + 2, cz, 1, 1.4);
      for (const p of f.fighters) p.send({ t: 'title', text: `STAGE ${f.stage} CLEARED`, sub: 'The firewall below is down', ticks: 50 });
      return;
    }
    this.complete(f);
  }

  /** Removes the Firewall over the ladder shaft out of an arena (keeps the ladder going). */
  openShaft(dim: Dimension, e: ErrorChunk, stage: number): void {
    const { lx, lz, wall } = shaftAt(stage);
    const x = (e.cx << 4) + lx;
    const z = (e.cz << 4) + lz;
    const y = levelFloor(e, stage);
    if (dim.getChunk(e.cx, e.cz)) {
      dim.setBlock(x, y, z, stateOf('ladder', { facing: wall === 'west' ? 'east' : 'west' }));
      this.server.particles(dim, 'glitch', x + 0.5, y + 0.5, z + 0.5, 30, 0.5);
    }
  }

  /** The fifth stage fell: rewards for everyone who took part. */
  private complete(f: Fight): void {
    const s = this.server;
    const rec = this.record(f.key);
    rec.done = true;
    const everyone = new Set<ServerPlayer>(f.fighters);
    for (const uuid of this.participants.get(f.key) ?? []) {
      const p = [...s.players.values()].find((q) => q.uuid === uuid);
      if (p && p.dim === f.dim && this.errorAt(p) === f.e) everyone.add(p);
    }
    const rng = new Random();
    for (const p of everyone) {
      p.send({ t: 'title', text: 'QUEST COMPLETE', sub: 'The Glitched Structure is quiet', ticks: 80 });
      p.send({ t: 'fx', kind: 'stabilize', ticks: 40 });
      if (rec.rewarded.includes(p.uuid)) continue;
      rec.rewarded.push(p.uuid);
      const cheat = f.cheat || s.admin.inContext(p);
      const loot = rollLoot('quest/glitched_reward', { rng, difficulty: s.level.difficulty });
      for (const st of loot) {
        const give = cheat ? markAdmin(st) : st;
        const rest = p.inventory.add(give);
        if (rest) s.interaction.dropStack(p, rest);
      }
      s.interaction.syncInventory(p);
      if (!cheat) {
        s.interaction.grant(p, 'glitched_quest');
        if (loot.length) s.interaction.grant(p, 'glitched_reward');
      }
    }
    const cx = (f.e.cx << 4) + 8;
    const cz = (f.e.cz << 4) + 8;
    s.playSound(f.dim, 'glitch.portal_on', cx, levelFloor(f.e, GLITCH_STAGES + 1) + 2, cz, 1.2, 1);
  }

  /** Nobody is left inside: the stage's mobs dissolve and the stage waits to be started again. */
  private abandon(f: Fight): void {
    this.fights.delete(f.key);
    for (const m of f.mobs) if (!m.dead && !m.removed) m.remove();
    for (const p of f.barred) p.send({ t: 'boss', id: f.barId, action: 'remove' });
  }

  /** Stage mobs left over from a fight that no longer runs (a restart, an unloaded chunk). */
  private sweepOrphans(): void {
    for (const dim of this.server.dims.values()) {
      for (const e of dim.entities.values()) {
        if (!(e instanceof Mob) || e.dead || typeof e.data.glitchQuest !== 'string') continue;
        const f = this.fights.get(e.data.glitchQuest);
        if (!f || !f.mobs.includes(e)) e.remove();
      }
    }
  }

  /** Shows the stage's boss bar to the players inside, and takes it away from those who left. */
  private bar(f: Fight, here: ServerPlayer[]): void {
    for (const p of [...f.barred]) {
      if (here.includes(p)) continue;
      p.send({ t: 'boss', id: f.barId, action: 'remove' });
      f.barred.delete(p);
    }
    if (!here.length) return;
    const hp = f.mobs.reduce((a, m) => a + Math.max(0, m.health), 0);
    const progress = f.maxHp > 0 ? hp / f.maxHp : 0;
    const title = `STAGE ${f.stage}: ${GLITCH_STAGE_DEFS[f.stage - 1]!.name.toUpperCase()}`;
    for (const p of here) {
      p.send({ t: 'boss', id: f.barId, action: f.barred.has(p) ? 'update' : 'add', title, progress, color: 'glitch' });
      f.barred.add(p);
      f.fighters.add(p);
    }
  }

  /** The quest tracker for a player inside a structure. */
  info(key: string, p: ServerPlayer): QuestInfo {
    const rec = this.record(key);
    const f = this.fights.get(key);
    const e = this.errorAt(p);
    const level = e ? levelAt(e, p.x, p.y, p.z) : -1;
    if (rec.done) return { title: 'Glitched Structure', text: 'Complete. The vault is open.', stage: GLITCH_STAGES, stages: GLITCH_STAGES, style: 'glitch' };
    if (f) return { title: 'Glitched Structure', text: `Stage ${f.stage}: ${GLITCH_STAGE_DEFS[f.stage - 1]!.name}. Destroy every glitched entity.`, stage: f.stage, stages: GLITCH_STAGES, remaining: f.mobs.length, style: 'glitch' };
    const next = rec.stage + 1;
    const where = level === next ? 'Hold your ground' : level === 0 ? 'Climb down the ladder into the first arena' : `Go down to arena ${next}`;
    return { title: 'Glitched Structure', text: `${where}. Stage ${next} of ${GLITCH_STAGES} awaits.`, stage: rec.stage, stages: GLITCH_STAGES, style: 'glitch' };
  }

  private hud(p: ServerPlayer, q: QuestInfo | null): void {
    const k = q ? JSON.stringify(q) : '';
    if ((this.shown.get(p) ?? '') === k) return;
    if (k) this.shown.set(p, k);
    else this.shown.delete(p);
    p.send({ t: 'quest', quest: q });
  }

  /** Admin Panel: clears the current stage as a cheat (its fight is marked, rewards are cheat-made). */
  adminClear(key: string): boolean {
    const f = this.fights.get(key);
    if (!f) return false;
    f.cheat = true;
    for (const m of f.mobs) m.remove();
    return true;
  }

  /** Admin Panel: forgets a structure's progress and shuts its firewalls again. */
  adminReset(dim: Dimension, e: ErrorChunk): void {
    const key = GlitchedQuestSystem.key(dim, e);
    const f = this.fights.get(key);
    if (f) this.abandon(f);
    delete this.server.level.quests.glitch[key];
    this.participants.delete(key);
    if (!dim.getChunk(e.cx, e.cz)) return;
    for (let stage = 1; stage <= GLITCH_STAGES; stage++) {
      const { lx, lz } = shaftAt(stage);
      dim.setBlock((e.cx << 4) + lx, levelFloor(e, stage), (e.cz << 4) + lz, stateOf('glitch_firewall', {}));
    }
  }

  /** A player left the server: forget what their tracker shows. */
  onLeave(p: ServerPlayer): void {
    this.shown.delete(p);
  }
}
