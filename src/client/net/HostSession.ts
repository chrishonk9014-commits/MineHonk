/**
 * Browser hosting, the page side: puts the integrated server's world online
 * through the cloud hub and carries other players' traffic between their
 * transports and the server worker (src/worker/hosting.ts).
 *
 * - Direct: WebRTC data channels, set up through the hub's lobby (signaling).
 * - TURN: the same, through Cloudflare's TURN servers when the hub has a key.
 * - The hub relay: one WebSocket to the world's relay object, carrying every
 *   player who could not connect any other way.
 *
 * Public joiners (tickets marked `relay`) only ever get relayed connections,
 * so nobody sees anybody's IP address.
 */
import type { HubApi } from './HubApi';
import type { HubLobby } from './HubLobby';
import type { WorkerConnection } from './ClientConnection';
import type { WorldDetails, WorldVisibility } from '../../common/net/multiplayer';
import type { GodHearts } from '../../common/game/gamemode';
import type { LobbyOut, SignalData, HostedWorld } from '../../common/net/hubProtocol';
import { decodeRelay, relayFrames, RELAY_CLOSE, RELAY_DATA, RELAY_OPEN, type RelayRecord } from '../../common/net/hubProtocol';
import type { HostOut, LevelSettings } from '../../worker/hosting';
import { importVerifyKey, verifyTicket } from '../../hub/tickets';
import { GAME_VERSION, compatKey } from './version';

export interface HostOptions {
  name: string;
  visibility: WorldVisibility;
  maxPlayers: number;
  cheats: boolean;
  pvp: boolean;
  defaultRole: 'builder' | 'visitor';
  mode: string;
  /** God Mode's maximum health (new worlds). */
  godHearts?: GodHearts;
}

interface RtcPeer {
  kind: 'rtc';
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  uuid: string;
  name: string;
  key: string;
  cid: number;
  relayOnly: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  remoteSet: boolean;
}

interface RelayPeer {
  kind: 'relay';
  conn: number;
  cid: number;
}

type Peer = RtcPeer | RelayPeer;

const MAX_PEERS = 32;

export class HostSession {
  details: WorldDetails;
  options: HostOptions;
  /** Joiners by transport id (the server worker's remote connection ids). */
  private readonly peers = new Map<number, Peer>();
  /** RTC peers still being set up, by "joiner uuid|session id". */
  private readonly pending = new Map<string, RtcPeer>();
  private readonly relayCids = new Map<number, number>();
  private nextCid = 1;
  private relay: WebSocket | null = null;
  private relayBatch: RelayRecord[] = [];
  private relayFlush = false;
  private relayRetry = 0;
  private stopped = false;
  private offLobby: () => void;
  private ticketKey: CryptoKey | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSettings: LevelSettings | null = null;
  players = 1;
  /** Bytes sent to other players (all transports), for the bandwidth figures. */
  readonly stats = { bytesSent: 0, since: performance.now(), rtc: 0, relay: 0, relayMessagesOut: 0, relayMessagesIn: 0 };
  onChange: () => void = () => {};
  onError: (message: string) => void = () => {};
  /** The browser held the server back (a hidden tab). */
  onThrottled: (ms: number) => void = () => {};

  private constructor(
    readonly api: HubApi,
    readonly lobby: HubLobby,
    readonly conn: WorkerConnection,
    details: WorldDetails,
    options: HostOptions,
    private ice: RTCIceServer[],
  ) {
    this.details = details;
    this.options = options;
    this.offLobby = lobby.on((m) => this.onLobby(m));
    conn.onHost = (m) => this.onWorker(m);
  }

  /** Registers the world with the hub and opens it to other players. */
  static async start(api: HubApi, lobby: HubLobby, conn: WorkerConnection, opts: HostOptions & { hubId?: string; hostUuid: string }): Promise<HostSession> {
    const details = await api.hostWorld({ id: opts.hubId, name: opts.name, visibility: opts.visibility, mode: opts.mode, cheats: opts.cheats, pvp: opts.pvp, defaultRole: opts.defaultRole, maxPlayers: opts.maxPlayers });
    const [key, ice] = await Promise.all([api.hubKey(), api.iceServers().catch(() => [] as RTCIceServer[])]);
    const s = new HostSession(api, lobby, conn, details, opts, ice);
    s.ticketKey = await importVerifyKey(key);
    conn.host({ hubWorldId: details.id, hubKey: key, maxPlayers: opts.maxPlayers, hostUuid: opts.hostUuid, hostName: api.account?.name ?? 'Host' });
    // The world takes the settings chosen for hosting (visibility, cheats, who may build)
    s.pushOptions();
    s.announce();
    s.openRelay();
    return s;
  }

  get worldId(): string {
    return this.details.id;
  }

  private hosted(): HostedWorld {
    const o = this.options;
    return { id: this.details.id, name: o.name, visibility: o.visibility, mode: o.mode, cheats: o.cheats, players: this.players, maxPlayers: o.maxPlayers, version: GAME_VERSION, compat: compatKey() };
  }

  private announce(): void {
    this.lobby.send({ t: 'host', world: this.hosted() });
  }

  // ------------------------------------------------------------------ settings

  /** Changes made by the owner in the hosting panel: the world, the hub and the lobby follow. */
  async update(patch: Partial<HostOptions> & { newCode?: boolean }): Promise<void> {
    Object.assign(this.options, { ...patch, newCode: undefined });
    const o = this.options;
    this.details = await this.api.hostWorld({ id: this.details.id, name: o.name, visibility: o.visibility, mode: o.mode, cheats: o.cheats, pvp: o.pvp, defaultRole: o.defaultRole, maxPlayers: o.maxPlayers, newCode: patch.newCode === true });
    this.pushOptions();
    this.announce();
    this.onChange();
  }

  private pushOptions(): void {
    const o = this.options;
    this.conn.hostOptions({ name: o.name, visibility: o.visibility, cheats: o.cheats, pvp: o.pvp, defaultRole: o.defaultRole, maxPlayers: o.maxPlayers, joinCode: this.details.joinCode ?? null });
  }

  /** The world's own settings changed in game (/op, /ban, cheats...): the hub's registry follows. */
  private levelSettings(s: LevelSettings): void {
    this.lastSettings = s;
    const o = this.options;
    const lobbyChanged = s.name !== o.name || s.visibility !== o.visibility || s.cheats !== o.cheats;
    Object.assign(o, { name: s.name, visibility: s.visibility, cheats: s.cheats, pvp: s.pvp, defaultRole: s.defaultRole, mode: s.mode });
    if (lobbyChanged) this.announce();
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      void this.api
        .hostWorld({ id: this.details.id, name: s.name, visibility: s.visibility, mode: s.mode, cheats: s.cheats, pvp: s.pvp, defaultRole: s.defaultRole, announceAdmin: s.announceAdmin, maxPlayers: o.maxPlayers, allowlist: s.allowlist, banned: s.banned, operators: s.operators, roles: s.roles })
        .then((d) => {
          this.details = d;
          this.onChange();
        })
        .catch((e) => this.onError((e as Error).message));
    }, 400);
    this.onChange();
  }

  // ------------------------------------------------------------------ the server worker

  private onWorker(m: HostOut | { type: 'hosting'; on: boolean }): void {
    switch (m.type) {
      case 'remote_send':
        this.sendTo(m.cid, m.pieces);
        break;
      case 'remote_kick':
        this.drop(m.cid, m.reason);
        break;
      case 'players':
        this.players = m.count;
        this.lobby.send({ t: 'players', world: this.details.id, players: m.count });
        this.onChange();
        break;
      case 'level_settings':
        this.levelSettings(m.settings);
        break;
      case 'throttled':
        this.onThrottled(m.ms);
        break;
    }
  }

  private sendTo(cid: number, pieces: Uint8Array[]): void {
    const p = this.peers.get(cid);
    if (!p) return;
    let n = 0;
    for (const x of pieces) n += x.length;
    this.stats.bytesSent += n;
    if (p.kind === 'rtc') {
      this.stats.rtc += n;
      if (!p.dc || p.dc.readyState !== 'open') return;
      for (const x of pieces) p.dc.send(x as Uint8Array<ArrayBuffer>);
      this.conn.remoteBuffered(cid, p.dc.bufferedAmount);
    } else {
      this.stats.relay += n;
      for (const x of pieces) this.relayBatch.push({ type: RELAY_DATA, conn: p.conn, data: x });
      this.flushRelaySoon();
    }
  }

  private flushRelaySoon(): void {
    if (this.relayFlush) return;
    this.relayFlush = true;
    queueMicrotask(() => {
      this.relayFlush = false;
      if (!this.relayBatch.length || this.relay?.readyState !== WebSocket.OPEN) {
        this.relayBatch = [];
        return;
      }
      // Every relayed player's traffic for this moment, in as few messages as the relay takes
      for (const frame of relayFrames(this.relayBatch)) {
        this.relay.send(frame as Uint8Array<ArrayBuffer>);
        this.stats.relayMessagesOut++;
      }
      for (const cid of this.relayCids.values()) this.conn.remoteBuffered(cid, this.relay.bufferedAmount);
      this.relayBatch = [];
    });
  }

  /** The server closed a joiner's connection (kicked, left, failed to join). */
  private drop(cid: number, reason: string): void {
    const p = this.peers.get(cid);
    if (!p) return;
    this.peers.delete(cid);
    if (p.kind === 'rtc') {
      // Let the kick message reach them first
      setTimeout(() => {
        p.dc?.close();
        p.pc.close();
      }, 300);
    } else {
      this.relayCids.delete(p.conn);
      this.relayBatch.push({ type: RELAY_CLOSE, conn: p.conn, data: new TextEncoder().encode(reason.slice(0, 100)) });
      this.flushRelaySoon();
    }
    this.onChange();
  }

  /** A transport ended on its own (the joiner left or lost the connection). */
  private gone(cid: number): void {
    if (!this.peers.has(cid)) return;
    this.peers.delete(cid);
    this.conn.remoteClose(cid);
    this.onChange();
  }

  // ------------------------------------------------------------------ WebRTC

  private onLobby(m: LobbyOut): void {
    if (m.t === 'settings' && m.world === this.details.id) {
      this.options.name = m.settings.name;
      this.options.visibility = m.settings.visibility;
      this.options.cheats = m.settings.cheats;
      this.options.maxPlayers = m.settings.maxPlayers;
      this.conn.hostSettings(m.settings);
      this.onChange();
      return;
    }
    if (m.t === 'hosting' && m.world === this.details.id && !m.online && !this.stopped) {
      this.onError('This world went online from another tab or device.');
      return;
    }
    if (m.t !== 'signal' || m.world !== this.details.id) return;
    void this.onSignal(m.from, m.fromName, m.sid, m.data as SignalData).catch((e) => console.warn('[host] signaling failed', e));
  }

  private async onSignal(from: string, fromName: string, sid: string, data: SignalData): Promise<void> {
    const key = `${from}|${sid}`;
    if (data.kind === 'offer') {
      console.debug('[host] offer from', fromName);
      if (this.pending.size + this.peers.size >= MAX_PEERS) return this.refuse(from, sid, 'World is full');
      // Only joiners with a valid ticket for this world get a peer connection at all
      const claims = this.ticketKey ? await verifyTicket(data.ticket, this.ticketKey) : null;
      if (!claims || claims.world !== this.details.id || claims.uuid !== from) return this.refuse(from, sid, 'Your join ticket expired. Try again.');
      const relayOnly = claims.relay || data.relayOnly;
      const pc = new RTCPeerConnection({ iceServers: this.ice, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
      const peer: RtcPeer = { kind: 'rtc', pc, dc: null, uuid: from, name: fromName, key, cid: 0, relayOnly, pendingCandidates: [], remoteSet: false };
      this.pending.set(key, peer);
      pc.onicecandidate = (e) => this.lobby.send({ t: 'signal', to: from, world: this.details.id, sid, data: { kind: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null } });
      pc.ondatachannel = (e) => this.channel(peer, e.channel);
      pc.onconnectionstatechange = () => {
        console.debug('[host] connection to', fromName, pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.pending.delete(key);
          if (peer.cid) this.gone(peer.cid);
        }
      };
      setTimeout(() => {
        // Never connected: the joiner falls back to the relay
        if (this.pending.get(key) === peer && !peer.cid) {
          this.pending.delete(key);
          pc.close();
        }
      }, 30_000);
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      peer.remoteSet = true;
      for (const c of peer.pendingCandidates) await pc.addIceCandidate(c).catch(() => {});
      peer.pendingCandidates = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.lobby.send({ t: 'signal', to: from, world: this.details.id, sid, data: { kind: 'answer', sdp: answer.sdp ?? '' } });
      console.debug('[host] answered', fromName);
      return;
    }
    if (data.kind === 'candidate') {
      const peer = this.pending.get(key) ?? [...this.peers.values()].find((p): p is RtcPeer => p.kind === 'rtc' && p.key === key);
      if (!peer || !data.candidate) return;
      // A relay-only joiner's direct candidates are ignored (the policy would too)
      if (!peer.remoteSet) peer.pendingCandidates.push(data.candidate as RTCIceCandidateInit);
      else await peer.pc.addIceCandidate(data.candidate as RTCIceCandidateInit).catch(() => {});
    }
  }

  private refuse(to: string, sid: string, reason: string): void {
    this.lobby.send({ t: 'signal', to, world: this.details.id, sid, data: { kind: 'refused', reason } });
  }

  private channel(peer: RtcPeer, dc: RTCDataChannel): void {
    if (peer.dc || dc.label !== 'game') return;
    peer.dc = dc;
    dc.binaryType = 'arraybuffer';
    const start = (): void => {
      this.pending.delete(peer.key);
      peer.cid = this.nextCid++;
      this.peers.set(peer.cid, peer);
      this.conn.remoteOpen(peer.cid, `rtc:${peer.name}`);
      this.onChange();
    };
    if (dc.readyState === 'open') start();
    else dc.onopen = start;
    dc.onmessage = (e) => {
      if (peer.cid && e.data instanceof ArrayBuffer) this.conn.remoteData(peer.cid, new Uint8Array(e.data));
    };
    dc.onclose = () => {
      if (peer.cid) this.gone(peer.cid);
      peer.pc.close();
    };
    dc.bufferedAmountLowThreshold = 256 * 1024;
    dc.onbufferedamountlow = () => {
      if (peer.cid) this.conn.remoteBuffered(peer.cid, dc.bufferedAmount);
    };
  }

  // ------------------------------------------------------------------ the hub relay

  private openRelay(): void {
    if (this.stopped || !this.api.token) return;
    const ws = new WebSocket(this.api.socketUrl(`/relay/${this.details.id}`), ['minehonk', `auth.${this.api.token}`]);
    ws.binaryType = 'arraybuffer';
    this.relay = ws;
    ws.onopen = () => (this.relayRetry = 0);
    ws.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      this.stats.relayMessagesIn++;
      const records = decodeRelay(new Uint8Array(e.data));
      if (!records) return;
      for (const r of records) {
        if (r.type === RELAY_OPEN) {
          const cid = this.nextCid++;
          this.relayCids.set(r.conn, cid);
          this.peers.set(cid, { kind: 'relay', conn: r.conn, cid });
          this.conn.remoteOpen(cid, 'relay');
          this.onChange();
        } else {
          const cid = this.relayCids.get(r.conn);
          if (cid === undefined) continue;
          if (r.type === RELAY_DATA) this.conn.remoteData(cid, r.data.slice());
          else if (r.type === RELAY_CLOSE) {
            this.relayCids.delete(r.conn);
            this.gone(cid);
          }
        }
      }
    };
    ws.onclose = () => {
      // Relayed players lost their way in: the server lets them go
      for (const [conn, cid] of [...this.relayCids]) {
        this.relayCids.delete(conn);
        this.gone(cid);
      }
      if (this.stopped) return;
      setTimeout(() => this.openRelay(), Math.min(30_000, 1000 * 2 ** this.relayRetry++));
    };
  }

  // ------------------------------------------------------------------ the end

  /** Takes the world offline (the integrated server keeps running for the host). */
  stop(reason = 'The host stopped hosting'): void {
    if (this.stopped) return;
    this.stopped = true;
    this.offLobby();
    this.lobby.send({ t: 'unhost', world: this.details.id });
    this.conn.unhost(reason);
    for (const p of this.pending.values()) p.pc.close();
    this.pending.clear();
    for (const p of this.peers.values()) if (p.kind === 'rtc') setTimeout(() => p.pc.close(), 300);
    this.peers.clear();
    setTimeout(() => this.relay?.close(), 300);
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
  }

  /** Who is connected, by transport (for the hosting panel). */
  transports(): { rtc: number; relay: number } {
    let rtc = 0;
    let relay = 0;
    for (const p of this.peers.values()) p.kind === 'rtc' ? rtc++ : relay++;
    return { rtc, relay };
  }
}
