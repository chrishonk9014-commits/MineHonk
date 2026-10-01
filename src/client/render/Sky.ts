/**
 * Sky rendering: gradient dome with sunrise/sunset glow, pixel-art sun and
 * moon, stars, blocky cloud layer, and per-dimension atmospheres.
 */
import * as THREE from 'three';
import type { DimensionId } from '../../common/data/biomes';
import { Octave2 } from '../../common/math/noise';
import { Random } from '../../common/math/rng';

const SKY_VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
in vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uVoid;
uniform float uVoidAmount;
uniform vec3 uSunDir;
uniform vec3 uGlow;
uniform float uGlowStrength;
uniform float uGlitch;
uniform float uTime;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  // Below the horizon the sky matches the fog, darkening into the void only when the camera is low
  if (up < 0.0) col = mix(uHorizon, uVoid, clamp(-up * 3.0, 0.0, 1.0) * uVoidAmount);
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  float toward = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), sunH), 0.0);
  float band = exp(-abs(up - 0.05) * 7.0);
  col += uGlow * uGlowStrength * pow(toward, 3.0) * band;
  if (uGlitch > 0.0) {
    float row = floor((up + 1.0) * 60.0);
    float n = fract(sin(row * 91.7 + floor(uTime * 0.25) * 13.1) * 43758.5);
    if (n > 0.965) col = mix(col, vec3(n, 0.2, 1.0 - n), 0.35 * uGlitch);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function pixelTexture(size: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

function sunTexture(): THREE.Texture {
  return pixelTexture(16, (ctx) => {
    ctx.fillStyle = '#fff8c0';
    ctx.fillRect(3, 3, 10, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(5, 5, 6, 6);
    ctx.fillStyle = 'rgba(255,230,120,0.6)';
    ctx.fillRect(2, 4, 1, 8);
    ctx.fillRect(13, 4, 1, 8);
    ctx.fillRect(4, 2, 8, 1);
    ctx.fillRect(4, 13, 8, 1);
  });
}

function moonTexture(phase: number): THREE.Texture {
  return pixelTexture(16, (ctx) => {
    ctx.fillStyle = '#d8dcea';
    ctx.fillRect(4, 4, 8, 8);
    ctx.fillStyle = '#b4b8c8';
    ctx.fillRect(6, 6, 2, 2);
    ctx.fillRect(9, 8, 2, 2);
    ctx.fillRect(5, 9, 1, 1);
    // phase shadow
    const p = phase % 8;
    if (p !== 0) {
      ctx.fillStyle = 'rgba(8,10,24,0.85)';
      const w = Math.abs(4 - p) * 2;
      if (p < 4) ctx.fillRect(12 - (8 - w), 4, 8 - w, 8);
      else ctx.fillRect(4, 4, 8 - w, 8);
    }
  });
}

export interface SkyState {
  daylight: number;
  fog: THREE.Color;
  skyTint: THREE.Color;
  ambient: number;
}

export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly moonTextures: THREE.Texture[] = [];
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.Group;
  private readonly cloudGeo: THREE.BufferGeometry;
  private readonly cloudMat: THREE.MeshBasicMaterial;
  private readonly cloudSize = 12;
  private readonly cloudCells = 96;
  dimension: DimensionId = 'overworld';
  cloudsEnabled = true;

  constructor() {
    this.group.name = 'sky';
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uVoid: { value: new THREE.Color(0x0a0c18) },
        uVoidAmount: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlow: { value: new THREE.Color(0xff7a30) },
        uGlowStrength: { value: 0 },
        uGlitch: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), this.domeMat);
    this.dome.renderOrder = -100;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const celestial = (tex: THREE.Texture, size: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      m.renderOrder = -90;
      m.frustumCulled = false;
      return m;
    };
    this.sun = celestial(sunTexture(), 18);
    for (let i = 0; i < 8; i++) this.moonTextures.push(moonTexture(i));
    this.moon = celestial(this.moonTextures[0]!, 14);
    (this.moon.material as THREE.MeshBasicMaterial).blending = THREE.NormalBlending;
    this.group.add(this.sun, this.moon);

    // Stars
    const rng = new Random(10842);
    const pts: number[] = [];
    for (let i = 0; i < 1100; i++) {
      const u = rng.next() * 2 - 1;
      const t = rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pts.push(r * Math.cos(t) * 90, u * 90, r * Math.sin(t) * 90);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    this.stars.renderOrder = -95;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Clouds
    this.cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: true, side: THREE.FrontSide, fog: true });
    this.cloudGeo = this.buildClouds();
    this.clouds = new THREE.Group();
    this.clouds.name = 'clouds';
    const span = this.cloudCells * this.cloudSize;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const m = new THREE.Mesh(this.cloudGeo, this.cloudMat);
        m.position.set(dx * span, 0, dz * span);
        m.frustumCulled = false;
        m.renderOrder = 2;
        this.clouds.add(m);
      }
    }
  }

  /** World-space cloud layer; add to the scene (not the camera-following sky group). */
  get cloudGroup(): THREE.Group {
    return this.clouds;
  }

  private buildClouds(): THREE.BufferGeometry {
    const n = this.cloudCells;
    const noise = new Octave2(new Random(9001), 3, 9);
    const on = new Uint8Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      // tileable: sample on a torus
      const a = (x / n) * Math.PI * 2;
      const b = (z / n) * Math.PI * 2;
      const v = noise.sample(Math.cos(a) * 14 + 100, Math.sin(a) * 14 + Math.cos(b) * 14 * 0.7 + Math.sin(b) * 9);
      on[z * n + x] = v > 0.12 ? 1 : 0;
    }
    const pos: number[] = [];
    const col: number[] = [];
    const s = this.cloudSize;
    const h = 4;
    const get = (x: number, z: number): number => on[((z + n) % n) * n + ((x + n) % n)]!;
    const quad = (a: number[], b: number[], c: number[], d: number[], shade: number): void => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < 6; i++) col.push(shade, shade, shade);
    };
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        if (!get(x, z)) continue;
        const x0 = x * s;
        const x1 = x0 + s;
        const z0 = z * s;
        const z1 = z0 + s;
        quad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], 1.0);
        quad([x0, 0, z1], [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], 0.7);
        if (!get(x, z - 1)) quad([x1, h, z0], [x1, 0, z0], [x0, 0, z0], [x0, h, z0], 0.8);
        if (!get(x, z + 1)) quad([x0, h, z1], [x0, 0, z1], [x1, 0, z1], [x1, h, z1], 0.8);
        if (!get(x - 1, z)) quad([x0, h, z0], [x0, 0, z0], [x0, 0, z1], [x0, h, z1], 0.9);
        if (!get(x + 1, z)) quad([x1, h, z1], [x1, 0, z1], [x1, 0, z0], [x1, h, z0], 0.9);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  /**
   * Updates sky for the given time of day. Returns lighting values for the
   * world shader.
   */
  update(camera: THREE.Camera, dayTime: number, time: number, biomeSky: number, rain: number, thunder: number, underwater: boolean): SkyState {
    this.group.position.copy(camera.position);
    const u = this.domeMat.uniforms;
    u.uTime!.value = time;
    u.uVoidAmount!.value = Math.min(1, Math.max(0, (63 - camera.position.y) / 20));
    const dim = this.dimension;
    const state: SkyState = { daylight: 1, fog: new THREE.Color(), skyTint: new THREE.Color(1, 1, 1), ambient: 0.03 };
    if (dim === 'nether' || dim === 'end') {
      this.sun.visible = this.moon.visible = false;
      this.clouds.visible = false;
      const fog = dim === 'nether' ? new THREE.Color(0x330808) : new THREE.Color(0x100a18);
      u.uZenith!.value.copy(fog);
      u.uHorizon!.value.copy(fog);
      u.uVoid!.value.copy(fog);
      u.uGlowStrength!.value = 0;
      (this.stars.material as THREE.PointsMaterial).opacity = dim === 'end' ? 0.5 : 0;
      state.daylight = 0;
      state.ambient = dim === 'nether' ? 0.12 : 0.2;
      state.fog.copy(fog);
      state.skyTint.setRGB(1, 1, 1);
      u.uGlitch!.value = 0;
      return state;
    }
    // V5.5: inside the computer it is always the same overcast grey morning, no sun, no clouds
    if (dim === 'computer') {
      this.sun.visible = this.moon.visible = false;
      this.clouds.visible = false;
      const zenith = new THREE.Color(0x8e9a9c);
      const horizon = new THREE.Color(0xb9c2c2);
      u.uZenith!.value.copy(zenith);
      u.uHorizon!.value.copy(horizon);
      u.uVoid!.value.copy(horizon.clone().multiplyScalar(0.3));
      u.uGlowStrength!.value = 0;
      (this.stars.material as THREE.PointsMaterial).opacity = 0;
      u.uGlitch!.value = 0;
      state.daylight = 0.82;
      state.fog.copy(horizon);
      state.skyTint.setRGB(0.92, 0.96, 0.95);
      state.ambient = 0.05;
      return state;
    }
    // celestial angle (0 = noon at 6000)
    const f = ((dayTime / 24000 - 0.25) % 1 + 1) % 1;
    const eased = f + (1 - (Math.cos(f * Math.PI) + 1) / 2 - f) / 3;
    const ang = eased * Math.PI * 2;
    const sunDir = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0).normalize();
    // rotate orbit so the sun rises in the east (+x) and sets west
    sunDir.set(Math.sin(ang), Math.cos(ang), 0.15).normalize();
    u.uSunDir!.value.copy(sunDir);
    let daylight = Math.max(0, Math.min(1, Math.cos(ang) * 2 + 0.5));
    daylight *= 1 - rain * 0.3 - thunder * 0.2;
    const sky = new THREE.Color(biomeSky);
    const night = new THREE.Color(0x03050f);
    const zenith = night.clone().lerp(sky, daylight);
    const horizonDay = new THREE.Color(0xc0d8ff).lerp(sky, 0.25);
    const horizon = new THREE.Color(0x0b0f22).lerp(horizonDay, daylight);
    if (rain > 0) {
      const gray = new THREE.Color(0x707480).multiplyScalar(0.3 + daylight * 0.7);
      zenith.lerp(gray, rain * 0.75);
      horizon.lerp(gray, rain * 0.75);
    }
    u.uZenith!.value.copy(zenith);
    u.uHorizon!.value.copy(horizon);
    u.uVoid!.value.copy(horizon.clone().multiplyScalar(0.25));
    // sunrise/sunset glow when the sun is near the horizon
    const glow = Math.max(0, 1 - Math.abs(Math.cos(ang)) * 3.5) * (1 - rain);
    u.uGlowStrength!.value = glow * 0.9;
    this.sun.visible = this.moon.visible = true;
    const dist = 80;
    this.sun.position.copy(sunDir).multiplyScalar(dist);
    this.sun.lookAt(0, 0, 0);
    this.moon.position.copy(sunDir).multiplyScalar(-dist);
    this.moon.lookAt(0, 0, 0);
    const phase = Math.floor(time / 24000) % 8;
    const mm = this.moon.material as THREE.MeshBasicMaterial;
    if (mm.map !== this.moonTextures[phase]) {
      mm.map = this.moonTextures[phase]!;
      mm.needsUpdate = true;
    }
    (this.sun.material as THREE.MeshBasicMaterial).opacity = 1 - rain;
    mm.opacity = 1 - rain;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - daylight * 1.6) * (1 - rain) * 0.9;
    this.stars.rotation.z = ang;
    // clouds: tileable mesh drifting along +x, 3x3 tiles around the camera
    this.clouds.visible = this.cloudsEnabled && dim !== 'farlands';
    const span = this.cloudCells * this.cloudSize;
    const drift = (time * 0.03) % span;
    const ox = Math.floor((camera.position.x - drift) / span) * span + drift;
    const oz = Math.floor(camera.position.z / span) * span;
    this.clouds.position.set(ox, 192, oz);
    const base = new THREE.Color(1, 1, 1).multiplyScalar(0.25 + daylight * 0.75);
    if (rain > 0) base.multiplyScalar(1 - rain * 0.4);
    this.cloudMat.color.copy(base);
    // Farlands: glitchy sky
    u.uGlitch!.value = dim === 'farlands' ? 1 : 0;
    state.daylight = daylight;
    state.fog.copy(underwater ? new THREE.Color(0x10306a).multiplyScalar(0.3 + daylight * 0.7) : horizon);
    state.skyTint.setRGB(0.95 + 0.05 * daylight, 0.95 + 0.05 * daylight, 1.0);
    state.ambient = dim === 'farlands' ? 0.08 : 0.03;
    return state;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.cloudGeo.dispose();
    this.cloudMat.dispose();
  }
}
