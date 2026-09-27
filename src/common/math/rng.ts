/**
 * Deterministic random number utilities.
 *
 * All world generation must go through these helpers so that a given seed
 * always produces the same world regardless of platform or load order.
 */

/** 32-bit integer hash mixer (murmur3 finalizer). */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash an arbitrary list of integers into a 32-bit unsigned value. */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < values.length; i++) {
    h = Math.imul(h ^ (values[i]! | 0), 0x27d4eb2d);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  return mix32(h);
}

/** Fast position hash used for per-block/per-chunk deterministic choices. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ Math.imul(x | 0, 0x1b873593), 0xcc9e2d51);
  h = Math.imul(h ^ Math.imul(y | 0, 0x2545f491), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(z | 0, 0x9e3779b1), 0xc2b2ae35);
  return mix32(h);
}

/** Float in [0,1) derived from hash3. */
export function hashFloat(seed: number, x: number, y: number, z: number): number {
  return hash3(seed, x, y, z) / 4294967296;
}

/** Hash a string into a 32-bit value (FNV-1a followed by mixing). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/**
 * Converts a user supplied seed string to a 32-bit world seed.
 * Numeric strings map to their integer value (folded to 32 bits) so that
 * players can share numeric seeds; any other text is hashed.
 */
export function seedFromString(input: string): number {
  const s = input.trim();
  if (s.length === 0) return (Math.random() * 4294967296) >>> 0;
  if (/^-?\d+$/.test(s)) {
    try {
      const big = BigInt(s);
      const lo = Number(big & 0xffffffffn);
      const hi = Number((big >> 32n) & 0xffffffffn);
      return mix32(lo ^ mix32(hi + 0x632be5ab)) >>> 0;
    } catch {
      /* fall through */
    }
  }
  return hashString(s);
}

/** Generates a random human friendly seed string. */
export function randomSeedString(): string {
  const n = Math.floor(Math.random() * 9e15) - 4.5e15;
  return String(n);
}

/**
 * xoshiro128** PRNG. Small, fast and statistically solid; state is four
 * 32-bit words seeded through splitmix32.
 */
export class Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number = (Math.random() * 4294967296) >>> 0) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  static fromHash(...values: number[]): Random {
    return new Random(hashInts(...values));
  }

  nextU32(): number {
    const result = Math.imul(((Math.imul(this.b, 5) << 7) | (Math.imul(this.b, 5) >>> 25)), 9);
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return result >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  bool(): boolean {
    return (this.nextU32() & 1) === 1;
  }

  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    return arr;
  }

  /** Picks an entry from a weighted list. */
  weighted<T extends { weight: number }>(entries: readonly T[]): T {
    let total = 0;
    for (const e of entries) total += e.weight;
    let r = this.next() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r < 0) return e;
    }
    return entries[entries.length - 1]!;
  }
}
