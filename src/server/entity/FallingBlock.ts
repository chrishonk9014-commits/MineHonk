/** A gravity-affected block (sand, gravel, anvils...) in motion. */
import { Entity } from './Entity';
import { moveBody } from '../../common/physics/movement';
import { blocks, STATE_BLOCK, STATE_REPLACEABLE, STATE_FLUID, stateToString, stateFromString } from '../../common/registry/blocks';
import { computeBlockDrops } from '../../common/game/drops';
import { Random } from '../../common/math/rng';

const rng = new Random();

export class FallingBlock extends Entity {
  readonly type = 'falling_block';
  constructor(public state: number) {
    super(0.98, 0.98);
    this.body.stepHeight = 0;
    this.persistent = true;
  }

  override meta(): Record<string, unknown> {
    return { state: this.state };
  }

  override tick(): void {
    super.tick();
    const b = this.body;
    b.vy -= 0.04;
    moveBody(this.dim, b, b.vx, b.vy, b.vz);
    b.vy *= 0.98;
    b.vx *= 0.98;
    b.vz *= 0.98;
    if (b.onGround || this.age > 600 || b.y < -64) {
      const x = Math.floor(b.x);
      const y = Math.floor(b.y + 0.5);
      const z = Math.floor(b.z);
      const here = this.dim.getState(x, y, z);
      if (b.y >= -64 && (here === 0 || STATE_REPLACEABLE[here] || STATE_FLUID[here])) {
        this.dim.setBlock(x, y, z, this.state);
        const def = blocks[STATE_BLOCK[this.state]!]!.def;
        this.dim.server.playSound(this.dim, def.tags?.includes('anvil') ? 'anvil.land' : 'place.' + def.sound, x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
        if (def.tags?.includes('anvil')) {
          for (const e of this.dim.entitiesNear(x + 0.5, y, z + 0.5, 1)) {
            if (e.type === 'player') this.dim.server.interaction.survival.damage(e as never, Math.min(40, Math.max(2, Math.floor(this.age / 2))), { source: 'mob' });
          }
        }
      } else if (b.y >= -64) {
        for (const s of computeBlockDrops(this.state, null, rng).items) this.dim.server.mining.dropItem(this.dim, b.x, b.y + 0.5, b.z, s, false);
      }
      this.remove();
    }
  }

  override save(): Record<string, unknown> {
    return { type: 'falling_block', x: this.x, y: this.y, z: this.z, state: stateToString(this.state) };
  }

  static load(d: Record<string, unknown>): FallingBlock | null {
    const st = stateFromString(String(d.state ?? ''));
    if (!st) return null;
    const e = new FallingBlock(st);
    e.setPos(Number(d.x) || 0, Number(d.y) || 0, Number(d.z) || 0);
    return e;
  }
}
