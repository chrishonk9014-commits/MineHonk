/**
 * The title screen backdrop: a patch of real, freshly generated terrain,
 * slowly orbited by the camera. Since the Caves Update it is the inside of
 * a random mega-cavern from a random seed (falling back to a scenic spawn
 * when none is found). Chunks are generated a few per frame so the menu
 * stays responsive, then lit together (so chunk borders have no seams) and
 * handed to the normal world renderer.
 */
import { WorldRenderer, type FrameState, type GameAssets } from './WorldRenderer';
import { ClientWorld } from '../world/ClientWorld';
import { OverworldGenerator } from '../../common/gen/generator';
import { LightEngine } from '../../common/world/light';
import { encodeChunk, type Chunk } from '../../common/world/chunk';
import { chunkIndex } from '../../common/world/constants';
import { seedFromString } from '../../common/math/rng';
import { STATE_SOLID, STATE_FLUID } from '../../common/registry/blocks';
import { CAVE_BIOMES } from '../../common/gen/caves/caveBiomes';
import type { Settings } from '../settings';

const RADIUS = 4;

export class TitlePanorama {
  private renderer: WorldRenderer | null = null;
  private readonly world = new ClientWorld();
  private raf = 0;
  private active = true;
  private readonly start = performance.now();
  private center = { x: 0, y: 80, z: 0 };
  private disposed = false;
  private inCave = false;
  private caveBiome = 1;
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
    // A random world each time, and a random huge cave somewhere in it
    const gen = new OverworldGenerator(seedFromString('title-' + Math.floor(Math.random() * 1e9)));
    const mega = gen.terrain.carver?.nearestMega(Math.floor((Math.random() - 0.5) * 6000), Math.floor((Math.random() - 0.5) * 6000));
    const spawn = mega ?? gen.findSpawn();
    this.inCave = !!mega;
    this.center = mega ? { x: mega.x + 0.5, y: mega.y + 0.5, z: mega.z + 0.5 } : { x: spawn.x + 0.5, y: spawn.y + 14, z: spawn.z + 0.5 };
    const ccx = Math.floor(spawn.x) >> 4;
    const ccz = Math.floor(spawn.z) >> 4;
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
      const light = new LightEngine({ getChunk: (cx, cz) => chunks.get(chunkIndex(cx, cz)), markLightDirty: () => {} }, true);
      for (const c of chunks.values()) light.initChunk(c);
      for (const c of chunks.values()) this.world.loadChunk(encodeChunk(c, { light: true, blockEntities: false }));
      if (this.inCave) this.placeInCave(gen);
      else {
        // Keep the camera above the ground it circles
        const h = this.world.heightAt(Math.floor(this.center.x), Math.floor(this.center.z));
        this.center.y = Math.max(this.center.y, h + 10);
      }
      this.ready = true;
      this.onReady?.();
      this.raf = requestAnimationFrame(this.frame);
    };
    this.raf = requestAnimationFrame(step);
  }

  /**
   * Moves the camera to the roomiest open air near the cavern's centre (so it
   * isn't inside a pillar) and picks up the cave biome's fog and particles.
   */
  private placeInCave(gen: OverworldGenerator): void {
    const w = this.world;
    const open = (x: number, y: number, z: number): boolean => {
      const s = w.getState(x, y, z);
      return !STATE_SOLID[s] && !STATE_FLUID[s];
    };
    // How far the view is free in the eight horizontal directions (capped)
    const room = (x: number, y: number, z: number): number => {
      let sum = 0;
      for (let a = 0; a < 8; a++) {
        const dx = Math.cos((a * Math.PI) / 4);
        const dz = Math.sin((a * Math.PI) / 4);
        let d = 1;
        while (d < 40 && open(Math.floor(x + dx * d), y, Math.floor(z + dz * d))) d++;
        sum += d;
      }
      return sum;
    };
    const c = this.center;
    let best = { x: Math.floor(c.x), y: Math.floor(c.y), z: Math.floor(c.z), score: -1 };
    for (let dy = -12; dy <= 12; dy += 3)
      for (let dx = -16; dx <= 16; dx += 4)
        for (let dz = -16; dz <= 16; dz += 4) {
          const x = Math.floor(c.x) + dx;
          const y = Math.floor(c.y) + dy;
          const z = Math.floor(c.z) + dz;
          if (!open(x, y, z) || !open(x, y + 1, z) || !open(x, y - 1, z)) continue;
          const sc = room(x, y, z) - Math.abs(dy) * 2;
          if (sc > best.score) best = { x, y, z, score: sc };
        }
    this.center = { x: best.x + 0.5, y: best.y + 0.5, z: best.z + 0.5 };
    this.caveBiome = gen.caveBiomeAt(best.x, best.y, best.z) || 1;
  }

  private readonly frame = (): void => {
    if (this.disposed || !this.renderer) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.active) return;
    const t = (performance.now() - this.start) / 1000;
    const r = this.renderer;
    const cave = this.inCave ? CAVE_BIOMES[this.caveBiome] : undefined;
    // Particles run at the game's 20 ticks a second
    while (this.lastTick < t * 20) {
      this.lastTick++;
      r.particles.tick();
      if (cave?.particle && this.settings.particles !== 'minimal') {
        for (let i = 0; i < 2; i++) {
          const x = this.center.x + (Math.random() - 0.5) * 28;
          const y = this.center.y + (Math.random() - 0.5) * 12;
          const z = this.center.z + (Math.random() - 0.5) * 28;
          if (!STATE_SOLID[this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) r.particles.spawn(cave.particle, x, y, z, 1, 0.2);
        }
      }
    }
    const fs: FrameState = {
      x: this.center.x,
      y: this.center.y + Math.sin(t * 0.07) * 1.5,
      z: this.center.z,
      yaw: t * 0.045,
      pitch: this.inCave ? 0.08 : 0.18,
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
      biomeSky: this.world.biomeAt(this.center.x, this.center.z).sky,
      target: null,
      crack: [],
      thirdPerson: 0,
      showHand: false,
      // A little light so the cave reads as a place rather than a black screen
      nightVision: this.inCave ? 0.55 : 0,
      flash: 0,
      shake: 0,
      darkness: 0,
      hurtTilt: 0,
      cave: cave ? { color: cave.fog, density: Math.max(0.9, cave.fogDensity), amount: 1 } : undefined,
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
    this.world.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
