/**
 * Admin Panel protocol: the actions an authorised player may request and
 * strict validation of their arguments. The server re-checks authorisation
 * for every request; the client only uses this to build the panel.
 */
import type { DimensionId } from '../data/biomes';
import { GAME_MODES, DIFFICULTIES, type GameMode, type Difficulty } from './gamemode';

export const ADMIN_DIMENSIONS: DimensionId[] = ['overworld', 'nether', 'end', 'farlands'];

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
};

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
  | { a: 'set_cheats'; on: boolean };

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
