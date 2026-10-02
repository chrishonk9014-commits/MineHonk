/** V6 phase 4 tests: a pad in the End's open void, and settling the server while chunks load. */
import { makeServer, join, tick, type FakeConn } from './testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { Dimension } from '../../src/server/world/Dimension';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { S } from '../../src/common/registry/blocks';

export async function settle(server: GameServer, rounds = 40, cond?: () => boolean): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    if (cond?.()) return true;
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return cond ? cond() : true;
}

export interface Pad {
  server: GameServer;
  storage: MemoryStorage;
  dim: Dimension;
  player: ServerPlayer;
  conn: FakeConn;
  X: number;
  Y: number;
  Z: number;
}

/**
 * A pad of end stone floating in the open void between the outer islands
 * and the Expanded End (nothing below it, far from the dragon).
 */
export async function endPad(seed = 'p4-eng', opts: Record<string, unknown> = {}, storage = new MemoryStorage(), at = { X: 0, Y: 150, Z: 5200 }): Promise<Pad> {
  const { server } = await makeServer({ seed, ...opts }, storage);
  const { player, conn } = await join(server);
  const { X, Y, Z } = at;
  server.changeDimension(player, 'end', X + 0.5, Y, Z + 0.5);
  const dim = server.dim('end');
  await settle(server, 600, () => [-48, 0, 48, 80].every((dx) => [-32, 0, 32].every((dz) => dim.isLoaded(X + dx, Z + dz))));
  for (let x = X - 8; x <= X + 8; x++) for (let z = Z - 8; z <= Z + 8; z++) dim.setBlock(x, Y - 1, z, S('end_stone'));
  server.teleport(player, X + 0.5, Y, Z + 0.5);
  player.spawnProtection = 0;
  return { server, storage, dim, player, conn, X, Y, Z };
}

