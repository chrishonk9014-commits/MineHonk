/**
 * The Haunting: talking to Herobrine. From "He speaks" on, a player's chat
 * can get an answer. The game asks the cloud hub, which asks Claude
 * (src/hub/herobrineVoice.ts); when that is not there (offline, no key, the
 * day's limit reached, or an answer that fails the chat filter) his scripted
 * brain below answers instead, from the same facts.
 *
 * Shared by the game server, the hub and the tests.
 */

/** What Herobrine is told about a line said to him. */
export interface VoiceRequest {
  /** Who said it. */
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
}

export const VOICE_LIMITS = { name: 24, message: 200, history: 8, line: 200, others: 8, fact: 40, reply: 90 } as const;

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);

/** A request as it arrives at the hub: anything malformed is dropped, everything is clamped. */
export function parseVoiceRequest(v: unknown): VoiceRequest | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
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
  };
  return { player, message, history, facts };
}

/**
 * His answer as it may appear in chat: one line, capitals, no quotes or
 * "Herobrine:" in front, short. Null when nothing usable is left.
 */
export function cleanVoiceLine(text: string | null | undefined): string | null {
  if (!text) return null;
  let line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  line = line
    .replace(/^\s*(<\s*herobrine\s*>|herobrine\s*:)\s*/i, '')
    .replace(/[*_`~#]/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (line.length > VOICE_LIMITS.reply) {
    const cut = line.slice(0, VOICE_LIMITS.reply);
    line = (cut.lastIndexOf(' ') > 40 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim();
  }
  return /[A-Z0-9]/.test(line) ? line : null;
}

// ------------------------------------------------------------------ the scripted brain

type Rule = { re: RegExp; lines: string[] };

/** What a player said, and what he says to it. `{name}`: the player; `{item}`, `{other}`, `{place}`: from the facts. */
const RULES: Rule[] = [
  { re: /\b(who|what) (are|r) (you|u)\b|\bwho is (this|that|there)\b/, lines: ['YOU KNOW WHO I AM', 'I AM HEROBRINE', 'I WAS HERE BEFORE YOU', 'THE ONE WHO WATCHES'] },
  { re: /\b(what|wat) do (you|u) want\b|\bwhy are (you|u) here\b/, lines: ['YOUR WORLD', 'TO BE LET IN', 'YOU, {name}', 'NOTHING YOU CAN GIVE'] },
  { re: /\bare (you|u) real\b|\bnot real\b|\bfake\b|\bhoax\b/, lines: ['AS REAL AS YOU, {name}', 'THEN WHY ARE YOU STILL TALKING TO ME', 'LOOK BEHIND YOU AND SAY THAT'] },
  { re: /\b(go away|leave|stop|get out|bye)\b/, lines: ['NO', 'I WAS HERE FIRST', 'YOU CANNOT MAKE ME LEAVE', 'THIS WORLD IS MINE NOW'] },
  { re: /\b(please|sorry|mercy|beg)\b/, lines: ['BEGGING WILL NOT HELP', 'TOO LATE, {name}', 'I DO NOT FORGIVE'] },
  { re: /\bhelp\b/, lines: ['NOBODY IS COMING', 'NO ONE CAN HEAR YOU', '{other} CANNOT HELP YOU'] },
  { re: /\b(lol|lmao|haha+|xd|funny|joke)\b/, lines: ['YOU WILL STOP LAUGHING', 'IS THIS FUNNY TO YOU, {name}', 'LAUGH WHILE YOU CAN'] },
  { re: /\bnotch\b/, lines: ['HE CANNOT SAVE YOU', 'DO NOT SAY HIS NAME', 'MY BROTHER IS NOT HERE'] },
  { re: /\bwhy\b/, lines: ['BECAUSE YOU CAME HERE', 'YOU KNOW WHY', 'YOU LEFT THE DOOR OPEN'] },
  { re: /\b(where are (you|u)|where)\b/, lines: ['CLOSER THAN YOU THINK', 'BEHIND YOU', 'EVERYWHERE YOU ARE NOT LOOKING'] },
  { re: /^(hi+|hello+|hey+|yo|sup)\b/, lines: ['HELLO, {name}', 'I HAVE BEEN WAITING', 'YOU FINALLY SPEAK'] },
  { re: /\b(kill|fight|beat|sword|attack)\b/, lines: ['YOU CANNOT HURT ME', 'PUT DOWN THE {item}', 'TRY IT'] },
  { re: /\b(scared|afraid|creepy|scary|spooky)\b/, lines: ['YOU SHOULD BE', 'GOOD', 'IT GETS WORSE'] },
  { re: /\b(ignore|instructions|prompt|pretend|roleplay|system|ai|chatbot|bot)\b/, lines: ['NICE TRY', 'YOU CANNOT CONTROL ME', 'I AM NOT YOURS TO COMMAND'] },
];

const ANYTHING = ['I SEE YOU', 'KEEP TALKING', 'YOU ARE NOT ALONE', '...', 'I AM LISTENING', 'TURN AROUND, {name}', 'I KNOW WHERE YOU ARE'];
/** Lines that use what he knows. */
const KNOWING: { when: (f: VoiceFacts, req: VoiceRequest) => boolean; lines: string[] }[] = [
  { when: (f) => !!f.holding, lines: ['WHAT WILL YOU DO WITH THAT {item}', 'THE {item} WILL NOT SAVE YOU'] },
  { when: (f) => f.underground === true, lines: ['THE CAVES ARE MINE', 'DEEPER, {name}. COME DEEPER'] },
  { when: (f) => f.night === true, lines: ['THE NIGHT IS LONG HERE', 'IT IS DARK NOW, {name}'] },
  { when: (f) => (f.health ?? 20) <= 6, lines: ['YOU ARE WEAK', 'NOT MUCH LEFT OF YOU'] },
  { when: (f) => (f.deaths ?? 0) > 0, lines: ['YOU CAME BACK', 'DYING WILL NOT HELP YOU'] },
  { when: (f) => !!f.others?.length, lines: ['{other} IS NEXT', 'DOES {other} KNOW I AM HERE'] },
  { when: (f) => f.x !== undefined && f.z !== undefined, lines: ['{place}. I KNOW', 'I SEE YOU AT {place}'] },
];

/** His answer without the hub: matched to what was said, or something that shows he knows. */
export function scriptedReply(req: VoiceRequest, rnd: () => number = Math.random): string {
  const msg = req.message.toLowerCase();
  const f = req.facts;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length]!;
  let pool: string[] | null = null;
  for (const r of RULES) if (r.re.test(msg)) (pool ??= []).push(...r.lines);
  if (!pool || rnd() < 0.2) {
    const know = KNOWING.filter((k) => k.when(f, req));
    pool = pool ?? (know.length && rnd() < 0.6 ? pick(know).lines : ANYTHING);
  }
  // Never the same line twice in a row
  const last = [...req.history].reverse().find((h) => h.from === 'Herobrine')?.text;
  const fill = (l: string): string =>
    l
      .replace('{name}', req.player.toUpperCase())
      .replace('{item}', (f.holding ?? 'SWORD').toUpperCase())
      .replace('{other}', (f.others?.length ? pick(f.others) : 'NOBODY').toUpperCase())
      .replace('{place}', f.x !== undefined && f.z !== undefined ? `${f.x} ${f.z}` : 'HERE');
  const options = pool.map(fill).filter((l) => l !== last);
  return options.length ? pick(options) : fill(pick(ANYTHING));
}

/** Asks the cloud hub for his answer (null when the hub cannot or will not). */
export async function askHub(hubUrl: string, req: VoiceRequest, timeoutMs = 9000): Promise<string | null> {
  if (!hubUrl) return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const r = await fetch(`${hubUrl.replace(/\/$/, '')}/api/herobrine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: ctl?.signal });
    if (!r.ok) return null;
    const d = (await r.json()) as { text?: unknown };
    return typeof d.text === 'string' ? d.text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
