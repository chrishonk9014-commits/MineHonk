/**
 * The title screen backdrop: a patch of real, freshly generated terrain
 * around a scenic spawn, slowly orbited by the camera. Chunks are generated
 * a few per frame so the menu stays responsive, then lit together (so
 * chunk borders have no seams) and handed to the normal world renderer.
 */
import { WorldRenderer, type FrameState, type GameAssets } from './WorldRenderer';
import { ClientWorld } from '../world/ClientWorld';
import { OverworldGenerator } from '../../common/gen/generator';
import { LightEngine } from '../../common/world/light';
import { encodeChunk, type Chunk } from '../../common/world/chunk';
import { chunkIndex } from '../../common/world/constants';
import { seedFromString } from '../../common/math/rng';
import type { Settings } from '../settings';

const SEEDS = ['honk', 'panorama', 'minehonk', 'blocks', 'sunrise', 'lakeside', 'meadow'];
const RADIUS = 4;

export class TitlePanorama {
  private renderer: WorldRenderer | null = null;
  private readonly world = new ClientWorld();
  private raf = 0;
  private active = true;
  private readonly start = performance.now();
  private center = { x: 0, y: 80, z: 0 };
  private disposed = false;
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
    const gen = new OverworldGenerator(seedFromString(SEEDS[Math.floor(Math.random() * SEEDS.length)]!));
    const spawn = gen.findSpawn();
    this.center = { x: spawn.x + 0.5, y: spawn.y + 14, z: spawn.z + 0.5 };
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
      // Keep the camera above the ground it circles
      const h = this.world.heightAt(Math.floor(this.center.x), Math.floor(this.center.z));
      this.center.y = Math.max(this.center.y, h + 10);
      this.ready = true;
      this.onReady?.();
      this.raf = requestAnimationFrame(this.frame);
    };
    this.raf = requestAnimationFrame(step);
  }

  private readonly frame = (): void => {
    if (this.disposed || !this.renderer) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.active) return;
    const t = (performance.now() - this.start) / 1000;
    const r = this.renderer;
    const fs: FrameState = {
      x: this.center.x,
      y: this.center.y + Math.sin(t * 0.07) * 1.5,
      z: this.center.z,
      yaw: t * 0.045,
      pitch: 0.18,
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
      nightVision: 0,
      flash: 0,
      shake: 0,
      darkness: 0,
      hurtTilt: 0,
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
