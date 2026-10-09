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

describe('payloads', () => {
  it('deflates what the host sends when it pays, and inflates it back', async () => {
    const { packPayload, unpackPayload } = await import('../../src/common/net/payload');
    // Chunk-like data: long runs of the same few values
    const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i % 4096 < 3000 ? 1 : i & 7));
    const packed = packPayload(big);
    expect(packed[0]).toBe(1);
    expect(packed.length).toBeLessThan(big.length / 4);
    expect([...unpackPayload(packed, true)!]).toEqual([...big]);
    // Small batches go as they are
    const small = bytes(100);
    expect(packPayload(small)[0]).toBe(0);
    expect([...unpackPayload(packPayload(small), true)!]).toEqual([...small]);
  });

  it('never inflates what a player sends, and refuses bombs', async () => {
    const { packPayload, unpackPayload } = await import('../../src/common/net/payload');
    const zeros = new Uint8Array(4_000_000);
    const packed = packPayload(zeros);
    expect(unpackPayload(packed, false)).toBeNull();
    expect(unpackPayload(packed, true, 1_000_000)).toBeNull();
    expect(unpackPayload(packed, true)?.length).toBe(zeros.length);
    expect(unpackPayload(Uint8Array.of(9, 1, 2), true)).toBeNull();
    expect(unpackPayload(Uint8Array.of(1, 255, 255, 255), true)).toBeNull();
  });
});
