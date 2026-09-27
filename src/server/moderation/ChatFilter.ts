/**
 * Chat moderation for multiplayer worlds.
 *
 * - Profanity is masked (matching survives leetspeak, spacing and repeated
 *   letters); the word list can be extended by the server operator.
 * - Links are blocked, and personal details (e-mail addresses and phone
 *   numbers) are masked to protect players.
 * - Repeated messages and shouting are throttled.
 *
 * This is a first line of defence; hosted deployments should also connect
 * their platform's moderation service through ServerOptions.filterChat.
 */

/** Mild default list; operators add more (one word per line) in their data folder. */
const DEFAULT_WORDS = ['fuck', 'fuk', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'dick', 'slut', 'whore', 'wanker', 'twat', 'prick', 'bollocks', 'motherfucker'];

/** Innocent words that contain a listed word (already squashed). */
const ALLOWED = new Set(['dickens', 'prickly', 'pricked', 'shitake', 'scunthorpe', 'cocktail', 'bastardise', 'dickey']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '8': 'b', '9': 'g', '+': 't', '|': 'i' };

export interface FilterResult {
  /** Text to deliver (masked), or null when the message is blocked. */
  text: string | null;
  /** Explanation for the sender when blocked or changed. */
  reason?: string;
}

interface Recent {
  text: string;
  at: number;
  repeats: number;
}

export class ChatFilter {
  private readonly words = new Set<string>();
  private readonly recent = new Map<string, Recent>();

  constructor(extra: Iterable<string> = [], readonly allowLinks = false) {
    for (const w of [...DEFAULT_WORDS, ...extra]) {
      const n = ChatFilter.squash(w);
      if (n.length >= 3) this.words.add(n);
    }
  }

  /** Lower-case, undo leetspeak, drop non-letters and collapse repeated letters. */
  static squash(s: string): string {
    let out = '';
    for (const ch of s.toLowerCase()) {
      const c = LEET[ch] ?? ch;
      if (c < 'a' || c > 'z') continue;
      if (out.endsWith(c)) continue;
      out += c;
    }
    return out;
  }

  addWords(list: Iterable<string>): void {
    for (const w of list) {
      const n = ChatFilter.squash(w);
      if (n.length >= 3) this.words.add(n);
    }
  }

  /** Masks blocked words in `text`. Returns the masked text and whether anything changed. */
  mask(text: string): { text: string; changed: boolean } {
    // Tokens are maximal runs of non-space characters; also check pairs so "f u c k" is caught.
    const tokens = text.split(/(\s+)/);
    let changed = false;
    const words = tokens.map((t, i) => ({ t, i, word: !/^\s+$/.test(t) }));
    const flagged = new Set<number>();
    const plain = words.filter((w) => w.word);
    for (let a = 0; a < plain.length; a++) {
      let acc = '';
      for (let b = a; b < Math.min(plain.length, a + 6); b++) {
        const piece = ChatFilter.squash(plain[b]!.t);
        // Only merge single letters (spaced-out words), never whole words
        if (b > a && piece.length > 1) break;
        acc += piece;
        if (this.hit(acc)) for (let k = a; k <= b; k++) flagged.add(plain[k]!.i);
      }
      if (this.hit(ChatFilter.squash(plain[a]!.t))) flagged.add(plain[a]!.i);
    }
    const out = words.map((w) => {
      if (!flagged.has(w.i)) return w.t;
      changed = true;
      return '*'.repeat(Math.max(3, w.t.length));
    });
    return { text: out.join(''), changed };
  }

  private hit(s: string): boolean {
    if (s.length < 3 || ALLOWED.has(s)) return false;
    if (this.words.has(s)) return true;
    // Inflections ("...ing", "...s", "...y") but not unrelated longer words
    for (const w of this.words) if (w.length >= 4 && s.length <= w.length + 4 && (s.startsWith(w) || s.endsWith(w))) return true;
    return false;
  }

  /** Full check for a chat line from `sender` at time `now` (ms). */
  check(text: string, sender: string, now = Date.now()): FilterResult {
    let t = text.trim();
    if (!t) return { text: null };
    // Personal details
    let personal = false;
    t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, () => {
      personal = true;
      return '[email hidden]';
    });
    t = t.replace(/(?:\+?\d[\s-]?){7,}\d/g, () => {
      personal = true;
      return '[number hidden]';
    });
    if (!this.allowLinks && /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|co|me|tv|ly)\b)/i.test(t)) {
      return { text: null, reason: 'Links are not allowed in chat.' };
    }
    // Spam: the same message again and again
    const key = sender.toLowerCase();
    const r = this.recent.get(key);
    const norm = ChatFilter.squash(t);
    if (r && r.text === norm && now - r.at < 30000) {
      r.repeats++;
      r.at = now;
      if (r.repeats >= 2) return { text: null, reason: 'Please do not repeat the same message.' };
    } else this.recent.set(key, { text: norm, at: now, repeats: 0 });
    if (this.recent.size > 1000) this.recent.clear();
    // Shouting
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length > 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) t = t.toLowerCase();
    const masked = this.mask(t);
    const reason = personal ? 'Personal details were hidden to keep you safe.' : undefined;
    return { text: masked.text, reason };
  }
}
