/**
 * Joining a browser-hosted world: the game's connection to the host's page.
 * It tries a direct WebRTC data channel first (through TURN only, for public
 * worlds), then falls back to the hub relay, so anyone can always connect.
 * The first message is the hub's join ticket; after that the game protocol is
 * exactly the same as with any server, in batches cut into pieces
 * (src/common/net/hubProtocol.ts).
 */
import { encode, decode } from '@msgpack/msgpack';
import type { C2S, S2C } from '../../common/net/protocol';
import type { ClientConnection } from './ClientConnection';
import type { HubApi, TicketResponse } from './HubApi';
import type { HubLobby } from './HubLobby';
import { PieceJoiner, toPieces, type SignalData, type LobbyOut } from '../../common/net/hubProtocol';
import { toB64url, randomBytes } from '../../hub/crypto';

export interface RemoteOptions {
  /** Skip WebRTC (tests, or a network that blocks it). */
  forceRelay?: boolean;
  /** How long a direct connection may take before the relay takes over. */
  rtcTimeoutMs?: number;
}

const hasTurn = (servers: RTCIceServer[]): boolean => servers.some((s) => [s.urls].flat().some((u) => /^turns?:/.test(u)));

export class RemoteConnection implements ClientConnection {
  readonly local = false;
  onMessage: (msg: S2C) => void = () => {};
  onClose: (reason: string) => void = () => {};
  /** How this connection ended up travelling. */
  transport: 'rtc' | 'relay' | null = null;
  private queue: C2S[] = [];
  private flushing = false;
  private readonly joiner = new PieceJoiner();
  private out: ((piece: Uint8Array) => void) | null = null;
  private closedByUs = false;
  private ended = false;
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private offLobby: (() => void) | null = null;
  readonly stats = { bytesIn: 0, bytesOut: 0, messagesOut: 0 };

  constructor(
    private readonly api: HubApi,
    private readonly lobby: HubLobby,
    private readonly t: TicketResponse,
    private readonly hello: C2S & { t: 'hello' },
    private readonly opts: RemoteOptions = {},
  ) {
    void this.connect();
  }

  private async connect(): Promise<void> {
    const direct = !this.opts.forceRelay && (!this.t.relayOnly || hasTurn(this.t.iceServers));
    if (direct) {
      try {
        await this.rtc();
        return;
      } catch (e) {
        if (this.closedByUs || this.ended) return;
        if ((e as Error).message.startsWith('refused:')) return this.end((e as Error).message.slice(8));
        console.info('[join] direct connection failed, using the relay:', (e as Error).message);
      }
    }
    try {
      await this.relay();
    } catch (e) {
      this.end((e as Error).message || 'Could not reach the host');
    }
  }

  // ------------------------------------------------------------------ WebRTC

  private rtc(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sid = toB64url(randomBytes(9));
      const world = this.t.world.id;
      const pc = new RTCPeerConnection({ iceServers: this.t.iceServers, iceTransportPolicy: this.t.relayOnly ? 'relay' : 'all' });
      this.pc = pc;
      const dc = pc.createDataChannel('game', { ordered: true });
      dc.binaryType = 'arraybuffer';
      let opened = false;
      let failed = false;
      const fail = (why: string): void => {
        if (opened || failed) return;
        failed = true;
        clearTimeout(timer);
        clearTimeout(cap);
        this.offLobby?.();
        this.offLobby = null;
        pc.close();
        this.pc = null;
        reject(new Error(why));
      };
      // The handshake gets its time from when the offer leaves (setting the game up
      // on a slow device must not eat it), within an overall limit
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cap = setTimeout(() => fail('timed out'), 30_000);
      const signal = (data: SignalData): void => this.lobby.send({ t: 'signal', to: this.t.host, world, sid, data });
      const queued: RTCIceCandidateInit[] = [];
      let remoteSet = false;
      this.offLobby = this.lobby.on((m: LobbyOut) => {
        if (m.t === 'error') {
          // The hub could not pass the offer on: say so, or go straight to the relay
          if (/offline/.test(m.message)) return fail('refused:The host is offline');
          return fail(m.message);
        }
        if (m.t !== 'signal' || m.sid !== sid || m.from !== this.t.host) return;
        const d = m.data as SignalData;
        if (d.kind === 'refused') fail(`refused:${d.reason}`);
        else if (d.kind === 'answer') {
          console.debug('[join] answer from the host');
          void pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).then(async () => {
            remoteSet = true;
            for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
          });
        } else if (d.kind === 'candidate' && d.candidate) {
          if (remoteSet) void pc.addIceCandidate(d.candidate as RTCIceCandidateInit).catch(() => {});
          else queued.push(d.candidate as RTCIceCandidateInit);
        }
      });
      pc.onicecandidate = (e) => signal({ kind: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null });
      pc.onconnectionstatechange = () => {
        console.debug('[join] connection', pc.connectionState);
        if (pc.connectionState === 'failed') {
          if (!opened) fail('failed');
          else this.end('The host left the game');
        }
      };
      dc.onopen = () => {
        opened = true;
        clearTimeout(timer);
        clearTimeout(cap);
        this.offLobby?.();
        this.offLobby = null;
        this.transport = 'rtc';
        this.out = (piece) => {
          if (dc.readyState === 'open') dc.send(piece as Uint8Array<ArrayBuffer>);
        };
        this.sendJoin();
        resolve();
      };
      dc.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.receive(new Uint8Array(e.data));
      };
      dc.onclose = () => {
        if (opened) this.end('The host left the game');
      };
      void pc
        .createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          signal({ kind: 'offer', sdp: offer.sdp ?? '', ticket: this.t.ticket, relayOnly: this.t.relayOnly });
          console.debug('[join] offer sent');
          if (!opened && !failed) timer = setTimeout(() => fail('timed out'), this.opts.rtcTimeoutMs ?? 12_000);
        })
        .catch((e) => fail(String(e)));
    });
  }

  // ------------------------------------------------------------------ the hub relay

  private relay(): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const ws = new WebSocket(this.api.socketUrl(`/relay/${this.t.world.id}`), ['minehonk', `ticket.${this.t.ticket}`]);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        console.debug(`[join] relay open after ${Math.round(performance.now() - t0)} ms`);
        opened = true;
        this.transport = 'relay';
        this.out = (piece) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(piece as Uint8Array<ArrayBuffer>);
        };
        this.sendJoin();
        resolve();
      };
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.receive(new Uint8Array(e.data));
      };
      ws.onclose = (e) => {
        if (!opened) return reject(new Error(e.code === 1006 ? 'The host is offline' : e.reason || 'The host is offline'));
        this.end(e.reason || 'The host left the game');
      };
    });
  }

  // ------------------------------------------------------------------ the game protocol

  private sendJoin(): void {
    this.write(encode({ t: 'join', ticket: this.t.ticket, hello: this.hello }));
    this.flush();
  }

  private write(payload: Uint8Array): void {
    for (const p of toPieces(payload)) {
      this.stats.bytesOut += p.length;
      this.stats.messagesOut++;
      this.out?.(p);
    }
  }

  private receive(piece: Uint8Array): void {
    this.stats.bytesIn += piece.length;
    let payload: Uint8Array | null;
    try {
      payload = this.joiner.push(piece);
    } catch {
      return this.end('Bad data from the host');
    }
    if (!payload) return;
    let batch: unknown;
    try {
      batch = decode(payload);
    } catch {
      return;
    }
    if (!Array.isArray(batch)) return;
    for (const m of batch) {
      if (this.ended) return;
      this.onMessage(m as S2C);
    }
  }

  send(msg: C2S): void {
    if (this.ended) return;
    this.queue.push(msg);
    if (!this.out || this.flushing) return;
    this.flushing = true;
    // Everything sent in one frame goes together
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushing = false;
    if (!this.out || !this.queue.length) return;
    // The hello rides in the join message
    const batch = this.queue.filter((m) => m.t !== 'hello');
    this.queue = [];
    if (batch.length) this.write(encode(batch));
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.cleanup();
    if (!this.closedByUs) this.onClose(reason);
  }

  private cleanup(): void {
    this.offLobby?.();
    this.offLobby = null;
    try {
      this.pc?.close();
    } catch {}
    try {
      this.ws?.close();
    } catch {}
  }

  close(): void {
    this.closedByUs = true;
    this.end('closed');
  }
}
