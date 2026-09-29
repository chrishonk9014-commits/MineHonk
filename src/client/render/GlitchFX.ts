/**
 * Glitch effects (V3).
 *
 * A post-processing pass that runs only while something is glitching (the
 * rest of the time frames render exactly as before, at no cost): RGB
 * channel separation, horizontal tearing, displaced pixel blocks,
 * scanlines, static and a corruption tint. Around it: the world itself
 * corrupting (the sky stuttering, patches of terrain flickering out, ghost
 * blocks floating) and small camera jolts.
 *
 * Settings: 'full', 'reduced' (gentler, no tearing or vanishing terrain,
 * slower changes) and 'off' (no distortion at all). Reduce Motion turns
 * off camera jolts. Nothing changes the whole screen's brightness faster
 * than about three times a second: the effects move pixels around rather
 * than flashing.
 */
import * as THREE from 'three';
import type { Settings } from '../settings';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uStep;
uniform float uRgb;
uniform float uTear;
uniform float uBlocks;
uniform float uStatic;
uniform float uScan;
uniform float uTint;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  // Horizontal tearing: a few bands slide sideways
  float band = floor(uv.y * 28.0);
  float tearOn = step(1.0 - uTear * 0.3, hash(vec2(band, uStep)));
  uv.x += (hash(vec2(band, uStep + 7.0)) - 0.5) * 0.14 * uTear * tearOn;
  // Pixel blocks torn out of place
  vec2 blk = floor(vUv * vec2(20.0, 12.0));
  float bOn = step(1.0 - uBlocks * 0.22, hash(blk + uStep * 1.7));
  uv += (vec2(hash(blk + 3.1 + uStep), hash(blk + 9.7 + uStep)) - 0.5) * 0.08 * uBlocks * bOn;
  // Blocky pixelation inside torn blocks
  vec2 px = uRes / mix(1.0, 7.0, bOn * uBlocks);
  uv = mix(uv, (floor(uv * px) + 0.5) / px, bOn * uBlocks);
  // RGB channel separation
  float off = uRgb * 0.014;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + vec2(off, off * 0.3)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(off, off * 0.3)).b;
  // Scanlines
  col *= 1.0 - uScan * 0.16 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
  // Static snow (same average brightness)
  float n = hash(floor(vUv * uRes / 2.0) + uStep * 13.0);
  col = mix(col, vec3(n), uStatic * 0.3);
  // The corruption's colour: magenta and violet creeping in
  col = mix(col, col * vec3(1.18, 0.78, 1.25) + vec3(0.03, 0.0, 0.05), uTint);
  gl_FragColor = vec4(col, 1.0);
}`;

/** A magenta and black checkerboard: the "missing texture" look. */
function missingTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = ((x >> 2) + (y >> 2)) % 2 ? '#0a0010' : '#e020c8';
      g.fillRect(x, y, 1, 1);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

const GHOSTS = 48;

export class GlitchFX {
  /** A short decaying burst (0..1) and how many ticks it has left. */
  private burst = 0;
  private burstTicks = 0;
  private burstLen = 1;
  /** The world corrupting: strength and ticks left. */
  private corrupt = 0;
  private corruptTicks = 0;
  /** The player hit by a glitch attack: ticks left. */
  private hit = 0;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly ghosts: THREE.InstancedMesh;
  private readonly ghostData: { x: number; y: number; z: number; vy: number; spin: number; life: number }[] = [];
  /** Objects hidden for this frame, with the visibility to give back afterwards. */
  private readonly hidden = new Map<THREE.Object3D, boolean>();
  private step = 0;
  private tickNo = 0;
  readonly group = new THREE.Group();

  constructor(private readonly settings: Settings) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uStep: { value: 0 },
        uRgb: { value: 0 },
        uTear: { value: 0 },
        uBlocks: { value: 0 },
        uStatic: { value: 0 },
        uScan: { value: 0 },
        uTint: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    const ghostMat = new THREE.MeshBasicMaterial({ map: missingTexture(), transparent: true, opacity: 0.9, fog: false });
    this.ghosts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ghostMat, GHOSTS);
    this.ghosts.count = 0;
    this.ghosts.frustumCulled = false;
    this.group.add(this.ghosts);
  }

  private get mode(): 'full' | 'reduced' | 'off' {
    return this.settings.glitchFx ?? 'full';
  }

  // ------------------------------------------------------------------ triggers

  /** A burst of glitching that fades over `ticks`. */
  pulse(strength: number, ticks: number): void {
    const s = Math.max(0, Math.min(1, strength));
    if (s >= this.burst * (this.burstTicks / this.burstLen)) {
      this.burst = s;
      this.burstTicks = this.burstLen = Math.max(1, ticks);
    }
  }

  /** The world around corrupts for `ticks`. */
  corruptWorld(strength: number, ticks: number): void {
    this.corrupt = Math.max(0, Math.min(1, strength));
    this.corruptTicks = Math.max(1, ticks);
  }

  /** Hit by a glitch attack: a strong, short episode. */
  playerHit(): void {
    this.hit = 36;
    this.pulse(0.9, 36);
  }

  /** Everything calms down at once (the Farlands stabilising, leaving a sequence). */
  stabilize(): void {
    this.corruptTicks = 0;
    this.corrupt = 0;
    this.burstTicks = Math.min(this.burstTicks, 10);
  }

  /** 20 times a second. */
  tick(): void {
    this.tickNo++;
    if (this.burstTicks > 0) this.burstTicks--;
    if (this.corruptTicks > 0) this.corruptTicks--;
    if (this.hit > 0) this.hit--;
    // The glitch pattern changes a few times a second (slower when reduced)
    const every = this.mode === 'reduced' ? 6 : 2;
    if (this.tickNo % every === 0) this.step = (this.step + 1) % 997;
  }

  /** Current overall strength 0..1 (before the setting). */
  get level(): number {
    const b = this.burstTicks > 0 ? this.burst * (this.burstTicks / this.burstLen) : 0;
    const c = this.corruptTicks > 0 ? this.corrupt * Math.min(1, this.corruptTicks / 20) : 0;
    return Math.min(1, Math.max(b, c * 0.8));
  }

  get corrupting(): number {
    return this.corruptTicks > 0 ? this.corrupt : 0;
  }

  get playerGlitched(): boolean {
    return this.hit > 0;
  }

  // ------------------------------------------------------------------ world corruption

  /**
   * Per frame, after the chunk renderer has decided what is visible: patches
   * of terrain flicker out, ghost blocks float, the sky stutters.
   */
  updateWorld(chunks: THREE.Group, sky: THREE.Object3D, cam: THREE.Camera, dt: number): void {
    const c = this.corrupting;
    const full = this.mode === 'full';
    if (c <= 0 || this.mode === 'off') {
      this.ghosts.count = 0;
      this.ghostData.length = 0;
      return;
    }
    // Terrain flickering out (full only; a few patches, for a moment)
    if (full && this.step % 3 === 0) {
      const meshes = chunks.children.filter((o) => o.visible);
      const n = Math.min(meshes.length, Math.round(c * 2));
      for (let i = 0; i < n; i++) {
        const m = meshes[(this.step * 31 + i * 17) % meshes.length]!;
        if (!this.hidden.has(m)) this.hidden.set(m, m.visible);
        m.visible = false;
      }
    }
    // The sky stutters: gone for a moment now and then (at most ~3 times a second)
    if (this.step % 7 === 0 && full) {
      if (!this.hidden.has(sky)) this.hidden.set(sky, sky.visible);
      sky.visible = false;
    }
    // Ghost blocks: pieces of the world that came loose and float
    const want = Math.round(GHOSTS * c * (full ? 1 : 0.4));
    const p = cam.position;
    while (this.ghostData.length < want) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 18;
      this.ghostData.push({ x: Math.floor(p.x + Math.cos(a) * r) + 0.5, y: Math.floor(p.y - 2 + Math.random() * 8) + 0.5, z: Math.floor(p.z + Math.sin(a) * r) + 0.5, vy: 0.2 + Math.random() * 0.6, spin: (Math.random() - 0.5) * 2, life: 2 + Math.random() * 4 });
    }
    if (this.ghostData.length > want) this.ghostData.length = want;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    let n = 0;
    for (let i = this.ghostData.length - 1; i >= 0; i--) {
      const g = this.ghostData[i]!;
      g.life -= dt;
      if (g.life <= 0) {
        this.ghostData.splice(i, 1);
        continue;
      }
      g.y += g.vy * dt;
      e.set(g.life * g.spin, g.life * g.spin * 0.7, 0);
      q.setFromEuler(e);
      // Some of them blink out and back
      const vis = (Math.floor(g.life * 6) + i) % 5 !== 0;
      s.setScalar(vis ? 1 : 0.001);
      mat.compose(pos.set(g.x, g.y, g.z), q, s);
      this.ghosts.setMatrixAt(n++, mat);
    }
    this.ghosts.count = n;
    this.ghosts.instanceMatrix.needsUpdate = true;
  }

  /** After the frame is drawn: whatever flickered out comes back as it was. */
  afterRender(): void {
    for (const [o, v] of this.hidden) o.visible = v;
    this.hidden.clear();
  }

  /** Small camera jolts while glitching (never with Reduce Motion or the effects off). */
  jolt(cam: THREE.Camera): void {
    if (this.settings.reduceMotion || this.mode === 'off') return;
    const l = this.level;
    if (l <= 0.05) return;
    const k = (this.mode === 'reduced' ? 0.3 : 1) * l;
    const h = (n: number): number => {
      const x = Math.sin((this.step + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x) - 0.5;
    };
    cam.position.x += h(1) * 0.12 * k;
    cam.position.y += h(2) * 0.08 * k;
    cam.rotation.z += h(3) * 0.05 * k;
  }

  // ------------------------------------------------------------------ the post pass

  /** Starts a frame: returns true if the frame should render into the effect target. */
  begin(renderer: THREE.WebGLRenderer): boolean {
    if (this.mode === 'off' || this.level <= 0.01) return false;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.target || this.target.width !== size.x || this.target.height !== size.y) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: true, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
      this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    renderer.setRenderTarget(this.target);
    return true;
  }

  /** Finishes a frame started with `begin`: composites the glitched image to the screen. */
  end(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    const u = this.material.uniforms;
    const l = this.level * (this.mode === 'reduced' ? 0.4 : 1);
    const full = this.mode === 'full';
    u.tDiffuse!.value = this.target!.texture;
    (u.uRes!.value as THREE.Vector2).set(this.target!.width, this.target!.height);
    u.uStep!.value = this.step;
    u.uRgb!.value = l;
    u.uTear!.value = full ? l : 0;
    u.uBlocks!.value = full ? l * 0.8 : l * 0.3;
    u.uStatic!.value = l * (this.hit > 0 ? 0.9 : 0.5);
    u.uScan!.value = Math.min(1, l * 1.5);
    u.uTint!.value = Math.min(0.6, Math.max(this.corrupting, this.hit > 0 ? 0.5 : 0) * 0.6);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose(): void {
    this.target?.dispose();
    this.material.dispose();
    this.ghosts.geometry.dispose();
    (this.ghosts.material as THREE.Material).dispose();
  }
}
