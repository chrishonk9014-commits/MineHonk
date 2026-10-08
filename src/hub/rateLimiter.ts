/** Fixed-window rate limiter keyed by client (IP address or account); shared by the Node server and the cloud hub. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit; false when the key is over its limit for this window. */
  take(key: string, now = Date.now()): boolean {
    let h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      h = { count: 0, start: now };
      this.hits.set(key, h);
    }
    h.count++;
    if (this.hits.size > 10000) this.prune(now);
    return h.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [k, h] of this.hits) if (now - h.start >= this.windowMs) this.hits.delete(k);
  }
}
