/**
 * Player accounts: unique names, salted password hashes and server-issued
 * session tokens (only their SHA-256 is stored). Repeated wrong passwords
 * lock the account briefly. How a password is hashed is up to the hosting
 * side (scrypt on the Node server, a hash of the device-stretched password on
 * the cloud hub), see PasswordHasher.
 */
import { validateUsername, type AccountInfo } from '../common/net/multiplayer';
import type { AccountStore, UserRecord } from './store';
import { randomBytes, randomUUID, sha256Hex, timingSafeEqual, toB64url, toHex, fromHex, fromB64url, pbkdf2, PREHASH_RE } from './crypto';

export const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILURES = 8;
const LOCK_MS = 10 * 60 * 1000;

export class AccountError extends Error {}

export interface PasswordHasher {
  /** An error message for an unacceptable password, or null. */
  validate(password: string): string | null;
  hash(password: string, salt: Uint8Array): Promise<Uint8Array>;
  readonly saltBytes: number;
}

/**
 * The cloud hub's hasher: the "password" it receives is already stretched on
 * the player's device (see stretchPassword), so a quick salted PBKDF2 round
 * (about 1 ms, inside the free plan's CPU limit) is enough to keep a stolen
 * database from being usable to sign in.
 */
export const deviceStretchedHasher: PasswordHasher = {
  saltBytes: 16,
  validate: (pw) => (PREHASH_RE.test(pw) ? null : 'Please refresh the page to update the game, then try again'),
  hash: (pw, salt) => pbkdf2(PREHASH_RE.test(pw) ? fromB64url(pw) : new Uint8Array(32), salt, 10_000, 32),
};

export function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

export class AccountsCore {
  constructor(
    readonly store: AccountStore,
    readonly hasher: PasswordHasher,
  ) {}

  async info(uuid: string): Promise<AccountInfo | null> {
    const u = await this.store.userByUuid(uuid);
    return u ? { uuid: u.uuid, name: u.name } : null;
  }

  async findByName(name: string): Promise<AccountInfo | null> {
    const u = await this.store.userByName(String(name).toLowerCase());
    return u ? { uuid: u.uuid, name: u.name } : null;
  }

  async register(name: string, password: string, nameFilter?: (n: string) => boolean): Promise<{ token: string; account: AccountInfo }> {
    const nameErr = validateUsername(name);
    if (nameErr) throw new AccountError(nameErr);
    const pwErr = this.hasher.validate(password);
    if (pwErr) throw new AccountError(pwErr);
    if (nameFilter && !nameFilter(name)) throw new AccountError('Please choose a different name');
    if (await this.store.userByName(name.toLowerCase())) throw new AccountError('That name is taken');
    const salt = randomBytes(this.hasher.saltBytes);
    const hash = await this.hasher.hash(password, salt);
    const uuid = randomUUID();
    const user: UserRecord = { uuid, name, salt: toHex(salt), hash: toHex(hash), createdAt: Date.now(), failures: 0, lockedUntil: 0 };
    // The store refuses a name taken meanwhile (two sign-ups racing for one name)
    if (!(await this.store.insertUser(user))) throw new AccountError('That name is taken');
    return { token: await this.newSession(uuid), account: { uuid, name } };
  }

  async login(name: string, password: string): Promise<{ token: string; account: AccountInfo }> {
    const u = await this.store.userByName(String(name).toLowerCase());
    // Hash anyway so timing does not reveal whether the name exists
    const hash = await this.hasher.hash(String(password), u ? fromHex(u.salt) : new Uint8Array(this.hasher.saltBytes));
    if (!u) throw new AccountError('Wrong name or password');
    if (u.lockedUntil > Date.now()) throw new AccountError('Too many attempts. Try again in a few minutes.');
    if (!timingSafeEqual(hash, fromHex(u.hash))) {
      const failures = u.failures + 1;
      if (failures >= MAX_FAILURES) await this.store.updateUser(u.uuid, { failures: 0, lockedUntil: Date.now() + LOCK_MS });
      else await this.store.updateUser(u.uuid, { failures });
      throw new AccountError('Wrong name or password');
    }
    if (u.failures) await this.store.updateUser(u.uuid, { failures: 0 });
    return { token: await this.newSession(u.uuid), account: { uuid: u.uuid, name: u.name } };
  }

  private async newSession(uuid: string): Promise<string> {
    const token = toB64url(randomBytes(32));
    await this.store.putSession(await tokenHash(token), { uuid, expires: Date.now() + SESSION_MS });
    await this.store.pruneSessions(Date.now());
    return token;
  }

  /** Account for a session token, or null. */
  async verify(token: string | null | undefined): Promise<AccountInfo | null> {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const s = await this.store.session(await tokenHash(token));
    if (!s || s.expires < Date.now()) return null;
    return this.info(s.uuid);
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteSession(await tokenHash(token));
  }
}
