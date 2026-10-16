/**
 * V7 phase 5: the limits on a dedicated server's haunting voices, the same as
 * the cloud hub's (hub/src/index.ts): a few answers a minute and an hour for
 * each world, and one daily limit for every world and character together
 * (HEROBRINE_DAILY_LIMIT). Past them the game uses the scripted lines.
 */
import { RateLimiter } from '../hub/rateLimiter';
import { HEROBRINE_DAILY_LIMIT } from '../hub/herobrineVoice';

export class VoiceBudget {
  private readonly minute = new RateLimiter(6, 60_000);
  private readonly hour = new RateLimiter(40, 3_600_000);
  private day = '';
  private used = 0;

  constructor(
    readonly daily = HEROBRINE_DAILY_LIMIT,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** One answer for `key` (a world): 'ok', or why not ('busy': too many lately; 'limit': the day's are used up). */
  take(key: string): 'ok' | 'busy' | 'limit' {
    const t = this.now();
    if (!this.minute.take(key, t) || !this.hour.take(key, t)) return 'busy';
    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.daily) return 'limit';
    this.used++;
    return 'ok';
  }
}
