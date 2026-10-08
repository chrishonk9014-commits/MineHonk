/** The Dragon tuning simulation (V6 phase 5): the classic fight against the fight with its additions. */
import { makeServer, join, tick } from '../helpers/testServer';
import { EndGenerator, exitPortalY } from '../../src/common/gen/end';
import { Random } from '../../src/common/math/rng';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

export interface SimResult {
  perches: number;
  /** Damage a player standing still takes per minute (nothing dodged: an upper bound). */
  dpm: number;
  minutes: number;
  stats: Record<string, number>;
}

/**
 * Runs the fight for `ticks` with one player standing still at `spot`
 * (distance from the portal along +x), additions on or off, both random
 * streams seeded so the two runs are comparable.
 */
export async function simulate(opts: { seed: string; rngSeed: number; additions: boolean; ticks: number; spot: number; breakCrystals?: number[] }): Promise<SimResult> {
  const { server } = await makeServer({ seed: opts.seed });
  // A real view distance: the island's edges are loaded (the Edge Strike needs to see them)
  const { player } = await join(server, 'Tester', 'uuid-tester', 8);
  server.changeDimension(player, 'end', 0.5, 100, 20.5);
  await settle(server, 20);
  const y0 = exitPortalY((player.dim.generator as EndGenerator).terrain);
  server.teleport(player, 0.5, y0 + 1, 20.5);
  await settle(server, 80);
  const fight = server.theEnd!.fight;
  (fight as unknown as { rng: Random }).rng = new Random(opts.rngSeed);
  fight.extras.rng = new Random(opts.rngSeed + 1);
  fight.extras.enabled = opts.additions;
  const dim = player.dim;
  const x = 0.5 + opts.spot;
  let gy = y0;
  for (let y = y0 + 12; y > y0 - 20; y--) {
    if (dim.getState(Math.floor(x), y, 0) !== 0) {
      gy = y + 1;
      break;
    }
  }
  const place = (p: ServerPlayer): void => server.teleport(p, x, gy, 0.5);
  place(player);
  player.spawnProtection = 0;
  let perches = 0;
  let classic = 0;
  let last = fight.phase;
  let dmg = 0;
  for (let t = 0; t < opts.ticks; t++) {
    // Crystals broken along the way (the one on the pillar along +x stays: the fury has a pillar to guard)
    if (opts.breakCrystals?.includes(t)) {
      const c = fight.crystals().filter((k) => k.x < 30).sort((p, q) => p.x - q.x)[0];
      c?.destroy(null);
    }
    tick(server, 1);
    dmg += Math.max(0, 20 - player.health);
    player.health = 20;
    player.dead = false;
    if (fight.phase === 'perch' && last !== 'perch') perches++;
    if ((fight.phase === 'strafe' || fight.phase === 'charge') && last !== fight.phase) classic++;
    last = fight.phase;
    if (Math.hypot(player.x - x, player.z - 0.5) > 0.5 || Math.abs(player.y - gy) > 1) place(player);
  }
  const minutes = opts.ticks / 1200;
  return { perches, dpm: dmg / minutes, minutes, stats: { ...fight.extras.stats, strafesAndCharges: classic } };
}
