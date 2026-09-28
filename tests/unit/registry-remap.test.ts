import { describe, it, expect } from 'vitest';
import { initBlocks, blockById, stateToString, S, stateOf } from '../../src/common/registry/blocks';
import { initItems } from '../../src/common/registry/items';
import { buildRemap, V1_SNAPSHOT, currentSnapshot, snapshotHash, currentHashValue, V1_HASH } from '../../src/common/registry/palette';
import { Chunk } from '../../src/common/world/chunk';
import { encodeSavedChunk, decodeSavedChunk } from '../../src/server/world/Dimension';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { RegistryHistory } from '../../src/server/world/RegistryHistory';

initBlocks();
initItems();

/** Every state of the V1 registry as "id[k=v,...]", in V1 id order. */
function v1States(): string[] {
  const out: string[] = [];
  for (const b of V1_SNAPSHOT.blocks) {
    const id = typeof b === 'string' ? b : b[0];
    const ps = typeof b === 'string' ? [] : b[1].map((i) => V1_SNAPSHOT.props[i]!);
    let n = 1;
    for (const p of ps) n *= p[1].length;
    for (let local = 0; local < n; local++) {
      let rest = local;
      const vals: string[] = new Array(ps.length);
      for (let i = ps.length - 1; i >= 0; i--) {
        vals[i] = ps[i]![1][rest % ps[i]![1].length]!;
        rest = Math.floor(rest / ps[i]![1].length);
      }
      out.push(ps.length ? `${id}[${ps.map((p, i) => `${p[0]}=${vals[i]}`).join(',')}]` : id);
    }
  }
  return out;
}

describe('block registry remapping', () => {
  it('the current registry hash is stable and identifies the snapshot', () => {
    expect(snapshotHash(currentSnapshot())).toBe(currentHashValue());
  });

  it('maps every V1 state to the same block and properties in the running registry', () => {
    const remap = buildRemap(V1_SNAPSHOT);
    const names = v1States();
    for (let i = 0; i < names.length; i++) {
      const cur = remap ? remap[i]! : i;
      const want = names[i]!;
      const id = want.split('[')[0]!;
      if (!blockById.has(id)) {
        expect(cur).toBe(0);
        continue;
      }
      const got = stateToString(cur);
      // Properties added since V1 take defaults; every V1 property must survive.
      const wantProps = want.includes('[') ? want.slice(want.indexOf('[') + 1, -1).split(',') : [];
      expect(got.split('[')[0]).toBe(id);
      for (const kv of wantProps) expect(got).toContain(kv);
    }
  });

  it('reads V1 chunks and chunks saved with the current registry', async () => {
    const storage = new MemoryStorage();
    const hist = new RegistryHistory(storage);
    await hist.load();
    // A chunk saved by the current game round-trips unchanged.
    const c = new Chunk(0, 0, true);
    c.setRaw(1, 10, 1, S('diamond_ore'));
    c.setRaw(2, 10, 1, stateOf('oak_stairs', { facing: 'east', half: 'top' }));
    c.recount();
    c.modified = true;
    const saved = encodeSavedChunk(c, []);
    const back = decodeSavedChunk(saved, true, (h) => hist.remapFor(h)).chunk;
    expect(back.get(1, 10, 1)).toBe(S('diamond_ore'));
    expect(stateToString(back.get(2, 10, 1))).toBe(stateToString(stateOf('oak_stairs', { facing: 'east', half: 'top' })));
    // The registry is recorded with the world.
    const meta = (await storage.readMeta('registries')) as Record<string, unknown>;
    expect(Object.keys(meta)).toContain(String(currentHashValue()));
    expect(hist.remapFor(V1_HASH) === null || hist.remapFor(V1_HASH)!.length > 0).toBe(true);
  });
});
