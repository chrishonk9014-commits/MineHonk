/**
 * Entities of the End progression: thrown Eyes of Ender that lead to a
 * stronghold, and End Crystals that heal the Ender Dragon and explode when
 * struck.
 */
import { Entity } from './Entity';
import { registerEntityInfo } from '../../common/data/entities';
import { stackOf } from '../../common/game/itemstack';

registerEntityInfo('eye_of_ender', { width: 0.25, height: 0.25, eye: 0.1, attackable: false, interactable: false });
registerEntityInfo('end_crystal', { width: 2, height: 2, eye: 1, attackable: true, interactable: false });

/** A thrown Eye of Ender: floats towards a target and then drops or shatters. */
export class EnderEye extends Entity {
  readonly type = 'eye_of_ender';
  private readonly aim: { x: number; y: number; z: number };

  constructor(
    x: number,
    y: number,
    z: number,
    target: { x: number; z: number } | null,
    private readonly survives: boolean,
  ) {
    super(0.25, 0.25);
    this.persistent = false;
    this.setPos(x, y, z);
    if (target) {
      const dx = target.x - x;
      const dz = target.z - z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = Math.min(d, 12);
      this.aim = { x: x + (dx / d) * reach, y: d > 12 ? y + 8 : y - 1, z: z + (dz / d) * reach };
    } else this.aim = { x, y: y + 6, z };
  }

  override tick(): void {
    super.tick();
    const b = this.body;
    const dx = this.aim.x - b.x;
    const dy = this.aim.y - b.y;
    const dz = this.aim.z - b.z;
    const d = Math.hypot(dx, dy, dz);
    const step = Math.min(d, Math.max(0.08, d * 0.06));
    if (d > 0.01) {
      b.vx = (dx / d) * step;
      b.vy = (dy / d) * step + Math.sin(this.age * 0.4) * 0.02;
      b.vz = (dz / d) * step;
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;
    }
    const server = this.dim.server;
    if (this.age % 2 === 0) server.particles(this.dim, 'portal', b.x, b.y, b.z, 2, 0.2);
    if (this.age >= 70) {
      this.remove();
      if (this.survives) server.mining.dropItem(this.dim, b.x, b.y, b.z, stackOf('ender_eye', 1));
      else {
        server.particles(this.dim, 'item_break', b.x, b.y, b.z, 12, 0.2);
        server.playSound(this.dim, 'item.break', b.x, b.y, b.z, 1, 1);
      }
    }
  }

  override trackingRange(): number {
    return 64;
  }
}

/** An End Crystal on top of a pillar (or placed by a player on the exit portal). */
export class EndCrystal extends Entity {
  readonly type = 'end_crystal';
  /** Entity id of the dragon this crystal is currently healing. */
  beam: number | null = null;
  showBase = true;
  destroyed = false;

  constructor() {
    super(2, 2);
    this.persistent = true;
  }

  setBeam(id: number | null): void {
    if (this.beam === id) return;
    this.beam = id;
    this.metaDirty = true;
  }

  override meta(): Record<string, unknown> {
    const m: Record<string, unknown> = {};
    if (this.beam !== null) m.beam = this.beam;
    if (!this.showBase) m.noBase = true;
    return m;
  }

  /** Struck by a player, projectile or explosion. */
  destroy(by: Entity | null): void {
    if (this.destroyed || this.removed) return;
    this.destroyed = true;
    this.remove();
    const server = this.dim.server;
    server.theEnd?.onCrystalDestroyed(this, by);
    server.mobs?.explode(this.dim, this.x, this.y + 1, this.z, 6, false, this);
  }

  override save(): Record<string, unknown> {
    return { kind: 'end_crystal', type: 'end_crystal', x: this.x, y: this.y, z: this.z, base: this.showBase };
  }

  static load(d: Record<string, unknown>): EndCrystal | null {
    if (d.type !== 'end_crystal') return null;
    const c = new EndCrystal();
    c.setPos(Number(d.x) || 0, Number(d.y) || 0, Number(d.z) || 0);
    c.showBase = d.base !== false;
    return c;
  }

  override trackingRange(): number {
    return 160;
  }
}
