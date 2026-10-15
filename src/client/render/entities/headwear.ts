/**
 * V7 phase 2: a block worn in the helmet slot (a costume head, a carved
 * pumpkin) drawn over a humanoid model's head, a little larger than the head,
 * with the block's own textures: its face to the front.
 */
import * as THREE from 'three';
import type { BoxModel } from './BoxModel';
import { blockById } from '../../../common/registry/blocks';

/** Block textures for models drawn outside the world renderer (the inventory doll); set by the WorldRenderer. */
let shared: ((name: string) => THREE.Texture) | null = null;
export function setHeadwearTextures(f: (name: string) => THREE.Texture): void {
  shared = f;
}

export interface HeadwearOverlay {
  /** The worn block's id (undefined: nothing); rebuilds only when it changes. */
  set(id: string | undefined): void;
  setBrightness(v: number): void;
  dispose(): void;
}

/** Inflated a little beyond the 8 x 8 x 8 head, so the hair and hat layers stay inside. */
const SIZE = 9.2;

/**
 * `head`: the head part's size in pixels (a player's is 8 x 8 x 8; a
 * villager's is 8 x 10 x 8, so the block sits over all of it, V7 phase 3).
 * Parts named in `hide` (a villager's nose) are hidden while something is worn.
 */
export function headwearOverlay(model: BoxModel, texture?: (name: string) => THREE.Texture, head: [number, number, number] = [8, 8, 8], hide: string[] = []): HeadwearOverlay {
  let key = '';
  let mesh: THREE.Mesh | null = null;
  let mats: THREE.MeshBasicMaterial[] = [];
  let bright = 1;
  const clear = (): void => {
    mesh?.parent?.remove(mesh);
    mesh?.geometry.dispose();
    for (const m of mats) m.dispose();
    mesh = null;
    mats = [];
  };
  return {
    set(id) {
      const k = id ?? '';
      if (k === key) return;
      key = k;
      clear();
      const tex = texture ?? shared;
      const def = id ? blockById.get(id)?.def : undefined;
      const part = model.part('head');
      for (const n of hide) {
        const h = model.part(n);
        if (h) h.visible = !def;
      }
      if (!def || !tex || !part) return;
      const t = def.tex;
      const side = t.side ?? t.all ?? t.top ?? 'missing_block';
      const front = t.front ?? side;
      const top = t.top ?? side;
      const bottom = t.bottom ?? top;
      const back = t.back ?? side;
      // BoxGeometry's faces: +x, -x, +y, -y, +z (the model's front), -z
      const shade = [0.62, 0.62, 1, 0.5, 0.85, 0.8];
      mats = [side, side, top, bottom, front, back].map((n, i) => {
        const m = new THREE.MeshBasicMaterial({ map: tex(n), transparent: true, alphaTest: 0.1 });
        m.userData.shade = shade[i];
        m.color.setScalar(shade[i]! * bright);
        return m;
      });
      const size = SIZE + Math.max(0, Math.max(head[0], head[1], head[2]) - 8);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(size / 16, size / 16, size / 16), mats);
      // The head part's box spans y 0..h and x, z -w/2..w/2 (pixels) from its pivot
      mesh.position.set(0, head[1] / 2 / 16, 0);
      part.add(mesh);
    },
    setBrightness(v) {
      bright = v;
      for (const m of mats) m.color.setScalar((m.userData.shade as number) * v);
    },
    dispose: clear,
  };
}
