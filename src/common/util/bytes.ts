/** Growable binary writer with varint support. */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  varint(v: number): void {
    v = v >>> 0;
    this.ensure(5);
    while (v >= 0x80) {
      this.buf[this.pos++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    this.buf[this.pos++] = v;
  }

  /** Zig-zag signed varint. */
  svarint(v: number): void {
    this.varint((v << 1) ^ (v >> 31));
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  string(s: string): void {
    const enc = new TextEncoder().encode(s);
    this.varint(enc.length);
    this.bytes(enc);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class ByteReader {
  private view: DataView;
  pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private check(n: number): void {
    if (this.pos + n > this.buf.length) throw new RangeError('ByteReader: read past end');
  }

  u8(): number {
    this.check(1);
    return this.buf[this.pos++]!;
  }

  u16(): number {
    this.check(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.check(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.check(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.check(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.check(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new RangeError('ByteReader: varint too long');
  }

  svarint(): number {
    const v = this.varint();
    return (v >>> 1) ^ -(v & 1);
  }

  bytes(n: number): Uint8Array {
    this.check(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  string(): string {
    const n = this.varint();
    if (n > 1 << 20) throw new RangeError('ByteReader: string too long');
    return new TextDecoder().decode(this.bytes(n));
  }
}
