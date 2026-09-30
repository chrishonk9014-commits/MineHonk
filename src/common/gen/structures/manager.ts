/**
 * Structure placement. Each structure type places at most one start per
 * region of `spacing` x `spacing` chunks (at a seeded position inside the
 * region, kept `separation` chunks from the region edge). A start is planned
 * once into pieces with world bounding boxes; every chunk intersecting a
 * piece builds the part of it that lies inside the chunk.
 */
import { Random, hashInts } from '../../math/rng';
import type { DecorView } from '../decorate/view';
import type { Biome } from '../../registry/biomes';

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export interface Piece {
  box: Box;
  build(v: DecorView): void;
}

export interface Start {
  type: string;
  x: number;
  y: number;
  z: number;
  pieces: Piece[];
  bounds: Box;
  /** Entities to spawn when the chunk containing them is first generated. */
  entities?: { type: string; x: number; y: number; z: number; data?: Record<string, unknown> }[];
  /** V4: the structure's objective (puzzles, the bunker), with world positions. */
  quest?: QuestSpec;
}

type Pos = [number, number, number];
/** A structure's objective (V4). The server checks it as blocks change and players use things. */
export type QuestSpec =
  /** Set every lever to match its glyph: `on` lists the levers that must be on. */
  | { kind: 'levers'; levers: { at: Pos; on: boolean }[]; door: Pos[] }
  /** Light every brazier (campfire). */
  | { kind: 'braziers'; braziers: Pos[]; door: Pos[] }
  /** Keycard opens the security doors, both generators open the blast door to the vault. */
  | { kind: 'bunker'; reader: Pos; doors: Pos[]; generators: Pos[]; blast: Pos[]; vault: Pos; area: Box };

export interface PlanContext {
  seed: number;
  /** Top solid block y (pure terrain) at a column. */
  groundY(x: number, z: number): number;
  /** Whether the top of the column is liquid. */
  isWater(x: number, z: number): boolean;
  biome(x: number, z: number): Biome;
  /** Cheap climate-only estimates (no chunk generation). */
  estimateHeight(x: number, z: number): number;
  estimateBiome(x: number, z: number): Biome;
  /** How strongly a column lies in the deep dark (V2 worlds; > ~0.36 is deep dark). */
  deepDark?(x: number, z: number): number;
}

export interface StructureType {
  id: string;
  spacing: number;
  separation: number;
  salt: number;
  /** Largest distance (in chunks) a start's pieces may extend from its chunk. */
  radius: number;
  /** Quick check using climate estimates before full planning. */
  candidate(ctx: PlanContext, x: number, z: number, rng: Random): boolean;
  plan(ctx: PlanContext, cx: number, cz: number, rng: Random): Start | null;
  /** Fixed start chunks instead of the region grid (e.g. strongholds on rings). */
  fixed?(seed: number): [number, number][];
}

export function boxOf(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1) };
}

export function unionBoxes(boxes: Box[]): Box {
  const b = { ...boxes[0]! };
  for (const o of boxes) {
    b.x0 = Math.min(b.x0, o.x0);
    b.y0 = Math.min(b.y0, o.y0);
    b.z0 = Math.min(b.z0, o.z0);
    b.x1 = Math.max(b.x1, o.x1);
    b.y1 = Math.max(b.y1, o.y1);
    b.z1 = Math.max(b.z1, o.z1);
  }
  return b;
}

function intersectsChunk(b: Box, cx: number, cz: number): boolean {
  const x0 = cx << 4;
  const z0 = cz << 4;
  return b.x1 >= x0 && b.x0 < x0 + 16 && b.z1 >= z0 && b.z0 < z0 + 16;
}

export class StructureManager {
  private readonly starts = new Map<string, Start | null>();
  private readonly order: string[] = [];
  private readonly fixedCache = new Map<string, [number, number][]>();

  constructor(
    readonly seed: number,
    readonly types: StructureType[],
    private readonly ctx: PlanContext,
    private readonly enabled: () => boolean = () => true,
    /**
     * V4: a start is dropped when it would overlap (with a few blocks to spare)
     * a start of a type listed before it, so structures never grow into each other.
     */
    private readonly avoidOverlap = false,
  ) {}

  /** The chunk a type's start would occupy in a region. */
  startChunk(t: StructureType, rx: number, rz: number): [number, number] {
    const rng = new Random(hashInts(this.seed, rx, rz, t.salt));
    const span = Math.max(1, t.spacing - t.separation);
    return [rx * t.spacing + rng.int(span), rz * t.spacing + rng.int(span)];
  }

  private fixedStarts(t: StructureType): [number, number][] {
    let l = this.fixedCache.get(t.id);
    if (!l) {
      l = t.fixed!(this.seed);
      this.fixedCache.set(t.id, l);
    }
    return l;
  }

  private startAt(t: StructureType, rx: number, rz: number, fixed?: [number, number]): Start | null {
    const key = `${t.id}:${rx},${rz}`;
    if (this.starts.has(key)) return this.starts.get(key)!;
    const [cx, cz] = fixed ?? this.startChunk(t, rx, rz);
    const rng = new Random(hashInts(this.seed, cx, cz, t.salt ^ 0x5717));
    let s: Start | null = null;
    if (t.candidate(this.ctx, (cx << 4) + 8, (cz << 4) + 8, rng)) s = t.plan(this.ctx, cx, cz, rng);
    if (s && this.avoidOverlap && this.overlapsEarlier(t, s)) s = null;
    this.starts.set(key, s);
    this.order.push(key);
    if (this.order.length > 512) this.starts.delete(this.order.shift()!);
    return s;
  }

  /** Whether a start overlaps any start of a type listed before its own. */
  private overlapsEarlier(t: StructureType, s: Start): boolean {
    const idx = this.types.indexOf(t);
    const pad = 3;
    const b = s.bounds;
    for (let i = 0; i < idx; i++) {
      const o = this.types[i]!;
      if (o.fixed) continue;
      const r = o.radius;
      const cx0 = (b.x0 >> 4) - r;
      const cx1 = (b.x1 >> 4) + r;
      const cz0 = (b.z0 >> 4) - r;
      const cz1 = (b.z1 >> 4) + r;
      for (let rx = Math.floor(cx0 / o.spacing); rx <= Math.floor(cx1 / o.spacing); rx++)
        for (let rz = Math.floor(cz0 / o.spacing); rz <= Math.floor(cz1 / o.spacing); rz++) {
          const os = this.startAt(o, rx, rz);
          if (!os) continue;
          const ob = os.bounds;
          if (ob.x0 - pad <= b.x1 && ob.x1 + pad >= b.x0 && ob.z0 - pad <= b.z1 && ob.z1 + pad >= b.z0 && ob.y0 <= b.y1 && ob.y1 >= b.y0) return true;
        }
    }
    return false;
  }

  /** All starts of all types whose bounds intersect the chunk. */
  startsFor(cx: number, cz: number): Start[] {
    if (!this.enabled()) return [];
    const out: Start[] = [];
    for (const t of this.types) {
      const r = t.radius;
      if (t.fixed) {
        this.fixedStarts(t).forEach((fc, i) => {
          if (Math.abs(fc[0] - cx) > r || Math.abs(fc[1] - cz) > r) return;
          const s = this.startAt(t, i, 0, fc);
          if (s && intersectsChunk(s.bounds, cx, cz)) out.push(s);
        });
        continue;
      }
      const rx0 = Math.floor((cx - r) / t.spacing);
      const rx1 = Math.floor((cx + r) / t.spacing);
      const rz0 = Math.floor((cz - r) / t.spacing);
      const rz1 = Math.floor((cz + r) / t.spacing);
      for (let rx = rx0; rx <= rx1; rx++)
        for (let rz = rz0; rz <= rz1; rz++) {
          const [scx, scz] = this.startChunk(t, rx, rz);
          if (Math.abs(scx - cx) > r || Math.abs(scz - cz) > r) continue;
          const s = this.startAt(t, rx, rz);
          if (s && intersectsChunk(s.bounds, cx, cz)) out.push(s);
        }
    }
    return out;
  }

  /** Builds all structure pieces intersecting the view's chunk. */
  build(v: DecorView): Start[] {
    const cx = v.target.cx;
    const cz = v.target.cz;
    const starts = this.startsFor(cx, cz);
    for (const s of starts) for (const p of s.pieces) if (intersectsChunk(p.box, cx, cz)) p.build(v);
    return starts;
  }

  /** Type of the structure piece containing a position, if any. */
  structureAt(x: number, y: number, z: number): string | null {
    for (const s of this.startsFor(x >> 4, z >> 4)) {
      const b = s.bounds;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1 || z < b.z0 || z > b.z1) continue;
      for (const p of s.pieces) {
        const pb = p.box;
        if (x >= pb.x0 && x <= pb.x1 && y >= pb.y0 && y <= pb.y1 && z >= pb.z0 && z <= pb.z1) return s.type;
      }
    }
    return null;
  }

  /** Structure type ids this manager places. */
  typeIds(): string[] {
    return this.types.map((t) => t.id);
  }

  /**
   * Nearest start of a type, searched ring by ring outwards and yielding after
   * each ring so a caller can spread the work over several ticks. Stops once
   * no unvisited ring can hold anything closer than the best start found.
   */
  *nearestSteps(typeId: string, x: number, z: number, maxRegions = 24): Generator<void, Start | null> {
    const t = this.types.find((tt) => tt.id === typeId);
    if (!t) return null;
    if (t.fixed) return this.nearest(typeId, x, z);
    const rcx = Math.floor((x >> 4) / t.spacing);
    const rcz = Math.floor((z >> 4) / t.spacing);
    let best: Start | null = null;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxRegions; ring++) {
      for (let rx = rcx - ring; rx <= rcx + ring; rx++)
        for (let rz = rcz - ring; rz <= rcz + ring; rz++) {
          if (Math.max(Math.abs(rx - rcx), Math.abs(rz - rcz)) !== ring) continue;
          const s = this.startAt(t, rx, rz);
          if (!s) continue;
          const d = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
      // Starts in the next ring are at least `ring` whole regions away
      if (best && ring * t.spacing * 16 > Math.sqrt(bestD)) break;
      yield;
    }
    return best;
  }

  /** Finds the nearest start of a type (by start chunk) within `maxRegions` regions. */
  nearest(typeId: string, x: number, z: number, maxRegions = 8): Start | null {
    const t = this.types.find((tt) => tt.id === typeId);
    if (!t) return null;
    if (t.fixed) {
      let best: Start | null = null;
      let bestD = Infinity;
      this.fixedStarts(t).forEach((fc, i) => {
        const d = ((fc[0] << 4) - x) ** 2 + ((fc[1] << 4) - z) ** 2;
        if (d >= bestD) return;
        const s = this.startAt(t, i, 0, fc);
        if (s) {
          bestD = d;
          best = s;
        }
      });
      return best;
    }
    const rcx = Math.floor((x >> 4) / t.spacing);
    const rcz = Math.floor((z >> 4) / t.spacing);
    let best: Start | null = null;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxRegions; ring++) {
      for (let rx = rcx - ring; rx <= rcx + ring; rx++)
        for (let rz = rcz - ring; rz <= rcz + ring; rz++) {
          if (Math.max(Math.abs(rx - rcx), Math.abs(rz - rcz)) !== ring) continue;
          const s = this.startAt(t, rx, rz);
          if (!s) continue;
          const d = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
      if (best && ring >= 1) break;
    }
    return best;
  }
}
