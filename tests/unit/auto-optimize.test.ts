/** Auto Optimize: lowers performance settings one step at a time when, and only when, the game lags badly. */
import { describe, it, expect } from 'vitest';
import { AutoOptimizer, COOLDOWN_MS, STEPS, WINDOW_MS, undoAutoOptimize, undoCount, type Optimization } from '../../src/client/game/AutoOptimizer';
import { DEFAULT_SETTINGS, type Settings } from '../../src/client/settings';

const fresh = (o: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });

/** Plays `ms` of frames at `fps` from `t`; returns the changes made and the time reached. */
function play(opt: AutoOptimizer, t: number, fps: number, ms: number, playing = true): { t: number; changes: Optimization[] } {
  const changes: Optimization[] = [];
  const end = t + ms;
  for (; t < end; t += 1000 / fps) {
    const o = opt.frame(t, playing);
    if (o) changes.push(o);
  }
  return { t, changes };
}

describe('Auto Optimize', () => {
  it('leaves a smooth game alone, and short hiccups too', () => {
    const s = fresh();
    const opt = new AutoOptimizer(s);
    let r = play(opt, 0, 60, 60_000);
    expect(r.changes).toEqual([]);
    // Two seconds at 6 fps (a burst of chunk loading), then smooth again
    r = play(opt, r.t, 6, 2000);
    r = play(opt, r.t, 60, 20_000);
    expect(r.changes).toEqual([]);
    // Steady 25 fps is not severe lag
    expect(play(opt, r.t, 25, 30_000).changes).toEqual([]);
    expect(s).toEqual(fresh());
  });

  it('lowers one setting after five seconds of severe lag, then waits before the next', () => {
    const s = fresh({ renderDistance: 12 });
    const opt = new AutoOptimizer(s);
    let r = play(opt, 0, 10, WINDOW_MS - 300);
    expect(r.changes).toEqual([]);
    r = play(opt, r.t, 10, 600);
    expect(r.changes.map((c) => c.text)).toEqual(['Particles: Decreased']);
    expect(r.changes[0]!.fps).toBe(10);
    expect(s.particles).toBe('decreased');
    // Still lagging: nothing more until the cooldown and a new full window have passed
    r = play(opt, r.t, 10, COOLDOWN_MS + WINDOW_MS - 500);
    expect(r.changes).toEqual([]);
    r = play(opt, r.t, 10, 1000);
    expect(r.changes.map((c) => c.text)).toEqual(['Clouds: OFF']);
  });

  it('goes down the whole ladder, least noticeable first, and stops at the bottom', () => {
    const s = fresh({ renderDistance: 16 });
    const opt = new AutoOptimizer(s);
    const r = play(opt, 0, 8, 10 * 60_000);
    expect(r.changes.map((c) => c.text)).toEqual([
      'Particles: Decreased',
      'Clouds: OFF',
      'Resolution: 100% > 75%',
      'Render Distance: 16 > 8 chunks',
      'Smooth Lighting: OFF, Leaves: Fast',
      'Resolution: 75% > 60%',
      'Render Distance: 8 > 6 chunks',
      'Particles: Minimal',
      'Render Distance: 6 > 4 chunks',
      'Resolution: 60% > 50%',
    ]);
    expect(r.changes.filter((c) => c.rebuild).map((c) => c.text)).toEqual(['Smooth Lighting: OFF, Leaves: Fast']);
    expect(r.changes.at(-1)!.last).toBe(true);
    expect(opt.exhausted).toBe(true);
    expect(STEPS.every((st) => st.next(s) === null)).toBe(true);
    expect([s.renderDistance, s.resolutionScale, s.particles, s.clouds, s.smoothLighting, s.fancyLeaves]).toEqual([4, 0.5, 'minimal', false, false, false]);
  });

  it('skips what is already low', () => {
    const s = fresh({ particles: 'minimal', clouds: false, resolutionScale: 0.5, renderDistance: 6 });
    const opt = new AutoOptimizer(s);
    expect(play(opt, 0, 8, 6000).changes.map((c) => c.text)).toEqual(['Smooth Lighting: OFF, Leaves: Fast']);
  });

  it('catches bad stutter even when the average looks fine', () => {
    const s = fresh();
    const opt = new AutoOptimizer(s);
    // Every fourth frame takes 130 ms and the rest 10 ms: 25 fps on average, but it stutters badly
    const changes: Optimization[] = [];
    let t = 0;
    for (let i = 0; i < 2000 && !changes.length; i++) {
      t += i % 4 === 0 ? 130 : 10;
      const o = opt.frame(t, true);
      if (o) changes.push(o);
    }
    expect(changes.length).toBe(1);
    expect(changes[0]!.fps).toBeGreaterThanOrEqual(24);
  });

  it('only judges frames while playing, and never across a pause', () => {
    const s = fresh();
    const opt = new AutoOptimizer(s);
    // In menus or while loading: ignored, however slow
    let r = play(opt, 0, 5, 60_000, false);
    expect(r.changes).toEqual([]);
    // The tab was hidden for a minute: the gap is not a slow frame
    r = play(opt, r.t + 60_000, 60, 3000);
    r = play(opt, r.t + 30_000, 60, 3000);
    expect(r.changes).toEqual([]);
    // A teleport holds judgement while chunks load around the new spot
    opt.hold(r.t, 6000);
    r = play(opt, r.t, 5, 5900);
    expect(r.changes).toEqual([]);
  });

  it('respects a frame cap: 12 fps under a 15 fps cap is not lag, 5 fps is', () => {
    const s = fresh({ maxFps: 15 });
    const opt = new AutoOptimizer(s);
    expect(play(opt, 0, 12, 30_000).changes).toEqual([]);
    expect(play(opt, 40_000, 5, 6000).changes.length).toBe(1);
  });

  it('does nothing when switched off, or in an automated browser', () => {
    const off = fresh({ autoOptimize: false });
    expect(play(new AutoOptimizer(off), 0, 5, 60_000).changes).toEqual([]);
    const test = fresh();
    expect(play(new AutoOptimizer(test, false), 0, 5, 60_000).changes).toEqual([]);
    expect(off).toEqual(fresh({ autoOptimize: false }));
  });

  it('remembers what it lowered, and Undo puts it all back', () => {
    const s = fresh({ renderDistance: 12, resolutionScale: 0.9 });
    const opt = new AutoOptimizer(s);
    play(opt, 0, 8, 90_000);
    expect(s.renderDistance).toBeLessThan(12);
    expect(undoCount(s)).toBe(6);
    expect(s.autoOptimizeUndo).toEqual({ particles: 'all', clouds: true, resolutionScale: 0.9, renderDistance: 12, smoothLighting: true, fancyLeaves: true });
    expect(undoAutoOptimize(s)).toBe(true);
    expect(s).toEqual(fresh({ renderDistance: 12, resolutionScale: 0.9 }));
    expect(undoCount(s)).toBe(0);
    expect(undoAutoOptimize(s)).toBe(false);
  });
});
