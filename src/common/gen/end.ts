/**
 * The End: a main end stone island ringed by ten obsidian pillars topped
 * with end crystals and holding the (inactive) exit portal, an empty void
 * out to 1000 blocks, and beyond it a field of outer islands with chorus
 * forests, void crystals and end cities.
 *
 * V6: far beyond, between EXPANSION_INNER and EXPANSION_OUTER, lies the
 * Expanded End (./endExpansion.ts), in every world. In worlds made with
 * generator 6 or later the outer islands thin out and stop well before it
 * (APPROACH_FADE_START..APPROACH_FADE_END), leaving open void; older worlds
 * keep their End exactly as it generated before, up to the ring.
 */
import { Chunk } from '../world/chunk';
import { Octave2 } from '../math/noise';
import { Random, hash3, hashInts } from '../math/rng';
import { S, stateOf } from '../registry/blocks';
import { biomeNum, biomeOf } from '../registry/biomes';
import { DecorView } from './decorate/view';
import { placeTree } from './features/trees';
import { StructureManager } from './structures/manager';
import { END_CITY } from './structures/end';
import { ProtoCache, cloneChunk, addGenEntities, LATEST_GENERATOR, type DimensionGenerator, type GeneratorOptions, type SpawnPoint } from './pipeline';
import { ExpansionTerrain } from './endExpansion';
import { APPROACH_FADE_END, APPROACH_FADE_START, EXPANSION_GENERATOR, EXPANSION_INNER, EXPANSION_OUTER, EXPANSION_STRUCTURES_GENERATOR, chunkInExpansion, inExpansion } from '../endExpansion/region';
import { expansionStructureTypes } from './structures/expanded';
import { EXPANSION_STRUCTURE_IDS, GIANT_IDS, GIANT_TYPE } from '../endExpansion/structures';
import type { Start } from './structures/manager';

/** Distance from the centre where the outer islands begin. */
export const OUTER_ISLANDS = 1000;
/** Arrival platform for players entering through an end portal. */
export const END_SPAWN = { x: 100, y: 49, z: 0 } as const;

export interface EndPillar {
  x: number;
  z: number;
  radius: number;
  height: number;
  caged: boolean;
}

/** The ten obsidian pillars around the main island (seeded heights). */
export function endPillars(seed: number): EndPillar[] {
  const rng = new Random(hashInts(seed, 0xe9d));
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const out: EndPillar[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const k = order[i]!;
    out.push({ x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), radius: 2 + Math.floor(k / 3), height: 76 + k * 3, caged: k === 1 || k === 2 });
  }
  return out;
}

interface EndBiomes {
  end: number;
  highlands: number;
  midlands: number;
  small: number;
  voidReach: number;
}
let EB: EndBiomes | undefined;
function eb(): EndBiomes {
  return (EB ??= {
    end: biomeNum('the_end'),
    highlands: biomeNum('end_highlands'),
    midlands: biomeNum('end_midlands'),
    small: biomeNum('small_end_islands'),
    voidReach: biomeNum('void_reach'),
  });
}

export class EndTerrain {
  private readonly field: Octave2;
  private readonly hills: Octave2;
  private readonly edge: Octave2;
  private readonly under: Octave2;
  private readonly rare: Octave2;
  /** V6 worlds: the outer islands stop short of the Expanded End. */
  private readonly approachGap: boolean;
  private expansionTerrain: ExpansionTerrain | null = null;
  private readonly version: number;

  constructor(
    readonly seed: number,
    version = LATEST_GENERATOR,
  ) {
    this.approachGap = version >= EXPANSION_GENERATOR;
    this.version = version;
    const r = (salt: number): Random => new Random(hashInts(seed, salt, 0xe4d));
    this.field = new Octave2(r(1), 3, 110);
    this.hills = new Octave2(r(2), 2, 36);
    this.edge = new Octave2(r(3), 2, 40);
    this.under = new Octave2(r(4), 2, 14);
    this.rare = new Octave2(r(5), 2, 420);
  }

  /** The Expanded End's terrain (built on first use). */
  get expansion(): ExpansionTerrain {
    return (this.expansionTerrain ??= new ExpansionTerrain(this.seed, this.version));
  }

  private fieldValue(x: number, z: number, d: number): number {
    // Fade the outer field in past OUTER_ISLANDS
    let t = 0.2 + Math.max(0, (OUTER_ISLANDS + 120 - d) / 120) * 0.6;
    if (this.approachGap && d > APPROACH_FADE_START) {
      // V6: the field thins out to nothing on the way to the Expanded End
      if (d >= APPROACH_FADE_END) return 0;
      t += (1 - t) * ((d - APPROACH_FADE_START) / (APPROACH_FADE_END - APPROACH_FADE_START));
    }
    const v = this.field.sample(x, z);
    return v > t ? (v - t) / (1 - t) : 0;
  }

  /** Top (inclusive) and bottom of the end stone column, or null for void. */
  column(x: number, z: number): { top: number; bottom: number } | null {
    const d = Math.hypot(x, z);
    if (d < 180) {
      const R = 100 + this.edge.sample(x, z) * 14;
      const f = 1 - (d / R) ** 2;
      if (f <= 0) return null;
      const top = 58 + Math.floor(f * 6 + this.hills.sample(x, z) * 2);
      const bottom = top - Math.floor(3 + f ** 0.6 * 38 + this.under.sample(x, z) * 4);
      return { top, bottom: Math.max(1, bottom) };
    }
    if (d < OUTER_ISLANDS) return null;
    if (d >= EXPANSION_INNER && d < EXPANSION_OUTER) return this.expansion.topColumn(x, z);
    const a = this.fieldValue(x, z, d);
    if (a <= 0) return null;
    const top = 50 + Math.floor(Math.min(0.8, a) * 42 + this.hills.sample(x, z) * 4);
    const bottom = top - Math.floor(2 + a * 64 + this.under.sample(x, z) * 3);
    if (bottom >= top) return null;
    return { top, bottom: Math.max(1, bottom) };
  }

  biomeAt(x: number, z: number): number {
    const b = eb();
    const d = Math.hypot(x, z);
    if (d < OUTER_ISLANDS) return b.end;
    if (d >= EXPANSION_INNER && d < EXPANSION_OUTER) return this.expansion.biomeAt(x, z);
    if (d > 2500 && this.rare.sample(x, z) > 0.5) return b.voidReach;
    const a = this.fieldValue(x, z, d);
    if (a > 0.3) return b.highlands;
    if (a > 0.12) return b.midlands;
    return b.small;
  }

  generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz, false);
    const stone = S('end_stone');
    const bx = cx << 4;
    const bz = cz << 4;
    const ring = chunkInExpansion(cx, cz);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        if (ring && inExpansion(bx + x, bz + z)) continue;
        c.biomes[(z << 4) | x] = this.biomeAt(bx + x, bz + z);
        const col = this.column(bx + x, bz + z);
        if (!col) continue;
        for (let y = col.bottom; y <= col.top; y++) c.setRaw(x, y, z, stone);
      }
    if (ring) this.expansion.fill(c);
    c.recomputeHeightmap();
    return c;
  }
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------
function chorusForests(v: DecorView, seed: number, ocx: number, ocz: number): void {
  const bx = ocx << 4;
  const bz = ocz << 4;
  const biome = biomeOf(v.biome(bx + 8, bz + 8));
  if (!biome.trees?.length) return;
  const rng = new Random(hashInts(seed, ocx, ocz, 0xc40));
  const n = Math.floor(biome.treeDensity ?? 0) + (rng.chance(0.5) ? 1 : 0);
  const stone = S('end_stone');
  for (let i = 0; i < n; i++) {
    const x = bx + rng.int(16);
    const z = bz + rng.int(16);
    if (x + 8 < v.bx || x - 8 >= v.bx + 16 || z + 8 < v.bz || z - 8 >= v.bz + 16) continue;
    const y = v.height(x, z) - 1;
    if (y < 1 || v.proto(x, y, z) !== stone) continue;
    placeTree(
      { getState: (a, b, c) => v.proto(a, b, c), current: (a, b, c) => v.get(a, b, c) },
      (a, b, c, s) => v.set(a, b, c, s),
      new Random(hashInts(seed, x, y, z, 0xc41)),
      'chorus',
      x,
      y + 1,
      z,
    );
  }
}

/** Pillars and the exit portal on the main island (only touch chunks near the centre). */
function mainIsland(v: DecorView, seed: number, terrain: EndTerrain, c: Chunk): void {
  if (Math.abs(v.bx + 8) > 80 || Math.abs(v.bz + 8) > 80) return;
  const obsidian = S('obsidian');
  const bedrock = S('bedrock');
  const bars = S('iron_bars');
  for (const p of endPillars(seed)) {
    const r = p.radius;
    if (p.x + r + 2 < v.bx || p.x - r - 2 >= v.bx + 16 || p.z + r + 2 < v.bz || p.z - r - 2 >= v.bz + 16) continue;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r + r) continue;
        const col = terrain.column(p.x + dx, p.z + dz);
        const from = col ? col.bottom : 40;
        for (let y = from; y <= p.height; y++) v.set(p.x + dx, y, p.z + dz, obsidian);
      }
    v.set(p.x, p.height + 1, p.z, bedrock);
    if (p.caged) {
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++)
          for (let dy = 1; dy <= 4; dy++) {
            const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            if (edge) v.set(p.x + dx, p.height + dy, p.z + dz, bars);
          }
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) v.set(p.x + dx, p.height + 5, p.z + dz, bars);
    }
    if (v.inside(p.x, p.z)) c.genEntities.push({ type: 'end_crystal', x: p.x + 0.5, y: p.height + 2, z: p.z + 0.5 });
  }
  const y0 = exitPortalY(terrain);
  if (v.bx > 4 || v.bx + 16 <= -4 || v.bz > 4 || v.bz + 16 <= -4) return;
  buildExitPortal((x, y, z, s) => v.set(x, y, z, s), y0, false);
}

export function exitPortalY(terrain: EndTerrain): number {
  return (terrain.column(0, 0)?.top ?? 60) + 1;
}

/**
 * The bedrock exit portal centred on (0, y0, 0): a 7-wide basin with a
 * central pillar. When active the basin holds end portal blocks.
 */
export function buildExitPortal(set: (x: number, y: number, z: number, s: number) => void, y0: number, active: boolean): void {
  const bedrock = S('bedrock');
  const portal = S('end_portal');
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++) {
      const d = Math.hypot(dx, dz);
      if (d > 3.5) continue;
      for (let y = y0 - 3; y < y0 - 1; y++) if (d <= 2.5) set(dx, y, dz, bedrock);
      set(dx, y0 - 1, dz, bedrock);
      if (d > 2.5) set(dx, y0, dz, bedrock);
      else if (dx !== 0 || dz !== 0) set(dx, y0, dz, active ? portal : 0);
      for (let y = y0 + 1; y <= y0 + 4; y++) if (dx !== 0 || dz !== 0) set(dx, y, dz, 0);
    }
  for (let y = y0; y <= y0 + 3; y++) set(0, y, 0, bedrock);
  const torches: [number, number, string][] = [
    [1, 0, 'east'],
    [-1, 0, 'west'],
    [0, 1, 'south'],
    [0, -1, 'north'],
  ];
  for (const [dx, dz, facing] of torches) set(dx, y0 + 2, dz, stateOf('wall_torch', { facing }));
}

/** Column-local: void crystals on the outer islands. */
function voidCrystals(v: DecorView, seed: number, cx: number, cz: number): void {
  const B = eb();
  const stone = S('end_stone');
  const crystal = S('void_crystal');
  const bx = cx << 4;
  const bz = cz << 4;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const wx = bx + x;
      const wz = bz + z;
      const biome = v.biome(wx, wz);
      if (biome === B.end) continue;
      const y = v.height(wx, wz) - 1;
      if (y < 1 || v.get(wx, y, wz) !== stone || v.get(wx, y + 1, wz) !== 0) continue;
      const chance = biome === B.voidReach ? 0.02 : biome === B.small ? 0.004 : 0;
      if ((hash3(seed ^ 0x51c, wx, y, wz) & 0xffff) / 65536 < chance) v.set(wx, y + 1, wz, crystal);
    }
}

/** True when chunk (cx, cz) or a neighbour lies in the Expanded End (its features may reach in). */
function nearExpansion(cx: number, cz: number): boolean {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (chunkInExpansion(cx + dx, cz + dz)) return true;
  return false;
}

export class EndGenerator implements DimensionGenerator {
  readonly dimension = 'end' as const;
  readonly terrain: EndTerrain;
  readonly structures: StructureManager;
  /**
   * V6 phase 3: the Expanded End's structures (the End City 2.0 variants and
   * the giant structures), in generator 8 worlds only. Null in older worlds.
   */
  readonly expansionStructures: StructureManager | null;
  private readonly protos: ProtoCache;
  /** Columns covered by expansion structure pieces, per chunk (landscape features keep out of them). */
  private readonly covered = new Map<string, number[]>();

  constructor(
    readonly seed: number,
    opts: GeneratorOptions = {},
  ) {
    this.terrain = new EndTerrain(seed, opts.version ?? LATEST_GENERATOR);
    this.protos = new ProtoCache(400, (cx, cz) => this.terrain.generate(cx, cz));
    const top = (x: number, z: number): number => this.terrain.column(x, z)?.top ?? -1;
    this.structures = new StructureManager(
      seed,
      [END_CITY],
      {
        seed,
        groundY: top,
        isWater: () => false,
        biome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
        estimateHeight: top,
        estimateBiome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
      },
      () => opts.structures !== false,
    );
    const version = opts.version ?? LATEST_GENERATOR;
    this.structuresOn = opts.structures !== false;
    this.expansionStructures = version >= EXPANSION_STRUCTURES_GENERATOR ? this.newExpansionManager() : null;
  }

  private readonly structuresOn: boolean;
  private census: StructureManager | null = null;

  private newExpansionManager(): StructureManager {
    return new StructureManager(
      this.seed,
      expansionStructureTypes(this.terrain.expansion),
      {
        seed: this.seed,
        groundY: (x, z) => this.terrain.expansion.topColumn(x, z)?.top ?? -1,
        isWater: () => false,
        biome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
        estimateHeight: (x, z) => this.terrain.expansion.topColumn(x, z)?.top ?? -1,
        estimateBiome: (x, z) => biomeOf(this.terrain.biomeAt(x, z)),
      },
      () => this.structuresOn,
      true,
      16,
    );
  }

  /**
   * V6 phase 4: a second manager over the same structures (the same seed, so
   * the same starts) for surveys over wide areas, such as the broken
   * portals' census, so they never churn the chunk generator's cache.
   */
  censusManager(): StructureManager | null {
    if (!this.expansionStructures) return null;
    return (this.census ??= this.newExpansionManager());
  }

  /** Whether an expansion structure's piece covers a column (features keep out). Pure: plans read only the seed. */
  private coveredBy(x: number, z: number, reach = 0): boolean {
    const m = this.expansionStructures;
    if (!m) return false;
    const key = `${x >> 4},${z >> 4}`;
    let boxes = this.covered.get(key);
    if (!boxes) {
      boxes = [];
      for (const s of m.startsFor(x >> 4, z >> 4)) for (const p of s.pieces) boxes.push(p.box.x0 - 2, p.box.z0 - 2, p.box.x1 + 2, p.box.z1 + 2);
      if (this.covered.size > 256) this.covered.clear();
      this.covered.set(key, boxes);
    }
    for (let i = 0; i < boxes.length; i += 4) if (x + reach >= boxes[i]! && z + reach >= boxes[i + 1]! && x - reach <= boxes[i + 2]! && z - reach <= boxes[i + 3]!) return true;
    // A feature reaching across into the next chunk's structure
    if (reach > 0 && ((x + reach) >> 4 !== x >> 4 || (x - reach) >> 4 !== x >> 4 || (z + reach) >> 4 !== z >> 4 || (z - reach) >> 4 !== z >> 4)) {
      for (const [dx, dz] of [
        [reach, 0],
        [-reach, 0],
        [0, reach],
        [0, -reach],
        [reach, reach],
        [-reach, -reach],
        [reach, -reach],
        [-reach, reach],
      ] as const)
        if ((x + dx) >> 4 !== x >> 4 || (z + dz) >> 4 !== z >> 4) if (this.coveredBy(x + dx, z + dz, 0)) return true;
    }
    return false;
  }

  generate(cx: number, cz: number): Chunk {
    const c = cloneChunk(this.protos.get(cx, cz));
    const v = new DecorView(c, (x, z) => this.protos.get(x, z));
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) chorusForests(v, this.seed, cx + dx, cz + dz);
    mainIsland(v, this.seed, this.terrain, c);
    const starts = this.structures.build(v);
    voidCrystals(v, this.seed, cx, cz);
    // V6: the Expanded End's landscape and the arrival site; phase 3: its structures
    let expansionStarts: Start[] = [];
    if (nearExpansion(cx, cz)) {
      const ex = this.expansionStructures;
      this.terrain.expansion.decorate(v, ex ? (x, z, reach) => this.coveredBy(x, z, reach) : undefined);
      if (ex) expansionStarts = ex.build(v);
    }
    c.recount();
    c.recomputeHeightmap();
    for (const s of starts) addGenEntities(c, s);
    for (const s of expansionStarts) addGenEntities(c, s);
    return c;
  }

  findSpawn(): SpawnPoint {
    return { ...END_SPAWN };
  }

  biomeAt(x: number, z: number): number {
    return this.terrain.biomeAt(x, z);
  }

  structureAt(x: number, y: number, z: number): string | null {
    return this.structures.structureAt(x, y, z) ?? this.expansionStructures?.structureAt(x, y, z) ?? null;
  }

  structureTypes(): string[] {
    return [...this.structures.typeIds(), 'end_fountain', ...(this.expansionStructures ? EXPANSION_STRUCTURE_IDS : [])];
  }

  *locateSteps(type: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null> {
    if (type === 'end_fountain') return { x: 0, y: exitPortalY(this.terrain) + 1, z: 0 };
    if (EXPANSION_STRUCTURE_IDS.includes(type)) {
      const s = yield* this.expansionSteps(type, x, z);
      return s ? { x: s.x, y: s.y, z: s.z } : null;
    }
    const s = yield* this.structures.nearestSteps(type, x, z);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  /** Nearest Expanded End structure of a kind (variant or giant), searched a region ring at a time. */
  *expansionSteps(type: string, x: number, z: number): Generator<void, Start | null> {
    const m = this.expansionStructures;
    if (!m) return null;
    if (GIANT_IDS.includes(type)) return yield* m.nearestSteps(GIANT_TYPE, x, z, 8, (s) => s.type === type);
    return yield* m.nearestSteps(type, x, z, 24);
  }

  /** The expansion structure starts whose bounds hold a column (players finding them, the Admin Panel). */
  expansionStartsAt(x: number, z: number): Start[] {
    const m = this.expansionStructures;
    if (!m || !inExpansion(x, z)) return [];
    return m.startsFor(x >> 4, z >> 4).filter((s) => x >= s.bounds.x0 && x <= s.bounds.x1 && z >= s.bounds.z0 && z <= s.bounds.z1);
  }

  locate(type: string, x: number, z: number): { x: number; y: number; z: number } | null {
    const s = this.structures.nearest(type, x, z, 12);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  landAt(x: number, z: number): boolean {
    const col = this.terrain.column(x, z);
    return !!col && col.top - col.bottom > 2;
  }

  /** Finds a landing spot on the outer islands near (x, z) (for end gateways). */
  outerLanding(x: number, z: number): { x: number; y: number; z: number } {
    for (let r = 0; r < 400; r += 4) {
      for (let a = 0; a < 16; a++) {
        const px = Math.round(x + Math.cos((a / 16) * Math.PI * 2) * r);
        const pz = Math.round(z + Math.sin((a / 16) * Math.PI * 2) * r);
        const col = this.terrain.column(px, pz);
        if (col && col.top - col.bottom > 4) return { x: px, y: col.top + 1, z: pz };
      }
    }
    return { x, y: 70, z };
  }
}
