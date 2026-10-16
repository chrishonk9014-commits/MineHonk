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
 *   each pumpkin, and the season tests: the Halloween content forced on or
 *   off, and a simulated date just before or just after the cutoff. They are
 *   never saved (they end when the world closes) and change nothing about the
 *   world's own setting. Everything the tab does is a cheat.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import type { Chunk } from '../../common/world/chunk';
import { halloweenReasonText, halloweenState, seasonWindowFor, simulatedDateStart, NO_TESTS, HALLOWEEN_CONTENT_TEST_NAMES, HALLOWEEN_DATE_TEST_NAMES, type HalloweenContentTest, type HalloweenDateTest, type HalloweenState, type HalloweenTests } from '../../common/halloween/season';
import { DIMENSION_PUMPKINS, decoratePumpkins } from '../../common/halloween/pumpkins';
import { STATE_REPLACEABLE, STATE_SOLID, STATE_FLUID, stateOf } from '../../common/registry/blocks';
import type { HalloweenOp, HalloweenStatus } from '../../common/game/admin';
import type { CandyKind } from '../../common/halloween/candy';
import type { TrickKind } from '../../common/halloween/trickOrTreat';

/** How often (ticks) the season is looked at again. */
const CHECK_TICKS = 20;

export class HalloweenSystem {
  /** The Admin Panel's season tests (never saved: a new server for the world starts without them). */
  readonly tests: HalloweenTests = { ...NO_TESTS };
  /** Under a date test: the simulated date minus the real one (ms). */
  private dateOffset = 0;
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
    return `${s.active}:${s.reason}:${s.inSeason}:${s.content}:${s.date}`;
  }

  get state(): HalloweenState {
    return this.server.halloweenState();
  }

  /** The date this world goes by: the server's clock, or the simulated date of a date test (it runs on). */
  now(): number {
    return this.server.clock() + (this.tests.date === 'real' ? 0 : this.dateOffset);
  }

  /** The answer without the Admin Panel's tests. */
  get realState(): HalloweenState {
    return halloweenState(this.server.clock(), this.server.level.halloween);
  }

  /** Only a test makes it Halloween here now: whatever comes of it is cheat-made. */
  get onByTest(): boolean {
    return this.state.active && !this.realState.active;
  }

  /** Sets either test (or both); the other stays as it is. Everyone hears at once if the answer changes. */
  setTests(content?: HalloweenContentTest, date?: HalloweenDateTest): void {
    if (content !== undefined) this.tests.content = content;
    if (date !== undefined) {
      this.tests.date = date;
      const real = this.server.clock();
      this.dateOffset = simulatedDateStart(date, real) - real;
    }
    this.syncIfChanged();
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
    // Only an Admin Panel test made it Halloween here: what it grew is cheat-made
    if (this.onByTest) this.server.admin.setBlockMark(dim, spot.x, spot.y, spot.z, true);
    return 1;
  }

  status(): HalloweenStatus {
    const s = this.state;
    const now = this.now();
    const w = seasonWindowFor(now);
    return { state: s, text: halloweenReasonText(s, now), endsAt: w.until, now, realNow: this.server.clock(), season: w.name, endsText: w.untilText, placed: this.placed };
  }

  admin(p: ServerPlayer, op: HalloweenOp, pumpkin?: string, content?: HalloweenContentTest, date?: HalloweenDateTest, door?: number, candy?: CandyKind, trick?: TrickKind): { ok: boolean; text: string; data?: unknown } {
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
      case 'spawn_trick_village':
      case 'spawn_abandoned_village': {
        if (!this.server.villages) return reply(false, 'Villages are not available.');
        const r = this.server.villages.spawnAt(p, op === 'spawn_trick_village' ? 'trick' : 'abandoned');
        return reply(r.ok, r.text);
      }
      case 'village_doors': {
        const info = this.server.villages?.doorsNear(p) ?? null;
        if (!info) return { ok: false, text: p.dim.id !== 'overworld' ? 'Trick-or-Treat Villages are in the Overworld.' : 'No Trick-or-Treat Village nearby.', data: { doors: null } };
        const tricks = info.doors.filter((d) => d.kind === 'trick').length;
        return { ok: true, text: `Nearest Trick-or-Treat Village: ${info.distance} blocks away, ${info.doors.length} doors, ${tricks} Trick Homes.`, data: { doors: info } };
      }
      case 'door_tp': {
        const info = this.server.villages?.doorsNear(p);
        const d = info?.doors.find((x) => x.id === door);
        if (!info || !d) return reply(false, 'That door is not there any more.');
        this.server.admin.moveTo(p, 'overworld', d.out[0] + 0.5, d.out[1], d.out[2] + 0.5);
        return reply(true, `At door ${d.id + 1} (${d.design}): a ${d.kind === 'trick' ? 'Trick' : 'Candy'} Home.`);
      }
      // V7 phase 3: trick-or-treating (cheat-made, and never using up a real door)
      case 'give_sack':
      case 'give_full_sack':
      case 'give_candy': {
        const tt = this.server.trickOrTreat;
        if (!tt) return reply(false, 'Trick-or-treating is not available.');
        const r = tt.adminGive(p, op === 'give_sack' ? 'sack' : op === 'give_full_sack' ? 'full_sack' : candy ?? 'regular');
        return reply(r.ok, r.text);
      }
      case 'knock': {
        const r = this.server.trickOrTreat?.adminKnock(p) ?? { ok: false, text: 'Trick-or-treating is not available.' };
        return reply(r.ok, r.text);
      }
      case 'trick': {
        const r = this.server.trickOrTreat?.adminTrick(p, trick ?? 'zombie_villagers') ?? { ok: false, text: 'Trick-or-treating is not available.' };
        return reply(r.ok, r.text);
      }
      case 'reset_doors': {
        const r = this.server.trickOrTreat?.adminReset(p) ?? { ok: false, text: 'Trick-or-treating is not available.' };
        return reply(r.ok, r.text);
      }
      case 'test': {
        this.setTests(content, date);
        const s = this.state;
        const t = this.tests;
        const what = t.content === 'real' && t.date === 'real' ? 'No tests' : `Content: ${HALLOWEEN_CONTENT_TEST_NAMES[t.content]}. Date: ${HALLOWEEN_DATE_TEST_NAMES[t.date]}`;
        return reply(true, `${what}. Halloween content is ${s.active ? 'on' : 'off'} here${t.content === 'real' && t.date === 'real' ? '' : ' until the world closes (never saved)'}.`);
      }
      case 'quest': {
        const q = this.server.trickOrTreat?.questStatus(p) ?? null;
        return { ok: !!q, text: q ? '' : 'Trick-or-treating is not available.', data: { ...this.status(), quest: q } };
      }
      case 'quest_reset': {
        const tt = this.server.trickOrTreat;
        if (!tt) return reply(false, 'Trick-or-treating is not available.');
        tt.resetQuest(p);
        return { ok: true, text: 'Your Trick or Treat! quest starts again from the first step (advancements you have stay).', data: { ...this.status(), quest: tt.questStatus(p) } };
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
