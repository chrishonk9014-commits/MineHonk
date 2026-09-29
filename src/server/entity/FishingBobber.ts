/**
 * A cast fishing line's bobber. It floats on water; after a wait (shorter
 * with Lure) a fish nibbles for about a second, and reeling in then lands a
 * catch. Reeling in at any other time just pulls the line back.
 */
import { Entity } from './Entity';
import { moveBody } from '../../common/physics/movement';
import { STATE_FLUID } from '../../common/registry/blocks';
import { fluidHeight } from '../../common/physics/movement';
import type { EntitySpawn } from '../../common/net/protocol';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Random } from '../../common/math/rng';

export type BobberState = 'flying' | 'floating' | 'ground';

export class FishingBobber extends Entity {
  readonly type = 'fishing_bobber';
  state: BobberState = 'flying';
  /** Ticks until a fish comes; then `nibble` ticks during which reeling catches it. */
  wait = 0;
  nibble = 0;
  readonly rng = new Random();

  constructor(
    readonly owner: ServerPlayer,
    readonly lure: number,
    readonly luck: number,
  ) {
    super(0.25, 0.25);
    this.persistent = false;
    this.body.stepHeight = 0;
    this.resetWait();
  }

  private resetWait(): void {
    this.wait = Math.max(40, 100 + this.rng.int(500) - this.lure * 100);
    this.nibble = 0;
  }

  /** A fish is on the hook right now. */
  get biting(): boolean {
    return this.nibble > 0;
  }

  override tick(): void {
    super.tick();
    const b = this.body;
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    const inWater = STATE_FLUID[this.dim.getState(bx, Math.floor(this.y + 0.1), bz)] === 1;
    if (inWater) {
      // Bob at the surface of the water column
      let top = Math.floor(this.y + 0.1);
      while (STATE_FLUID[this.dim.getState(bx, top + 1, bz)] === 1 && top < 255) top++;
      const surface = top + fluidHeight(this.dim.getState(bx, top, bz)) - 0.12;
      b.vy += (surface - this.y) * 0.1 - b.vy * 0.2;
      b.vx *= 0.9;
      b.vz *= 0.9;
      this.state = 'floating';
    } else {
      b.vy -= 0.03;
      b.vx *= 0.92;
      b.vz *= 0.92;
      b.vy *= 0.92;
    }
    moveBody(this.dim, b, b.vx, b.vy, b.vz);
    if (!inWater && b.onGround) this.state = 'ground';
    if (this.state === 'floating') this.tickFish();
  }

  private tickFish(): void {
    const s = this.dim.server;
    if (this.nibble > 0) {
      if (--this.nibble === 0) this.resetWait();
      return;
    }
    // Rain shortens the wait a little; so does open sky
    const sky = this.dim.getLight(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z)) >> 4;
    this.wait -= sky >= 15 && s.interaction.weather.raining ? 2 : 1;
    if (this.wait === 30) s.particles(this.dim, 'bubble', this.x, this.y, this.z, 6, 0.8);
    if (this.wait <= 0) {
      this.nibble = 20 + this.rng.int(20);
      this.body.vy -= 0.2;
      s.particles(this.dim, 'splash', this.x, this.y + 0.1, this.z, 12, 0.2);
      s.playSound(this.dim, 'splash', this.x, this.y, this.z, 0.4, 1.2 + this.rng.next() * 0.4);
    }
  }

  override meta(): Record<string, unknown> {
    return { owner: this.owner.id };
  }

  override spawnPacket(): EntitySpawn {
    return { ...super.spawnPacket(), vx: this.body.vx, vy: this.body.vy, vz: this.body.vz, meta: this.meta() };
  }

  override trackingRange(): number {
    return 64;
  }
}
