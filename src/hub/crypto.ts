/**
 * Small crypto helpers on WebCrypto, so the same hub code runs in Node, in
 * Cloudflare Workers and in browsers.
 */

const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toB64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s) as Uint8Array<ArrayBuffer>)));
}

/** Compares two byte strings in time independent of where they differ. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function pbkdf2(secret: Uint8Array, salt: Uint8Array, iterations: number, bytes = 32): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', secret as Uint8Array<ArrayBuffer>, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// Passwords stretched on the player's device (the cloud hub's sign-in)
// ---------------------------------------------------------------------------

/**
 * The cloud hub never sees a password: the game stretches it on the player's
 * device first (PBKDF2-SHA256, 600,000 rounds, salted with the site and the
 * name), and the hub stores a salted hash of the result. A stolen hub
 * database therefore costs an attacker the full stretch for every guess.
 */
export const DEVICE_STRETCH_ROUNDS = 600_000;
export const PREHASH_RE = /^[A-Za-z0-9_-]{43}$/;

export async function stretchPassword(name: string, password: string, rounds = DEVICE_STRETCH_ROUNDS): Promise<string> {
  const salt = utf8(`minehonk-hub-v1|${name.toLowerCase()}`);
  return toB64url(await pbkdf2(utf8(password.normalize('NFKC')), salt, rounds, 32));
}
