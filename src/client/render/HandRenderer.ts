/** First-person arm and held item, rendered in an overlay pass. */
import * as THREE from 'three';
import { BoxModel, humanoidDef } from './entities/BoxModel';
import { skinTexture, paintPlayer } from './entities/skins';
import type { ItemIcons } from './ItemIcons';
import { items } from '../../common/registry/items';
import { blockById } from '../../common/registry/blocks';
import { modelFor, ModelKind } from './models';

export class HandRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly pivot = new THREE.Group();
  private readonly arm: THREE.Group;
  private readonly armModel: BoxModel;
  private held: THREE.Object3D | null = null;
  private heldId = -1;
  private equip = 0;
  swing = 0;
  private swingTime = 0;
  using = 0;
  private readonly heldMats: THREE.Material[] = [];

  constructor(
    private readonly icons: ItemIcons,
    private readonly blockTex: (name: string) => THREE.Texture,
  ) {
    this.scene.add(this.pivot);
    this.armModel = new BoxModel(humanoidDef(), skinTexture('player:default', 64, 64, paintPlayer));
    const ra = this.armModel.part('rightArm')!;
    // Detach the arm geometry into our own group
    this.arm = new THREE.Group();
    const armMesh = ra.children.find((c) => c instanceof THREE.Mesh)!.clone();
    this.arm.add(armMesh);
    this.pivot.add(this.arm);
  }

  setItem(itemNum: number): void {
    if (itemNum === this.heldId) return;
    this.heldId = itemNum;
    this.equip = 1;
    if (this.held) {
      this.pivot.remove(this.held);
      this.held.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of this.heldMats) m.dispose();
      this.heldMats.length = 0;
      this.held = null;
    }
    if (itemNum <= 0) return;
    const it = items[itemNum];
    if (!it) return;
    const bt = it.def.block ? blockById.get(it.def.block) : undefined;
    const ownSprite = this.icons.texture(it.id, 'item');
    if (bt && !ownSprite && modelFor(bt.defaultState).kind === ModelKind.Cube) {
      const m = modelFor(bt.defaultState);
      const faces = [5, 4, 1, 0, 3, 2].map((f) => {
        const mat = new THREE.MeshBasicMaterial({ map: this.blockTex(m.cubeTex![f]!), transparent: true, alphaTest: 0.1 });
        const shade = [0.6, 0.6, 1, 0.5, 0.8, 0.8][[5, 4, 1, 0, 3, 2].indexOf(f)]!;
        mat.color.setScalar(shade);
        if (m.cubeTint?.[f] === 'grass') mat.color.multiply(new THREE.Color(0x7cbd6b));
        else if (m.cubeTint?.[f] && m.cubeTint[f] !== 'none') mat.color.multiply(new THREE.Color(0x48b518));
        this.heldMats.push(mat);
        return mat;
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), faces);
      mesh.position.set(0.05, 0.12, -0.15);
      mesh.rotation.set(0.1, 0.8, 0);
      this.held = mesh;
    } else {
      const tex = new THREE.CanvasTexture(this.icons.render(itemNum));
      tex.magFilter = THREE.NearestFilter;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
      this.heldMats.push(mat);
      const g = new THREE.Group();
      // cheap extrusion: stacked planes
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), mat);
        p.position.z = i * 0.012;
        g.add(p);
      }
      g.position.set(0.02, 0.28, -0.08);
      g.rotation.set(0, Math.PI / 2 - 0.3, 0.5);
      this.held = g;
    }
    this.pivot.add(this.held);
  }

  triggerSwing(): void {
    if (this.swingTime <= 0 || this.swingTime < 3) this.swingTime = 6;
  }

  tick(): void {
    if (this.swingTime > 0) this.swingTime--;
    if (this.equip > 0) this.equip = Math.max(0, this.equip - 0.25);
  }

  update(alpha: number, bobX: number, bobY: number, brightness: number, aspect: number, visible: boolean): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.pivot.visible = visible;
    const swingP = this.swingTime > 0 ? 1 - (this.swingTime - alpha) / 6 : 0;
    const s = Math.sin(swingP * Math.PI);
    const s2 = Math.sin(Math.sqrt(Math.max(0, swingP)) * Math.PI);
    const hasItem = !!this.held;
    this.arm.visible = !hasItem;
    this.pivot.position.set(0.56 + bobX - s2 * 0.3, -0.52 + bobY - this.equip * 0.6 + s * 0.2 - this.using * 0.05, -0.72 - s * 0.2);
    this.pivot.rotation.set(-s2 * 0.6 + this.using * 0.2, -0.1 - s * 0.6, 0);
    // The arm hangs down (-Y) from the shoulder: tip it forward into the screen so the hand
    // reaches towards the centre and the sleeve stays near the bottom-right corner.
    this.arm.rotation.set(1.8, 0.35, -0.1);
    this.arm.position.set(0.0, -0.06, 0.3);
    this.armModel.material.color.setScalar(brightness);
    for (const m of this.heldMats) {
      const mb = m as THREE.MeshBasicMaterial;
      mb.userData.base ??= mb.color.clone();
      mb.color.copy(mb.userData.base as THREE.Color).multiplyScalar(brightness);
    }
  }
}
