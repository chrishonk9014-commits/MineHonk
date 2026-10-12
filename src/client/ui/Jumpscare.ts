/**
 * The Haunting's end: Herobrine reaches you. His face (the same pixels as
 * his model's) rushes up to fill the screen with a scream, shakes, and the
 * screen goes black until the server throws everyone out. No flashing; with
 * Reduce Motion the face comes up without the shaking.
 */
import { el } from './dom';
import type { Settings } from '../settings';
import type { AudioEngine } from '../audio/Audio';

export class Jumpscare {
  private readonly root: HTMLElement;
  private readonly face: HTMLCanvasElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly audio: AudioEngine,
  ) {
    this.face = drawFace();
    this.root = el('div', { class: 'jumpscare hidden' }, this.face);
    parent.append(this.root);
  }

  get active(): boolean {
    return !this.root.classList.contains('hidden');
  }

  play(ticks = 60): void {
    if (this.active) return;
    this.root.classList.remove('hidden', 'black', 'go');
    this.root.classList.toggle('calm', this.settings.reduceMotion);
    void this.root.offsetWidth; // restart the animation
    this.root.classList.add('go');
    this.audio.playThrough('herobrine.scream', 1);
    // Then nothing but black, until the kick
    this.timer = setTimeout(() => this.root.classList.add('black'), Math.max(900, (ticks / 20) * 1000 * 0.4));
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.root.remove();
  }
}

/** His face, 8 by 8 pixels: hair, skin, white eyes with nothing in them, the beard line. */
function drawFace(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, color: string, w = 1, h = 1): void => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  px(0, 0, '#b4846d', 8, 8);
  px(0, 0, '#3b2512', 8, 2);
  px(0, 2, '#3b2512');
  px(7, 2, '#3b2512');
  px(1, 4, '#ffffff', 2, 1);
  px(5, 4, '#ffffff', 2, 1);
  px(3, 5, '#946452', 2, 1);
  px(2, 6, '#6a3e2a', 4, 1);
  px(2, 7, '#5a3420', 4, 1);
  c.className = 'jumpscare-face';
  return c;
}
