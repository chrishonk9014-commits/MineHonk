/**
 * Top-level renderer: three.js setup and per-frame composition of the
 * sky, chunk meshes, entities, particles, weather, selection and hand.
 */
import * as THREE from 'three';
import type { ClientWorld } from '../world/ClientWorld';
import { ChunkRenderer } from './ChunkRenderer';
import { Sky } from './Sky';
import { EntityRenderer } from './entities/EntityRenderer';
import { Particles } from './Particles';
import { Weather } from './Weather';
import { HandRenderer } from './HandRenderer';
import type { ItemIcons } from './ItemIcons';
import { AtlasLookup, type AtlasMeta } from './atlasInfo';
import type { Settings } from '../settings';
import { selectionShape } from '../../common/physics/shapes';

export interface GameAssets {
  blockAtlas: THREE.Texture;
  blockMeta: AtlasMeta;
  blockImage: HTMLImageElement;
  itemImage: HTMLImageElement;
  itemMeta: AtlasMeta;
  icons: ItemIcons;
}

export interface FrameState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fovMod: number;
  bobPhase: number;
  bobAmount: number;
  dayTime: number;
  time: number;
  alpha: number;
  rain: number;
  thunder: number;
  underwater: boolean;
  inLava: boolean;
  biomeSky: number;
  target: { x: number; y: number; z: number; state: number } | null;
  crack: { x: number; y: number; z: number; stage: number }[];
  thirdPerson: 0 | 1 | 2;
  showHand: boolean;
  nightVision: number;
  flash: number;
  shake: number;
  darkness: number;
  hurtTilt: number;
  /** Third person camera distance (clipped against terrain by the caller). */
  camDist?: number;
}

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly chunks: ChunkRenderer;
  readonly sky: Sky;
  readonly entities: EntityRenderer;
  readonly particles: Particles;
  readonly weather: Weather;
  readonly hand: HandRenderer;
  readonly atlas: AtlasLookup;
  private readonly selection: THREE.LineSegments;
  private readonly crackMeshes: THREE.Mesh[] = [];
  private readonly crackTextures: THREE.Texture[] = [];
  private readonly texCache = new Map<string, THREE.Texture>();
  private readonly overlay: THREE.Mesh;
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private selectionKey = '';
  frameCount = 0;
  lastSky: ReturnType<Sky['update']> | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly world: ClientWorld,
    readonly assets: GameAssets,
    readonly settings: Settings,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.atlas = new AtlasLookup(assets.blockMeta);
    this.chunks = new ChunkRenderer(world, assets.blockAtlas, assets.blockMeta, settings);
    this.sky = new Sky();
    this.entities = new EntityRenderer({ icons: assets.icons, atlas: assets.blockAtlas, blockTexture: (n) => this.blockTexture(n) }, world);
    this.particles = new Particles(assets.blockAtlas, this.atlas, world);
    this.weather = new Weather(world);
    this.hand = new HandRenderer(assets.icons, (n) => this.blockTexture(n));
    this.scene.add(this.sky.group, this.sky.cloudGroup, this.chunks.group, this.entities.group, this.particles.mesh, this.weather.mesh);

    const selMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 });
    this.selection = new THREE.LineSegments(new THREE.BufferGeometry(), selMat);
    this.selection.visible = false;
    this.selection.renderOrder = 3;
    this.scene.add(this.selection);
    for (let s = 0; s < 10; s++) this.crackTextures.push(this.blockTexture('destroy_stage_' + s));

    // Screen overlay (underwater tint, damage flash, portal swirl)
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.overlayScene.add(this.overlay);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** A standalone texture for a named block texture (first frame). */
  blockTexture(name: string): THREE.Texture {
    let t = this.texCache.get(name);
    if (t) return t;
    const c = this.assets.icons.texture(name, 'block') ?? this.assets.icons.texture('missing_block', 'block')!;
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    this.texCache.set(name, t);
    return t;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.settings.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateSelection(t: FrameState['target']): void {
    if (!t) {
      this.selection.visible = false;
      this.selectionKey = '';
      return;
    }
    const key = `${t.x},${t.y},${t.z},${t.state}`;
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      const pts: number[] = [];
      const e = 0.002;
      for (const b of selectionShape(t.state)) {
        const [x0, y0, z0, x1, y1, z1] = [b[0] - e, b[1] - e, b[2] - e, b[3] + e, b[4] + e, b[5] + e];
        const c = [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ];
        const edges = [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
          [0, 4],
          [1, 5],
          [2, 6],
          [3, 7],
        ];
        for (const [a, bb] of edges) pts.push(...c[a]!, ...c[bb]!);
      }
      this.selection.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.selection.geometry = g;
    }
    this.selection.position.set(t.x, t.y, t.z);
    this.selection.visible = true;
  }

  private updateCracks(list: FrameState['crack']): void {
    while (this.crackMeshes.length < list.length) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1.004, 1.004, 1.004),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.9 }),
      );
      m.renderOrder = 4;
      this.scene.add(m);
      this.crackMeshes.push(m);
    }
    this.crackMeshes.forEach((m, i) => {
      const c = list[i];
      if (!c || c.stage < 0) {
        m.visible = false;
        return;
      }
      m.visible = true;
      m.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5);
      const mat = m.material as THREE.MeshBasicMaterial;
      const tex = this.crackTextures[Math.min(9, c.stage)]!;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    });
  }

  /** World light (0..1 brightness) at a position, matching the chunk shader curve. */
  lightAt(x: number, y: number, z: number): number {
    const l = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    const u = this.chunks.uniforms;
    const curve = (v: number): number => {
      const f = v / (4 - 3 * v);
      const b = u.uBrightness!.value as number;
      return f * (1 - b) + (1 - Math.pow(1 - f, 4)) * b;
    };
    const sky = curve((l >> 4) / 15) * (u.uDaylight!.value as number);
    const blk = curve((l & 15) / 15);
    return Math.max(sky, blk, u.uAmbient!.value as number, u.uNightVision!.value as number);
  }

  render(f: FrameState): void {
    this.frameCount++;
    const cam = this.camera;
    const bob = this.settings.viewBobbing && !this.settings.reduceMotion ? f.bobAmount : 0;
    const bobX = Math.sin(f.bobPhase * Math.PI) * bob * 0.5;
    const bobY = -Math.abs(Math.cos(f.bobPhase * Math.PI) * bob);
    const yaw = f.yaw;
    const pitch = f.pitch;
    if (f.thirdPerson === 0) {
      cam.position.set(f.x, f.y, f.z);
    } else {
      const dir = f.thirdPerson === 1 ? 1 : -1;
      const back = f.camDist ?? 4;
      const dx = Math.sin(yaw) * Math.cos(pitch) * back * dir;
      const dy = Math.sin(pitch) * back * dir;
      const dz = Math.cos(yaw) * Math.cos(pitch) * back * dir;
      cam.position.set(f.x + dx, f.y + dy, f.z + dz);
    }
    // Protocol pitch is positive when looking down; three.js rotation.x is positive looking up.
    cam.rotation.set(f.thirdPerson === 2 ? pitch : -pitch, yaw + (f.thirdPerson === 2 ? Math.PI : 0), f.hurtTilt * 0.25);
    if (f.thirdPerson === 0 && bob > 0) {
      cam.position.x += Math.cos(yaw) * bobX * 0.2;
      cam.position.z -= Math.sin(yaw) * bobX * 0.2;
      cam.position.y += bobY * 0.3;
      cam.rotation.z += bobX * 0.03;
    }
    if (f.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * f.shake * 0.2;
      cam.position.y += (Math.random() - 0.5) * f.shake * 0.2;
    }
    const rd = this.settings.renderDistance * 16;
    cam.fov = this.settings.fov * f.fovMod;
    cam.far = Math.max(300, rd * 1.8 + 200);
    cam.updateProjectionMatrix();

    const skyState = this.sky.update(cam, f.dayTime, f.time, f.biomeSky, f.rain, f.thunder, f.underwater);
    this.lastSky = skyState;
    const u = this.chunks.uniforms;
    u.uDaylight!.value = skyState.daylight;
    (u.uSkyTint!.value as THREE.Color).copy(skyState.skyTint);
    u.uAmbient!.value = skyState.ambient;
    u.uBrightness!.value = this.settings.brightness;
    u.uNightVision!.value = f.nightVision;
    u.uFlicker!.value = 0.96 + Math.sin(f.time * 0.9) * 0.02 + Math.sin(f.time * 2.3) * 0.02;
    const fog = skyState.fog.clone();
    let fogNear = rd * 0.72;
    let fogFar = rd * 0.98;
    if (f.underwater) {
      fogNear = 2;
      fogFar = 36 + skyState.daylight * 20;
    } else if (f.inLava) {
      fog.setRGB(0.8, 0.25, 0.02);
      fogNear = 0.1;
      fogFar = 2.5;
    } else if (this.world.dimension === 'nether') {
      fogNear = Math.min(fogNear, 40);
      fogFar = Math.min(fogFar, 110);
    }
    if (f.rain > 0 && !f.underwater) fogNear *= 1 - f.rain * 0.4;
    if (f.darkness > 0) {
      fog.multiplyScalar(1 - f.darkness);
      fogFar = fogFar * (1 - f.darkness) + 12 * f.darkness;
      fogNear = Math.min(fogNear, fogFar * 0.3);
    }
    (u.uFogColor!.value as THREE.Color).copy(fog);
    u.uFogNear!.value = fogNear;
    u.uFogFar!.value = fogFar;
    const pu = this.particles.material.uniforms;
    (pu.uFogColor!.value as THREE.Color).copy(fog);
    pu.uFogNear!.value = fogNear;
    pu.uFogFar!.value = fogFar;
    this.scene.fog = new THREE.Fog(fog, fogNear, fogFar);
    this.renderer.setClearColor(fog);

    this.chunks.update(cam, f.time);
    this.updateSelection(f.target);
    this.updateCracks(f.crack);
    this.particles.update((x, y, z) => this.lightAt(x, y, z));

    this.renderer.clear();
    this.renderer.render(this.scene, cam);

    // Hand overlay
    if (f.showHand && f.thirdPerson === 0) {
      this.renderer.clearDepth();
      this.hand.update(f.alpha, bobX * 0.4, bobY * 0.3, this.lightAt(f.x, f.y, f.z), cam.aspect, true);
      this.renderer.render(this.hand.scene, this.hand.camera);
    }
    // Screen tint overlay
    const om = this.overlay.material as THREE.MeshBasicMaterial;
    if (f.underwater) {
      om.color.setRGB(0.05, 0.15, 0.4);
      om.opacity = 0.25;
    } else if (f.inLava) {
      om.color.setRGB(0.9, 0.3, 0.05);
      om.opacity = 0.6;
    } else if (f.flash > 0) {
      om.color.setRGB(0.6, 0, 0);
      om.opacity = f.flash * 0.35;
    } else om.opacity = 0;
    if (om.opacity > 0) {
      this.renderer.clearDepth();
      this.renderer.render(this.overlayScene, this.overlayCam);
    }
  }

  dispose(): void {
    this.chunks.dispose();
    this.sky.dispose();
    this.entities.clear();
    this.renderer.dispose();
  }
}
