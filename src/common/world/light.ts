/**
 * Flood-fill light engine for sky light and block light.
 *
 * Light values are 0..15. Sky light travels straight down without loss
 * through fully transparent blocks and otherwise loses max(1, opacity) per
 * step; block light always loses max(1, opacity) per step.
 */
import { Chunk } from './chunk';
import { SECTIONS_PER_CHUNK, WORLD_HEIGHT } from './constants';
import { STATE_LIGHT, STATE_OPACITY } from '../registry/blocks';

export interface LightAccess {
  getChunk(cx: number, cz: number): Chunk | undefined;
  /** Called whenever light inside a section changes. */
  markLightDirty(cx: number, sy: number, cz: number): void;
}

class Queue {
  x = new Int32Array(1 << 14);
  y = new Int32Array(1 << 14);
  z = new Int32Array(1 << 14);
  l = new Int32Array(1 << 14);
  head = 0;
  tail = 0;

  get size(): number {
    return this.tail - this.head;
  }

  push(x: number, y: number, z: number, l: number): void {
    if (this.tail >= this.x.length) {
      if (this.head > 0) {
        const n = this.tail - this.head;
        this.x.copyWithin(0, this.head, this.tail);
        this.y.copyWithin(0, this.head, this.tail);
        this.z.copyWithin(0, this.head, this.tail);
        this.l.copyWithin(0, this.head, this.tail);
        this.head = 0;
        this.tail = n;
      }
      if (this.tail >= this.x.length * 0.75) {
        const grow = (a: Int32Array): Int32Array => {
          const b = new Int32Array(a.length * 2);
          b.set(a);
          return b;
        };
        this.x = grow(this.x);
        this.y = grow(this.y);
        this.z = grow(this.z);
        this.l = grow(this.l);
      }
    }
    const t = this.tail++;
    this.x[t] = x;
    this.y[t] = y;
    this.z[t] = z;
    this.l[t] = l;
  }

  reset(): void {
    this.head = 0;
    this.tail = 0;
  }
}

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];

export class LightEngine {
  private readonly addQ = new Queue();
  private readonly remQ = new Queue();
  private cacheChunk: Chunk | undefined;
  private cacheCx = 0x7fffffff;
  private cacheCz = 0x7fffffff;

  constructor(
    private readonly access: LightAccess,
    readonly hasSky: boolean,
  ) {}

  private chunkAt(x: number, z: number): Chunk | undefined {
    const cx = x >> 4;
    const cz = z >> 4;
    if (cx === this.cacheCx && cz === this.cacheCz) return this.cacheChunk;
    const c = this.access.getChunk(cx, cz);
    this.cacheCx = cx;
    this.cacheCz = cz;
    this.cacheChunk = c;
    return c;
  }

  /** Must be called when chunks unload so we never touch stale objects. */
  invalidateCache(): void {
    this.cacheCx = 0x7fffffff;
    this.cacheCz = 0x7fffffff;
    this.cacheChunk = undefined;
  }

  private get(c: Chunk, x: number, y: number, z: number, sky: boolean): number {
    const v = c.getLight(x & 15, y, z & 15);
    return sky ? v >> 4 : v & 15;
  }

  private set(c: Chunk, x: number, y: number, z: number, sky: boolean, level: number): void {
    const lx = x & 15;
    const lz = z & 15;
    const cur = c.getLight(lx, y, lz);
    const nv = sky ? (level << 4) | (cur & 15) : (cur & 0xf0) | level;
    if (nv === cur) return;
    c.setLightRaw(lx, y, lz, nv);
    this.access.markLightDirty(c.cx, y >> 4, c.cz);
  }

  /** Computes light for a freshly generated or loaded chunk and blends with loaded neighbours. */
  initChunk(c: Chunk): void {
    this.invalidateCache();
    const top = c.topSection();
    // Reset light arrays for all sections up to top: they get recomputed.
    for (let si = 0; si < SECTIONS_PER_CHUNK; si++) {
      if (si < top) {
        const l = c.lightArray(si);
        l.fill(0);
      } else {
        c.light[si] = null; // uniform (full sky or dark)
      }
    }
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    const q = this.addQ;
    q.reset();
    if (this.hasSky) {
      const topY = top * 16;
      // Column pass
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          let level = 15;
          for (let y = topY - 1; y >= 0; y--) {
            const op = STATE_OPACITY[c.get(x, y, z)]!;
            if (op > 0) level = Math.max(0, level - Math.max(1, op));
            if (level === 0) break;
            c.setLightRaw(x, y, z, level << 4);
          }
        }
      }
      // Seeds: lit cells that border darker cells horizontally.
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const h = c.heightmap[(z << 4) | x]!;
          let maxN = h;
          for (let d = 2; d < 6; d++) {
            const nx = x + DX[d]!;
            const nz = z + DZ[d]!;
            let nh: number;
            if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) nh = c.heightmap[(nz << 4) | nx]!;
            else {
              const nc = this.access.getChunk((bx + nx) >> 4, (bz + nz) >> 4);
              nh = nc ? nc.heightmap[(((bz + nz) & 15) << 4) | ((bx + nx) & 15)]! : h;
            }
            if (nh > maxN) maxN = nh;
          }
          const yTop = Math.min(maxN, WORLD_HEIGHT - 1);
          for (let y = Math.max(0, h - 1); y <= yTop; y++) {
            const l = c.getLight(x, y, z) >> 4;
            if (l > 1) q.push(bx + x, y, bz + z, l);
          }
        }
      }
      this.pullBorders(c, true);
      this.propagate(true);
    }
    // Block light
    q.reset();
    for (let si = 0; si < top; si++) {
      const s = c.sections[si];
      if (!s) continue;
      for (let i = 0; i < 4096; i++) {
        const e = STATE_LIGHT[s[i]!]!;
        if (e > 0) {
          const x = i & 15;
          const z = (i >> 4) & 15;
          const y = (si << 4) | (i >> 8);
          const cur = c.getLight(x, y, z);
          c.setLightRaw(x, y, z, (cur & 0xf0) | e);
          q.push(bx + x, y, bz + z, e);
        }
      }
    }
    this.pullBorders(c, false);
    this.propagate(false);
    c.lightReady = true;
    this.invalidateCache();
  }

  /** Seeds the add queue with neighbour chunk border cells so light flows in. */
  private pullBorders(c: Chunk, sky: boolean): void {
    const q = this.addQ;
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    const sides: [number, number][] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [ox, oz] of sides) {
      const n = this.access.getChunk(c.cx + ox, c.cz + oz);
      if (!n || !n.lightReady) continue;
      const top = Math.max(n.topSection(), c.topSection()) * 16;
      for (let i = 0; i < 16; i++) {
        const lx = ox === -1 ? 15 : ox === 1 ? 0 : i;
        const lz = oz === -1 ? 15 : oz === 1 ? 0 : i;
        for (let y = 0; y < top; y++) {
          const v = n.getLight(lx, y, lz);
          const l = sky ? v >> 4 : v & 15;
          if (l > 1) q.push((n.cx << 4) + lx, y, (n.cz << 4) + lz, l);
        }
      }
    }
    void bx;
    void bz;
  }

  private propagate(sky: boolean): void {
    const q = this.addQ;
    while (q.head < q.tail) {
      const h = q.head++;
      const x = q.x[h]!;
      const y = q.y[h]!;
      const z = q.z[h]!;
      const l = q.l[h]!;
      const src = this.chunkAt(x, z);
      if (!src) continue;
      // Guard against stale queue entries.
      if (this.get(src, x, y, z, sky) !== l) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d]!;
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = x + DX[d]!;
        const nz = z + DZ[d]!;
        const c = d < 2 ? src : this.chunkAt(nx, nz);
        if (!c) continue;
        const op = STATE_OPACITY[c.get(nx & 15, ny, nz & 15)]!;
        if (op >= 15) continue;
        const nl = sky && d === 0 && l === 15 && op === 0 ? 15 : l - Math.max(1, op);
        if (nl <= 0) continue;
        if (this.get(c, nx, ny, nz, sky) >= nl) continue;
        this.set(c, nx, ny, nz, sky, nl);
        q.push(nx, ny, nz, nl);
      }
    }
    q.reset();
  }

  /** Incrementally updates light after a block change at world position. */
  onBlockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    const c = this.chunkAt(x, z);
    if (!c || !c.lightReady) return;
    if (STATE_LIGHT[oldState] === STATE_LIGHT[newState] && STATE_OPACITY[oldState] === STATE_OPACITY[newState]) return;
    if (this.hasSky) this.updateChannel(c, x, y, z, true, 0, newState);
    this.updateChannel(this.chunkAt(x, z)!, x, y, z, false, STATE_LIGHT[newState]!, newState);
  }

  private updateChannel(c: Chunk, x: number, y: number, z: number, sky: boolean, emit: number, newState: number): void {
    const rem = this.remQ;
    const add = this.addQ;
    rem.reset();
    add.reset();
    const cur = this.get(c, x, y, z, sky);
    if (cur > 0) {
      this.set(c, x, y, z, sky, 0);
      rem.push(x, y, z, cur);
    }
    // Removal BFS
    while (rem.head < rem.tail) {
      const h = rem.head++;
      const rx = rem.x[h]!;
      const ry = rem.y[h]!;
      const rz = rem.z[h]!;
      const rl = rem.l[h]!;
      for (let d = 0; d < 6; d++) {
        const ny = ry + DY[d]!;
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = rx + DX[d]!;
        const nz = rz + DZ[d]!;
        const nc = this.chunkAt(nx, nz);
        if (!nc) continue;
        const nl = this.get(nc, nx, ny, nz, sky);
        if (nl === 0) continue;
        const dependent = nl < rl || (sky && d === 0 && rl === 15 && nl === 15);
        if (dependent) {
          this.set(nc, nx, ny, nz, sky, 0);
          rem.push(nx, ny, nz, nl);
          // Re-seed emitters that sat inside the removed area.
          if (!sky) {
            const e = STATE_LIGHT[nc.get(nx & 15, ny, nz & 15)]!;
            if (e > 0) {
              this.set(nc, nx, ny, nz, sky, e);
              add.push(nx, ny, nz, e);
            }
          }
        } else {
          add.push(nx, ny, nz, nl);
        }
      }
    }
    rem.reset();
    // Sky: a column that now sees the sky becomes 15 again.
    if (sky) {
      const lx = x & 15;
      const lz = z & 15;
      const cc = this.chunkAt(x, z)!;
      if (y >= cc.heightmap[(lz << 4) | lx]! - 1 && STATE_OPACITY[newState] === 0) {
        // Recompute straight-down column from the top of the affected region.
        const aboveLight = y + 1 >= WORLD_HEIGHT ? 15 : this.get(cc, x, y + 1, z, true);
        if (aboveLight === 15) {
          let yy = y;
          while (yy >= 0) {
            const op = STATE_OPACITY[cc.get(lx, yy, lz)]!;
            if (op > 0) break;
            this.set(cc, x, yy, z, true, 15);
            add.push(x, yy, z, 15);
            yy--;
          }
        }
      }
    }
    if (emit > 0) {
      const c2 = this.chunkAt(x, z)!;
      if (this.get(c2, x, y, z, sky) < emit) this.set(c2, x, y, z, sky, emit);
      add.push(x, y, z, emit);
    }
    // Pull light from neighbours into the changed cell (in case it became transparent).
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d]!;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const nx = x + DX[d]!;
      const nz = z + DZ[d]!;
      const nc = this.chunkAt(nx, nz);
      if (!nc) continue;
      const nl = this.get(nc, nx, ny, nz, sky);
      if (nl > 1) add.push(nx, ny, nz, nl);
    }
    this.propagate(sky);
  }
}
