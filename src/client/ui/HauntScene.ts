/**
 * The Haunting's lair ending, on the screen: the grab (red at the edges),
 * the drag (the dark closing in), black while the computer pulls you in,
 * eyelids opening on his hall, the shocks, the death, then SERVER MEMORY
 * CORRUPTED with the machine's memory spilling down the screen. The camera
 * and the controls are Game's; this is only what lies over the view.
 * With Reduce Motion the shocks are a dim tint instead of a flash.
 *
 * V7 phase 3 uses the same steps for a Trick Home's grab and drag, and adds
 * 'look' (a Candy Home answering the door: black bars top and bottom) and a
 * Skip button for the scenes that may be skipped.
 *
 * V7 phase 4 adds the other characters' endings: 'erase' (the screen going
 * black square by square: Null), 'flash' (a white flash that stays: Green
 * Steve's room), 'rise' (eyes opening, on your feet), 'eyes' (pale eyes
 * opening in the dark of the Cave Dweller's den) and 'watch' (from outside
 * yourself, letterboxed: Green Steve walking away as you).
 */
import { el, clear } from './dom';
import type { Settings } from '../settings';
import type { AudioEngine } from '../audio/Audio';

const DUMP = [
  'FATAL EXCEPTION 0x0000HB in world.dat',
  'chunk table at 0x7F3A21C0 overwritten',
  'player.dat: unreadable (owner: HEROBRINE)',
  'region/r.0.0.mca: 1024 sectors lost',
  'level.flags: ??????????????',
  'attempting recovery...',
  'recovery failed',
  'HEROBRINE.EXE has taken this world',
  'memory dump: 4F 55 54 53 49 44 45 00 00 00',
  'stack: tick() > tick() > tick() > tick() > tick()',
  'restoring from backup... no backup found',
  'disconnecting all players',
];

export class HauntScene {
  private readonly root: HTMLElement;
  private readonly black: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly lids: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly die: HTMLElement;
  private readonly corrupt: HTMLElement;
  private readonly dump: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly skipBtn: HTMLElement;
  private readonly erase: HTMLElement;
  private readonly white: HTMLElement;
  private readonly eyes: HTMLElement;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private current = '';
  /** V7 phase 3: the scene playing may be skipped (Game sends scene_skip). */
  skippable = false;
  onSkip: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly audio: AudioEngine,
  ) {
    this.black = el('div', { class: 'hs-black' });
    this.vignette = el('div', { class: 'hs-vignette' });
    this.lids = el('div', { class: 'hs-lids' }, el('div', { class: 'hs-lid top' }), el('div', { class: 'hs-lid bottom' }));
    this.flash = el('div', { class: 'hs-flash' });
    this.die = el('div', { class: 'hs-die' }, el('div', { class: 'hs-die-title' }, 'You died!'), el('div', { class: 'hs-die-sub' }, 'Herobrine was the last thing you saw'));
    this.dump = el('div', { class: 'hs-dump' });
    this.corrupt = el('div', { class: 'hs-corrupt' }, el('div', { class: 'hs-corrupt-title', 'data-text': 'SERVER MEMORY CORRUPTED' }, 'SERVER MEMORY CORRUPTED'), this.dump);
    this.bars = el('div', { class: 'hs-bars' }, el('div', { class: 'hs-bar top' }), el('div', { class: 'hs-bar bottom' }));
    this.skipBtn = el('div', { class: 'hs-skip hidden' }, 'Skip ▸');
    this.erase = el('div', { class: 'hs-erase' });
    this.white = el('div', { class: 'hs-white' });
    this.eyes = el('div', { class: 'hs-eyes' });
    const skip = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      if (this.skippable) this.onSkip?.();
    };
    this.skipBtn.addEventListener('mousedown', skip);
    this.skipBtn.addEventListener('touchstart', skip, { passive: false });
    this.root = el('div', { class: 'haunt-scene hidden' }, this.bars, this.vignette, this.lids, this.flash, this.black, this.die, this.corrupt, this.erase, this.white, this.eyes, this.skipBtn);
    parent.append(this.root);
  }

  /** A cutscene step is playing (Game locks the controls). */
  get active(): boolean {
    return this.current !== '';
  }

  get step(): string {
    return this.current;
  }

  show(step: string, ticks: number, skip = false): void {
    const ms = (ticks / 20) * 1000;
    this.root.classList.remove('hidden');
    this.root.classList.toggle('calm', this.settings.reduceMotion);
    this.current = step;
    this.root.dataset.step = step;
    this.skippable = skip;
    this.skipBtn.classList.toggle('hidden', !skip);
    switch (step) {
      case 'look':
        // A Candy Home answering: the screen goes cinematic
        this.restart(this.bars, 'in');
        break;
      case 'grab':
        this.restart(this.vignette, 'grab');
        break;
      case 'drag':
        this.vignette.style.setProperty('--drag-ms', `${Math.round(ms)}ms`);
        this.restart(this.vignette, 'drag');
        break;
      case 'black':
        this.root.classList.add('is-black');
        break;
      case 'wake':
        // Eyes opening: a blink or two, then the hall
        this.root.classList.remove('is-black');
        this.vignette.className = 'hs-vignette lair';
        this.restart(this.lids, 'open');
        break;
      case 'shock':
        this.restart(this.flash, 'go');
        break;
      case 'die':
        this.restart(this.die, 'go');
        break;
      case 'erase': {
        // Square by square, in no order, until there is nothing
        clear(this.erase);
        const n = 12 * 8;
        const order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
        const cells: HTMLElement[] = [];
        for (let i = 0; i < n; i++) cells.push(el('i'));
        order.forEach((c, i) => (cells[c]!.style.animationDelay = `${Math.round((i / n) * ms * 0.8)}ms`));
        this.erase.append(...cells);
        this.restart(this.erase, 'go');
        this.audio.playThrough('glitch.static', 0.3);
        break;
      }
      case 'flash':
        this.restart(this.white, 'go');
        break;
      case 'rise':
        this.root.classList.remove('is-black');
        this.vignette.className = 'hs-vignette';
        this.restart(this.lids, 'open');
        break;
      case 'eyes': {
        this.root.classList.add('is-black');
        clear(this.eyes);
        for (let i = 0; i < 9; i++) {
          const eye = el('i');
          eye.style.left = `${8 + ((i * 37) % 80)}%`;
          eye.style.top = `${12 + ((i * 53) % 70)}%`;
          eye.style.animationDelay = `${Math.round(i * Math.min(400, ms / 12))}ms`;
          this.eyes.append(eye);
        }
        this.restart(this.eyes, 'go');
        break;
      }
      case 'watch':
        if (!this.bars.classList.contains('in')) this.restart(this.bars, 'in');
        break;
      case 'corrupt':
        this.root.classList.add('is-black');
        this.restart(this.corrupt, 'go');
        this.audio.playThrough('computer.shutdown', 0.8);
        this.audio.playThrough('glitch.static', 0.5);
        clear(this.dump);
        DUMP.forEach((line, i) => this.timers.push(setTimeout(() => this.dump.append(el('div', {}, line)), 500 + i * Math.max(120, (ms - 1500) / DUMP.length))));
        break;
    }
  }

  /** Back to the game (Stop pressed during it). */
  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.current = '';
    delete this.root.dataset.step;
    this.root.className = 'haunt-scene hidden';
    for (const e of [this.vignette, this.lids, this.flash, this.die, this.corrupt, this.bars, this.erase, this.white, this.eyes]) e.className = e.className.split(' ')[0]!;
    clear(this.erase);
    clear(this.eyes);
    this.skippable = false;
    this.skipBtn.classList.add('hidden');
    clear(this.dump);
  }

  destroy(): void {
    this.clear();
    this.root.remove();
  }

  private restart(e: HTMLElement, cls: string): void {
    e.className = e.className.split(' ')[0]!;
    void e.offsetWidth;
    e.classList.add(cls);
  }
}
