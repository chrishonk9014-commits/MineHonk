/**
 * Keyboard, mouse (pointer lock) and gamepad input. Game code queries
 * held actions and consumes discrete "pressed" events.
 */
import type { Settings, KeyBinds } from '../settings';

export type Action = keyof KeyBinds | 'attack' | 'use' | 'pick' | `hotbar${number}` | 'scrollUp' | 'scrollDown';

export class Input {
  readonly held = new Set<string>();
  private readonly pressedQueue: Action[] = [];
  mouseDX = 0;
  mouseDY = 0;
  mouseButtons = 0;
  locked = false;
  /** When false (menus open), game actions are not reported. */
  enabled = true;
  onKeyDown: ((e: KeyboardEvent) => boolean) | null = null;
  private lastPad: boolean[] = [];
  padMove: [number, number] = [0, 0];
  padLook: [number, number] = [0, 0];
  padActive = false;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly settings: Settings,
  ) {
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseButtons = 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons |= 1 << e.button;
      if (e.button === 0) this.pressedQueue.push('attack');
      if (e.button === 2) this.pressedQueue.push('use');
      if (e.button === 1) this.pressedQueue.push('pick');
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.pressedQueue.push(e.deltaY > 0 ? 'scrollDown' : 'scrollUp');
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseButtons = 0;
        this.held.clear();
      }
    });
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.onKeyDown && this.onKeyDown(e)) return;
    if (!this.enabled) return;
    const k = this.settings.keys;
    if (e.code === 'Tab' || e.code === 'F3' || e.code === 'F5' || e.code === 'F1' || e.code === 'Slash' || (e.code === 'Space' && this.locked)) e.preventDefault();
    if (!e.repeat) {
      for (const [action, code] of Object.entries(k)) if (code === e.code) this.pressedQueue.push(action as Action);
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.pressedQueue.push(`hotbar${n - 1}`);
      }
    }
    this.held.add(e.code);
  }

  isHeld(action: keyof KeyBinds): boolean {
    if (!this.enabled) return false;
    return this.held.has(this.settings.keys[action]) || (action === 'sneak' && this.held.has('ShiftRight'));
  }

  mouseHeld(button: 0 | 1 | 2): boolean {
    return this.enabled && this.locked && (this.mouseButtons & (1 << button)) !== 0;
  }

  /** Returns and clears queued discrete actions. */
  consume(): Action[] {
    const out = this.pressedQueue.splice(0);
    return this.enabled ? out : out.filter((a) => a === 'pause' || a === 'fullscreen');
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  lock(): void {
    if (!this.locked) {
      try {
        const r = this.canvas.requestPointerLock() as unknown;
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.mouseButtons = 0;
  }

  /** Polls gamepads (standard mapping). */
  pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = pads.find((p) => p && p.connected);
    if (!gp) {
      this.padActive = false;
      return;
    }
    const dz = (v: number): number => (Math.abs(v) < 0.15 ? 0 : v);
    this.padMove = [dz(gp.axes[0] ?? 0), dz(gp.axes[1] ?? 0)];
    this.padLook = [dz(gp.axes[2] ?? 0), dz(gp.axes[3] ?? 0)];
    const btn = gp.buttons.map((b) => b.pressed);
    const edge = (i: number): boolean => !!btn[i] && !this.lastPad[i];
    if (btn.some(Boolean) || this.padMove.some((v) => v !== 0) || this.padLook.some((v) => v !== 0)) this.padActive = true;
    if (this.enabled) {
      if (edge(7)) this.pressedQueue.push('attack');
      if (edge(6)) this.pressedQueue.push('use');
      if (edge(4)) this.pressedQueue.push('scrollUp');
      if (edge(5)) this.pressedQueue.push('scrollDown');
      if (edge(3)) this.pressedQueue.push('inventory');
      if (edge(2)) this.pressedQueue.push('drop');
      if (edge(12)) this.pressedQueue.push('perspective');
    }
    if (edge(9)) this.pressedQueue.push('pause');
    this.gpJump = !!btn[0];
    this.gpSneak = !!btn[1] || !!btn[11];
    this.gpSprint = !!btn[10];
    this.gpAttack = !!btn[7];
    this.gpUse = !!btn[6];
    this.lastPad = btn;
  }
  gpJump = false;
  gpSneak = false;
  gpSprint = false;
  gpAttack = false;
  gpUse = false;
}
