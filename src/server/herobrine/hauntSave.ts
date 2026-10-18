/**
 * V7 phase 5: what a world keeps of hauntings (level.flags.haunt, hauntBlocks,
 * autoHaunt), read back safely. Anything malformed is dropped or cut back to
 * what a real haunting could have written, so a damaged (or hand-edited)
 * save can never stop the server's tick or write invalid blocks.
 */
import { HAUNT_CHARACTERS, HAUNT_MAX_MINUTES, AUTO_HAUNT_DELAY_MIN, AUTO_HAUNT_DELAY_MAX, type AutoHauntRoll, type HauntCharacter } from '../../common/game/haunting';
import { castEnding } from '../../common/game/hauntCast';
import { STATE_BLOCK } from '../../common/registry/blocks';
import type { HauntState } from './haunts/types';

/**
 * At most this many recorded block changes: the haunting makes no change it
 * could not record (its random events already stop at 4,000; an ending may
 * take it further, Null's most of all, never past this).
 */
export const HAUNT_MAX_CHANGES = 12000;
const DIMS = ['overworld', 'nether', 'end', 'farlands', 'computer'];
/** The longest a haunting can be once the panel moved its end (ticks). */
const MAX_TOTAL = 4 * HAUNT_MAX_MINUTES * 60 * 20;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeKey = (k: string): boolean => /^[\w.:@-]{1,64}$/.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';

/** A running haunting's state, or null when it cannot be one. */
export function sanitizeHauntState(raw: unknown): HauntState | null {
  if (!plain(raw)) return null;
  const total = raw.total;
  if (!finite(total) || total <= 0) return null;
  const st: HauntState = {
    t: Math.max(0, Math.min(Math.floor(Math.min(total, MAX_TOTAL)), finite(raw.t) ? Math.floor(raw.t) : 0)),
    total: Math.max(1, Math.floor(Math.min(total, MAX_TOTAL))),
    erase: raw.erase === true,
    by: typeof raw.by === 'string' && raw.by.length <= 64 ? raw.by : 'unknown',
    done: Array.isArray(raw.done) ? [...new Set(raw.done.filter((d): d is string => typeof d === 'string' && d.length <= 96))].slice(0, 512) : [],
  };
  const c = typeof raw.char === 'string' && (HAUNT_CHARACTERS as readonly string[]).includes(raw.char) ? (raw.char as HauntCharacter) : 'herobrine';
  // (V7.1: always named, several may be running)
  st.char = c;
  if (typeof raw.ending === 'string' && castEnding(c, raw.ending)) st.ending = raw.ending;
  if (typeof raw.final === 'string' && castEnding(c, raw.final)) st.final = raw.final;
  if (finite(raw.said)) st.said = Math.max(0, Math.min(1e6, Math.floor(raw.said)));
  const sky = raw.sky;
  if (plain(sky) && finite(sky.dayTime) && finite(sky.rainTime) && finite(sky.thunderTime))
    st.sky = { dayTime: Math.max(0, Math.floor(sky.dayTime)) % 24000, raining: sky.raining === true, thundering: sky.thundering === true, rainTime: Math.max(0, Math.min(1e7, Math.floor(sky.rainTime))), thunderTime: Math.max(0, Math.min(1e7, Math.floor(sky.thunderTime))) };
  if (plain(raw.deaths)) {
    const d: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.deaths).slice(0, 64)) if (safeKey(k) && finite(v)) d[k] = Math.max(0, Math.min(1e6, Math.floor(v)));
    st.deaths = d;
  }
  if (raw.auto === true) st.auto = true;
  if (raw.touched === true) st.touched = true;
  if (plain(raw.mem)) {
    try {
      if (JSON.stringify(raw.mem).length <= 8000) st.mem = JSON.parse(JSON.stringify(raw.mem)) as Record<string, unknown>;
    } catch {
      /* not kept */
    }
  }
  // An automatic haunting never deletes anything, whatever a save says
  if (st.auto) st.erase = false;
  return st;
}

/** A recorded block change: dimension, position, before, after, and (V7.1) whose haunting made it. */
export type HauntChange = [string, number, number, number, number, number, HauntCharacter?];

/** The recorded block changes ([dim, x, y, z, before, after, who?]): valid ones only, at most HAUNT_MAX_CHANGES. */
export function sanitizeHauntBlocks(raw: unknown): HauntChange[] {
  if (!Array.isArray(raw)) return [];
  const states = STATE_BLOCK.length;
  const out: HauntChange[] = [];
  for (const e of raw) {
    if (out.length >= HAUNT_MAX_CHANGES) break;
    if (!Array.isArray(e) || (e.length !== 6 && e.length !== 7)) continue;
    const [dim, x, y, z, prev, now, who] = e as unknown[];
    if (e.length === 7 && !(typeof who === 'string' && (HAUNT_CHARACTERS as readonly string[]).includes(who))) continue;
    if (typeof dim !== 'string' || !DIMS.includes(dim)) continue;
    if (![x, y, z, prev, now].every((v) => Number.isInteger(v))) continue;
    if ((y as number) < 0 || (y as number) > 255 || Math.abs(x as number) > 3e7 || Math.abs(z as number) > 3e7) continue;
    if ((prev as number) < 0 || (prev as number) >= states || (now as number) < 0 || (now as number) >= states) continue;
    out.push(e.length === 7 ? [dim, x as number, y as number, z as number, prev as number, now as number, who as HauntCharacter] : [dim, x as number, y as number, z as number, prev as number, now as number]);
  }
  return out;
}

/** The automatic haunting's roll, or null when it cannot be one (the world then never gets one). */
export function sanitizeAutoHaunt(raw: unknown): AutoHauntRoll | null {
  if (!plain(raw) || !finite(raw.after)) return null;
  const r: AutoHauntRoll = {
    haunted: raw.haunted === true,
    after: Math.max(AUTO_HAUNT_DELAY_MIN, Math.min(AUTO_HAUNT_DELAY_MAX, Math.floor(raw.after))),
    played: finite(raw.played) ? Math.max(0, Math.min(1e9, Math.floor(raw.played))) : 0,
    at: finite(raw.at) ? raw.at : 0,
  };
  if (raw.begun === true) r.begun = true;
  if (raw.over === true) r.over = true;
  return r;
}

/** Cleans a world's haunting flags in place (sanitizeLevelData). */
export function sanitizeHauntFlags(flags: Record<string, unknown>): void {
  if ('hauntBlocks' in flags) flags.hauntBlocks = sanitizeHauntBlocks(flags.hauntBlocks);
  // V7.1: the hauntings running (one of each character at most); a world from before kept one, as `haunt`
  const list: HauntState[] = [];
  const add = (st: HauntState | null, first = false): void => {
    if (!st || list.some((x) => x.char === st.char)) return;
    if (first) list.unshift(st);
    else list.push(st);
  };
  if ('haunts' in flags) {
    if (Array.isArray(flags.haunts)) for (const e of flags.haunts.slice(0, HAUNT_CHARACTERS.length * 2)) add(sanitizeHauntState(e));
    delete flags.haunts;
  }
  if ('haunt' in flags) {
    const st = sanitizeHauntState(flags.haunt);
    delete flags.haunt;
    if (st && !list.some((x) => x.char === st.char)) {
      add(st, true);
      // What it changed, as its own
      if (Array.isArray(flags.hauntBlocks)) for (const ch of flags.hauntBlocks as HauntChange[]) if (ch.length === 6) ch.push(st.char!);
    }
  }
  if (list.length) flags.haunts = list;
  // V7 phase 5: changes still to be put back when their chunks load
  if ('hauntRestore' in flags) {
    const later = sanitizeHauntBlocks(flags.hauntRestore);
    if (later.length) flags.hauntRestore = later;
    else delete flags.hauntRestore;
  }
  if ('autoHaunt' in flags) {
    const r = sanitizeAutoHaunt(flags.autoHaunt);
    if (r) flags.autoHaunt = r;
    else delete flags.autoHaunt;
  }
}
