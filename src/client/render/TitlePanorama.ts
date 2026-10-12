/**
 * The title screen backdrop: a patch of real, freshly generated terrain from
 * a random seed.
 *
 * V7: while the Halloween season lasts (the menu's clock, see
 * src/common/halloween/season.ts), it shows Halloween nights instead, a new
 * one every 40 seconds:
 *  - a foggy forest, a path lit by pumpkins, and Herobrine far off at its end;
 *  - a pumpkin patch glowing in the dark, with scarecrows, ghosts drifting over;
 *  - a misty marsh, ghosts drifting over the water.
 * After the season the End Expansion's scenes come back. Since V6 those are
 * one of four scenes picked at random:
 *  - the Expanded End around its arrival island;
 *  - the End Crystal Fields, glittering;
 *  - the Void Citadel, hanging upside down over the void;
 *  - the End Eclipse: a dark disc ringed with light over an island, a
 *    monolith and the shards that grow under it.
 * The V5.5 scenes are still there with ?title=computer_lab|digital_world|
 * herobrine_cave|dragon_malware:
 *  - a computer lab: desks of computers, monitors, keyboards and speakers,
 *    server racks on network cable, and one computer whose screen has gone
 *    wrong;
 *  - the world inside the computer: the seed where Herobrine was first
 *    found, the lake, the leafless trees, and him across the water in the fog;
 *  - Herobrine's cave: servers, screens of static, tesla coils and the core,
 *    and him plugged into it;
 *  - the End, the Ender Dragon sick with malware, coughing data.
 * The Engineering Update's five set scenes are still there with
 * ?title=factory|power_plant|mine|farm|control_room:
 *  - a factory: machines with their lights on, conveyors, an industrial
 *    furnace and a wall of monitors;
 *  - a power plant: solar fields, wind turbines, battery banks, a large
 *    generator fed from lava tanks, conduits;
 *  - a mine: a quarry over its open pit, drills, conveyors to crates, an ore
 *    scanner;
 *  - an automated farm: fields with planters, harvesters, sprinklers, a
 *    water tank and an item collector;
 *  - a control room: a glass-roofed hall of monitors and control panels.
 * The V4 and V3.5 places are still there with ?title=error_biome|village|
 * farlands|end|arena:
 *  - an Error Biome chunk, circling the one broken chunk in its landscape;
 *  - a V4 village, circling its houses, farms and decorated streets.
 * The V3.5 places are still there with ?title=farlands|end|arena:
 *  - the Farlands, the camera turning slowly above its broken terrain;
 *  - the End's main island, circling the exit portal and its pillars;
 *  - The Error's arena over the void, circling The Error itself.
 * Chunks are generated a few per frame so the menu stays responsive, then lit
 * together (so chunk borders have no seams) and handed to the normal world
 * renderer.
 */
import { WorldRenderer, type FrameState, type GameAssets } from './WorldRenderer';
import { ClientWorld } from '../world/ClientWorld';
import { ClientEntity } from '../game/ClientEntity';
import { EndGenerator } from '../../common/gen/end';
import { FarlandsGenerator } from '../../common/gen/farlands';
import { OverworldGenerator } from '../../common/gen/generator';
import { ComputerWorldGenerator } from '../../common/gen/computer';
import type { DimensionGenerator } from '../../common/gen/pipeline';
import { LightEngine } from '../../common/world/light';
import { encodeChunk, type Chunk } from '../../common/world/chunk';
import { chunkIndex, SEA_LEVEL } from '../../common/world/constants';
import { seedFromString, Random } from '../../common/math/rng';
import { STATE_SOLID, STATE_REPLACEABLE, STATE_FLUID, S, stateOf, blockHasTag } from '../../common/registry/blocks';
import type { Settings } from '../settings';
import { EndAtmosphere } from '../game/EndAtmosphere';
import { EXPANSION_BIOMES } from '../../common/endExpansion/biomes';
import { inExpansion } from '../../common/endExpansion/region';
import { CITADEL, citadelCandidates, planCitadel } from '../../common/endExpansion/citadel';
import { biomeOf } from '../../common/registry/biomes';

const RADIUS = 4;

type EngScene = 'factory' | 'power_plant' | 'mine' | 'farm' | 'control_room' | 'computer_lab';
type DigitalScene = 'digital_world' | 'herobrine_cave';
type EndScene = 'expanded_end' | 'crystal_fields' | 'void_citadel' | 'end_eclipse';
type HalloweenScene = 'haunted_forest' | 'pumpkin_patch' | 'ghost_marsh';
type Scene = 'farlands' | 'end' | 'arena' | 'error_biome' | 'village' | 'dragon_malware' | EngScene | DigitalScene | EndScene | HalloweenScene;
/** The Engineering Update's set scenes (built onto overworld terrain). */
const ENG_SCENES: EngScene[] = ['factory', 'power_plant', 'mine', 'farm', 'control_room', 'computer_lab'];
/** The End Expansion's scenes, shown at random; the others only when asked for. */
const END_SCENES: EndScene[] = ['expanded_end', 'crystal_fields', 'void_citadel', 'end_eclipse'];
const RANDOM_SCENES: Scene[] = [...END_SCENES];
/** V7: Halloween nights, in turn, while the season lasts. */
const HALLOWEEN_SCENES: HalloweenScene[] = ['haunted_forest', 'pumpkin_patch', 'ghost_marsh'];
/** Seconds each Halloween scene shows before the next. */
const ROTATE_SECONDS = 40;
const ALL_SCENES: Scene[] = [...HALLOWEEN_SCENES, ...END_SCENES, ...ENG_SCENES, 'digital_world', 'herobrine_cave', 'dragon_malware', 'error_biome', 'village', 'farlands', 'end', 'arena'];
const isEndScene = (s: Scene): s is EndScene => (END_SCENES as Scene[]).includes(s);
const isEng = (s: Scene): s is EngScene => (ENG_SCENES as Scene[]).includes(s);
const isHalloween = (s: Scene): s is HalloweenScene => (HALLOWEEN_SCENES as Scene[]).includes(s);

/** V7: the biomes each Halloween scene is looked for in (best first). */
const HALLOWEEN_BIOMES: Record<HalloweenScene, string[]> = {
  haunted_forest: ['dark_forest', 'forest', 'birch_forest', 'old_growth_birch_forest'],
  pumpkin_patch: ['plains', 'sunflower_plains', 'meadow'],
  ghost_marsh: ['swamp', 'mangrove_swamp'],
};

/** V7: each Halloween scene's night air (fog colour and thickness, as a cave's is given). */
const HALLOWEEN_FOG: Record<HalloweenScene, { color: number; density: number; amount: number }> = {
  haunted_forest: { color: 0x1e2636, density: 0, amount: 0.88 },
  pumpkin_patch: { color: 0x0e1222, density: 0.7, amount: 0.3 },
  ghost_marsh: { color: 0x1a2628, density: 0.2, amount: 0.65 },
};

/** What each scene looks like: particles in the air, camera tilt, extra light. */
const LOOK: Record<Scene, { particle: string; pitch: number; nightVision: number; aside: number }> = {
  farlands: { particle: 'glitch', pitch: 0.18, nightVision: 0, aside: 0 },
  end: { particle: 'portal', pitch: 0.32, nightVision: 0.35, aside: 0 },
  // Looking a little past The Error keeps it beside the menu, not behind it
  arena: { particle: 'glitch', pitch: -0.2, nightVision: 0.15, aside: 0.62 },
  error_biome: { particle: 'glitch', pitch: 0.42, nightVision: 0, aside: 0 },
  village: { particle: 'none', pitch: 0.27, nightVision: 0, aside: 0 },
  // Looking a little past the scene keeps it beside the menu
  factory: { particle: 'none', pitch: 0.3, nightVision: 0, aside: 0.55 },
  power_plant: { particle: 'none', pitch: 0.32, nightVision: 0, aside: 0.55 },
  mine: { particle: 'none', pitch: 0.42, nightVision: 0, aside: 0.5 },
  farm: { particle: 'none', pitch: 0.34, nightVision: 0, aside: 0.55 },
  control_room: { particle: 'none', pitch: 0.36, nightVision: 0, aside: 0.5 },
  computer_lab: { particle: 'none', pitch: 0.36, nightVision: 0, aside: 0.5 },
  digital_world: { particle: 'none', pitch: 0.06, nightVision: 0, aside: 0.35 },
  herobrine_cave: { particle: 'electric', pitch: 0.12, nightVision: 0.3, aside: 0.45 },
  dragon_malware: { particle: 'malware', pitch: 0.05, nightVision: 0.35, aside: 0.5 },
  expanded_end: { particle: 'end_mote_float', pitch: 0.22, nightVision: 0.3, aside: 0.45 },
  crystal_fields: { particle: 'crystal_glint', pitch: 0.28, nightVision: 0.3, aside: 0.45 },
  void_citadel: { particle: 'void_aura', pitch: -0.08, nightVision: 0.35, aside: 0.4 },
  end_eclipse: { particle: 'end_mote_float', pitch: 0.12, nightVision: 0.25, aside: 0.45 },
  // Herobrine stands right of the menu, at the end of the path
  haunted_forest: { particle: 'none', pitch: 0.03, nightVision: 0.12, aside: 0.62 },
  pumpkin_patch: { particle: 'none', pitch: 0.36, nightVision: 0.04, aside: 0.45 },
  ghost_marsh: { particle: 'none', pitch: 0.2, nightVision: 0.12, aside: 0.42 },
};

/** The Error's poses shown on the title screen, cycling. */
const ERROR_POSES = ['idle', 'roar', 'idle', 'cast', 'idle', 'laser'];

export class TitlePanorama {
  private renderer: WorldRenderer | null = null;
  private readonly world = new ClientWorld();
  private raf = 0;
  private active = true;
  private readonly start = performance.now();
  private center = { x: 0, y: 80, z: 0 };
  /** 0: turn in place; otherwise circle the centre at this distance, looking at it. */
  private orbit = 0;
  private scene: Scene = 'farlands';
  private boss: ClientEntity | null = null;
  private gen: DimensionGenerator | null = null;
  /** A camera that looks one way (the lake inside the computer) instead of turning. */
  private fixedYaw: number | null = null;
  /** How far a fixed camera looks left and right (radians). */
  private sway = 0.35;
  private disposed = false;
  private lastTick = 0;
  /** V6: the Expanded End's air (sky and fog by biome) for the End Expansion's scenes. */
  private readonly endAtmos = new EndAtmosphere();
  onReady: (() => void) | null = null;
  ready = false;
  /** V7: Halloween scenes take turns (not when one was asked for with ?title=). */
  private rotating = false;
  private switching = false;
  private sceneStart = 0;
  /** V7: where Herobrine stands at the end of the forest path. */
  private figure: { x: number; y: number; z: number } | null = null;
  /** V7: a fixed camera's spot and what it looks at (the marsh). */
  private look: { cam: { x: number; y: number; z: number }; at: { x: number; y: number; z: number } } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: GameAssets,
    private readonly settings: Settings,
    /** V7: the Halloween season is on (the menu's answer). */
    private readonly halloween = false,
  ) {}

  /** The scene showing (tests and screenshots). */
  get sceneName(): string {
    return this.scene;
  }

  run(): void {
    try {
      this.renderer = new WorldRenderer(this.canvas, this.world, this.assets, { ...this.settings, renderDistance: RADIUS + 2, fov: 75 });
    } catch {
      return; // no WebGL: the menu keeps its dirt background
    }
    const seed = seedFromString('title-' + Math.floor(Math.random() * 1e9));
    // ?title=factory|power_plant|mine|farm|control_room|error_biome|village|farlands|end|arena picks one (for screenshots)
    const asked = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('title') : null;
    const pool: Scene[] = this.halloween ? HALLOWEEN_SCENES : RANDOM_SCENES;
    this.scene = ALL_SCENES.includes(asked as Scene) ? (asked as Scene) : pool[Math.floor(Math.random() * pool.length)]!;
    this.rotating = this.halloween && !ALL_SCENES.includes(asked as Scene);
    this.startScene(seed);
  }

  private startScene(seed: number): void {
    if (isHalloween(this.scene)) {
      this.findHalloween(seed, this.scene);
      return;
    }
    if (this.scene === 'error_biome' || this.scene === 'village') {
      this.findOverworld(seed);
      return;
    }
    if (isEng(this.scene)) {
      const gen = new OverworldGenerator(seed);
      this.build(gen, gen.findSpawn());
      return;
    }
    if (this.scene === 'digital_world' || this.scene === 'herobrine_cave') {
      // Inside the computer: always the same seed
      const gen = new ComputerWorldGenerator(seed);
      const L = gen.layout();
      this.build(gen, this.scene === 'digital_world' ? { x: L.spawn.x, y: L.spawn.y, z: L.lake.z } : { x: L.hall.x, y: L.hall.y, z: L.hall.z });
      return;
    }
    if (this.scene === 'dragon_malware') {
      this.build(new EndGenerator(seed), { x: 0, y: 70, z: 0 });
      return;
    }
    if (isEndScene(this.scene)) {
      this.buildEndScene(seed);
      return;
    }
    let gen: DimensionGenerator;
    let focus: { x: number; y: number; z: number };
    if (this.scene === 'end') {
      gen = new EndGenerator(seed);
      focus = { x: 0, y: 70, z: 0 };
    } else {
      const far = new FarlandsGenerator(seed);
      gen = far;
      const arena = this.scene === 'arena' ? far.arenas?.nearest(Math.floor((Math.random() - 0.5) * 4000), Math.floor((Math.random() - 0.5) * 4000)) : null;
      if (arena) focus = { x: arena.x, y: arena.y, z: arena.z };
      else {
        this.scene = 'farlands';
        focus = far.findSpawn();
      }
    }
    this.build(gen, focus);
  }

  /** V6: the End Expansion's scenes, out in the Expanded End. */
  private buildEndScene(seed: number): void {
    const gen = new EndGenerator(seed);
    const ex = gen.terrain.expansion;
    const a = ex.arrival();
    let focus = { x: a.x, y: a.floor, z: a.z };
    const near = (id: string): { x: number; y: number; z: number } | null => ex.findBiome(EXPANSION_BIOMES.findIndex((b) => b.id === id), a.x, a.z, 2400);
    if (this.scene === 'crystal_fields') focus = near('end_crystal_fields') ?? focus;
    else if (this.scene === 'end_eclipse') focus = near('astral_end') ?? near('end_barrens') ?? focus;
    else if (this.scene === 'void_citadel') {
      // The Citadel's first site in the Void Wastes (the title shows it on its own: no other structure is asked about)
      for (const c of citadelCandidates(seed)) {
        if (!inExpansion(c.x, c.z) || EXPANSION_BIOMES[ex.regionAt(c.x, c.z).biome]?.id !== 'void_wastes') continue;
        gen.citadel = planCitadel(seed, { x: c.x, z: c.z });
        focus = { x: c.x, y: CITADEL.floor0 - 10, z: c.z };
        break;
      }
      if (!gen.citadel) this.scene = 'expanded_end';
    }
    this.build(gen, focus);
  }

  /** V6: an Eclipse Monolith and Eclipse Shards stamped near the focus (the eclipse scene). */
  private stampEclipse(chunks: Map<number, Chunk>, fx: number, fz: number): void {
    const get = (x: number, y: number, z: number): number => chunks.get(chunkIndex(x >> 4, z >> 4))?.get(x & 15, y, z & 15) ?? 0;
    const set = (x: number, y: number, z: number, st: number): void => {
      const c = chunks.get(chunkIndex(x >> 4, z >> 4));
      if (c && y > 0 && y < 255) c.set(x & 15, y, z & 15, st);
    };
    const top = (x: number, z: number): number => (chunks.get(chunkIndex(x >> 4, z >> 4))?.getHeight(x & 15, z & 15) ?? 0) - 1;
    const mx = fx + 6;
    const mz = fz - 4;
    const y0 = top(mx, mz);
    if (y0 > 0)
      for (let y = 1; y <= 9; y++)
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) set(mx + dx, y0 + y, mz + dz, y % 3 === 0 ? S('monolith_astral') : S('monolith_obsidian'));
    for (let i = 0; i < 26; i++) {
      const x = fx + Math.round(Math.cos(i * 2.4) * (3 + (i % 9)));
      const z = fz + Math.round(Math.sin(i * 2.4) * (3 + (i % 9)));
      const y = top(x, z);
      if (y > 0 && STATE_SOLID[get(x, y, z)] && get(x, y + 1, z) === 0) set(x, y + 1, z, S('eclipse_shard_growth'));
    }
  }

  /** V7: finds a spot well inside one of the scene's biomes, a little per frame, then builds it. */
  private findHalloween(seed: number, scene: HalloweenScene): void {
    const gen = new OverworldGenerator(seed);
    const all = HALLOWEEN_BIOMES[scene];
    // The first biome is the one wanted most (a dark forest): looked for alone first, nearer
    let want = new Set(all.slice(0, 1));
    const ox = Math.floor((Math.random() - 0.5) * 2000);
    const oz = Math.floor((Math.random() - 0.5) * 2000);
    const height = (x: number, z: number): number => gen.terrain.estimateHeight(x, z);
    // The forest and the field on dry land; the marsh down by its water
    const level = (x: number, z: number): boolean => (scene === 'ghost_marsh' ? Math.abs(height(x, z) - SEA_LEVEL) < 4 : height(x, z) > SEA_LEVEL + 3);
    const inside = (x: number, z: number): boolean => level(x, z) && [[0, 0], [28, 0], [-28, 0], [0, 28], [0, -28]].every(([dx, dz]) => all.includes(biomeOf(gen.biomeAt(x + dx!, z + dz!)).id));
    // Rings outwards from a random point, 48 blocks apart
    // The pumpkin patch is an open field, not somebody's village
    const clear = (x: number, z: number): boolean => {
      if (scene !== 'pumpkin_patch') return true;
      const v = gen.locate?.('village', x, z);
      return !v || Math.hypot(v.x - x, v.z - z) > 96;
    };
    const search = (function* (): Generator<void, { x: number; z: number } | null> {
      for (const pass of [24, 64]) {
        for (let r = 0; r <= pass; r++) {
          for (let i = -r; i <= r; i++)
            for (const [dx, dz] of r === 0 ? [[0, 0]] : [[i, -r], [i, r], [-r, i], [r, i]]) {
              const x = ox + dx! * 48;
              const z = oz + dz! * 48;
              if (want.has(biomeOf(gen.biomeAt(x, z)).id) && inside(x, z) && clear(x, z)) return { x, z };
            }
          yield;
        }
        want = new Set(all);
      }
      return null;
    })();
    const step = (): void => {
      if (this.disposed) return;
      const t0 = performance.now();
      let r = search.next();
      while (!r.done && performance.now() - t0 < 10) r = search.next();
      if (!r.done) {
        this.raf = requestAnimationFrame(step);
        return;
      }
      if (r.value) this.build(gen, { x: r.value.x, y: 64, z: r.value.z });
      else if (scene !== 'pumpkin_patch') {
        // No forest or marsh near (rare): a pumpkin patch wherever there is grass
        this.scene = 'pumpkin_patch';
        this.findHalloween(seed + 1, 'pumpkin_patch');
      } else this.build(gen, { ...gen.findSpawn() });
    };
    this.raf = requestAnimationFrame(step);
  }

  /** V7: stamps a Halloween scene onto its terrain (pumpkins, a path, scarecrows); returns the ground height at the focus. */
  private stampHalloween(chunks: Map<number, Chunk>, fx: number, fz: number): number {
    const get = (x: number, y: number, z: number): number => chunks.get(chunkIndex(x >> 4, z >> 4))?.get(x & 15, y, z & 15) ?? 0;
    const set = (x: number, y: number, z: number, st: number): void => {
      const c = chunks.get(chunkIndex(x >> 4, z >> 4));
      if (c && y > 0 && y < 255) c.set(x & 15, y, z & 15, st);
    };
    const soft = (st: number): boolean => st === 0 || blockHasTag(st, 'leaves') || blockHasTag(st, 'logs') || (!!STATE_REPLACEABLE[st] && !STATE_FLUID[st]);
    /** The first free spot over real ground (under the trees, not on them). */
    const ground = (x: number, z: number): number => {
      let y = (chunks.get(chunkIndex(x >> 4, z >> 4))?.getHeight(x & 15, z & 15) ?? 65) - 1;
      while (y > 1 && (soft(get(x, y, z)) || !STATE_SOLID[get(x, y, z)])) {
        if (STATE_FLUID[get(x, y, z)]) return -1;
        y--;
      }
      return y + 1;
    };
    const facingTo = (dx: number, dz: number): string => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north');
    const rng = new Random((fx * 73856093) ^ (fz * 19349663));
    const top = (x: number, z: number): number => chunks.get(chunkIndex(x >> 4, z >> 4))?.getHeight(x & 15, z & 15) ?? 65;
    let g0 = ground(fx, fz);
    if (g0 < 2) g0 = top(fx, fz);
    this.figure = null;
    this.look = null;
    switch (this.scene) {
      case 'haunted_forest': {
        // A path north into the trees, pumpkins along it, and him at its end
        const LEN = 22;
        let px = fx;
        for (let d = -5; d <= LEN; d++) {
          const z = fz - d;
          px = fx + Math.round(Math.sin(Math.max(0, d) * 0.21) * 1.6);
          // Wider where the camera stands, so no trunk is right in front of it
          const half = d < 6 ? 2 : 1;
          for (let dx = -half; dx <= half; dx++) {
            const x = px + dx;
            const gy = ground(x, z);
            if (gy < 2) continue;
            const under = get(x, gy - 1, z);
            if (d >= 0 && Math.abs(dx) <= 1 && (blockHasTag(under, 'dirt') || under === S('grass_block'))) set(x, gy - 1, z, S('dirt_path'));
            for (let y = gy; y <= gy + 5; y++) if (soft(get(x, y, z))) set(x, y, z, 0);
            // A trunk in the way goes altogether (no floating logs)
            for (let y = gy + 6; y <= gy + 30; y++) if (blockHasTag(get(x, y, z), 'logs')) set(x, y, z, 0);
          }
          if (d > 2 && d < LEN - 2 && d % 5 === 0) {
            const side = (d / 5) % 2 ? -2 : 2;
            const x = px + side;
            const gy = ground(x, z);
            // Grinning back down the path, at whoever comes along it
            if (gy > 1 && soft(get(x, gy, z))) set(x, gy, z, stateOf('hallow_pumpkin', { facing: 'south' }));
          }
        }
        const hz = fz - LEN;
        const hy = ground(px, hz);
        if (hy > 1) {
          this.figure = { x: px, y: hy, z: hz };
          if (soft(get(px + 1, hy, hz))) set(px + 1, hy, hz, S('redstone_torch'));
        }
        break;
      }
      case 'pumpkin_patch': {
        // Pumpkins all over the field, most of them carved and glowing, round a few scarecrows
        for (let i = 0; i < 52; i++) {
          const a = i * 2.39996 + rng.float(-0.2, 0.2);
          const r = 2.5 + Math.sqrt(i / 52) * 12;
          const x = Math.round(fx + Math.cos(a) * r);
          const z = Math.round(fz + Math.sin(a) * r);
          const gy = ground(x, z);
          if (gy < 2 || !soft(get(x, gy, z))) continue;
          const lit = rng.chance(0.62);
          set(x, gy, z, lit ? stateOf('hallow_pumpkin', { facing: facingTo(fx - x, fz - z) }) : S('pumpkin'));
          if (soft(get(x, gy + 1, z)) && get(x, gy + 1, z) !== 0) set(x, gy + 1, z, 0);
        }
        for (const [dx, dz] of [[5, -3], [-6, 2], [1, 7]] as const) {
          const x = fx + dx;
          const z = fz + dz;
          const gy = ground(x, z);
          if (gy < 2) continue;
          set(x, gy, z, S('oak_fence'));
          set(x, gy + 1, z, S('hay_block'));
          set(x, gy + 2, z, stateOf('hallow_pumpkin', { facing: facingTo(-dx, -dz) }));
        }
        break;
      }
      case 'ghost_marsh': {
        // The water: where the swamp's pools are, round the focus
        let wx = 0;
        let wz = 0;
        let wn = 0;
        let wy = SEA_LEVEL;
        for (let dz = -20; dz <= 20; dz++)
          for (let dx = -20; dx <= 20; dx++) {
            const h = top(fx + dx, fz + dz) - 1;
            if (!STATE_FLUID[get(fx + dx, h, fz + dz)]) continue;
            wx += fx + dx;
            wz += fz + dz;
            wy = h;
            wn++;
          }
        const cx = wn > 12 ? Math.round(wx / wn) : fx;
        const cz = wn > 12 ? Math.round(wz / wn) : fz;
        // A dry bank 9-16 blocks from the water's middle, looking across it
        let cam: { x: number; y: number; z: number } | null = null;
        for (let r = 9; r <= 16 && !cam; r++)
          for (let k = 0; k < 16 && !cam; k++) {
            const a = (k / 16) * Math.PI * 2;
            const x = Math.round(cx + Math.cos(a) * r);
            const z = Math.round(cz + Math.sin(a) * r);
            const gy = ground(x, z);
            if (gy > 1 && gy <= wy + 4) cam = { x, y: gy, z };
          }
        cam ??= { x: cx, y: wy + 1, z: cz + 12 };
        // No leaves right round the camera (it is not in a tree)
        for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) for (let y = cam.y; y <= cam.y + 9; y++) if (blockHasTag(get(cam.x + dx, y, cam.z + dz), 'leaves')) set(cam.x + dx, y, cam.z + dz, 0);
        this.look = { cam, at: { x: cx, y: wy + 1, z: cz } };
        // A few pumpkins glowing on the banks
        let n = 0;
        for (let i = 0; i < 400 && n < 9; i++) {
          const x = cx + rng.range(-14, 14);
          const z = cz + rng.range(-14, 14);
          const gy = ground(x, z);
          if (gy < 2 || !soft(get(x, gy, z))) continue;
          const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => STATE_FLUID[get(x + dx!, gy - 1, z + dz!)]);
          if (!wet) continue;
          set(x, gy, z, stateOf('hallow_pumpkin', { facing: facingTo(cam.x - x, cam.z - z) }));
          n++;
        }
        break;
      }
    }
    return g0;
  }

  /** V4 scenes: find the Error Biome or a village a step per frame, then build around it. */
  private findOverworld(seed: number): void {
    const gen = new OverworldGenerator(seed);
    const rx = Math.floor((Math.random() - 0.5) * 3000);
    const rz = Math.floor((Math.random() - 0.5) * 3000);
    const search = gen.locateSteps(this.scene, rx, rz);
    const step = (): void => {
      if (this.disposed) return;
      const t0 = performance.now();
      let r = search.next();
      while (!r.done && performance.now() - t0 < 10) r = search.next();
      if (!r.done) {
        this.raf = requestAnimationFrame(step);
        return;
      }
      if (r.value) this.build(gen, r.value);
      else {
        // Nothing near (very unlikely): fall back to the Farlands
        this.scene = 'farlands';
        const far = new FarlandsGenerator(seed);
        this.build(far, far.findSpawn());
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Generates the chunks around a focus a few per frame, lights them and starts the camera. */
  private build(gen: DimensionGenerator, focus: { x: number; y: number; z: number }): void {
    this.gen = gen;
    // The renderer draws whichever dimension the world says it is
    const dim = gen.dimension === 'end' ? 'end' : gen.dimension === 'overworld' ? 'overworld' : gen.dimension === 'computer' ? 'computer' : 'farlands';
    this.world.dimension = dim;
    this.world.hasSky = dim !== 'end';
    this.world.dimension = dim;
    this.renderer!.sky.dimension = dim;

    const ccx = Math.floor(focus.x) >> 4;
    const ccz = Math.floor(focus.z) >> 4;
    const todo: [number, number][] = [];
    for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) if (dx * dx + dz * dz <= RADIUS * RADIUS + RADIUS) todo.push([ccx + dx, ccz + dz]);
    const chunks = new Map<number, Chunk>();
    const step = (): void => {
      if (this.disposed) return;
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 12) {
        const [cx, cz] = todo.shift()!;
        chunks.set(chunkIndex(cx, cz), gen.generate(cx, cz));
      }
      if (todo.length) {
        this.raf = requestAnimationFrame(step);
        return;
      }
      if (isEng(this.scene)) focus = { ...focus, y: stampScene(this.scene, chunks, Math.floor(focus.x), Math.floor(focus.z)) };
      if (this.scene === 'end_eclipse') this.stampEclipse(chunks, Math.floor(focus.x), Math.floor(focus.z));
      if (isHalloween(this.scene)) focus = { ...focus, y: this.stampHalloween(chunks, Math.floor(focus.x), Math.floor(focus.z)) };
      const light = new LightEngine({ getChunk: (cx, cz) => chunks.get(chunkIndex(cx, cz)), markLightDirty: () => {} }, this.world.hasSky);
      for (const c of chunks.values()) light.initChunk(c);
      for (const c of chunks.values()) this.world.loadChunk(encodeChunk(c, { light: true, blockEntities: false }));
      this.frameScene(focus);
      this.ready = true;
      this.sceneStart = performance.now();
      this.switching = false;
      // V7: back in from the fade between Halloween scenes
      if (this.canvas.style.opacity === '0') this.canvas.style.opacity = '1';
      this.onReady?.();
      this.raf = requestAnimationFrame(this.frame);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Where the camera goes once the terrain is in. */
  private frameScene(focus: { x: number; y: number; z: number }): void {
    const w = this.world;
    const fx = Math.floor(focus.x);
    const fz = Math.floor(focus.z);
    switch (this.scene) {
      case 'farlands': {
        // Turning in place well above the ground
        const h = w.heightAt(fx, fz);
        this.center = { x: fx + 0.5, y: Math.max(focus.y + 14, h + 12), z: fz + 0.5 };
        this.orbit = 0;
        break;
      }
      case 'end': {
        // Circling the exit portal, high enough to see the pillars around it
        const h = w.heightAt(0, 0);
        this.center = { x: 0.5, y: h + 16, z: 0.5 };
        this.orbit = 30;
        break;
      }
      case 'dragon_malware': {
        // Circling the dragon as it hangs over the island, leaking data
        const h = w.heightAt(0, 0);
        this.center = { x: 0.5, y: h + 14, z: 0.5 };
        this.orbit = 26;
        this.boss = new ClientEntity(-1, 'ender_dragon', 0.5, h + 12, 0.5, 0, 0, { malware: true });
        this.renderer!.entities.add(this.boss);
        break;
      }
      case 'digital_world': {
        // From the hill where you arrive, over the still lake; he stands on the far shore in the fog
        const L = (this.gen as ComputerWorldGenerator).layout();
        this.center = { x: L.spawn.x + 0.5, y: L.spawn.y + 2.5, z: L.spawn.z + 6.5 };
        this.orbit = 0;
        this.fixedYaw = 0;
        this.boss = new ClientEntity(-1, 'herobrine', L.sighting.x + 0.5, L.sighting.y, L.sighting.z + 0.5, 0, 0, { hbAnim: 'stare', apparition: true });
        this.renderer!.entities.add(this.boss);
        break;
      }
      case 'herobrine_cave': {
        // Circling the hall; he stands plugged into the core
        const L = (this.gen as ComputerWorldGenerator).layout();
        this.center = { x: L.hall.x + 0.5, y: L.hall.y + 6, z: L.hall.z + 0.5 };
        this.orbit = 12;
        this.boss = new ClientEntity(-1, 'herobrine', L.throne.x + 0.5, L.throne.y, L.throne.z + 0.5, 0, 0, { hbAnim: 'plugged', hbKind: 'final' });
        this.renderer!.entities.add(this.boss);
        break;
      }
      case 'expanded_end':
      case 'crystal_fields':
      case 'end_eclipse': {
        // Circling the island from just above it
        const h = Math.max(focus.y, w.heightAt(fx, fz));
        this.center = { x: fx + 0.5, y: h + (this.scene === 'expanded_end' ? 14 : 9), z: fz + 0.5 };
        this.orbit = this.scene === 'expanded_end' ? 30 : 22;
        break;
      }
      case 'haunted_forest': {
        // Standing at the start of the path, looking along it into the fog; he is at its end
        this.center = { x: fx + 0.5, y: focus.y + 2.2, z: fz + 2.5 };
        this.orbit = 0;
        // Looking along the path (north), and a little to its right where he stands
        this.fixedYaw = 0;
        this.sway = 0.08;
        const f = this.figure;
        if (f) {
          this.boss = new ClientEntity(-1, 'herobrine', f.x + 0.5, f.y, f.z + 0.5, 0, 0, { hbAnim: 'stare', apparition: true });
          this.renderer!.entities.add(this.boss);
        }
        this.renderer!.ghosts.ambient = 2;
        this.renderer!.ghosts.ambientArea = { x: fx, y: focus.y, z: fz - 16, r: 7 };
        break;
      }
      case 'pumpkin_patch': {
        // Circling the field from a little above it
        this.center = { x: fx + 0.5, y: focus.y + 6, z: fz + 0.5 };
        this.orbit = 19;
        this.renderer!.ghosts.ambient = 3;
        this.renderer!.ghosts.ambientArea = { x: fx, y: focus.y + 1, z: fz, r: 12 };
        break;
      }
      case 'ghost_marsh': {
        // On the bank, looking out over the water; ghosts drift across it
        const L = this.look;
        const cam = L?.cam ?? { x: fx, y: focus.y, z: fz + 12 };
        const at = L?.at ?? { x: fx, y: focus.y, z: fz };
        this.center = { x: cam.x + 0.5, y: cam.y + 3.2, z: cam.z + 0.5 };
        this.orbit = 0;
        this.fixedYaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z));
        this.sway = 0.22;
        this.renderer!.ghosts.ambient = 4;
        this.renderer!.ghosts.ambientArea = { x: at.x, y: at.y - 0.5, z: at.z, r: 9 };
        break;
      }
      case 'void_citadel': {
        // Circling the tower that hangs into the void, a little below its island
        this.center = { x: fx + 0.5, y: focus.y, z: fz + 0.5 };
        this.orbit = 50;
        break;
      }
      case 'error_biome': {
        // Circling the broken chunk, close enough to see its glitched blocks
        const h = Math.max(focus.y, w.heightAt(fx, fz));
        this.center = { x: fx + 0.5, y: h + 12, z: fz + 0.5 };
        this.orbit = 22;
        break;
      }
      case 'factory':
      case 'power_plant':
      case 'mine':
      case 'farm':
      case 'computer_lab':
      case 'control_room': {
        // Circling the set scene from just above it
        this.center = { x: fx + 0.5, y: focus.y + (this.scene === 'mine' ? 10 : 8), z: fz + 0.5 };
        this.orbit = this.scene === 'control_room' || this.scene === 'computer_lab' ? 17 : 21;
        break;
      }
      case 'village': {
        // Circling the village from above its rooftops
        let h = focus.y;
        for (let dz = -12; dz <= 12; dz += 6) for (let dx = -12; dx <= 12; dx += 6) h = Math.max(h, w.heightAt(fx + dx, fz + dz));
        this.center = { x: fx + 0.5, y: h + 12, z: fz + 0.5 };
        this.orbit = 30;
        break;
      }
      case 'arena': {
        // Circling The Error, which stands in the middle of its platform
        this.center = { x: fx + 0.5, y: focus.y + 5, z: fz + 0.5 };
        this.orbit = 24;
        this.boss = new ClientEntity(-1, 'the_error', fx + 0.5, focus.y, fz + 0.5, 0, 0, { errorAnim: 'idle', errorPhase: 1 });
        this.renderer!.entities.add(this.boss);
        break;
      }
    }
  }

  private readonly frame = (): void => {
    if (this.disposed || !this.renderer) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.active) return;
    // V7: the next Halloween scene, after a fade
    if (this.rotating && !this.switching && performance.now() - this.sceneStart > ROTATE_SECONDS * 1000) this.rotate();
    const t = (performance.now() - this.start) / 1000;
    const r = this.renderer;
    const look = LOOK[this.scene];
    const c = this.center;
    // The world inside the computer: a slow look left and right across the lake
    const yaw = this.fixedYaw !== null ? this.fixedYaw + Math.sin(t * 0.06) * this.sway : t * 0.045;
    const cam = { x: c.x, y: c.y + Math.sin(t * 0.07) * 1.5, z: c.z };
    if (this.orbit > 0) {
      // Forward is (-sin yaw, -cos yaw): standing here looks straight at the centre
      cam.x += Math.sin(yaw) * this.orbit;
      cam.z += Math.cos(yaw) * this.orbit;
    }
    // Particles run at the game's 20 ticks a second
    while (this.lastTick < t * 20) {
      this.lastTick++;
      r.particles.tick();
      if (this.settings.particles !== 'minimal') {
        const x = cam.x + (Math.random() - 0.5) * 28;
        const y = cam.y + (Math.random() - 0.5) * 12;
        const z = cam.z + (Math.random() - 0.5) * 28;
        if (look.particle !== 'none' && !STATE_SOLID[this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) r.particles.spawn(look.particle, x, y, z, 1, 0.2);
      }
    }
    const boss = this.boss;
    if (boss) {
      if (boss.type === 'ender_dragon') {
        // The dragon circles slowly, coughing up malware now and then
        const a = t * 0.12;
        boss.x = boss.px = boss.tx = Math.cos(a) * 9;
        boss.z = boss.pz = boss.tz = Math.sin(a) * 9;
        boss.yaw = boss.tyaw = Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI;
        if (Math.floor(t * 20) % 70 === 0) r.particles.spawn('malware', boss.x - Math.sin(boss.yaw) * 6, boss.y + 2, boss.z - Math.cos(boss.yaw) * 6, 30, 1.2);
      } else {
        // It watches the camera, and shifts between poses now and then
        const face = Math.atan2(-(cam.x - boss.x), -(cam.z - boss.z));
        boss.yaw = boss.headYaw = boss.tyaw = boss.theadYaw = face;
        if (boss.type === 'the_error') boss.meta.errorAnim = ERROR_POSES[Math.floor(t / 5) % ERROR_POSES.length];
        if (boss.type === 'herobrine' && this.scene === 'herobrine_cave' && Math.floor(t * 20) % 60 === 0) r.particles.spawn('electric', boss.x, boss.y + 1.4, boss.z, 12, 0.5);
      }
      r.entities.update([boss], 1, t * 20, () => 1);
    }
    const fs: FrameState = {
      x: cam.x,
      y: cam.y,
      z: cam.z,
      yaw: yaw + look.aside,
      pitch: look.pitch,
      fovMod: 1,
      bobPhase: 0,
      bobAmount: 0,
      // V7: Halloween scenes are at midnight
      dayTime: isHalloween(this.scene) ? 18000 + t * 0.5 : 1500 + t * 4,
      time: t * 20,
      alpha: 1,
      rain: 0,
      thunder: 0,
      underwater: false,
      inLava: false,
      biomeSky: this.world.biomeAt(cam.x, cam.z).sky,
      target: null,
      crack: [],
      thirdPerson: 0,
      showHand: false,
      nightVision: look.nightVision,
      flash: 0,
      shake: 0,
      darkness: 0,
      hurtTilt: 0,
      cave: isHalloween(this.scene) ? HALLOWEEN_FOG[this.scene] : undefined,
    };
    // V6: the Expanded End's air, and the eclipse over its scene
    if (isEndScene(this.scene)) {
      this.endAtmos.update(true, cam.x, cam.z, (x, z) => this.world.biomeAt(x, z));
      fs.endAtmos = this.endAtmos.state;
      if (this.scene === 'end_eclipse') fs.endEvents = { storm: 0, eclipse: 1, dragonStorm: 0, citadel: null };
    }
    r.render(fs);
  };

  /** V7: fades out, then builds the next Halloween scene (it fades back in when ready). */
  private rotate(): void {
    this.switching = true;
    this.canvas.style.transition = 'opacity 0.9s';
    this.canvas.style.opacity = '0';
    setTimeout(() => {
      if (this.disposed) return;
      cancelAnimationFrame(this.raf);
      if (this.boss) this.renderer?.entities.remove(this.boss.id);
      this.boss = null;
      this.figure = null;
      this.look = null;
      this.fixedYaw = null;
      this.sway = 0.35;
      this.orbit = 0;
      this.ready = false;
      this.world.clear();
      const g = this.renderer?.ghosts;
      if (g) {
        g.clear();
        g.ambient = 0;
        g.ambientArea = null;
      }
      const i = HALLOWEEN_SCENES.indexOf(this.scene as HalloweenScene);
      this.scene = HALLOWEEN_SCENES[(i + 1) % HALLOWEEN_SCENES.length]!;
      this.startScene(seedFromString('title-' + Math.floor(Math.random() * 1e9)));
    }, 950);
  }

  /** Only renders while the title screen is visible. */
  setActive(on: boolean): void {
    this.active = on;
  }

  dispose(): void {
    this.disposed = true;
    // The game draws on the same canvas: no fade left behind
    this.canvas.style.transition = '';
    this.canvas.style.opacity = '';
    cancelAnimationFrame(this.raf);
    if (this.boss) this.renderer?.entities.remove(this.boss.id);
    this.world.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

/** Builds one of the Engineering Update's set scenes onto the terrain; returns its floor height. */
function stampScene(scene: EngScene, chunks: Map<number, Chunk>, fx: number, fz: number): number {
  const touched = new Set<Chunk>();
  const set = (x: number, y: number, z: number, st: number): void => {
    const c = chunks.get(chunkIndex(x >> 4, z >> 4));
    if (!c || y < 1 || y > 254) return;
    c.set(x & 15, y, z & 15, st);
    touched.add(c);
  };
  const solidAt = (x: number, y: number, z: number): boolean => !!STATE_SOLID[chunks.get(chunkIndex(x >> 4, z >> 4))?.get(x & 15, y, z & 15) ?? 1];
  const height = (x: number, z: number): number => chunks.get(chunkIndex(x >> 4, z >> 4))?.getHeight(x & 15, z & 15) ?? 64;
  const R = 11;
  let y0 = 0;
  for (let dz = -R; dz <= R; dz += 4) for (let dx = -R; dx <= R; dx += 4) y0 = Math.max(y0, height(fx + dx, fz + dz));
  y0 = Math.min(y0, Math.max(height(fx, fz) + 3, 66));
  // Relative helpers: (dx, dy, dz) from the centre of the floor
  const put = (dx: number, dy: number, dz: number, st: number): void => set(fx + dx, y0 + dy, fz + dz, st);
  const on = (id: string, facing = 'south'): number => stateOf(id, { facing, status: 'working' });
  const arms = (id: string, a: string[]): number => stateOf(id, Object.fromEntries(a.map((k) => [k, 'true'])));
  const line = (id: string, x0: number, x1: number, dz: number, dy = 0): void => {
    for (let dx = x0; dx <= x1; dx++) put(dx, dy, dz, arms(id, [...(dx > x0 ? ['west'] : []), ...(dx < x1 ? ['east'] : [])]));
  };
  const lineZ = (id: string, dx: number, z0: number, z1: number, dy = 0): void => {
    for (let dz = z0; dz <= z1; dz++) put(dx, dy, dz, arms(id, [...(dz > z0 ? ['north'] : []), ...(dz < z1 ? ['south'] : [])]));
  };
  const turbine = (dx: number, dz: number, h = 4): void => {
    for (let y = 0; y < h; y++) put(dx, y, dz, S('steel_block'));
    put(dx, h, dz, on('wind_turbine'));
  };
  const hollowCube = (cx: number, cz: number, controller: string): void => {
    // A 3x3x3 casing cube behind (north of) its controller, hollow in the middle
    for (let dx = -1; dx <= 1; dx++)
      for (let y = 0; y <= 2; y++)
        for (let dz = -2; dz <= 0; dz++) {
          if (dx === 0 && y === 1 && dz >= -1) continue;
          put(cx + dx, y, cz + dz, y === 2 || dx !== 0 ? S('machine_casing') : S('industrial_glass'));
        }
    put(cx, 1, cz, on(controller));
  };

  // A clearing around the site, so no hillside hides it: everything above the
  // floor goes, out to a ring that slopes gently back up to the terrain
  const CLEAR = R + 12;
  for (let dz = -CLEAR; dz <= CLEAR; dz++)
    for (let dx = -CLEAR; dx <= CLEAR; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d <= R) continue;
      const top = y0 - 1 + Math.max(0, d - R - 4);
      const x = fx + dx;
      const z = fz + dz;
      for (let y = top + 1; y <= y0 + 24; y++) set(x, y, z, 0);
      if (solidAt(x, top, z)) set(x, top, z, S('grass_block'));
    }
  // The site: a metal floor on steel legs, open air above
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      const x = fx + dx;
      const z = fz + dz;
      for (let y = y0; y <= y0 + 12; y++) set(x, y, z, 0);
      const edge = Math.abs(dx) === R || Math.abs(dz) === R;
      const floor = edge ? S('hazard_stripes') : scene === 'farm' ? S('dirt') : (dx + dz) % 6 === 0 ? S('steel_block') : scene === 'mine' ? S('metal_grate') : scene === 'computer_lab' ? S('circuit_stone') : S('machine_casing');
      set(x, y0 - 1, z, floor);
      if (edge && dx % 5 === 0 && dz % 5 === 0) for (let y = y0 - 2; y > y0 - 12 && !solidAt(x, y, z); y--) set(x, y, z, S('steel_block'));
    }
  for (const [dx, dz] of [[-R, -R], [R, -R], [-R, R], [R, R]] as const) put(dx, 0, dz, S('factory_light'));

  switch (scene) {
    case 'factory': {
      for (let dx = -9; dx <= 9; dx++) for (const dz of [-9, -8]) put(dx, 0, dz, on('solar_panel'));
      for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) turbine(dx, dz);
      line('power_conduit', -9, 9, -6);
      for (const dx of [-9, -8, -7]) put(dx, 0, -5, stateOf('battery_bank', { charge: '4' }));
      hollowCube(0, 0, 'industrial_furnace');
      for (let dx = -6; dx <= 6; dx++) put(dx, 0, 4, stateOf(dx % 4 === 0 ? 'express_conveyor' : 'conveyor', { facing: 'east' }));
      put(-7, 0, 4, on('crusher', 'west'));
      put(7, 0, 4, on('electric_furnace', 'west'));
      put(8, 0, 4, stateOf('hopper', { facing: 'east' }));
      put(9, 0, 4, S('industrial_chest'));
      ['crusher', 'grinder', 'compressor', 'cutter', 'electric_furnace', 'recycler', 'assembler', 'pump', 'mining_drill'].forEach((id, i) => put(-8 + i * 2, 0, 7, on(id)));
      line('insulated_cable', -8, 8, 6);
      for (const dz of [-3, -1]) put(-9, 0, dz, stateOf('fluid_tank', { fluid: 'water', level: '6' }));
      lineZ('fluid_pipe', -9, -2, -2);
      put(9, 0, -2, stateOf('fluid_tank', { fluid: 'lava', level: '5' }));
      for (let dx = 4; dx <= 8; dx++) {
        put(dx, 0, -3, S('steel_block'));
        put(dx, 1, -3, on('monitor'));
        put(dx, 2, -3, dx === 6 ? on('control_panel') : on('monitor'));
      }
      for (const dx of [3, 9]) put(dx, 0, -2, stateOf('warning_light', { lit: 'true' }));
      break;
    }
    case 'power_plant': {
      // Solar fields on both sides, turbines along the back, the large generator in the middle
      for (let dx = -9; dx <= -3; dx++) for (let dz = -9; dz <= -3; dz++) put(dx, 0, dz, on('solar_panel'));
      for (let dx = 3; dx <= 9; dx++) for (let dz = -9; dz <= -3; dz++) put(dx, 0, dz, on('solar_panel'));
      for (const dx of [-9, -5, 5, 9]) turbine(dx, 9, 6);
      for (const dx of [-1, 1]) turbine(dx * 2, -9, 5);
      hollowCube(0, 3, 'large_generator');
      // Lava tanks piped into the generator, battery banks and an energy cell on conduits
      for (const dx of [-4, 4]) for (let dy = 0; dy <= 1; dy++) put(dx, dy, 1, stateOf('fluid_tank', { fluid: 'lava', level: dy ? '4' : '8' }));
      line('fluid_pipe', -3, -2, 1);
      line('fluid_pipe', 2, 3, 1);
      line('power_conduit', -9, 9, 6);
      lineZ('power_conduit', 0, 4, 5);
      for (let dx = -9; dx <= -3; dx++) for (const dz of [7, 8]) put(dx, 0, dz, stateOf('battery_bank', { charge: String(2 + ((dx + dz) & 1) * 2) }));
      for (let dx = 3; dx <= 7; dx++) put(dx, 0, 7, stateOf('energy_cell', { charge: '4' }));
      put(8, 0, 7, on('steam_generator'));
      put(9, 0, 7, on('advanced_generator'));
      put(0, 0, 7, on('monitor'));
      put(1, 0, 7, on('monitor'));
      for (const dx of [-2, 2]) put(dx, 0, 5, stateOf('warning_light', { lit: 'true' }));
      break;
    }
    case 'mine': {
      // The quarry's open pit: terraces cut down into the ground, ores in the walls
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++) {
          const depth = 2 + (4 - Math.max(Math.abs(dx), Math.abs(dz))) * 2;
          for (let y = -1; y >= -depth; y--) put(dx, y, dz, 0);
          put(dx, -depth - 1, dz, (dx * 7 + dz * 3) % 5 === 0 ? S('iron_ore') : (dx + dz * 5) % 7 === 0 ? S('copper_ore') : S('stone'));
        }
      // The quarry frame: a ring of casing around the controller, raised over the pit on legs
      for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]] as const) for (let y = 0; y <= 3; y++) put(dx, y, dz, S('steel_block'));
      for (let i = -5; i <= 5; i++) for (const [a, b] of [[i, -5], [i, 5], [-5, i], [5, i]] as const) put(a, 4, b, S('machine_casing'));
      put(0, 4, -5, on('quarry'));
      for (let dz = -5; dz <= 5; dz++) put(0, 4, dz, dz === -5 ? on('quarry') : S('metal_grate'));
      // Drills on the rim, conveyors carrying the haul to crates
      for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8]] as const) put(dx, 0, dz, on('mining_drill'));
      for (let dx = -4; dx <= 8; dx++) put(dx, 0, 7, stateOf(dx % 3 === 0 ? 'express_conveyor' : 'conveyor', { facing: 'east' }));
      put(9, 0, 7, S('crate'));
      put(9, 0, 8, S('crate'));
      put(9, 0, 6, S('storage_barrel'));
      put(-6, 0, 7, on('crusher', 'west'));
      put(-5, 0, 7, on('electric_furnace', 'west'));
      put(-8, 0, 0, on('ore_scanner'));
      line('insulated_cable', -9, -6, 9);
      for (const dx of [-9, -8, -7]) put(dx, 0, 8, stateOf('battery_bank', { charge: '4' }));
      for (const dz of [-9, -7]) turbine(9, dz);
      for (const dx of [-7, -3, 3, 7]) put(dx, 0, -9, stateOf('warning_light', { lit: 'true' }));
      break;
    }
    case 'farm': {
      // Four fields of crops at different stages, watered by sprinklers fed from a tank
      const crops = ['wheat', 'carrots', 'potatoes', 'wheat'];
      const fields: [number, number][] = [[-9, -9], [2, -9], [-9, 2], [2, 2]];
      fields.forEach(([x0, z0], i) => {
        const id = crops[i]!;
        const max = id === 'wheat' ? 7 : 3;
        for (let dz = 0; dz < 7; dz++)
          for (let dx = 0; dx < 7; dx++) {
            if (dx === 3 && dz === 3) {
              put(x0 + dx, -1, z0 + dz, S('machine_casing'));
              put(x0 + dx, 0, z0 + dz, on(i % 2 ? 'crop_harvester' : 'irrigation_sprinkler'));
              continue;
            }
            put(x0 + dx, -1, z0 + dz, stateOf('farmland', { moisture: '7' }));
            put(x0 + dx, 0, z0 + dz, stateOf(id, { age: String(Math.min(max, Math.floor(((dx + dz * 3) % 9) / 8 * (max + 1)))) }));
          }
      });
      // Paths between the fields with the machinery
      for (let d = -9; d <= 9; d++) {
        put(d, -1, 0, S('steel_block'));
        put(0, -1, d, S('steel_block'));
        put(d, -1, 1, S('steel_block'));
        put(1, -1, d, S('steel_block'));
      }
      line('fluid_pipe', -9, 9, 0);
      put(-10, 0, 0, stateOf('fluid_tank', { fluid: 'water', level: '7' }));
      put(-10, 1, 0, stateOf('fluid_tank', { fluid: 'water', level: '8' }));
      put(10, 0, 0, on('pump', 'west'));
      line('copper_wire', -9, 9, 1);
      for (const [dx, dz] of [[0, -9], [0, 9], [1, -9], [1, 9]] as const) put(dx, 0, dz, on('crop_planter'));
      put(0, 0, -6, on('item_collector'));
      put(1, 0, 6, on('animal_feeder'));
      for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) turbine(dx, dz, 3);
      for (const [dx, dz] of [[-10, 3], [10, 3]] as const) put(dx, 0, dz, on('solar_panel'));
      put(10, 0, -3, S('crate'));
      put(10, 0, -2, stateOf('hopper', { facing: 'down' }));
      break;
    }
    case 'computer_lab': {
      // V5.5: a glass-roofed lab: desks of computers, server racks on network cable, one screen gone wrong
      const W = 8;
      for (let dz = -W; dz <= W; dz++)
        for (let dx = -W; dx <= W; dx++) {
          const wall = Math.abs(dx) === W || Math.abs(dz) === W;
          if (wall) for (let y = 0; y <= 3; y++) put(dx, y, dz, y === 1 || y === 2 ? ((dx + dz) % 4 === 0 ? S('machine_casing') : S('industrial_glass')) : S('machine_casing'));
          put(dx, 4, dz, wall ? S('machine_casing') : (dx % 4 === 0 && dz % 4 === 0 ? S('factory_light') : S('industrial_glass')));
          if (!wall) put(dx, -1, dz, (dx + dz) % 2 === 0 ? S('steel_block') : S('metal_grate'));
        }
      put(0, 1, W, 0);
      put(0, 0, W, 0);
      const pc = (screen: string, facing = 'south'): number => stateOf('computer', { facing, screen });
      // Three rows of desks: a case on the floor, a monitor and keyboard on the desk beside it
      let k = 0;
      for (const dz of [-3, 1, 5])
        for (const dx of [-6, -2, 2]) {
          const bad = dz === 1 && dx === -2;
          put(dx, 0, dz, pc(bad ? 'glitch' : k % 4 === 3 ? 'boot' : 'on'));
          put(dx + 1, 0, dz, S('steel_block'));
          put(dx + 2, 0, dz, S('steel_block'));
          put(dx + 1, 1, dz, stateOf('monitor', { facing: 'south', status: bad ? 'error' : 'working' }));
          put(dx + 2, 1, dz, k % 2 ? stateOf('speaker', { facing: 'south' }) : stateOf('keyboard', { facing: 'south' }));
          put(dx + 3, 0, dz, stateOf('led_light', { facing: 'south', lit: 'true' }));
          k++;
        }
      // Server racks along the back wall, cabled together
      for (let dx = -6; dx <= 6; dx++) {
        put(dx, 0, -W + 1, stateOf('server_rack', { facing: 'south', status: dx === 0 ? 'error' : 'working' }));
        put(dx, 1, -W + 1, stateOf('server_rack', { facing: 'south', status: 'working' }));
      }
      line('network_cable', -6, 6, -W + 2);
      lineZ('network_cable', -7, -6, 5);
      // Power outside
      for (let dx = -10; dx <= 10; dx++) put(dx, 0, -10, on('solar_panel'));
      for (const [dx, dz] of [[-10, 9], [10, 9]] as const) turbine(dx, dz, 5);
      for (let dx = -6; dx <= 6; dx += 2) put(dx, 0, 10, stateOf('battery_bank', { charge: '4' }));
      for (const [dx, dz] of [[-7, 7], [7, 7]] as const) put(dx, 0, dz, stateOf('warning_light', { lit: 'true' }));
      break;
    }
    case 'control_room': {
      // A hall of casing walls with windows and a glass roof; monitors and panels inside
      const W = 7;
      for (let dz = -W; dz <= W; dz++)
        for (let dx = -W; dx <= W; dx++) {
          const wall = Math.abs(dx) === W || Math.abs(dz) === W;
          if (wall) for (let y = 0; y <= 3; y++) put(dx, y, dz, y === 1 || y === 2 ? ((dx + dz) % 3 === 0 ? S('machine_casing') : S('industrial_glass')) : S('machine_casing'));
          put(dx, 4, dz, wall ? S('machine_casing') : (dx % 3 === 0 && dz % 3 === 0 ? S('factory_light') : S('industrial_glass')));
          if (!wall) put(dx, -1, dz, (dx + dz) % 2 === 0 ? S('steel_block') : S('metal_grate'));
        }
      put(0, 1, W, 0);
      put(0, 0, W, 0);
      // Monitor walls on three sides, consoles in the middle
      for (let d = -5; d <= 5; d++) {
        for (const y of [1, 2]) {
          put(d, y, -W + 1, on('monitor'));
          put(-W + 1, y, d, on('monitor', 'east'));
          put(W - 1, y, d, on('monitor', 'west'));
        }
        put(d, 0, -W + 1, S('steel_block'));
        put(-W + 1, 0, d, S('steel_block'));
        put(W - 1, 0, d, S('steel_block'));
      }
      for (const dx of [-3, 0, 3]) {
        put(dx, 0, -1, on('control_panel'));
        put(dx, 0, 0, S('steel_block'));
        put(dx, 0, 2, on('control_panel', 'north'));
      }
      for (const [dx, dz] of [[-5, 5], [5, 5]] as const) put(dx, 0, dz, stateOf('warning_light', { lit: 'true' }));
      // Outside: the plant it watches over
      for (let dx = -10; dx <= 10; dx++) put(dx, 0, -10, on('solar_panel'));
      for (const [dx, dz] of [[-10, 9], [10, 9], [-10, -8], [10, -8]] as const) turbine(dx, dz, 5);
      line('power_conduit', -10, 10, 9, 0);
      for (let dx = -6; dx <= 6; dx += 2) put(dx, 0, 10, stateOf('battery_bank', { charge: '4' }));
      for (const dz of [-6, -2, 2, 6]) {
        put(-10, 0, dz, on('electric_furnace', 'east'));
        put(10, 0, dz, on('crusher', 'west'));
      }
      break;
    }
  }
  for (const c of touched) c.recomputeHeightmap();
  return y0;
}
