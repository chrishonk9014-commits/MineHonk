/**
 * The title screen backdrop: a patch of real, freshly generated terrain from
 * a random seed. Since V5 it mostly shows The Engineering Update:
 *  - a working factory: generators, cables, machines with their lights on,
 *    conveyors, a multiblock furnace and a control room;
 * and sometimes The World Update:
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
import type { DimensionGenerator } from '../../common/gen/pipeline';
import { LightEngine } from '../../common/world/light';
import { encodeChunk, type Chunk } from '../../common/world/chunk';
import { chunkIndex } from '../../common/world/constants';
import { seedFromString } from '../../common/math/rng';
import { STATE_SOLID, S, stateOf } from '../../common/registry/blocks';
import type { Settings } from '../settings';

const RADIUS = 4;

type Scene = 'farlands' | 'end' | 'arena' | 'error_biome' | 'village' | 'factory';
/** Shown at random (the factory most often); the others only when asked for. */
const RANDOM_SCENES: Scene[] = ['factory', 'factory', 'factory', 'error_biome', 'village'];
const ALL_SCENES: Scene[] = ['factory', 'error_biome', 'village', 'farlands', 'end', 'arena'];

/** What each scene looks like: particles in the air, camera tilt, extra light. */
const LOOK: Record<Scene, { particle: string; pitch: number; nightVision: number; aside: number }> = {
  farlands: { particle: 'glitch', pitch: 0.18, nightVision: 0, aside: 0 },
  end: { particle: 'portal', pitch: 0.32, nightVision: 0.35, aside: 0 },
  // Looking a little past The Error keeps it beside the menu, not behind it
  arena: { particle: 'glitch', pitch: -0.2, nightVision: 0.15, aside: 0.62 },
  error_biome: { particle: 'glitch', pitch: 0.42, nightVision: 0, aside: 0 },
  village: { particle: 'none', pitch: 0.27, nightVision: 0, aside: 0 },
  // Looking a little past the factory keeps it beside the menu
  factory: { particle: 'none', pitch: 0.3, nightVision: 0, aside: 0.55 },
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
  private disposed = false;
  private lastTick = 0;
  onReady: (() => void) | null = null;
  ready = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: GameAssets,
    private readonly settings: Settings,
  ) {}

  run(): void {
    try {
      this.renderer = new WorldRenderer(this.canvas, this.world, this.assets, { ...this.settings, renderDistance: RADIUS + 2, fov: 75 });
    } catch {
      return; // no WebGL: the menu keeps its dirt background
    }
    const seed = seedFromString('title-' + Math.floor(Math.random() * 1e9));
    // ?title=factory|error_biome|village|farlands|end|arena picks one (for screenshots)
    const asked = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('title') : null;
    this.scene = ALL_SCENES.includes(asked as Scene) ? (asked as Scene) : RANDOM_SCENES[Math.floor(Math.random() * RANDOM_SCENES.length)]!;
    if (this.scene === 'error_biome' || this.scene === 'village') {
      this.findOverworld(seed);
      return;
    }
    if (this.scene === 'factory') {
      const gen = new OverworldGenerator(seed);
      this.build(gen, gen.findSpawn());
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
    // The renderer draws whichever dimension the world says it is
    const dim = gen.dimension === 'end' ? 'end' : gen.dimension === 'overworld' ? 'overworld' : 'farlands';
    this.world.dimension = dim;
    this.world.hasSky = dim !== 'end';
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
      if (this.scene === 'factory') focus = { ...focus, y: stampFactory(chunks, Math.floor(focus.x), Math.floor(focus.z)) };
      const light = new LightEngine({ getChunk: (cx, cz) => chunks.get(chunkIndex(cx, cz)), markLightDirty: () => {} }, this.world.hasSky);
      for (const c of chunks.values()) light.initChunk(c);
      for (const c of chunks.values()) this.world.loadChunk(encodeChunk(c, { light: true, blockEntities: false }));
      this.frameScene(focus);
      this.ready = true;
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
      case 'error_biome': {
        // Circling the broken chunk, close enough to see its glitched blocks
        const h = Math.max(focus.y, w.heightAt(fx, fz));
        this.center = { x: fx + 0.5, y: h + 12, z: fz + 0.5 };
        this.orbit = 22;
        break;
      }
      case 'factory': {
        // Circling the factory from above its machines
        this.center = { x: fx + 0.5, y: focus.y + 8, z: fz + 0.5 };
        this.orbit = 21;
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
    const t = (performance.now() - this.start) / 1000;
    const r = this.renderer;
    const look = LOOK[this.scene];
    const c = this.center;
    const yaw = t * 0.045;
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
      // It watches the camera, and shifts between poses now and then
      const face = Math.atan2(-(cam.x - boss.x), -(cam.z - boss.z));
      boss.yaw = boss.headYaw = boss.tyaw = boss.theadYaw = face;
      boss.meta.errorAnim = ERROR_POSES[Math.floor(t / 5) % ERROR_POSES.length];
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
      dayTime: 1500 + t * 4,
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
      cave: undefined,
    };
    r.render(fs);
  };

  /** Only renders while the title screen is visible. */
  setActive(on: boolean): void {
    this.active = on;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.boss) this.renderer?.entities.remove(this.boss.id);
    this.world.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

/**
 * A small working factory for the title screen, built on the generated
 * terrain: solar panels and wind turbines, battery banks, cable runs,
 * machines with their lights on, a conveyor line, an industrial furnace
 * and a control room. Returns the floor height.
 */
function stampFactory(chunks: Map<number, Chunk>, fx: number, fz: number): number {
  const touched = new Set<Chunk>();
  const set = (x: number, y: number, z: number, st: number): void => {
    const c = chunks.get(chunkIndex(x >> 4, z >> 4));
    if (!c || y < 1 || y > 254) return;
    c.set(x & 15, y, z & 15, st);
    touched.add(c);
  };
  const height = (x: number, z: number): number => chunks.get(chunkIndex(x >> 4, z >> 4))?.getHeight(x & 15, z & 15) ?? 64;
  const R = 11;
  let y0 = 0;
  for (let dz = -R; dz <= R; dz += 4) for (let dx = -R; dx <= R; dx += 4) y0 = Math.max(y0, height(fx + dx, fz + dz));
  y0 = Math.min(y0, Math.max(height(fx, fz) + 3, 66));
  // Floor on steel legs, open air above
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      const x = fx + dx;
      const z = fz + dz;
      for (let y = y0; y <= y0 + 12; y++) set(x, y, z, 0);
      const edge = Math.abs(dx) === R || Math.abs(dz) === R;
      set(x, y0 - 1, z, edge ? S('hazard_stripes') : (dx + dz) % 6 === 0 ? S('steel_block') : S('machine_casing'));
      if (edge && dx % 5 === 0 && dz % 5 === 0) for (let y = y0 - 2; y > y0 - 12 && !STATE_SOLID[chunks.get(chunkIndex(x >> 4, z >> 4))?.get(x & 15, y, z & 15) ?? 1]; y--) set(x, y, z, S('steel_block'));
    }
  const on = (id: string, facing: string): number => stateOf(id, { facing, status: 'working' });
  const cable = (id: string, arms: string[]): number => stateOf(id, Object.fromEntries(arms.map((a) => [a, 'true'])));
  // Solar field along the back
  for (let dx = -9; dx <= 9; dx++) for (const dz of [-9, -8]) set(fx + dx, y0, fz + dz, on('solar_panel', 'south'));
  // Wind turbines on posts at the corners
  for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) {
    for (let y = y0; y < y0 + 4; y++) set(fx + dx, y, fz + dz, S('steel_block'));
    set(fx + dx, y0 + 4, fz + dz, on('wind_turbine', 'south'));
    set(fx + dx, y0 + 5, fz + dz, S('factory_light'));
  }
  // Power: battery banks and a main cable
  for (let dx = -9; dx <= 9; dx++) set(fx + dx, y0, fz - 6, cable('power_conduit', dx > -9 ? ['west', 'east'] : ['east']));
  for (const dx of [-9, -8, -7]) set(fx + dx, y0, fz - 5, stateOf('battery_bank', { charge: '4' }));
  // The industrial furnace (hollow casing cube) in the middle
  for (let dx = -1; dx <= 1; dx++)
    for (let y = 0; y <= 2; y++)
      for (let dz = -2; dz <= 0; dz++) {
        if (dx === 0 && y === 1 && dz >= -1) continue;
        set(fx + dx, y0 + y, fz + dz, y === 2 || dx !== 0 ? S('machine_casing') : S('industrial_glass'));
      }
  set(fx, y0 + 1, fz, on('industrial_furnace', 'south'));
  // A conveyor line between machines, with their lights on
  for (let dx = -6; dx <= 6; dx++) set(fx + dx, y0, fz + 4, stateOf(dx % 4 === 0 ? 'express_conveyor' : 'conveyor', { facing: 'east' }));
  set(fx - 7, y0, fz + 4, on('crusher', 'west'));
  set(fx + 7, y0, fz + 4, on('electric_furnace', 'west'));
  set(fx + 8, y0, fz + 4, stateOf('hopper', { facing: 'east' }));
  set(fx + 9, y0, fz + 4, S('industrial_chest'));
  const row = ['crusher', 'grinder', 'compressor', 'cutter', 'electric_furnace', 'recycler', 'assembler', 'pump', 'mining_drill'];
  row.forEach((id, i) => set(fx - 8 + i * 2, y0, fz + 7, on(id, 'south')));
  for (let dx = -8; dx <= 8; dx++) set(fx + dx, y0, fz + 6, cable('insulated_cable', ['west', 'east']));
  // Fluids: tanks with a pipe run
  for (const dz of [-3, -1]) set(fx - 9, y0, fz + dz, stateOf('fluid_tank', { fluid: 'water', level: '6' }));
  set(fx - 9, y0, fz - 2, cable('fluid_pipe', ['north', 'south']));
  set(fx + 9, y0, fz - 2, stateOf('fluid_tank', { fluid: 'lava', level: '5' }));
  // The control room: a wall of monitors and a control panel facing the furnace
  for (let dx = 4; dx <= 8; dx++) {
    set(fx + dx, y0, fz - 3, S('steel_block'));
    set(fx + dx, y0 + 1, fz - 3, on('monitor', 'south'));
    set(fx + dx, y0 + 2, fz - 3, dx === 6 ? on('control_panel', 'south') : on('monitor', 'south'));
  }
  for (const dx of [3, 9]) set(fx + dx, y0, fz - 2, stateOf('warning_light', { lit: 'true' }));
  for (const [dx, dz] of [[-4, 0], [4, 0], [0, 9], [-6, -3]] as const) set(fx + dx, y0, fz + dz, S('factory_light'));
  for (const c of touched) c.recomputeHeightmap();
  return y0;
}
