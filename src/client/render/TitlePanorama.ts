/**
 * The title screen backdrop: a patch of real, freshly generated terrain from
 * a random seed. Since V3.5 it is one of three places, picked at random:
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
import type { DimensionGenerator } from '../../common/gen/pipeline';
import { LightEngine } from '../../common/world/light';
import { encodeChunk, type Chunk } from '../../common/world/chunk';
import { chunkIndex } from '../../common/world/constants';
import { seedFromString } from '../../common/math/rng';
import { STATE_SOLID } from '../../common/registry/blocks';
import type { Settings } from '../settings';

const RADIUS = 4;

type Scene = 'farlands' | 'end' | 'arena';

/** What each scene looks like: particles in the air, camera tilt, extra light. */
const LOOK: Record<Scene, { particle: string; pitch: number; nightVision: number; aside: number }> = {
  farlands: { particle: 'glitch', pitch: 0.18, nightVision: 0, aside: 0 },
  end: { particle: 'portal', pitch: 0.32, nightVision: 0.35, aside: 0 },
  // Looking a little past The Error keeps it beside the menu, not behind it
  arena: { particle: 'glitch', pitch: -0.2, nightVision: 0.15, aside: 0.62 },
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
    const scenes: Scene[] = ['farlands', 'end', 'arena'];
    // ?title=farlands|end|arena picks one (for screenshots)
    const asked = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('title') : null;
    this.scene = scenes.includes(asked as Scene) ? (asked as Scene) : scenes[Math.floor(Math.random() * scenes.length)]!;
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
    // The renderer draws whichever dimension the world says it is
    const dim = this.scene === 'end' ? 'end' : 'farlands';
    this.world.dimension = dim;
    this.world.hasSky = dim !== 'end';
    this.renderer.sky.dimension = dim;

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
        if (!STATE_SOLID[this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) r.particles.spawn(look.particle, x, y, z, 1, 0.2);
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
