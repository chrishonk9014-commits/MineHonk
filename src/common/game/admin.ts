/**
 * Admin Panel protocol: the actions an authorised player may request and
 * strict validation of their arguments. The server re-checks authorisation
 * for every request; the client only uses this to build the panel.
 */
import { EXPANSION_STRUCTURE_IDS } from '../endExpansion/structures';
import type { DimensionId } from '../data/biomes';
import { GAME_MODES, DIFFICULTIES, type GameMode, type Difficulty } from './gamemode';
import { EXPANSION_BIOME_IDS } from '../endExpansion/biomes';
import { expansionGiveSets } from '../endExpansion/resources';
import { END_QUEST_IDS } from '../endExpansion/quests';

export const ADMIN_DIMENSIONS: DimensionId[] = ['overworld', 'nether', 'end', 'farlands', 'computer'];

export const STRUCTURE_NAMES: Record<string, string> = {
  village: 'Village',
  desert_temple: 'Desert Temple',
  jungle_temple: 'Jungle Temple',
  witch_hut: 'Witch Hut',
  igloo: 'Igloo',
  ruined_portal: 'Ruined Portal',
  shipwreck: 'Shipwreck',
  ocean_ruin: 'Ocean Ruin',
  buried_treasure: 'Buried Treasure',
  pillager_outpost: 'Pillager Outpost',
  sky_shrine: 'Sky Shrine',
  overgrown_ruin: 'Overgrown Ruin',
  stalker_den: 'Stalker Den',
  glitched_ruin: 'Glitched Ruin',
  mineshaft: 'Mineshaft',
  stronghold: 'Stronghold',
  dungeon: 'Dungeon',
  nether_fortress: 'Nether Fortress',
  bastion: 'Bastion',
  end_city: 'End City',
  end_fountain: 'Exit Portal (Dragon Island)',
  data_spire: 'Data Spire',
  farlands_vault: 'Farlands Vault',
  // V2: The Caves Update
  ancient_city: 'Ancient City',
  underground_ruins: 'Underground Ruins',
  buried_temple: 'Buried Temple',
  hidden_chamber: 'Hidden Chamber',
  treasure_room: 'Treasure Room',
  abandoned_lab: 'Abandoned Lab',
  cave_shrine: 'Cave Shrine',
  monster_chamber: 'Monster Chamber',
  // V3
  glitched_portal: 'Glitched Portal',
  error_arena: "The Error's Arena",
  // V4: The World Update
  desert_oasis: 'Desert Oasis',
  sun_monument: 'Sun Monument',
  buried_tomb: 'Buried Tomb',
  ranger_tower: 'Ranger Tower',
  hunter_camp: 'Hunter Camp',
  frozen_ruins: 'Frozen Ruins',
  jungle_shrine: 'Jungle Shrine',
  swamp_shack: 'Swamp Shack',
  stone_circle: 'Stone Circle',
  lighthouse: 'Lighthouse',
  mountain_lookout: 'Mountain Lookout',
  prospector_camp: 'Prospector Camp',
  bunker: 'Bunker',
  // Version 4.5: temples of trials
  frost_temple: 'Frost Temple',
  swamp_temple: 'Swamp Temple',
  badlands_temple: 'Canyon Temple',
  forest_temple: 'Grove Temple',
  mountain_temple: 'Mountain Temple',
  desert_pyramid: 'Desert Pyramid',
  error_biome: 'Error Biome',
  glitched_structure: 'Glitched Structure',
};

/** V4 Admin Panel operations (all cheats: never advancements, rewards cheat-marked). */
export const V4_OPS = ['status', 'glitch_start', 'glitch_clear', 'glitch_reset', 'glitch_reward', 'fluid_rig', 'bunker_reset', 'temple_advance', 'temple_reset'] as const;
export type V4Op = (typeof V4_OPS)[number];
export const V5_OPS = ['status', 'fill_energy', 'drain_energy', 'reset_machines', 'kit_basic', 'kit_advanced', 'kit_factory', 'test_rig', 'stress_test'] as const;
export type V5Op = (typeof V5_OPS)[number];
/** V5.5: the Herobrine story's test tools (all cheats: they never award anything). */
export const V55_OPS = [
  'status',
  'give_potion',
  'give_hard_drive',
  'give_flash_drive',
  'give_corrupted',
  'spawn_dragon',
  'trigger_malware',
  'trigger_event',
  'spawn_first',
  'enter_world',
  'tp_seed',
  'tp_cave',
  'spawn_final',
  'force_ending',
  'reset_progress',
  'reset_ending',
] as const;
export type V55Op = (typeof V55_OPS)[number];
/** V6: the End Expansion's portal and travel to the Expanded End (all cheats: never advancements). */
export const V6_OPS = [
  'status',
  'activate',
  'deactivate',
  'build_portal',
  'tp_portal',
  'tp_arrival',
  'tp_biome',
  'where',
  'defeat_dragon',
  'give_set',
  'kill_mobs',
  'mob_spawning_on',
  'mob_spawning_off',
  // Phase 3: structures, the ancient civilization and the Dragon's Nest
  'locate_structures',
  'tp_structure',
  'generate_here',
  'build_nest',
  'tp_nest',
  'reset_loot',
  'give_lore',
  // Phase 4: the End quests (start, complete, reset, go to the nearest start) and testing tools
  'quest_start',
  'quest_complete',
  'quest_reset',
  'quest_tp',
  'fill_eu',
  'force_gate',
  'open_sanctum',
] as const;
export type V6Op = (typeof V6_OPS)[number];

export function structureName(id: string): string {
  return STRUCTURE_NAMES[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const TIME_PRESETS: Record<string, number> = { sunrise: 23000, day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000 };

/** Validated admin requests (discriminated by `a`). */
export type AdminAction =
  | { a: 'catalog' }
  | { a: 'give'; item: string; count: number; potion?: string; enchant?: string; level?: number; target?: string }
  | { a: 'spawn'; mob: string; count: number }
  | { a: 'locate_structure'; dim: DimensionId; structure: string }
  | { a: 'tp_structure'; dim: DimensionId; structure: string }
  | { a: 'locate_biome'; dim: DimensionId; biome: string }
  | { a: 'tp_biome'; dim: DimensionId; biome: string }
  | { a: 'tp_player'; target: string }
  | { a: 'bring_player'; target: string }
  | { a: 'gamemode'; mode: GameMode; target?: string }
  | { a: 'time'; value: number }
  | { a: 'weather'; kind: 'clear' | 'rain' | 'thunder' }
  | { a: 'difficulty'; value: Difficulty }
  | { a: 'pvp'; on: boolean }
  | { a: 'clear_mobs'; radius: number; hostileOnly: boolean }
  | { a: 'heal'; target?: string }
  | { a: 'health'; value: number; target?: string }
  | { a: 'hunger'; value: number; target?: string }
  | { a: 'xp'; mode: 'set' | 'add'; levels: number; target?: string }
  | { a: 'clear_inventory'; target?: string }
  | { a: 'flight'; on: boolean; target?: string }
  | { a: 'regen_chunk' }
  | { a: 'reload_chunks' }
  | { a: 'perf' }
  | { a: 'set_cheats'; on: boolean }
  /** V3 endgame: endings and The Error's fight (all cheats: never advancements). */
  | { a: 'endgame'; op: 'status' | 'reset_endings' | 'force_ending' | 'reset_error'; id?: string }
  /** V4: the Glitched Structure's quest, bunkers and a fluid test rig. */
  | { a: 'v4'; op: V4Op }
  /** V5: engineering (kits, energy, test rigs; all cheats). */
  | { a: 'v5'; op: V5Op }
  /** V5.5: the Herobrine story (all cheats: never advancements). */
  | { a: 'v55'; op: V55Op }
  /** V6: the End Expansion (tp_biome names one of the Expanded End's biomes). */
  | { a: 'v6'; op: V6Op; biome?: string; set?: string; structure?: string; quest?: string };

export type AdminActionName = AdminAction['a'];

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[a-z0-9_:]+$/.test(v);
const name = (v: unknown): v is string | undefined => v === undefined || (typeof v === 'string' && v.length > 0 && v.length <= 32);
const dim = (v: unknown): v is DimensionId => ADMIN_DIMENSIONS.includes(v as DimensionId);

/** Returns a clean action or null when anything is malformed. */
export function validateAdmin(raw: unknown): AdminAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.a) {
    case 'v5':
      if (!V5_OPS.includes(m.op as V5Op)) return null;
      return { a: 'v5', op: m.op as V5Op };
    case 'v55':
      if (!V55_OPS.includes(m.op as V55Op)) return null;
      return { a: 'v55', op: m.op as V55Op };
    case 'v6':
      if (!V6_OPS.includes(m.op as V6Op)) return null;
      if (m.op === 'tp_biome') return typeof m.biome === 'string' && EXPANSION_BIOME_IDS.includes(m.biome) ? { a: 'v6', op: 'tp_biome', biome: m.biome } : null;
      if (m.op === 'give_set') return typeof m.set === 'string' && expansionGiveSets().some((g) => g.id === m.set) ? { a: 'v6', op: 'give_set', set: m.set } : null;
      if (m.op === 'tp_structure' || m.op === 'generate_here') return typeof m.structure === 'string' && EXPANSION_STRUCTURE_IDS.includes(m.structure) ? { a: 'v6', op: m.op, structure: m.structure } : null;
      if (m.op === 'quest_start' || m.op === 'quest_complete' || m.op === 'quest_reset' || m.op === 'quest_tp') return typeof m.quest === 'string' && (END_QUEST_IDS as readonly string[]).includes(m.quest) ? { a: 'v6', op: m.op, quest: m.quest } : null;
      return { a: 'v6', op: m.op as V6Op };
    case 'v4':
      if (!V4_OPS.includes(m.op as V4Op)) return null;
      return { a: 'v4', op: m.op as V4Op };
    case 'endgame':
      if (m.op !== 'status' && m.op !== 'reset_endings' && m.op !== 'force_ending' && m.op !== 'reset_error') return null;
      if (m.op === 'force_ending' && !id(m.id)) return null;
      return { a: 'endgame', op: m.op, id: m.op === 'force_ending' ? (m.id as string) : undefined };
    case 'catalog':
    case 'regen_chunk':
    case 'reload_chunks':
    case 'perf':
      return { a: m.a };
    case 'give': {
      if (!id(m.item) || !isInt(m.count) || m.count < 1 || m.count > 64 * 36 || !name(m.target)) return null;
      if (m.potion !== undefined && !id(m.potion)) return null;
      if (m.enchant !== undefined && !id(m.enchant)) return null;
      if (m.level !== undefined && (!isInt(m.level) || m.level < 1 || m.level > 10)) return null;
      return { a: 'give', item: m.item, count: m.count, potion: m.potion as string | undefined, enchant: m.enchant as string | undefined, level: m.level as number | undefined, target: m.target };
    }
    case 'spawn':
      if (!id(m.mob) || !isInt(m.count) || m.count < 1 || m.count > 50) return null;
      return { a: 'spawn', mob: m.mob, count: m.count };
    case 'locate_structure':
    case 'tp_structure':
      if (!dim(m.dim) || !id(m.structure)) return null;
      return { a: m.a, dim: m.dim, structure: m.structure };
    case 'locate_biome':
    case 'tp_biome':
      if (!dim(m.dim) || !id(m.biome)) return null;
      return { a: m.a, dim: m.dim, biome: m.biome };
    case 'tp_player':
    case 'bring_player':
      if (typeof m.target !== 'string' || !name(m.target)) return null;
      return { a: m.a, target: m.target };
    case 'gamemode':
      if (!GAME_MODES.includes(m.mode as GameMode) || m.mode === 'hardcore' || !name(m.target)) return null;
      return { a: 'gamemode', mode: m.mode as GameMode, target: m.target };
    case 'time':
      if (!isInt(m.value) || m.value < 0 || m.value >= 24000) return null;
      return { a: 'time', value: m.value };
    case 'weather':
      if (m.kind !== 'clear' && m.kind !== 'rain' && m.kind !== 'thunder') return null;
      return { a: 'weather', kind: m.kind };
    case 'difficulty':
      if (!DIFFICULTIES.includes(m.value as Difficulty)) return null;
      return { a: 'difficulty', value: m.value as Difficulty };
    case 'pvp':
    case 'set_cheats':
      if (typeof m.on !== 'boolean') return null;
      return { a: m.a, on: m.on };
    case 'clear_mobs':
      if (!isInt(m.radius) || m.radius < 1 || m.radius > 256 || typeof m.hostileOnly !== 'boolean') return null;
      return { a: 'clear_mobs', radius: m.radius, hostileOnly: m.hostileOnly };
    case 'heal':
    case 'clear_inventory':
      if (!name(m.target)) return null;
      return { a: m.a, target: m.target };
    case 'health':
      if (!isNum(m.value) || m.value < 1 || m.value > 1_000_000 || !name(m.target)) return null;
      return { a: 'health', value: m.value, target: m.target };
    case 'hunger':
      if (!isInt(m.value) || m.value < 0 || m.value > 20 || !name(m.target)) return null;
      return { a: 'hunger', value: m.value, target: m.target };
    case 'xp':
      if ((m.mode !== 'set' && m.mode !== 'add') || !isInt(m.levels) || m.levels < -1000 || m.levels > 10000 || !name(m.target)) return null;
      if (m.mode === 'set' && m.levels < 0) return null;
      return { a: 'xp', mode: m.mode, levels: m.levels, target: m.target };
    case 'flight':
      if (typeof m.on !== 'boolean' || !name(m.target)) return null;
      return { a: 'flight', on: m.on, target: m.target };
    default:
      return null;
  }
}

/** Total experience points needed to reach a level (classic curve). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2;
  return total;
}

export interface AdminCatalog {
  structures: Record<string, string[]>;
  biomes: Record<string, { id: string; name: string }[]>;
  mobs: { id: string; name: string; category: string }[];
  players: string[];
  /** V2 cave features per dimension (cave biome ids, 'mega_cavern', 'ravine'). */
  caves?: Record<string, { id: string; name: string }[]>;
}

export interface LocateResult {
  kind: 'structure' | 'biome' | 'cave';
  id: string;
  name: string;
  dim: DimensionId;
  x: number;
  y: number;
  z: number;
  distance: number;
}
