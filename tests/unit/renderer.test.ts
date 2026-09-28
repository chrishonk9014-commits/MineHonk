/**
 * Chunk meshing optimisations: greedy face merging must look identical to
 * one quad per block face, hidden faces must be skipped, quads must be
 * grouped by the direction they face, and the section visibility data must
 * describe which faces are connected.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { initItems } from '../../src/common/registry/items';
import { FACE_GROUPS, GROUP_OTHER, Mesher, PAD, padIndex, SOLID_UNKNOWN, U16_PER_VERTEX, U8_PER_VERTEX, VIS_ALL, facingGroup, visConnected, type LayerMesh, type MeshInput } from '../../src/client/render/mesher';
import { createGenerator } from '../../src/common/gen/generator';
import { PAGE_QUADS, RegionLayer } from '../../src/client/render/ChunkRenderer';
import { lightChange } from '../../src/client/world/ClientWorld';
import { LightEngine } from '../../src/common/world/light';
import { chunkIndex } from '../../src/common/world/constants';
import type { Chunk } from '../../src/common/world/chunk';
import { stateFromString } from '../../src/common/registry/blocks';

initItems();
const atlas = JSON.parse(fs.readFileSync('public/assets/blocks.json', 'utf8'));

function sectionInput(chunks: Map<number, Chunk>, cx: number, sy: number, cz: number): MeshInput {
  const blocks = new Uint16Array(PAD ** 3);
  const light = new Uint8Array(PAD ** 3);
  for (let y = -1; y <= 16; y++)
    for (let z = -1; z <= 16; z++)
      for (let x = -1; x <= 16; x++) {
        const wx = cx * 16 + x;
        const wz = cz * 16 + z;
        const wy = sy * 16 + y;
        const c = chunks.get(chunkIndex(wx >> 4, wz >> 4));
        if (!c || wy < 0 || wy > 255) {
          light[padIndex(x, y, z)] = 0xf0;
          continue;
        }
        blocks[padIndex(x, y, z)] = c.get(wx & 15, wy, wz & 15);
        light[padIndex(x, y, z)] = c.getLight(wx & 15, wy, wz & 15);
      }
  return { blocks, light, tints: new Uint8Array(PAD * PAD * 9).fill(128), fancyLeaves: true, smoothLighting: true };
}

/**
 * Expands a layer into unit faces: for every block face covered, the texture
 * tile, local texture coordinates at its corners, colour and light. Merged
 * and unmerged meshes must produce the same multiset.
 */
function unitFaces(l: LayerMesh): string[] {
  const out: string[] = [];
  for (let q = 0; q < l.quads; q++) {
    const v = (k: number) => {
      const o = (q * 4 + k) * U16_PER_VERTEX;
      const p = (q * 4 + k) * U8_PER_VERTEX;
      return {
        pos: [l.u16[o]! / 256, l.u16[o + 1]! / 256, l.u16[o + 2]! / 256],
        size: [l.u16[o + 3]! & 31, l.u16[o + 3]! >> 5],
        uv: [l.u16[o + 4]! / 256, l.u16[o + 5]! / 256],
        tile: [l.u16[o + 6]!, l.u16[o + 7]!],
        col: [...l.u8.subarray(p, p + 8)],
      };
    };
    const vs = [v(0), v(1), v(2), v(3)];
    const [su, sv] = vs[0]!.size;
    if (su === 1 && sv === 1) {
      // Single faces: record each corner as emitted (sorted, so corner order doesn't matter)
      const corners = vs.map((c) => `${c.pos.map((n) => n.toFixed(3))}|${c.uv.map((n) => n.toFixed(3))}|${c.col}`).sort();
      out.push(`${vs[0]!.tile}|${corners.join(';')}`);
      continue;
    }
    // Merged face: split into unit cells by interpolating position and uv over the rectangle
    const p0 = vs[0]!;
    const p1 = vs[1]!; // + v direction
    const p3 = vs[3]!; // + u direction
    for (let i = 0; i < su; i++)
      for (let j = 0; j < sv; j++) {
        const corners: string[] = [];
        for (const [a, b] of [
          [i, j],
          [i, j + 1],
          [i + 1, j + 1],
          [i + 1, j],
        ] as const) {
          const pos = [0, 1, 2].map((d) => p0.pos[d]! + ((p3.pos[d]! - p0.pos[d]!) * a) / su + ((p1.pos[d]! - p0.pos[d]!) * b) / sv);
          // Tile-local uv: the cell's own corner, relative to the cell's minimum
          const uv = [a - i, b - j];
          corners.push(`${pos.map((n) => n.toFixed(3))}|${uv.map((n) => n.toFixed(3))}|${p0.col}`);
        }
        out.push(`${p0.tile}|${corners.sort().join(';')}`);
      }
  }
  return out.sort();
}

function terrain(): Map<number, Chunk> {
  const gen = createGenerator('overworld', 1234);
  const chunks = new Map<number, Chunk>();
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) chunks.set(chunkIndex(dx, dz), gen.generate(dx, dz));
  const light = new LightEngine({ getChunk: (x, z) => chunks.get(chunkIndex(x, z)), markLightDirty: () => {} }, true);
  for (const c of chunks.values()) light.initChunk(c);
  return chunks;
}

describe('greedy meshing', () => {
  const chunks = terrain();
  const greedy = new Mesher(atlas);
  const plain = new Mesher(atlas);
  plain.greedy = false;

  it('covers exactly the same faces with the same texture, light and colour', () => {
    let before = 0;
    let after = 0;
    for (let sy = 0; sy < 8; sy++) {
      const input = sectionInput(chunks, 0, sy, 0);
      const a = plain.mesh({ ...input, blocks: input.blocks.slice(), light: input.light.slice() });
      const b = greedy.mesh(input);
      for (let li = 1; li < 4; li++) {
        before += a.layers[li]!.quads;
        after += b.layers[li]!.quads;
        expect(unitFaces(b.layers[li]!)).toEqual(unitFaces(a.layers[li]!));
      }
    }
    console.log(`greedy meshing: ${before} -> ${after} quads (${((1 - after / before) * 100).toFixed(0)}% fewer)`);
    expect(after).toBeLessThan(before * 0.95);
  });

  it('merges a flat floor into one quad per face direction', () => {
    const blocks = new Uint16Array(PAD ** 3);
    const light = new Uint8Array(PAD ** 3).fill(0xf0);
    const stone = stateFromString('stone');
    for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) blocks[padIndex(x, 0, z)] = stone;
    const out = greedy.mesh({ blocks, light, tints: new Uint8Array(PAD * PAD * 9), fancyLeaves: false, smoothLighting: true });
    // Top face only (sides touch neighbouring stone, the bottom faces air below: 2 quads)
    expect(out.layers[1]!.quads).toBe(2);
  });
});

describe('hidden faces', () => {
  it('skips faces towards unloaded chunks and below the world', () => {
    const mesher = new Mesher(atlas);
    const stone = stateFromString('stone');
    const blocks = new Uint16Array(PAD ** 3);
    const light = new Uint8Array(PAD ** 3).fill(0xf0);
    for (let y = -1; y <= 16; y++)
      for (let z = -1; z <= 16; z++)
        for (let x = -1; x <= 16; x++) {
          const inside = x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < 8;
          blocks[padIndex(x, y, z)] = inside ? stone : y < 0 || x < 0 || x > 15 || z < 0 || z > 15 ? SOLID_UNKNOWN : 0;
        }
    const out = mesher.mesh({ blocks, light, tints: new Uint8Array(PAD * PAD * 9), fancyLeaves: false, smoothLighting: true });
    // Only the top of the 16x8x16 slab is visible
    expect(out.layers[1]!.quads).toBe(1);
  });
});

describe('section visibility', () => {
  const mesher = new Mesher(atlas);
  const stone = stateFromString('stone');
  const mk = (fill: (x: number, y: number, z: number) => boolean) => {
    const blocks = new Uint16Array(PAD ** 3);
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (fill(x, y, z)) blocks[padIndex(x, y, z)] = stone;
    return mesher.mesh({ blocks, light: new Uint8Array(PAD ** 3), tints: new Uint8Array(PAD * PAD * 9), fancyLeaves: false, smoothLighting: false }).vis;
  };

  it('treats empty sections as open and solid ones as closed', () => {
    expect(mk(() => false)).toBe(VIS_ALL);
    expect(mk(() => true)).toBe(0);
  });

  it('connects the faces a tunnel opens onto', () => {
    // A tunnel from west (x=0) to east (x=15) at y=8, z=8 through solid stone
    const vis = mk((x, y, z) => !(y === 8 && z === 8));
    expect(visConnected(vis, 4, 5)).toBe(true);
    expect(visConnected(vis, 0, 1)).toBe(false);
    expect(visConnected(vis, 4, 1)).toBe(false);
    // A shaft from the top down to the tunnel connects up with west and east
    const vis2 = mk((x, y, z) => !((y === 8 && z === 8) || (x === 3 && z === 8 && y >= 8)));
    expect(visConnected(vis2, 1, 4)).toBe(true);
    expect(visConnected(vis2, 1, 5)).toBe(true);
    expect(visConnected(vis2, 0, 1)).toBe(false);
  });
});

describe('facing groups', () => {
  const chunks = terrain();
  const mesher = new Mesher(atlas);
  const quadPos = (l: LayerMesh, q: number): number[] => {
    const p: number[] = [];
    for (let k = 0; k < 3; k++) {
      const o = (q * 4 + k) * U16_PER_VERTEX;
      p.push(l.u16[o]! / 256, l.u16[o + 1]! / 256, l.u16[o + 2]! / 256);
    }
    return p;
  };

  it('stores quads in group order and each group matches the winding normal', () => {
    let checked = 0;
    let other = 0;
    for (let sy = 0; sy < 8; sy++) {
      const out = mesher.mesh(sectionInput(chunks, 0, sy, 0));
      for (let li = 1; li < 4; li++) {
        const l = out.layers[li]!;
        expect(l.groups).toHaveLength(FACE_GROUPS);
        expect(l.groups.reduce((a, b) => a + b, 0)).toBe(l.quads);
        let q = 0;
        for (let g = 0; g < FACE_GROUPS; g++)
          for (let i = 0; i < l.groups[g]!; i++, q++) {
            const actual = facingGroup(quadPos(l, q));
            // Axis groups must be exact; "other" may also hold axis-aligned quads (e.g. a flat piece of a sloped model)
            if (g !== GROUP_OTHER) expect(actual).toBe(g);
            else other++;
            checked++;
          }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    console.log(`facing groups: ${checked} quads checked, ${other} in "other"`);
  });

  it('puts sloped water surfaces in the "other" group and flat ones facing up', () => {
    const water = stateFromString('water');
    const flowing = stateFromString('water[level=3]');
    const blocks = new Uint16Array(PAD ** 3);
    const light = new Uint8Array(PAD ** 3).fill(0xf0);
    blocks[padIndex(4, 4, 4)] = water;
    blocks[padIndex(8, 4, 8)] = water;
    blocks[padIndex(9, 4, 8)] = flowing;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[padIndex(x, 3, z)] = stateFromString('stone');
    const l = mesher.mesh({ blocks, light, tints: new Uint8Array(PAD * PAD * 9), fancyLeaves: false, smoothLighting: true }).layers[3]!;
    expect(l.groups[1]).toBeGreaterThan(0); // flat top of the lone source
    expect(l.groups[GROUP_OTHER]).toBeGreaterThan(0); // the slope between source and flow
  });
});

describe('region buffer pages', () => {
  const owner = {
    ensureIndex: () => {},
    index: new THREE.BufferAttribute(new Uint32Array(6), 1),
    materials: [0, 1, 2, 3].map(() => new THREE.ShaderMaterial()),
    group: new THREE.Group(),
  };
  const page = () => new RegionLayer(owner, { rx: 0, ry: 0, rz: 0 }, 1);

  it('grows geometrically up to the page size, then refuses', () => {
    const p = page();
    const caps: number[] = [];
    let got = 0;
    for (;;) {
      const s = p.alloc(1000);
      if (!s) break;
      expect(s.page).toBe(p);
      got += 1000;
      if (caps[caps.length - 1] !== p.capacity) caps.push(p.capacity);
    }
    expect(got).toBeLessThanOrEqual(PAGE_QUADS);
    expect(got).toBeGreaterThan(PAGE_QUADS - 1000);
    expect(p.capacity).toBe(PAGE_QUADS);
    // Few resizes: each at least doubles
    for (let i = 1; i < caps.length - 1; i++) expect(caps[i]!).toBeGreaterThanOrEqual(caps[i - 1]! * 2);
    expect(caps.length).toBeLessThanOrEqual(6);
  });

  it('gives an empty page an oversized section and reuses freed ranges', () => {
    const big = page();
    expect(big.alloc(PAGE_QUADS + 500)).not.toBeNull();
    const p = page();
    const a = p.alloc(100)!;
    const b = p.alloc(200)!;
    const c = p.alloc(300)!;
    p.release(a);
    p.release(b);
    // a and b merge into one free range at the start
    expect(p.freeRanges[0]).toEqual({ start: 0, quads: 300 });
    const d = p.alloc(250)!;
    expect(d.start).toBe(0);
    expect(p.used).toBe(550);
    p.release(c);
    p.release(d);
    expect(p.used).toBe(0);
  });
});

describe('light change detection', () => {
  const at = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x;
  it('ignores identical light and reports which boundaries changed', () => {
    const a = new Uint8Array(4096).fill(0xf0);
    expect(lightChange(a, a.slice(), 0xf0)).toBe(-1);
    expect(lightChange(null, a, 0xf0)).toBe(-1); // null means "all default"
    expect(lightChange(null, null, 0)).toBe(-1);
    const inner = a.slice();
    inner[at(5, 6, 7)] = 0x30;
    expect(lightChange(a, inner, 0xf0)).toBe(0);
    const east = a.slice();
    east[at(15, 6, 7)] = 0x30;
    expect(lightChange(a, east, 0xf0)).toBe(32);
    const corner = a.slice();
    corner[at(0, 0, 0)] = 0;
    expect(lightChange(a, corner, 0xf0)).toBe(1 | 4 | 16);
    expect(lightChange(null, corner, 0xf0)).toBe(1 | 4 | 16);
  });
});
