/**
 * V7: the clock the Halloween season is checked against.
 *
 * Online it is the hub's time (its /api/health answer carries `now`, and its
 * HTTP Date header says the same to the second); offline it is this device's
 * clock. A wrong device clock is corrected as soon as the hub answers. Each
 * JavaScript realm (the page, the integrated server's worker) has its own
 * copy; the page hands its correction to the worker when a world starts.
 */

/** 'test': pinned by a test browser (?clock=...); nothing changes it after that. */
export type ClockSource = 'device' | 'hub' | 'test';

export class SeasonClock {
  /** Hub time minus device time (ms). */
  offset = 0;
  source: ClockSource = 'device';
  private syncing: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deviceNow: () => number = () => Date.now()) {}

  now(): number {
    return this.deviceNow() + this.offset;
  }

  /** Records the hub's time `hubMs`, as read when the device clock said `deviceMs`. */
  setReference(hubMs: number, deviceMs = this.deviceNow()): void {
    if (this.source === 'test' || !Number.isFinite(hubMs) || hubMs <= 0) return;
    const before = this.offset;
    this.offset = Math.round(hubMs - deviceMs);
    this.source = 'hub';
    if (before !== this.offset) for (const f of this.listeners) f();
  }

  /** Takes over a correction made elsewhere (the page's, in the worker). */
  adopt(offset: number, source: ClockSource): void {
    if (source === 'device' || !Number.isFinite(offset)) return;
    const before = this.offset;
    this.offset = Math.round(offset);
    this.source = source;
    if (before !== this.offset) for (const f of this.listeners) f();
  }

  /** Test browsers only: the clock reads `ms` now and runs on from there (the hub is not asked). */
  pin(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.offset = Math.round(ms - this.deviceNow());
    this.source = 'test';
    for (const f of this.listeners) f();
  }

  /** Called whenever the correction changes. */
  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** Asks the hub for its time (once at a time); false when it could not be reached. */
  sync(hubBase: string, timeoutMs = 4000): Promise<boolean> {
    if (!hubBase || typeof fetch !== 'function' || this.source === 'test') return Promise.resolve(false);
    this.syncing ??= (async () => {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
      try {
        const sent = this.deviceNow();
        const res = await fetch(`${hubBase.replace(/\/+$/, '')}/api/health`, { signal: ctrl?.signal, cache: 'no-store' });
        const got = this.deviceNow();
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* not JSON */
        }
        const t = hubTimeOf(body, res.headers.get('Date'));
        if (t === null) return false;
        // The answer was made about halfway through the round trip
        this.setReference(t, (sent + got) / 2);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
        this.syncing = null;
      }
    })();
    return this.syncing;
  }
}

/** The hub's time from its health answer (`now`, in ms) or, failing that, its Date header. */
export function hubTimeOf(body: unknown, dateHeader: string | null): number | null {
  const now = (body as { now?: unknown } | null)?.now;
  if (typeof now === 'number' && Number.isFinite(now) && now > 0) return now;
  if (dateHeader) {
    const t = Date.parse(dateHeader);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return null;
}

/** This realm's clock. */
export const seasonClock = new SeasonClock();
