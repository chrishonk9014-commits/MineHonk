import type { LobbyDO } from './lobby';
import type { RelayDO } from './relay';

export interface Env {
  DB: D1Database;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  RELAY: DurableObjectNamespace<RelayDO>;
  /** Comma-separated sites allowed to call the hub. */
  ALLOWED_ORIGINS: string;
  /** "1" when running locally: localhost may call the hub too. */
  DEV?: string;
  /** Optional Cloudflare Realtime TURN key (two GitHub secrets, see the setup guide). */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Overrides the public STUN servers (comma-separated), or "none". */
  STUN_URLS?: string;
  /** Optional: Herobrine answers players through Claude (a GitHub secret, see the setup guide). */
  ANTHROPIC_API_KEY?: string;
  /** Which Claude model he speaks with (wrangler.toml). */
  HEROBRINE_MODEL?: string;
  /** How many answers a day, across everyone, before he falls back to his scripted lines (wrangler.toml). */
  HEROBRINE_DAILY_LIMIT?: string;
}
