/**
 * Player accounts on the Node server: the shared accounts core
 * (src/hub/accounts.ts) with scrypt password hashes, as always.
 */
import { scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { validatePassword } from '../common/net/multiplayer';
import { AccountsCore, AccountError, type PasswordHasher } from '../hub/accounts';
import type { AccountStore } from '../hub/store';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt over the NFKC form of the password (64-byte hashes, 16-byte salts). */
export const scryptHasher: PasswordHasher = {
  saltBytes: 16,
  validate: validatePassword,
  async hash(password, salt) {
    return new Uint8Array(await scrypt(password.normalize('NFKC'), Buffer.from(salt), 64, SCRYPT));
  },
};

export { AccountError };

export class Accounts extends AccountsCore {
  constructor(store: AccountStore) {
    super(store, scryptHasher);
  }
}
