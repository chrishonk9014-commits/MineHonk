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
import { BrowserHost, type HostConfig, type HostOptionsPatch } from './hosting';
import type { HostSettingsPush } from '../common/net/hubProtocol';

initItems();

let server: GameServer | null = null;
const post = (m: unknown, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);
/** Other players joining through the page (browser hosting). */
const host = new BrowserHost(
  () => server,
  (m, transfer) => post(m, transfer ?? []),
);

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
  | { type: 'save' }
  | { type: 'host'; config: HostConfig }
  | { type: 'unhost'; reason?: string }
  | { type: 'remote_open'; cid: number; remote: string }
  | { type: 'remote_data'; cid: number; piece: Uint8Array }
  | { type: 'remote_close'; cid: number }
  | { type: 'remote_buffered'; cid: number; bytes: number }
  | { type: 'host_settings'; settings: HostSettingsPush }
  | { type: 'host_options'; options: HostOptionsPatch };

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
          // Browsers can close tabs abruptly: save every minute
          autosaveTicks: 20 * 60,
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
        // Only meaningful for the single player integrated server (a hosted world never pauses)
        if (server && server.players.size <= 1 && !host.hosting) server.paused = !!m.paused;
        break;
      case 'host':
        await host.start(m.config);
        post({ type: 'hosting', on: true });
        break;
      case 'unhost':
        host.stop(m.reason);
        post({ type: 'hosting', on: false });
        break;
      case 'remote_open':
        host.open(m.cid, m.remote);
        break;
      case 'remote_data':
        host.data(m.cid, m.piece);
        break;
      case 'remote_close':
        host.close(m.cid);
        break;
      case 'remote_buffered':
        host.buffered(m.cid, m.bytes);
        break;
      case 'host_settings':
        host.applySettings(m.settings);
        break;
      case 'host_options':
        host.applyOptions(m.options);
        break;
      case 'save':
        if (server) await server.saveAll().catch((e) => server?.saveFailed(e));
        post({ type: 'saved' });
        break;
      case 'stop':
        host.stop('The host left the game');
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
