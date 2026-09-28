import type { AdminAction } from '../game/admin';
import type { WorldRole } from './multiplayer';
/**
 * Client <-> server protocol. Every message is a plain object with a `t`
 * discriminator. Binary payloads use Uint8Array. The same messages travel
 * over a Web Worker port (integrated server) or a WebSocket (msgpack).
 */
import type { ItemStack, Slot } from '../game/itemstack';
import type { GameMode, Difficulty, GodHearts } from '../game/gamemode';
import type { DimensionId } from '../data/biomes';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------
export type C2S =
  | { t: 'hello'; version: number; name: string; token?: string; viewDistance: number; registryHash: string }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; onGround: boolean; flying: boolean; sneak: boolean; sprint: boolean; seq: number; glide?: boolean }
  | { t: 'dig'; action: 'start' | 'abort' | 'finish'; x: number; y: number; z: number; face: number }
  | { t: 'use_on'; x: number; y: number; z: number; face: number; hx: number; hy: number; hz: number; hand: 0 | 1; yaw: number; pitch: number; seq: number }
  | { t: 'use'; hand: 0 | 1; action: 'start' | 'release' }
  | { t: 'hotbar'; slot: number }
  | { t: 'click'; window: number; slot: number; button: number; mode: ClickMode; seq: number }
  | { t: 'close_window'; window: number }
  | { t: 'creative_set'; slot: number; item: Slot }
  | { t: 'creative_pick'; item: Slot }
  | { t: 'chat'; text: string }
  | { t: 'attack'; id: number }
  | { t: 'interact'; id: number; hand: 0 | 1 }
  | { t: 'respawn' }
  | { t: 'drop'; all: boolean }
  | { t: 'swap_hands' }
  | { t: 'settings'; viewDistance: number }
  | { t: 'swing' }
  | { t: 'set_flying'; flying: boolean }
  | { t: 'sign_text'; x: number; y: number; z: number; lines: string[] }
  | { t: 'enchant'; option: number }
  | { t: 'rename'; name: string }
  | { t: 'trade'; index: number }
  | { t: 'wake' }
  | { t: 'request_progress' }
  | { t: 'ping'; time: number }
  /** Admin Panel request (authorised and validated by the server). */
  | { t: 'admin'; req: number; action: AdminAction };

export type ClickMode = 'pickup' | 'quick' | 'swap' | 'drop' | 'drag_start' | 'drag_add' | 'drag_end' | 'collect' | 'clone';

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------
export interface PlayerStats {
  health: number;
  maxHealth: number;
  absorption: number;
  food: number;
  saturation: number;
  xp: number;
  level: number;
  xpProgress: number;
  air: number;
  maxAir: number;
  armor: number;
  effects: { id: string; amp: number; ticks: number }[];
}

export interface WorldInfo {
  name: string;
  seed: string;
  mode: GameMode;
  difficulty: Difficulty;
  pvp: boolean;
  godHearts: GodHearts;
  hardcore: boolean;
  cheats: boolean;
  /** Only sent to owners and operators. */
  joinCode?: string;
  isOwner: boolean;
  isHost: boolean;
  /** Whether this player may use the Admin Panel (operator in a world with cheats). */
  admin?: boolean;
  role: WorldRole;
}

export interface EntitySpawn {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx?: number;
  vy?: number;
  vz?: number;
  meta?: Record<string, unknown>;
}

export type S2C =
  | { t: 'welcome'; entityId: number; name: string; uuid: string; dimension: DimensionId; gamemode: GameMode; world: WorldInfo; x: number; y: number; z: number; yaw: number; pitch: number; time: number; dayTime: number; abilities: AbilitiesMsg; spawn: [number, number, number] }
  | { t: 'kick'; reason: string }
  | { t: 'chunk'; data: Uint8Array }
  | { t: 'unload_chunk'; cx: number; cz: number }
  | { t: 'block'; x: number; y: number; z: number; state: number }
  /** Batched changes in one chunk: list = [y << 8 | lz << 4 | lx, state, ...] */
  | { t: 'blocks'; cx: number; cz: number; list: number[] }
  | { t: 'light'; cx: number; cz: number; sy: number; data: Uint8Array }
  | { t: 'block_entity'; x: number; y: number; z: number; data: Record<string, unknown> | null }
  | { t: 'spawn'; e: EntitySpawn }
  | { t: 'despawn'; ids: number[] }
  | { t: 'moves'; list: number[] }
  | { t: 'velocity'; id: number; vx: number; vy: number; vz: number }
  | { t: 'meta'; id: number; meta: Record<string, unknown> }
  | { t: 'anim'; id: number; anim: EntityAnim }
  | { t: 'equipment'; id: number; slots: (Slot | undefined)[] }
  | { t: 'stats'; s: PlayerStats }
  | { t: 'inventory'; window: number; slots: Slot[]; cursor: Slot; seq: number }
  | { t: 'slot'; window: number; slot: number; item: Slot }
  | { t: 'cursor'; item: Slot }
  | { t: 'hotbar'; slot: number }
  | { t: 'open_window'; window: number; kind: WindowKind; title: string; size: number; data?: Record<string, unknown> }
  | { t: 'close_window'; window: number }
  | { t: 'window_prop'; window: number; prop: string; value: number | string | unknown }
  | { t: 'time'; time: number; dayTime: number; rain: number; thunder: number; dayCycle: boolean }
  | { t: 'chat'; text: string; kind: ChatKind; from?: string }
  | { t: 'sound'; name: string; x: number; y: number; z: number; volume: number; pitch: number }
  | { t: 'particles'; kind: string; x: number; y: number; z: number; count: number; spread?: number; data?: number }
  | { t: 'teleport'; x: number; y: number; z: number; yaw?: number; pitch?: number; seq: number }
  | { t: 'dig_progress'; x: number; y: number; z: number; stage: number; by: number }
  | { t: 'gamemode'; mode: GameMode; abilities: AbilitiesMsg }
  | { t: 'abilities'; abilities: AbilitiesMsg }
  | { t: 'dimension'; dimension: DimensionId; x: number; y: number; z: number; yaw: number }
  | { t: 'boss'; id: number; action: 'add' | 'update' | 'remove'; title?: string; progress?: number; color?: string }
  | { t: 'death'; message: string; hardcore: boolean; score: number }
  | { t: 'respawned' }
  | { t: 'achievement'; id: string; title: string }
  | { t: 'player_list'; players: { name: string; uuid: string; ping: number; mode: GameMode }[] }
  | { t: 'explosion'; x: number; y: number; z: number; power: number; kx: number; ky: number; kz: number }
  | { t: 'title'; text: string; sub?: string; ticks?: number }
  | { t: 'world_info'; world: WorldInfo }
  | { t: 'pong'; time: number }
  | { t: 'take_item'; item: number; by: number }
  | { t: 'use_result'; seq: number; ok: boolean }
  | { t: 'progress'; achievements: string[]; stats: Record<string, number> }
  | { t: 'debug'; data: Record<string, unknown> }
  | { t: 'admin_result'; req: number; ok: boolean; text: string; data?: unknown }
  /** An item can't be used for a while (knocked-aside shield, pearl cooldown). */
  | { t: 'cooldown'; item: number; ticks: number }
  /** A firework rocket pushes the gliding player for `ticks`. */
  | { t: 'boost'; ticks: number };

export interface AbilitiesMsg {
  mayFly: boolean;
  flying: boolean;
  invulnerable: boolean;
  instantBuild: boolean;
  mayBuild: boolean;
  noClip: boolean;
  walkSpeed: number;
  flySpeed: number;
}

export type EntityAnim = 'swing' | 'hurt' | 'death' | 'crit' | 'eat' | 'magic_crit' | 'wake' | 'sleep' | 'totem' | 'teleport' | 'attack';
export type ChatKind = 'chat' | 'system' | 'join' | 'leave' | 'death' | 'announce' | 'error' | 'achievement' | 'whisper';
export type WindowKind =
  | 'player'
  | 'crafting'
  | 'furnace'
  | 'blast_furnace'
  | 'smoker'
  | 'chest'
  | 'enchanting'
  | 'anvil'
  | 'brewing'
  | 'smithing'
  | 'creative'
  | 'merchant'
  | 'stonecutter';

export type { ItemStack };

/** Sanity limits enforced on incoming messages. */
export const LIMITS = {
  chatLength: 256,
  nameLength: 16,
  signLine: 32,
  maxViewDistance: 32,
  minViewDistance: 2,
};
