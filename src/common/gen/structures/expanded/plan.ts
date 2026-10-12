/**
 * V6 phase 3: planning helpers for the Expanded End's structures: reading
 * the pure terrain (where the land is and how high), collecting pieces,
 * entities and occupied ground, and frames that point a piece's local +z in
 * a world direction.
 */
import { Random, hashInts } from '../../../math/rng';
import type { ExpansionTerrain } from '../../endExpansion';
import { ARRIVAL_ISLAND } from '../../endExpansion';
import { EXPANSION_BIOMES } from '../../../endExpansion/biomes';
import { inExpansion } from '../../../endExpansion/region';
import { CONSTRUCT_LEASH } from '../../../endExpansion/structures';
import type { DecorView } from '../../decorate/view';
import { Builder, type Rotation } from '../builder';
import { boxOf, unionBoxes, type Box, type Start } from '../manager';
import { paletteFor, piece, rectsOverlap, type Entities, type KindPiece, type P3, type Palette, type Rect } from './kit';
import type { EndQuestSpec, PortalSite, SealSpec } from '../../../endExpansion/quests';

/** World directions (the side of a footprint, or the way a bridge runs). */
export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
export const DXZ: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
/** The Builder rotation that points local +z towards a direction. */
export const ROT_TOWARD: Record<Dir, Rotation> = { S: 0, W: 1, N: 2, E: 3 };
/** The world side a Builder's local z = 0 (front) faces under each rotation. */
export const FRONT_OF: Dir[] = ['N', 'E', 'S', 'W'];
export const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Where a plan is asked to go: a region's start chunk, or (Admin Panel) exactly here. */
export interface Anchor {
  x: number;
  z: number;
  /** Floor level when forced (the player's feet). */
  y?: number;
  /** Admin Panel: build here whatever the biome or the land. */
  force?: boolean;
  /** Admin Panel: the biome to dress for (defaults to the one at the anchor). */
  biome?: string;
}

/** The pure terrain of the Expanded End, as plans read it. */
export class Site {
  constructor(readonly ex: ExpansionTerrain) {}

  /** Top of the land at a column (null over the void or outside the ring). */
  ground(x: number, z: number): number | null {
    if (!inExpansion(x, z)) return null;
    const c = this.ex.topColumn(x, z);
    return c && c.top - c.bottom >= 2 ? c.top : null;
  }

  biomeId(x: number, z: number): string {
    return EXPANSION_BIOMES[this.ex.regionAt(x, z).biome]!.id;
  }

  /** Blocks to the nearest region of another biome (its void gap). */
  edge(x: number, z: number): number {
    return this.ex.regionAt(x, z).edge;
  }

  /** Land samples over a rectangle: the share that is land and the land heights. */
  sample(r: Rect, step = 3): { share: number; tops: number[] } {
    const tops: number[] = [];
    let n = 0;
    for (let z = r.z0; z <= r.z1; z += step)
      for (let x = r.x0; x <= r.x1; x += step) {
        n++;
        const g = this.ground(x, z);
        if (g !== null) tops.push(g);
      }
    tops.sort((a, b) => a - b);
    return { share: n ? tops.length / n : 0, tops };
  }

  /** A height quantile of the land under a rectangle (null when too little of it is land). */
  level(r: Rect, minShare: number, q = 0.5, step = 3): number | null {
    const s = this.sample(r, step);
    if (s.share < minShare || !s.tops.length) return null;
    return s.tops[Math.min(s.tops.length - 1, Math.floor(s.tops.length * q))]!;
  }

  /** The spread of land heights under a rectangle (max - min). */
  spread(r: Rect, step = 3): number {
    const s = this.sample(r, step);
    return s.tops.length ? s.tops[s.tops.length - 1]! - s.tops[0]! : 0;
  }

  /** Whether a rectangle (and `pad` around it) lies inside the ring, clear of the arrival island. */
  fits(r: Rect, pad = 8): boolean {
    for (const [x, z] of [
      [r.x0 - pad, r.z0 - pad],
      [r.x1 + pad, r.z0 - pad],
      [r.x0 - pad, r.z1 + pad],
      [r.x1 + pad, r.z1 + pad],
    ] as const)
      if (!inExpansion(x, z)) return false;
    const a = this.ex.arrival();
    const nx = Math.max(r.x0, Math.min(a.x, r.x1));
    const nz = Math.max(r.z0, Math.min(a.z, r.z1));
    return Math.hypot(nx - a.x, nz - a.z) > ARRIVAL_ISLAND + 30;
  }
}

/** Collects a structure's pieces, entities and occupied ground while it is planned. */
export class Plan {
  readonly pieces: KindPiece[] = [];
  readonly entities: Entities = [];
  readonly rects: Rect[] = [];
  readonly pal: Palette;
  /** V6 phase 4: where the structure's quest parts are (recorded as it is planned; never uses the rng). */
  readonly quest: EndQuestSpec = { kind: 'end' };

  constructor(
    readonly type: string,
    readonly seed: number,
    readonly site: Site,
    biome: string,
    /** Admin Panel builds: the structure's mobs are cheat-made. */
    readonly forced = false,
  ) {
    this.pal = paletteFor(biome);
  }

  add(kind: string, box: Box, build: (v: DecorView) => void): KindPiece {
    // Whole blocks: some pieces are laid out along angles
    const whole = { x0: Math.floor(box.x0), y0: Math.floor(box.y0), z0: Math.floor(box.z0), x1: Math.ceil(box.x1), y1: Math.ceil(box.y1), z1: Math.ceil(box.z1) };
    const p = piece(kind, whole, build);
    this.pieces.push(p);
    return p;
  }

  /** Whether a rectangle is clear of everything placed so far (with `pad` blocks between). */
  free(r: Rect, pad = 2): boolean {
    return !this.rects.some((o) => rectsOverlap(o, r, pad));
  }

  occupy(r: Rect): void {
    this.rects.push(r);
  }

  /** A child seed for one piece. */
  sub(...k: number[]): number {
    return hashInts(this.seed, ...k);
  }

  /** A Sentinel patrolling a route (it never strays more than the leash from its post). */
  sentinel(at: P3, route: P3[]): void {
    this.entities.push({ type: 'guardian_sentinel', x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, data: { home: at, route: route.length ? route : [at], leash: CONSTRUCT_LEASH } });
  }

  /** A Bulwark guarding a room: it wakes when a player enters `room`. */
  bulwark(at: P3, room: Box): void {
    this.entities.push({ type: 'guardian_bulwark', x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, data: { home: at, room: [room.x0, room.y0, room.z0, room.x1, room.y1, room.z1], leash: CONSTRUCT_LEASH } });
  }

  mob(type: string, at: P3, data?: Record<string, unknown>): void {
    this.entities.push({ type, x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, ...(data ? { data } : {}) });
  }

  // ------------------------------------------------------------------ phase 4: quest parts

  /** A broken portal laid out by `brokenPortal(b, ..., x0, y0, z, w, h)` in a builder frame. */
  portal(b: Builder, at: [number, number, number], w = 3, h = 4): void {
    const site: PortalSite = { b: [b.ox, b.oy, b.oz, b.rot, b.sx, b.sz], at, w, h };
    (this.quest.portals ??= []).push(site);
  }

  /** A dormant Ancient Core that can be restored (giant structures). */
  core(at: P3): void {
    (this.quest.cores ??= []).push(at);
  }

  seal(kind: SealSpec['kind'], door: P3[], room: Box): void {
    (this.quest.seals ??= []).push({ kind, door, room });
  }

  start(x: number, y: number, z: number): Start | null {
    if (!this.pieces.length) return null;
    const q = this.quest;
    const quest = q.lens || q.portals || q.cores || q.seals || q.vault || q.silent ? q : undefined;
    return { type: this.type, x, y, z, pieces: this.pieces, bounds: unionBoxes(this.pieces.map((p) => p.box)), entities: this.entities.length ? this.entities : undefined, ...(quest ? { quest } : {}) };
  }
}

/** A builder frame with no view (to work out world positions while planning). */
export function frameOf(ox: number, oy: number, oz: number, rot: Rotation, sx: number, sz: number): Builder {
  return new Builder(null as unknown as DecorView, ox, oy, oz, rot, sx, sz);
}

/** World position of a frame's local position. */
export function worldOf(b: Builder, lx: number, ly: number, lz: number): P3 {
  return [b.wx(lx, lz), b.oy + ly, b.wz(lx, lz)];
}

/** World box of a frame's local box (inclusive corners). */
export function boxIn(b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  const a = worldOf(b, x0, y0, z0);
  const c = worldOf(b, x1, y1, z1);
  return boxOf(a[0], a[1], a[2], c[0], c[1], c[2]);
}

/** The box of a footprint rectangle from y0 to y1 (inclusive), grown by `pad` sideways. */
export function rectBox(r: Rect, y0: number, y1: number, pad = 1): Box {
  return boxOf(r.x0 - pad, y0, r.z0 - pad, r.x1 + pad, y1, r.z1 + pad);
}

/**
 * A frame for a run leaving (sx, sz) towards `d` for `len` blocks, `half`
 * blocks either side of its centre line: local +z runs along it from 0 at
 * the start, local x = half is the centre line.
 */
export function runFrame(sx: number, sz: number, d: Dir, len: number, half: number): { rect: Rect; rot: Rotation; sx: number; sz: number } {
  let rect: Rect;
  switch (d) {
    case 'S':
      rect = { x0: sx - half, z0: sz, x1: sx + half, z1: sz + len - 1 };
      break;
    case 'N':
      rect = { x0: sx - half, z0: sz - len + 1, x1: sx + half, z1: sz };
      break;
    case 'E':
      rect = { x0: sx, z0: sz - half, x1: sx + len - 1, z1: sz + half };
      break;
    default:
      rect = { x0: sx - len + 1, z0: sz - half, x1: sx, z1: sz + half };
  }
  return { rect, rot: ROT_TOWARD[d], sx: half * 2 + 1, sz: len };
}

export function runBuilder(v: DecorView, f: { rect: Rect; rot: Rotation; sx: number; sz: number }, y: number): Builder {
  return new Builder(v, f.rect.x0, y, f.rect.z0, f.rot, f.sx, f.sz);
}

/** The point just outside the middle of a rectangle's side. */
export function sideOut(r: Rect, d: Dir, gap = 1): [number, number] {
  const mx = (r.x0 + r.x1) >> 1;
  const mz = (r.z0 + r.z1) >> 1;
  switch (d) {
    case 'N':
      return [mx, r.z0 - gap];
    case 'S':
      return [mx, r.z1 + gap];
    case 'E':
      return [r.x1 + gap, mz];
    default:
      return [r.x0 - gap, mz];
  }
}

/** A seeded Random for a plan step. */
export function rngOf(...k: number[]): Random {
  return new Random(hashInts(...k));
}
