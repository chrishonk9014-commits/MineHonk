/**
 * The relay: when two players cannot connect to each other directly (or a
 * public world keeps their addresses private and no TURN server is set up),
 * game traffic goes through here. One Durable Object per hosted world: the
 * host holds one WebSocket carrying every relayed player, each joiner one of
 * their own. Records between the relay and the host are framed as in
 * src/common/net/hubProtocol.ts (encodeRelay / decodeRelay).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { encodeRelay, decodeRelay, RELAY_CLOSE, RELAY_DATA, RELAY_OPEN, RELAY_MAX_FRAME } from '../../src/common/net/hubProtocol';

interface Attachment {
  role: 'host' | 'joiner';
  conn: number;
  uuid: string;
}

export class RelayDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** The host's open socket (a closing one no longer counts). */
  private host(): WebSocket | null {
    return this.ctx.getWebSockets('host').find((w) => w.readyState === 1) ?? null;
  }

  private joiner(conn: number): WebSocket | null {
    return this.ctx.getWebSockets(`j${conn}`).find((w) => w.readyState === 1) ?? null;
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 400 });
    const role = req.headers.get('X-Role');
    const uuid = req.headers.get('X-Uuid') ?? '';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (role === 'host') {
      // A host reconnecting replaces its old relay socket
      for (const old of this.ctx.getWebSockets('host')) old.close(4002, 'Replaced');
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role: 'host', conn: 0, uuid } satisfies Attachment);
    } else if (role === 'joiner') {
      const conn = Number(req.headers.get('X-Conn'));
      const host = this.host();
      if (!host || !Number.isInteger(conn)) return new Response('The host is offline', { status: 409 });
      this.ctx.acceptWebSocket(server, [`j${conn}`]);
      server.serializeAttachment({ role: 'joiner', conn, uuid } satisfies Attachment);
      host.send(encodeRelay([{ type: RELAY_OPEN, conn, data: new TextEncoder().encode(JSON.stringify({ uuid })) }]));
    } else return new Response('Bad role', { status: 400 });
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'minehonk' } });
  }

  override async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    if (typeof msg === 'string' || msg.byteLength > RELAY_MAX_FRAME) return;
    const a = ws.deserializeAttachment() as Attachment;
    if (a.role === 'joiner') {
      const host = this.host();
      if (!host) {
        ws.close(4001, 'The host left the game');
        return;
      }
      host.send(encodeRelay([{ type: RELAY_DATA, conn: a.conn, data: new Uint8Array(msg) }]));
      return;
    }
    // The host: one message carries records for any number of joiners
    const records = decodeRelay(new Uint8Array(msg));
    if (!records) return;
    for (const r of records) {
      const j = this.joiner(r.conn);
      if (!j) continue;
      if (r.type === RELAY_DATA) j.send(r.data);
      else if (r.type === RELAY_CLOSE) j.close(4000, new TextDecoder().decode(r.data).slice(0, 100));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
    if (!a) return;
    if (a.role === 'host') {
      // Only when no newer host socket took over
      if (this.host()) return;
      for (const j of this.ctx.getWebSockets()) {
        const ja = j.deserializeAttachment() as Attachment | null;
        if (ja?.role === 'joiner') j.close(4001, 'The host left the game');
      }
    } else {
      this.host()?.send(encodeRelay([{ type: RELAY_CLOSE, conn: a.conn, data: new Uint8Array(0) }]));
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error');
  }
}
