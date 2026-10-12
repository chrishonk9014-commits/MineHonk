/**
 * Auto Optimize: when the game lags badly for several seconds in a row, it
 * lowers one performance setting at a time (the least noticeable first),
 * waits to see whether that was enough, and lowers the next one if not.
 *
 * Only frames while actually playing count: not in menus, not while the
 * world around the player is still loading, and not across a tab switch.
 * Whatever it changes is remembered, so Options > Video Settings can put it
 * all back in one click. Plain logic (no DOM), so the tests can drive it.
 */
import type { Settings } from '../settings';

/** The settings Auto Optimize may lower. */
export type OptimizedKey = 'particles' | 'clouds' | 'resolutionScale' | 'renderDistance' | 'smoothLighting' | 'fancyLeaves';
export type OptimizedValues = Partial<Pick<Settings, OptimizedKey>>;

/** Severe lag: fewer frames a second than this, on average over the window. */
export const LAG_FPS = 20;
/** ...or this share of frames taking longer than HITCH_MS (bad stutter even when the average looks fine). */
export const HITCH_SHARE = 0.2;
export const HITCH_MS = 120;
/** How long the lag must last before anything changes. */
export const WINDOW_MS = 5000;
/** After a change, how long to wait (chunks rebuild, things settle) before judging again. */
export const COOLDOWN_MS = 10000;
/** Frames further apart than this are a pause (another tab, a sleeping laptop), not lag. */
const GAP_MS = 2000;

interface Step {
  /** What the player is told (with the old and new values filled in). */
  describe: (from: OptimizedValues, to: OptimizedValues) => string;
  /** The new values, or null when this step has nothing left to lower. */
  next: (s: Settings) => OptimizedValues | null;
  /** The world's chunks must be rebuilt (lighting and leaves are baked into them). */
  rebuild?: boolean;
}

const lowerTo = (key: 'resolutionScale' | 'renderDistance', max: number) => (s: Settings): OptimizedValues | null => (s[key] > max ? { [key]: max } : null);
const pct = (v: number | undefined): string => `${Math.round((v ?? 1) * 100)}%`;

/** From least to most noticeable. */
export const STEPS: readonly Step[] = [
  { next: (s) => (s.particles === 'all' ? { particles: 'decreased' } : null), describe: () => 'Particles: Decreased' },
  { next: (s) => (s.clouds ? { clouds: false } : null), describe: () => 'Clouds: OFF' },
  { next: lowerTo('resolutionScale', 0.75), describe: (a, b) => `Resolution: ${pct(a.resolutionScale)} > ${pct(b.resolutionScale)}` },
  { next: lowerTo('renderDistance', 8), describe: (a, b) => `Render Distance: ${a.renderDistance} > ${b.renderDistance} chunks` },
  {
    next: (s) => (s.smoothLighting || s.fancyLeaves ? { smoothLighting: false, fancyLeaves: false } : null),
    describe: () => 'Smooth Lighting: OFF, Leaves: Fast',
    rebuild: true,
  },
  { next: lowerTo('resolutionScale', 0.6), describe: (a, b) => `Resolution: ${pct(a.resolutionScale)} > ${pct(b.resolutionScale)}` },
  { next: lowerTo('renderDistance', 6), describe: (a, b) => `Render Distance: ${a.renderDistance} > ${b.renderDistance} chunks` },
  { next: (s) => (s.particles !== 'minimal' ? { particles: 'minimal' } : null), describe: () => 'Particles: Minimal' },
  { next: lowerTo('renderDistance', 4), describe: (a, b) => `Render Distance: ${a.renderDistance} > ${b.renderDistance} chunks` },
  { next: lowerTo('resolutionScale', 0.5), describe: (a, b) => `Resolution: ${pct(a.resolutionScale)} > ${pct(b.resolutionScale)}` },
];

export interface Optimization {
  /** What changed, for the player ("Render Distance: 12 > 8 chunks"). */
  text: string;
  /** The frame rate that set it off. */
  fps: number;
  rebuild: boolean;
  /** No step is left after this one. */
  last: boolean;
}

export class AutoOptimizer {
  /** Frame times (ms) and when they ended, while playing. */
  private frames: { t: number; dt: number }[] = [];
  private lastAt = -1;
  private holdUntil = 0;
  /** Said once: nothing is left to lower. */
  exhausted = false;

  constructor(
    private readonly settings: Settings,
    /** False in automated browsers (tests, benchmarks), unless they ask for it. */
    private readonly allowed = true,
  ) {}

  get enabled(): boolean {
    return this.allowed && this.settings.autoOptimize;
  }

  /** Nothing is judged until `ms` from now (joining, a teleport, a new dimension, a respawn). */
  hold(now: number, ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, now + ms);
    this.frames.length = 0;
  }

  /**
   * Called every rendered frame. `playing` is false in menus, while loading,
   * or with the tab hidden; those frames are not judged.
   */
  frame(now: number, playing: boolean): Optimization | null {
    const dt = this.lastAt < 0 ? 0 : now - this.lastAt;
    this.lastAt = now;
    if (!this.enabled || !playing || dt <= 0 || dt > GAP_MS) {
      this.frames.length = 0;
      return null;
    }
    if (now < this.holdUntil) return null;
    this.frames.push({ t: now, dt });
    while (this.frames.length && this.frames[0]!.t < now - WINDOW_MS) this.frames.shift();
    // The window must be full: the oldest frame began a whole window ago
    const first = this.frames[0]!;
    const span = now - (first.t - first.dt);
    if (span < WINDOW_MS) return null;
    const fps = (this.frames.length * 1000) / span;
    const hitches = this.frames.filter((f) => f.dt > HITCH_MS).length / this.frames.length;
    // A frame cap is the player's choice, not lag: judge against what the cap allows
    const cap = this.settings.maxFps > 0 ? this.settings.maxFps : Infinity;
    const lagFps = Math.min(LAG_FPS, cap * 0.6);
    if (fps >= lagFps && hitches < HITCH_SHARE) return null;
    const done = this.optimize(Math.round(fps));
    this.hold(now, COOLDOWN_MS);
    return done;
  }

  /** Lowers the next setting that can be lowered; remembers the original for Undo. */
  private optimize(fps: number): Optimization | null {
    const s = this.settings;
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i]!;
      const to = step.next(s);
      if (!to) continue;
      const from: OptimizedValues = {};
      const undo: OptimizedValues = { ...(s.autoOptimizeUndo ?? {}) };
      for (const k of Object.keys(to) as OptimizedKey[]) {
        (from as Record<string, unknown>)[k] = s[k];
        if (!(k in undo)) (undo as Record<string, unknown>)[k] = s[k];
      }
      Object.assign(s, to);
      s.autoOptimizeUndo = undo;
      const last = !STEPS.slice(i + 1).some((x) => x.next(s));
      if (last) this.exhausted = true;
      return { text: step.describe(from, to), fps, rebuild: !!step.rebuild, last };
    }
    this.exhausted = true;
    return null;
  }
}

/** What Undo would put back, for the Video Settings button ("Undo Auto Optimize (3)"). */
export function undoCount(s: Settings): number {
  return Object.keys(s.autoOptimizeUndo ?? {}).length;
}

/** Puts back everything Auto Optimize lowered. Returns whether the chunks must be rebuilt. */
export function undoAutoOptimize(s: Settings): boolean {
  const u = s.autoOptimizeUndo;
  if (!u) return false;
  const rebuild = ('smoothLighting' in u && u.smoothLighting !== s.smoothLighting) || ('fancyLeaves' in u && u.fancyLeaves !== s.fancyLeaves);
  Object.assign(s, u);
  s.autoOptimizeUndo = null;
  return rebuild;
}
