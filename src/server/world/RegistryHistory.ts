/**
 * Block registries a world's saved chunks were written with. Each saved chunk
 * names its registry by hash; this resolves the hash to a state remap for the
 * running game (none when the registry is unchanged).
 */
import type { WorldStorage } from '../storage/Storage';
import { buildRemap, currentHashValue, currentSnapshot, V1_HASH, V1_SNAPSHOT, type RegistrySnapshot } from '../../common/registry/palette';

const META_KEY = 'registries';

export class RegistryHistory {
  private known = new Map<number, RegistrySnapshot>();
  private readonly remaps = new Map<number, Uint16Array | null>();

  constructor(
    private readonly storage: WorldStorage,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.known.set(V1_HASH, V1_SNAPSHOT);
  }

  /** Loads the world's registry list and records the running registry in it. */
  async load(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this.storage.readMeta(META_KEY);
    } catch {
      raw = null;
    }
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const h = Number(k) >>> 0;
        if (v && typeof v === 'object' && Array.isArray((v as RegistrySnapshot).blocks) && Array.isArray((v as RegistrySnapshot).props)) this.known.set(h, v as RegistrySnapshot);
      }
    }
    const cur = currentHashValue();
    if (!this.known.has(cur) || !(raw && typeof raw === 'object' && String(cur) in (raw as object))) {
      this.known.set(cur, currentSnapshot());
      const out: Record<string, RegistrySnapshot> = {};
      for (const [h, s] of this.known) if (h !== V1_HASH || h === cur) out[String(h)] = s;
      try {
        await this.storage.writeMeta(META_KEY, out);
      } catch (e) {
        this.log(`[server] could not record the block registry: ${(e as Error).message}`);
      }
    }
  }

  /** State remap for chunks saved with registry `hash` (null: ids are already current). */
  remapFor(hash: number): Uint16Array | null {
    if (hash === currentHashValue()) return null;
    if (this.remaps.has(hash)) return this.remaps.get(hash)!;
    const snap = this.known.get(hash);
    let r: Uint16Array | null = null;
    if (snap) r = buildRemap(snap);
    else this.log(`[server] chunk saved with an unknown block registry (${hash.toString(16)}); reading it as current`);
    this.remaps.set(hash, r);
    return r;
  }
}

export { V1_HASH };
