/**
 * V7 - The Halloween Update, phase 2: the server's side of Trick-or-Treat
 * and Abandoned Villages (generation in src/common/gen/v9/village.ts, the
 * rules in src/common/halloween/villages.ts).
 *
 * - Decides, once per Trick-or-Treat eligible village, whether it is dressed:
 *   the first time world generation asks (when any of its chunks is first
 *   built), by whether Halloween is on in the world right then. The answer is
 *   saved with the world (LevelData.villages) with every door's record, so a
 *   village's chunks always agree, and the doors are there for phase 3.
 * - Discovery: a title and an advancement for walking into either kind of
 *   village (never in an Admin Panel context or a village the panel made).
 * - Haunted areas: players in or near an Abandoned Village are told, and
 *   their game lets ghosts drift over it, day and night.
 * - The Admin Panel: building either kind of village around a player (in any
 *   world, all of it cheat-made), and the doors of the nearest Trick-or-Treat
 *   Village.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Chunk } from '../../common/world/chunk';
import { chunkIndex } from '../../common/world/constants';
import { DecorView } from '../../common/gen/decorate/view';
import type { OverworldGenerator } from '../../common/gen/generator';
import type { PlanContext, Start } from '../../common/gen/structures/manager';
import { planVillageV9 } from '../../common/gen/v9/village';
import { inGuardArea, type GuardArea, type VillageMeta, type VillageRecord, type VillageHooks } from '../../common/halloween/villages';
import { biomeOf } from '../../common/registry/biomes';
import { STATE_FLUID, STATE_SOLID } from '../../common/registry/blocks';
import { Random, hashInts } from '../../common/math/rng';
import type { VillageDoorsInfo } from '../../common/game/admin';

const EMPTY = new Chunk(0, 0, false);
/** How far around an Abandoned Village its ghosts are seen (blocks). */
const HAUNT_PAD = 16;
/** How often (ticks) players are checked. */
const CHECK_TICKS = 20;
/** Saving a new record soon after it is made, at most this often (ticks). */
const SAVE_TICKS = 200;

type VillageLike = { village?: VillageMeta; x: number; y: number; z: number };

interface Build {
  dim: Dimension;
  start: Start;
  chunks: number[];
  by: ServerPlayer | null;
  name: string;
}

export class VillageSystem {
  /** What world generation asks (GeneratorOptions.villages). */
  readonly hooks: VillageHooks = {
    trick: (s) => this.trick(s),
    trickNow: (s) => this.trickNow(s),
  };
  private readonly builds: Build[] = [];
  /** The haunted area each player was last told about. */
  private readonly haunted = new WeakMap<ServerPlayer, string>();
  private tickNo = 0;
  private unsaved = false;
  private lastSave = -SAVE_TICKS;

  constructor(private readonly server: GameServer) {}

  private get records(): Record<string, VillageRecord> {
    return this.server.level.villages;
  }

  /**
   * A record changed (phase 3: a door knocked on): it reaches the save soon.
   * `now`: at once (a door that gave candy or loot: so a crash a moment later
   * cannot forget it while the player's save keeps what they got).
   */
  markDirty(now = false): void {
    this.unsaved = true;
    if (!now) return;
    this.unsaved = false;
    this.lastSave = this.tickNo;
    void this.server.storage.writeLevel(this.server.level).catch(() => {});
  }

  /** A village's record (undefined: never built yet). */
  record(key: string): VillageRecord | undefined {
    return this.records[key];
  }

  // ------------------------------------------------------------------ the season's decision

  /** Generation's question: is this village dressed? Decides (and records) it the first time. */
  trick(s: VillageLike): boolean {
    const m = s.village;
    if (!m || m.variant !== 'trick') return false;
    return (this.records[m.key] ?? this.decide(s, m)).kind === 'trick';
  }

  /** The searches' question: is it dressed, or would it be if built now? */
  trickNow(s: VillageLike): boolean {
    const m = s.village;
    if (!m || m.variant !== 'trick') return false;
    const r = this.records[m.key];
    return r ? r.kind === 'trick' : this.server.halloweenState().active || !!this.server.halloween?.offByTest;
  }

  private decide(s: VillageLike, m: VillageMeta, cheat = false): VillageRecord {
    const srv = this.server;
    const state = srv.halloweenState();
    // Only an Admin Panel season test made it Halloween here: the village is cheat-made. One that only
    // a test made not Halloween is decided by the real season (the decision is for good; tests are not)
    const simOnly = !!srv.halloween?.onByTest;
    const dressed = state.active || !!srv.halloween?.offByTest;
    const rec: VillageRecord = {
      kind: dressed ? 'trick' : 'normal',
      decidedAt: srv.clock(),
      x: s.x,
      y: s.y,
      z: s.z,
      style: m.style,
      doors: dressed ? m.doors.map((d) => ({ ...d, out: [...d.out] as [number, number, number], used: false })) : [],
      ...(cheat || simOnly ? { cheat: true } : {}),
    };
    this.records[m.key] = rec;
    this.unsaved = true;
    return rec;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    this.tickNo++;
    this.tickBuilds();
    if (this.unsaved && this.tickNo - this.lastSave >= SAVE_TICKS) {
      // New records reach the save soon, not only at the next autosave
      this.unsaved = false;
      this.lastSave = this.tickNo;
      void this.server.storage.writeLevel(this.server.level).catch(() => {});
    }
    if (this.tickNo % CHECK_TICKS !== 0) return;
    for (const p of this.server.players.values()) this.check(p);
  }

  private overworldGen(): OverworldGenerator {
    return this.server.overworld.generator as OverworldGenerator;
  }

  /** A player's village (and the haunted area they are in). */
  private check(p: ServerPlayer): void {
    const inOverworld = p.dim.id === 'overworld' && !p.dead;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const s = inOverworld ? this.overworldGen().villageAt?.(x, z) ?? null : null;
    // Ghosts: natural Abandoned Villages, and those the Admin Panel built
    const area = inOverworld ? this.abandonedNear(x, z) ?? this.adminAbandonedNear(x, z) : null;
    const key = area ? `${area.x0},${area.z0},${area.x1},${area.z1}` : '';
    if ((this.haunted.get(p) ?? '') !== key) {
      this.haunted.set(p, key);
      p.send({ t: 'haunted_area', area: area ? { ...area } : null });
    }
    if (!s?.village || p.gamemode === 'spectator' || Math.abs(p.y - s.y) > 48) return;
    const b = s.bounds;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return;
    // Discovery counts only when it is real: no cheats, not a village the panel made
    if (this.server.admin.inContext(p)) return;
    const v = s.village;
    if (v.variant === 'abandoned') this.discover(p, s, 'Abandoned Village', 'find_abandoned_village');
    else if (v.variant === 'trick') {
      const r = this.records[v.key];
      if (r?.kind === 'trick' && !r.cheat) this.discover(p, s, 'Trick-or-Treat Village', 'find_trick_village');
    }
  }

  private discover(p: ServerPlayer, s: Start, title: string, achievement: string): void {
    const key = `village@${s.x},${s.z}`;
    if (!p.endTitles.has(key)) {
      p.endTitles.add(key);
      p.send({ t: 'title', text: title, ticks: 100 });
      p.send({ t: 'sound', name: 'music.discovery', x: p.x, y: p.y + 1, z: p.z, volume: 1, pitch: 1 });
    }
    this.server.interaction.grant(p, achievement);
  }

  /** The haunted area of a natural Abandoned Village within reach of a column. */
  private abandonedNear(x: number, z: number): GuardArea | null {
    const gen = this.overworldGen();
    if (!gen.v9) return null;
    const seen = new Set<number>();
    for (const [dx, dz] of [
      [0, 0],
      [-HAUNT_PAD, -HAUNT_PAD],
      [HAUNT_PAD, -HAUNT_PAD],
      [-HAUNT_PAD, HAUNT_PAD],
      [HAUNT_PAD, HAUNT_PAD],
    ] as const) {
      const k = chunkIndex((x + dx) >> 4, (z + dz) >> 4);
      if (seen.has(k)) continue;
      seen.add(k);
      for (const s of gen.structures.startsFor((x + dx) >> 4, (z + dz) >> 4)) if (s.village?.guard && inGuardArea(s.village.guard, x, z, HAUNT_PAD)) return s.village.guard;
    }
    return null;
  }

  /** Haunted area of an Abandoned Village the Admin Panel built near a column. */
  private adminAbandonedNear(x: number, z: number): GuardArea | null {
    for (const r of Object.values(this.records)) {
      const a = r.area;
      if (r.kind === 'abandoned' && a && inGuardArea(a, x, z, HAUNT_PAD)) return a;
    }
    return null;
  }

  // ------------------------------------------------------------------ Admin Panel

  /** The doors of the nearest Trick-or-Treat Village (built, or one that would be if built now). */
  doorsNear(p: ServerPlayer): VillageDoorsInfo | null {
    if (p.dim.id !== 'overworld') return null;
    let best: { key: string; r: VillageRecord } | null = null;
    let bestD = Infinity;
    for (const [key, r] of Object.entries(this.records)) {
      if (r.kind !== 'trick') continue;
      const d = (r.x - p.x) ** 2 + (r.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { key, r };
      }
    }
    // A closer one nobody has seen yet still counts, if it would be dressed now
    const gen = this.overworldGen();
    let found: Start | null = null;
    if (gen.v9) {
      // Synchronous (an Admin Panel request), so it only looks a few regions out (about 3,500 blocks)
      const it = gen.villageSteps('trick_village', Math.floor(p.x), Math.floor(p.z), 4);
      let step = it.next();
      while (!step.done) step = it.next();
      found = step.value;
    }
    if (found?.village && (!best || (found.x - p.x) ** 2 + (found.z - p.z) ** 2 < bestD)) {
      const r = this.records[found.village.key];
      const doors = r ? r.doors : found.village.doors.map((d) => ({ ...d, used: false }));
      return this.doorsInfo(p, found.x, found.y, found.z, doors, !!r, !!r?.cheat);
    }
    if (!best) return null;
    return this.doorsInfo(p, best.r.x, best.r.y, best.r.z, best.r.doors, true, !!best.r.cheat);
  }

  private doorsInfo(p: ServerPlayer, x: number, y: number, z: number, doors: VillageRecord['doors'], built: boolean, cheat: boolean): VillageDoorsInfo {
    return {
      x,
      y,
      z,
      distance: Math.round(Math.hypot(x - p.x, z - p.z)),
      built,
      cheat,
      doors: doors.map((d) => ({ id: d.id, design: d.design, kind: d.kind, x: d.x, y: d.y, z: d.z, out: d.out, used: d.used, distance: Math.round(Math.hypot(d.x - p.x, d.z - p.z)) })),
    };
  }

  /**
   * Builds a village of a kind around a player, in any world (cheat-made: its
   * chunks, mobs and doors count for nothing). Returns what it planned.
   */
  spawnAt(p: ServerPlayer, kind: 'trick' | 'abandoned'): { ok: boolean; text: string } {
    if (p.dim.id !== 'overworld') return { ok: false, text: 'Villages only grow in the Overworld.' };
    if (this.builds.some((b) => b.by === p)) return { ok: false, text: 'A village is still being built here.' };
    const dim = p.dim;
    const ctx = this.liveContext(dim, kind);
    const pcx = Math.floor(p.x) >> 4;
    const pcz = Math.floor(p.z) >> 4;
    const seed = hashInts(this.server.level.seedNum, pcx, pcz, this.server.tickNo);
    let s: Start | null = null;
    // Around the player's own chunk first, then a little further out
    for (let r = 0; r <= 2 && !s; r++)
      for (let dx = -r; dx <= r && !s; dx++)
        for (let dz = -r; dz <= r && !s; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          s = planVillageV9(ctx, pcx + dx, pcz + dz, new Random(hashInts(seed, dx, dz)), kind, {});
        }
    if (!s?.village) return { ok: false, text: 'There is no room for a village here.' };
    const name = kind === 'trick' ? 'Trick-or-Treat Village' : 'Abandoned Village';
    // Its record (doors and all, or the haunted area) is the panel's: cheat-made
    const key = `admin@${s.x},${s.z}`;
    s.village.key = key;
    const v = s.village;
    this.records[key] = { kind, decidedAt: this.server.clock(), x: s.x, y: s.y, z: s.z, style: v.style, doors: v.doors.map((d) => ({ ...d, out: [...d.out] as [number, number, number], used: false })), cheat: true, ...(v.guard ? { area: v.guard } : {}) };
    this.unsaved = true;
    const set = new Set<number>();
    for (const pc of s.pieces) for (let cx = pc.box.x0 >> 4; cx <= pc.box.x1 >> 4; cx++) for (let cz = pc.box.z0 >> 4; cz <= pc.box.z1 >> 4; cz++) set.add(chunkIndex(cx, cz));
    this.builds.push({ dim, start: s, chunks: [...set], by: p, name });
    const doors = kind === 'trick' ? ` ${s.village.doors.length} doors, ${s.village.doors.filter((d) => d.kind === 'trick').length} of them Trick Homes.` : '';
    return { ok: true, text: `Building ${kind === 'trick' ? 'a' : 'an'} ${name} around you (${set.size} chunks).${doors}` };
  }

  /** A plan context over the live world (what players built included) for the Admin Panel's villages. */
  private liveContext(dim: Dimension, kind: 'trick' | 'abandoned'): PlanContext {
    const gen = dim.generator as OverworldGenerator;
    const ground = (x: number, z: number): { y: number; water: boolean } => {
      if (!dim.isLoaded(x, z)) return gen.ground(x, z);
      let y = dim.getHeight(x, z) - 1;
      let water = false;
      while (y > 0) {
        const st = dim.getState(x, y, z);
        if (st !== 0 && !STATE_FLUID[st] && STATE_SOLID[st]) break;
        if (STATE_FLUID[st]) water = true;
        y--;
      }
      return { y, water };
    };
    return {
      seed: this.server.level.seedNum,
      groundY: (x, z) => ground(x, z).y,
      isWater: (x, z) => ground(x, z).water,
      biome: (x, z) => biomeOf(dim.isLoaded(x, z) ? dim.getBiome(x, z) : gen.biomeAt(x, z)),
      estimateHeight: (x, z) => gen.terrain.estimateHeight(x, z),
      estimateBiome: (x, z) => biomeOf(gen.terrain.estimateBiome(x, z)),
      villages: { force: kind },
    };
  }

  /** Builds one chunk of the oldest Admin Panel village whose next chunk is loaded. */
  private tickBuilds(): void {
    for (let i = 0; i < this.builds.length; i++) {
      const b = this.builds[i]!;
      if (!b.chunks.length) {
        this.builds.splice(i--, 1);
        continue;
      }
      for (let j = 0; j < b.chunks.length; j++) {
        const k = b.chunks[j]!;
        const c = b.dim.chunks.get(k);
        if (!c || !c.lightReady) continue;
        b.chunks.splice(j, 1);
        this.buildChunk(b.dim, c, b.start);
        if (!b.chunks.length) b.by?.send({ t: 'chat', text: `Finished building the ${b.name}.`, kind: 'system' });
        return;
      }
    }
  }

  private buildChunk(dim: Dimension, c: Chunk, s: Start): void {
    const v = new DecorView(c, (x, z) => dim.chunks.get(chunkIndex(x, z)) ?? EMPTY);
    const x0 = c.cx << 4;
    const z0 = c.cz << 4;
    for (const p of s.pieces) if (p.box.x1 >= x0 && p.box.x0 < x0 + 16 && p.box.z1 >= z0 && p.box.z0 < z0 + 16) p.build(v);
    c.recount();
    c.recomputeHeightmap();
    dim.light.invalidateCache();
    dim.light.initChunk(c);
    c.dirty = true;
    c.modified = true;
    this.server.admin.markChunk(dim, c.cx, c.cz);
    // Its villagers and undead are cheat-made too
    for (const e of s.entities ?? []) {
      if (Math.floor(e.x) >> 4 !== c.cx || Math.floor(e.z) >> 4 !== c.cz) continue;
      const m = this.server.mobs?.spawn(dim, e.type, e.x, e.y, e.z, { data: e.data ? { ...e.data } : undefined, persistent: true, reason: 'structure' });
      if (m) m.admin = true;
    }
    const k = chunkIndex(c.cx, c.cz);
    for (const pl of this.server.players.values()) if (pl.dim === dim) pl.sentChunks.delete(k);
  }

  /** Builds still waiting for chunks (tests). */
  get pendingBuilds(): number {
    return this.builds.reduce((n, b) => n + b.chunks.length, 0);
  }
}
