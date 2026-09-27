import { describe, it, expect } from 'vitest';
import { initBlocks, blocks, stateCount, S, getProp, withProp, stateOf, stateToString, stateFromString, STATE_OPAQUE, getBlock } from '../../src/common/registry/blocks';
import { initItems, items, getItem } from '../../src/common/registry/items';

describe('block registry', () => {
  initBlocks();
  initItems();
  it('registers blocks with unique states', () => {
    expect(blocks.length).toBeGreaterThan(300);
    expect(stateCount()).toBeLessThan(65536);
    expect(S('air')).toBe(0);
  });
  it('encodes/decodes properties', () => {
    const s = stateOf('oak_door', { facing: 'east', half: 'upper', open: true, hinge: 'right' });
    expect(getProp(s, 'facing')).toBe('east');
    expect(getProp(s, 'half')).toBe('upper');
    expect(getProp(s, 'open')).toBe('true');
    expect(getProp(s, 'hinge')).toBe('right');
    const s2 = withProp(s, 'open', false);
    expect(getProp(s2, 'open')).toBe('false');
    expect(getProp(s2, 'facing')).toBe('east');
    expect(stateFromString(stateToString(s))).toBe(s);
  });
  it('flags opaque cubes', () => {
    expect(STATE_OPAQUE[S('stone')]).toBe(1);
    expect(STATE_OPAQUE[S('glass')]).toBe(0);
    expect(STATE_OPAQUE[S('oak_leaves')]).toBe(0);
    expect(STATE_OPAQUE[stateOf('stone_slab', { type: 'double' })]).toBe(1);
  });
  it('registers items for blocks and explicit items', () => {
    expect(items.length).toBeGreaterThan(500);
    expect(getItem('stone').def.block).toBe('stone');
    expect(getItem('torch').def.wallBlock).toBe('wall_torch');
    expect(getItem('diamond_pickaxe').def.tool?.tier).toBe(3);
    expect(getBlock('grass_block').def.tint).toBe('grass');
  });
});

import { chunkIndex, chunkIndexX, chunkIndexZ } from '../../src/common/world/constants';
describe('chunk keys', () => {
  it('round trips and never collides near the border', () => {
    const pts = [[0, 0], [12, -1], [12, 0], [-1875000, 1875000], [1875000, -1875000], [-5, -5]];
    const seen = new Set<number>();
    for (const [x, z] of pts) {
      const k = chunkIndex(x!, z!);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      expect(chunkIndexX(k)).toBe(x);
      expect(chunkIndexZ(k)).toBe(z);
    }
  });
});

import { collisionShape, edgeBox } from '../../src/common/physics/shapes';
import { stateOf as st } from '../../src/common/registry/blocks';
describe('shapes', () => {
  it('edge boxes land on the requested side', () => {
    expect(edgeBox('north', 3)[2]).toBe(0);
    expect(edgeBox('south', 3)[5]).toBe(1);
    expect(edgeBox('west', 3)[0]).toBe(0);
    expect(edgeBox('west', 3)[3]).toBeCloseTo(3 / 16);
    expect(edgeBox('east', 3)[0]).toBeCloseTo(13 / 16);
  });
  it('closed door facing east sits on the west edge', () => {
    const s = collisionShape(st('oak_door', { facing: 'east', open: false }));
    expect(s[0]![0]).toBe(0);
    expect(s[0]![3]).toBeCloseTo(3 / 16);
  });
  it('bottom slab is half height', () => {
    expect(collisionShape(st('stone_slab'))[0]![4]).toBe(0.5);
  });
});
