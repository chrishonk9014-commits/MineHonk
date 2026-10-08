/**
 * Storage behind the hub's accounts, friends and world registry. The Node
 * server keeps it in JSON files (src/server-node/HubFileStore.ts), the cloud
 * hub in a SQL database (src/hub/sqlStore.ts on Cloudflare D1). The rules
 * live in the cores (accounts.ts, friends.ts, worlds.ts) and never touch
 * storage directly.
 */
import type { WorldRole, WorldVisibility } from '../common/net/multiplayer';

export interface UserRecord {
  uuid: string;
  name: string;
  /** Hex. */
  salt: string;
  /** Hex. */
  hash: string;
  createdAt: number;
  failures: number;
  lockedUntil: number;
}

export interface SessionRecord {
  uuid: string;
  expires: number;
}

export interface AccountStore {
  userByUuid(uuid: string): Promise<UserRecord | null>;
  /** By the lower-case name. */
  userByName(nameLower: string): Promise<UserRecord | null>;
  /** Adds a user; false when the name is already taken. */
  insertUser(u: UserRecord): Promise<boolean>;
  updateUser(uuid: string, patch: Partial<Pick<UserRecord, 'failures' | 'lockedUntil'>>): Promise<void>;
  session(tokenHash: string): Promise<SessionRecord | null>;
  putSession(tokenHash: string, s: SessionRecord): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  pruneSessions(now: number): Promise<void>;
}

export interface FriendStore {
  friendsOf(uuid: string): Promise<string[]>;
  areFriends(a: string, b: string): Promise<boolean>;
  /** Accounts that asked `uuid` (oldest first). */
  incoming(uuid: string): Promise<string[]>;
  /** Accounts `uuid` asked (oldest first). */
  outgoing(uuid: string): Promise<string[]>;
  hasRequest(from: string, to: string): Promise<boolean>;
  addRequest(from: string, to: string, at: number): Promise<void>;
  deleteRequest(from: string, to: string): Promise<void>;
  addFriends(a: string, b: string): Promise<void>;
  removeFriends(a: string, b: string): Promise<void>;
  /** Accounts `uuid` has blocked. */
  blocked(uuid: string): Promise<string[]>;
  isBlocked(by: string, who: string): Promise<boolean>;
  setBlocked(by: string, who: string, on: boolean): Promise<void>;
}

/** One world in the hub's registry: who owns it, who may join, its code. */
export interface WorldEntry {
  id: string;
  name: string;
  owner: string;
  visibility: WorldVisibility;
  joinCode: string | null;
  allowlist: string[];
  banned: string[];
  operators: string[];
  roles: Record<string, 'builder' | 'visitor'>;
  defaultRole: 'builder' | 'visitor';
  pvp: boolean;
  mode: string;
  maxPlayers: number;
  createdAt: number;
  /** Cheats and the Admin Panel for the owner and operators (absent on old Node entries: creative worlds). */
  cheats?: boolean;
  /** Admin actions announced in chat (default on). */
  announceAdmin?: boolean;
}

export interface WorldStore {
  world(id: string): Promise<WorldEntry | null>;
  worldByCode(code: string): Promise<WorldEntry | null>;
  countOwned(owner: string): Promise<number>;
  /**
   * Worlds that may concern `viewer`: theirs, ones they are a member of,
   * their friends' and public ones. The core applies the exact rules.
   */
  candidates(viewer: string, friends: string[]): Promise<WorldEntry[]>;
  putWorld(e: WorldEntry): Promise<void>;
  deleteWorld(id: string): Promise<void>;
  codeTaken(code: string): Promise<boolean>;
}

export interface HubStore extends AccountStore, FriendStore, WorldStore {}

export type { WorldRole };
