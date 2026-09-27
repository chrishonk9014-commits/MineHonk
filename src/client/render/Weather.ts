/**
 * Rain and snow around the camera. Drops only fall in columns open to the
 * sky; snow falls in cold biomes and at high altitude.
 */
import * as THREE from 'three';
import type { ClientWorld } from '../world/ClientWorld';

const COUNT = 1200;
const RADIUS = 14;

export class Weather {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly offsets: Float32Array;
  private readonly kinds: Float32Array;
  private readonly drops: { x: number; y: number; z: number; speed: number; phase: number }[] = [];
  private readonly mat: THREE.ShaderMaterial;
  intensity = 0;

  constructor(private readonly world: ClientWorld) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('aCorner', new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.offsets = new Float32Array(COUNT * 3);
    this.kinds = new Float32Array(COUNT);
    this.geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(this.offsets, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(this.kinds, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uAlpha: { value: 0 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        in vec2 aCorner; in vec3 aOffset; in float aKind;
        out float vKind; out vec2 vC;
        void main() {
          vKind = aKind; vC = aCorner;
          vec4 mv = viewMatrix * vec4(aOffset, 1.0);
          float w = aKind > 0.5 ? 0.09 : 0.02;
          float h = aKind > 0.5 ? 0.09 : 0.6;
          mv.x += aCorner.x * w * 2.0;
          mv.y += aCorner.y * h;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uAlpha; uniform float uLight;
        in float vKind; in vec2 vC;
        void main() {
          vec3 c = vKind > 0.5 ? vec3(0.95) : vec3(0.55, 0.65, 0.95);
          float a = vKind > 0.5 ? 0.9 : 0.45 * (0.4 + vC.y);
          if (a * uAlpha < 0.01) discard;
          gl_FragColor = vec4(c * uLight, a * uAlpha);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    for (let i = 0; i < COUNT; i++) this.drops.push({ x: 0, y: -1000, z: 0, speed: 0.4 + Math.random() * 0.3, phase: Math.random() * 10 });
  }

  update(cam: THREE.Vector3, rain: number, dt: number, light: number, snowAt: (x: number, z: number, y: number) => boolean, splash: (x: number, y: number, z: number) => void): void {
    this.intensity = rain;
    this.mat.uniforms.uAlpha!.value = rain;
    this.mat.uniforms.uLight!.value = 0.4 + light * 0.6;
    if (rain <= 0.01) {
      this.geo.instanceCount = 0;
      return;
    }
    const active = Math.floor(COUNT * rain);
    let n = 0;
    for (let i = 0; i < active; i++) {
      const d = this.drops[i]!;
      if (d.y < cam.y - 12 || Math.abs(d.x - cam.x) > RADIUS || Math.abs(d.z - cam.z) > RADIUS) {
        d.x = cam.x + (Math.random() * 2 - 1) * RADIUS;
        d.z = cam.z + (Math.random() * 2 - 1) * RADIUS;
        d.y = cam.y + 8 + Math.random() * 10;
      }
      const bx = Math.floor(d.x);
      const bz = Math.floor(d.z);
      const ground = this.world.heightAt(bx, bz);
      const snow = snowAt(bx, bz, d.y);
      d.y -= (snow ? 0.08 : d.speed) * dt * 20;
      if (snow) d.x += Math.sin(d.phase + d.y * 0.5) * 0.01;
      if (d.y < ground) {
        if (!snow && Math.random() < 0.08) splash(d.x, ground + 0.05, d.z);
        d.y = -1000;
        continue;
      }
      if (ground > cam.y + 20 && ground > d.y) continue;
      this.offsets[n * 3] = d.x;
      this.offsets[n * 3 + 1] = d.y;
      this.offsets[n * 3 + 2] = d.z;
      this.kinds[n] = snow ? 1 : 0;
      n++;
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('aOffset') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aKind') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
