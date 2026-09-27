/** Visuals for End entities: thrown Eyes of Ender, End Crystals and dragon fireballs. */
import * as THREE from 'three';
import { registerVisual, type EntityVisual } from './EntityRenderer';

registerVisual('eye_of_ender', (e, ctx) => {
  const src = ctx.icons.texture('ender_eye', 'item');
  const t = new THREE.CanvasTexture(src ?? document.createElement('canvas'));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.1 });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.4, 0.4, 1);
  void e;
  return {
    object: s,
    update(ent, alpha) {
      const [x, y, z] = ent.lerp(alpha);
      s.position.set(x, y + 0.1, z);
    },
    setBrightness() {
      mat.color.setScalar(1);
    },
    dispose() {
      t.dispose();
      mat.dispose();
    },
  };
});

function glassCube(size: number, color: number, opacity: number): THREE.LineSegments {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

registerVisual('end_crystal', (e, ctx) => {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  const outer = glassCube(1.1, 0xe0d8ff, 0.9);
  const inner = glassCube(0.8, 0xffffff, 0.7);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xd060d8 });
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), coreMat);
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xc8b8ff, transparent: true, opacity: 0.18, depthWrite: false });
  const faces = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.08, 1.08), faceMat);
  outer.add(faces);
  spin.add(outer, inner, core);
  group.add(spin);
  let base: THREE.Mesh | null = null;
  if (e.meta.noBase !== true) {
    const bt = ctx.blockTexture('bedrock');
    base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.4), new THREE.MeshBasicMaterial({ map: bt }));
    base.position.y = 0.17;
    group.add(base);
  }
  // Healing beam towards the dragon
  const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true);
  beamGeo.translate(0, 0.5, 0);
  beamGeo.rotateX(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff90ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  const lines = [outer, inner];
  const visual: EntityVisual = {
    object: group,
    update(ent, alpha, time) {
      const [x, y, z] = ent.lerp(alpha);
      group.position.set(x, y, z);
      const bob = Math.sin(time * 0.12 + ent.id) * 0.25;
      spin.position.y = 1.3 + bob;
      outer.rotation.set(time * 0.05, time * 0.08, 0.6);
      inner.rotation.set(-time * 0.07, time * 0.05, -0.4);
      core.rotation.set(time * 0.03, -time * 0.09, 0);
      const id = Number(ent.meta.beam ?? -1);
      const target = id >= 0 ? ctx.entity?.(id) : undefined;
      if (target) {
        const [tx, ty, tz] = target.lerp(alpha);
        const from = new THREE.Vector3(x, y + spin.position.y, z);
        const to = new THREE.Vector3(tx, ty + 2, tz);
        const len = from.distanceTo(to);
        beam.visible = true;
        beam.position.copy(from);
        beam.scale.set(1, 1, len);
        beam.lookAt(to);
        beamMat.opacity = 0.55 + 0.25 * Math.sin(time * 0.5);
        if (!beam.parent) group.parent?.add(beam);
      } else beam.visible = false;
    },
    setBrightness() {
      coreMat.color.setHex(0xd060d8);
    },
    dispose() {
      beam.parent?.remove(beam);
      beamGeo.dispose();
      beamMat.dispose();
      for (const l of lines) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
      faces.geometry.dispose();
      faceMat.dispose();
      core.geometry.dispose();
      coreMat.dispose();
      if (base) {
        base.geometry.dispose();
        (base.material as THREE.Material).dispose();
      }
    },
  };
  return visual;
});

registerVisual('dragon_fireball', () => {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#40105a';
  g.fillRect(1, 1, 6, 6);
  g.fillStyle = '#b040e0';
  g.fillRect(2, 2, 4, 4);
  g.fillStyle = '#ffc0ff';
  g.fillRect(3, 3, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.1 });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.1, 1.1, 1);
  return {
    object: s,
    update(ent, alpha, time) {
      const [x, y, z] = ent.lerp(alpha);
      s.position.set(x, y + 0.5, z);
      mat.rotation = time * 0.3;
    },
    setBrightness() {
      mat.color.setScalar(1);
    },
    dispose() {
      t.dispose();
      mat.dispose();
    },
  };
});
