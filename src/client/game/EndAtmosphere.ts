/**
 * V6: the Expanded End's atmosphere around the player. Each of its biomes
 * has its own sky tint, fog colour and fog density; this samples the biomes
 * around the player and blends them, so crossing a border (or leaving the
 * classic End) shifts the air gradually instead of all at once.
 */
import * as THREE from 'three';
import type { Biome } from '../../common/registry/biomes';
import { EXPANSION_BIOMES, type ExpansionBiome } from '../../common/endExpansion/biomes';
import { inExpansion } from '../../common/endExpansion/region';

const BY_ID = new Map(EXPANSION_BIOMES.map((b) => [b.id, b]));
/** The classic End's air (matches the End branch of Sky.update). */
const CLASSIC = new THREE.Color(0x100a18);
/** Sample grid: (2R+1)^2 columns STEP blocks apart. */
const R = 2;
const STEP = 12;

export interface EndAtmosState {
  sky: THREE.Color;
  fog: THREE.Color;
  /** 0..1 */
  density: number;
  /** How far the view has blended into the Expanded End (0 = classic End). */
  amount: number;
}

export class EndAtmosphere {
  readonly state: EndAtmosState = { sky: CLASSIC.clone(), fog: CLASSIC.clone(), density: 0, amount: 0 };
  /** The biome most of the samples fell in (null outside the Expanded End). */
  dominant: ExpansionBiome | null = null;
  private readonly sky = new THREE.Color();
  private readonly fog = new THREE.Color();
  private readonly tmp = new THREE.Color();

  /** Expanded End biome at a column (null for anything else). */
  static biomeAt(biomeAt: (x: number, z: number) => Biome, x: number, z: number): ExpansionBiome | null {
    return inExpansion(x, z) ? BY_ID.get(biomeAt(x, z).id) ?? null : null;
  }

  update(inEnd: boolean, x: number, z: number, biomeAt: (x: number, z: number) => Biome): void {
    const st = this.state;
    if (!inEnd || !inExpansion(x, z)) {
      // Fade back to the classic End
      st.amount = Math.max(0, st.amount - 0.03);
      if (st.amount === 0) this.dominant = null;
      return;
    }
    this.sky.setRGB(0, 0, 0);
    this.fog.setRGB(0, 0, 0);
    let density = 0;
    let total = 0;
    let inside = 0;
    const counts = new Map<ExpansionBiome, number>();
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        // Nearer samples weigh more
        const w = 1 / (1 + Math.hypot(dx, dz));
        total += w;
        const def = EndAtmosphere.biomeAt(biomeAt, x + dx * STEP, z + dz * STEP);
        if (def) {
          inside += w;
          density += def.fogDensity * w;
          this.sky.add(this.tmp.setHex(def.sky).multiplyScalar(w));
          this.fog.add(this.tmp.setHex(def.fog).multiplyScalar(w));
          counts.set(def, (counts.get(def) ?? 0) + w);
        } else {
          this.sky.add(this.tmp.copy(CLASSIC).multiplyScalar(w));
          this.fog.add(this.tmp.copy(CLASSIC).multiplyScalar(w));
        }
      }
    this.sky.multiplyScalar(1 / total);
    this.fog.multiplyScalar(1 / total);
    density /= total;
    // Ease towards the new values (a few seconds across a border)
    const k = 0.06;
    st.sky.lerp(this.sky, k);
    st.fog.lerp(this.fog, k);
    st.density += (density - st.density) * k;
    st.amount += (Math.min(1, inside / total + 0.25) - st.amount) * k;
    let best: ExpansionBiome | null = null;
    let bw = 0;
    for (const [d, w] of counts)
      if (w > bw) {
        bw = w;
        best = d;
      }
    this.dominant = best;
  }
}
