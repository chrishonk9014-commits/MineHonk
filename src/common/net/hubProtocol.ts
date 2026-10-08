/**
 * Browser multiplayer through the cloud hub: the lobby WebSocket's messages
 * (presence, hosting, invites and WebRTC signaling), the relay's binary
 * records, and the framing every game transport uses (batches of game
 * messages, split into pieces small enough for a WebRTC data channel).
 */
import type { WorldVisibility } from './multiplayer';

/** What a host tells the lobby about the world it has online. */
export interface HostedWorld {
  /** Hub world id. */
  id: string;
  name: string;
  visibility: WorldVisibility;
  mode: string;
  cheats: boolean;
  players: number;
  maxPlayers: number;
  /** Game version (package version) and compatibility key (protocol + content). */
  version: string;
  compat: string;
}

export type LobbyIn =
  /** Puts a world online (or updates it). */
  | { t: 'host'; world: HostedWorld }
  | { t: 'unhost'; world: string }
  | { t: 'players'; world: string; players: number }
  /** A joiner says which world they are in (for friends' "Playing ... JOIN"). */
  | { t: 'playing'; world: string | null }
  | { t: 'signal'; to: string; world: string; sid: string; data: unknown };

/** Registry settings pushed to a host when a manager changes them through the hub. */
export interface HostSettingsPush {
  name: string;
  visibility: WorldVisibility;
  joinCode: string | null;
  allowlist: string[];
  banned: string[];
  operators: string[];
  roles: Record<string, 'builder' | 'visitor'>;
  defaultRole: 'builder' | 'visitor';
  pvp: boolean;
  cheats: boolean;
  announceAdmin: boolean;
  maxPlayers: number;
}

export type LobbyOut =
  | { t: 'welcome'; uuid: string; name: string }
  | { t: 'signal'; from: string; fromName: string; world: string; sid: string; data: unknown }
  | { t: 'invite'; from: string; fromName: string; world: string; worldName: string; cheats: boolean }
  | { t: 'hosting'; world: string; online: boolean }
  | { t: 'settings'; world: string; settings: HostSettingsPush }
  | { t: 'error'; message: string };

/** An ICE candidate as RTCPeerConnection gives it (spelled out: the hub has no WebRTC types). */
export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Signaling payloads between a joiner and a host (inside LobbyIn/LobbyOut 'signal'). */
export type SignalData =
  | { kind: 'offer'; sdp: string; ticket: string; relayOnly: boolean }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: IceCandidate | null }
  | { kind: 'refused'; reason: string };

// ---------------------------------------------------------------------------
// The relay: one WebSocket per joiner, one for the host carrying all of them
// ---------------------------------------------------------------------------

/** Records between the relay and the host: [u8 type][u32 conn][u32 length][bytes]... */
export const RELAY_DATA = 1;
export const RELAY_CLOSE = 2;
export const RELAY_OPEN = 3;

export interface RelayRecord {
  type: number;
  conn: number;
  data: Uint8Array;
}

export function encodeRelay(records: RelayRecord[]): Uint8Array {
  let n = 0;
  for (const r of records) n += 9 + r.data.length;
  const out = new Uint8Array(n);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const r of records) {
    out[o] = r.type;
    dv.setUint32(o + 1, r.conn >>> 0);
    dv.setUint32(o + 5, r.data.length);
    out.set(r.data, o + 9);
    o += 9 + r.data.length;
  }
  return out;
}

export function decodeRelay(buf: Uint8Array): RelayRecord[] | null {
  const out: RelayRecord[] = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  while (o < buf.length) {
    if (o + 9 > buf.length) return null;
    const type = buf[o]!;
    const conn = dv.getUint32(o + 1);
    const len = dv.getUint32(o + 5);
    if (o + 9 + len > buf.length) return null;
    out.push({ type, conn, data: buf.subarray(o + 9, o + 9 + len) });
    o += 9 + len;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Game framing: a batch of msgpack'd messages, cut into pieces
// ---------------------------------------------------------------------------

/** Data channels handle messages up to 64 KiB everywhere; stay well under. */
export const PIECE_BYTES = 16 * 1024;
const WHOLE = 0;
const PART = 1;
const LAST = 2;

/** Splits one payload into pieces: [u8 kind][bytes]. */
export function toPieces(payload: Uint8Array, max = PIECE_BYTES): Uint8Array[] {
  if (payload.length + 1 <= max) {
    const p = new Uint8Array(payload.length + 1);
    p[0] = WHOLE;
    p.set(payload, 1);
    return [p];
  }
  const out: Uint8Array[] = [];
  for (let o = 0; o < payload.length; o += max - 1) {
    const end = Math.min(payload.length, o + max - 1);
    const p = new Uint8Array(end - o + 1);
    p[0] = end === payload.length ? LAST : PART;
    p.set(payload.subarray(o, end), 1);
    out.push(p);
  }
  return out;
}

/** Puts pieces back together; `push` returns a whole payload when one completes. */
export class PieceJoiner {
  private parts: Uint8Array[] = [];
  private size = 0;

  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}

  push(piece: Uint8Array): Uint8Array | null {
    const kind = piece[0];
    const body = piece.subarray(1);
    if (kind === WHOLE) {
      this.parts = [];
      this.size = 0;
      return body;
    }
    this.size += body.length;
    if (this.size > this.maxBytes) throw new Error('message too large');
    this.parts.push(body.slice());
    if (kind !== LAST) return null;
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    this.parts = [];
    this.size = 0;
    return out;
  }
}
