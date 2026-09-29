/**
 * World-space effect markers (V3): the warnings and attacks of The Error
 * and other glitch events, drawn in the world rather than on the screen.
 *
 * - warning rings on the ground (where something is about to hit)
 * - danger zones (lingering glitch fields)
 * - targeting lines and the Error Laser itself (purple, a black core,
 *   pixelated edges)
 * - expanding shockwaves
 * - afterimages of an entity that just teleported
 *
 * Everything is a handful of cheap meshes that live for a few seconds.
 */
import * as THREE from 'three';

interface Marker {
  obj: THREE.Object3D;
  born: number;
  /** Seconds it lives (Infinity until removed by id). */
  life: number;
  kind: string;
  update?: (age: number, t: number) => void;
  /** Geometry belongs to someone else (an afterimage's source): only its own materials are freed. */
  sharedGeometry?: boolean;
}

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** A glitchy field: magenta/black checker cells that crawl, with a bright edge. */
const ZONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  vec2 cell = floor(vUv * 16.0 + vec2(floor(uTime * 4.0), 0.0));
  float on = step(0.55, hash(cell + floor(uTime * 6.0)));
  float edge = smoothstep(0.86, 0.98, d);
  vec3 col = mix(vec3(0.03, 0.0, 0.05), uColor, on * 0.8 + edge);
  gl_FragColor = vec4(col, uAlpha * (0.35 + 0.35 * on + 0.5 * edge));
}`;

/** The laser: a black core inside a purple beam with blocky, flickering edges. */
const LASER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float a = abs(vUv.x - 0.5) * 2.0;
  float blocks = hash(vec2(floor(vUv.y * 40.0), floor(uTime * 12.0)));
  float edge = 0.75 + blocks * 0.25;
  if (a > edge) discard;
  vec3 purple = vec3(0.62, 0.18, 0.95);
  vec3 col = a < 0.35 ? vec3(0.02, 0.0, 0.03) : mix(purple, vec3(1.0, 0.45, 0.95), step(0.9, blocks));
  gl_FragColor = vec4(col, uAlpha);
}`;

export class WorldFX {
  readonly group = new THREE.Group();
  private readonly markers = new Map<number, Marker>();
  private nextAnon = -1;

  private add(id: number | undefined, m: Marker): void {
    const key = id ?? this.nextAnon--;
    this.remove(key);
    this.markers.set(key, m);
    this.group.add(m.obj);
  }

  remove(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.markers.delete(id);
    this.group.remove(m.obj);
    m.obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !m.sharedGeometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }

  /** A warning ring on the ground: something will hit here. */
  warnCircle(id: number | undefined, x: number, y: number, z: number, r: number, seconds: number, now: number): void {
    const geo = new THREE.RingGeometry(Math.max(0.1, r - 0.35), r, 48, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a6a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(geo, mat);
    // The inside fills in as the moment approaches
    const fillGeo = new THREE.CircleGeometry(r, 48);
    fillGeo.rotateX(-Math.PI / 2);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xff2a6a, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    const g = new THREE.Group();
    g.add(ring, fill);
    g.position.set(x, y + 0.06, z);
    this.add(id, {
      obj: g,
      born: now,
      life: seconds,
      kind: 'warn',
      update: (age) => {
        const f = Math.min(1, age / Math.max(0.1, seconds));
        mat.opacity = 0.55 + 0.35 * Math.abs(Math.sin(age * 6));
        fill.scale.setScalar(Math.max(0.01, f));
        fillMat.opacity = 0.12 + 0.25 * f;
      },
    });
  }

  /** A lingering danger zone. */
  zone(id: number | undefined, x: number, y: number, z: number, r: number, seconds: number, now: number): void {
    const geo = new THREE.PlaneGeometry(r * 2, r * 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: ZONE_FRAG,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0xe020c8) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + 0.05, z);
    this.add(id, {
      obj: m,
      born: now,
      life: seconds,
      kind: 'zone',
      update: (age, t) => {
        mat.uniforms.uTime!.value = t;
        const fadeIn = Math.min(1, age / 0.3);
        const fadeOut = Number.isFinite(seconds) ? Math.min(1, (seconds - age) / 0.5) : 1;
        mat.uniforms.uAlpha!.value = Math.max(0, Math.min(fadeIn, fadeOut));
      },
    });
  }

  /** A beam from a to b: a thin targeting line (`warn`) or the full Error Laser. */
  beam(id: number | undefined, a: THREE.Vector3, b: THREE.Vector3, seconds: number, now: number, warn: boolean): void {
    const len = a.distanceTo(b);
    const width = warn ? 0.12 : 2.2;
    const g = new THREE.Group();
    // Two crossed planes read as a beam from any side
    const mat = warn
      ? new THREE.MeshBasicMaterial({ color: 0xff2a6a, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, fog: false })
      : new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: LASER_FRAG, uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    for (const rot of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
      p.rotation.y = rot;
      g.add(p);
    }
    // Planes stand along +y: aim that axis from a to b
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.position.copy(mid);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.add(id, {
      obj: g,
      born: now,
      life: seconds,
      kind: warn ? 'warn_beam' : 'laser',
      update: (age, t) => {
        if (warn) (mat as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * Math.abs(Math.sin(age * 10));
        else {
          const u = (mat as THREE.ShaderMaterial).uniforms;
          u.uTime!.value = t;
          u.uAlpha!.value = Math.min(1, (seconds - age) / 0.25);
          const s = 1 + Math.sin(t * 30) * 0.05;
          g.scale.set(s, 1, s);
        }
      },
    });
  }

  /** A shockwave ring expanding along the ground to radius r. */
  pulse(x: number, y: number, z: number, r: number, seconds: number, now: number): void {
    const geo = new THREE.RingGeometry(0.85, 1, 64, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xb050ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(geo, mat);
    // A short wall so the wave reads as something to jump over
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1.2, 64, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x7a2ad0, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 0.6;
    const g = new THREE.Group();
    g.add(ring, wall);
    g.position.set(x, y + 0.05, z);
    this.add(undefined, {
      obj: g,
      born: now,
      life: seconds,
      kind: 'pulse',
      update: (age) => {
        const f = Math.min(1, age / seconds);
        const rr = Math.max(0.2, r * f);
        g.scale.set(rr, 1, rr);
        mat.opacity = 0.85 * (1 - f * 0.6);
        wallMat.opacity = 0.35 * (1 - f * 0.5);
      },
    });
  }

  /** A fading copy of an object where it stood (a teleport's afterimage). */
  afterimage(source: THREE.Object3D, seconds: number, now: number): void {
    const copy = source.clone(true);
    const mats: THREE.MeshBasicMaterial[] = [];
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = new THREE.MeshBasicMaterial({ color: 0xe020c8, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
      mats.push(m);
      mesh.material = m;
    });
    copy.position.copy(source.getWorldPosition(new THREE.Vector3()));
    copy.quaternion.copy(source.getWorldQuaternion(new THREE.Quaternion()));
    this.add(undefined, {
      obj: copy,
      born: now,
      life: seconds,
      kind: 'afterimage',
      sharedGeometry: true,
      update: (age) => {
        const f = Math.min(1, age / seconds);
        for (const m of mats) m.opacity = 0.45 * (1 - f);
        copy.position.x += Math.sin(age * 40) * 0.01;
      },
    });
  }

  /** Per frame (`now` in seconds). */
  update(now: number): void {
    for (const [id, m] of [...this.markers]) {
      const age = now - m.born;
      if (age >= m.life) {
        this.remove(id);
        continue;
      }
      m.update?.(age, now);
    }
  }

  clear(): void {
    for (const id of [...this.markers.keys()]) this.remove(id);
  }
}
