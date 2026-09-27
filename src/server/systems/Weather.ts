/** Rain / thunder cycle and lightning strikes. */
import type { GameServer } from '../GameServer';
import { Random } from '../../common/math/rng';
import { biomeOf } from '../../common/registry/biomes';
import { S, STATE_SOLID } from '../../common/registry/blocks';

const rng = new Random();

export class Weather {
  constructor(private readonly server: GameServer) {}

  set(kind: 'clear' | 'rain' | 'thunder', duration = 6000 + rng.int(12000)): void {
    const l = this.server.level;
    l.raining = kind !== 'clear';
    l.thundering = kind === 'thunder';
    l.rainTime = duration;
    l.thunderTime = duration;
    this.server.sendTime();
  }

  tick(): void {
    const l = this.server.level;
    if (!l.rules.doWeatherCycle) return;
    l.rainTime--;
    if (l.rainTime <= 0) {
      l.raining = !l.raining;
      l.rainTime = l.raining ? 12000 + rng.int(12000) : 12000 + rng.int(156000);
      if (!l.raining) l.thundering = false;
      this.server.sendTime();
    }
    l.thunderTime--;
    if (l.thunderTime <= 0) {
      l.thundering = l.raining && !l.thundering && rng.chance(0.4);
      l.thunderTime = l.thundering ? 3600 + rng.int(12000) : 12000 + rng.int(156000);
      this.server.sendTime();
    }
    if (l.thundering && this.server.tickNo % 20 === 0) this.maybeLightning();
  }

  private maybeLightning(): void {
    for (const p of this.server.players.values()) {
      if (p.dim.id !== 'overworld' || !rng.chance(1 / 30)) continue;
      const x = Math.floor(p.x) + rng.range(-48, 48);
      const z = Math.floor(p.z) + rng.range(-48, 48);
      if (!p.dim.isLoaded(x, z)) continue;
      const b = biomeOf(p.dim.getBiome(x, z));
      if (b.precipitation !== 'rain') continue;
      const y = p.dim.getHeight(x, z);
      this.strike(p.dim, x, y, z);
    }
  }

  strike(dim: import('../world/Dimension').Dimension, x: number, y: number, z: number): void {
    this.server.broadcastNear(dim, x, y, z, 256, { t: 'particles', kind: 'lightning', x: x + 0.5, y, z: z + 0.5, count: 1 });
    this.server.broadcastNear(dim, x, y, z, 512, { t: 'sound', name: 'thunder', x, y, z, volume: 10, pitch: 0.8 + rng.next() * 0.2 });
    if (this.server.level.rules.doFireTick && dim.getState(x, y, z) === 0 && STATE_SOLID[dim.getState(x, y - 1, z)]) dim.setBlock(x, y, z, S('fire'));
    for (const e of dim.entitiesNear(x + 0.5, y, z + 0.5, 3)) {
      if (e.type === 'player') this.server.interaction.survival.damage(e as never, 5, { source: 'lightning' });
      else this.server.interaction.hurtEntity(e, 5, 'lightning', null);
    }
  }
}
