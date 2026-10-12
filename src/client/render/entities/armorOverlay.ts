/**
 * Worn armor drawn over a humanoid player model: a helmet, a chestplate
 * with shoulder plates, leggings and boots, each in its material's colour
 * (V6: so Ender Alloy armor can be seen on the player). Pieces are plain
 * boxes a little outside the body, added to the model's own parts so they
 * move with it.
 */
import * as THREE from 'three';
import type { BoxModel } from './BoxModel';

/** Base colour and sheen of each armor material. */
const MATERIAL: Record<string, { base: number; spot: number }> = {
  leather: { base: 0x8f5a32, spot: 0x6e4224 },
  chainmail: { base: 0xa8a8a8, spot: 0x606060 },
  iron: { base: 0xd8d8d8, spot: 0xa8a8a8 },
  golden: { base: 0xf5d33a, spot: 0xc8a020 },
  diamond: { base: 0x4fe3d6, spot: 0x2ab0a8 },
  netherite: { base: 0x4a3f42, spot: 0x2e2628 },
  glitched: { base: 0xc050ff, spot: 0x00ffff },
  ender_alloy: { base: 0x2a8a7a, spot: 0x9a6af0 },
  turtle: { base: 0x3a9a3a, spot: 0x2a6a2a },
};

const textures = new Map<string, THREE.CanvasTexture>();
function textureOf(material: string): THREE.CanvasTexture {
  let t = textures.get(material);
  if (t) return t;
  const m = MATERIAL[material] ?? { base: 0x888888, spot: 0x555555 };
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d')!;
  const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = hex(m.base);
  g.fillRect(0, 0, 8, 8);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 0, 8, 1);
  g.fillRect(0, 0, 1, 8);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 7, 8, 1);
  g.fillRect(7, 0, 1, 8);
  g.fillStyle = hex(m.spot);
  for (const [x, y] of [[2, 2], [5, 3], [3, 5], [6, 6]] as const) g.fillRect(x, y, 1, 1);
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  textures.set(material, t);
  return t;
}

/** Boxes of each piece: [part, from (pixels, in the part's space), size]. */
const PIECES: [part: string, from: [number, number, number], size: [number, number, number]][][] = [
  // Helmet
  [['head', [-4.6, 3.4, -4.6], [9.2, 5.2, 9.2]]],
  // Chestplate and shoulder plates
  [
    ['body', [-4.6, 3, -2.6], [9.2, 9.6, 5.2]],
    ['rightArm', [-2.6, -4.4, -2.6], [5.2, 7, 5.2]],
    ['leftArm', [-2.6, -4.4, -2.6], [5.2, 7, 5.2]],
  ],
  // Leggings
  [
    ['body', [-4.4, -0.4, -2.4], [8.8, 3.6, 4.8]],
    ['rightLeg', [-2.4, -8, -2.4], [4.8, 8.4, 4.8]],
    ['leftLeg', [-2.4, -8, -2.4], [4.8, 8.4, 4.8]],
  ],
  // Boots
  [
    ['rightLeg', [-2.6, -12.4, -2.6], [5.2, 4.6, 5.2]],
    ['leftLeg', [-2.6, -12.4, -2.6], [5.2, 4.6, 5.2]],
  ],
];

export interface ArmorOverlay {
  /** Worn materials, head to feet ('' for none); rebuilds only when they change. */
  set(worn: readonly string[] | undefined): void;
  setBrightness(v: number): void;
  dispose(): void;
}

export function armorOverlay(model: BoxModel): ArmorOverlay {
  let key = '';
  const meshes: THREE.Mesh[] = [];
  const mats: THREE.MeshBasicMaterial[] = [];
  let bright = 1;
  const clearAll = (): void => {
    for (const m of meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    for (const m of mats) m.dispose();
    meshes.length = 0;
    mats.length = 0;
  };
  return {
    set(worn) {
      const k = (worn ?? []).join(',');
      if (k === key) return;
      key = k;
      clearAll();
      (worn ?? []).forEach((material, i) => {
        if (!material) return;
        const mat = new THREE.MeshBasicMaterial({ map: textureOf(material) });
        mat.color.setScalar(bright);
        mats.push(mat);
        for (const [part, from, size] of PIECES[i] ?? []) {
          const p = model.part(part);
          if (!p) continue;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16), mat);
          mesh.position.set((from[0] + size[0] / 2) / 16, (from[1] + size[1] / 2) / 16, (from[2] + size[2] / 2) / 16);
          p.add(mesh);
          meshes.push(mesh);
        }
      });
    },
    setBrightness(v) {
      bright = v;
      for (const m of mats) m.color.setScalar(v);
    },
    dispose: clearAll,
  };
}
