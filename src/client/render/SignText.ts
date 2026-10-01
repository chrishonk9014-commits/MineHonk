/**
 * Text written on signs, drawn as small canvas planes in front of the board
 * (read from the loaded chunks' block entities). Signs touched with a glow
 * ink sac light their text up so it reads in the dark.
 */
import * as THREE from 'three';
import type { ClientWorld } from '../world/ClientWorld';
import { blocks, STATE_BLOCK, getProp } from '../../common/registry/blocks';

interface Sign {
  meshes: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  tex: THREE.CanvasTexture;
  text: string;
  glow: boolean;
  x: number;
  y: number;
  z: number;
}

const W = 128;
const H = 64;

export class SignText {
  readonly group = new THREE.Group();
  private readonly signs = new Map<string, Sign>();
  private readonly geo = new THREE.PlaneGeometry(1, 0.5);
  private readonly screenGeo = new THREE.PlaneGeometry(12 / 16, 12 / 16);
  private frame = 0;

  constructor(private readonly world: ClientWorld) {
    this.group.name = 'sign-text';
  }

  update(camX: number, camY: number, camZ: number, lightAt: (x: number, y: number, z: number) => number): void {
    if (this.frame++ % 20 === 0) this.scan(camX, camZ);
    for (const s of this.signs.values()) {
      const near = Math.abs(s.x - camX) < 48 && Math.abs(s.y - camY) < 48 && Math.abs(s.z - camZ) < 48;
      for (const m of s.meshes) m.visible = near;
      if (!near) continue;
      // Plain ink follows the light on the board; glowing ink shines regardless
      const l = s.glow ? 1 : Math.max(0.08, lightAt(s.x + 0.5, s.y + 0.5, s.z + 0.5));
      s.mat.color.setScalar(l);
    }
  }

  private scan(camX: number, camZ: number): void {
    const found = new Set<string>();
    const ccx = Math.floor(camX) >> 4;
    const ccz = Math.floor(camZ) >> 4;
    for (const c of this.world.chunks.values()) {
      if (Math.abs(c.cx - ccx) > 4 || Math.abs(c.cz - ccz) > 4 || c.blockEntities.size === 0) continue;
      for (const [k, be] of c.blockEntities) {
        if (!Array.isArray(be.lines)) continue;
        if (be.type === 'eng' && be.id === 'monitor') {
          this.scanMonitor(c, k, be.lines as unknown[], found);
          continue;
        }
        if (be.type !== 'sign') continue;
        const lines = (be.lines as unknown[]).map((l) => String(l ?? ''));
        const text = lines.join('\n');
        if (!text.trim()) continue;
        const x = (c.cx << 4) + (k & 15);
        const y = k >> 8;
        const z = (c.cz << 4) + ((k >> 4) & 15);
        const key = `${x},${y},${z}`;
        const glow = be.glow === true;
        const state = this.world.getState(x, y, z);
        const id = blocks[STATE_BLOCK[state]!]?.def.model;
        if (id !== 'sign' && id !== 'wall_sign') continue;
        found.add(key);
        const cur = this.signs.get(key);
        const pose = `${state}`;
        if (cur && cur.text === text && cur.glow === glow && cur.meshes[0]?.userData.pose === pose) continue;
        if (cur) this.remove(key);
        this.add(key, x, y, z, state, id === 'wall_sign', lines, glow);
      }
    }
    for (const k of [...this.signs.keys()]) if (!found.has(k)) this.remove(k);
  }

  /** V5 monitors: their screen, written by the server into the block entity. */
  private scanMonitor(c: { cx: number; cz: number }, k: number, raw: unknown[], found: Set<string>): void {
    const lines = raw.map((l) => String(l ?? '')).slice(0, 7);
    const x = (c.cx << 4) + (k & 15);
    const y = k >> 8;
    const z = (c.cz << 4) + ((k >> 4) & 15);
    const state = this.world.getState(x, y, z);
    if (blocks[STATE_BLOCK[state]!]?.def.id !== 'monitor') return;
    const key = `${x},${y},${z}`;
    found.add(key);
    const text = lines.join('\n');
    const cur = this.signs.get(key);
    if (cur && cur.text === text && cur.meshes[0]?.userData.pose === `${state}`) return;
    if (cur) this.remove(key);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.textBaseline = 'middle';
    g.font = "11px 'MineHonk Pixel', monospace";
    lines.forEach((line, i) => {
      g.fillStyle = i === 0 ? '#9fffb0' : line.startsWith('!') ? '#ff8080' : '#5fe07a';
      g.fillText(line, 6, 10 + i * 17, 116);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const f = getProp(state, 'facing') ?? 'north';
    const [nx, nz] = ({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] } as Record<string, [number, number]>)[f] ?? [0, -1];
    const m = new THREE.Mesh(this.screenGeo, mat);
    m.position.set(x + 0.5 + nx * 0.505, y + 0.5, z + 0.5 + nz * 0.505);
    m.rotation.y = Math.atan2(nx, nz);
    m.userData.pose = `${state}`;
    m.renderOrder = 4;
    this.group.add(m);
    this.signs.set(key, { meshes: [m], mat, tex, text, glow: true, x, y, z });
  }

  private add(key: string, x: number, y: number, z: number, state: number, wall: boolean, lines: string[], glow: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "12px 'MineHonk Pixel', monospace";
    for (let i = 0; i < 4; i++) {
      const line = lines[i] ?? '';
      if (!line) continue;
      const cy = 9 + i * 15;
      if (glow) {
        // A soft halo behind glowing text
        g.fillStyle = 'rgba(255, 240, 200, 0.35)';
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) g.fillText(line, W / 2 + dx, cy + dy, W - 6);
        g.fillStyle = '#fff8e0';
      } else g.fillStyle = '#1a120a';
      g.fillText(line, W / 2, cy, W - 6);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const meshes: THREE.Mesh[] = [];
    const place = (nx: number, nz: number, off: number, cy: number): void => {
      const m = new THREE.Mesh(this.geo, mat);
      m.position.set(x + 0.5 + nx * off, y + cy, z + 0.5 + nz * off);
      m.rotation.y = Math.atan2(nx, nz);
      m.scale.setScalar(0.94);
      m.userData.pose = `${state}`;
      m.renderOrder = 4;
      meshes.push(m);
      this.group.add(m);
    };
    if (wall) {
      // Wall signs face away from the wall they hang on
      const f = getProp(state, 'facing') ?? 'north';
      const [nx, nz] = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[f as 'north'] ?? [0, -1];
      place(nx!, nz!, 6 / 16 + 0.005, 8.5 / 16);
    } else {
      // Standing signs show the text on both faces of the board
      const a = (parseInt(getProp(state, 'rotation') ?? '0', 10) * 22.5 * Math.PI) / 180;
      const nx = Math.sin(a);
      const nz = -Math.cos(a);
      place(nx, nz, 0.75 / 16 + 0.005, 11 / 16);
      place(-nx, -nz, 0.75 / 16 + 0.005, 11 / 16);
    }
    this.signs.set(key, { meshes, mat, tex, text: lines.join('\n'), glow, x, y, z });
  }

  private remove(key: string): void {
    const s = this.signs.get(key);
    if (!s) return;
    for (const m of s.meshes) this.group.remove(m);
    s.mat.dispose();
    s.tex.dispose();
    this.signs.delete(key);
  }

  dispose(): void {
    for (const k of [...this.signs.keys()]) this.remove(k);
    this.geo.dispose();
    this.screenGeo.dispose();
  }
}
