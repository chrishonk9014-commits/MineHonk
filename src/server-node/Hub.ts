/**
 * The MineHonk hub: an HTTP JSON API for accounts, friends and worlds, a
 * WebSocket endpoint (/play) that carries the game protocol, and optional
 * static hosting of the built client.
 */
import * as http from 'node:http';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import type { Connection } from '../server/net/Connection';
import type { GameServer } from '../server/GameServer';
import type { C2S, S2C } from '../common/net/protocol';
import { validateC2S } from '../common/net/validate';
import { ChatFilter } from '../server/moderation/ChatFilter';
import type { AccountInfo, FriendsResponse } from '../common/net/multiplayer';
import { Accounts, AccountError } from './Accounts';
import { Friends, FriendError } from './Friends';
import { Worlds, WorldError } from './Worlds';
import { RateLimiter } from './RateLimiter';
import { readIfExists } from './fsutil';

export interface HubOptions {
  port: number;
  host?: string;
  dataDir: string;
  /** Directory with the built client to serve (optional). */
  staticDir?: string | null;
  log?: (m: string) => void;
  maxPlayersPerWorld?: number;
  /** Behind a trusted reverse proxy: take the client IP from X-Forwarded-For. */
  trustProxy?: boolean;
  serverOptions?: { genBudgetMs?: number; chunksPerTick?: number };
}

const MAX_BODY = 16 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Game connection over a WebSocket. */
class WsConnection implements Connection {
  readonly id = randomUUID();
  constructor(
    private readonly ws: WebSocket,
    readonly remote: string,
  ) {}
  send(msg: S2C): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }
  close(reason?: string): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(4000, (reason ?? '').slice(0, 100));
  }
  get buffered(): number {
    return this.ws.bufferedAmount;
  }
}

export class Hub {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly authLimiter = new RateLimiter(10, 60_000);
  private readonly codeLimiter = new RateLimiter(20, 60_000);
  private readonly apiLimiter = new RateLimiter(240, 60_000);
  /** Accounts seen recently through the API (for friend presence). */
  private readonly lastSeen = new Map<string, number>();
  readonly log: (m: string) => void;

  private constructor(
    readonly opts: HubOptions,
    readonly accounts: Accounts,
    readonly friends: Friends,
    readonly worlds: Worlds,
    readonly filter: ChatFilter,
  ) {
    this.log = opts.log ?? ((m) => console.log(m));
  }

  static async create(opts: HubOptions): Promise<Hub> {
    const log = opts.log ?? ((m: string) => console.log(m));
    await fs.mkdir(opts.dataDir, { recursive: true });
    const extra = (await readIfExists(path.join(opts.dataDir, 'moderation', 'blocklist.txt')))?.toString('utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) ?? [];
    const filter = new ChatFilter(extra);
    const accounts = await Accounts.open(opts.dataDir, log);
    const friends = await Friends.open(opts.dataDir, log);
    const worlds = await Worlds.open({ dataDir: opts.dataDir, accounts, friends, filter, log, maxPlayers: opts.maxPlayersPerWorld, serverOptions: opts.serverOptions });
    return new Hub(opts, accounts, friends, worlds, filter);
  }

  // ------------------------------------------------------------------ lifecycle

  listen(): Promise<number> {
    const server = http.createServer((req, res) => void this.onRequest(req, res));
    this.server = server;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/play') {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws, req, url));
    });
    return new Promise((resolve) => {
      server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        this.log(`[hub] listening on port ${port}`);
        resolve(port);
      });
    });
  }

  async close(): Promise<void> {
    for (const c of this.wss?.clients ?? []) c.close(1001, 'Server shutting down');
    await this.worlds.shutdown();
    await this.accounts.flush();
    await this.friends.flush();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private ip(req: http.IncomingMessage): string {
    if (this.opts.trustProxy) {
      const f = req.headers['x-forwarded-for'];
      if (typeof f === 'string' && f) return f.split(',')[0]!.trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  // ------------------------------------------------------------------ websocket play

  private onSocket(ws: WebSocket, req: http.IncomingMessage, url: URL): void {
    const worldId = url.searchParams.get('world') ?? '';
    const conn = new WsConnection(ws, this.ip(req));
    let game: GameServer | null = null;
    let account: AccountInfo | null = null;
    let pending = false;
    let budget = 0;
    let budgetAt = Date.now();
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      // Flood protection: at most ~300 messages per second
      const now = Date.now();
      if (now - budgetAt > 1000) {
        budget = 0;
        budgetAt = now;
      }
      if (++budget > 300) {
        conn.send({ t: 'kick', reason: 'Too many packets' });
        conn.close('flood');
        return;
      }
      let msg: unknown;
      try {
        msg = decode(data as Buffer);
      } catch {
        conn.close('bad packet');
        return;
      }
      if (game) {
        game.handle(conn, msg);
        return;
      }
      if (pending) return;
      const hello = validateC2S(msg);
      if (!hello || hello.t !== 'hello') {
        conn.close('expected hello');
        return;
      }
      account = this.accounts.verify(hello.token);
      if (!account) {
        conn.send({ t: 'kick', reason: 'Please log in again.' });
        conn.close('auth');
        return;
      }
      pending = true;
      this.worlds
        .connect(conn, account, hello as C2S & { t: 'hello' }, worldId)
        .then((g) => {
          game = g;
          pending = false;
          if (!g) conn.close('join failed');
        })
        .catch((e) => {
          this.log(`[hub] join failed: ${(e as Error).stack ?? e}`);
          conn.send({ t: 'kick', reason: 'The world could not be loaded.' });
          conn.close('error');
        });
    });
    ws.on('close', () => {
      if (game) void game.disconnect(conn);
    });
    ws.on('error', () => ws.terminate());
  }

  // ------------------------------------------------------------------ http

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        const out = await this.api(req, url);
        this.json(res, 200, out);
        return;
      }
      await this.serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof HttpError) this.json(res, e.status, { error: e.message });
      else if (e instanceof AccountError || e instanceof FriendError || e instanceof WorldError) this.json(res, 400, { error: e.message });
      else {
        this.log(`[hub] ${req.method} ${url.pathname} failed: ${(e as Error).stack ?? e}`);
        this.json(res, 500, { error: 'Something went wrong' });
      }
    }
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body ?? {});
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  }

  private async body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    if (req.method === 'GET' || req.method === 'HEAD') return {};
    const type = req.headers['content-type'] ?? '';
    if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
      chunks.push(c as Buffer);
    }
    if (!size) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
  }

  private auth(req: http.IncomingMessage): { account: AccountInfo; token: string } {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const account = this.accounts.verify(token);
    if (!account) throw new HttpError(401, 'Please log in');
    this.lastSeen.set(account.uuid, Date.now());
    return { account, token };
  }

  private online(uuid: string): boolean {
    return this.worlds.presence.has(uuid) || Date.now() - (this.lastSeen.get(uuid) ?? 0) < 90_000;
  }

  private friendsOf(uuid: string): FriendsResponse {
    const info = (u: string): AccountInfo | null => this.accounts.info(u);
    return {
      friends: this.friends
        .list(uuid)
        .map((u) => {
          const a = info(u);
          if (!a) return null;
          const world = this.worlds.presence.get(u);
          const shared = world ? this.worlds.details(world, uuid) : null;
          return { ...a, online: this.online(u), world: shared ? shared.name : undefined };
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
      incoming: this.friends.incoming(uuid).map(info).filter((x): x is AccountInfo => !!x),
      outgoing: this.friends.outgoing(uuid).map(info).filter((x): x is AccountInfo => !!x),
    };
  }

  private async api(req: http.IncomingMessage, url: URL): Promise<unknown> {
    const ip = this.ip(req);
    if (!this.apiLimiter.take(ip)) throw new HttpError(429, 'Slow down a little');
    const method = req.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after 'api'
    const route = `${method} /${parts.join('/')}`;
    const b = await this.body(req);
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    if (route === 'GET /health') return { ok: true, name: 'MineHonk', protocol: 1 };
    if (route === 'POST /register' || route === 'POST /login') {
      if (!this.authLimiter.take(ip)) throw new HttpError(429, 'Too many attempts. Wait a minute.');
      if (route === 'POST /register') return this.accounts.register(str(b.name), str(b.password), (n) => !this.filter.mask(n).changed);
      return this.accounts.login(str(b.name), str(b.password));
    }

    const { account, token } = this.auth(req);
    const me = account.uuid;
    switch (route) {
      case 'POST /logout':
        this.accounts.logout(token);
        return { ok: true };
      case 'GET /me':
        return account;
      case 'GET /friends':
        return this.friendsOf(me);
      case 'POST /friends/request': {
        const other = this.accounts.findByName(str(b.name));
        if (!other) throw new WorldError('No player with that name');
        const result = this.friends.request(me, other.uuid);
        return { result, ...this.friendsOf(me) };
      }
      case 'POST /friends/accept':
        this.friends.accept(me, str(b.uuid));
        return this.friendsOf(me);
      case 'POST /friends/decline':
        this.friends.decline(me, str(b.uuid));
        return this.friendsOf(me);
      case 'POST /friends/remove':
        this.friends.remove(me, str(b.uuid));
        return this.friendsOf(me);
      case 'GET /worlds':
        return this.worlds.list(me);
      case 'POST /worlds':
        return this.worlds.create(account, b);
      case 'POST /join': {
        if (!this.codeLimiter.take(ip)) throw new HttpError(429, 'Too many codes tried. Wait a minute.');
        return this.worlds.redeem(b.code, me);
      }
    }
    if (parts[0] === 'worlds' && parts[1]) {
      const id = parts[1];
      const sub = parts.slice(2).join('/');
      if (method === 'GET' && !sub) {
        const d = this.worlds.details(id, me);
        if (!d) throw new HttpError(404, 'World not found');
        return d;
      }
      if (method === 'PATCH' && !sub) return this.worlds.update(id, me, b);
      if (method === 'DELETE' && !sub) {
        await this.worlds.remove(id, me);
        return { ok: true };
      }
      if (method === 'POST' && sub === 'code') return this.worlds.regenerateCode(id, me, b.enabled !== false);
      if (method === 'POST' && sub === 'role') return this.worlds.setRole(id, me, str(b.uuid), b.role);
      if (method === 'POST' && sub === 'ban') return this.worlds.ban(id, me, str(b.uuid), b.banned !== false);
    }
    throw new HttpError(404, 'Unknown endpoint');
  }

  // ------------------------------------------------------------------ static files

  private async serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
    const root = this.opts.staticDir;
    if (!root) throw new HttpError(404, 'Not found');
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    // Never serve anything outside the client folder
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new HttpError(404, 'Not found');
    let data = await readIfExists(file).catch(() => null);
    let served = file;
    if (!data && !path.extname(rel)) {
      served = path.join(root, 'index.html');
      data = await readIfExists(served);
    }
    if (!data) throw new HttpError(404, 'Not found');
    const type = MIME[path.extname(served)] ?? 'application/octet-stream';
    const headers: Record<string, string | number> = { 'Content-Type': type, 'Content-Length': data.length };
    if (served.includes(`${path.sep}assets${path.sep}`)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    if (type.startsWith('text/html')) {
      headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    }
    res.writeHead(200, headers);
    res.end(data);
  }
}
