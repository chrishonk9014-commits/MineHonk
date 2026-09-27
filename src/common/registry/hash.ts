/** Stable hash of registry contents; clients with different content are rejected. */
import { blocks, stateCount } from './blocks';
import { items } from './items';
import { hashString } from '../math/rng';

let cached: string | null = null;
export function registryHash(): string {
  if (cached) return cached;
  let s = `${stateCount()}|${items.length}|`;
  for (const b of blocks) s += b.id + ':' + b.stateCount + ',';
  for (const it of items) s += it.id + ',';
  cached = hashString(s).toString(16) + '-' + blocks.length + '-' + items.length;
  return cached;
}
