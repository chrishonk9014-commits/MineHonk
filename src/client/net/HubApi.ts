/**
 * Client for a MineHonk hub server's JSON API. The session token lives in
 * localStorage per server address and is only ever sent to that server.
 */
import type { AccountInfo, FriendsResponse, WorldDetails, WorldSummary } from '../../common/net/multiplayer';
import { stretchPassword } from '../../hub/crypto';

/** What the cloud hub answers to POST /ticket. */
export interface TicketResponse {
  ticket: string;
  host: string;
  hostName: string;
  relayOnly: boolean;
  iceServers: RTCIceServer[];
  world: WorldSummary;
}

const SERVER_KEY = 'minehonk.server';

export class HubApi {
  token: string | null;
  account: AccountInfo | null = null;
  /** 'cloud' (the Cloudflare hub: worlds run in browsers) or 'node' (a self-hosted server). */
  kind: 'cloud' | 'node' = 'node';
  /** The hub wants passwords stretched on this device first (it never sees them). */
  stretched = false;

  constructor(readonly base: string) {
    this.token = this.load();
  }

  /** The server address the player chose ('' = the site serving the game). */
  static savedServer(): string {
    try {
      return localStorage.getItem(SERVER_KEY) ?? '';
    } catch {
      return '';
    }
  }

  static saveServer(url: string): void {
    try {
      if (url) localStorage.setItem(SERVER_KEY, url);
      else localStorage.removeItem(SERVER_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  /** Normalises "example.com:8080" into "https://example.com:8080". */
  static normalizeServer(input: string): string {
    const s = input.trim().replace(/\/+$/, '');
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    const local = /^(localhost|127\.|\[::1\])/.test(s);
    return `${local ? 'http' : 'https'}://${s}`;
  }

  private key(): string {
    return `minehonk.session:${this.base || location.origin}`;
  }

  private load(): string | null {
    try {
      return localStorage.getItem(this.key());
    } catch {
      return null;
    }
  }

  private store(token: string | null): void {
    this.token = token;
    try {
      if (token) localStorage.setItem(this.key(), token);
      else localStorage.removeItem(this.key());
    } catch {
      /* private browsing: the session lasts for this page only */
    }
  }

  private async call<T>(method: string, route: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api${route}`, {
        method,
        headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Cannot reach the server');
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.status === 401) {
      this.store(null);
      this.account = null;
    }
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Server error (${res.status})`);
    return data as T;
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.call<{ ok: boolean; name: string; kind?: string; auth?: string }>('GET', '/health');
      this.kind = r.kind === 'cloud' ? 'cloud' : 'node';
      this.stretched = r.auth === 'stretched-v1';
      return r.ok && r.name === 'MineHonk';
    } catch {
      return false;
    }
  }

  async resume(): Promise<AccountInfo | null> {
    if (!this.token) return null;
    try {
      this.account = await this.call<AccountInfo>('GET', '/me');
      return this.account;
    } catch {
      return null;
    }
  }

  /** The password as this hub wants it: as typed (Node server) or stretched on this device (cloud hub). */
  private async secret(name: string, password: string): Promise<string> {
    return this.stretched ? stretchPassword(name, password) : password;
  }

  async register(name: string, password: string): Promise<AccountInfo> {
    const r = await this.call<{ token: string; account: AccountInfo }>('POST', '/register', { name, password: await this.secret(name, password) });
    this.store(r.token);
    this.account = r.account;
    return r.account;
  }

  async login(name: string, password: string): Promise<AccountInfo> {
    const r = await this.call<{ token: string; account: AccountInfo }>('POST', '/login', { name, password: await this.secret(name, password) });
    this.store(r.token);
    this.account = r.account;
    return r.account;
  }

  async logout(): Promise<void> {
    await this.call('POST', '/logout').catch(() => {});
    this.store(null);
    this.account = null;
  }

  friends(): Promise<FriendsResponse> {
    return this.call('GET', '/friends');
  }
  requestFriend(name: string): Promise<FriendsResponse & { result: 'sent' | 'accepted' }> {
    return this.call('POST', '/friends/request', { name });
  }
  acceptFriend(uuid: string): Promise<FriendsResponse> {
    return this.call('POST', '/friends/accept', { uuid });
  }
  declineFriend(uuid: string): Promise<FriendsResponse> {
    return this.call('POST', '/friends/decline', { uuid });
  }
  removeFriend(uuid: string): Promise<FriendsResponse> {
    return this.call('POST', '/friends/remove', { uuid });
  }
  blockPlayer(who: { uuid?: string; name?: string }): Promise<FriendsResponse> {
    return this.call('POST', '/friends/block', who);
  }
  unblockPlayer(uuid: string): Promise<FriendsResponse> {
    return this.call('POST', '/friends/unblock', { uuid });
  }

  worlds(): Promise<{ mine: WorldSummary[]; friends: WorldSummary[]; public: WorldSummary[] }> {
    return this.call('GET', '/worlds');
  }
  createWorld(o: { name: string; seed?: string; mode: string; difficulty: string; visibility: string; godHearts?: unknown }): Promise<WorldDetails> {
    return this.call('POST', '/worlds', o);
  }
  world(id: string): Promise<WorldDetails> {
    return this.call('GET', `/worlds/${encodeURIComponent(id)}`);
  }
  updateWorld(id: string, patch: Record<string, unknown>): Promise<WorldDetails> {
    return this.call('PATCH', `/worlds/${encodeURIComponent(id)}`, patch);
  }
  newCode(id: string, enabled = true): Promise<WorldDetails> {
    return this.call('POST', `/worlds/${encodeURIComponent(id)}/code`, { enabled });
  }
  setRole(id: string, uuid: string, role: string): Promise<WorldDetails> {
    return this.call('POST', `/worlds/${encodeURIComponent(id)}/role`, { uuid, role });
  }
  ban(id: string, uuid: string, banned: boolean): Promise<WorldDetails> {
    return this.call('POST', `/worlds/${encodeURIComponent(id)}/ban`, { uuid, banned });
  }
  deleteWorld(id: string): Promise<{ ok: boolean }> {
    return this.call('DELETE', `/worlds/${encodeURIComponent(id)}`);
  }
  join(code: string): Promise<WorldSummary> {
    return this.call('POST', '/join', { code });
  }

  // ------------------------------------------------------------------ the cloud hub (browser hosting)

  /** Registers a hosted world, or updates its settings (the host is authoritative). */
  hostWorld(body: Record<string, unknown>): Promise<WorldDetails> {
    return this.call('POST', '/host', body);
  }
  /** A signed join ticket for a world online now. */
  ticket(world: string, compat: string): Promise<TicketResponse> {
    return this.call('POST', '/ticket', { world, compat });
  }
  async hubKey(): Promise<JsonWebKey> {
    return (await this.call<{ jwk: JsonWebKey }>('GET', '/hub-key')).jwk;
  }
  async iceServers(): Promise<RTCIceServer[]> {
    return (await this.call<{ iceServers: RTCIceServer[] }>('POST', '/ice')).iceServers;
  }
  invite(to: string, world: string): Promise<{ ok: boolean; delivered: boolean }> {
    return this.call('POST', '/invite', { to, world });
  }

  /** WebSocket URLs on the cloud hub (credentials go in the subprotocol list, never the URL). */
  socketUrl(path: string): string {
    const origin = this.base || location.origin;
    return `${origin.replace(/^http/, 'ws')}/api${path}`;
  }

  /** WebSocket URL for playing in a world. */
  playUrl(worldId: string): string {
    const origin = this.base || location.origin;
    return `${origin.replace(/^http/, 'ws')}/play?world=${encodeURIComponent(worldId)}`;
  }
}
