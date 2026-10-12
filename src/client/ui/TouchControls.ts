/**
 * On-screen controls for phones and tablets. They feed the same inputs as a
 * keyboard, mouse or gamepad, so the game plays the same:
 *  - the left half is a floating joystick (push it all the way forward to
 *    sprint);
 *  - dragging on the right half looks around; a quick tap uses or places
 *    (or hits the mob you are looking at) and a long press breaks blocks;
 *  - buttons: jump (double tap to fly in creative), sneak (toggles), hit,
 *    use (hold to eat, draw a bow...), inventory, drop, chat, camera view
 *    and pause;
 *  - tapping a hotbar slot selects it.
 */
import { el } from './dom';
import type { Input, Action } from '../input/Input';

export interface TouchHost {
  selectSlot(i: number): void;
  /** Where the hotbar is on screen (null when hidden). */
  hotbarRect(): DOMRect | null;
  /** Whether the crosshair is on an entity (a tap then hits instead of using). */
  targetingEntity(): boolean;
}

/** Joystick travel (CSS pixels) for full speed. */
const STICK_R = 56;
const DEADZONE = 0.12;
/** A look touch shorter and stiller than this is a tap. */
const TAP_MS = 260;
const TAP_SLOP = 12;
/** Holding still this long on the look area starts breaking. */
const HOLD_MS = 320;
/** Screen pixels to mouse "pixels" for looking around. */
const LOOK_SCALE = 1.9;

interface StickTouch {
  id: number;
  ox: number;
  oy: number;
}

interface LookTouch {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t0: number;
  moved: number;
  mining: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export class TouchControls {
  readonly root = el('div', { class: 'touch-layer hidden' });
  private readonly base = el('div', { class: 'touch-stick-base' });
  private readonly knob = el('div', { class: 'touch-stick-knob' });
  private stick: StickTouch | null = null;
  private look: LookTouch | null = null;
  private visible = false;
  private sneakOn = false;
  private readonly sneakBtn: HTMLElement;

  constructor(
    private readonly input: Input,
    private readonly host: TouchHost,
  ) {
    this.base.append(this.knob);
    this.root.append(this.base);
    this.resetStickVisual();

    // Buttons: holdable ones set a flag while pressed; others queue an action
    const button = (label: string, cls: string, down: () => void, up?: () => void): HTMLElement => {
      const b = el('div', { class: 'touch-btn tb-' + cls }, label);
      let id = -1;
      b.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (id >= 0) return;
          id = e.changedTouches[0]!.identifier;
          b.classList.add('down');
          down();
        },
        { passive: false },
      );
      const end = (e: TouchEvent): void => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== id) continue;
          e.preventDefault();
          e.stopPropagation();
          id = -1;
          b.classList.remove('down');
          up?.();
        }
      };
      b.addEventListener('touchend', end, { passive: false });
      b.addEventListener('touchcancel', end, { passive: false });
      this.root.append(b);
      return b;
    };
    const tap = (a: Action) => (): void => this.input.pushAction(a);
    button('JUMP', 'jump', () => (this.input.touchJump = true), () => (this.input.touchJump = false));
    this.sneakBtn = button('SNEAK', 'sneak', () => {
      this.sneakOn = !this.sneakOn;
      this.input.touchSneak = this.sneakOn;
      this.sneakBtn.classList.toggle('on', this.sneakOn);
    });
    button(
      'HIT',
      'hit',
      () => {
        this.input.pushAction('attack');
        this.input.touchAttack = true;
      },
      () => (this.input.touchAttack = false),
    );
    button(
      'USE',
      'use',
      () => {
        this.input.pushAction('use');
        this.input.touchUse = true;
      },
      () => (this.input.touchUse = false),
    );
    button('INV', 'inv', tap('inventory'));
    button('DROP', 'drop', tap('drop'));
    button('CHAT', 'chat', tap('chat'));
    button('VIEW', 'view', tap('perspective'));
    button('II', 'pause', tap('pause'));

    // Everything else on the layer: the joystick and looking around
    this.root.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    this.root.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.root.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    this.root.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
  }

  /** Shown only while playing on a touch screen with no menu open. */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.releaseAll();
  }

  private releaseAll(): void {
    this.stick = null;
    this.endLook();
    const i = this.input;
    i.touchMove = [0, 0];
    i.touchJump = i.touchAttack = i.touchUse = i.touchSprint = false;
    for (const b of Array.from(this.root.querySelectorAll('.touch-btn.down'))) b.classList.remove('down');
    this.resetStickVisual();
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    const half = window.innerWidth / 2;
    for (const t of Array.from(e.changedTouches)) {
      // The hotbar: pick a slot
      const hb = this.host.hotbarRect();
      if (hb && t.clientX >= hb.left && t.clientX <= hb.right && t.clientY >= hb.top - 6 && t.clientY <= hb.bottom + 6) {
        const i = Math.max(0, Math.min(8, Math.floor(((t.clientX - hb.left) / hb.width) * 9)));
        this.host.selectSlot(i);
        continue;
      }
      if (t.clientX < half) {
        if (this.stick) continue;
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        this.base.style.left = `${t.clientX}px`;
        this.base.style.top = `${t.clientY}px`;
        this.base.classList.add('active');
        this.setKnob(0, 0);
      } else {
        if (this.look) continue;
        const l: LookTouch = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now(), moved: 0, mining: false, timer: null };
        // Holding still: start breaking (and keep looking while you do)
        l.timer = setTimeout(() => {
          l.timer = null;
          if (this.look !== l || l.moved > TAP_SLOP) return;
          l.mining = true;
          this.input.pushAction('attack');
          this.input.touchAttack = true;
        }, HOLD_MS);
        this.look = l;
      }
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        let dx = (t.clientX - this.stick.ox) / STICK_R;
        let dy = (t.clientY - this.stick.oy) / STICK_R;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        this.setKnob(dx, dy);
        const on = Math.hypot(dx, dy) > DEADZONE;
        this.input.touchMove = on ? [dx, dy] : [0, 0];
        // All the way forward: sprint
        this.input.touchSprint = dy < -0.9 && Math.abs(dx) < 0.45;
      } else if (this.look && t.identifier === this.look.id) {
        const l = this.look;
        const dx = t.clientX - l.x;
        const dy = t.clientY - l.y;
        l.x = t.clientX;
        l.y = t.clientY;
        l.moved = Math.max(l.moved, Math.hypot(t.clientX - l.sx, t.clientY - l.sy));
        this.input.addLook(dx * LOOK_SCALE, dy * LOOK_SCALE);
      }
    }
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        this.input.touchMove = [0, 0];
        this.input.touchSprint = false;
        this.resetStickVisual();
      } else if (this.look && t.identifier === this.look.id) {
        const l = this.look;
        // A quick tap: hit the mob in front of you, otherwise use / place
        if (!l.mining && performance.now() - l.t0 < TAP_MS && l.moved <= TAP_SLOP) this.input.pushAction(this.host.targetingEntity() ? 'attack' : 'use');
        this.endLook();
      }
    }
  }

  private endLook(): void {
    const l = this.look;
    if (!l) return;
    if (l.timer) clearTimeout(l.timer);
    if (l.mining) this.input.touchAttack = false;
    this.look = null;
  }

  private setKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(calc(-50% + ${dx * STICK_R}px), calc(-50% + ${dy * STICK_R}px))`;
  }

  /** At rest the stick waits, faint, in the lower left. */
  private resetStickVisual(): void {
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.setKnob(0, 0);
  }

  dispose(): void {
    this.releaseAll();
    this.root.remove();
  }
}
