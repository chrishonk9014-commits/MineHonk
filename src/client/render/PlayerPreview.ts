/** Small 3D player doll shown in the inventory; it turns to follow the mouse. */
import { armorOverlay, type ArmorOverlay } from './entities/armorOverlay';
import * as THREE from 'three';
import { BoxModel, humanoidDef } from './entities/BoxModel';
import { playerSkin } from './entities/skins';

class PreviewRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-0.75, 0.75, 2.1, -0.05, 0.1, 10);
  private readonly model: BoxModel;
  private readonly armor: ArmorOverlay;
  /** The local player's worn armor materials, head to feet. */
  wornArmor: (() => string[]) | null = null;
  private host: HTMLElement | null = null;
  private raf = 0;
  private mouse = { x: 0, y: 0 };

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.model = new BoxModel(humanoidDef(), playerSkin(null));
    this.model.setBrightness(1);
    this.armor = armorOverlay(this.model);
    this.scene.add(this.model.root);
    // Orthographic frustum bounds are relative to the camera, so keep it at y=0
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    window.addEventListener('mousemove', (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
  }

  setSkin(name: string | null): void {
    this.model.material.map = playerSkin(name);
    this.model.material.needsUpdate = true;
  }

  attach(host: HTMLElement): () => void {
    this.detach();
    this.host = host;
    host.append(this.canvas);
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      this.draw();
    };
    loop();
    return () => {
      if (this.host === host) this.detach();
    };
  }

  private detach(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    this.host = null;
  }

  private draw(): void {
    const host = this.host;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      const aspect = w / h;
      const top = 2.1;
      const bottom = -0.05;
      const half = ((top - bottom) * aspect) / 2;
      this.camera.left = -half;
      this.camera.right = half;
      this.camera.updateProjectionMatrix();
    }
    // Look towards the mouse like the classic inventory doll
    const cx = r.left + r.width / 2;
    const headY = r.top + r.height * 0.25;
    const scale = Math.max(1, r.height / 72);
    const dx = Math.atan((this.mouse.x - cx) / (40 * scale));
    const dy = Math.atan((this.mouse.y - headY) / (40 * scale));
    this.model.root.rotation.y = dx * 0.6;
    const head = this.model.part('head');
    if (head) head.rotation.set(dy * 0.5, dx * 0.4, 0);
    this.armor.set(this.wornArmor?.());
    this.renderer.render(this.scene, this.camera);
  }
}

let instance: PreviewRenderer | null = null;

/** Shows the player doll inside `host`. Returns a detach function. */
export function attachPlayerPreview(host: HTMLElement, name: string | null = null, wornArmor: (() => string[]) | null = null): () => void {
  try {
    instance ??= new PreviewRenderer();
  } catch {
    return () => {};
  }
  instance.setSkin(name);
  instance.wornArmor = wornArmor;
  return instance.attach(host);
}
