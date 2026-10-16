/**
 * V7 phase 5: the cloud hub's daily limits on the haunting voices (D1):
 * one for everyone and every character together (HEROBRINE_DAILY_LIMIT, the
 * herobrine_usage table) and one per address (voice_address_usage), so a
 * single address cannot use up the day's answers for everyone. An address is
 * kept only as a hash of the day and the address (IPv6 by its /64 network),
 * which cannot be matched from one day to the next.
 */
import type { SqlDb } from './sqlStore';

/** Answers a day for one address, unless VOICE_ADDRESS_DAILY_LIMIT says otherwise. */
export const VOICE_ADDRESS_DAILY_LIMIT = 30;

/** The part of an address that names one household: IPv4 whole, IPv6 by its first four groups (/64). */
export function addressKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  // An IPv4 address written as IPv6 (::ffff:a.b.c.d) is that IPv4 address
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  const full = ip.toLowerCase().split('%')[0]!;
  const [head, tail = ''] = full.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = full.includes('::') ? [...a, ...new Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64';
}

/**
 * The salt for addressHash when the hub has no VOICE_SALT of its own: derived
 * one way from a secret it already holds (the API key), so the stored hashes
 * cannot be reversed by trying every address. The secret itself is never
 * stored, logged or sent anywhere.
 */
export async function derivedSalt(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`minehonk-voice-salt|${secret}`));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** A hash of the day and an address (hex): the same all day, unrelated to the next day's. */
export async function addressHash(day: string, ip: string, salt = ''): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${day}|${addressKey(ip)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Takes one of the day's answers for an address: 'ok', or 'limit' when this
 * address or everyone together has used up the day's. Each count is one
 * atomic statement, so requests at the same moment cannot both slip through.
 */
export async function takeVoiceAnswer(db: SqlDb, day: string, who: string, perAddress: number, everyone: number): Promise<'ok' | 'limit'> {
  const mine = await db.prepare('INSERT INTO voice_address_usage (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1 RETURNING n').bind(day, who).first<{ n: number }>();
  if (!mine || mine.n > perAddress) return 'limit';
  const all = await db.prepare('INSERT INTO herobrine_usage (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n').bind(day).first<{ n: number }>();
  if (!all || all.n > everyone) return 'limit';
  // Now and then, yesterday's counts go (nothing older is ever needed)
  if (mine.n === 1 && Math.random() < 0.05) await db.prepare('DELETE FROM voice_address_usage WHERE day < ?').bind(day).run();
  return 'ok';
}
