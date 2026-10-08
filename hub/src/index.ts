/**
 * The MineHonk cloud hub (Cloudflare Worker): accounts, friends, the world
 * registry and join codes, join tickets, the public world list, TURN
 * credentials, and the lobby (presence, signaling) and relay WebSockets.
 *
 * Worlds run in their hosts' browsers; the hub only introduces players to
 * each other. The JSON API keeps the Node server's shapes (src/server-node),
 * so the game's HubApi talks to both.
 */
import type { Env } from './env';
import { SqlHubStore } from '../../src/hub/sqlStore';
import { AccountsCore, AccountError, deviceStretchedHasher } from '../../src/hub/accounts';
import { FriendsCore, FriendError } from '../../src/hub/friends';
import { WorldsCore, WorldError, isMember } from '../../src/hub/worlds';
import type { WorldEntry } from '../../src/hub/store';
import { RateLimiter } from '../../src/hub/rateLimiter';
import { randomBytes } from '../../src/hub/crypto';
import { generateTicketKeys, importSigningKey, signTicket, TICKET_TTL_MS, type TicketVia } from '../../src/hub/tickets';
import { ChatFilter } from '../../src/server/moderation/ChatFilter';
import { normalizeJoinCode, type AccountInfo, type FriendsResponse, type WorldSummary } from '../../src/common/net/multiplayer';
import { GAME_MODES } from '../../src/common/game/gamemode';
import type { HostSettingsPush } from '../../src/common/net/hubProtocol';
import type { HostedEntry, Presence } from './lobby';

export { LobbyDO } from './lobby';
export { RelayDO } from './relay';

const MAX_BODY = 16 * 1024;

/** One STUN or TURN server, as RTCPeerConnection takes it. */
interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
const filter = new ChatFilter([]);
// Per isolate (the shared RateLimiter logic): enough to stop floods and guessing
const authLimiter = new RateLimiter(10, 60_000);
const codeLimiter = new RateLimiter(20, 60_000);
const apiLimiter = new RateLimiter(240, 60_000);
const friendLimiter = new RateLimiter(20, 60_000);
const ticketLimiter = new RateLimiter(30, 60_000);
const socketLimiter = new RateLimiter(30, 60_000);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ CORS

function allowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) return true;
  return env.DEV === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !allowedOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

// ------------------------------------------------------------------ ticket key

let signingKey: Promise<{ key: CryptoKey; publicJwk: JsonWebKey }> | null = null;

/** The hub's ticket-signing key: made on first use and kept in the database. */
function ticketKey(env: Env): Promise<{ key: CryptoKey; publicJwk: JsonWebKey }> {
  signingKey ??= (async () => {
    let row = await env.DB.prepare('SELECT private_jwk, public_jwk FROM hub_keys WHERE id = ?').bind('ticket-v1').first<{ private_jwk: string; public_jwk: string }>();
    if (!row) {
      const k = await generateTicketKeys();
      // Two first requests may race: whichever key lands first wins
      await env.DB.prepare('INSERT OR IGNORE INTO hub_keys (id, private_jwk, public_jwk, created_at) VALUES (?, ?, ?, ?)').bind('ticket-v1', JSON.stringify(k.privateJwk), JSON.stringify(k.publicJwk), Date.now()).run();
      row = await env.DB.prepare('SELECT private_jwk, public_jwk FROM hub_keys WHERE id = ?').bind('ticket-v1').first<{ private_jwk: string; public_jwk: string }>();
    }
    if (!row) throw new Error('no ticket key');
    return { key: await importSigningKey(JSON.parse(row.private_jwk) as JsonWebKey), publicJwk: JSON.parse(row.public_jwk) as JsonWebKey };
  })();
  signingKey.catch(() => (signingKey = null));
  return signingKey;
}

// ------------------------------------------------------------------ ICE servers

async function iceServers(env: Env): Promise<IceServer[]> {
  const stun = env.STUN_URLS === 'none' ? [] : (env.STUN_URLS ?? 'stun:stun.cloudflare.com:3478').split(',').map((s) => s.trim()).filter(Boolean);
  const out: IceServer[] = stun.length ? [{ urls: stun }] : [];
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      // Short-lived credentials, minted per request: the TURN key never leaves the hub
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 4 * 3600 }),
      });
      if (r.ok) {
        const d = (await r.json()) as { iceServers?: IceServer | IceServer[] };
        const list = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
        for (const s of list) if (s && s.urls && s.username) out.push(s);
      }
    } catch {
      /* TURN unavailable: direct connections and the hub relay still work */
    }
  }
  return out;
}

// ------------------------------------------------------------------ the hub for one request

class Hub {
  readonly store: SqlHubStore;
  readonly accounts: AccountsCore;
  readonly friends: FriendsCore;
  readonly worlds: WorldsCore;
  private hosted: Map<string, HostedEntry> | null = null;

  constructor(readonly env: Env) {
    this.store = new SqlHubStore(env.DB);
    this.accounts = new AccountsCore(this.store, deviceStretchedHasher);
    this.friends = new FriendsCore(this.store);
    this.worlds = new WorldsCore(
      this.store,
      this.accounts,
      this.friends,
      filter,
      {
        players: (id) => this.hosted?.get(id)?.players ?? 0,
        extra: (id) => {
          const h = this.hosted?.get(id);
          return h ? { online: true, version: h.version, cheats: h.cheats, players: h.players, maxPlayers: h.maxPlayers } : { online: false };
        },
        changed: (e) => this.pushSettings(e),
      },
      { maxPlayers: 8, maxPlayersCap: 16 },
    );
  }

  get lobby(): DurableObjectStub<import('./lobby').LobbyDO> {
    return this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
  }

  /** The worlds online now (once per request). */
  async loadHosted(): Promise<Map<string, HostedEntry>> {
    if (!this.hosted) {
      const list = (await this.lobby.hostedWorlds()) as HostedEntry[];
      this.hosted = new Map(list.map((h) => [h.id, h]));
      this.store.publicIds = list.filter((h) => h.visibility === 'public').map((h) => h.id);
    }
    return this.hosted;
  }

  async pushSettings(e: WorldEntry): Promise<void> {
    const s: HostSettingsPush = {
      name: e.name,
      visibility: e.visibility,
      joinCode: e.joinCode,
      allowlist: e.allowlist,
      banned: e.banned,
      operators: e.operators,
      roles: e.roles,
      defaultRole: e.defaultRole,
      pvp: e.pvp,
      cheats: e.cheats === true,
      announceAdmin: e.announceAdmin !== false,
      maxPlayers: e.maxPlayers,
    };
    await this.lobby.pushSettings(e.id, s);
  }

  async auth(req: Request): Promise<{ account: AccountInfo; token: string }> {
    const h = req.headers.get('Authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const account = await this.accounts.verify(token);
    if (!account) throw new HttpError(401, 'Please log in');
    return { account, token };
  }

  async friendsOf(me: string): Promise<FriendsResponse> {
    const infos = async (ids: string[]): Promise<AccountInfo[]> => (await Promise.all(ids.map((u) => this.accounts.info(u)))).filter((x): x is AccountInfo => !!x);
    const ids = await this.friends.list(me);
    const presence = ids.length ? ((await this.lobby.presence(ids)) as Record<string, Presence>) : {};
    const hosted = await this.loadHosted();
    const friends: FriendsResponse['friends'] = [];
    for (const a of await infos(ids)) {
      const p = presence[a.uuid];
      const worldId = p?.hosting ?? p?.playing;
      let world: string | undefined;
      let joinable: string | undefined;
      let cheats: boolean | undefined;
      if (worldId && hosted.has(worldId)) {
        const e = await this.worlds.access(worldId);
        // Only worlds you may join show (Friends or Public, or you are invited)
        if (e && (await this.worlds.roleFor(e, me))) {
          world = e.name;
          joinable = worldId;
          cheats = hosted.get(worldId)!.cheats;
        }
      }
      friends.push({ ...a, online: !!p?.online, world, worldId: joinable, cheats });
    }
    friends.sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
    return { friends, incoming: await infos(await this.friends.incoming(me)), outgoing: await infos(await this.friends.outgoing(me)), blocked: await infos(await this.friends.blocked(me)) };
  }

  /** Mine (registered), friends' and public worlds; friends' and public only while their hosts are online. */
  async listWorlds(me: string): Promise<{ mine: WorldSummary[]; friends: WorldSummary[]; public: WorldSummary[] }> {
    await this.loadHosted();
    const l = await this.worlds.list(me);
    return { mine: l.mine, friends: l.friends.filter((w) => w.online), public: l.public.filter((w) => w.online) };
  }
}

// ------------------------------------------------------------------ host settings

const UUID_RE = /^[0-9a-f-]{8,64}$/i;

function uuidList(v: unknown, max = 500): string[] | null {
  if (v === undefined) return null;
  if (!Array.isArray(v)) throw new HttpError(400, 'Bad list');
  return [...new Set(v.filter((u): u is string => typeof u === 'string' && UUID_RE.test(u)))].slice(0, max);
}

/** Registers a host's world, or updates it from the host's own settings (the host is authoritative). */
async function hostWorld(hub: Hub, account: AccountInfo, b: Record<string, unknown>): Promise<unknown> {
  const existing = typeof b.id === 'string' ? await hub.store.world(b.id) : null;
  let e: WorldEntry;
  if (existing && existing.owner === account.uuid) e = existing;
  else e = await hub.worlds.newEntry(account, { name: b.name, mode: b.mode, visibility: b.visibility, cheats: b.cheats, pvp: b.pvp, defaultRole: b.defaultRole, maxPlayers: b.maxPlayers }, GAME_MODES);
  if (typeof b.name === 'string' && b.name.trim()) e.name = hub.worlds.checkName(b.name);
  if (b.visibility === 'private' || b.visibility === 'friends' || b.visibility === 'public') e.visibility = b.visibility;
  if (typeof b.mode === 'string' && b.mode.length <= 16) e.mode = b.mode;
  if (typeof b.cheats === 'boolean') e.cheats = b.cheats;
  if (typeof b.pvp === 'boolean') e.pvp = b.pvp;
  if (typeof b.announceAdmin === 'boolean') e.announceAdmin = b.announceAdmin;
  if (b.defaultRole === 'builder' || b.defaultRole === 'visitor') e.defaultRole = b.defaultRole;
  if (typeof b.maxPlayers === 'number' && Number.isFinite(b.maxPlayers)) e.maxPlayers = Math.max(2, Math.min(16, Math.floor(b.maxPlayers)));
  const allow = uuidList(b.allowlist);
  const banned = uuidList(b.banned);
  const ops = uuidList(b.operators, 100);
  if (allow) e.allowlist = allow;
  if (banned) e.banned = banned.filter((u) => u !== account.uuid);
  if (ops) e.operators = [...new Set([account.uuid, ...ops])].filter((u) => !e.banned.includes(u));
  if (b.roles && typeof b.roles === 'object') {
    e.roles = {};
    for (const [k, v] of Object.entries(b.roles as Record<string, unknown>).slice(0, 500)) if (UUID_RE.test(k) && (v === 'builder' || v === 'visitor')) e.roles[k] = v;
  }
  if (b.newCode === true || !e.joinCode) e.joinCode = await hub.worlds.newCode();
  await hub.store.putWorld(e);
  return hub.worlds.details(e.id, account.uuid);
}

// ------------------------------------------------------------------ joining

/** Checks a player may join a world now and signs their ticket. */
async function ticket(hub: Hub, account: AccountInfo, worldId: string, compat: string): Promise<unknown> {
  const e = await hub.worlds.access(worldId);
  if (!e) throw new HttpError(404, 'World not found');
  if (e.banned.includes(account.uuid)) throw new HttpError(403, "You're banned from this world");
  const role = await hub.worlds.roleFor(e, account.uuid);
  if (!role) throw new HttpError(403, 'This world is private. Ask the owner for a join code.');
  const hosted = (await hub.loadHosted()).get(worldId);
  if (!hosted) throw new HttpError(409, 'The host is offline');
  if (hosted.compat !== compat) throw new HttpError(409, 'Version mismatch — refresh the page');
  if (hosted.players >= hosted.maxPlayers && hosted.host !== account.uuid) throw new HttpError(409, 'World is full');
  const friend = e.visibility !== 'private' && (await hub.friends.areFriends(e.owner, account.uuid));
  const via: TicketVia = e.owner === account.uuid ? 'owner' : isMember(e, account.uuid) ? 'member' : friend ? 'friend' : 'public';
  // Strangers from the public list never learn each other's addresses
  const relay = via === 'public';
  const { key } = await ticketKey(hub.env);
  const t = await signTicket({ v: 1, uuid: account.uuid, name: account.name, world: worldId, exp: Date.now() + TICKET_TTL_MS, via, relay }, key);
  return { ticket: t, host: hosted.host, hostName: hosted.hostName, relayOnly: relay, iceServers: await iceServers(hub.env), world: await hub.worlds.summary(e, account.uuid, role) };
}

// ------------------------------------------------------------------ WebSockets

/** Browsers cannot send headers with a WebSocket: the session or ticket rides in the subprotocol list. */
function socketCredential(req: Request, prefix: string): string | null {
  const protos = (req.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((s) => s.trim());
  if (!protos.includes('minehonk')) return null;
  const p = protos.find((s) => s.startsWith(prefix));
  return p ? p.slice(prefix.length) : null;
}

async function socket(req: Request, url: URL, env: Env, hub: Hub, ip: string): Promise<Response> {
  if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'Expected a WebSocket');
  if (!allowedOrigin(req.headers.get('Origin'), env)) throw new HttpError(403, 'Not allowed from this site');
  if (!socketLimiter.take(ip)) throw new HttpError(429, 'Slow down a little');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[1] === 'lobby') {
    const account = await hub.accounts.verify(socketCredential(req, 'auth.'));
    if (!account) throw new HttpError(401, 'Please log in');
    const headers = new Headers(req.headers);
    headers.set('X-Uuid', account.uuid);
    headers.set('X-Name', account.name);
    return hub.lobby.fetch(new Request(req.url, { headers }));
  }
  if (parts[1] === 'relay' && parts[2] && /^[0-9a-f]{16}$/.test(parts[2])) {
    const world = parts[2];
    const stub = env.RELAY.get(env.RELAY.idFromName(world));
    const headers = new Headers(req.headers);
    const hostToken = socketCredential(req, 'auth.');
    if (hostToken) {
      const account = await hub.accounts.verify(hostToken);
      const e = account ? await hub.store.world(world) : null;
      if (!account || !e || e.owner !== account.uuid) throw new HttpError(403, 'Only the host can do that');
      headers.set('X-Role', 'host');
      headers.set('X-Uuid', account.uuid);
    } else {
      const { verifyTicket, importVerifyKey } = await import('../../src/hub/tickets');
      const { publicJwk } = await ticketKey(env);
      const claims = await verifyTicket(socketCredential(req, 'ticket.'), await importVerifyKey(publicJwk));
      if (!claims || claims.world !== world) throw new HttpError(403, 'Your join ticket expired. Try again.');
      headers.set('X-Role', 'joiner');
      headers.set('X-Uuid', claims.uuid);
      headers.set('X-Conn', String(new DataView(randomBytes(4).buffer).getUint32(0)));
    }
    return stub.fetch(new Request(req.url, { headers }));
  }
  throw new HttpError(404, 'Unknown endpoint');
}

// ------------------------------------------------------------------ the API

async function body(req: Request): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  if (!(req.headers.get('Content-Type') ?? '').startsWith('application/json')) {
    if (req.headers.get('Content-Length') === '0') return {};
    throw new HttpError(415, 'Send JSON');
  }
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Request too large');
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

async function api(req: Request, url: URL, env: Env): Promise<unknown | Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  if (!apiLimiter.take(ip)) throw new HttpError(429, 'Slow down a little');
  const hub = new Hub(env);
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  if (parts[0] === 'lobby' || parts[0] === 'relay') return socket(req, url, env, hub, ip);
  const route = `${req.method} /${parts.join('/')}`;
  const b = await body(req);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  if (route === 'GET /health') return { ok: true, name: 'MineHonk', protocol: 1, kind: 'cloud', auth: 'stretched-v1' };
  if (route === 'GET /hub-key') return { alg: 'ES256', jwk: (await ticketKey(env)).publicJwk };
  if (route === 'POST /register' || route === 'POST /login') {
    if (!authLimiter.take(ip)) throw new HttpError(429, 'Too many attempts. Wait a minute.');
    if (route === 'POST /register') return hub.accounts.register(str(b.name), str(b.password), (n) => !filter.mask(n).changed);
    return hub.accounts.login(str(b.name), str(b.password));
  }

  const { account, token } = await hub.auth(req);
  const me = account.uuid;
  switch (route) {
    case 'POST /logout':
      await hub.accounts.logout(token);
      return { ok: true };
    case 'GET /me':
      return account;
    case 'GET /friends':
      return hub.friendsOf(me);
    case 'POST /friends/request': {
      if (!friendLimiter.take(me)) throw new HttpError(429, 'Too many friend requests. Wait a minute.');
      const other = await hub.accounts.findByName(str(b.name));
      if (!other) throw new WorldError('No player with that name');
      const result = await hub.friends.request(me, other.uuid);
      return { result, ...(await hub.friendsOf(me)) };
    }
    case 'POST /friends/accept':
      await hub.friends.accept(me, str(b.uuid));
      return hub.friendsOf(me);
    case 'POST /friends/decline':
      await hub.friends.decline(me, str(b.uuid));
      return hub.friendsOf(me);
    case 'POST /friends/remove':
      await hub.friends.remove(me, str(b.uuid));
      return hub.friendsOf(me);
    case 'POST /friends/block': {
      const other = b.uuid ? await hub.accounts.info(str(b.uuid)) : await hub.accounts.findByName(str(b.name));
      if (!other) throw new WorldError('No player with that name');
      await hub.friends.block(me, other.uuid);
      return hub.friendsOf(me);
    }
    case 'POST /friends/unblock':
      await hub.friends.unblock(me, str(b.uuid));
      return hub.friendsOf(me);
    case 'GET /worlds':
      return hub.listWorlds(me);
    case 'POST /host':
      return hostWorld(hub, account, b);
    case 'POST /join': {
      if (!codeLimiter.take(ip)) throw new HttpError(429, 'Too many codes tried. Wait a minute.');
      if (!normalizeJoinCode(str(b.code))) throw new HttpError(400, 'Join codes look like ABC7-92KD');
      let r;
      try {
        r = await hub.worlds.redeem(b.code, me);
      } catch (e) {
        if (e instanceof WorldError && /No world has that code/.test(e.message)) throw new HttpError(404, 'Code not found');
        if (e instanceof WorldError && /banned/.test(e.message)) throw new HttpError(403, "You're banned from this world");
        throw e;
      }
      const hosted = (await hub.loadHosted()).get(r.entry.id);
      if (!hosted) throw new HttpError(409, 'The host is offline');
      if (hosted.players >= hosted.maxPlayers) throw new HttpError(409, 'World is full');
      return { world: { ...r.summary, online: true, players: hosted.players, maxPlayers: hosted.maxPlayers, cheats: hosted.cheats, version: hosted.version } };
    }
    case 'POST /ticket':
      if (!ticketLimiter.take(me)) throw new HttpError(429, 'Slow down a little');
      return ticket(hub, account, str(b.world), str(b.compat));
    case 'POST /ice':
      return { iceServers: await iceServers(env) };
    case 'POST /invite': {
      if (!friendLimiter.take(me)) throw new HttpError(429, 'Slow down a little');
      const to = str(b.to);
      const e = await hub.worlds.access(str(b.world));
      if (!e) throw new HttpError(404, 'World not found');
      const role = await hub.worlds.roleFor(e, me);
      if (role !== 'owner' && role !== 'operator') throw new HttpError(403, 'Only the owner or operators can invite');
      if (!(await hub.friends.areFriends(me, to)) || (await hub.friends.blockedEither(me, to))) throw new HttpError(400, 'You can only invite your friends');
      if (e.banned.includes(to)) throw new HttpError(400, 'That player is banned from this world');
      // An invitation lets them in, whatever the world's visibility
      if (!(await hub.worlds.roleFor(e, to)))
        await hub.worlds.mutate(e.id, (w) => {
          if (!w.allowlist.includes(to)) w.allowlist.push(to);
        });
      const hosted = (await hub.loadHosted()).get(e.id);
      const n = await hub.lobby.deliver(to, { t: 'invite', from: me, fromName: account.name, world: e.id, worldName: e.name, cheats: hosted?.cheats ?? e.cheats === true });
      return { ok: true, delivered: n > 0 };
    }
  }
  if (parts[0] === 'worlds' && parts[1]) {
    const id = parts[1];
    const sub = parts.slice(2).join('/');
    await hub.loadHosted();
    if (req.method === 'GET' && !sub) {
      const d = await hub.worlds.details(id, me);
      if (!d) throw new HttpError(404, 'World not found');
      return d;
    }
    if (req.method === 'PATCH' && !sub) return hub.worlds.update(id, me, b);
    if (req.method === 'DELETE' && !sub) {
      await hub.worlds.remove(id, me);
      return { ok: true };
    }
    if (req.method === 'POST' && sub === 'code') return hub.worlds.regenerateCode(id, me, b.enabled !== false);
    if (req.method === 'POST' && sub === 'role') return hub.worlds.setRole(id, me, str(b.uuid), b.role);
    if (req.method === 'POST' && sub === 'ban') return hub.worlds.ban(id, me, str(b.uuid), b.banned !== false);
  }
  throw new HttpError(404, 'Unknown endpoint');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get('Origin'), env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404, cors);
    try {
      const out = await api(req, url, env);
      if (out instanceof Response) return out;
      return json(out, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      if (e instanceof AccountError || e instanceof FriendError || e instanceof WorldError) return json({ error: e.message }, 400, cors);
      console.error(`${req.method} ${url.pathname} failed:`, (e as Error).stack ?? e);
      return json({ error: 'Something went wrong' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
