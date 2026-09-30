/**
 * Generation pipeline entry point.
 *
 * Chunks are produced in two stages:
 *  1. terrain: a pure function of (seed, cx, cz) producing a proto chunk;
 *  2. decoration: features (trees, ores, structures...) whose origins lie in
 *     the 3x3 neighbourhood are replayed in a fixed global order, each only
 *     writing blocks that fall inside the target chunk. Decisions read only
 *     proto data, so the result is deterministic regardless of load order.
 */
import { Chunk } from '../world/chunk';
import type { DimensionId } from '../data/biomes';
import { OverworldTerrain } from './overworld';
import { DecorView } from './decorate/view';
import * as F from './decorate/features';
import { StructureManager } from './structures/manager';
import { caveDecorV2 } from './caves/decor';
import { ProtoCache, cloneChunk, addGenEntities, LATEST_GENERATOR, type DimensionGenerator, type GeneratorOptions, type SpawnPoint } from './pipeline';
import { VILLAGE } from './structures/village';
import { SURFACE_STRUCTURES, SURFACE_STRUCTURES_V3 } from './structures/misc';
import { MINESHAFT, STRONGHOLD } from './structures/underground';
import { CAVE_STRUCTURES } from './structures/caves';
import { ANCIENT_CITY } from './structures/ancientCity';
import { biomeOf } from '../registry/biomes';
import { STATE_FLUID, STATE_SOLID } from '../registry/blocks';
import { CAVE_BIOMES } from './caves/caveBiomes';
import { NetherGenerator } from './nether';
import { EndGenerator } from './end';
import { FarlandsGenerator } from './farlands';
import * as V4 from './v4/decorate';
import { connectChunk } from '../game/connections';

export { ProtoCache, cloneChunk, type DimensionGenerator, type GeneratorOptions, type SpawnPoint };

type Stage = (v: DecorView, seed: number, ocx: number, ocz: number) => void;

/** Stages replayed over the 3x3 neighbourhood, in this global order. */
const NEIGHBOUR_STAGES: Stage[] = [F.lakes, F.geodes, F.ores, F.dungeons, F.springs, F.disks, F.iceFeatures, F.boulders, F.trees];
/** V2 swaps in the V2 ore table and geodes that stay inside rock. */
const NEIGHBOUR_STAGES_V2: Stage[] = NEIGHBOUR_STAGES.map((s) => (s === F.ores ? F.oresV2 : s === F.geodes ? F.geodesV2 : s));
/** V4: overgrown fallen logs, stumps and termite mounds replace the boulder stage; cacti grow after the trees. */
const NEIGHBOUR_STAGES_V4: Stage[] = [...NEIGHBOUR_STAGES_V2.map((s) => (s === F.boulders ? V4.groundFeatures : s)), V4.cacti];

export class OverworldGenerator implements DimensionGenerator {
  readonly dimension = 'overworld' as const;
  readonly terrain: OverworldTerrain;
  readonly structures: StructureManager;
  private readonly protos: ProtoCache;

  constructor(
    readonly seed: number,
    opts: GeneratorOptions = {},
  ) {
    this.terrain = new OverworldTerrain(seed, opts.version ?? LATEST_GENERATOR);
    this.protos = new ProtoCache(600, (cx, cz) => this.terrain.generate(cx, cz));
    const ground = (x: number, z: number): { y: number; water: boolean } => {
      const c = this.protos.get(x >> 4, z >> 4);
      let y = c.getHeight(x & 15, z & 15) - 1;
      let water = false;
      while (y > 0) {
        const s = c.get(x & 15, y, z & 15);
        if (s !== 0 && !STATE_FLUID[s]) break;
        if (STATE_FLUID[s]) water = true;
        y--;
      }
      return { y, water };
    };
    this.structures = new StructureManager(
      seed,
      // V2 adds its underground structures after the V1 list, so V1 placements never move
      [VILLAGE, ...(this.terrain.corrupted ? SURFACE_STRUCTURES_V3 : SURFACE_STRUCTURES), MINESHAFT, STRONGHOLD, ...(this.terrain.carver ? [...CAVE_STRUCTURES, ANCIENT_CITY] : [])],
      {
        seed,
        groundY: (x, z) => ground(x, z).y,
        isWater: (x, z) => ground(x, z).water,
        biome: (x, z) => biomeOf(this.protos.get(x >> 4, z >> 4).getBiome(x & 15, z & 15)),
        estimateHeight: (x, z) => this.terrain.estimateHeight(x, z),
        estimateBiome: (x, z) => biomeOf(this.terrain.estimateBiome(x, z)),
        deepDark: (x, z) => this.terrain.caveBiomes?.deepDarkStrength(x, z) ?? -1,
      },
      () => opts.structures !== false,
    );
  }

  /** World generator version 4 or later (the World Update). */
  get v4(): boolean {
    return this.terrain.version >= 4;
  }

  generate(cx: number, cz: number): Chunk {
    const proto = this.protos.get(cx, cz);
    const c = cloneChunk(proto);
    const v = new DecorView(c, (x, z) => this.protos.get(x, z));
    const seed = this.seed;
    const v4 = this.v4;
    for (const stage of v4 ? NEIGHBOUR_STAGES_V4 : this.terrain.carver ? NEIGHBOUR_STAGES_V2 : NEIGHBOUR_STAGES) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) stage(v, seed, cx + dx, cz + dz);
    }
    if (this.terrain.carver) caveDecorV2(v, seed, cx, cz, !!this.terrain.corrupted);
    else
      F.caveDecor(v, seed, cx, cz, (x, z) => {
        const cl = this.terrain.climate.sample(x, z, this.climateScratch);
        return { humidity: cl.h, continentalness: cl.c, weirdness: cl.w };
      });
    if (v4) V4.volcanic(v, seed, cx, cz);
    const starts = this.structures.build(v);
    F.vegetation(v, seed, cx, cz, v4 ? V4.plantColumn : undefined);
    if (v4) V4.afterVegetation(v, seed, cx, cz);
    F.freeze(v);
    // V4: fences, panes, walls and stairs built by structures take their proper shapes
    if (v4) connectChunk(c, { getState: (x, y, z) => v.get(x, y, z) }, (x, y, z, s) => v.set(x, y, z, s));
    // V3: glitched portals and corrupted ruins' chests go on top of everything
    this.terrain.corrupted?.late(v, cx, cz, 'chest/corrupted_cache');
    c.recount();
    c.recomputeHeightmap();
    // Structure entities (villagers, witches ...) that stand in this chunk
    for (const s of starts) addGenEntities(c, s);
    return c;
  }

  private readonly climateScratch = newClimateScratch();

  findSpawn(): SpawnPoint {
    for (let r = 0; r < 4000; r += 16) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 32));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const h = this.terrain.estimateHeight(x, z);
        if (h > 64 && h < 100) {
          const biome = biomeOf(this.terrain.estimateBiome(x, z));
          // Prefer friendly biomes to start in
          if (r < 1200 && (biome.category === 'ocean' || biome.category === 'mountain' || biome.id === 'mushroom_fields')) continue;
          return { x, y: h + 1, z };
        }
      }
    }
    return { x: 0, y: 100, z: 0 };
  }

  biomeAt(x: number, z: number): number {
    return this.terrain.estimateBiome(x, z);
  }

  get caves(): boolean {
    return !!this.terrain.carver;
  }

  caveBiomeAt(x: number, y: number, z: number): number {
    return this.terrain.caveBiomeAt(x, y, z);
  }

  inMegaCavern(x: number, y: number, z: number): boolean {
    return !!this.terrain.carver?.megaAt(x, y, z);
  }

  structureAt(x: number, y: number, z: number): string | null {
    return this.structures.structureAt(x, y, z);
  }

  /** Nearest monster room, checking origin chunks outwards (one chunk per step). */
  *dungeonSteps(x: number, z: number, maxChunks = 40): Generator<void, { x: number; y: number; z: number } | null> {
    const ocx = x >> 4;
    const ocz = z >> 4;
    const proto = (bx: number, by: number, bz: number): number => (by < 0 || by >= 256 ? 0 : this.protos.get(bx >> 4, bz >> 4).get(bx & 15, by, bz & 15));
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= maxChunks; r++) {
      for (let cx = ocx - r; cx <= ocx + r; cx++)
        for (let cz = ocz - r; cz <= ocz + r; cz++) {
          if (Math.max(Math.abs(cx - ocx), Math.abs(cz - ocz)) !== r) continue;
          const site = F.dungeonSite(this.seed, cx, cz, proto);
          if (site) {
            const d = (site.cx - x) ** 2 + (site.cz - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = { x: site.cx, y: site.cy, z: site.cz };
            }
          }
          yield;
        }
      if (best && r * 16 > Math.sqrt(bestD)) break;
    }
    return best;
  }

  structureTypes(): string[] {
    return [...this.structures.typeIds(), 'dungeon', ...(this.terrain.corrupted ? ['glitched_portal'] : [])];
  }

  *locateSteps(type: string, x: number, z: number): Generator<void, { x: number; y: number; z: number } | null> {
    if (type === 'dungeon') return yield* this.dungeonSteps(x, z);
    if (type === 'glitched_portal') return this.terrain.corrupted?.nearestPortal(x, z) ?? null;
    const s = yield* this.structures.nearestSteps(type, x, z);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  /**
   * Admin locate for cave features: a cave biome id (see CAVE_BIOMES),
   * 'mega_cavern' or 'ravine'. Returns an open spot with a floor inside it
   * (checked against the proto chunk), or null.
   */
  *caveSteps(kind: string, x: number, z: number, maxRadius = 3072): Generator<void, { x: number; y: number; z: number } | null> {
    const carver = this.terrain.carver;
    if (!carver) return null;
    const corrupted = this.terrain.corrupted;
    if (kind === 'corrupted_caves' || kind === 'glitched_portal') {
      if (!corrupted) return null;
      if (kind === 'glitched_portal') return corrupted.nearestPortal(x, z);
      const zone = corrupted.nearest(x, z);
      if (!zone) return null;
      yield;
      return this.caveLanding(zone.x, zone.y, zone.z, zone.y - 20, zone.y + 10, (bx, by, bz) => corrupted.inside(bx, by, bz), 24) ?? { x: zone.x, y: zone.y, z: zone.z };
    }
    if (kind === 'mega_cavern') {
      const m = carver.nearestMega(x, z);
      if (!m) return null;
      yield;
      return this.caveLanding(m.x, m.y, m.z, 4, 200, (bx, by, bz) => !!carver.megaAt(bx, by + 1, bz), 24) ?? { x: m.x, y: m.y, z: m.z };
    }
    if (kind === 'ravine') {
      const r = carver.nearestRavine(x, z);
      if (!r) return null;
      yield;
      return this.caveLanding(r.x, r.floor + 1, r.z, r.floor - 4, 200) ?? { x: r.x, y: r.floor + 1, z: r.z };
    }
    const id = CAVE_BIOMES.findIndex((b) => b.id === kind);
    if (id <= 0) return null;
    const ys = [10, 18, 26, 34, 42, 50];
    const probe = (px: number, pz: number): { x: number; y: number; z: number } | null => {
      for (const y of ys) {
        if (this.terrain.caveBiomeAt(px, y, pz) !== id) continue;
        const spot = this.caveLanding(px, y, pz, y - 10, y + 10, (bx, by, bz) => this.terrain.caveBiomeAt(bx, by, bz) === id);
        if (spot) return spot;
      }
      return null;
    };
    const first = probe(x, z);
    if (first) return first;
    for (let r = 16; r <= maxRadius; ) {
      const step = r < 512 ? 16 : 32;
      for (let i = -r; i < r; i += step) {
        for (const [px, pz] of [
          [x + i, z - r],
          [x + r, z + i],
          [x - i, z + r],
          [x - r, z - i],
        ] as const) {
          const s = probe(px, pz);
          if (s) return s;
          yield;
        }
      }
      r += step;
    }
    return null;
  }

  /**
   * Air with a solid floor near (x, y, z) in the carved terrain, within
   * `reach` blocks sideways, optionally only where `accept` agrees.
   */
  private caveLanding(x: number, y: number, z: number, yMin: number, yMax: number, accept?: (x: number, y: number, z: number) => boolean, reach = 8): { x: number; y: number; z: number } | null {
    const lo = Math.max(2, yMin);
    const hi = Math.min(250, yMax);
    const at = (bx: number, by: number, bz: number): number => this.protos.get(bx >> 4, bz >> 4).get(bx & 15, by, bz & 15);
    for (let r = 0; r <= reach; r += 2) {
      for (let dx = -r; dx <= r; dx += 2)
        for (let dz = -r; dz <= r; dz += 2) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const bx = Math.floor(x) + dx;
          const bz = Math.floor(z) + dz;
          for (let d = 0; d <= 2 * (hi - lo) + 1; d++) {
            const by = Math.floor(y) + (d & 1 ? -(d + 1) / 2 : d / 2);
            if (by < lo || by > hi) continue;
            const f = at(bx, by - 1, bz);
            const a = at(bx, by, bz);
            const b = at(bx, by + 1, bz);
            if (!STATE_SOLID[f] || STATE_FLUID[f] || STATE_SOLID[a] || STATE_FLUID[a] || STATE_SOLID[b] || STATE_FLUID[b]) continue;
            if (accept && !accept(bx, by, bz)) continue;
            return { x: bx, y: by, z: bz };
          }
        }
    }
    return null;
  }

  locate(type: string, x: number, z: number): { x: number; y: number; z: number } | null {
    if (type === 'glitched_portal') return this.terrain.corrupted?.nearestPortal(x, z) ?? null;
    if (type === 'corrupted_caves') {
      const zone = this.terrain.corrupted?.nearest(x, z);
      return zone ? { x: zone.x, y: zone.y, z: zone.z } : null;
    }
    const s = this.structures.nearest(type, x, z, type === 'stronghold' ? 0 : 12);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }
}

function newClimateScratch(): import('./climate').Climate {
  return { c: 0, e: 0, w: 0, pv: 0, t: 0, h: 0, v: 0, river: 0, mountain: 0, swamp: 0, plateau: 0, land: 0, height: 0, amp: 0 };
}

export function createGenerator(dim: DimensionId, seed: number, opts: GeneratorOptions = {}): DimensionGenerator {
  switch (dim) {
    case 'nether':
      return new NetherGenerator(seed, opts);
    case 'end':
      return new EndGenerator(seed, opts);
    case 'farlands':
      return new FarlandsGenerator(seed, opts);
    case 'overworld':
    default:
      return new OverworldGenerator(seed, opts);
  }
}
