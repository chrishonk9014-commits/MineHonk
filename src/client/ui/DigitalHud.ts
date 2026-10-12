/**
 * V5.5: the screen side of the Digital Corruption Update.
 *
 * - hacking: Herobrine's words across the screen. A warning first (what is
 *   coming and a bar running down to when it lands), then the word itself
 *   when it does; small flashes of his name; CONNECTION LOST greying out the
 *   view for a moment;
 * - a computer being taken over: its lines typed into a corner of the view;
 * - something watching: the edges of the screen darken;
 * - falling into a computer: the view breaks into pixels, goes white, then
 *   comes back as the other world;
 * - the digital world shutting down: the picture collapses to a line, then
 *   a dot, then SHUTDOWN.
 * The words always stay readable, with glitch effects reduced or off.
 */
import { el } from './dom';
import type { Settings } from '../settings';

export class DigitalHud {
  private readonly layer: HTMLElement;
  private warning: HTMLElement | null = null;
  private warnTimer = 0;
  private takeoverBox: HTMLElement | null = null;
  private takeoverTimer = 0;
  private presenceEl: HTMLElement | null = null;
  private presenceTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
  ) {
    this.layer = el('div', { class: 'digital-layer' });
    root.append(this.layer);
  }

  private get calm(): boolean {
    return this.settings.glitchFx === 'off';
  }

  /**
   * Herobrine's words. `mode` 0: a warning (lands after `ticks`); 1: it
   * happens now; 2: a flash of text somewhere; 3: CONNECTION LOST.
   */
  hack(text: string, ticks: number, mode: number): void {
    const ms = Math.max(300, ticks * 50);
    if (mode === 0) {
      this.warning?.remove();
      clearTimeout(this.warnTimer);
      const bar = el('div', { class: 'hack-warn-bar' });
      bar.style.animationDuration = `${ms}ms`;
      const w = el('div', { class: 'hack-warn' + (this.calm ? ' calm' : '') }, el('div', { class: 'hack-warn-head' }, '⚠ INCOMING'), el('div', { class: 'hack-warn-text', 'data-text': text }, text), el('div', { class: 'hack-warn-track' }, bar));
      this.layer.append(w);
      this.warning = w;
      this.warnTimer = window.setTimeout(() => {
        w.remove();
        if (this.warning === w) this.warning = null;
      }, ms + 100);
      return;
    }
    if (mode === 3) {
      const d = el('div', { class: 'hack-lost' }, el('div', { class: 'hack-lost-text' }, text), el('div', { class: 'hack-lost-dots' }, '. . .'));
      this.layer.append(d);
      setTimeout(() => d.remove(), ms);
      return;
    }
    if (mode === 2) {
      const d = el('div', { class: 'hack-flash' + (this.calm ? ' calm' : ''), 'data-text': text }, text);
      d.style.left = `${10 + Math.random() * 60}%`;
      d.style.top = `${15 + Math.random() * 60}%`;
      this.layer.append(d);
      setTimeout(() => d.remove(), ms);
      return;
    }
    const d = el('div', { class: 'hack-now' + (this.calm ? ' calm' : '') }, el('div', { class: 'hack-now-text', 'data-text': text }, text));
    this.layer.append(d);
    setTimeout(() => d.classList.add('fade'), Math.max(200, ms - 400));
    setTimeout(() => d.remove(), ms);
  }

  /** A line from a computer being taken over. */
  takeover(line: string, strength: number): void {
    if (!this.takeoverBox) {
      this.takeoverBox = el('div', { class: 'takeover-box' });
      this.layer.append(this.takeoverBox);
    }
    const box = this.takeoverBox;
    box.style.setProperty('--k', String(strength));
    box.append(el('div', { class: 'takeover-line' + (strength > 0.6 && !this.calm ? ' bad' : '') }, line));
    while (box.childElementCount > 9) box.firstChild?.remove();
    clearTimeout(this.takeoverTimer);
    this.takeoverTimer = window.setTimeout(() => {
      box.classList.add('fade');
      setTimeout(() => {
        box.remove();
        if (this.takeoverBox === box) this.takeoverBox = null;
      }, 600);
    }, 4000);
  }

  /** Something is watching: the edges of the view darken for a while. */
  presence(ticks: number): void {
    if (!this.presenceEl) {
      this.presenceEl = el('div', { class: 'presence' });
      this.layer.append(this.presenceEl);
    }
    const p = this.presenceEl;
    requestAnimationFrame(() => p.classList.add('on'));
    clearTimeout(this.presenceTimer);
    this.presenceTimer = window.setTimeout(() => p.classList.remove('on'), Math.max(500, ticks * 50));
  }

  /** Into the computer: the view breaks into pixels and goes white. */
  enterComputer(ticks: number): void {
    const ms = Math.max(600, ticks * 50);
    const grid = el('div', { class: 'enter-pc' });
    const n = 12 * 8;
    for (let i = 0; i < n; i++) {
      const c = el('div', { class: 'enter-px' });
      c.style.animationDelay = `${Math.random() * ms * 0.7}ms`;
      c.style.animationDuration = `${ms * 0.3}ms`;
      grid.append(c);
    }
    grid.append(el('div', { class: 'enter-flash', style: { animationDelay: `${ms * 0.75}ms` } }));
    this.layer.append(grid);
    // It holds white over the change of world, then lets go
    setTimeout(() => grid.classList.add('out'), ms + 1600);
    setTimeout(() => grid.remove(), ms + 2600);
  }

  /** The digital world shuts down. */
  shutdown(ticks: number): void {
    const ms = Math.max(1000, ticks * 50);
    const d = el('div', { class: 'shutdown' }, el('div', { class: 'shutdown-line' }), el('div', { class: 'shutdown-text' }, 'SHUTDOWN'));
    d.style.setProperty('--ms', `${ms}ms`);
    this.layer.append(d);
    setTimeout(() => d.classList.add('out'), ms + 2500);
    setTimeout(() => d.remove(), ms + 3600);
  }

  clear(): void {
    this.layer.replaceChildren();
    this.warning = null;
    this.takeoverBox = null;
    this.presenceEl = null;
  }
}
