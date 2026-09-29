/**
 * Block registry snapshots and state remapping for saved worlds.
 *
 * Chunks are saved with numeric state ids, which follow registration order.
 * Adding a block (or a property to a block) shifts every later id, so each
 * saved chunk records which registry it was written with. When that differs
 * from the running registry, its states are translated by block id and
 * property values ("stone" stays stone even if its number changed).
 *
 * Worlds saved before chunks carried a registry tag used the V1 registry,
 * whose snapshot is frozen in legacy/v1-blocks.json.
 */
import { blocks, blockById, stateCount } from './blocks';
import { hashString } from '../math/rng';
import V1 from './legacy/v1-blocks.json';

/** Compact registry description: shared property sets, then each block as id or [id, propSetIndices]. */
export interface RegistrySnapshot {
  props: [string, string[]][];
  blocks: (string | [string, number[]])[];
}

export const V1_SNAPSHOT = V1 as RegistrySnapshot;

let current: RegistrySnapshot | null = null;
let currentHash = 0;

/** Snapshot of the running block registry. */
export function currentSnapshot(): RegistrySnapshot {
  if (current) return current;
  const props: [string, string[]][] = [];
  const idx = new Map<string, number>();
  const list = blocks.map((b) => {
    const ps = b.propNames.map((n, i) => {
      const vals = b.propValues[i]!;
      const k = n + '=' + vals.join('|');
      let j = idx.get(k);
      if (j === undefined) {
        j = props.length;
        props.push([n, [...vals]]);
        idx.set(k, j);
      }
      return j;
    });
    return ps.length ? ([b.id, ps] as [string, number[]]) : b.id;
  });
  current = { props, blocks: list };
  return current;
}

/** Stable 32-bit identity of a snapshot (block ids and their property values, in order). */
export function snapshotHash(s: RegistrySnapshot): number {
  let str = '';
  for (const b of s.blocks) {
    if (typeof b === 'string') str += b + ';';
    else str += b[0] + '[' + b[1].map((i) => s.props[i]![0] + '=' + s.props[i]![1].join('|')).join(',') + '];';
  }
  return hashString(str);
}

export function currentHashValue(): number {
  if (!currentHash) currentHash = snapshotHash(currentSnapshot());
  return currentHash;
}

export const V1_HASH = snapshotHash(V1_SNAPSHOT);

/**
 * Old state id -> current state id for chunks written with `from`. Blocks
 * that no longer exist become air; properties that no longer exist are
 * dropped and new ones take their default. Returns null when nothing moves.
 */
export function buildRemap(from: RegistrySnapshot): Uint16Array | null {
  let total = 0;
  const sizes: number[] = [];
  for (const b of from.blocks) {
    let n = 1;
    if (typeof b !== 'string') for (const pi of b[1]) n *= from.props[pi]!.length ? from.props[pi]![1].length : 1;
    sizes.push(n);
    total += n;
  }
  const out = new Uint16Array(total);
  let identity = total === stateCount();
  let base = 0;
  from.blocks.forEach((b, bi) => {
    const id = typeof b === 'string' ? b : b[0];
    const ps = typeof b === 'string' ? [] : b[1].map((pi) => from.props[pi]!);
    const n = sizes[bi]!;
    const bt = blockById.get(id);
    // Mixed-radix strides, last property varies fastest (same as the registry).
    const strides: number[] = [];
    let s = 1;
    for (let i = ps.length - 1; i >= 0; i--) {
      strides[i] = s;
      s *= ps[i]![1].length;
    }
    for (let local = 0; local < n; local++) {
      let st = 0;
      if (bt) {
        st = bt.defaultState;
        for (let i = 0; i < ps.length; i++) {
          const [name, values] = ps[i]!;
          const v = values[Math.floor(local / strides[i]!) % values.length]!;
          const pi = bt.propNames.indexOf(name);
          if (pi < 0) continue;
          const vi = bt.propValues[pi]!.indexOf(v);
          if (vi < 0) continue;
          const cur = Math.floor((st - bt.baseState) / bt.propStrides[pi]!) % bt.propValues[pi]!.length;
          st += (vi - cur) * bt.propStrides[pi]!;
        }
      }
      out[base + local] = st;
      if (st !== base + local) identity = false;
    }
    base += n;
  });
  return identity ? null : out;
}

/** Applies a remap to a section in place. States beyond the old registry become air. */
export function remapSection(s: Uint16Array, remap: Uint16Array): void {
  for (let i = 0; i < s.length; i++) {
    const v = s[i]!;
    s[i] = v < remap.length ? remap[v]! : 0;
  }
}
