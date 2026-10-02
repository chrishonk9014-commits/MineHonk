/**
 * V6 - The End Expansion: terrain of the Expanded End.
 *
 * The ring between EXPANSION_INNER and EXPANSION_OUTER (see
 * ../endExpansion/region.ts) is split into large biome regions: cells of a
 * jittered grid, seen through a slow warp so their borders wander. Every
 * cell takes one of the seven expansion biomes; next to a cell of another
 * biome its land tapers off into a void gap, so crossing between biomes
 * means gliding or bridging. Each biome shapes its own land (island sizes
 * and heights, floating chains, cliffs and caves), lays its own surface
 * palette and grows its own landscape features.
 *
 * Only called by the End generator for columns inside the ring: the classic
 * End never reaches this code.
 */
import type { Chunk } from '../world/chunk';
import { Octave2, clamp } from '../math/noise';
import { Random, hash3, hashInts } from '../math/rng';
import { S } from '../registry/blocks';
import { biomeNum } from '../registry/biomes';
import type { DecorView } from './decorate/view';
import { EXPANSION_BIOMES, type ExpansionBiome, type FeatureSpec } from '../endExpansion/biomes';
import { buildExpansionPortal } from '../endExpansion/portal';
import { ARRIVAL_NOMINAL, EXPANSION_INNER, EXPANSION_MARGIN, EXPANSION_OUTER, REGION_CELL, REGION_WARP, chunkInExpansion, inExpansion } from '../endExpansion/region';

/** Half-width of the void gap between two biomes (before the noise wobble). */
const GAP = 22;
/** Blocks over which land tapers into a gap or the ring's margin. */
const TAPER = 70;
/** Most land spans one column can hold (main land, a cave split, floating chains). */
const MAX_SPANS = 4;

export interface Region {
  /** Index into EXPANSION_BIOMES. */
  biome: number;
  /** Approximate distance (blocks) to the nearest region of another biome. */
  edge: number;
}

/** Arrival island: the platform and return portal stand on it. */
export interface Arrival {
  /** Centre of the platform (the standing spot is in front of the return portal). */
  x: number;
  z: number;
  /** Platform floor level (the top of the island under it). */
  floor: number;
  biome: number;
}

/** Radius of the solid disc of land the arrival platform is built on. */
export const ARRIVAL_ISLAND = 14;
/** Half-width of the square arrival platform. */
export const ARRIVAL_PLATFORM = 4;

/**
 * The arrival site's layout: the return portal stands on the platform's
 * +z side, and travellers arrive at `stand`, facing away from it (yaw 0
 * looks towards -z).
 */
export function arrivalLayout(a: Arrival): { portal: { x: number; y: number; z: number }; stand: { x: number; y: number; z: number }; yaw: number } {
  return { portal: { x: a.x, y: a.floor, z: a.z + 3 }, stand: { x: a.x, y: a.floor, z: a.z - 1 }, yaw: 0 };
}

interface BiomeNoise {
  field: Octave2;
  hills: Octave2;
  under: Octave2;
  ridge: Octave2;
  chain: Octave2;
  chainY: Octave2;
  cave: Octave2;
}

export class ExpansionTerrain {
  private readonly warpX: Octave2;
  private readonly warpZ: Octave2;
  private readonly gapNoise: Octave2;
  private readonly noise: BiomeNoise[];
  private readonly biomeNums: number[];
  private arrivalCache: Arrival | null = null;
  /** Scratch for regionAt: distances to the 3x3 sites around a column and their biomes. */
  private readonly nearD = new Float64Array(9);
  private readonly nearB = new Int32Array(9);

  constructor(readonly seed: number) {
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0xe6a));
    this.warpX = new Octave2(r(1), 2, 520);
    this.warpZ = new Octave2(r(2), 2, 520);
    this.gapNoise = new Octave2(r(3), 2, 90);
    this.noise = EXPANSION_BIOMES.map((b, i) => {
      const t = b.terrain;
      return {
        field: new Octave2(r(100 + i * 10), 3, t.scale),
        hills: new Octave2(r(101 + i * 10), 2, t.reliefScale),
        under: new Octave2(r(102 + i * 10), 2, 18),
        ridge: new Octave2(r(103 + i * 10), 3, t.ridgeScale ?? 160),
        chain: new Octave2(r(104 + i * 10), 2, t.chains?.scale ?? 120),
        chainY: new Octave2(r(105 + i * 10), 2, 200),
        cave: new Octave2(r(106 + i * 10), 2, t.caveScale ?? 40),
      };
    });
    this.biomeNums = EXPANSION_BIOMES.map((b) => biomeNum(b.id));
  }

  // ------------------------------------------------------------------ regions

  /** Biome index of grid cell (gx, gz). */
  cellBiome(gx: number, gz: number): number {
    return hashInts(this.seed, gx, gz, 0xb10e) % EXPANSION_BIOMES.length;
  }

  /** The biome region at a column and how far it is from a region of another biome. */
  regionAt(x: number, z: number): Region {
    const wx = x + this.warpX.sample(x, z) * REGION_WARP;
    const wz = z + this.warpZ.sample(x, z) * REGION_WARP;
    const cx = Math.floor(wx / REGION_CELL);
    const cz = Math.floor(wz / REGION_CELL);
    // Sites are jittered within their cells, so the nearest lies in the 3x3 around
    // this one; a different biome further out than that is far enough to count as "far"
    const ds = this.nearD;
    const bs = this.nearB;
    let d1 = Infinity;
    let i1 = 0;
    let k = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++, k++) {
        const h = hashInts(this.seed, cx + dx, cz + dz, 0x517e);
        const sx = (cx + dx + 0.15 + ((h & 0xffff) / 65536) * 0.7) * REGION_CELL;
        const sz = (cz + dz + 0.15 + ((h >>> 16) / 65536) * 0.7) * REGION_CELL;
        const d = Math.hypot(wx - sx, wz - sz);
        ds[k] = d;
        bs[k] = this.cellBiome(cx + dx, cz + dz);
        if (d < d1) {
          d1 = d;
          i1 = k;
        }
      }
    const b1 = bs[i1]!;
    let d2 = Infinity;
    for (let i = 0; i < 9; i++) if (bs[i] !== b1 && ds[i]! < d2) d2 = ds[i]!;
    return { biome: b1, edge: Number.isFinite(d2) ? (d2 - d1) / 2 : REGION_CELL / 2 };
  }

  /** Registry biome number at a column inside the ring. */
  biomeAt(x: number, z: number): number {
    return this.biomeNums[this.regionAt(x, z).biome]!;
  }

  /** Expansion biome definition at a column inside the ring. */
  biomeDefAt(x: number, z: number): ExpansionBiome {
    return EXPANSION_BIOMES[this.regionAt(x, z).biome]!;
  }

  // ------------------------------------------------------------------ land

  /**
   * How far inside its land a column is: 0 at a gap or the ring's margin,
   * 1 once TAPER blocks clear of both. Land only grows where this is above 0.
   */
  private inland(x: number, z: number, edge: number): number {
    const d = Math.hypot(x, z);
    const radial = Math.min(d - (EXPANSION_INNER + EXPANSION_MARGIN), EXPANSION_OUTER - EXPANSION_MARGIN - d);
    const gap = GAP * (1 + this.gapNoise.sample(x, z) * 0.45);
    return clamp((Math.min(edge, radial + GAP) - gap) / TAPER, 0, 1);
  }

  /**
   * Land spans of a column as [bottom, top] pairs (inclusive), lowest first.
   * Returns the number of spans written to `out`.
   */
  spans(x: number, z: number, out: number[], region = this.regionAt(x, z)): number {
    // The arrival island: a solid disc of land under the platform, whatever the biome
    const arr = this.arrival();
    const ad = Math.hypot(x - arr.x, z - arr.z);
    if (ad > ARRIVAL_ISLAND + 6) return this.landSpans(x, z, out, region);
    const f = clamp((ARRIVAL_ISLAND + 6 - ad) / 6, 0, 1);
    out[0] = arr.floor - Math.floor(5 + 16 * (1 - (ad / (ARRIVAL_ISLAND + 6)) ** 2));
    // the rim slopes down from the disc
    out[1] = ad <= ARRIVAL_ISLAND ? arr.floor - 1 : arr.floor - 1 - Math.floor((1 - f) * 3);
    return 1;
  }

  /** The biome's own land at a column (spans() without the arrival island). */
  private landSpans(x: number, z: number, out: number[], region: Region): number {
    const def = EXPANSION_BIOMES[region.biome]!;
    const t = def.terrain;
    const n = this.noise[region.biome]!;
    const k = this.inland(x, z, region.edge);
    let count = 0;
    const push = (bottom: number, top: number): void => {
      if (count >= MAX_SPANS || top < bottom) return;
      out[count * 2] = Math.max(1, bottom);
      out[count * 2 + 1] = Math.min(250, top);
      count++;
    };
    if (k <= 0) return 0;
    // Main land: an island field that thins out towards the region's edge.
    // `cover` 0.5 makes about half the region land; `a` reaches 1 well inside an island.
    const v = n.field.sample(x, z);
    const thr = (0.5 - t.cover) * 0.66;
    const a = Math.min(1.5, ((v - thr) / 0.35) * (0.35 + 0.65 * k) - (1 - k) * 0.25);
    if (a > 0) {
      const am = Math.min(1, a);
      let top = t.base + am * t.rise + n.hills.sample(x, z) * t.relief;
      if (t.ridges) top += Math.max(0, n.ridge.ridged(x, z) - 0.45) * 1.8 * t.ridges * Math.min(1, a * 2.5);
      if (t.terrace) top = Math.floor(top / t.terrace) * t.terrace + Math.min(t.terrace - 1, Math.floor((top % t.terrace) * 0.25));
      const topY = Math.floor(top);
      // The underside hangs deepest under the middle of an island
      const bottom = topY - Math.floor(2 + Math.min(1, a * 1.4) ** 1.5 * t.depth + n.under.sample(x, z) * 3);
      const c = t.caves ? n.cave.sample(x, z) : -1;
      if (t.caves && topY - bottom > 16 && c > 0.33 - t.caves * 0.66) {
        // A band of caves through thick land, opening out of the cliffs where it meets them
        const open = c - (0.33 - t.caves * 0.66);
        const floor = bottom + Math.floor((topY - bottom) * 0.38);
        const h = Math.min(topY - floor - 7, Math.floor(4 + open * 32));
        push(bottom, floor - 1);
        // Where the caves are widest their roof has fallen in: sinkholes open to the sky
        if (open < 0.3) push(floor + h, topY);
      } else push(bottom, topY);
    }
    // Floating chains: strings of small islands at two heights, broken into beads
    const ch = t.chains;
    if (ch && k > 0.15) {
      for (let layer = 0; layer < 2; layer++) {
        const sx = layer ? z + 3700 : x;
        const sz = layer ? -x + 1900 : z;
        const r = n.chain.ridged(sx, sz);
        const lim = 1 - ch.density;
        if (r <= lim) continue;
        const bead = n.cave.sample(sx * 1.3, sz * 1.3);
        if (bead < -0.1) continue;
        const sStrength = Math.min(1, ((r - lim) / ch.density) * 1.6 * Math.min(1, (bead + 0.1) * 4));
        const y = Math.floor(t.base + ch.lift * (1 + layer * 0.8) + n.chainY.sample(sx, sz) * ch.wave);
        const thick = Math.floor(1 + sStrength * ch.thickness * k);
        const top = y + Math.floor(sStrength * 2);
        const bottom = y - thick;
        // Never inside or touching the land below
        let clash = false;
        for (let i = 0; i < count; i++) if (bottom <= out[i * 2 + 1]! + 3 && top >= out[i * 2]! - 3) clash = true;
        if (!clash) push(bottom, top);
      }
    }
    // Lowest first
    for (let i = 1; i < count; i++)
      for (let j = i; j > 0 && out[j * 2]! < out[(j - 1) * 2]!; j--) {
        const b = out[j * 2]!;
        const tp = out[j * 2 + 1]!;
        out[j * 2] = out[(j - 1) * 2]!;
        out[j * 2 + 1] = out[(j - 1) * 2 + 1]!;
        out[(j - 1) * 2] = b;
        out[(j - 1) * 2 + 1] = tp;
      }
    return count;
  }

  /** Top and bottom of a column's highest land span, or null (for structure placement and landing checks). */
  topColumn(x: number, z: number): { top: number; bottom: number } | null {
    const out: number[] = [];
    const n = this.spans(x, z, out);
    if (!n) return null;
    let best = 0;
    for (let i = 1; i < n; i++) if (out[i * 2 + 1]! > out[best * 2 + 1]!) best = i;
    return { bottom: out[best * 2]!, top: out[best * 2 + 1]! };
  }

  /** Fills the ring's columns of a proto chunk (other columns are left alone). */
  fill(c: Chunk): void {
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    const out: number[] = [];
    const states = EXPANSION_BIOMES.map((b) => ({ top: S(b.palette.top), under: S(b.palette.under), core: S(b.palette.core), depth: b.palette.depth }));
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const wx = bx + x;
        const wz = bz + z;
        if (!inExpansion(wx, wz)) continue;
        const region = this.regionAt(wx, wz);
        c.biomes[(z << 4) | x] = this.biomeNums[region.biome]!;
        const n = this.spans(wx, wz, out, region);
        const p = states[region.biome]!;
        for (let i = 0; i < n; i++) {
          const bottom = out[i * 2]!;
          const top = out[i * 2 + 1]!;
          for (let y = bottom; y <= top; y++) c.setRaw(x, y, z, y === top ? p.top : top - y <= p.depth ? p.under : p.core);
        }
      }
  }

  // ------------------------------------------------------------------ arrival

  /**
   * The arrival island: the first column near ARRIVAL_NOMINAL that is well
   * inside a region, so the platform never sits at a gap. Deterministic per seed.
   */
  arrival(): Arrival {
    if (this.arrivalCache) return this.arrivalCache;
    let best: { x: number; z: number; r: Region } | null = null;
    outer: for (let ring = 0; ring <= 40; ring++) {
      const steps = Math.max(1, ring * 8);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(ARRIVAL_NOMINAL.x + Math.cos(a) * ring * 24);
        const z = Math.round(ARRIVAL_NOMINAL.z + Math.sin(a) * ring * 24);
        const r = this.regionAt(x, z);
        if (r.edge > GAP * 1.5 + TAPER + ARRIVAL_ISLAND) {
          best = { x, z, r };
          break outer;
        }
      }
    }
    const x = best?.x ?? ARRIVAL_NOMINAL.x;
    const z = best?.z ?? ARRIVAL_NOMINAL.z;
    const r = best?.r ?? this.regionAt(x, z);
    // Level with the biome's own land there (or a little above its base where it has none)
    const out: number[] = [];
    const n = this.landSpans(x, z, out, r);
    const floor = n ? out[n * 2 - 1]! + 1 : EXPANSION_BIOMES[r.biome]!.terrain.base + 3;
    this.arrivalCache = { x, z, floor: Math.max(40, Math.min(150, floor)), biome: r.biome };
    return this.arrivalCache;
  }

  /** Nearest land of a biome (index) inside the ring, searched outwards from (x, z): the top of that land. */
  findBiome(biome: number, x: number, z: number, maxRadius = 8000): { x: number; y: number; z: number } | null {
    for (let r = 0; r <= maxRadius; r += 48) {
      const steps = Math.max(1, Math.round((r * Math.PI * 2) / 96));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = Math.round(x + Math.cos(a) * r);
        const pz = Math.round(z + Math.sin(a) * r);
        if (!inExpansion(px, pz)) continue;
        const reg = this.regionAt(px, pz);
        if (reg.biome !== biome || reg.edge < GAP + TAPER) continue;
        const col = this.topColumn(px, pz);
        if (col && col.top - col.bottom >= 2) return { x: px, y: col.top + 1, z: pz };
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ landscape

  /**
   * Landscape features of the target chunk, replayed from its 3x3
   * neighbourhood so features crossing chunk borders come out whole.
   * Decisions read only proto terrain (deterministic in any load order).
   */
  decorate(v: DecorView): void {
    const tcx = v.bx >> 4;
    const tcz = v.bz >> 4;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const ocx = tcx + dx;
        const ocz = tcz + dz;
        if (!chunkInExpansion(ocx, ocz)) continue;
        this.decorateFrom(v, ocx, ocz);
      }
    this.arrivalSite(v);
  }

  /** The arrival platform and the (always open) return portal, built into whichever chunks they cross. */
  private arrivalSite(v: DecorView): void {
    const a = this.arrival();
    const P = ARRIVAL_PLATFORM;
    if (a.x + P + 3 < v.bx || a.x - P - 3 >= v.bx + 16 || a.z + P + 3 < v.bz || a.z - P - 3 >= v.bz + 16) return;
    const floor = S('end_stone_bricks');
    for (let dz = -P; dz <= P; dz++)
      for (let dx = -P; dx <= P; dx++) {
        v.set(a.x + dx, a.floor - 1, a.z + dz, floor);
        for (let dy = 0; dy < 8; dy++) v.set(a.x + dx, a.floor + dy, a.z + dz, 0);
      }
    const L = arrivalLayout(a);
    buildExpansionPortal((x, y, z, st) => v.set(x, y, z, st), L.portal.x, L.portal.y, L.portal.z, true);
  }

  private decorateFrom(v: DecorView, ocx: number, ocz: number): void {
    const bx = ocx << 4;
    const bz = ocz << 4;
    const mid = this.regionAt(bx + 8, bz + 8);
    const def = EXPANSION_BIOMES[mid.biome]!;
    const arr = this.arrival();
    for (let fi = 0; fi < def.features.length; fi++) {
      const f = def.features[fi]!;
      const rng = new Random(hashInts(this.seed, ocx, ocz, fi, 0xfea7));
      const tries = Math.floor(f.perChunk) + (rng.next() < f.perChunk % 1 ? 1 : 0);
      for (let i = 0; i < tries; i++) {
        const x = bx + rng.int(16);
        const z = bz + rng.int(16);
        const fr = new Random(hashInts(this.seed, x, z, fi, 0xfea8));
        // Features reach at most `reach` blocks from their origin
        const reach = f.reach ?? 3;
        if (x + reach < v.bx || x - reach >= v.bx + 16 || z + reach < v.bz || z - reach >= v.bz + 16) continue;
        if (!inExpansion(x, z) || Math.hypot(x - arr.x, z - arr.z) < ARRIVAL_ISLAND + 4) continue;
        if (this.regionAt(x, z).biome !== mid.biome) continue;
        if (f.kind === 'hanging') {
          placeHanging(v, f, fr, x, z);
          continue;
        }
        const y = v.height(x, z) - 1;
        if (y < 2) continue;
        const ground = v.proto(x, y, z);
        if (ground !== S(def.palette.top) && !(f.onAnyGround && ground !== 0)) continue;
        placeFeature(v, f, fr, x, y + 1, z);
      }
    }
  }
}

/** Places one landscape feature with its base at (x, y, z) (the first air above the ground). */
function placeFeature(v: DecorView, f: FeatureSpec, rng: Random, x: number, y: number, z: number): void {
  const st = S(f.block);
  const put = (px: number, py: number, pz: number, s: number): void => {
    if (v.get(px, py, pz) === 0) v.set(px, py, pz, s);
  };
  switch (f.kind) {
    case 'plant':
      put(x, y, z, st);
      return;
    case 'patch': {
      // A loose patch of ground cover or plants around the origin
      const r = f.size ?? 3;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r || hash3(0x9a7c, x + dx, y, z + dz) % 3 === 0) continue;
          const gy = v.height(x + dx, z + dz);
          if (Math.abs(gy - y) > 2 || gy < 2) continue;
          if (f.replaceGround) {
            if (v.get(x + dx, gy - 1, z + dz) !== 0) v.set(x + dx, gy - 1, z + dz, st);
          } else put(x + dx, gy, z + dz, st);
        }
      return;
    }
    case 'spire': {
      // A tall tapering column (base 3x3 when large)
      const h = (f.height ?? 8) + rng.int(Math.max(1, f.height ?? 8));
      for (let i = 0; i < h; i++) {
        put(x, y + i, z, st);
        if (i < h / 3 && (f.size ?? 1) > 1) for (const [dx, dz] of N4) put(x + dx, y + i, z + dz, st);
      }
      if (f.tip) put(x, y + h, z, S(f.tip));
      return;
    }
    case 'cluster': {
      // A small blob of blocks half sunk into the ground
      const r = (f.size ?? 2) + rng.next();
      for (let dy = -1; dy <= r; dy++)
        for (let dz = -Math.ceil(r); dz <= r; dz++)
          for (let dx = -Math.ceil(r); dx <= r; dx++) if (dx * dx + dy * dy * 1.6 + dz * dz <= r * r) v.set(x + dx, y + dy, z + dz, st);
      return;
    }
    case 'growth': {
      // A stalk with a broad cap (plant-like, no wood)
      const h = (f.height ?? 5) + rng.int(4);
      for (let i = 0; i < h; i++) put(x, y + i, z, st);
      const cap = S(f.cap ?? f.block);
      const r = f.size ?? 2;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r + 1) put(x + dx, y + h, z + dz, cap);
      return;
    }
    case 'hanging':
      placeHanging(v, f, rng, x, z);
      return;
  }
}

/** Strands hanging from a cave roof: the first roof found below the surface that has a floor under it. */
function placeHanging(v: DecorView, f: FeatureSpec, rng: Random, x: number, z: number): void {
  const st = S(f.block);
  const top = v.height(x, z) - 1;
  for (let y = top - 1; y > 4; y--) {
    if (v.proto(x, y, z) !== 0 || v.proto(x, y + 1, z) === 0) continue;
    // y is air under a roof: is there a floor within reach?
    let floor = -1;
    for (let d = 1; d < 28; d++)
      if (v.proto(x, y - d, z) !== 0) {
        floor = y - d;
        break;
      }
    if (floor < 0) return;
    const len = Math.min(y - floor - 2, 1 + rng.int(f.height ?? 5));
    for (let i = 0; i < len; i++) if (v.get(x, y - i, z) === 0) v.set(x, y - i, z, st);
    return;
  }
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
