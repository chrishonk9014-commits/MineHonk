/**
 * Join tickets: the hub's short-lived, signed word that a player is who they
 * say they are and may join a world. The host's browser checks the signature
 * with the hub's public key before letting anyone in, so a joiner cannot fake
 * their name, account or permission.
 *
 * Format: base64url(JSON claims) "." base64url(ECDSA P-256 / SHA-256 signature).
 */
import { fromB64url, toB64url, utf8 } from './crypto';

export type TicketVia = 'owner' | 'member' | 'friend' | 'public' | 'code';

export interface TicketClaims {
  v: 1;
  /** The joiner's account. */
  uuid: string;
  name: string;
  /** The world's hub id. */
  world: string;
  /** Expiry (ms since the epoch). */
  exp: number;
  /** Why they may join (friends of the owner, invited, the public list, a code). */
  via: TicketVia;
  /** Public joins never connect directly (nobody sees anyone's IP address). */
  relay: boolean;
}

export const TICKET_TTL_MS = 2 * 60 * 1000;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function generateTicketKeys(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const kp = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { privateJwk: (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey, publicJwk: (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey };
}

export function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ALG, false, ['sign']);
}

export function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const { kty, crv, x, y } = jwk;
  return crypto.subtle.importKey('jwk', { kty, crv, x, y }, ALG, false, ['verify']);
}

export async function signTicket(claims: TicketClaims, key: CryptoKey): Promise<string> {
  const body = utf8(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, body as Uint8Array<ArrayBuffer>));
  return `${toB64url(body)}.${toB64url(sig)}`;
}

function validClaims(c: unknown): c is TicketClaims {
  const t = c as Partial<TicketClaims>;
  return (
    !!t &&
    t.v === 1 &&
    typeof t.uuid === 'string' &&
    t.uuid.length <= 64 &&
    typeof t.name === 'string' &&
    t.name.length <= 32 &&
    typeof t.world === 'string' &&
    typeof t.exp === 'number' &&
    (t.via === 'owner' || t.via === 'member' || t.via === 'friend' || t.via === 'public' || t.via === 'code') &&
    typeof t.relay === 'boolean'
  );
}

/** The ticket's claims when its signature is good and it has not expired, else null. */
export async function verifyTicket(ticket: unknown, key: CryptoKey, now = Date.now()): Promise<TicketClaims | null> {
  if (typeof ticket !== 'string' || ticket.length > 2048) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  try {
    const body = fromB64url(ticket.slice(0, dot));
    const sig = fromB64url(ticket.slice(dot + 1));
    if (!(await crypto.subtle.verify(SIGN, key, sig as Uint8Array<ArrayBuffer>, body as Uint8Array<ArrayBuffer>))) return null;
    const claims = JSON.parse(new TextDecoder().decode(body)) as unknown;
    if (!validClaims(claims) || claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}
