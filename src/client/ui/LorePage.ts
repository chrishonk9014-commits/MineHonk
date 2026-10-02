/**
 * V6 phase 3: reading the ancient End.
 *
 * - A lore book opens on its one page: a torn page, a log entry, a loose
 *   note, a star chart or a partial translation in handwriting, or a stone
 *   rubbing in cut capitals.
 * - An Ender Glyph Stone shows nothing but its glyphs: a seeded run of the
 *   made-up script on a stone tablet, with no words at all.
 */
import { el } from './dom';
import { GLYPHS } from '../../common/endExpansion/glyphs';
import { LORE_BY_ID, LORE_KIND_NAMES } from '../../common/endExpansion/lore';

/** A tablet of glyphs (rows x cols), seeded so each stone always shows the same run. */
export function glyphTablet(seed: number, face: number, rows = 3, cols = 6): HTMLCanvasElement {
  const cell = 10;
  const c = document.createElement('canvas');
  c.width = cols * cell + 4;
  c.height = rows * cell + 4;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c2638';
  g.fillRect(0, 0, c.width, c.height);
  let s = (seed >>> 0) || 1;
  const rnd = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      // The stone's own face comes first; the rest wander
      const gi = r === 0 && k === 0 ? face % GLYPHS.length : Math.floor(rnd() * GLYPHS.length);
      if (r > 0 && rnd() < 0.12) continue;
      const pat = GLYPHS[gi]!;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const ch = pat[y]![x];
          if (ch === '.') continue;
          g.fillStyle = ch === 'o' ? '#d8b8ff' : '#9a7ad8';
          g.fillRect(3 + k * cell + x, 3 + r * cell + y, 1, 1);
        }
    }
  c.className = 'glyph-tablet';
  return c;
}

export class LorePanel {
  readonly root: HTMLElement;

  constructor(id: string, opts: { close: () => void }) {
    const f = LORE_BY_ID.get(id);
    const close = el('button', { class: 'grim-close', title: 'Close' }, '✕');
    close.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      opts.close();
    });
    const page = el('div', { class: `grim-page lore-page lore-${f?.kind ?? 'torn_page'}` });
    if (f) {
      page.append(el('div', { class: 'grim-title' }, LORE_KIND_NAMES[f.kind]));
      for (const line of f.lines) page.append(el('div', { class: f.kind === 'inscription' ? 'lore-carved' : 'grim-line' }, line));
    } else page.append(el('div', { class: 'grim-line' }, 'The page is blank.'));
    this.root = el('div', { class: 'grimoire lore-book' }, page, close);
  }
}

export class GlyphPanel {
  readonly root: HTMLElement;

  constructor(seed: number, face: number, opts: { close: () => void }) {
    const close = el('button', { class: 'grim-close', title: 'Close' }, '✕');
    close.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      opts.close();
    });
    this.root = el('div', { class: 'glyph-stone' }, glyphTablet(seed, face), close);
  }
}
