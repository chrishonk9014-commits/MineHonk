/**
 * The lobby: one Durable Object holding every signed-in player's WebSocket.
 * It knows who is online, which worlds are being hosted right now (and by
 * whom), forwards WebRTC signaling between joiners and hosts, and delivers
 * invites and settings changes.
 *
 * The sockets use the hibernation API: a quiet lobby is evicted from memory
 * and costs nothing; everything it needs lives in each socket's attachment.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import type { HostedWorld, LobbyIn, LobbyOut, HostSettingsPush } from '../../src/common/net/hubProtocol';
import { RateLimiter } from '../../src/hub/rateLimiter';

interface Attachment {
  uuid: string;
  name: string;
  hosting: HostedWorld | null;
  playing: string | null;
}

export interface HostedEntry extends HostedWorld {
  host: string;
  hostName: string;
}

export interface Presence {
  online: boolean;
  /** The world they host, if any. */
  hosting?: string;
  /** The world they play in as a guest, if they said. */
  playing?: string;
}

const MAX_MESSAGE = 16 * 1024;

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

/** A host's world description, checked field by field. */
function sanitizeHosted(w: unknown): HostedWorld | null {
  const h = w as Partial<HostedWorld>;
  if (!h || typeof h !== 'object') return null;
  const id = str(h.id, 32);
  const name = str(h.name, 48);
  const mode = str(h.mode, 16);
  const version = str(h.version, 24);
  const compat = str(h.compat, 64);
  if (!id || !/^[0-9a-f]{16}$/.test(id) || !name || !mode || !version || !compat) return null;
  if (h.visibility !== 'private' && h.visibility !== 'friends' && h.visibility !== 'public') return null;
  const max = typeof h.maxPlayers === 'number' && Number.isFinite(h.maxPlayers) ? Math.max(2, Math.min(16, Math.floor(h.maxPlayers))) : 8;
  const players = typeof h.players === 'number' && Number.isFinite(h.players) ? Math.max(0, Math.min(max, Math.floor(h.players))) : 1;
  return { id, name, visibility: h.visibility, mode, cheats: h.cheats === true, players, maxPlayers: max, version, compat };
}

export class LobbyDO extends DurableObject<Env> {
  /** Signaling flood protection, per socket (resets if the lobby hibernates, which is fine). */
  private readonly limits = new RateLimiter(240, 60_000);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private att(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private send(ws: WebSocket, m: LobbyOut): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* closed */
    }
  }

  /** A verified player's lobby connection (the Worker checked the session). */
  override async fetch(req: Request): Promise<Response> {
    const uuid = req.headers.get('X-Uuid');
    const name = req.headers.get('X-Name');
    if (!uuid || !name || req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [uuid]);
    const a: Attachment = { uuid, name, hosting: null, playing: null };
    server.serializeAttachment(a);
    this.send(server, { t: 'welcome', uuid, name });
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'minehonk' } });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    const a = this.att(ws);
    if (!this.limits.take(`${a.uuid}`)) {
      this.send(ws, { t: 'error', message: 'Slow down a little' });
      return;
    }
    let m: LobbyIn;
    try {
      m = JSON.parse(raw) as LobbyIn;
    } catch {
      return;
    }
    switch (m?.t) {
      case 'host': {
        const w = sanitizeHosted(m.world);
        if (!w) return this.send(ws, { t: 'error', message: 'Bad world description' });
        // Only the world's owner (in the registry) may put it online
        const row = await this.env.DB.prepare('SELECT owner FROM worlds WHERE id = ?').bind(w.id).first<{ owner: string }>();
        if (!row || row.owner !== a.uuid) return this.send(ws, { t: 'error', message: 'You can only host your own worlds' });
        // One host per world: an older tab hosting the same world stops
        for (const other of this.ctx.getWebSockets()) {
          if (other === ws) continue;
          const oa = this.att(other);
          if (oa.hosting?.id === w.id) {
            oa.hosting = null;
            other.serializeAttachment(oa);
            this.send(other, { t: 'hosting', world: w.id, online: false });
          }
        }
        a.hosting = w;
        ws.serializeAttachment(a);
        this.send(ws, { t: 'hosting', world: w.id, online: true });
        return;
      }
      case 'unhost':
        if (a.hosting && a.hosting.id === m.world) {
          a.hosting = null;
          ws.serializeAttachment(a);
          this.send(ws, { t: 'hosting', world: m.world, online: false });
        }
        return;
      case 'players':
        if (a.hosting && a.hosting.id === m.world && typeof m.players === 'number') {
          a.hosting.players = Math.max(0, Math.min(a.hosting.maxPlayers, Math.floor(m.players)));
          ws.serializeAttachment(a);
        }
        return;
      case 'playing':
        a.playing = typeof m.world === 'string' && /^[0-9a-f]{16}$/.test(m.world) ? m.world : null;
        ws.serializeAttachment(a);
        return;
      case 'signal': {
        const to = str(m.to, 64);
        const world = str(m.world, 32);
        const sid = str(m.sid, 64);
        if (!to || !world || !sid) return;
        // Joiner -> the world's host, or the world's host -> a joiner
        const targets = this.ctx.getWebSockets(to);
        const toHost = targets.some((t) => this.att(t).hosting?.id === world);
        const fromHost = a.hosting?.id === world;
        if (!toHost && !fromHost) return this.send(ws, { t: 'error', message: 'The host is offline' });
        const out: LobbyOut = { t: 'signal', from: a.uuid, fromName: a.name, world, sid, data: m.data };
        for (const t of targets) if (!toHost || this.att(t).hosting?.id === world) this.send(t, out);
        return;
      }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      /* already closed */
    }
  }

  // ------------------------------------------------------------------ calls from the Worker

  /** Every world being hosted right now. */
  hostedWorlds(): HostedEntry[] {
    const out: HostedEntry[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a.hosting) out.push({ ...a.hosting, host: a.uuid, hostName: a.name });
    }
    return out;
  }

  /** Online status of some players. */
  presence(uuids: string[]): Record<string, Presence> {
    const out: Record<string, Presence> = {};
    for (const u of uuids.slice(0, 500)) {
      const socks = this.ctx.getWebSockets(u);
      if (!socks.length) continue;
      const p: Presence = { online: true };
      for (const ws of socks) {
        const a = this.att(ws);
        if (a.hosting) p.hosting = a.hosting.id;
        if (a.playing) p.playing = a.playing;
      }
      out[u] = p;
    }
    return out;
  }

  /** Sends a message to every lobby socket of a player; how many got it. */
  deliver(to: string, m: LobbyOut): number {
    const socks = this.ctx.getWebSockets(to);
    for (const ws of socks) this.send(ws, m);
    return socks.length;
  }

  /** Registry settings changed through the hub: tell the world's host. */
  pushSettings(world: string, settings: HostSettingsPush): void {
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a.hosting?.id !== world) continue;
      a.hosting = { ...a.hosting, name: settings.name, visibility: settings.visibility, cheats: settings.cheats, maxPlayers: settings.maxPlayers };
      ws.serializeAttachment(a);
      this.send(ws, { t: 'settings', world, settings });
    }
  }
}
