/** Persistent world-level settings and state. */
import type { Disk } from '../../common/digital/data';
import type { HerobrineStage } from '../../common/digital/story';
import type { GameMode, Difficulty, GodHearts } from '../../common/game/gamemode';
import { normalizeGodHearts, GAME_MODES, DIFFICULTIES } from '../../common/game/gamemode';
import { seedFromString } from '../../common/math/rng';
import type { DimensionId } from '../../common/data/biomes';

export const LEVEL_VERSION = 1;
/** Worlds created from V2 on generate with the Caves Update terrain (see GeneratorOptions.version). */
export const GENERATOR_VERSION = 8;

export interface GameRules {
  doDaylightCycle: boolean;
  doWeatherCycle: boolean;
  doMobSpawning: boolean;
  keepInventory: boolean;
  mobGriefing: boolean;
  doMobLoot: boolean;
  naturalRegeneration: boolean;
  doFireTick: boolean;
  /** Minutes for a full day/night cycle. */
  dayLengthMinutes: number;
  /** God Mode: hunger still drains. */
  godHunger: boolean;
  /** God Mode: environmental hazards (lava, drowning, void) still hurt. */
  godHazards: boolean;
  showCoordinates: boolean;
  randomTickSpeed: number;
  spawnRadius: number;
  /** Seconds a Warden stays calm before it burrows back into the ground. */
  wardenCalmSeconds: number;
}

export interface LevelData {
  version: number;
  generatorVersion: number;
  id: string;
  name: string;
  seed: string;
  seedNum: number;
  mode: GameMode;
  difficulty: Difficulty;
  godHearts: GodHearts;
  pvp: boolean;
  cheats: boolean;
  hardcore: boolean;
  bonusChest: boolean;
  generateStructures: boolean;
  createdAt: number;
  lastPlayed: number;
  /** Total ticks the world has run. */
  time: number;
  /** Time of day 0..23999. */
  dayTime: number;
  rainTime: number;
  raining: boolean;
  thunderTime: number;
  thundering: boolean;
  spawn: [number, number, number] | null;
  rules: GameRules;
  /** Multiplayer */
  owner: string | null;
  visibility: 'private' | 'friends' | 'public';
  joinCode: string | null;
  allowlist: string[];
  banned: string[];
  operators: string[];
  /** Progression flags (dragon killed, farlands discovered ...). */
  flags: Record<string, unknown>;
  /** Known portals (bottom corner of the portal sheet), used to link travel. */
  portals: PortalRecord[];
  /** Per-player role overrides (operators are listed separately). */
  roles: Record<string, 'builder' | 'visitor'>;
  /** Role for players without an override. */
  defaultRole: 'builder' | 'visitor';
  /** Muted players: uuid -> time (ms) the mute ends. */
  muted: Record<string, number>;
  /** Player reports for operators (most recent last). */
  reports: { from: string; target: string; reason: string; at: number }[];
  /** Cheat bookkeeping (blocks placed by cheats, cheat-set time/weather). */
  admin?: { sky?: boolean; blocks?: Record<string, Record<string, number[]>>; chunks?: Record<string, number[]> };
  /** Endgame state: endings, the Corrupted Eye, the Farlands and its boss. */
  endings: WorldEndings;
  /** V4 quest structures: progress through each Glitched Structure and bunker. */
  quests: WorldQuests;
  /** V5.5: drives' files (disks by id, carried by the drive items). */
  digital: DigitalStore;
  /** V5.5: the Herobrine story in this world. */
  herobrine: HerobrineWorld;
}

/** V5.5: every drive's files, kept with the world (the drive item carries its disk's id). */
export interface DigitalStore {
  next: number;
  disks: Record<string, Disk>;
}

/** V5.5: where the Herobrine story stands in a world (see systems/Herobrine). */
export interface HerobrineWorld {
  stage: HerobrineStage;
  /** The computer he came out of, and went back into. */
  gateway: { x: number; y: number; z: number } | null;
  /** This run used cheats somewhere (the Admin Panel, a cheat-made drive): nothing in it counts. */
  cheat: boolean;
  /** Ender Dragons killed since V5.5: a corrupted drive only speaks once the dragon has died after it was made. */
  dragonKills: number;
  /** Times the story has been seen through to its ending in this world. */
  completions: number;
  /** Players (uuids) who have taken part in the current run. */
  party: string[];
  /** Ender Dragons killed without cheats (a run is only clean if one of these came after its drive). */
  legitKills: number;
  /** Bumped when the computer world collapses: it is generated afresh next time. */
  epoch: number;
  /** The Ender Dragon has drunk the potion (until it dies): it coughs up malware. */
  infected: boolean;
  infectedCheat: boolean;
}

export function newHerobrineWorld(): HerobrineWorld {
  return { stage: 'none', gateway: null, cheat: false, dragonKills: 0, completions: 0, party: [], legitKills: 0, epoch: 0, infected: false, infectedCheat: false };
}

const STAGES: HerobrineStage[] = ['none', 'emerging', 'fight1', 'gateway', 'final', 'ending'];

function sanitizeHerobrine(raw: unknown): HerobrineWorld {
  const out = newHerobrineWorld();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<HerobrineWorld>;
  if (STAGES.includes(r.stage as HerobrineStage)) out.stage = r.stage as HerobrineStage;
  const g = r.gateway;
  if (g && typeof g === 'object' && [g.x, g.y, g.z].every((n) => Number.isInteger(n))) out.gateway = { x: g.x, y: g.y, z: g.z };
  out.cheat = r.cheat === true;
  out.dragonKills = typeof r.dragonKills === 'number' && Number.isFinite(r.dragonKills) ? Math.max(0, Math.floor(r.dragonKills)) : 0;
  out.legitKills = typeof r.legitKills === 'number' && Number.isFinite(r.legitKills) ? Math.max(0, Math.floor(r.legitKills)) : 0;
  out.epoch = typeof r.epoch === 'number' && Number.isFinite(r.epoch) ? Math.max(0, Math.floor(r.epoch)) : 0;
  out.infected = r.infected === true;
  out.infectedCheat = r.infectedCheat === true;
  out.completions = typeof r.completions === 'number' && Number.isFinite(r.completions) ? Math.max(0, Math.floor(r.completions)) : 0;
  out.party = Array.isArray(r.party) ? r.party.filter((u): u is string => typeof u === 'string' && u.length < 64).slice(0, 64) : [];
  // A story stopped mid-way without its computer can't go on: start over
  if (!out.gateway && out.stage !== 'none') out.stage = 'none';
  return out;
}

const FILE_KINDS = ['system', 'program', 'config', 'factory', 'automation', 'blueprint', 'map', 'log', 'lore', 'quest', 'story'];

function sanitizeDigital(raw: unknown): DigitalStore {
  const out: DigitalStore = { next: 1, disks: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<DigitalStore>;
  out.next = typeof r.next === 'number' && Number.isFinite(r.next) ? Math.max(1, Math.floor(r.next)) : 1;
  if (r.disks && typeof r.disks === 'object') {
    let n = 0;
    for (const [id, d] of Object.entries(r.disks)) {
      if (n++ > 20000 || !d || typeof d !== 'object' || typeof id !== 'string' || id.length > 24) continue;
      const kind = d.kind === 'hdd' || d.kind === 'flash' || d.kind === 'corrupted' ? d.kind : null;
      if (!kind) continue;
      const files = Array.isArray(d.files)
        ? d.files
            .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.name.length <= 64 && FILE_KINDS.includes(f.kind) && typeof f.size === 'number' && Number.isFinite(f.size))
            .slice(0, 512)
            .map((f) => ({ name: f.name, kind: f.kind, size: Math.max(0, Math.floor(f.size)), ...(f.data !== undefined ? { data: f.data } : {}), ...(f.ro ? { ro: true } : {}), ...(f.corrupt ? { corrupt: true } : {}) }))
        : [];
      out.disks[id] = { id, kind, label: typeof d.label === 'string' ? d.label.slice(0, 32) : 'Drive', cap: typeof d.cap === 'number' && Number.isFinite(d.cap) ? Math.max(0, Math.floor(d.cap)) : 1024, files };
    }
  }
  return out;
}

/** Progress through one quest structure (V4). */
export interface QuestRecord {
  /** Stages or objectives completed. */
  stage: number;
  done: boolean;
  /** Players (uuids) already rewarded for completing it. */
  rewarded: string[];
  /** Objective flags (bunkers: 'card', generator positions...). */
  flags?: string[];
}

export interface WorldQuests {
  /** Glitched Structures by '<dimension>:<cx>,<cz>'. */
  glitch: Record<string, QuestRecord>;
  /** Bunkers by '<x>,<y>,<z>' of their entrance. */
  bunker: Record<string, QuestRecord>;
  /** Temple trials (generator 5) by '<type>:<x>,<y>,<z>'. */
  temple: Record<string, QuestRecord>;
}

export function newWorldQuests(): WorldQuests {
  return { glitch: {}, bunker: {}, temple: {} };
}

function sanitizeQuests(raw: unknown): WorldQuests {
  const out = newWorldQuests();
  if (!raw || typeof raw !== 'object') return out;
  for (const kind of ['glitch', 'bunker', 'temple'] as const) {
    const m = (raw as Record<string, unknown>)[kind];
    if (!m || typeof m !== 'object') continue;
    for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 4096)) {
      if (k.length > 64 || !v || typeof v !== 'object') continue;
      const r = v as Partial<QuestRecord>;
      out[kind][k] = {
        stage: typeof r.stage === 'number' && Number.isFinite(r.stage) ? Math.max(0, Math.min(16, Math.floor(r.stage))) : 0,
        done: r.done === true,
        rewarded: Array.isArray(r.rewarded) ? r.rewarded.filter((u): u is string => typeof u === 'string' && u.length < 64).slice(0, 64) : [],
        flags: Array.isArray(r.flags) ? r.flags.filter((u): u is string => typeof u === 'string' && u.length < 64).slice(0, 64) : undefined,
      };
    }
  }
  return out;
}

/** Endgame state of a world (V3): how the dragon fell and which endings were reached. */
export interface WorldEndings {
  /** How the Ender Dragon last died: by a player, by a Voidbound Enderman (the secret ending) or by a cheat. */
  dragonDeath: 'player' | 'enderman' | 'cheat' | null;
  /** Endings reached in this world: id -> when (ms) it was first reached. */
  reached: Record<string, number>;
  /** Endings that were only ever forced by the Admin Panel or reached with cheats. */
  forced: string[];
  /** The secret ending awarded a Corrupted Eye. */
  eyeAwarded: boolean;
  /** A glitched portal has been lit with a Corrupted Eye. */
  farlandsAccess: boolean;
  /** The Error has been defeated in the Farlands. */
  errorDefeated: boolean;
}

export function newWorldEndings(): WorldEndings {
  return { dragonDeath: null, reached: {}, forced: [], eyeAwarded: false, farlandsAccess: false, errorDefeated: false };
}

function sanitizeEndings(raw: unknown): WorldEndings {
  const out = newWorldEndings();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<WorldEndings>;
  out.dragonDeath = r.dragonDeath === 'player' || r.dragonDeath === 'enderman' || r.dragonDeath === 'cheat' ? r.dragonDeath : null;
  if (r.reached && typeof r.reached === 'object') for (const [k, v] of Object.entries(r.reached)) if (k.length < 64 && typeof v === 'number' && Number.isFinite(v)) out.reached[k] = v;
  out.forced = Array.isArray(r.forced) ? r.forced.filter((s): s is string => typeof s === 'string' && s.length < 64).slice(0, 32) : [];
  out.eyeAwarded = r.eyeAwarded === true;
  out.farlandsAccess = r.farlandsAccess === true;
  out.errorDefeated = r.errorDefeated === true;
  return out;
}

export interface PortalRecord {
  dim: DimensionId;
  kind: 'nether' | 'far';
  x: number;
  y: number;
  z: number;
  axis: 'x' | 'z';
}

export const DEFAULT_RULES: GameRules = {
  doDaylightCycle: true,
  doWeatherCycle: true,
  doMobSpawning: true,
  keepInventory: false,
  mobGriefing: true,
  doMobLoot: true,
  naturalRegeneration: true,
  doFireTick: true,
  dayLengthMinutes: 20,
  godHunger: true,
  godHazards: true,
  showCoordinates: true,
  randomTickSpeed: 3,
  spawnRadius: 8,
  wardenCalmSeconds: 60,
};

export interface NewWorldOptions {
  id: string;
  name: string;
  seed: string;
  mode: GameMode;
  difficulty: Difficulty;
  godHearts?: GodHearts;
  pvp?: boolean;
  cheats?: boolean;
  bonusChest?: boolean;
  generateStructures?: boolean;
  owner?: string | null;
  visibility?: LevelData['visibility'];
  rules?: Partial<GameRules>;
}

export function createLevelData(o: NewWorldOptions): LevelData {
  const hardcore = o.mode === 'hardcore';
  return {
    version: LEVEL_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: o.id,
    name: (o.name || 'New World').slice(0, 48),
    seed: o.seed,
    seedNum: seedFromString(o.seed),
    mode: o.mode,
    difficulty: hardcore ? 'hard' : o.difficulty,
    godHearts: normalizeGodHearts(o.godHearts ?? 10),
    pvp: o.pvp ?? true,
    cheats: o.cheats ?? o.mode === 'creative',
    hardcore,
    bonusChest: o.bonusChest ?? false,
    generateStructures: o.generateStructures ?? true,
    createdAt: Date.now(),
    lastPlayed: Date.now(),
    time: 0,
    dayTime: 1000,
    rainTime: 12000 + Math.floor(Math.random() * 168000),
    raining: false,
    thunderTime: 12000 + Math.floor(Math.random() * 168000),
    thundering: false,
    spawn: null,
    rules: { ...DEFAULT_RULES, ...(o.rules ?? {}) },
    owner: o.owner ?? null,
    visibility: o.visibility ?? 'private',
    joinCode: null,
    allowlist: [],
    banned: [],
    operators: o.owner ? [o.owner] : [],
    flags: {},
    portals: [],
    roles: {},
    defaultRole: 'builder',
    muted: {},
    reports: [],
    endings: newWorldEndings(),
    quests: newWorldQuests(),
    digital: { next: 1, disks: {} },
    herobrine: newHerobrineWorld(),
  };
}

/** Validates/repairs level data loaded from storage (defensive against corruption). */
export function sanitizeLevelData(raw: unknown, fallbackId: string): LevelData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LevelData>;
  if (typeof r.seed !== 'string') return null;
  const base = createLevelData({
    id: typeof r.id === 'string' ? r.id : fallbackId,
    name: typeof r.name === 'string' ? r.name : 'World',
    seed: r.seed,
    mode: GAME_MODES.includes(r.mode as GameMode) ? (r.mode as GameMode) : 'survival',
    difficulty: DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : 'normal',
    godHearts: r.godHearts,
  });
  const out: LevelData = { ...base };
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  out.seedNum = typeof r.seedNum === 'number' ? r.seedNum >>> 0 : base.seedNum;
  out.pvp = typeof r.pvp === 'boolean' ? r.pvp : base.pvp;
  out.cheats = typeof r.cheats === 'boolean' ? r.cheats : base.cheats;
  out.hardcore = out.mode === 'hardcore';
  out.createdAt = num(r.createdAt, base.createdAt);
  out.lastPlayed = num(r.lastPlayed, base.lastPlayed);
  out.time = num(r.time, 0);
  out.dayTime = ((num(r.dayTime, 1000) % 24000) + 24000) % 24000;
  out.rainTime = num(r.rainTime, base.rainTime);
  out.raining = !!r.raining;
  out.thunderTime = num(r.thunderTime, base.thunderTime);
  out.thundering = !!r.thundering;
  out.spawn = Array.isArray(r.spawn) && r.spawn.length === 3 && r.spawn.every((v) => Number.isFinite(v)) ? (r.spawn as [number, number, number]) : null;
  out.rules = { ...DEFAULT_RULES, ...(r.rules && typeof r.rules === 'object' ? r.rules : {}) };
  out.owner = typeof r.owner === 'string' ? r.owner : null;
  out.visibility = r.visibility === 'public' || r.visibility === 'friends' ? r.visibility : 'private';
  out.joinCode = typeof r.joinCode === 'string' ? r.joinCode : null;
  out.allowlist = Array.isArray(r.allowlist) ? r.allowlist.filter((s) => typeof s === 'string') : [];
  out.banned = Array.isArray(r.banned) ? r.banned.filter((s) => typeof s === 'string') : [];
  out.operators = Array.isArray(r.operators) ? r.operators.filter((s) => typeof s === 'string') : [];
  out.flags = r.flags && typeof r.flags === 'object' ? r.flags : {};
  out.roles = {};
  if (r.roles && typeof r.roles === 'object') for (const [k, v] of Object.entries(r.roles)) if (v === 'builder' || v === 'visitor') out.roles[k] = v;
  out.defaultRole = r.defaultRole === 'visitor' ? 'visitor' : 'builder';
  out.muted = {};
  if (r.muted && typeof r.muted === 'object') for (const [k, v] of Object.entries(r.muted)) if (typeof v === 'number' && Number.isFinite(v)) out.muted[k] = v;
  out.reports = Array.isArray(r.reports) ? r.reports.filter((q) => q && typeof q.from === 'string' && typeof q.target === 'string' && typeof q.reason === 'string').slice(-200) : [];
  out.portals = Array.isArray(r.portals)
    ? r.portals.filter((q): q is PortalRecord => !!q && typeof q === 'object' && ['overworld', 'nether', 'end', 'farlands', 'computer'].includes(q.dim) && (q.kind === 'nether' || q.kind === 'far') && [q.x, q.y, q.z].every((n) => Number.isInteger(n)) && (q.axis === 'x' || q.axis === 'z')).slice(0, 1024)
    : [];
  // Worlds saved without a version predate V2
  out.generatorVersion = num(r.generatorVersion, 1);
  out.bonusChest = !!r.bonusChest;
  out.generateStructures = r.generateStructures !== false;
  out.endings = sanitizeEndings(r.endings);
  out.quests = sanitizeQuests(r.quests);
  // V5.5 (older saves have neither: they start empty)
  out.digital = sanitizeDigital(r.digital);
  out.herobrine = sanitizeHerobrine(r.herobrine);
  if (r.admin && typeof r.admin === 'object') {
    const a = r.admin as NonNullable<LevelData['admin']>;
    out.admin = { sky: a.sky === true, blocks: a.blocks && typeof a.blocks === 'object' ? a.blocks : {}, chunks: a.chunks && typeof a.chunks === 'object' ? a.chunks : {} };
  }
  return out;
}
