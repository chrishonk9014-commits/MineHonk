/**
 * IndexedDB world storage for the browser integrated server.
 * Database layout (shared by all worlds):
 *   worlds:  worldId -> level data
 *   chunks:  "worldId/dim/cx,cz" -> compressed chunk bytes
 *   players: "worldId/uuid" -> player data
 *   meta:    "worldId/key" -> arbitrary data
 */
import type { WorldStorage } from './Storage';
import type { DimensionId } from '../../common/data/biomes';

const DB_NAME = 'minehonk';
const DB_VERSION = 1;
const STORES = ['worlds', 'chunks', 'players', 'meta'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export class IndexedDBStorage implements WorldStorage {
  constructor(readonly worldId: string) {}

  private async store(name: (typeof STORES)[number], mode: IDBTransactionMode): Promise<{ s: IDBObjectStore; tx: IDBTransaction }> {
    const db = await openDb();
    const tx = db.transaction(name, mode);
    return { s: tx.objectStore(name), tx };
  }

  async readLevel(): Promise<unknown | null> {
    const { s } = await this.store('worlds', 'readonly');
    return (await reqP(s.get(this.worldId))) ?? null;
  }

  async writeLevel(data: unknown): Promise<void> {
    const { s, tx } = await this.store('worlds', 'readwrite');
    s.put(data, this.worldId);
    await txDone(tx);
  }

  async readChunk(dim: DimensionId, cx: number, cz: number): Promise<Uint8Array | null> {
    const { s } = await this.store('chunks', 'readonly');
    const v = await reqP(s.get(`${this.worldId}/${dim}/${cx},${cz}`));
    return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
  }

  async writeChunks(dim: DimensionId, entries: { cx: number; cz: number; data: Uint8Array }[]): Promise<void> {
    if (entries.length === 0) return;
    const { s, tx } = await this.store('chunks', 'readwrite');
    for (const e of entries) s.put(e.data, `${this.worldId}/${dim}/${e.cx},${e.cz}`);
    await txDone(tx);
  }

  async readPlayer(uuid: string): Promise<unknown | null> {
    const { s } = await this.store('players', 'readonly');
    return (await reqP(s.get(`${this.worldId}/${uuid}`))) ?? null;
  }

  async writePlayer(uuid: string, data: unknown): Promise<void> {
    const { s, tx } = await this.store('players', 'readwrite');
    s.put(data, `${this.worldId}/${uuid}`);
    await txDone(tx);
  }

  async readMeta(key: string): Promise<unknown | null> {
    const { s } = await this.store('meta', 'readonly');
    return (await reqP(s.get(`${this.worldId}/${key}`))) ?? null;
  }

  async writeMeta(key: string, data: unknown): Promise<void> {
    const { s, tx } = await this.store('meta', 'readwrite');
    s.put(data, `${this.worldId}/${key}`);
    await txDone(tx);
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Lists all saved worlds (level data objects). */
export async function listWorlds(): Promise<Record<string, unknown>[]> {
  const db = await openDb();
  const tx = db.transaction('worlds', 'readonly');
  const s = tx.objectStore('worlds');
  const [keys, values] = await Promise.all([reqP(s.getAllKeys()), reqP(s.getAll())]);
  return values.map((v, i) => ({ ...(v as Record<string, unknown>), id: String(keys[i]) }));
}

/** Deletes a world and all of its chunks, players and metadata. */
export async function deleteWorld(worldId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['worlds', 'chunks', 'players', 'meta'], 'readwrite');
  tx.objectStore('worlds').delete(worldId);
  const range = IDBKeyRange.bound(worldId + '/', worldId + '/￿');
  for (const s of ['chunks', 'players', 'meta'] as const) tx.objectStore(s).delete(range);
  await txDone(tx);
}

export async function updateWorld(worldId: string, patch: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('worlds', 'readwrite');
  const s = tx.objectStore('worlds');
  const cur = (await reqP(s.get(worldId))) as Record<string, unknown> | undefined;
  if (cur) s.put({ ...cur, ...patch }, worldId);
  await txDone(tx);
}

/** Exports a world's full data (for backups / uploading to a server). */
export async function exportWorld(worldId: string): Promise<{ level: unknown; chunks: [string, Uint8Array][]; players: [string, unknown][]; meta: [string, unknown][] }> {
  const db = await openDb();
  const tx = db.transaction(['worlds', 'chunks', 'players', 'meta'], 'readonly');
  const range = IDBKeyRange.bound(worldId + '/', worldId + '/￿');
  const level = await reqP(tx.objectStore('worlds').get(worldId));
  const collect = async <T>(name: 'chunks' | 'players' | 'meta'): Promise<[string, T][]> => {
    const s = tx.objectStore(name);
    const [k, v] = await Promise.all([reqP(s.getAllKeys(range)), reqP(s.getAll(range))]);
    return k.map((key, i) => [String(key).slice(worldId.length + 1), v[i] as T]);
  };
  return { level, chunks: await collect<Uint8Array>('chunks'), players: await collect('players'), meta: await collect('meta') };
}

export async function importWorld(worldId: string, data: { level: unknown; chunks: [string, Uint8Array][]; players: [string, unknown][]; meta: [string, unknown][] }): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['worlds', 'chunks', 'players', 'meta'], 'readwrite');
  tx.objectStore('worlds').put({ ...(data.level as object), id: worldId }, worldId);
  for (const [k, v] of data.chunks) tx.objectStore('chunks').put(v, `${worldId}/${k}`);
  for (const [k, v] of data.players) tx.objectStore('players').put(v, `${worldId}/${k}`);
  for (const [k, v] of data.meta) tx.objectStore('meta').put(v, `${worldId}/${k}`);
  await txDone(tx);
}
