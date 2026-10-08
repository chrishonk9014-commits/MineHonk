/**
 * The hub's shared rules (accounts, friends and blocks, the world registry,
 * join codes, visibility and roles), run on both storage backends: the Node
 * server's JSON files and the cloud hub's SQL (on Node's SQLite, shaped like
 * Cloudflare D1).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { AccountsCore, AccountError, deviceStretchedHasher, type PasswordHasher } from '../../src/hub/accounts';
import { FriendsCore, FriendError } from '../../src/hub/friends';
import { WorldsCore, WorldError, roleIn } from '../../src/hub/worlds';
import { SqlHubStore } from '../../src/hub/sqlStore';
import type { HubStore } from '../../src/hub/store';
import { stretchPassword, PREHASH_RE, sha256Hex, toHex } from '../../src/hub/crypto';
import { HubFileStore } from '../../src/server-node/HubFileStore';
import { scryptHasher } from '../../src/server-node/Accounts';
import { normalizeJoinCode } from '../../src/common/net/multiplayer';
import { sqliteD1 } from '../helpers/sqliteD1';

/** A quick hasher for the rule tests (the real ones are tested on their own below). */
const quickHasher: PasswordHasher = {
  saltBytes: 8,
  validate: (pw) => (pw.length >= 8 ? null : 'Passwords need at least 8 characters'),
  hash: async (pw, salt) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(toHex(salt) + pw))),
};

const noFilter = { mask: (t: string) => ({ changed: /badword/i.test(t) }) };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const backends: [string, () => Promise<HubStore>][] = [
  [
    'file storage',
    async () => {
      const d = mkdtempSync(path.join(tmpdir(), 'hubcore-'));
      dirs.push(d);
      return HubFileStore.open(d, () => {});
    },
  ],
  ['SQL storage', async () => new SqlHubStore(sqliteD1())],
];

for (const [label, make] of backends) {
  describe(`hub core on ${label}`, () => {
    let store: HubStore;
    let accounts: AccountsCore;
    let friends: FriendsCore;
    let worlds: WorldsCore;
    const live = new Map<string, number>();
    const reg = async (name: string): Promise<{ uuid: string; name: string; token: string }> => {
      const r = await accounts.register(name, 'correct horse');
      return { ...r.account, token: r.token };
    };
    beforeEach(async () => {
      store = await make();
      accounts = new AccountsCore(store, quickHasher);
      friends = new FriendsCore(store);
      worlds = new WorldsCore(store, accounts, friends, noFilter, { players: (id) => live.get(id) ?? 0 }, { maxPlayers: 8, maxPlayersCap: 16 });
    });

    it('registers, signs in, locks after repeated wrong passwords and keeps sessions', async () => {
      const a = await accounts.register('Alice', 'correct horse');
      expect(a.account.name).toBe('Alice');
      await expect(accounts.register('alice', 'another one')).rejects.toThrow(/taken/);
      await expect(accounts.register('al', 'correct horse')).rejects.toThrow(AccountError);
      await expect(accounts.register('admin', 'correct horse')).rejects.toThrow(/reserved/);
      await expect(accounts.register('Bob', 'short')).rejects.toThrow(/8 characters/);
      await expect(accounts.register('BadWordGuy', 'correct horse', (n) => !noFilter.mask(n).changed)).rejects.toThrow(/different name/);
      expect(await accounts.verify(a.token)).toEqual(a.account);
      expect(await accounts.verify('nope')).toBeNull();
      const again = await accounts.login('ALICE', 'correct horse');
      expect(again.account.uuid).toBe(a.account.uuid);
      for (let i = 0; i < 7; i++) await expect(accounts.login('alice', 'wrong password')).rejects.toThrow(/Wrong name or password/);
      await expect(accounts.login('alice', 'wrong password')).rejects.toThrow(/Wrong/);
      // Locked now, even with the right password
      await expect(accounts.login('alice', 'correct horse')).rejects.toThrow(/Too many attempts/);
      await expect(accounts.login('nobody', 'correct horse')).rejects.toThrow(/Wrong name or password/);
      await accounts.logout(a.token);
      expect(await accounts.verify(a.token)).toBeNull();
      expect(await accounts.verify(again.token)).not.toBeNull();
      // Only a hash of the token is stored
      expect(await store.session(again.token)).toBeNull();
      expect(await store.session(await sha256Hex(again.token))).not.toBeNull();
    });

    it('handles friend requests, mutual requests, removal and blocks', async () => {
      const a = await reg('Alice');
      const b = await reg('Bobby');
      const c = await reg('Carol');
      expect(await friends.request(a.uuid, b.uuid)).toBe('sent');
      await expect(friends.request(a.uuid, b.uuid)).rejects.toThrow(/already sent/);
      await expect(friends.request(a.uuid, a.uuid)).rejects.toThrow(FriendError);
      expect(await friends.incoming(b.uuid)).toEqual([a.uuid]);
      expect(await friends.outgoing(a.uuid)).toEqual([b.uuid]);
      // Asking back accepts
      expect(await friends.request(b.uuid, a.uuid)).toBe('accepted');
      expect(await friends.areFriends(a.uuid, b.uuid)).toBe(true);
      expect(await friends.list(b.uuid)).toEqual([a.uuid]);
      await expect(friends.request(a.uuid, b.uuid)).rejects.toThrow(/Already friends/);
      await friends.request(c.uuid, a.uuid);
      await friends.decline(a.uuid, c.uuid);
      expect(await friends.incoming(a.uuid)).toEqual([]);
      await friends.remove(a.uuid, b.uuid);
      expect(await friends.areFriends(b.uuid, a.uuid)).toBe(false);
      // Blocking: friendship and requests go, and the blocked player cannot tell
      await friends.request(c.uuid, a.uuid);
      await friends.request(a.uuid, b.uuid);
      await friends.accept(b.uuid, a.uuid);
      await friends.block(a.uuid, b.uuid);
      await friends.block(a.uuid, c.uuid);
      expect(await friends.areFriends(a.uuid, b.uuid)).toBe(false);
      expect(await friends.incoming(a.uuid)).toEqual([]);
      expect(await friends.request(b.uuid, a.uuid)).toBe('sent');
      expect(await friends.incoming(a.uuid)).toEqual([]);
      await expect(friends.request(a.uuid, b.uuid)).rejects.toThrow(/Unblock/);
      expect((await friends.blocked(a.uuid)).sort()).toEqual([b.uuid, c.uuid].sort());
      await friends.unblock(a.uuid, b.uuid);
      expect(await friends.blocked(a.uuid)).toEqual([c.uuid]);
      expect(await friends.blockedEither(c.uuid, a.uuid)).toBe(true);
    });

    it('keeps the world registry: visibility, roles, codes, bans and cheats', async () => {
      const owner = await reg('Olivia');
      const friend = await reg('Friend');
      const stranger = await reg('Stranger');
      const op = await reg('Oppy');
      await friends.request(owner.uuid, friend.uuid);
      await friends.accept(friend.uuid, owner.uuid);
      const e = await worlds.newEntry(owner, { name: 'Castle', mode: 'survival', visibility: 'private', cheats: true, maxPlayers: 99 }, ['survival', 'creative']);
      expect(e.maxPlayers).toBe(16);
      expect(e.cheats).toBe(true);
      expect(normalizeJoinCode(e.joinCode!)).toBe(e.joinCode);
      await worlds.insert(e);
      await expect(worlds.newEntry(owner, { name: 'badword land' }, ['survival'])).rejects.toThrow(WorldError);
      expect((await worlds.newEntry(owner, { name: 'Sandbox', mode: 'creative' }, ['survival', 'creative'])).cheats).toBe(true);
      expect((await worlds.newEntry(owner, { name: 'Plain' }, ['survival'])).cheats).toBe(false);

      // Private: only the owner sees it
      expect((await worlds.list(owner.uuid)).mine.map((w) => w.name)).toEqual(['Castle']);
      expect((await worlds.list(friend.uuid)).friends).toEqual([]);
      expect(await worlds.details(e.id, stranger.uuid)).toBeNull();
      // Friends visibility: friends of the owner may join, strangers may not
      await worlds.update(e.id, owner.uuid, { visibility: 'friends' });
      expect((await worlds.list(friend.uuid)).friends.map((w) => w.name)).toEqual(['Castle']);
      expect((await worlds.list(stranger.uuid)).public).toEqual([]);
      expect(await worlds.roleFor((await worlds.access(e.id))!, friend.uuid)).toBe('builder');
      // Public: anyone, with the default role
      await worlds.update(e.id, owner.uuid, { visibility: 'public', defaultRole: 'visitor' });
      live.set(e.id, 3);
      const pub = (await worlds.list(stranger.uuid)).public;
      expect(pub.map((w) => [w.name, w.players, w.role, w.cheats])).toEqual([['Castle', 3, 'visitor', true]]);
      // Join code only for managers
      expect((await worlds.details(e.id, stranger.uuid))!.joinCode).toBeUndefined();
      expect((await worlds.details(e.id, owner.uuid))!.joinCode).toBe(e.joinCode);

      // Roles: only the owner makes operators; operators manage everyone else
      await expect(worlds.setRole(e.id, stranger.uuid, op.uuid, 'operator')).rejects.toThrow(WorldError);
      await worlds.setRole(e.id, owner.uuid, op.uuid, 'operator');
      expect(await worlds.roleFor((await worlds.access(e.id))!, op.uuid)).toBe('operator');
      await expect(worlds.setRole(e.id, op.uuid, stranger.uuid, 'operator')).rejects.toThrow(/Only the owner/);
      await worlds.setRole(e.id, op.uuid, stranger.uuid, 'builder');
      expect(await worlds.roleFor((await worlds.access(e.id))!, stranger.uuid)).toBe('builder');
      await expect(worlds.setRole(e.id, op.uuid, owner.uuid, 'visitor')).rejects.toThrow(/owner's role/);
      // Cheats are the owner's choice alone
      await expect(worlds.update(e.id, op.uuid, { cheats: false })).rejects.toThrow(/Only the owner/);
      expect((await worlds.update(e.id, owner.uuid, { cheats: false, announceAdmin: false })).cheats).toBe(false);

      // Codes: a new one replaces the old, redeeming invites, a banned player cannot redeem
      await worlds.update(e.id, owner.uuid, { visibility: 'private' });
      const d = await worlds.regenerateCode(e.id, owner.uuid);
      expect(d.joinCode).not.toBe(e.joinCode);
      await expect(worlds.redeem(e.joinCode, stranger.uuid)).rejects.toThrow(/No world has that code/);
      await expect(worlds.redeem('nonsense', stranger.uuid)).rejects.toThrow(/look like/);
      const late = await reg('Latecomer');
      const r = await worlds.redeem(d.joinCode!.toLowerCase().replace('-', ' '), late.uuid);
      expect(r.summary.role).toBe('visitor');
      expect((await worlds.list(late.uuid)).mine.map((w) => w.name)).toEqual(['Castle']);
      await worlds.ban(e.id, owner.uuid, late.uuid, true);
      expect(await worlds.roleFor((await worlds.access(e.id))!, late.uuid)).toBeNull();
      await expect(worlds.redeem(d.joinCode, late.uuid)).rejects.toThrow(/banned/);
      await expect(worlds.ban(e.id, op.uuid, owner.uuid, true)).rejects.toThrow(/owner cannot be banned/);
      // Blocking the owner hides their worlds; the owner blocking you keeps you out
      await friends.block(owner.uuid, friend.uuid);
      await worlds.update(e.id, owner.uuid, { visibility: 'public' });
      expect((await worlds.list(friend.uuid)).public).toEqual([]);
      expect(await worlds.details(e.id, friend.uuid)).toBeNull();
      await expect(worlds.redeem(d.joinCode, friend.uuid)).rejects.toThrow(/No world has that code/);
      // Only the owner deletes
      await expect(worlds.remove(e.id, op.uuid)).rejects.toThrow(WorldError);
      await worlds.remove(e.id, owner.uuid);
      expect(await worlds.access(e.id)).toBeNull();
    });
  });
}

describe('role rules', () => {
  it('follow visibility, invitations and explicit roles', () => {
    const base = { id: 'w', name: 'W', owner: 'o', joinCode: null, allowlist: [] as string[], banned: [] as string[], operators: ['o'], roles: {} as Record<string, 'builder' | 'visitor'>, defaultRole: 'builder' as const, pvp: false, mode: 'survival', maxPlayers: 8, createdAt: 0 };
    expect(roleIn({ ...base, visibility: 'private' }, 'x', true)).toBeNull();
    expect(roleIn({ ...base, visibility: 'friends' }, 'x', true)).toBe('builder');
    expect(roleIn({ ...base, visibility: 'friends' }, 'x', false)).toBeNull();
    expect(roleIn({ ...base, visibility: 'public' }, 'x', false)).toBe('builder');
    expect(roleIn({ ...base, visibility: 'private', allowlist: ['x'] }, 'x', false)).toBe('builder');
    expect(roleIn({ ...base, visibility: 'private', roles: { x: 'visitor' } }, 'x', false)).toBe('visitor');
    expect(roleIn({ ...base, visibility: 'public', banned: ['x'] }, 'x', true)).toBeNull();
    expect(roleIn({ ...base, visibility: 'private' }, 'o', false)).toBe('owner');
  });
});

describe('password hashers', () => {
  it('the Node server keeps scrypt', async () => {
    const salt = new Uint8Array(16);
    const h = await scryptHasher.hash('correct horse', salt);
    expect(h.length).toBe(64);
    expect(scryptHasher.validate('short')).toMatch(/8 characters/);
  });

  it('the cloud hub only ever sees a device-stretched password', async () => {
    const stretched = await stretchPassword('Alice', 'correct horse', 1000);
    expect(PREHASH_RE.test(stretched)).toBe(true);
    // Salted by the name: the same password stretches differently for another player
    expect(await stretchPassword('Bob', 'correct horse', 1000)).not.toBe(stretched);
    expect(await stretchPassword('ALICE', 'correct horse', 1000)).toBe(stretched);
    expect(deviceStretchedHasher.validate('correct horse')).toMatch(/refresh/);
    expect(deviceStretchedHasher.validate(stretched)).toBeNull();
    const store = new SqlHubStore(sqliteD1());
    const accounts = new AccountsCore(store, deviceStretchedHasher);
    const r = await accounts.register('Alice', stretched);
    await expect(accounts.register('Mallory', 'plain password')).rejects.toThrow(/refresh/);
    expect((await accounts.login('alice', stretched)).account.uuid).toBe(r.account.uuid);
    await expect(accounts.login('alice', await stretchPassword('Alice', 'wrong horse', 1000))).rejects.toThrow(/Wrong/);
    // What is stored is neither the password nor the stretched value
    const row = await store.userByName('alice');
    expect(row!.hash).not.toContain(stretched);
    expect(row!.hash.length).toBe(64);
  });
});
