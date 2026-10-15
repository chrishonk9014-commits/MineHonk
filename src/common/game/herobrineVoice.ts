/**
 * The Haunting: talking to Herobrine. From "He speaks" on, a player's chat
 * can get an answer. The game asks the cloud hub, which asks Claude
 * (src/hub/herobrineVoice.ts); when that is not there (offline, no key, the
 * day's limit reached, or an answer that fails the chat filter) his scripted
 * brain answers instead, from the same facts (hauntBrains.ts).
 *
 * V7 phase 4: the same pipeline for every character who can haunt a world
 * (Herobrine, Null, Green Steve, the Cave Dweller). A request names one of
 * them from the fixed list (Herobrine when it names nobody: requests from
 * before), the hub refuses any other, and each has its own way of speaking,
 * its own brain and (on the server only) its own instructions for Claude.
 * What comes back is only ever one cleaned line of chat: it is never read
 * for commands and never makes anything happen.
 *
 * Shared by the game server, the hub and the tests.
 */
import { HAUNT_CHARACTERS, type HauntCharacter } from './haunting';
import { BRAINS, brainReply } from './hauntBrains';

/** Who can be spoken to (a fixed list: anything else is refused). */
export type VoiceCharacter = HauntCharacter;
export const VOICE_CHARACTERS: readonly VoiceCharacter[] = HAUNT_CHARACTERS;

/** What Herobrine (or another character) is told about a line said to him. */
export interface VoiceRequest {
  /** V7 phase 4: who it was said to (Herobrine when not given). */
  character?: VoiceCharacter;
  /** Who said it (their name in the game; nothing else about them is ever sent). */
  player: string;
  message: string;
  /** The last lines of chat, oldest first (his own as from "Herobrine"). */
  history: { from: string; text: string }[];
  facts: VoiceFacts;
}

/** What he knows about the player who spoke (all optional). */
export interface VoiceFacts {
  /** The name of what they hold. */
  holding?: string;
  /** Health, 0..20. */
  health?: number;
  dimension?: string;
  biome?: string;
  night?: boolean;
  underground?: boolean;
  /** The other players in the world. */
  others?: string[];
  /** Times they died since the haunting began. */
  deaths?: number;
  x?: number;
  y?: number;
  z?: number;
  /** V7 phase 4: the haunting's stage (its name), so the answers grow with it. */
  stage?: string;
  /** What they have been doing in the last few minutes: blocks broken, blocks placed, torches placed. */
  broken?: number;
  placed?: number;
  torches?: number;
  /** They slept since it began; they are running now. */
  slept?: boolean;
  running?: boolean;
}

export const VOICE_LIMITS = { name: 24, message: 200, history: 8, line: 200, others: 8, fact: 40, reply: 90 } as const;

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);

/**
 * A request as it arrives at the hub: anything malformed is dropped, everything
 * is clamped, and only the facts listed above get through. A character that
 * is not on the list makes the whole request invalid.
 */
export function parseVoiceRequest(v: unknown): VoiceRequest | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  let character: VoiceCharacter = 'herobrine';
  if (o.character !== undefined) {
    if (typeof o.character !== 'string' || !VOICE_CHARACTERS.includes(o.character as VoiceCharacter)) return null;
    character = o.character as VoiceCharacter;
  }
  const player = str(o.player, VOICE_LIMITS.name);
  const message = str(o.message, VOICE_LIMITS.message);
  if (!player || !message) return null;
  const history = (Array.isArray(o.history) ? o.history : [])
    .slice(-VOICE_LIMITS.history)
    .map((h) => {
      const from = str((h as { from?: unknown })?.from, VOICE_LIMITS.name);
      const text = str((h as { text?: unknown })?.text, VOICE_LIMITS.line);
      return from && text ? { from, text } : null;
    })
    .filter((h): h is { from: string; text: string } => !!h);
  const f = (o.facts && typeof o.facts === 'object' ? o.facts : {}) as Record<string, unknown>;
  const facts: VoiceFacts = {
    holding: str(f.holding, VOICE_LIMITS.fact),
    health: num(f.health, 0, 1000),
    dimension: str(f.dimension, VOICE_LIMITS.fact),
    biome: str(f.biome, VOICE_LIMITS.fact),
    night: typeof f.night === 'boolean' ? f.night : undefined,
    underground: typeof f.underground === 'boolean' ? f.underground : undefined,
    others: Array.isArray(f.others) ? f.others.map((n) => str(n, VOICE_LIMITS.name)).filter((n): n is string => !!n).slice(0, VOICE_LIMITS.others) : undefined,
    deaths: num(f.deaths, 0, 9999),
    x: num(f.x, -30_000_000, 30_000_000),
    y: num(f.y, -64, 512),
    z: num(f.z, -30_000_000, 30_000_000),
    stage: str(f.stage, VOICE_LIMITS.fact),
    broken: num(f.broken, 0, 9999),
    placed: num(f.placed, 0, 9999),
    torches: num(f.torches, 0, 9999),
    slept: typeof f.slept === 'boolean' ? f.slept : undefined,
    running: typeof f.running === 'boolean' ? f.running : undefined,
  };
  return { character, player, message, history, facts };
}

/** How each of them writes. */
export const VOICE_STYLE: Readonly<Record<VoiceCharacter, 'capitals' | 'lowercase' | 'plain' | 'whisper'>> = {
  herobrine: 'capitals',
  null: 'lowercase',
  green_steve: 'plain',
  cave_dweller: 'whisper',
};

/** The name its lines come from in chat (and that Claude may put in front of an answer). */
export const VOICE_SPEAKER: Readonly<Record<VoiceCharacter, string>> = {
  herobrine: 'Herobrine',
  null: 'null',
  green_steve: 'Green Steve',
  cave_dweller: 'Cave Dweller',
};

/**
 * An answer as it may appear in chat: one line, no quotes or "Herobrine:" in
 * front, short, written the character's way (Herobrine in capitals, Null in
 * lowercase, the Cave Dweller in ...whispers...). Null when nothing usable is
 * left. It is only ever shown as chat: a leading slash is dropped so it
 * cannot even look like a command.
 */
export function cleanVoiceLine(text: string | null | undefined, character: VoiceCharacter = 'herobrine'): string | null {
  if (!text) return null;
  const who = VOICE_SPEAKER[character].toLowerCase().replace(/[^a-z ]/g, '');
  const prefix = new RegExp(`^\\s*(<\\s*(${who}|herobrine)\\s*>|(${who}|herobrine)\\s*:)\\s*`, 'i');
  let line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  line = line
    .replace(prefix, '')
    .replace(/[*_`~#]/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/\\]+/, '')
    .trim();
  const style = VOICE_STYLE[character];
  if (style === 'capitals') line = line.toUpperCase();
  else if (style === 'lowercase') line = line.toLowerCase();
  else if (style === 'whisper') line = line.toLowerCase().replace(/^[.\s]+|[.\s]+$/g, '');
  const max = VOICE_LIMITS.reply - (style === 'whisper' ? 6 : 0);
  if (line.length > max) {
    const cut = line.slice(0, max);
    line = (cut.lastIndexOf(' ') > 40 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim();
  }
  if (!/[A-Za-z0-9]/.test(line)) return null;
  return style === 'whisper' ? `...${line}...` : line;
}

// ------------------------------------------------------------------ the scripted brain

/**
 * The answer without the hub, from the character's own scripted brain
 * (hauntBrains.ts): matched to what was said, or something that shows it knows.
 */
export function scriptedReply(req: VoiceRequest, rnd: () => number = Math.random): string {
  return brainReply(BRAINS[req.character ?? 'herobrine'], req, rnd);
}

/** An answer as the hub gives it: the line, or null and why not (off, busy, limit, unsaid, unreachable). */
export interface VoiceAnswer {
  text: string | null;
  reason?: string;
}

/**
 * Asks the cloud hub for an answer, and why there is none when there is not.
 * Herobrine is asked at /api/herobrine (as he always was); the others at
 * /api/voice, which takes the character from the request.
 */
export async function askHubDetail(hubUrl: string, req: VoiceRequest, timeoutMs = 9000): Promise<VoiceAnswer> {
  if (!hubUrl) return { text: null, reason: 'off' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  const path = (req.character ?? 'herobrine') === 'herobrine' ? 'herobrine' : 'voice';
  try {
    const r = await fetch(`${hubUrl.replace(/\/$/, '')}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: ctl?.signal });
    if (!r.ok) return { text: null, reason: r.status === 429 ? 'busy' : 'refused' };
    const d = (await r.json()) as { text?: unknown; reason?: unknown };
    return typeof d.text === 'string' ? { text: d.text } : { text: null, reason: typeof d.reason === 'string' ? d.reason.slice(0, 20) : 'none' };
  } catch {
    return { text: null, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the cloud hub for an answer (null when the hub cannot or will not). */
export async function askHub(hubUrl: string, req: VoiceRequest, timeoutMs = 9000): Promise<string | null> {
  return (await askHubDetail(hubUrl, req, timeoutMs)).text;
}
