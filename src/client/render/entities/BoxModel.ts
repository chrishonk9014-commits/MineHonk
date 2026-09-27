/**
 * Blocky entity models built from textured cuboids ("parts") with pivots,
 * using the common box-unwrap UV layout on a skin texture.
 */
import * as THREE from 'three';

export interface PartDef {
  name: string;
  /** Pivot position in pixels relative to the parent pivot (model root = feet). */
  pivot: [number, number, number];
  /** Box origin relative to pivot (pixels) and size. */
  from: [number, number, number];
  size: [number, number, number];
  /** Texture offset of the box unwrap. */
  uv: [number, number];
  /** Inflate (pixels) – for hats/armor layers. */
  inflate?: number;
  mirror?: boolean;
  rot?: [number, number, number];
  children?: PartDef[];
}

export interface ModelDef {
  texW: number;
  texH: number;
  parts: PartDef[];
  /** Model scale (1 = 1px -> 1/16 block). */
  scale?: number;
}

const FACE_SHADE = { top: 1.0, bottom: 0.5, front: 0.8, back: 0.8, left: 0.62, right: 0.62 };

function boxGeometry(p: PartDef, texW: number, texH: number): THREE.BufferGeometry {
  const [w, h, d] = p.size;
  const inf = p.inflate ?? 0;
  const x0 = (p.from[0] - inf) / 16;
  const y0 = (p.from[1] - inf) / 16;
  const z0 = (p.from[2] - inf) / 16;
  const x1 = (p.from[0] + w + inf) / 16;
  const y1 = (p.from[1] + h + inf) / 16;
  const z1 = (p.from[2] + d + inf) / 16;
  const [u, v] = p.uv;
  const pos: number[] = [];
  const uvs: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  // uv rect helper (pixel coords, v down)
  const face = (verts: number[][], rect: [number, number, number, number], shade: number, flipU = false): void => {
    const base = pos.length / 3;
    let [ru0, rv0, ru1, rv1] = rect;
    if (flipU !== !!p.mirror) [ru0, ru1] = [ru1, ru0];
    const uvq = [
      [ru0, rv0],
      [ru0, rv1],
      [ru1, rv1],
      [ru1, rv0],
    ];
    for (let i = 0; i < 4; i++) {
      pos.push(...verts[i]!);
      uvs.push(uvq[i]![0] / texW, 1 - uvq[i]![1] / texH);
      cols.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Front faces -Z? Convention: model faces +Z (south) as "front".
  // top
  face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [u + d, v, u + d + w, v + d], FACE_SHADE.top);
  // bottom
  face([[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [u + d + w, v, u + d + 2 * w, v + d], FACE_SHADE.bottom);
  // front (+Z)
  face([[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], [u + d, v + d, u + d + w, v + d + h], FACE_SHADE.front);
  // back (-Z)
  face([[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h], FACE_SHADE.back);
  // right side (-X)
  face([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [u, v + d, u + d, v + d + h], FACE_SHADE.left);
  // left side (+X)
  face([[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], [u + d + w, v + d, u + 2 * d + w, v + d + h], FACE_SHADE.right);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  return g;
}

export class BoxModel {
  readonly root = new THREE.Group();
  readonly parts = new Map<string, THREE.Group>();
  readonly material: THREE.MeshBasicMaterial;

  constructor(
    def: ModelDef,
    texture: THREE.Texture,
    opts: { transparent?: boolean } = {},
  ) {
    this.material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: !!opts.transparent, alphaTest: 0.1, side: THREE.FrontSide });
    const scale = def.scale ?? 1;
    const build = (p: PartDef, parent: THREE.Object3D): void => {
      const g = new THREE.Group();
      g.name = p.name;
      g.position.set(p.pivot[0] / 16, p.pivot[1] / 16, p.pivot[2] / 16);
      if (p.rot) g.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      if (p.size[0] > 0 || p.size[1] > 0 || p.size[2] > 0) {
        const mesh = new THREE.Mesh(boxGeometry(p, def.texW, def.texH), this.material);
        g.add(mesh);
      }
      parent.add(g);
      this.parts.set(p.name, g);
      for (const c of p.children ?? []) build(c, g);
    };
    const inner = new THREE.Group();
    inner.scale.setScalar(scale);
    this.root.add(inner);
    for (const p of def.parts) build(p, inner);
  }

  part(name: string): THREE.Group | undefined {
    return this.parts.get(name);
  }

  setBrightness(v: number, tint?: THREE.Color): void {
    this.material.color.setRGB(v, v, v);
    if (tint) this.material.color.multiply(tint);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
  }
}

/** Standard humanoid (players, zombies, skeletons) on a 64x64 skin. */
export function humanoidDef(opts: { slim?: boolean; thin?: boolean } = {}): ModelDef {
  const aw = opts.slim ? 3 : 4;
  const limbW = opts.thin ? 2 : 4;
  return {
    texW: 64,
    texH: 64,
    parts: [
      {
        name: 'body',
        pivot: [0, 12, 0],
        from: [-4, 0, -2],
        size: [8, 12, 4],
        uv: [16, 16],
        children: [
          { name: 'head', pivot: [0, 12, 0], from: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0], children: [{ name: 'hat', pivot: [0, 0, 0], from: [-4, 0, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 }] },
          { name: 'rightArm', pivot: [-(4 + aw / 2) + (aw === 3 ? 0.5 : 0) - 0.0, 10, 0], from: [-aw / 2, -10, -limbW / 2], size: [opts.thin ? 2 : aw, 12, opts.thin ? 2 : 4], uv: [40, 16] },
          { name: 'leftArm', pivot: [4 + aw / 2, 10, 0], from: [-aw / 2, -10, -limbW / 2], size: [opts.thin ? 2 : aw, 12, opts.thin ? 2 : 4], uv: [32, 48] },
        ],
      },
      { name: 'rightLeg', pivot: [-2, 12, 0], from: [-limbW / 2, -12, -limbW / 2], size: [limbW, 12, limbW], uv: [0, 16] },
      { name: 'leftLeg', pivot: [2, 12, 0], from: [-limbW / 2, -12, -limbW / 2], size: [limbW, 12, limbW], uv: [16, 48] },
    ],
  };
}

/** Quadruped (cow, pig, sheep, wolf...) parameters. */
export function quadrupedDef(o: { bodyW: number; bodyH: number; bodyL: number; legH: number; legW: number; headW: number; headH: number; headL: number; headY?: number; headZ?: number; tex?: [number, number]; bodyUv?: [number, number]; legUv?: [number, number]; headUv?: [number, number]; extra?: PartDef[] }): ModelDef {
  const [tw, th] = o.tex ?? [64, 32];
  const legY = o.legH;
  const bodyY = legY + o.bodyH / 2;
  const lx = o.bodyW / 2 - o.legW / 2;
  const lz = o.bodyL / 2 - o.legW / 2;
  const leg = (name: string, x: number, z: number): PartDef => ({ name, pivot: [x, legY, z], from: [-o.legW / 2, -legY, -o.legW / 2], size: [o.legW, legY, o.legW], uv: o.legUv ?? [0, 16] });
  return {
    texW: tw,
    texH: th,
    parts: [
      { name: 'body', pivot: [0, bodyY, 0], from: [-o.bodyW / 2, -o.bodyH / 2, -o.bodyL / 2], size: [o.bodyW, o.bodyH, o.bodyL], uv: o.bodyUv ?? [18, 4] },
      { name: 'head', pivot: [0, o.headY ?? bodyY + o.bodyH / 2 - 1, (o.headZ ?? o.bodyL / 2)], from: [-o.headW / 2, -o.headH / 2, 0], size: [o.headW, o.headH, o.headL], uv: o.headUv ?? [0, 0] },
      leg('leg0', -lx, lz),
      leg('leg1', lx, lz),
      leg('leg2', -lx, -lz),
      leg('leg3', lx, -lz),
      ...(o.extra ?? []),
    ],
  };
}
