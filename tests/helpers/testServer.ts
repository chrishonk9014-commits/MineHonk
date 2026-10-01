import { GameServer } from '../../src/server/GameServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import type { Connection } from '../../src/server/net/Connection';
import type { S2C, C2S } from '../../src/common/net/protocol';
import { PROTOCOL_VERSION } from '../../src/common/net/protocol';
import { initItems } from '../../src/common/registry/items';
import { registryHash } from '../../src/common/registry/hash';
import type { NewWorldOptions } from '../../src/server/world/LevelData';
import { installGameplay } from '../../src/server/gameplay';

initItems();

export class FakeConn implements Connection {
  readonly received: S2C[] = [];
  closed = false;
  constructor(readonly id: string) {}
  get remote(): string {
    return 'test';
  }
  send(msg: S2C): void {
    this.received.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.received.filter((m) => m.t === t) as Extract<S2C, { t: T }>[];
  }
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined {
    const l = this.of(t);
    return l[l.length - 1];
  }
}

export async function makeServer(opts: Partial<NewWorldOptions> = {}, storage = new MemoryStorage()): Promise<{ server: GameServer; storage: MemoryStorage }> {
  const server = await GameServer.open(storage, { id: 'test', name: 'Test', seed: 'test-seed', mode: 'survival', difficulty: 'normal', ...opts }, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
  installGameplay(server);
  // Tests control spawning explicitly
  server.level.rules.doMobSpawning = false;
  return { server, storage };
}

/** A world made with an older generator version (as if created before an update). */
export async function makeServerAt(version: number, opts: Partial<NewWorldOptions> = {}, storage = new MemoryStorage()): Promise<{ server: GameServer; storage: MemoryStorage }> {
  const first = await makeServer(opts, storage);
  await first.server.stop();
  (storage.level as { generatorVersion?: number }).generatorVersion = version;
  const server = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
  installGameplay(server);
  server.level.rules.doMobSpawning = false;
  return { server, storage };
}

export function hello(viewDistance = 3): C2S & { t: 'hello' } {
  return { t: 'hello', version: PROTOCOL_VERSION, name: 'Tester', viewDistance, registryHash: registryHash() };
}

/** Runs server ticks manually (without the real-time loop). */
export function tick(server: GameServer, n = 1): void {
  for (let i = 0; i < n; i++) (server as unknown as { tick(): void }).tick();
}

export async function join(server: GameServer, name = 'Tester', uuid = 'uuid-' + name, vd = 3): Promise<{ conn: FakeConn; player: NonNullable<Awaited<ReturnType<GameServer['connect']>>> }> {
  const conn = new FakeConn('c-' + name);
  (server as unknown as { running: boolean }).running = true;
  if (!server.level.spawn) {
    const s = server.overworld.generator.findSpawn();
    server.level.spawn = [s.x, s.y, s.z];
  }
  const player = await server.connect(conn, { uuid, name }, { ...hello(vd), name });
  if (!player) throw new Error('join failed: ' + JSON.stringify(conn.received));
  // let storage reads resolve and chunks generate
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 2);
  }
  // Under load, generation (time-budgeted) can lag: wait until the chunks around the player exist
  const loaded = (): boolean => {
    const cx = Math.floor(player.x) >> 4;
    const cz = Math.floor(player.z) >> 4;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!player.dim.getChunk(cx + dx, cz + dz)) return false;
    return true;
  };
  for (let i = 0; i < 400 && !loaded(); i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return { conn, player };
}
