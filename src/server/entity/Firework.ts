/** A firework rocket launched from the ground: climbs, then bursts into sparks. */
import { Entity } from './Entity';
import type { EntitySpawn } from '../../common/net/protocol';

export class Firework extends Entity {
  readonly type = 'firework';
  vx = 0;
  vy = 0.05;
  vz = 0;
  /** Ticks until the burst. */
  fuse: number;
  /** Burst colour (hue 0..359). */
  readonly hue: number;

  constructor(fuse: number, hue: number) {
    super(0.25, 0.25);
    this.fuse = fuse;
    this.hue = hue;
    this.persistent = false;
  }

  override tick(): void {
    super.tick();
    const s = this.dim.server;
    // Accelerates upwards with a little sideways drift
    this.vx *= 1.15;
    this.vz *= 1.15;
    this.vy += 0.04;
    this.setPos(this.x + this.vx, this.y + this.vy, this.z + this.vz);
    if (this.age % 2 === 0) s.particles(this.dim, 'firework_trail', this.x, this.y - 0.2, this.z, 1, 0.05);
    if (--this.fuse <= 0) {
      s.particles(this.dim, 'firework', this.x, this.y, this.z, 70, 0.1, this.hue);
      s.playSound(this.dim, 'firework.blast', this.x, this.y, this.z, 4, 0.9 + Math.random() * 0.2);
      this.remove();
    }
  }

  override spawnPacket(): EntitySpawn {
    return { ...super.spawnPacket(), vx: this.vx, vy: this.vy, vz: this.vz };
  }

  override trackingRange(): number {
    return 128;
  }
}
