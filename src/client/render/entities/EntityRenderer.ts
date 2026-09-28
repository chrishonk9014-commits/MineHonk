/**
 * Creates and animates visuals for replicated entities. Entity types register
 * visual factories; unknown types fall back to a simple box.
 */
import * as THREE from 'three';
import type { ClientEntity } from '../../game/ClientEntity';
import { BoxModel, humanoidDef } from './BoxModel';
import { playerSkin } from './skins';
import type { ItemIcons } from '../ItemIcons';
import { items } from '../../../common/registry/items';
import { blocks, STATE_BLOCK } from '../../../common/registry/blocks';
import type { ClientWorld } from '../../world/ClientWorld';
import { MOB_BY_ID } from '../../../common/data/mobs';

export interface EntityVisual {
  object: THREE.Object3D;
  /** Called every frame. */
  update(e: ClientEntity, alpha: number, time: number): void;
  setBrightness(v: number): void;
  dispose(): void;
  nameTag?: THREE.Sprite;
}

export type VisualFactory = (e: ClientEntity, ctx: VisualContext) => EntityVisual;

export interface VisualContext {
  icons: ItemIcons;
  atlas: THREE.Texture;
  blockTexture(name: string): THREE.Texture;
  /** Another rendered entity by id (e.g. the dragon an end crystal beams to). */
  entity?(id: number): ClientEntity | undefined;
  /** Where the local player's hand is (fishing lines, leads), if `id` is the local player. */
  localHand?(id: number): [number, number, number] | null;
}

const factories = new Map<string, VisualFactory>();
export function registerVisual(type: string, f: VisualFactory): void {
  factories.set(type, f);
}

// ------------------------------------------------------------------ helpers

export function animateHumanoid(m: BoxModel, e: ClientEntity, alpha: number, opts: { armsForward?: boolean } = {}): void {
  const walk = e.prevWalkDist + (e.walkDist - e.prevWalkDist) * alpha;
  const swing = Math.sin(walk * 0.6662) * 1.2 * e.limbSpeed;
  const rl = m.part('rightLeg');
  const ll = m.part('leftLeg');
  const ra = m.part('rightArm');
  const la = m.part('leftArm');
  const head = m.part('head');
  if (rl) rl.rotation.x = swing;
  if (ll) ll.rotation.x = -swing;
  if (opts.armsForward) {
    if (ra) ra.rotation.x = -Math.PI / 2 + swing * 0.1;
    if (la) la.rotation.x = -Math.PI / 2 - swing * 0.1;
  } else {
    if (ra) ra.rotation.x = -swing * 0.8;
    if (la) la.rotation.x = swing * 0.8;
  }
  if (e.swingTime > 0 && ra) {
    const t = 1 - e.swingTime / 6;
    ra.rotation.x = -Math.sin(t * Math.PI) * 1.6 - 0.3;
    ra.rotation.z = Math.sin(t * Math.PI) * 0.3;
  } else if (ra) ra.rotation.z = 0;
  if (head) {
    head.rotation.y = angle(e.headYaw - e.yaw);
    head.rotation.x = e.pitch;
  }
  const body = m.part('body');
  const sneak = e.meta.sneak === true;
  if (body) body.rotation.x = sneak ? 0.5 : 0;
  m.root.position.y = sneak ? -0.2 : 0;
}

function angle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeNameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = '16px "MineHonk Pixel", monospace';
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  c.width = w;
  c.height = 22;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, w, 22);
  ctx.font = '16px "MineHonk Pixel", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 4, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
  s.scale.set(w / 40, 22 / 40, 1);
  return s;
}

/** Standard wrapper for box models. */
export function boxVisual(model: BoxModel, animate: (m: BoxModel, e: ClientEntity, alpha: number, time: number) => void, opts: { name?: string; nameY?: number } = {}): EntityVisual {
  const holder = new THREE.Group();
  holder.add(model.root);
  let tag: THREE.Sprite | undefined;
  if (opts.name) {
    tag = makeNameTag(opts.name);
    tag.position.y = opts.nameY ?? 2.1;
    holder.add(tag);
  }
  return {
    object: holder,
    nameTag: tag,
    update(e, alpha, time) {
      const [x, y, z] = e.lerp(alpha);
      holder.position.set(x, y, z);
      // Models face +Z; yaw 0 faces -Z (north) and increases counter-clockwise
      model.root.rotation.y = Math.PI + e.yaw;
      model.root.rotation.z = 0;
      if (e.dead) model.root.rotation.z = Math.min(Math.PI / 2, (e.deathTime / 10) * (Math.PI / 2));
      animate(model, e, alpha, time);
      if (e.hurtTime > 0 || e.dead) model.material.color.multiply(new THREE.Color(1, 0.45, 0.45));
    },
    setBrightness(v) {
      model.setBrightness(v);
    },
    dispose() {
      model.dispose();
      if (tag) {
        (tag.material as THREE.SpriteMaterial).map?.dispose();
        tag.material.dispose();
      }
    },
  };
}

// ------------------------------------------------------------------ built-in visuals

registerVisual('player', (e, ctx) => {
  const name = typeof e.meta.name === 'string' ? e.meta.name : null;
  const m = new BoxModel(humanoidDef(), playerSkin(name));
  // Elytra wings on the back, folded unless gliding
  const wingMat = new THREE.MeshBasicMaterial({ color: 0x8e8aa8 });
  const wings: THREE.Mesh[] = [];
  const body = m.part('body');
  if (body) {
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.5, 0.95, 0.06);
      g.translate(side * 0.25, -0.475, 0);
      const w = new THREE.Mesh(g, wingMat);
      w.position.set(side * 0.1, 0.75, -0.16);
      w.visible = false;
      body.add(w);
      wings.push(w);
    }
  }
  const v = boxVisual(
    m,
    (mm, ee, a) => {
      animateHumanoid(mm, ee, a);
      const gliding = ee.meta.glide === true;
      const hasWings = ee.meta.elytra === true;
      wings.forEach((w, i) => {
        const side = i === 0 ? -1 : 1;
        w.visible = hasWings;
        w.rotation.set(gliding ? 0.25 : 0.1, 0, side * (gliding ? 1.2 : 0.12));
      });
      mm.root.rotation.order = 'YXZ';
      // Riding: sit on the mount's seat (drawn from the mount's own position so the two never drift apart)
      const vehicle = typeof ee.meta.riding === 'number' ? ctx.entity?.(ee.meta.riding) : undefined;
      if (vehicle) {
        const seat = MOB_BY_ID.get(vehicle.type)?.mount?.seat ?? 0.7;
        const [vx, vy, vz] = vehicle.lerp(a);
        const [px, py, pz] = ee.lerp(a);
        mm.root.position.set(vx - px, vy + seat - py - 0.3, vz - pz);
        const rl = mm.part('rightLeg');
        const ll = mm.part('leftLeg');
        if (rl) rl.rotation.set(-1.4, 0.2, 0);
        if (ll) ll.rotation.set(-1.4, -0.2, 0);
        mm.root.rotation.x = 0;
        return;
      }
      mm.root.position.x = 0;
      mm.root.position.z = 0;
      if (gliding) {
        // Body flat along the flight direction, arms back
        mm.root.rotation.x = Math.PI / 2 - 0.25 + ee.pitch * 0.6;
        mm.root.position.y = 0.3;
        const ra = mm.part('rightArm');
        const la = mm.part('leftArm');
        if (ra) ra.rotation.set(0, 0, -0.25);
        if (la) la.rotation.set(0, 0, 0.25);
      } else mm.root.rotation.x = 0;
    },
    { name: name ?? 'Player', nameY: 2.15 },
  );
  const baseBright = v.setBrightness.bind(v);
  v.setBrightness = (b) => {
    baseBright(b);
    wingMat.color.setHex(0x8e8aa8).multiplyScalar(b);
  };
  const baseDispose = v.dispose.bind(v);
  v.dispose = () => {
    baseDispose();
    for (const w of wings) w.geometry.dispose();
    wingMat.dispose();
  };
  return v;
});

registerVisual('item', (e, ctx) => {
  const holder = new THREE.Group();
  const itemNum = Number(e.meta.item ?? 0);
  const it = items[itemNum];
  const blockId = it?.def.block;
  const bt = blockId ? blocks.find((b) => b.id === blockId) : undefined;
  let obj: THREE.Object3D;
  let mat: THREE.MeshBasicMaterial | THREE.SpriteMaterial;
  const isCube = bt && (bt.def.model === 'cube' || bt.def.model === 'column' || bt.def.model === 'slab' || bt.def.model === 'stairs') && !ctx.icons.texture(it!.id, 'item');
  if (isCube) {
    const icon = new THREE.CanvasTexture(ctx.icons.render(itemNum));
    icon.magFilter = THREE.NearestFilter;
    mat = new THREE.SpriteMaterial({ map: icon, transparent: true });
    obj = new THREE.Sprite(mat as THREE.SpriteMaterial);
    obj.scale.set(0.42, 0.42, 1);
  } else {
    const icon = new THREE.CanvasTexture(ctx.icons.render(itemNum));
    icon.magFilter = THREE.NearestFilter;
    mat = new THREE.MeshBasicMaterial({ map: icon, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide });
    obj = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat);
  }
  obj.position.y = 0.2;
  holder.add(obj);
  const count = Number(e.meta.count ?? 1);
  const copies: THREE.Object3D[] = [obj];
  for (let i = 1; i < Math.min(4, Math.ceil(count / 16)); i++) {
    const c = obj.clone();
    c.position.set((i % 2) * 0.06 - 0.03, 0.2 + i * 0.02, ((i >> 1) % 2) * 0.06 - 0.03);
    holder.add(c);
    copies.push(c);
  }
  const phase = (e.id * 0.37) % (Math.PI * 2);
  return {
    object: holder,
    update(ent, alpha, time) {
      const [x, y, z] = ent.lerp(alpha);
      holder.position.set(x, y + Math.sin(time * 0.1 + phase) * 0.05 + 0.05, z);
      holder.rotation.y = time * 0.05 + phase;
    },
    setBrightness(v) {
      mat.color.setRGB(v, v, v);
    },
    dispose() {
      mat.map?.dispose();
      mat.dispose();
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    },
  };
});

registerVisual('xp_orb', (e) => {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8f040';
  g.fillRect(2, 1, 4, 6);
  g.fillRect(1, 2, 6, 4);
  g.fillStyle = '#f8ff90';
  g.fillRect(3, 2, 2, 2);
  g.fillStyle = '#6a9a10';
  g.fillRect(5, 5, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  const size = 0.18 + Math.min(0.2, Math.log2(1 + Number(e.meta.value ?? 1)) * 0.03);
  s.scale.set(size, size, 1);
  return {
    object: s,
    update(ent, alpha, time) {
      const [x, y, z] = ent.lerp(alpha);
      s.position.set(x, y + 0.25, z);
      const pulse = 0.75 + 0.25 * Math.sin(time * 0.4 + ent.id);
      mat.color.setRGB(pulse, 1, pulse * 0.5);
    },
    setBrightness() {},
    dispose() {
      t.dispose();
      mat.dispose();
    },
  };
});

registerVisual('falling_block', (e, ctx) => {
  const state = Number(e.meta.state ?? 0);
  const def = blocks[STATE_BLOCK[state] ?? 0]!.def;
  const tex = ctx.blockTexture(def.tex.all ?? def.tex.side ?? def.tex.top ?? 'missing_block');
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  return {
    object: mesh,
    update(ent, alpha) {
      const [x, y, z] = ent.lerp(alpha);
      mesh.position.set(x, y + 0.5, z);
    },
    setBrightness(v) {
      mat.color.setRGB(v, v, v);
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
});

function fallbackVisual(e: ClientEntity): EntityVisual {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.6), mat);
  return {
    object: mesh,
    update(ent, alpha) {
      const [x, y, z] = ent.lerp(alpha);
      mesh.position.set(x, y + 0.6, z);
    },
    setBrightness() {},
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
  void e;
}

export class EntityRenderer {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<number, EntityVisual>();
  private readonly known = new Map<number, ClientEntity>();
  private readonly ctx: VisualContext;
  /** The local player (not a replicated entity): id and hand position for lines. */
  local: { id: number; hand: () => [number, number, number] } | null = null;

  constructor(
    ctx: VisualContext,
    private readonly world: ClientWorld,
  ) {
    this.group.name = 'entities';
    this.ctx = { ...ctx, entity: (id) => this.known.get(id), localHand: (id) => (this.local && this.local.id === id ? this.local.hand() : null) };
  }

  add(e: ClientEntity): void {
    if (this.visuals.has(e.id)) return;
    const f = factories.get(e.type);
    const v = f ? f(e, this.ctx) : fallbackVisual(e);
    this.visuals.set(e.id, v);
    this.known.set(e.id, e);
    this.group.add(v.object);
  }

  remove(id: number): void {
    const v = this.visuals.get(id);
    this.glowing.delete(id);
    if (!v) return;
    this.group.remove(v.object);
    v.dispose();
    this.visuals.delete(id);
    this.known.delete(id);
  }

  /** Rebuilds a visual (e.g. metadata changed). */
  refresh(e: ClientEntity): void {
    this.remove(e.id);
    this.add(e);
  }

  update(entities: Iterable<ClientEntity>, alpha: number, time: number, lightAt: (x: number, y: number, z: number) => number): void {
    for (const e of entities) {
      const v = this.visuals.get(e.id);
      if (!v) continue;
      const glowing = e.meta.glowing === true;
      v.setBrightness(glowing ? 1 : lightAt(e.x, e.y + 0.5, e.z));
      v.update(e, alpha, time);
      if (v.nameTag) v.nameTag.visible = !(e.meta.sneak === true);
      if (glowing !== this.glowing.has(e.id)) this.setGlowing(e.id, v, glowing);
    }
    void this.world;
  }

  /** Entity ids currently drawn through walls (the Glowing effect). */
  private readonly glowing = new Set<number>();

  /** Glowing entities are drawn over the terrain so they can be spotted behind walls. */
  private setGlowing(id: number, v: EntityVisual, on: boolean): void {
    if (on) this.glowing.add(id);
    else this.glowing.delete(id);
    v.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) m.depthTest = !on;
      o.renderOrder = on ? 8 : 0;
    });
  }

  clear(): void {
    for (const id of [...this.visuals.keys()]) this.remove(id);
  }
}
