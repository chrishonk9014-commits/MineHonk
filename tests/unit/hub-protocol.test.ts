/**
 * Framing for browser-hosted worlds (src/common/net/hubProtocol.ts): game
 * batches cut into pieces for data channels, and relay frames that stay
 * within what the hub's relay accepts.
 */
import { describe, it, expect } from 'vitest';
import { toPieces, PieceJoiner, PIECE_BYTES, relayFrames, decodeRelay, RELAY_MAX_FRAME, RELAY_DATA, type RelayRecord } from '../../src/common/net/hubProtocol';

const bytes = (n: number, seed = 1): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

describe('pieces', () => {
  it('cuts large payloads and puts them back together', () => {
    const j = new PieceJoiner();
    for (const n of [0, 10, PIECE_BYTES - 1, PIECE_BYTES, 100_000]) {
      const payload = bytes(n, n);
      const pieces = toPieces(payload);
      expect(pieces.every((p) => p.length <= PIECE_BYTES)).toBe(true);
      let out: Uint8Array | null = null;
      for (const p of pieces) out = j.push(p) ?? out;
      expect(out && [...out]).toEqual([...payload]);
    }
  });
});

describe('relay frames', () => {
  it('keeps every frame within the relay limit and loses nothing', () => {
    // A burst of chunk data for three players: far more than one frame holds
    const records: RelayRecord[] = [];
    for (let i = 0; i < 120; i++) records.push({ type: RELAY_DATA, conn: i % 3, data: bytes(PIECE_BYTES, i) });
    const frames = relayFrames(records);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((f) => f.length <= RELAY_MAX_FRAME)).toBe(true);
    const back = frames.flatMap((f) => decodeRelay(f)!);
    expect(back.length).toBe(records.length);
    back.forEach((r, i) => {
      expect(r.conn).toBe(records[i]!.conn);
      expect([...r.data]).toEqual([...records[i]!.data]);
    });
  });

  it('sends small batches as a single frame', () => {
    expect(relayFrames([{ type: RELAY_DATA, conn: 7, data: bytes(100) }]).length).toBe(1);
    expect(relayFrames([]).length).toBe(0);
  });
});
