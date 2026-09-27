/**
 * Multiplayer rules shared by the hub server and the client: account name
 * and password policy, world join codes, roles and the JSON API shapes.
 */

/** Join codes avoid look-alike characters (0/O, 1/I). */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Normalises user input like "abc7 92kd" to "ABC7-92KD"; null if invalid. */
export function normalizeJoinCode(raw: string): string | null {
  const s = String(raw).toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 8) return null;
  for (const ch of s) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Builds a join code from 8 random bytes. */
export function joinCodeFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
const USERNAME_RE = /^[A-Za-z0-9_]+$/;
const RESERVED = new Set(['admin', 'administrator', 'server', 'system', 'moderator', 'mod', 'minehonk', 'owner', 'console', 'everyone', 'here']);

/** Returns an error message, or null when the name is acceptable. */
export function validateUsername(name: string): string | null {
  if (typeof name !== 'string') return 'Enter a name';
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return `Names are ${USERNAME_MIN}-${USERNAME_MAX} characters`;
  if (!USERNAME_RE.test(name)) return 'Use letters, numbers and _ only';
  if (RESERVED.has(name.toLowerCase())) return 'That name is reserved';
  return null;
}

export function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Passwords need at least 8 characters';
  if (pw.length > 128) return 'Password is too long';
  return null;
}

export type WorldVisibility = 'private' | 'friends' | 'public';
export type WorldRole = 'owner' | 'operator' | 'builder' | 'visitor';
export const WORLD_ROLES: readonly WorldRole[] = ['owner', 'operator', 'builder', 'visitor'];

export function roleRank(r: WorldRole): number {
  return WORLD_ROLES.length - WORLD_ROLES.indexOf(r);
}

// ---------------------------------------------------------------------------
// HTTP API shapes
// ---------------------------------------------------------------------------
export interface AccountInfo {
  uuid: string;
  name: string;
}

export interface FriendInfo {
  uuid: string;
  name: string;
  online: boolean;
  /** World the friend is playing in, if they share it with friends. */
  world?: string;
}

export interface FriendsResponse {
  friends: FriendInfo[];
  incoming: AccountInfo[];
  outgoing: AccountInfo[];
}

export interface WorldSummary {
  id: string;
  name: string;
  owner: string;
  ownerName: string;
  visibility: WorldVisibility;
  mode: string;
  players: number;
  maxPlayers: number;
  /** The caller's role in this world. */
  role: WorldRole | null;
}

export interface WorldDetails extends WorldSummary {
  /** Only for owners and operators. */
  joinCode?: string | null;
  pvp: boolean;
  defaultRole: 'builder' | 'visitor';
  members?: { uuid: string; name: string; role: WorldRole }[];
}

export interface ApiError {
  error: string;
}
