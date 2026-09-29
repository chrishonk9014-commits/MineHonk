/** Light beams above active beacons (read from the loaded chunks' block entities). */
import * as THREE from 'three';
import type { ClientWorld } from '../world/ClientWorld';

export class BeaconBeams {
  readonly group = new THREE.Group();
  private readonly beams = new Map<string, THREE.Group>();
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  private frame = 0;

  constructor(private readonly world: ClientWorld) {
    this.group.name = 'beacon-beams';
  }

  update(camX: number, camZ: number, time: number): void {
    // Rescan block entities about twice a second
    if (this.frame++ % 30 === 0) this.scan(camX, camZ);
    for (const g of this.beams.values()) g.rotation.y = time * 0.03;
    this.coreMat.opacity = 0.5 + Math.sin(time * 0.15) * 0.08;
  }

  private scan(camX: number, camZ: number): void {
    const found = new Set<string>();
    const ccx = Math.floor(camX) >> 4;
    const ccz = Math.floor(camZ) >> 4;
    for (const c of this.world.chunks.values()) {
      if (Math.abs(c.cx - ccx) > 16 || Math.abs(c.cz - ccz) > 16 || c.blockEntities.size === 0) continue;
      for (const [k, be] of c.blockEntities) {
        if (be.type !== 'beacon' || !be.beam) continue;
        const x = (c.cx << 4) + (k & 15);
        const y = k >> 8;
        const z = (c.cz << 4) + ((k >> 4) & 15);
        const key = `${x},${y},${z}`;
        found.add(key);
        if (!this.beams.has(key)) this.add(key, x, y, z);
      }
    }
    for (const [k, g] of this.beams) {
      if (found.has(k)) continue;
      this.group.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.beams.delete(k);
    }
  }

  private add(key: string, x: number, y: number, z: number): void {
    const h = 256 - (y + 1);
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.36, h, 0.36), this.coreMat);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.62, h, 0.62), this.glowMat);
    g.add(core, glow);
    g.position.set(x + 0.5, y + 1 + h / 2, z + 0.5);
    g.renderOrder = 5;
    core.frustumCulled = false;
    glow.frustumCulled = false;
    this.beams.set(key, g);
    this.group.add(g);
  }

  dispose(): void {
    for (const g of this.beams.values())
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    this.beams.clear();
    this.coreMat.dispose();
    this.glowMat.dispose();
  }
}
