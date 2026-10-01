/**
 * V5.5: the Witch's Grimoire. A spread per page: ink drawings on the left,
 * a few handwritten lines on the right (scratched-out words struck through).
 * The drawings are sketched here in pixels, in the page's ink: brown, the
 * violet of the first door, the grey-green of the second.
 */
import { el, clear } from './dom';
import { GRIMOIRE, type GrimoireArt, type GrimoirePage } from '../../common/digital/grimoire';

const INK: Record<NonNullable<GrimoirePage['ink']>, string> = {
  ink: '#3a2414',
  void: '#4a1a6a',
  signal: '#26453a',
};

const N = 32;

/** A small pixel pen over a 32x32 page cell. */
class Pen {
  constructor(
    private readonly g: CanvasRenderingContext2D,
    readonly ink: string,
  ) {}

  dot(x: number, y: number, c = this.ink, a = 1): void {
    this.g.globalAlpha = a;
    this.g.fillStyle = c;
    this.g.fillRect(Math.round(x), Math.round(y), 1, 1);
    this.g.globalAlpha = 1;
  }

  line(x0: number, y0: number, x1: number, y1: number, c = this.ink): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, 0.85 + ((i * 7) % 3) * 0.05);
  }

  poly(pts: [number, number][], close = true, c = this.ink): void {
    for (let i = 0; i < pts.length - (close ? 0 : 1); i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      this.line(a[0], a[1], b[0], b[1], c);
    }
  }

  rect(x: number, y: number, w: number, h: number, c = this.ink): void {
    this.poly([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ], true, c);
  }

  fill(x: number, y: number, w: number, h: number, c = this.ink, a = 1): void {
    this.g.globalAlpha = a;
    this.g.fillStyle = c;
    this.g.fillRect(x, y, w, h);
    this.g.globalAlpha = 1;
  }

  circle(cx: number, cy: number, r: number, c = this.ink): void {
    const n = Math.max(12, Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, c);
    }
  }

  /** Scribbled shading. */
  hatch(x: number, y: number, w: number, h: number, step = 2, c = this.ink): void {
    for (let i = 0; i < w + h; i += step) for (let k = 0; k <= i; k++) if (k < w && i - k < h && (k + i) % 3 !== 0) this.dot(x + k, y + i - k, c, 0.35);
  }
}

/** Draws one sketch. */
function sketch(p: Pen, art: GrimoireArt): void {
  switch (art) {
    case 'potion':
      p.rect(14, 4, 4, 5);
      p.poly([[14, 9], [8, 15], [8, 26], [24, 26], [24, 15], [18, 9]]);
      p.hatch(9, 17, 15, 9, 2);
      p.circle(16, 20, 2.5);
      break;
    case 'enderman':
      p.rect(13, 3, 6, 6);
      p.dot(14, 6, '#c040e0');
      p.dot(18, 6, '#c040e0');
      p.line(16, 9, 16, 19);
      p.line(13, 10, 9, 22);
      p.line(19, 10, 23, 22);
      p.line(16, 19, 13, 29);
      p.line(16, 19, 19, 29);
      break;
    case 'dragon':
    case 'dragon_fallen': {
      const fallen = art === 'dragon_fallen';
      const dy = fallen ? 10 : 0;
      p.poly([[4, 14 + dy], [16, 12 + dy], [28, 15 + dy], [16, 17 + dy]]);
      p.poly(fallen ? [[10, 15 + dy], [6, 20 + dy], [16, 16 + dy]] : [[10, 13], [6, 3], [16, 12]], false);
      p.poly(fallen ? [[18, 16 + dy], [24, 21 + dy], [22, 15 + dy]] : [[18, 12], [26, 2], [22, 13]], false);
      p.line(28, 15 + dy, 31, 13 + dy);
      p.dot(29, 14 + dy, fallen ? '#000' : '#c040e0');
      if (fallen) {
        p.line(2, 30, 30, 30);
        p.line(28, 22, 30, 24);
        p.line(30, 22, 28, 24);
      }
      break;
    }
    case 'crystal':
      p.rect(12, 8, 8, 8);
      p.poly([[16, 4], [22, 12], [16, 20], [10, 12]]);
      p.rect(13, 22, 6, 8);
      p.hatch(13, 22, 6, 8);
      for (let i = 0; i < 3; i++) p.dot(8 + i * 8, 4, '#d06030');
      break;
    case 'end_island':
      p.poly([[3, 14], [12, 10], [22, 11], [29, 15], [22, 22], [10, 22]]);
      p.hatch(8, 16, 16, 6);
      break;
    case 'corrupted_eye':
    case 'eye_sigil': {
      p.poly([[3, 16], [10, 9], [16, 8], [22, 9], [29, 16], [22, 23], [16, 24], [10, 23]]);
      p.circle(16, 16, 4.5);
      p.fill(15, 15, 3, 3, art === 'eye_sigil' ? p.ink : '#6a2a8a');
      if (art === 'eye_sigil') for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        p.line(16 + Math.cos(a) * 13, 16 + Math.sin(a) * 13, 16 + Math.cos(a) * 15.5, 16 + Math.sin(a) * 15.5);
      } else {
        p.line(16, 8, 18, 4);
        p.line(20, 22, 24, 28);
        p.line(9, 12, 5, 9);
      }
      break;
    }
    case 'corrupted_cave':
      p.poly([[3, 29], [5, 14], [10, 6], [22, 6], [27, 14], [29, 29]], false);
      p.poly([[9, 29], [10, 18], [16, 13], [22, 18], [23, 29]], false);
      for (const [x, y] of [[13, 20], [18, 24], [15, 26]] as const) p.fill(x, y, 2, 2, '#6a2a8a');
      break;
    case 'glitched_portal':
      p.rect(9, 4, 14, 24);
      for (let i = 0; i < 18; i++) p.fill(11 + ((i * 7) % 11), 6 + ((i * 11) % 20), 2, 1, i % 3 === 0 ? '#d040c0' : p.ink, 0.7);
      break;
    case 'farlands':
      for (let x = 2; x < 30; x += 3) {
        const h = 8 + ((x * 13) % 17);
        p.rect(x, 30 - h, 2, h);
        if (x % 2) p.hatch(x, 30 - h, 2, h);
      }
      p.line(1, 30, 31, 30);
      break;
    case 'the_error':
      p.rect(11, 2, 10, 9);
      p.dot(13, 6, '#fff');
      p.dot(18, 5, '#3af0ff');
      p.rect(9, 12, 14, 10);
      p.line(8, 13, 4, 22);
      p.line(5, 24, 3, 28);
      p.line(24, 13, 28, 22);
      p.line(27, 24, 29, 28);
      p.line(13, 22, 12, 30);
      p.line(19, 22, 20, 30);
      p.fill(14, 15, 4, 4, '#d040c0', 0.8);
      break;
    case 'malware':
      for (let i = 0; i < 26; i++) {
        const a = i * 2.39996;
        const r = Math.sqrt(i) * 2.6;
        p.fill(Math.round(16 + Math.cos(a) * r), Math.round(16 + Math.sin(a) * r), 2, 2, i % 4 === 0 ? '#18a050' : p.ink, 0.8);
      }
      break;
    case 'flash_drive':
    case 'corrupted_drive':
      p.poly([[8, 24], [20, 12], [25, 17], [13, 29]]);
      p.rect(21, 8, 4, 4);
      p.line(20, 12, 24, 8);
      if (art === 'corrupted_drive') {
        p.line(12, 22, 16, 26);
        p.line(16, 18, 13, 21);
        for (const [x, y] of [[26, 22], [28, 25], [24, 27], [6, 16]] as const) p.fill(x, y, 2, 2, '#18a050');
      }
      break;
    case 'hard_drive':
      p.rect(6, 6, 20, 22);
      p.circle(15, 15, 6);
      p.dot(15, 15);
      p.line(22, 24, 17, 17);
      break;
    case 'computer':
      p.rect(4, 5, 18, 14);
      p.rect(6, 7, 14, 10);
      p.hatch(7, 8, 12, 8, 3);
      p.line(13, 19, 13, 22);
      p.line(8, 22, 18, 22);
      p.rect(24, 6, 5, 18);
      p.dot(26, 21);
      p.line(5, 26, 22, 26);
      p.line(5, 28, 22, 28);
      break;
    case 'herobrine':
      // Only the head and shoulders, out of the dark, and the two blank eyes
      p.hatch(0, 0, 32, 32, 2);
      p.fill(10, 6, 12, 12, '#e8dcc0');
      p.rect(10, 6, 12, 12);
      p.fill(10, 6, 12, 3, p.ink);
      p.fill(12, 11, 3, 2, '#ffffff');
      p.fill(17, 11, 3, 2, '#ffffff');
      p.line(14, 15, 18, 15);
      p.poly([[4, 30], [6, 20], [26, 20], [28, 30]], false);
      break;
    case 'fog_world':
      p.line(0, 18, 32, 18);
      p.poly([[0, 18], [8, 13], [14, 15], [20, 11], [32, 16]], false);
      for (let x = 2; x < 30; x += 4) p.line(x, 22 + (x % 3), x + 2, 22 + (x % 3));
      // a tiny figure on the far shore
      p.dot(21, 9);
      p.line(21, 10, 21, 12);
      p.dot(21, 9, '#ffffff');
      for (let y = 0; y < 10; y += 2) p.line(0, y, 32, y, '#b8b0a0');
      break;
    case 'cave_machines':
      p.poly([[2, 30], [4, 12], [12, 4], [20, 4], [28, 12], [30, 30]], false);
      for (const x of [7, 12, 20, 25]) p.rect(x - 1, 18, 3, 12);
      p.fill(15, 16, 3, 14, '#e8f4ff');
      p.rect(15, 16, 3, 14);
      p.line(16, 16, 16, 5);
      break;
    case 'lightning':
      p.poly([[18, 2], [10, 16], [16, 16], [12, 30], [24, 12], [17, 12], [22, 2]]);
      break;
    case 'network':
      for (const [a, b] of [[[5, 6], [16, 16]], [[16, 16], [27, 7]], [[16, 16], [8, 27]], [[16, 16], [26, 26]], [[5, 6], [27, 7]]] as [[number, number], [number, number]][]) p.line(a[0], a[1], b[0], b[1]);
      for (const [x, y] of [[5, 6], [16, 16], [27, 7], [8, 27], [26, 26]] as const) p.fill(x - 1, y - 1, 3, 3);
      break;
    case 'corruption':
      for (let i = 0; i < 30; i++) p.fill((i * 13) % 30, (i * 7 + (i >> 2) * 5) % 30, 2, 2, i % 5 === 0 ? '#18a050' : p.ink, 0.4 + (i % 3) * 0.2);
      break;
  }
}

function drawArt(art: GrimoireArt, ink: string): HTMLCanvasElement {
  const c = el('canvas', { class: 'grim-art', width: N, height: N }) as HTMLCanvasElement;
  const g = c.getContext('2d');
  if (g) sketch(new Pen(g, ink), art);
  return c;
}

function handwriting(line: string): HTMLElement {
  // ~scratched~ words are struck through
  const out = el('div', { class: 'grim-line' });
  const parts = line.split('~');
  parts.forEach((part, i) => {
    if (!part) return;
    out.append(i % 2 === 1 ? el('s', {}, part) : document.createTextNode(part));
  });
  return out;
}

export class GrimoirePanel {
  readonly root: HTMLElement;
  private page = 0;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly counter: HTMLElement;

  constructor(private readonly opts: { close: () => void; turn?: () => void }) {
    this.left = el('div', { class: 'grim-page left' });
    this.right = el('div', { class: 'grim-page right' });
    this.counter = el('div', { class: 'grim-count' });
    const prev = el('button', { class: 'grim-nav prev', title: 'Previous page' }, '◀');
    const next = el('button', { class: 'grim-nav next', title: 'Next page' }, '▶');
    prev.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.go(-1);
    });
    next.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.go(1);
    });
    const close = el('button', { class: 'grim-close', title: 'Close' }, '✕');
    close.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.opts.close();
    });
    this.root = el('div', { class: 'grimoire' }, el('div', { class: 'grim-spread' }, this.left, this.right), prev, next, this.counter, close);
    this.render();
  }

  go(d: number): void {
    const p = Math.max(0, Math.min(GRIMOIRE.length - 1, this.page + d));
    if (p === this.page) return;
    this.page = p;
    this.opts.turn?.();
    this.render();
  }

  private render(): void {
    const pg = GRIMOIRE[this.page]!;
    const ink = INK[pg.ink ?? 'ink'];
    clear(this.left);
    clear(this.right);
    this.left.className = 'grim-page left ink-' + (pg.ink ?? 'ink');
    this.right.className = 'grim-page right ink-' + (pg.ink ?? 'ink');
    if (pg.title) this.left.append(el('div', { class: 'grim-title' }, pg.title));
    for (const row of pg.rows) {
      const r = el('div', { class: 'grim-row' });
      for (const a of row) r.append(a === 'arrow' ? el('div', { class: 'grim-arrow' }, '→') : drawArt(a, ink));
      this.left.append(r);
    }
    for (const line of pg.text) this.right.append(handwriting(line));
    this.counter.textContent = `${this.page + 1} / ${GRIMOIRE.length}`;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.go(1);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.go(-1);
    else return false;
    return true;
  }
}
