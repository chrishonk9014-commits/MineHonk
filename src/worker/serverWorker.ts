/// <reference lib="webworker" />
/**
 * Integrated server: runs the authoritative GameServer inside a Web Worker
 * for single player. The main thread talks to it through postMessage using
 * exactly the same protocol as a remote server.
 */
import { GameServer } from '../server/GameServer';
import { IndexedDBStorage } from '../server/storage/IndexedDBStorage';
import type { Connection, Identity } from '../server/net/Connection';
import type { S2C, C2S } from '../common/net/protocol';
import type { NewWorldOptions } from '../server/world/LevelData';
import { initItems } from '../common/registry/items';
import { installGameplay } from '../server/gameplay';

initItems();

let server: GameServer | null = null;
const post = (m: unknown, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);

const conn: Connection = {
  id: 'local',
  remote: 'local',
  send(msg: S2C) {
    const transfer: Transferable[] = [];
    if (msg.t === 'chunk' || msg.t === 'light') transfer.push(msg.data.buffer as ArrayBuffer);
    post({ type: 's2c', msg }, transfer);
  },
  close() {
    post({ type: 'closed' });
  },
};

type In =
  | { type: 'start'; worldId: string; create: NewWorldOptions | null; identity: Identity; hello: C2S & { t: 'hello' }; viewDistance: number }
  | { type: 'c2s'; msg: unknown }
  | { type: 'stop' }
  | { type: 'pause'; paused: boolean }
  | { type: 'save' };

self.onmessage = async (ev: MessageEvent<In>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'start': {
        const storage = new IndexedDBStorage(m.worldId);
        server = await GameServer.open(storage, m.create, {
          log: (s) => post({ type: 'log', text: s }),
          chunksPerTick: 16,
          genBudgetMs: 30,
          maxViewDistance: 32,
          maxPlayers: 1,
        });
        installGameplay(server);
        server.start();
        post({ type: 'started', level: server.level });
        const p = await server.connect(conn, { ...m.identity, isHost: true }, m.hello);
        if (!p) post({ type: 'error', message: 'Could not join world' });
        break;
      }
      case 'c2s':
        if (server) server.handle(conn, m.msg);
        break;
      case 'pause':
        // Only meaningful for the single player integrated server
        if (server && server.players.size <= 1) server.paused = !!m.paused;
        break;
      case 'save':
        if (server) await server.saveAll();
        post({ type: 'saved' });
        break;
      case 'stop':
        if (server) {
          await server.stop();
          server = null;
        }
        post({ type: 'stopped' });
        break;
    }
  } catch (e) {
    post({ type: 'error', message: (e as Error).message, stack: (e as Error).stack });
  }
};
