/** Visuals for projectiles and primed TNT. */
import * as THREE from 'three';
import { registerVisual, type EntityVisual } from './EntityRenderer';
import type { ClientEntity } from '../../game/ClientEntity';
import { itemById } from '../../../common/registry/items';

function spriteVisual(canvas: HTMLCanvasElement, size: number, opts: { glow?: boolean; spin?: boolean } = {}): EntityVisual {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.1 });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return {
    object: s,
    update(e, alpha, time) {
      const [x, y, z] = e.lerp(alpha);
      s.position.set(x, y + size * 0.4, z);
      if (opts.spin) mat.rotation = time * 0.3;
    },
    setBrightness(v) {
      const b = opts.glow ? 1 : v;
      mat.color.setRGB(b, b, b);
    },
    dispose() {
      t.dispose();
      mat.dispose();
    },
  };
}

function pixelCanvas(size: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d')!);
  return c;
}

registerVisual('arrow', () => {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: 0x8a6a3a }));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xa0a0a0 }));
  head.position.z = -0.28;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.12), new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }));
  fl.position.z = 0.22;
  const fl2 = fl.clone();
  fl2.rotation.z = Math.PI / 2;
  group.add(shaft, head, fl, fl2);
  const mats = [shaft.material, head.material, fl.material] as THREE.MeshBasicMaterial[];
  const base = mats.map((m) => m.color.clone());
  return {
    object: group,
    update(e: ClientEntity, alpha) {
      const [x, y, z] = e.lerp(alpha);
      group.position.set(x, y + 0.1, z);
      group.rotation.set(0, 0, 0);
      group.rotation.order = 'YXZ';
      group.rotation.y = e.yaw;
      group.rotation.x = -e.pitch;
    },
    setBrightness(v) {
      mats.forEach((m, i) => m.color.copy(base[i]!).multiplyScalar(v));
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      mats.forEach((m) => m.dispose());
    },
  };
});

registerVisual('snowball', () => spriteVisual(pixelCanvas(8, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(2, 1, 4, 6);
  g.fillRect(1, 2, 6, 4);
  g.fillStyle = '#c8d8e8';
  g.fillRect(4, 4, 2, 2);
}), 0.25));

registerVisual('egg', () => spriteVisual(pixelCanvas(8, (g) => {
  g.fillStyle = '#e8dcc0';
  g.fillRect(2, 1, 4, 6);
  g.fillRect(1, 3, 6, 3);
}), 0.25));

registerVisual('ender_pearl', () => spriteVisual(pixelCanvas(8, (g) => {
  g.fillStyle = '#1a6a5a';
  g.fillRect(1, 1, 6, 6);
  g.fillStyle = '#3ad0b0';
  g.fillRect(2, 2, 3, 3);
}), 0.25));

registerVisual('experience_bottle', () => spriteVisual(pixelCanvas(8, (g) => {
  g.fillStyle = '#c8f040';
  g.fillRect(2, 2, 4, 5);
  g.fillStyle = '#e8e8e8';
  g.fillRect(3, 0, 2, 2);
}), 0.3));

registerVisual('potion', (e) => {
  const col = '#8a2a9a';
  void e;
  return spriteVisual(pixelCanvas(8, (g) => {
    g.fillStyle = col;
    g.fillRect(2, 3, 4, 4);
    g.fillStyle = '#e0e0f0';
    g.fillRect(3, 0, 2, 3);
  }), 0.3);
});

function fireball(size: number, core: string, rim: string): () => EntityVisual {
  return () =>
    spriteVisual(pixelCanvas(8, (g) => {
      g.fillStyle = rim;
      g.fillRect(1, 1, 6, 6);
      g.fillStyle = core;
      g.fillRect(2, 2, 4, 4);
      g.fillStyle = '#fff4a0';
      g.fillRect(3, 3, 2, 2);
    }), size, { glow: true, spin: true });
}
registerVisual('small_fireball', fireball(0.35, '#f09020', '#c04010'));
registerVisual('fireball', fireball(1.0, '#f07020', '#a02808'));
registerVisual('rift_bolt', fireball(0.5, '#d13fff', '#3a0a5a'));
registerVisual('shulker_bullet', fireball(0.35, '#f0e8f8', '#8a5a9a'));

registerVisual('tnt', (e, ctx) => {
  const top = ctx.blockTexture('tnt_top');
  const side = ctx.blockTexture('tnt_side');
  const bottom = ctx.blockTexture('tnt_bottom');
  const mats = [side, side, top, bottom, side, side].map((t) => new THREE.MeshBasicMaterial({ map: t }));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), mats);
  let bright = 1;
  return {
    object: mesh,
    update(ent, alpha) {
      const [x, y, z] = ent.lerp(alpha);
      mesh.position.set(x, y + 0.49, z);
      const fuse = Number(ent.meta.fuse ?? 80) - ent.age;
      const s = fuse < 10 ? 1 + (10 - fuse) * 0.02 : 1;
      mesh.scale.setScalar(s);
      const flash = Math.floor(fuse / 5) % 2 === 0;
      for (const m of mats) m.color.setScalar(flash ? Math.min(2, bright * 1.8) : bright);
    },
    setBrightness(v) {
      bright = v;
    },
    dispose() {
      mesh.geometry.dispose();
      mats.forEach((m) => m.dispose());
    },
  };
  void e;
});

void itemById;
