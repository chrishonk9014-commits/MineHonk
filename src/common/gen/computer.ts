/**
 * V5.5: the world inside the computer.
 *
 * It is the seed where Herobrine was first found (478868574082066804),
 * generated the way MineHonk first generated worlds (terrain version 1, no
 * villages or temples), whatever the seed of the world the computer stands
 * in. A world created with that seed starts from the same numbers.
 *
 * On top of that terrain the machine shows through:
 *  - the place you arrive: a hillside over a still lake, the far shore in
 *    fog, leafless trees, and the terminal you log out from;
 *  - the things people swore they saw in that seed: trees stripped of their
 *    leaves, 2x2 tunnels through hills, perfect sand pyramids in the water,
 *    redstone torches nobody placed;
 *  - the computer under it: patches of digital grass and stone, data blocks,
 *    server towers with old terminals, and broken chunks that never loaded;
 *  - Herobrine's cave: a 2x2 tunnel down, lit by redstone torches, to a hall
 *    of servers, screens, cables and tesla coils around the core he plugged
 *    himself into.
 *
 * Everything is a pure function of the seed and chunk position.
 */
import type { Chunk } from '../world/chunk';
import { S, stateOf, STATE_SOLID, STATE_FLUID, blocks, STATE_BLOCK } from '../registry/blocks';
import { hashInts, Random } from '../math/rng';
import { OverworldGenerator } from './generator';
import type { DimensionGenerator, GeneratorOptions, SpawnPoint } from './pipeline';
import { herobrineSeedNum, COMPUTER_WORLD_VERSION, CAVE_OFFSET, CAVE_FLOOR_Y, CAVE_RADIUS, HEROBRINE_SEED } from '../digital/story';

const SALT = 0x4e70b1;
/** Ceiling of the cave hall above its floor (at the middle). */
const HALL_H = 15;
/** The shortest the tunnel down ever is (it is longer under high ground). */
const TUNNEL_MIN = 40;

export interface ComputerLayout {
  spawn: SpawnPoint;
  /** Ground height around the arrival point. */
  ground: number;
  lake: { x: number; z: number; r: number };
  /** Where the figure stands in the fog across the lake. */
  sighting: { x: number; y: number; z: number };
  exitTerminal: { x: number; y: number; z: number };
  sign: { x: number; y: number; z: number };
  /** The top of the 2x2 tunnel down. */
  entrance: { x: number; z: number };
  /** Height the tunnel starts at (above the ground) and how many blocks east it runs to reach the hall. */
  tunnelTop: number;
  tunnelRun: number;
  hall: { x: number; y: number; z: number; r: number };
  core: { x: number; y: number; z: number };
  /** Where Herobrine stands, plugged in, before the fight. */
  throne: { x: number; y: number; z: number };
  coils: { x: number; y: number; z: number }[];
  /**
   * More ways down: winding tunnels from the hall's north and south sides
   * up to the surface, one point per step (x, z and floor height).
   */
  branches: [number, number, number][][];
  /** The floor height of every column the extra tunnels pass through ("x,z" -> floor). */
  branchFloor: Map<string, number>;
  /** Where every way down opens at the surface (the first is the original 2x2 tunnel). */
  entrances: { x: number; z: number }[];
  /** The area the cave and its tunnels take up (nothing else is built there). */
  caveBox: { x0: number; z0: number; x1: number; z1: number };
}

/** Angles (from the hall's centre, east = 0) of the extra tunnels: away from the core in the east and the first tunnel in the west. */
const BRANCH_ANGLES = [70, 125, -70, -125].map((d) => (d * Math.PI) / 180);

let LAYOUT: ComputerLayout | null = null;

let P: Record<string, number> | null = null;
function pal(): Record<string, number> {
  return (P ??= {
    air: 0,
    grass: S('grass_block'),
    dirt: S('dirt'),
    stone: S('stone'),
    sand: S('sand'),
    water: S('water'),
    log: S('oak_log'),
    leaves: stateOf('oak_leaves', { persistent: 'true' }),
    dgrass: S('digital_grass_block'),
    ddirt: S('digital_dirt'),
    dstone: S('digital_stone'),
    dlog: S('digital_log'),
    dleaves: S('digital_leaves'),
    circuit: S('circuit_stone'),
    data: S('data_block'),
    wire: S('wireframe_block'),
    missing: S('missing_block'),
    tower: S('server_tower'),
    cable: S('cable_bundle'),
    cableX: stateOf('cable_bundle', { axis: 'x' }),
    cableZ: stateOf('cable_bundle', { axis: 'z' }),
    screen: S('static_screen'),
    hdd: S('giant_hard_drive'),
    coil: S('tesla_coil'),
    terminal: S('old_terminal'),
    core: S('herobrine_core'),
    light: S('factory_light'),
    rtorch: S('redstone_torch'),
    staticB: S('static_block'),
    bedrock: S('bedrock'),
    glow: S('glowstone'),
  });
}

export class ComputerWorldGenerator implements DimensionGenerator {
  readonly dimension = 'computer' as const;
  readonly seed: number;
  readonly inner: OverworldGenerator;

  constructor(_worldSeed: number, opts: GeneratorOptions = {}) {
    void _worldSeed;
    void opts;
    this.seed = herobrineSeedNum();
    this.inner = new OverworldGenerator(this.seed, { structures: false, version: COMPUTER_WORLD_VERSION });
  }

  /** Where everything in this world is (the same in every MineHonk world). */
  layout(): ComputerLayout {
    if (LAYOUT) return LAYOUT;
    const sp = this.inner.findSpawn();
    const t = this.inner.terrain;
    const ground = Math.max(66, Math.min(84, Math.round(t.estimateHeight(sp.x, sp.z))));
    const lake = { x: sp.x, z: sp.z - 17, r: 8 };
    const ex = sp.x + CAVE_OFFSET.x;
    const ez = sp.z + CAVE_OFFSET.z;
    const tunnelTop = Math.round(t.estimateHeight(ex, ez)) + 10;
    const tunnelRun = Math.max(TUNNEL_MIN, tunnelTop - CAVE_FLOOR_Y + 4);
    const hall = { x: ex + tunnelRun + CAVE_RADIUS + 4, y: CAVE_FLOOR_Y, z: ez, r: CAVE_RADIUS };
    const core = { x: hall.x + CAVE_RADIUS - 5, y: CAVE_FLOOR_Y, z: hall.z };
    const coils: ComputerLayout['coils'] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      coils.push({ x: Math.round(hall.x + Math.cos(a) * 14), y: CAVE_FLOOR_Y, z: Math.round(hall.z + Math.sin(a) * 14) });
    }
    const L: ComputerLayout = {
      spawn: { x: sp.x, y: 0, z: sp.z + 2 },
      ground,
      lake,
      sighting: { x: sp.x + 1, y: 0, z: sp.z - 31 },
      exitTerminal: { x: sp.x + 3, y: 0, z: sp.z + 4 },
      sign: { x: sp.x - 2, y: 0, z: sp.z + 4 },
      entrance: { x: ex, z: ez },
      tunnelTop,
      tunnelRun,
      hall,
      core,
      throne: { x: core.x - 3, y: CAVE_FLOOR_Y, z: core.z },
      coils,
      branches: [],
      branchFloor: new Map(),
      entrances: [{ x: ex, z: ez }],
      caveBox: { x0: ex - 4, z0: hall.z - CAVE_RADIUS - 4, x1: hall.x + CAVE_RADIUS + 4, z1: hall.z + CAVE_RADIUS + 4 },
    };
    LAYOUT = L;
    L.spawn.y = this.hill(L.spawn.x, L.spawn.z) + 1;
    L.sighting.y = this.hill(L.sighting.x, L.sighting.z) + 1;
    L.exitTerminal.y = this.hill(L.exitTerminal.x, L.exitTerminal.z) + 1;
    L.sign.y = this.hill(L.sign.x, L.sign.z) + 1;
    this.planBranches(L);
    return L;
  }

  /**
   * The extra tunnels: each leaves the hall level for a few steps, then
   * climbs a block per step, winding left and right, until it is well
   * clear of the ground above.
   */
  private planBranches(L: ComputerLayout): void {
    const H = L.hall;
    const t = this.inner.terrain;
    BRANCH_ANGLES.forEach((a, k) => {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const path: [number, number, number][] = [];
      let open = -1;
      for (let i = -3; i < 420; i++) {
        const wig = Math.sin(i * 0.085 + k * 1.7) * 6 * Math.min(1, Math.max(0, i) / 20);
        const r = H.r + i;
        const x = Math.round(H.x + dx * r - dz * wig);
        const z = Math.round(H.z + dz * r + dx * wig);
        // A block up for every two along: gentle enough that the steps are never more than one high
        const floor = CAVE_FLOOR_Y + Math.max(0, Math.floor((i - 6) / 2));
        path.push([x, z, floor]);
        // Climb on well past where the ground is expected (it is only an estimate)
        if (open < 0 && floor >= Math.round(t.estimateHeight(x, z)) + 1) open = i;
        if (open >= 0 && i >= open + 16) break;
      }
      L.branches.push(path);
      // Each column takes the floor of the nearest step
      const best = new Map<string, number>();
      for (const [x, z, floor] of path)
        for (let ox = -1; ox <= 1; ox++)
          for (let oz = -1; oz <= 1; oz++) {
            const key = `${x + ox},${z + oz}`;
            const d = ox * ox + oz * oz;
            const prev = best.get(key);
            if (prev === undefined || d < prev || (d === prev && floor < (L.branchFloor.get(key) ?? Infinity))) {
              best.set(key, d);
              L.branchFloor.set(key, floor);
            }
          }
      const top = path[Math.max(0, path.length - 17)]!;
      L.entrances.push({ x: top[0], z: top[1] });
      for (const [x, z] of path) {
        L.caveBox.x0 = Math.min(L.caveBox.x0, x - 3);
        L.caveBox.z0 = Math.min(L.caveBox.z0, z - 3);
        L.caveBox.x1 = Math.max(L.caveBox.x1, x + 3);
        L.caveBox.z1 = Math.max(L.caveBox.z1, z + 3);
      }
    });
  }

  /**
   * The shaped ground of the arrival area: a hill rising gently away from
   * the lake on both sides, the arrival side a little higher, and the lake
   * bed. Shared by the terrain, the trees and the layout so they all agree.
   */
  hill(x: number, z: number): number {
    const L = this.layout();
    const g = L.ground;
    const dl = Math.hypot(x - L.lake.x, (z - L.lake.z) * 0.8);
    if (dl < L.lake.r) return g - 1 - Math.round(3 - (dl / L.lake.r) * 2.5);
    const north = z < L.lake.z;
    return Math.round(g + (north ? 1 + Math.max(0, (L.lake.z - z - 10) * 0.25) : Math.min(3, Math.max(0, (z - L.lake.z - 8) * 0.25))));
  }

  findSpawn(): SpawnPoint {
    return this.layout().spawn;
  }

  biomeAt(x: number, z: number): number {
    return this.inner.biomeAt(x, z);
  }

  structureTypes(): string[] {
    return ['first_sighting', 'herobrine_cave', 'cave_entrance'];
  }

  locate(type: string): { x: number; y: number; z: number } | null {
    const L = this.layout();
    if (type === 'first_sighting') return { ...L.sighting };
    if (type === 'herobrine_cave') return { ...L.hall };
    if (type === 'cave_entrance') return { x: L.entrance.x, y: Math.round(this.inner.terrain.estimateHeight(L.entrance.x, L.entrance.z)), z: L.entrance.z };
    return null;
  }

  *locateSteps(type: string): Generator<void, { x: number; y: number; z: number } | null> {
    return this.locate(type);
  }

  generate(cx: number, cz: number): Chunk {
    const c = this.inner.generate(cx, cz);
    // Structure entities of the inner generator are never wanted here
    c.genEntities.length = 0;
    const L = this.layout();
    const x0 = cx << 4;
    const z0 = cz << 4;
    const nearSpawn = Math.hypot(x0 + 8 - L.spawn.x, z0 + 8 - L.spawn.z) < 72;
    const B = L.caveBox;
    const nearCave = x0 + 15 >= B.x0 - 24 && x0 <= B.x1 + 24 && z0 + 15 >= B.z0 - 24 && z0 <= B.z1 + 24;
    if (!nearSpawn && !nearCave) {
      this.clues(c);
      this.broken(c);
    }
    this.digitize(c, nearSpawn);
    if (!nearSpawn && !nearCave) this.tower(c);
    this.torchTrail(c);
    if (nearSpawn) this.arrival(c);
    if (nearCave) this.cave(c);
    c.recount();
    c.recomputeHeightmap();
    return c;
  }

  // ------------------------------------------------------------------ helpers

  private rng(c: Chunk, salt: number): Random {
    return new Random(hashInts(this.seed, c.cx, c.cz, SALT + salt));
  }

  /** Sets a block given in world coordinates, if it lies in this chunk. */
  private set(c: Chunk, x: number, y: number, z: number, st: number): void {
    if (x >> 4 !== c.cx || z >> 4 !== c.cz || y < 1 || y > 254) return;
    c.set(x & 15, y, z & 15, st);
  }

  private get(c: Chunk, x: number, y: number, z: number): number {
    return c.get(x & 15, y, z & 15);
  }

  /** Top solid block of a column (local coordinates). */
  private surface(c: Chunk, lx: number, lz: number): number {
    for (let y = Math.min(250, c.getHeight(lx, lz) + 1); y > 0; y--) {
      const s = c.get(lx, y, lz);
      if (s !== 0 && STATE_SOLID[s]) return y;
    }
    return 0;
  }

  // ------------------------------------------------------------------ the machine showing through

  /** Patches of familiar blocks gone digital (none right where you arrive). */
  private digitize(c: Chunk, nearSpawn: boolean): void {
    const p = pal();
    const swap = new Map<number, number>([
      [p.grass, p.dgrass],
      [p.dirt, p.ddirt],
      [p.stone, p.dstone],
      [p.log, p.dlog],
    ]);
    const leafNum = STATE_BLOCK[p.leaves];
    const r = this.rng(c, 1);
    for (let lx = 0; lx < 16; lx++)
      for (let lz = 0; lz < 16; lz++) {
        const wx = (c.cx << 4) + lx;
        const wz = (c.cz << 4) + lz;
        // A slowly varying field: patches tens of blocks across
        const f = Math.sin(wx * 0.045 + Math.cos(wz * 0.031) * 2.1) + Math.cos(wz * 0.052 - Math.sin(wx * 0.027) * 1.7);
        if (f < 0.9 || (nearSpawn && Math.hypot(wx - this.layout().spawn.x, wz - this.layout().spawn.z) < 44)) continue;
        const top = this.surface(c, lx, lz);
        for (let y = top + 8; y >= Math.max(1, top - 4); y--) {
          const s = c.get(lx, y, lz);
          const to = swap.get(s);
          if (to !== undefined) c.set(lx, y, lz, to);
          else if (STATE_BLOCK[s] === leafNum || blocks[STATE_BLOCK[s]!]!.id === 'oak_leaves') c.set(lx, y, lz, p.dleaves);
        }
        // Raw data surfacing now and then
        if (f > 1.6 && r.chance(0.012) && top > 1) c.set(lx, top + 1, lz, p.data);
      }
  }

  /** What people swore they saw in this seed. */
  private clues(c: Chunk): void {
    const p = pal();
    const h = hashInts(this.seed, c.cx, c.cz, SALT + 7) >>> 0;
    // Trees with every leaf taken off
    if (h % 5 === 0) {
      for (let lx = 0; lx < 16; lx++)
        for (let lz = 0; lz < 16; lz++)
          for (let y = 60; y < 120; y++) {
            const id = blocks[STATE_BLOCK[c.get(lx, y, lz)]!]!.id;
            if (id === 'oak_leaves' || id === 'birch_leaves' || id === 'spruce_leaves') c.set(lx, y, lz, 0);
          }
    }
    // A perfect sand pyramid standing in the water
    if (h % 9 === 1) {
      const top = c.get(8, 62, 8);
      if (STATE_FLUID[top] && STATE_FLUID[c.get(8, 61, 8)]) {
        let floor = 61;
        while (floor > 30 && STATE_FLUID[c.get(8, floor, 8)]) floor--;
        for (let level = 0; level < 9; level++) {
          const half = 6 - Math.max(0, level - (62 - floor));
          const y = floor + 1 + level;
          if (half < 0) break;
          for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) c.set(8 + dx, y, 8 + dz, p.sand);
        }
      }
    }
    // A 2x2 tunnel straight through a hill
    if (h % 11 === 2) {
      const y = this.surface(c, 0, 8) - 4;
      let ok = y > 40;
      for (let lx = 0; lx < 16 && ok; lx += 5) if (this.surface(c, lx, 8) < y + 4) ok = false;
      if (ok)
        for (let lx = 0; lx < 16; lx++)
          for (const lz of [8, 9])
            for (const dy of [0, 1]) c.set(lx, y + dy, lz, 0);
    }
  }

  /** A chunk that never loaded: a pit framed in wireframe, its floor missing. */
  private broken(c: Chunk): void {
    const h = hashInts(this.seed, c.cx, c.cz, SALT + 13) >>> 0;
    if (h % 61 !== 5) return;
    const p = pal();
    for (let lx = 0; lx < 16; lx++)
      for (let lz = 0; lz < 16; lz++) {
        const edge = lx === 0 || lz === 0 || lx === 15 || lz === 15;
        const top = this.surface(c, lx, lz);
        for (let y = 6; y <= top + 1; y++) c.set(lx, y, lz, edge ? (y % 4 === 0 || y >= top ? p.wire : 0) : 0);
        for (let y = 1; y < 6; y++) c.set(lx, y, lz, y === 5 ? p.missing : p.bedrock);
      }
  }

  /** A server tower humming in the open, with an old terminal at its foot. */
  private tower(c: Chunk): void {
    const h = hashInts(this.seed, c.cx, c.cz, SALT + 17) >>> 0;
    if (h % 19 !== 3) return;
    const p = pal();
    const r = this.rng(c, 17);
    const lx = 5 + r.int(5);
    const lz = 5 + r.int(5);
    const base = this.surface(c, lx, lz);
    if (base < 60 || STATE_FLUID[c.get(lx, base + 1, lz)]) return;
    const height = 6 + r.int(6);
    const face = ['north', 'south', 'west', 'east'][r.int(4)]!;
    for (let dx = 0; dx < 2; dx++)
      for (let dz = 0; dz < 2; dz++) {
        for (let y = base - 3; y <= base; y++) c.set(lx + dx, y, lz + dz, p.cable);
        for (let y = base + 1; y <= base + height; y++) c.set(lx + dx, y, lz + dz, y % 4 === 0 ? stateOf('static_screen', { facing: face }) : stateOf('server_tower', { facing: face }));
      }
    c.set(lx, base + height + 1, lz, p.coil);
    // Cables running off into the ground
    for (let i = 2; i < 7; i++) if (lx + 1 + i < 16) c.set(lx + 1 + i, this.surface(c, lx + 1 + i, lz), lz, p.cableX);
    const [tx, tz] = face === 'north' ? [lx, lz - 1] : face === 'south' ? [lx, lz + 2] : face === 'west' ? [lx - 1, lz] : [lx + 2, lz];
    if (tx >= 0 && tx < 16 && tz >= 0 && tz < 16) c.set(tx, base + 1, tz, stateOf('old_terminal', { facing: face }));
  }

  /** Redstone torches nobody placed, every few dozen blocks from where you arrive to the cave. */
  private torchTrail(c: Chunk): void {
    const L = this.layout();
    const p = pal();
    const dx = L.entrance.x - L.spawn.x;
    const dz = L.entrance.z - L.spawn.z;
    const len = Math.hypot(dx, dz);
    for (let d = 40; d < len - 6; d += 22) {
      const x = Math.round(L.spawn.x + (dx / len) * d);
      const z = Math.round(L.spawn.z + (dz / len) * d);
      if (x >> 4 !== c.cx || z >> 4 !== c.cz) continue;
      const top = this.surface(c, x & 15, z & 15);
      const above = c.get(x & 15, top + 1, z & 15);
      if (top > 1 && (above === 0 || !STATE_SOLID[above]) && !STATE_FLUID[c.get(x & 15, top, z & 15)]) c.set(x & 15, top + 1, z & 15, p.rtorch);
    }
  }

  // ------------------------------------------------------------------ the arrival

  /**
   * The hillside you arrive on, the lake below it, the far shore in fog
   * with its leafless trees, the terminal you log out from and a sign with
   * the seed. The hill is shaped column by column and blends back into the
   * terrain at its edge.
   */
  private arrival(c: Chunk): void {
    const L = this.layout();
    const p = pal();
    const g = L.ground;
    const R = 40;
    void g;
    for (let lx = 0; lx < 16; lx++)
      for (let lz = 0; lz < 16; lz++) {
        const x = (c.cx << 4) + lx;
        const z = (c.cz << 4) + lz;
        const d = Math.hypot(x - L.spawn.x, z - (L.spawn.z - 14));
        if (d > R) continue;
        const natural = this.surface(c, lx, lz);
        const target = this.hill(x, z);
        const lake = Math.hypot(x - L.lake.x, (z - L.lake.z) * 0.8) < L.lake.r;
        const t = Math.max(0, Math.min(1, (d - (R - 10)) / 10));
        const h = Math.round(target * (1 - t) + natural * t);
        for (let y = h + 1; y <= Math.max(natural, h) + 12; y++) c.set(lx, y, lz, 0);
        for (let y = Math.min(natural, h) - 2; y <= h; y++) if (y > 0) c.set(lx, y, lz, y === h ? (lake ? p.sand : p.grass) : y > h - 4 ? p.dirt : p.stone);
        if (lake) for (let y = h + 1; y <= g - 1; y++) c.set(lx, y, lz, p.water);
      }
    // Trees: the far shore's have no leaves
    const trees: [number, number, boolean][] = [
      [-6, -29, false],
      [5, -33, false],
      [-2, -37, false],
      [9, -27, false],
      [-11, -24, true],
      [13, -21, true],
      [-14, -6, true],
      [12, 1, true],
      [-9, 6, true],
    ];
    for (const [ox, oz, leafy] of trees) this.tree(c, L.spawn.x + ox, L.spawn.z + oz, leafy);
    // The terminal you log out from, and the seed on a sign
    this.set(c, L.exitTerminal.x, L.exitTerminal.y, L.exitTerminal.z, stateOf('old_terminal', { facing: 'south' }));
    this.set(c, L.exitTerminal.x, L.exitTerminal.y - 1, L.exitTerminal.z, p.circuit);
    const sx = L.sign.x;
    const sz = L.sign.z;
    if (sx >> 4 === c.cx && sz >> 4 === c.cz) {
      c.set(sx & 15, L.sign.y, sz & 15, stateOf('sign', { rotation: '8' }));
      c.setBlockEntity(sx & 15, L.sign.y, sz & 15, { type: 'sign', lines: ['SEED', HEROBRINE_SEED.slice(0, 9), HEROBRINE_SEED.slice(9), ''] });
    }
  }

  private tree(c: Chunk, x: number, z: number, leafy: boolean): void {
    if (x >> 4 < c.cx - 1 || x >> 4 > c.cx + 1 || z >> 4 < c.cz - 1 || z >> 4 > c.cz + 1) return;
    const p = pal();
    const L = this.layout();
    // Ground height at the trunk: the same shaping as arrival(), so trees in neighbouring chunks agree
    if (Math.hypot(x - L.lake.x, (z - L.lake.z) * 0.8) < L.lake.r + 1) return;
    const base = this.hill(x, z);
    const h = 5;
    for (let y = base + 1; y <= base + h; y++) this.set(c, x, y, z, p.log);
    if (!leafy) return;
    for (let dy = h - 2; dy <= h + 1; dy++) {
      const r = dy >= h ? 1 : 2;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== h - 2) continue;
          const yy = base + dy;
          if (dx === 0 && dz === 0 && dy <= h) continue;
          if (x + dx >> 4 === c.cx && z + dz >> 4 === c.cz && this.get(c, x + dx, yy, z + dz) === 0) this.set(c, x + dx, yy, z + dz, p.leaves);
        }
    }
  }

  // ------------------------------------------------------------------ the cave

  /**
   * A 2x2 tunnel cut down through the hill (east, a step down for every
   * block), lit by redstone torches, into the machine hall: a domed cavern
   * with a floor of circuit stone over a pit, walls of server towers and
   * screens of static, giant hard drives, tesla coils in a ring, cables
   * running everywhere to the core at the far end.
   */
  private cave(c: Chunk): void {
    const L = this.layout();
    const p = pal();
    const H = L.hall;
    const ex = L.entrance.x;
    const ez = L.entrance.z;
    // The hall
    const R = H.r;
    for (let x = H.x - R - 3; x <= H.x + R + 3; x++)
      for (let z = H.z - R - 3; z <= H.z + R + 3; z++) {
        if (x >> 4 !== c.cx || z >> 4 !== c.cz) continue;
        const d = Math.hypot(x - H.x, z - H.z);
        if (d > R + 3) continue;
        const roof = H.y + Math.round(HALL_H - (d / R) ** 2 * 7);
        if (d <= R) {
          for (let y = H.y; y <= roof; y++) this.set(c, x, y, z, 0);
          // Floor over a shallow pit (the floor can be taken away)
          const inner = d < R - 3;
          this.set(c, x, H.y - 1, z, (x + z) % 9 === 0 ? p.glow : p.circuit);
          if (inner) {
            for (let y = H.y - 4; y <= H.y - 2; y++) this.set(c, x, y, z, 0);
            this.set(c, x, H.y - 5, z, p.staticB);
          }
          this.set(c, x, roof + 1, z, (x * 3 + z * 7) % 23 === 0 ? p.light : p.dstone);
        } else {
          // The wall: servers and screens set into stone
          for (let y = H.y - 1; y <= roof + 1; y++) {
            const ring = d <= R + 1.5;
            const a = Math.atan2(z - H.z, x - H.x);
            const slot = Math.round((a / (Math.PI * 2)) * 48);
            const face = Math.abs(x - H.x) > Math.abs(z - H.z) ? (x > H.x ? 'west' : 'east') : z > H.z ? 'north' : 'south';
            let st = p.dstone;
            if (ring && y > H.y && y < H.y + 6) st = slot % 6 === 0 ? stateOf('static_screen', { facing: face }) : slot % 2 === 0 ? stateOf('server_tower', { facing: face }) : p.circuit;
            else if (ring && y >= H.y + 6) st = slot % 4 === 0 ? p.cable : p.dstone;
            this.set(c, x, y, z, st);
          }
        }
      }
    // The tunnel (cut last, through the hall's wall)
    for (let i = 0; i <= L.tunnelRun + 6; i++) {
      const x = ex + i;
      if (x >> 4 < c.cx - 1 || x >> 4 > c.cx + 1) continue;
      const floor = Math.max(CAVE_FLOOR_Y, L.tunnelTop - i);
      for (const z of [ez, ez + 1]) {
        for (let y = floor; y < floor + 3; y++) this.set(c, x, y, z, 0);
        // A floor where the tunnel runs underground
        if (x >> 4 === c.cx && z >> 4 === c.cz && STATE_SOLID[this.get(c, x, floor - 1, z)]) this.set(c, x, floor - 1, z, i % 7 === 3 ? p.circuit : p.stone);
      }
      // Redstone torches nobody placed, along the way down
      for (const z of [ez - 1, ez + 2]) if (x >> 4 === c.cx && z >> 4 === c.cz && i % 8 === 4 && STATE_SOLID[this.get(c, x, floor - 1, z)] && STATE_SOLID[this.get(c, x, floor + 2, z)]) this.set(c, x, floor, z, p.rtorch);
    }
    // The other ways down: wider, winding, torch-lit like the first
    for (const path of L.branches)
      path.forEach(([x, z, floor], i) => {
        if (x >> 4 < c.cx - 1 || x >> 4 > c.cx + 1 || z >> 4 < c.cz - 1 || z >> 4 > c.cz + 1) return;
        for (let ox = -1; ox <= 1; ox++)
          for (let oz = -1; oz <= 1; oz++) {
            const wx = x + ox;
            const wz = z + oz;
            if (wx >> 4 !== c.cx || wz >> 4 !== c.cz) continue;
            const f = L.branchFloor.get(`${wx},${wz}`) ?? floor;
            // Underground it gets a floor; out in the open nothing is built
            const under = STATE_SOLID[this.get(c, wx, f - 1, wz)] || STATE_SOLID[this.get(c, wx, f, wz)] || f - 1 < this.inner.terrain.estimateHeight(wx, wz) + 2;
            for (let y = f; y < f + 4; y++) this.set(c, wx, y, wz, 0);
            if (under) this.set(c, wx, f - 1, wz, i % 9 === 4 ? p.circuit : p.stone);
          }
      });
    // Torches once the digging is done (the steps overlap, so each lands on the real floor)
    for (const path of L.branches)
      path.forEach(([x, z, floor], i) => {
        if (i % 8 !== 4 || x >> 4 !== c.cx || z >> 4 !== c.cz) return;
        for (let y = floor + 1; y > floor - 4; y--)
          if (this.get(c, x, y, z) === 0 && STATE_SOLID[this.get(c, x, y - 1, z)]) {
            this.set(c, x, y, z, p.rtorch);
            break;
          }
      });
    // Giant hard drives standing like pillars, tesla coils in a ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.round(H.x + Math.cos(a) * (R - 5));
      const z = Math.round(H.z + Math.sin(a) * (R - 5));
      if (Math.hypot(x - L.core.x, z - L.core.z) < 6 || x < H.x - R + 4) continue;
      for (let y = H.y; y < H.y + 4; y++) this.set(c, x, y, z, p.hdd);
    }
    for (const k of L.coils) {
      this.set(c, k.x, k.y, k.z, p.coil);
      this.set(c, k.x, k.y + 1, k.z, p.coil);
      // A cable from the core to each coil, set into the floor
      const steps = Math.ceil(Math.hypot(k.x - L.core.x, k.z - L.core.z));
      for (let s = 1; s < steps; s++) {
        const x = Math.round(L.core.x + ((k.x - L.core.x) * s) / steps);
        const z = Math.round(L.core.z + ((k.z - L.core.z) * s) / steps);
        this.set(c, x, H.y - 1, z, Math.abs(k.x - L.core.x) > Math.abs(k.z - L.core.z) ? p.cableX : p.cableZ);
      }
    }
    // The core he plugged himself into, cables climbing from it into the roof
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let y = 0; y < 4; y++) this.set(c, L.core.x + dx, H.y + y, L.core.z + dz, dx === 0 && dz === 0 && y === 3 ? p.coil : p.core);
    for (let y = H.y + 4; y <= H.y + HALL_H; y++)
      for (const [dx, dz] of [
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
      ] as const)
        if (this.get(c, L.core.x + dx, y, L.core.z + dz) === 0) this.set(c, L.core.x + dx, y, L.core.z + dz, p.cable);
  }

}

/** Forget the cached layout (tests that build several generators). */
export function resetComputerLayout(): void {
  LAYOUT = null;
}
