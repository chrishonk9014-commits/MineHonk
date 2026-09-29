/**
 * Ending cards (V3): the screen dims and an ending's name fades in, holds,
 * then fades away. The game keeps running underneath (nothing is paused in
 * multiplayer); a click or key after a moment dismisses it early.
 *
 * Styles: 'calm' (Ending 1), 'glitch' (The Farlands Remains: the letters
 * never quite sit still) and 'error' (ERROR DEFEATED).
 */
import { el } from './dom';
import type { Settings } from '../settings';

export interface EndingCardData {
  id: string;
  head: string;
  title: string;
  line: string;
  style: 'calm' | 'glitch' | 'error';
}

const HOLD_MS = 7000;

export class EndingCard {
  private current: HTMLElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
  ) {}

  get showing(): boolean {
    return !!this.current;
  }

  show(d: EndingCardData): void {
    this.dismiss(true);
    const calm = this.settings.glitchFx === 'off' || this.settings.reduceMotion;
    const card = el(
      'div',
      { class: `ending-card ending-${d.style}${calm ? ' calm' : ''}` },
      el(
        'div',
        { class: 'ending-inner' },
        d.head ? el('div', { class: 'ending-head' }, d.head) : null,
        el('div', { class: 'ending-title', 'data-text': d.title }, d.title),
        d.line ? el('div', { class: 'ending-line' }, d.line) : null,
        el('div', { class: 'ending-mark' }, 'MineHonk'),
      ),
    );
    this.root.append(card);
    this.current = card;
    // Fade in on the next frame
    requestAnimationFrame(() => card.classList.add('in'));
    const dismissable = setTimeout(() => {
      card.classList.add('dismissable');
      const off = (): void => this.dismiss();
      window.addEventListener('keydown', off, { once: true });
      window.addEventListener('mousedown', off, { once: true });
    }, 1500);
    this.timers.push(dismissable, setTimeout(() => this.dismiss(), HOLD_MS));
  }

  dismiss(now = false): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const c = this.current;
    if (!c) return;
    this.current = null;
    if (now) {
      c.remove();
      return;
    }
    c.classList.remove('in');
    c.classList.add('out');
    setTimeout(() => c.remove(), 1600);
  }
}
