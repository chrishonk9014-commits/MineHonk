/**
 * Game batches between a browser-hosted world and its players: msgpack, with
 * one leading byte saying whether it is deflated. The host deflates what is
 * worth it (chunk data shrinks several times, and the host's upload is what
 * limits how many can play); players send small batches as they are, and the
 * host never inflates anything a player sends.
 */
import { deflateSync, Inflate } from 'fflate';

const RAW = 0;
const DEFLATE = 1;
/** Small batches (movement, chat) are not worth the work. */
const MIN_DEFLATE = 512;
/** Inflated input is fed in slices, so a hostile host cannot blow it up all at once. */
const SLICE = 16 * 1024;

export function packPayload(msgpack: Uint8Array, deflate = true): Uint8Array {
  if (deflate && msgpack.length >= MIN_DEFLATE) {
    const z = deflateSync(msgpack, { level: 1 });
    if (z.length < msgpack.length * 0.9) return prefixed(DEFLATE, z);
  }
  return prefixed(RAW, msgpack);
}

/** The msgpack inside, or null when it is not acceptable (deflated when not allowed, or too large). */
export function unpackPayload(p: Uint8Array, allowDeflate: boolean, maxBytes = 16 * 1024 * 1024): Uint8Array | null {
  if (p[0] === RAW) return p.subarray(1);
  if (p[0] !== DEFLATE || !allowDeflate) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  const inf = new Inflate((chunk) => {
    size += chunk.length;
    if (size > maxBytes) throw new Error('too large');
    parts.push(chunk);
  });
  try {
    const z = p.subarray(1);
    for (let o = 0; o < z.length; o += SLICE) inf.push(z.subarray(o, Math.min(z.length, o + SLICE)), o + SLICE >= z.length);
    if (!z.length) return null;
  } catch {
    return null;
  }
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

function prefixed(kind: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = kind;
  out.set(body, 1);
  return out;
}
