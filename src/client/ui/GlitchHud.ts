/**
 * The interface side of glitch effects (V3): the HUD flickering, corrupted
 * fragments of UI, the brief error texts and the WORLD INTEGRITY FAILURE
 * screen. Error texts are rare on purpose: one per glitch hit at most, never
 * a stream. With glitch effects off, texts still show but nothing flickers.
 */
import { el } from './dom';
import type { Settings } from '../settings';

const HIT_TEXTS = ['ERR0R', 'WORLD_STATE_INVALID', 'POSITION_CORRUPTED'];
const FRAGMENTS = ['0x00000000', 'NaN', '▓▒░', 'null', '#REF!', 'chunk[?]', 'ERR', '∅', '-2147483648', 'undefined', '0xDEADC0DE', '▒▒▒▒'];

export class GlitchHud {
  private readonly layer: HTMLElement;
  private hudFlicker = 0;
  private lastText = -1000;
  private tickNo = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
  ) {
    this.layer = el('div', { class: 'glitch-layer' });
    root.append(this.layer);
  }

  private get calm(): boolean {
    return this.settings.glitchFx === 'off';
  }

  /** The world's integrity fails: a brief, heavy error screen. */
  integrity(text: string, ticks: number): void {
    const box = el('div', { class: 'glitch-integrity' + (this.calm ? ' calm' : '') }, el('div', { class: 'glitch-integrity-text', 'data-text': text }, text));
    this.layer.append(box);
    setTimeout(() => box.classList.add('fade'), Math.max(200, ticks * 50 - 400));
    setTimeout(() => box.remove(), Math.max(400, ticks * 50));
    if (!this.calm) this.fragments(8);
  }

  /** Hit by a glitch attack: the HUD flickers, fragments appear, maybe one error text. */
  playerHit(): void {
    this.hudFlicker = this.settings.glitchFx === 'full' ? 30 : 12;
    if (!this.calm) this.fragments(this.settings.glitchFx === 'full' ? 6 : 2);
    // At most one error text every few seconds
    if (this.tickNo - this.lastText > 80) {
      this.lastText = this.tickNo;
      const t = HIT_TEXTS[Math.floor(Math.random() * HIT_TEXTS.length)]!;
      const d = el('div', { class: 'glitch-hit-text' + (this.calm ? ' calm' : ''), 'data-text': t }, t);
      d.style.left = `${30 + Math.random() * 40}%`;
      d.style.top = `${30 + Math.random() * 30}%`;
      this.layer.append(d);
      setTimeout(() => d.remove(), 900);
    }
  }

  /** Small corrupted bits of interface, gone in a moment. */
  fragments(n: number): void {
    for (let i = 0; i < n; i++) {
      const d = el('div', { class: 'glitch-frag' }, FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)]!);
      d.style.left = `${Math.random() * 90}%`;
      d.style.top = `${Math.random() * 90}%`;
      this.layer.append(d);
      setTimeout(() => d.remove(), 150 + Math.random() * 450);
    }
  }

  /** 20 times a second: `corrupting` 0..1 while the world corrupts. */
  tick(corrupting: number): void {
    this.tickNo++;
    if (this.hudFlicker > 0) this.hudFlicker--;
    // The HUD shifts and dims a few times a second while hit (never a bright flash)
    const on = this.hudFlicker > 0 && !this.calm && Math.floor(this.tickNo / 3) % 2 === 0;
    this.root.classList.toggle('hud-glitch', on);
    if (corrupting > 0 && !this.calm && this.tickNo % 12 === 0 && Math.random() < corrupting) this.fragments(1);
  }

  clear(): void {
    this.hudFlicker = 0;
    this.root.classList.remove('hud-glitch');
    this.layer.replaceChildren();
  }
}
