/**
 * V7 - The Halloween Update: the server's side of the season (shared rules in
 * src/common/halloween/).
 *
 * - Decides whether Halloween content is on in this world (the date from the
 *   server's clock, the world's "Halloween content" setting, and any Admin
 *   Panel simulation) and tells every player the moment that changes, so all
 *   players in a world always see the same.
 * - Scatters each dimension's pumpkin on newly generated chunks while it is
 *   on. The chunk is then saved like any changed chunk, so the pumpkin stays
 *   after the season.
 * - The Admin Panel's Halloween tab: the state and why, a ghost now, placing
 *   each pumpkin, and simulating "after the cutoff" or "always on" (never
 *   saved: it ends when the world closes). Everything it does is a cheat.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import type { Chunk } from '../../common/world/chunk';
import { halloweenReasonText, halloweenState, HALLOWEEN_ENDS_AT, type HalloweenSimulation, type HalloweenState } from '../../common/halloween/season';
import { DIMENSION_PUMPKINS, decoratePumpkins } from '../../common/halloween/pumpkins';
import { STATE_REPLACEABLE, STATE_SOLID, STATE_FLUID, stateOf } from '../../common/registry/blocks';
import type { HalloweenOp, HalloweenStatus } from '../../common/game/admin';

/** How often (ticks) the season is looked at again. */
const CHECK_TICKS = 20;

export class HalloweenSystem {
  /** Admin Panel test simulation (never saved). */
  sim: HalloweenSimulation = 'none';
  private last = '';
  private tickNo = 0;
  /** Pumpkins scattered on new chunks since the world opened (the Admin Panel shows it). */
  placed = 0;

  constructor(private readonly server: GameServer) {
    // Players learn the starting state when they join; only changes are sent after that
    this.last = this.key();
  }

  private key(): string {
    const s = this.state;
    return `${s.active}:${s.reason}:${s.sim}`;
  }

  get state(): HalloweenState {
    return this.server.halloweenState();
  }

  get active(): boolean {
    return this.state.active;
  }

  tick(): void {
    if (++this.tickNo % CHECK_TICKS !== 0) return;
    this.syncIfChanged();
  }

  /** Sends everyone their world info when the season's answer changes (the cutoff passing, a simulation). */
  private syncIfChanged(): void {
    const key = this.key();
    if (key === this.last) return;
    this.last = key;
    const srv = this.server;
    for (const p of srv.players.values()) p.send({ t: 'world_info', world: srv.worldInfo(p) });
  }

  /**
   * A chunk was just generated (before it is lit and sent): its pumpkin, if
   * Halloween is on and the chunk gets one. Returns how many were placed.
   */
  decorate(dim: Dimension, c: Chunk): number {
    const s = this.state;
    if (!s.active) return 0;
    const spot = decoratePumpkins(c, dim.id, this.server.level.seedNum, (x, y, z) => dim.generator.structureAt?.(x, y, z) ?? null);
    if (!spot) return 0;
    this.placed++;
    // Only an Admin Panel simulation made it Halloween here: what it grew is cheat-made
    if (s.sim !== 'none' && !halloweenState(this.server.clock(), this.server.level.halloween).active) this.server.admin.setBlockMark(dim, spot.x, spot.y, spot.z, true);
    return 1;
  }

  status(): HalloweenStatus {
    const s = this.state;
    return { state: s, text: halloweenReasonText(s), endsAt: HALLOWEEN_ENDS_AT, now: this.server.clock(), placed: this.placed };
  }

  admin(p: ServerPlayer, op: HalloweenOp, pumpkin?: string, sim?: HalloweenSimulation): { ok: boolean; text: string; data?: unknown } {
    const reply = (ok: boolean, text: string): { ok: boolean; text: string; data: HalloweenStatus } => ({ ok, text, data: this.status() });
    switch (op) {
      case 'status':
        return reply(true, '');
      case 'ghost': {
        p.send({ t: 'ghost' });
        const s = this.state;
        return reply(true, s.active ? 'A ghost drifts past (only you see it).' : 'A ghost drifts past (only you see it). Halloween is off here, so none come by themselves.');
      }
      case 'place':
      case 'place_all': {
        const ids = op === 'place' ? DIMENSION_PUMPKINS.filter((d) => d.id === pumpkin).map((d) => d.id) : DIMENSION_PUMPKINS.map((d) => d.id);
        if (!ids.length) return reply(false, 'Unknown pumpkin.');
        const n = this.placeInFront(p, ids);
        if (!n) return reply(false, 'There is no room in front of you.');
        return reply(true, op === 'place' ? `Placed a ${DIMENSION_PUMPKINS.find((d) => d.id === ids[0])!.name} in front of you.` : `Placed ${n} pumpkin${n === 1 ? '' : 's'} in front of you, one of each.`);
      }
      case 'simulate': {
        this.sim = sim ?? 'none';
        this.syncIfChanged();
        const s = this.state;
        const what = this.sim === 'expired' ? 'Simulating after the cutoff' : this.sim === 'always' ? 'Simulating Halloween always on' : 'Simulation off';
        return reply(true, `${what}: Halloween content is ${s.active ? 'on' : 'off'} here until the world closes.`);
      }
    }
  }

  /** Places pumpkins in a row in front of a player, facing them; returns how many fit. */
  private placeInFront(p: ServerPlayer, ids: string[]): number {
    const dim = p.dim;
    // Forward is (-sin yaw, -cos yaw); the pumpkins look back at the player
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const facing = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 'west' : 'east') : fz > 0 ? 'north' : 'south';
    const step = Math.abs(fx) > Math.abs(fz) ? [0, 1] : [1, 0];
    const ahead = 3;
    const bx = Math.floor(p.x + fx * ahead);
    const bz = Math.floor(p.z + fz * ahead);
    const half = Math.floor(ids.length / 2);
    let n = 0;
    ids.forEach((id, i) => {
      const x = bx + step[0]! * (i - half) * 2;
      const z = bz + step[1]! * (i - half) * 2;
      const y = this.groundAt(dim, x, Math.floor(p.y), z);
      if (y === null) return;
      dim.setBlock(x, y, z, stateOf(id, { facing }));
      this.server.admin.setBlockMark(dim, x, y, z, true);
      n++;
    });
    return n;
  }

  /** The first free spot standing on something solid near a height (null: no room). */
  private groundAt(dim: Dimension, x: number, y0: number, z: number): number | null {
    if (!dim.isLoaded(x, z)) return null;
    const free = (y: number): boolean => {
      const st = dim.getState(x, y, z);
      return st === 0 || (!!STATE_REPLACEABLE[st] && !STATE_FLUID[st]);
    };
    for (let d = 0; d <= 10; d++)
      for (const y of d === 0 ? [y0] : [y0 + d, y0 - d]) {
        if (y < 1 || y > 254) continue;
        if (free(y) && STATE_SOLID[dim.getState(x, y - 1, z)]) return y;
      }
    return null;
  }
}
