/**
 * The world registry's rules: who may see and join a world, its roles, bans,
 * join code and settings. Shared by the Node server (which also runs the
 * worlds) and the cloud hub (where worlds run in their hosts' browsers).
 *
 * While a world is live its own settings win (the Node server's running
 * LevelData, a browser host's level): `hooks.live` supplies them, and
 * `hooks.changed` hears about every change made here.
 */
import { joinCodeFromBytes, normalizeJoinCode, type AccountInfo, type WorldDetails, type WorldRole, type WorldSummary, type WorldVisibility } from '../common/net/multiplayer';
import type { WorldEntry, WorldStore } from './store';
import type { AccountsCore } from './accounts';
import type { FriendsCore } from './friends';
import { randomBytes, toHex } from './crypto';

export class WorldError extends Error {}

export const MAX_WORLDS_PER_USER = 10;

/** A world's role for a player, or null when they may not join (pure: the caller supplies friendship). */
export function roleIn(e: WorldEntry, uuid: string, friendOfOwner: boolean): WorldRole | null {
  if (e.banned.includes(uuid)) return null;
  if (e.owner === uuid) return 'owner';
  if (e.operators.includes(uuid)) return 'operator';
  const explicit = e.roles[uuid];
  const invited = e.allowlist.includes(uuid) || explicit !== undefined;
  const friend = e.visibility !== 'private' && friendOfOwner;
  if (invited || friend || e.visibility === 'public') return explicit ?? e.defaultRole;
  return null;
}

/** Why `uuid` may not join, or null when allowed. */
export function joinDenied(e: WorldEntry, uuid: string, friendOfOwner: boolean): string | null {
  if (e.banned.includes(uuid)) return 'You are banned from this world.';
  if (!roleIn(e, uuid, friendOfOwner)) return 'This world is private. Ask the owner for a join code.';
  return null;
}

/** Whether a player is listed in the world (owner, operator, invited or given a role). */
export function isMember(e: WorldEntry, uuid: string): boolean {
  return e.owner === uuid || e.allowlist.includes(uuid) || e.operators.includes(uuid) || e.roles[uuid] !== undefined;
}

export interface FilterLike {
  mask(text: string): { changed: boolean };
}

export interface WorldsHooks {
  /** Settings of a live world (they win over the stored entry). */
  live?(id: string): Partial<WorldEntry> | null;
  /** Players in a world now. */
  players?(id: string): number;
  /** Extra listing fields (the cloud hub: online, host name, version). */
  extra?(id: string): Partial<WorldSummary> | null;
  /** After a change: apply it to the live world. */
  changed?(e: WorldEntry): void | Promise<void>;
}

export interface NewWorldInput {
  name?: unknown;
  mode?: unknown;
  visibility?: unknown;
  cheats?: unknown;
  pvp?: unknown;
  defaultRole?: unknown;
  maxPlayers?: unknown;
}

export class WorldsCore {
  constructor(
    readonly store: WorldStore,
    readonly accounts: AccountsCore,
    readonly friends: FriendsCore,
    readonly filter: FilterLike,
    readonly hooks: WorldsHooks = {},
    readonly opts: { maxPlayers?: number; maxPlayersCap?: number } = {},
  ) {}

  /** Current entry (live settings while running). */
  async access(id: string): Promise<WorldEntry | null> {
    const e = await this.store.world(id);
    if (!e) return null;
    const live = this.hooks.live?.(id);
    return live ? { ...e, ...live } : e;
  }

  /** The viewer's role, taking friendship and blocks into account. */
  async roleFor(e: WorldEntry, viewer: string): Promise<WorldRole | null> {
    if (e.owner !== viewer && (await this.friends.blockedEither(e.owner, viewer))) return null;
    return roleIn(e, viewer, e.visibility !== 'private' && (await this.friends.areFriends(e.owner, viewer)));
  }

  /** Why `viewer` may not join, or null. */
  async denied(e: WorldEntry, viewer: string): Promise<string | null> {
    if (e.banned.includes(viewer)) return 'You are banned from this world.';
    if (!(await this.roleFor(e, viewer))) return 'This world is private. Ask the owner for a join code.';
    return null;
  }

  async summary(e: WorldEntry, viewer: string, role?: WorldRole | null): Promise<WorldSummary> {
    return {
      id: e.id,
      name: e.name,
      owner: e.owner,
      ownerName: (await this.accounts.info(e.owner))?.name ?? 'unknown',
      visibility: e.visibility,
      mode: e.mode,
      players: this.hooks.players?.(e.id) ?? 0,
      maxPlayers: e.maxPlayers,
      role: role === undefined ? await this.roleFor(e, viewer) : role,
      ...(e.cheats !== undefined ? { cheats: e.cheats } : {}),
      ...(this.hooks.extra?.(e.id) ?? {}),
    };
  }

  async list(viewer: string): Promise<{ mine: WorldSummary[]; friends: WorldSummary[]; public: WorldSummary[] }> {
    const out = { mine: [] as WorldSummary[], friends: [] as WorldSummary[], public: [] as WorldSummary[] };
    const friends = new Set(await this.friends.list(viewer));
    const blocked = new Set(await this.friends.blocked(viewer));
    for (const stored of await this.store.candidates(viewer, [...friends])) {
      const live = this.hooks.live?.(stored.id);
      const e = live ? { ...stored, ...live } : stored;
      if (blocked.has(e.owner)) continue;
      const friend = friends.has(e.owner);
      const role = e.owner !== viewer && (await this.friends.store.isBlocked(e.owner, viewer)) ? null : roleIn(e, viewer, friend);
      if (!role) continue;
      const s = await this.summary(e, viewer, role);
      if (isMember(e, viewer)) out.mine.push(s);
      else if (e.visibility !== 'private' && friend) out.friends.push(s);
      else if (e.visibility === 'public') out.public.push(s);
    }
    const byPlayers = (a: WorldSummary, b: WorldSummary): number => b.players - a.players || a.name.localeCompare(b.name);
    out.mine.sort(byPlayers);
    out.friends.sort(byPlayers);
    out.public.sort(byPlayers);
    out.public = out.public.slice(0, 50);
    return out;
  }

  async details(id: string, viewer: string): Promise<WorldDetails | null> {
    const e = await this.access(id);
    if (!e) return null;
    const role = await this.roleFor(e, viewer);
    if (!role) return null;
    const d: WorldDetails = { ...(await this.summary(e, viewer, role)), pvp: e.pvp, defaultRole: e.defaultRole };
    if (role === 'owner' || role === 'operator') {
      d.joinCode = e.joinCode;
      d.announceAdmin = e.announceAdmin !== false;
      const ids = new Set([e.owner, ...e.operators, ...e.allowlist, ...Object.keys(e.roles)]);
      d.members = [];
      for (const uuid of ids) d.members.push({ uuid, name: (await this.accounts.info(uuid))?.name ?? 'unknown', role: roleIn(e, uuid, false) ?? 'visitor' });
    }
    return d;
  }

  // ------------------------------------------------------------------ management

  async newCode(): Promise<string> {
    for (;;) {
      const c = joinCodeFromBytes(randomBytes(8));
      if (!(await this.store.codeTaken(c))) return c;
    }
  }

  /** Validates a world name (null when acceptable). */
  checkName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim().slice(0, 48) : '';
    if (!name) throw new WorldError('Give your world a name');
    if (this.filter.mask(name).changed) throw new WorldError('Please choose a different world name');
    return name;
  }

  /** A new registry entry (not yet stored). */
  async newEntry(owner: AccountInfo, o: NewWorldInput, modes: readonly string[]): Promise<WorldEntry> {
    if ((await this.store.countOwned(owner.uuid)) >= MAX_WORLDS_PER_USER) throw new WorldError(`You can own up to ${MAX_WORLDS_PER_USER} worlds`);
    const name = this.checkName(o.name);
    const mode = modes.includes(o.mode as string) && o.mode !== 'spectator' ? (o.mode as string) : 'survival';
    const visibility: WorldVisibility = o.visibility === 'public' || o.visibility === 'friends' ? o.visibility : 'private';
    const cap = this.opts.maxPlayersCap ?? 16;
    const maxPlayers = typeof o.maxPlayers === 'number' && Number.isFinite(o.maxPlayers) ? Math.max(2, Math.min(cap, Math.floor(o.maxPlayers))) : (this.opts.maxPlayers ?? 16);
    return {
      id: toHex(randomBytes(8)),
      name,
      owner: owner.uuid,
      visibility,
      joinCode: await this.newCode(),
      allowlist: [],
      banned: [],
      operators: [owner.uuid],
      roles: {},
      defaultRole: o.defaultRole === 'visitor' ? 'visitor' : 'builder',
      pvp: o.pvp === true,
      mode,
      maxPlayers,
      createdAt: Date.now(),
      // The owner's choice; the Node server's old default was cheats in creative worlds
      cheats: typeof o.cheats === 'boolean' ? o.cheats : mode === 'creative',
      announceAdmin: true,
    };
  }

  async insert(e: WorldEntry): Promise<void> {
    await this.store.putWorld(e);
  }

  async requireManager(id: string, viewer: string, ownerOnly = false): Promise<WorldEntry> {
    const e = await this.access(id);
    if (!e) throw new WorldError('World not found');
    const role = await this.roleFor(e, viewer);
    if (role !== 'owner' && (ownerOnly || role !== 'operator')) throw new WorldError('Only the owner or operators can do that');
    return e;
  }

  /** Applies a change to the stored entry and to the live world. */
  async mutate(id: string, fn: (e: WorldEntry) => void): Promise<WorldEntry> {
    const e = await this.access(id);
    if (!e) throw new WorldError('World not found');
    fn(e);
    await this.store.putWorld(e);
    await this.hooks.changed?.(e);
    return e;
  }

  async update(id: string, viewer: string, patch: { name?: unknown; visibility?: unknown; pvp?: unknown; defaultRole?: unknown; cheats?: unknown; announceAdmin?: unknown; maxPlayers?: unknown }): Promise<WorldDetails> {
    const cur = await this.requireManager(id, viewer);
    const owner = cur.owner === viewer;
    if ((patch.cheats !== undefined || patch.announceAdmin !== undefined) && !owner) throw new WorldError('Only the owner can change cheats');
    const name = typeof patch.name === 'string' && patch.name.trim() ? this.checkName(patch.name) : null;
    await this.mutate(id, (e) => {
      if (name) e.name = name;
      if (patch.visibility === 'private' || patch.visibility === 'friends' || patch.visibility === 'public') e.visibility = patch.visibility;
      if (typeof patch.pvp === 'boolean') e.pvp = patch.pvp;
      if (patch.defaultRole === 'builder' || patch.defaultRole === 'visitor') e.defaultRole = patch.defaultRole;
      if (typeof patch.cheats === 'boolean') e.cheats = patch.cheats;
      if (typeof patch.announceAdmin === 'boolean') e.announceAdmin = patch.announceAdmin;
      if (typeof patch.maxPlayers === 'number' && Number.isFinite(patch.maxPlayers)) e.maxPlayers = Math.max(2, Math.min(this.opts.maxPlayersCap ?? 16, Math.floor(patch.maxPlayers)));
    });
    return (await this.details(id, viewer))!;
  }

  async regenerateCode(id: string, viewer: string, enabled = true): Promise<WorldDetails> {
    await this.requireManager(id, viewer);
    const code = enabled ? await this.newCode() : null;
    await this.mutate(id, (e) => {
      e.joinCode = code;
    });
    return (await this.details(id, viewer))!;
  }

  async setRole(id: string, viewer: string, target: string, role: unknown): Promise<WorldDetails> {
    const e = await this.requireManager(id, viewer);
    if (!(await this.accounts.info(target))) throw new WorldError('Player not found');
    if (target === e.owner) throw new WorldError("The owner's role cannot change");
    if (role === 'operator' && e.owner !== viewer) throw new WorldError('Only the owner can make operators');
    if (e.operators.includes(target) && e.owner !== viewer) throw new WorldError('Only the owner can change an operator');
    if (role !== 'operator' && role !== 'builder' && role !== 'visitor' && role !== 'remove') throw new WorldError('Unknown role');
    await this.mutate(id, (w) => {
      w.operators = w.operators.filter((u) => u !== target);
      if (role === 'operator') w.operators.push(target);
      else if (role === 'builder' || role === 'visitor') w.roles[target] = role;
      else {
        delete w.roles[target];
        w.allowlist = w.allowlist.filter((u) => u !== target);
      }
      if (role !== 'remove' && !w.allowlist.includes(target)) w.allowlist.push(target);
    });
    return (await this.details(id, viewer))!;
  }

  async ban(id: string, viewer: string, target: string, banned: boolean): Promise<WorldDetails> {
    const e = await this.requireManager(id, viewer);
    if (target === e.owner) throw new WorldError('The owner cannot be banned');
    if (e.operators.includes(target) && e.owner !== viewer) throw new WorldError('Only the owner can ban an operator');
    await this.mutate(id, (w) => {
      w.banned = w.banned.filter((u) => u !== target);
      if (banned) {
        w.banned.push(target);
        w.operators = w.operators.filter((u) => u !== target);
      }
    });
    return (await this.details(id, viewer))!;
  }

  async remove(id: string, viewer: string): Promise<void> {
    await this.requireManager(id, viewer, true);
    await this.store.deleteWorld(id);
  }

  /** Redeems a join code: the player is invited to the world. */
  async redeem(code: unknown, viewer: string): Promise<{ entry: WorldEntry; summary: WorldSummary }> {
    const c = normalizeJoinCode(String(code ?? ''));
    if (!c) throw new WorldError('Join codes look like ABC7-92KD');
    const stored = await this.store.worldByCode(c);
    const e = stored ? await this.access(stored.id) : null;
    if (!e || e.joinCode !== c) throw new WorldError('No world has that code');
    if (e.banned.includes(viewer)) throw new WorldError('You are banned from this world');
    if (e.owner !== viewer && (await this.friends.blockedEither(e.owner, viewer))) throw new WorldError('No world has that code');
    let entry = e;
    if (!(await this.roleFor(e, viewer)))
      entry = await this.mutate(e.id, (w) => {
        if (!w.allowlist.includes(viewer)) w.allowlist.push(viewer);
      });
    return { entry, summary: await this.summary(entry, viewer) };
  }
}
