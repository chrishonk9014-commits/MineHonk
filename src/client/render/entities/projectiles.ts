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

registerVisual('arrow', (ent) => {
  const spectral = ent.meta.spectral === true;
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: spectral ? 0xc8a040 : 0x8a6a3a }));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: spectral ? 0xf8e070 : 0xa0a0a0 }));
  head.position.z = -0.28;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.12), new THREE.MeshBasicMaterial({ color: spectral ? 0xfff0a0 : 0xe8e8e8 }));
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

// A thrown trident: shaft with three prongs, pointing along its flight
registerVisual('trident', (ent) => {
  const group = new THREE.Group();
  const shaftMat = new THREE.MeshBasicMaterial({ color: 0x3f7f78 });
  const metalMat = new THREE.MeshBasicMaterial({ color: ent.meta.glint === true ? 0xb8a0ff : 0x9ec8c0 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), shaftMat);
  shaft.position.z = 0.1;
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), metalMat);
  cross.position.z = -0.35;
  group.add(shaft, cross);
  for (const x of [-0.09, 0, 0.09]) {
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, x === 0 ? 0.24 : 0.18), metalMat);
    prong.position.set(x, 0, x === 0 ? -0.48 : -0.45);
    group.add(prong);
  }
  const mats = [shaftMat, metalMat];
  const base = mats.map((m) => m.color.clone());
  return {
    object: group,
    update(e: ClientEntity, alpha) {
      const [x, y, z] = e.lerp(alpha);
      group.position.set(x, y + 0.1, z);
      group.rotation.order = 'YXZ';
      group.rotation.set(-e.pitch, e.yaw, 0);
    },
    setBrightness(v) {
      mats.forEach((m, i) => m.color.copy(base[i]!).multiplyScalar(Math.max(v, 0.3)));
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      mats.forEach((m) => m.dispose());
    },
  };
});

// A rocket climbing before it bursts
registerVisual('firework', () =>
  spriteVisual(
    pixelCanvas(8, (g) => {
      g.fillStyle = '#c83a2a';
      g.fillRect(3, 1, 2, 5);
      g.fillStyle = '#e8e0c8';
      g.fillRect(3, 0, 2, 1);
      g.fillStyle = '#6a4a2a';
      g.fillRect(3, 6, 2, 2);
    }),
    0.35,
  ),
);

// Fishing bobber plus the line back to the angler's hand
registerVisual('fishing_bobber', (ent, ctx) => {
  const group = new THREE.Group();
  const bob = spriteVisual(
    pixelCanvas(8, (g) => {
      g.fillStyle = '#e8e8e8';
      g.fillRect(2, 4, 4, 3);
      g.fillStyle = '#d02020';
      g.fillRect(2, 1, 4, 3);
      g.fillStyle = '#202020';
      g.fillRect(3, 0, 2, 1);
    }),
    0.3,
  );
  const SEG = 12;
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  group.add(bob.object, line);
  const ownerId = Number(ent.meta.owner ?? 0);
  return {
    object: group,
    update(e: ClientEntity, alpha, time) {
      bob.update(e, alpha, time);
      const [bx, by, bz] = e.lerp(alpha);
      let hand: [number, number, number] | null = ctx.localHand?.(ownerId) ?? null;
      if (!hand) {
        const o = ctx.entity?.(ownerId);
        if (o) {
          const [ox, oy, oz] = o.lerp(alpha);
          hand = [ox - Math.cos(o.yaw) * 0.35, oy + 1.2, oz + Math.sin(o.yaw) * 0.35];
        }
      }
      line.visible = !!hand;
      if (!hand) return;
      const pos = lineGeo.getAttribute('position') as THREE.BufferAttribute;
      const sag = Math.min(1.2, Math.hypot(bx - hand[0], bz - hand[2]) * 0.08);
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        pos.setXYZ(i, hand[0] + (bx - hand[0]) * t, hand[1] + (by + 0.1 - hand[1]) * t - Math.sin(t * Math.PI) * sag, hand[2] + (bz - hand[2]) * t);
      }
      pos.needsUpdate = true;
    },
    setBrightness(v) {
      bob.setBrightness(v);
    },
    dispose() {
      bob.dispose();
      lineGeo.dispose();
      lineMat.dispose();
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
// V6: a Chorus Beast's thrown chorus
registerVisual('chorus_glob', fireball(0.55, '#e8a8ff', '#8a5a9a'));
// V6 phase 3: a Sentinel's crystal bolt and a Shardstaff's shard
registerVisual('crystal_bolt', fireball(0.35, '#d8f8ff', '#3ab0d0'));
registerVisual('crystal_shard', fireball(0.3, '#f4e8ff', '#9a7ad0'));
// V5.5: the dragon's malware: a tumbling clump of green and black data
registerVisual('malware', () =>
  spriteVisual(
    pixelCanvas(16, (g) => {
      const cols = ['#0a0f0a', '#18ff6a', '#0b3a1a', '#9dffb8', '#000000', '#22c45a'];
      for (let y = 2; y < 14; y += 2)
        for (let x = 2; x < 14; x += 2) {
          const d = Math.hypot(x - 7, y - 7);
          if (d > 6.2) continue;
          g.fillStyle = cols[(x * 7 + y * 13) % cols.length]!;
          g.fillRect(x, y, 2, 2);
        }
    }),
    1.1,
    { glow: true, spin: true },
  ),
);
// Herobrine's bolt: a white spark with a cyan edge
registerVisual('herobrine_bolt', fireball(0.45, '#ffffff', '#3fe8ff'));

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
