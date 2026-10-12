/**
 * Chunk section mesher. Operates on a padded 18^3 copy of the section so that
 * neighbour lookups never cross chunk objects.
 *
 * Output is compact interleaved vertex data (see VERTEX FORMAT below). With
 * greedy meshing on, full cube faces whose four corners share the same light,
 * ambient occlusion and tint are merged into larger rectangles and the texture
 * repeats across them in the shader. It is off in the game (see
 * GREEDY_MESHING in ChunkRenderer): merged faces meet their neighbours in
 * T-junctions, which leave single-pixel cracks at a distance. Each layer's quads are grouped by the direction they face
 * so the renderer can skip groups that face away from the camera. The mesher
 * also reports which faces of the section are connected through open space,
 * used for cave/occlusion culling.
 */
import { STATE_OPAQUE, STATE_LAYER, STATE_BLOCK, STATE_FLUID, STATE_SOLID, getProp, initBlocks } from '../../common/registry/blocks';
import { bakedModels, ModelKind, type BakedModel } from './models';
import { AtlasLookup, type AtlasMeta } from './atlasInfo';
import type { TintKind } from '../../common/registry/blockTypes';

export const PAD = 18;
export const padIndex = (x: number, y: number, z: number): number => ((y + 1) * PAD + (z + 1)) * PAD + (x + 1);
/** Block value for cells in unloaded chunks or below the world: hides faces towards them. */
export const SOLID_UNKNOWN = 0xffff;

/*
 * VERTEX FORMAT (per vertex, two interleaved streams)
 *   u16[8]: x, y, z (1/256 block, relative to the render region),
 *           size (quad extent in tiles: u | v << 5),
 *           local u, v (texture coordinates in tiles * 256),
 *           tile u, v (atlas origin of the texture tile, normalised)
 *   u8[8]:  tint r, g, b, shade, sky light, block light, frames, frame time
 */
export const U16_PER_VERTEX = 8;
export const U8_PER_VERTEX = 8;

export interface MeshInput {
  blocks: Uint16Array;
  light: Uint8Array;
  /** Per padded column (18*18): grass rgb, foliage rgb, water rgb = 9 bytes. */
  tints: Uint8Array;
  fancyLeaves: boolean;
  smoothLighting: boolean;
  /** Merge uniform faces (defaults to Mesher.greedy). */
  greedy?: boolean;
  /** Offset (blocks) of this section inside its render region. */
  ox?: number;
  oy?: number;
  oz?: number;
}

export interface LayerMesh {
  u16: Uint16Array;
  u8: Uint8Array;
  quads: number;
  /**
   * Quads per facing group, in buffer order: groups 0-5 face along one axis
   * (the face order below: -Y, +Y, -Z, +Z, -X, +X), group 6 holds everything
   * else (sloped fluid surfaces, diagonal plants, rotated model parts).
   */
  groups: number[];
}

/** Number of facing groups (six axis directions and "other"). */
export const FACE_GROUPS = 7;
export const GROUP_OTHER = 6;

export interface MeshOutput {
  layers: LayerMesh[];
  /** Face connectivity bits (see visConnected). */
  vis: number;
}

const TINT_INDEX: Record<TintKind, number> = { none: 0, grass: 1, foliage: 2, water: 3, birch: 4, spruce: 5, stem: 6, lily: 7 };
const FIXED_TINT: Record<number, [number, number, number]> = { 4: [0x80, 0xa7, 0x55], 5: [0x61, 0x99, 0x61], 6: [0x80, 0xc0, 0x40], 7: [0x20, 0x80, 0x30] };
const WHITE: [number, number, number] = [255, 255, 255];
const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
const AO_LEVEL = [0.45, 0.65, 0.83, 1.0];

/** Surface height (0..1) of a fluid cell from its level: sources 8/9, falling fluid full. */
function fluidLevelHeight(s: number): number {
  const lvl = parseInt(getProp(s, 'level') ?? '0', 10);
  return lvl === 0 ? 8 / 9 : lvl >= 8 ? 1 : (8 - lvl) / 9;
}
/** Face directions: 0 -Y, 1 +Y, 2 -Z, 3 +Z, 4 -X, 5 +X. */
export const DX = [0, 0, 0, 0, -1, 1];
export const DY = [-1, 1, 0, 0, 0, 0];
export const DZ = [0, 0, -1, 1, 0, 0];

/**
 * Facing group of a quad from its winding: the front face normal is
 * (p1 - p0) x (p2 - p0). Axis-aligned normals map to their face direction,
 * anything else to GROUP_OTHER.
 */
export function facingGroup(p: ArrayLike<number>): number {
  const ax = p[3]! - p[0]!;
  const ay = p[4]! - p[1]!;
  const az = p[5]! - p[2]!;
  const bx = p[6]! - p[0]!;
  const by = p[7]! - p[1]!;
  const bz = p[8]! - p[2]!;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return GROUP_OTHER;
  const e = 1e-4 * len;
  if (Math.abs(nx) < e && Math.abs(nz) < e) return ny > 0 ? 1 : 0;
  if (Math.abs(nx) < e && Math.abs(ny) < e) return nz > 0 ? 3 : 2;
  if (Math.abs(ny) < e && Math.abs(nz) < e) return nx > 0 ? 5 : 4;
  return GROUP_OTHER;
}

/** Unit cube face corners in the same order as models.element(). */
const CUBE_FACES: [number, number, number][][] = [
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
];
const CUBE_UV: [number, number][] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];
/** For each face: world axis (0 x, 1 y, 2 z) of the texture u and v directions. */
const FACE_U_AXIS: number[] = [];
const FACE_V_AXIS: number[] = [];
for (let f = 0; f < 6; f++) {
  const c = CUBE_FACES[f]!;
  const axis = (a: [number, number, number], b: [number, number, number]): number => (a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2);
  FACE_U_AXIS.push(axis(c[0]!, c[3]!));
  FACE_V_AXIS.push(axis(c[0]!, c[1]!));
}
/** Greedy plane axes per face: [normal axis, a axis, b axis]. */
const PLANE: [number, number, number][] = [
  [1, 0, 2],
  [1, 0, 2],
  [2, 0, 1],
  [2, 0, 1],
  [0, 2, 1],
  [0, 2, 1],
];

/** Six faces fit in 36 bits; only the upper triangle is stored (a < b), 15 bits. */
const PAIR_BIT: number[][] = [];
{
  let n = 0;
  for (let a = 0; a < 6; a++) {
    PAIR_BIT.push([]);
    for (let b = 0; b < 6; b++) PAIR_BIT[a]!.push(-1);
  }
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      PAIR_BIT[a]![b] = n;
      PAIR_BIT[b]![a] = n;
      n++;
    }
}
export const VIS_ALL = 0x7fff;
/** Whether a section lets sight pass from face a to face b. */
export function visConnected(vis: number, a: number, b: number): boolean {
  if (a === b) return true;
  return ((vis >> PAIR_BIT[a]![b]!) & 1) === 1;
}

interface ResolvedQuad {
  pos: Float32Array; // 12
  luv: Float32Array; // 8, tile-local 0..1
  tu: number;
  tv: number;
  face: number;
  cull: number;
  tint: number;
  frames: number;
  ftime: number;
  group: number;
}

interface Resolved {
  kind: ModelKind;
  layer: number;
  selfCull: boolean;
  ao: boolean;
  cubeTile?: [number, number][]; // per face tile origin (normalised * 65535)
  cubeRot?: number[];
  cubeTint?: number[];
  cubeAnim?: [number, number][];
  quads?: ResolvedQuad[];
  fluid: number;
  isLeaves: boolean;
}

const QUAD16 = 4 * U16_PER_VERTEX;
const QUAD8 = 4 * U8_PER_VERTEX;

class Builder {
  u16: Uint16Array;
  u8: Uint8Array;
  /** Facing group of each quad. */
  group: Uint8Array;
  quads = 0;
  constructor(cap = 1024) {
    this.u16 = new Uint16Array(cap * QUAD16);
    this.u8 = new Uint8Array(cap * QUAD8);
    this.group = new Uint8Array(cap);
  }
  ensure(): void {
    const cap = this.group.length;
    if (this.quads < cap) return;
    const a = new Uint16Array(this.u16.length * 2);
    a.set(this.u16);
    this.u16 = a;
    const b = new Uint8Array(this.u8.length * 2);
    b.set(this.u8);
    this.u8 = b;
    const g = new Uint8Array(cap * 2);
    g.set(this.group);
    this.group = g;
  }
  /** Copies the quads out, ordered by facing group (stable within a group). */
  finish(): LayerMesh {
    const n = this.quads;
    const groups = new Array<number>(FACE_GROUPS).fill(0);
    for (let q = 0; q < n; q++) groups[this.group[q]!]!++;
    const u16 = new Uint16Array(n * QUAD16);
    const u8 = new Uint8Array(n * QUAD8);
    const at = new Array<number>(FACE_GROUPS);
    let o = 0;
    for (let g = 0; g < FACE_GROUPS; g++) {
      at[g] = o;
      o += groups[g]!;
    }
    for (let q = 0; q < n; q++) {
      const d = at[this.group[q]!]!++;
      u16.set(this.u16.subarray(q * QUAD16, (q + 1) * QUAD16), d * QUAD16);
      u8.set(this.u8.subarray(q * QUAD8, (q + 1) * QUAD8), d * QUAD8);
    }
    return { u16, u8, quads: n, groups };
  }
}

const PLANE_CELLS = 6 * 16 * 256;

export class Mesher {
  private readonly resolved: Resolved[] = [];
  private readonly atlas: AtlasLookup;
  /** STATE_OPAQUE extended with SOLID_UNKNOWN (for face culling only). */
  private readonly cullOpaque: Uint8Array;
  /** Greedy planes: key per face cell (0 = none) and the attribute key. */
  private readonly keyA = new Int32Array(PLANE_CELLS);
  private readonly keyB = new Float64Array(PLANE_CELLS);
  private readonly visQueue = new Int16Array(4096);
  private readonly visSeen = new Uint8Array(4096);
  /** Merges uniform cube faces unless a mesh input says otherwise. */
  greedy = true;
  private useGreedy = true;

  constructor(meta: AtlasMeta) {
    initBlocks();
    this.atlas = new AtlasLookup(meta);
    const models = bakedModels();
    for (let s = 0; s < models.length; s++) this.resolved.push(this.resolve(s, models[s]!));
    this.cullOpaque = new Uint8Array(65536);
    this.cullOpaque.set(STATE_OPAQUE.subarray(0, Math.min(STATE_OPAQUE.length, 65535)));
    this.cullOpaque[SOLID_UNKNOWN] = 1;
  }

  /** Normalised (0..65535) atlas origin of a texture tile. */
  private tileOrigin(name: string): [number, number] {
    const e = this.atlas.entry(name);
    const [u, v] = this.atlas.uv(e.i, 0, 0);
    return [Math.round(u * 65535), Math.round(v * 65535)];
  }

  private resolve(state: number, m: BakedModel): Resolved {
    const r: Resolved = {
      kind: m.kind,
      layer: STATE_LAYER[state]!,
      selfCull: m.selfCull,
      ao: m.ao,
      fluid: STATE_FLUID[state]!,
      isLeaves: false,
    };
    if (m.kind === ModelKind.Cube) {
      r.isLeaves = r.layer === 2 && m.cubeTint!.some((t) => t === 'foliage' || t === 'birch' || t === 'spruce');
      r.cubeTile = [];
      r.cubeRot = [];
      r.cubeTint = [];
      r.cubeAnim = [];
      for (let f = 0; f < 6; f++) {
        const name = m.cubeTex![f]!;
        r.cubeTile.push(this.tileOrigin(name));
        r.cubeRot.push(m.cubeRot![f]! & 3);
        r.cubeTint.push(TINT_INDEX[m.cubeTint![f]!]);
        const e = this.atlas.entry(name);
        r.cubeAnim.push([e.n ?? 1, e.t ?? 1]);
      }
    } else if (m.kind === ModelKind.Quads) {
      r.quads = m.quads!.map((q) => {
        const pos = new Float32Array(12);
        const luv = new Float32Array(8);
        for (let k = 0; k < 4; k++) {
          pos[k * 3] = q.pos[k]![0];
          pos[k * 3 + 1] = q.pos[k]![1];
          pos[k * 3 + 2] = q.pos[k]![2];
          luv[k * 2] = q.uv[k]![0];
          luv[k * 2 + 1] = q.uv[k]![1];
        }
        const [tu, tv] = this.tileOrigin(q.tex);
        const e = this.atlas.entry(q.tex);
        return { pos, luv, tu, tv, face: q.face, cull: q.cull, tint: TINT_INDEX[q.tint], frames: e.n ?? 1, ftime: e.t ?? 1, group: facingGroup(pos) };
      });
    } else if (m.kind === ModelKind.Liquid) {
      r.layer = STATE_LAYER[state]!;
    }
    return r;
  }

  mesh(input: MeshInput): MeshOutput {
    const { blocks } = input;
    const builders = [new Builder(16), new Builder(1024), new Builder(256), new Builder(256)];
    this.useGreedy = input.greedy ?? this.greedy;
    const res = this.resolved;
    this.keyA.fill(0);
    let anyCube = false;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const pi = padIndex(x, y, z);
          const s = blocks[pi]!;
          if (s === 0) continue;
          const r = res[s];
          if (!r || r.kind === ModelKind.None) continue;
          const b = builders[r.layer]!;
          if (r.kind === ModelKind.Cube) {
            this.meshCube(b, input, x, y, z, s, r);
            anyCube = true;
          } else if (r.kind === ModelKind.Quads) this.meshQuads(b, input, x, y, z, s, r);
          else this.meshLiquid(b, input, x, y, z, s, r);
        }
      }
    }
    if (anyCube) this.flushGreedy(builders, input);
    return { layers: builders.map((b) => b.finish()), vis: this.visibility(blocks) };
  }

  private culled(s: number, n: number, r: Resolved, fancyLeaves: boolean): boolean {
    if (n === 0) return false;
    if (this.cullOpaque[n]) return true;
    if (r.selfCull && STATE_BLOCK[n] === STATE_BLOCK[s]) return !(r.isLeaves && fancyLeaves);
    return false;
  }

  private tintColor(input: MeshInput, x: number, z: number, tint: number): [number, number, number] {
    if (tint === 0) return WHITE;
    if (tint >= 4) return FIXED_TINT[tint]!;
    const ci = ((z + 1) * PAD + (x + 1)) * 9 + (tint - 1) * 3;
    return [input.tints[ci]!, input.tints[ci + 1]!, input.tints[ci + 2]!];
  }

  /** Writes one vertex. Positions are in blocks relative to the section. */
  private vertex(b: Builder, vi: number, input: MeshInput, px: number, py: number, pz: number, size: number, lu: number, lv: number, tu: number, tv: number, r: number, g: number, bl: number, a: number, sky: number, blk: number, frames: number, ftime: number): void {
    const o = vi * U16_PER_VERTEX;
    const u16 = b.u16;
    u16[o] = Math.round((px + (input.ox ?? 0)) * 256);
    u16[o + 1] = Math.round((py + (input.oy ?? 0)) * 256);
    u16[o + 2] = Math.round((pz + (input.oz ?? 0)) * 256);
    u16[o + 3] = size;
    u16[o + 4] = Math.round(lu * 256);
    u16[o + 5] = Math.round(lv * 256);
    u16[o + 6] = tu;
    u16[o + 7] = tv;
    const p = vi * U8_PER_VERTEX;
    const u8 = b.u8;
    u8[p] = r;
    u8[p + 1] = g;
    u8[p + 2] = bl;
    u8[p + 3] = a;
    u8[p + 4] = sky;
    u8[p + 5] = blk;
    u8[p + 6] = frames;
    u8[p + 7] = ftime;
  }

  private meshCube(b: Builder, input: MeshInput, x: number, y: number, z: number, s: number, r: Resolved): void {
    const { blocks, light, smoothLighting } = input;
    const aoOpaque = STATE_OPAQUE;
    for (let f = 0; f < 6; f++) {
      const ni = padIndex(x + DX[f]!, y + DY[f]!, z + DZ[f]!);
      if (this.culled(s, blocks[ni]!, r, input.fancyLeaves)) continue;
      const [tr, tg, tb] = this.tintColor(input, x, z, r.cubeTint![f]!);
      const corners = CUBE_FACES[f]!;
      let a0 = 3;
      let a1 = 3;
      let a2 = 3;
      let a3 = 3;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      const nl = light[ni]!;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!;
        let ao = 3;
        let sk: number;
        let bk: number;
        if (smoothLighting && r.ao) {
          // tangent offsets
          const ox = DX[f] !== 0 ? 0 : c[0] ? 1 : -1;
          const oy = DY[f] !== 0 ? 0 : c[1] ? 1 : -1;
          const oz = DZ[f] !== 0 ? 0 : c[2] ? 1 : -1;
          const bx = x + DX[f]!;
          const by = y + DY[f]!;
          const bz = z + DZ[f]!;
          let s1i: number;
          let s2i: number;
          if (DX[f] !== 0) {
            s1i = padIndex(bx, by + oy, bz);
            s2i = padIndex(bx, by, bz + oz);
          } else if (DY[f] !== 0) {
            s1i = padIndex(bx + ox, by, bz);
            s2i = padIndex(bx, by, bz + oz);
          } else {
            s1i = padIndex(bx + ox, by, bz);
            s2i = padIndex(bx, by + oy, bz);
          }
          const ci = padIndex(bx + ox, by + oy, bz + oz);
          const o1 = aoOpaque[blocks[s1i]!] ?? 0;
          const o2 = aoOpaque[blocks[s2i]!] ?? 0;
          const oc = aoOpaque[blocks[ci]!] ?? 0;
          ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
          let ss = nl >> 4;
          let sb = nl & 15;
          let cnt = 1;
          if (!o1) {
            const l = light[s1i]!;
            ss += l >> 4;
            sb += l & 15;
            cnt++;
          }
          if (!o2) {
            const l = light[s2i]!;
            ss += l >> 4;
            sb += l & 15;
            cnt++;
          }
          if (!oc && !(o1 && o2)) {
            const l = light[ci]!;
            ss += l >> 4;
            sb += l & 15;
            cnt++;
          }
          sk = Math.round((ss / cnt) * 16);
          bk = Math.round((sb / cnt) * 16);
        } else {
          sk = (nl >> 4) * 16;
          bk = (nl & 15) * 16;
        }
        if (k === 0) {
          a0 = ao;
          s0 = sk;
          b0 = bk;
        } else if (k === 1) {
          a1 = ao;
          s1 = sk;
          b1 = bk;
        } else if (k === 2) {
          a2 = ao;
          s2 = sk;
          b2 = bk;
        } else {
          a3 = ao;
          s3 = sk;
          b3 = bk;
        }
      }
      const rot = r.cubeRot![f]!;
      // Uniform faces go to the greedy planes; the rest are emitted now.
      if (this.useGreedy && rot === 0 && a0 === a1 && a0 === a2 && a0 === a3 && s0 === s1 && s0 === s2 && s0 === s3 && b0 === b1 && b0 === b2 && b0 === b3) {
        const pl = PLANE[f]!;
        const cell = [x, y, z];
        const idx = ((f * 16 + cell[pl[0]]!) * 16 + cell[pl[2]]!) * 16 + cell[pl[1]]!;
        this.keyA[idx] = s * 8 + f + 1;
        this.keyB[idx] = ((tr * 65536 + tg * 256 + tb) * 256 + s0) * 1024 + b0 * 4 + a0;
        continue;
      }
      b.ensure();
      const q = b.quads;
      const aos = [a0, a1, a2, a3];
      const sky = [s0, s1, s2, s3];
      const blk = [b0, b1, b2, b3];
      const flip = a0 + a2 < a1 + a3;
      const shade = FACE_SHADE[f]!;
      const [frames, ftime] = r.cubeAnim![f]!;
      const [tu, tv] = r.cubeTile![f]!;
      for (let kk = 0; kk < 4; kk++) {
        const k = flip ? (kk + 1) & 3 : kk;
        const c = corners[k]!;
        const [lu, lv] = CUBE_UV[(k + rot) & 3]!;
        this.vertex(b, q * 4 + kk, input, x + c[0], y + c[1], z + c[2], 1 | (1 << 5), lu, lv, tu, tv, tr, tg, tb, Math.round(shade * AO_LEVEL[aos[k]!]! * 255), sky[k]!, blk[k]!, frames, ftime);
      }
      b.group[q] = f;
      b.quads++;
    }
  }

  /** Merges the uniform faces collected in meshCube into rectangles. */
  private flushGreedy(builders: Builder[], input: MeshInput): void {
    const keyA = this.keyA;
    const keyB = this.keyB;
    const res = this.resolved;
    for (let f = 0; f < 6; f++) {
      const pl = PLANE[f]!;
      const corners = CUBE_FACES[f]!;
      const shade = FACE_SHADE[f]!;
      for (let sl = 0; sl < 16; sl++) {
        const base = (f * 16 + sl) * 256;
        for (let bb = 0; bb < 16; bb++) {
          for (let aa = 0; aa < 16; aa++) {
            const i0 = base + bb * 16 + aa;
            const ka = keyA[i0]!;
            if (ka === 0) continue;
            const kb = keyB[i0]!;
            // width along a
            let w = 1;
            while (aa + w < 16 && keyA[i0 + w] === ka && keyB[i0 + w] === kb) w++;
            // height along b
            let h = 1;
            outer: while (bb + h < 16) {
              const row = base + (bb + h) * 16 + aa;
              for (let k = 0; k < w; k++) if (keyA[row + k] !== ka || keyB[row + k] !== kb) break outer;
              h++;
            }
            for (let hh = 0; hh < h; hh++) keyA.fill(0, base + (bb + hh) * 16 + aa, base + (bb + hh) * 16 + aa + w);
            // decode
            const s = ((ka - 1) / 8) | 0;
            const r = res[s]!;
            const b = builders[r.layer]!;
            const a = kb % 4;
            const blk = Math.floor(kb / 4) % 256;
            const sky = Math.floor(kb / 1024) % 256;
            const rgb = Math.floor(kb / (1024 * 256));
            const tr = (rgb >> 16) & 255;
            const tg = (rgb >> 8) & 255;
            const tb = rgb & 255;
            const [frames, ftime] = r.cubeAnim![f]!;
            const [tu, tv] = r.cubeTile![f]!;
            // block-space minimum corner and extents
            const min = [0, 0, 0];
            const ext = [1, 1, 1];
            min[pl[0]] = sl;
            min[pl[1]] = aa;
            min[pl[2]] = bb;
            ext[pl[1]] = w;
            ext[pl[2]] = h;
            const su = ext[FACE_U_AXIS[f]!]!;
            const sv = ext[FACE_V_AXIS[f]!]!;
            const alpha = Math.round(shade * AO_LEVEL[a]! * 255);
            b.ensure();
            const q = b.quads;
            for (let k = 0; k < 4; k++) {
              const c = corners[k]!;
              const [u, v] = CUBE_UV[k]!;
              this.vertex(b, q * 4 + k, input, min[0]! + c[0] * ext[0]!, min[1]! + c[1] * ext[1]!, min[2]! + c[2] * ext[2]!, su | (sv << 5), u * su, v * sv, tu, tv, tr, tg, tb, alpha, sky, blk, frames, ftime);
            }
            b.group[q] = f;
            b.quads++;
          }
        }
      }
    }
  }

  private meshQuads(b: Builder, input: MeshInput, x: number, y: number, z: number, s: number, r: Resolved): void {
    const { blocks, light } = input;
    const own = light[padIndex(x, y, z)]!;
    const cull = this.cullOpaque;
    for (const qd of r.quads!) {
      if (qd.cull >= 0) {
        const ni = padIndex(x + DX[qd.cull]!, y + DY[qd.cull]!, z + DZ[qd.cull]!);
        const n = blocks[ni]!;
        if (cull[n] || (r.selfCull && STATE_BLOCK[n] === STATE_BLOCK[s])) continue;
      }
      // Light: from the neighbour for boundary faces, else own cell (max with above for thin shapes)
      let l = own;
      if (qd.cull >= 0) l = light[padIndex(x + DX[qd.cull]!, y + DY[qd.cull]!, z + DZ[qd.cull]!)]!;
      else if (qd.face >= 0) {
        const ni = padIndex(x + DX[qd.face]!, y + DY[qd.face]!, z + DZ[qd.face]!);
        if (!cull[blocks[ni]!]) l = Math.max(l, light[ni]!);
      }
      if (STATE_OPAQUE[s] === 0 && l === 0) {
        // blocks inside opaque surroundings (e.g. slab under slab) sample above
        l = light[padIndex(x, y + 1, z)]!;
      }
      b.ensure();
      const q = b.quads;
      const [tr, tg, tb] = this.tintColor(input, x, z, qd.tint);
      const shade = Math.round((qd.face >= 0 ? FACE_SHADE[qd.face]! : 1) * 255);
      for (let k = 0; k < 4; k++) {
        this.vertex(b, q * 4 + k, input, x + qd.pos[k * 3]!, y + qd.pos[k * 3 + 1]!, z + qd.pos[k * 3 + 2]!, 1 | (1 << 5), qd.luv[k * 2]!, qd.luv[k * 2 + 1]!, qd.tu, qd.tv, tr, tg, tb, shade, (l >> 4) * 16, (l & 15) * 16, qd.frames, qd.ftime);
      }
      b.group[q] = qd.group;
      b.quads++;
    }
  }

  private fluidHeightAt(blocks: Uint16Array, x: number, y: number, z: number, fluid: number): number {
    // Corner height from the 4 cells sharing this corner (x,z are corner coords 0..16).
    // Fuller cells weigh more, and open (non-solid) cells pull the corner down,
    // so a surface slopes smoothly where fluid spreads and dips at an open edge.
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < 4; i++) {
      const cx = x - 1 + (i & 1);
      const cz = z - 1 + (i >> 1);
      const s = blocks[padIndex(cx, y, cz)]!;
      if (STATE_FLUID[s] === fluid) {
        const above = blocks[padIndex(cx, y + 1, cz)]!;
        if (STATE_FLUID[above] === fluid) return 1;
        const h = fluidLevelHeight(s);
        const w = h >= 0.8 ? 10 : 1;
        sum += h * w;
        cnt += w;
      } else if (!STATE_SOLID[s]) cnt++;
    }
    return cnt ? sum / cnt : 8 / 9;
  }

  private meshLiquid(b: Builder, input: MeshInput, x: number, y: number, z: number, s: number, r: Resolved): void {
    void s;
    const { blocks, light } = input;
    const fluid = r.fluid;
    const water = fluid === 1;
    const still = water ? 'water_still' : 'lava_still';
    const flow = water ? 'water_flow' : 'lava_flow';
    const [tr, tg, tb] = water ? this.tintColor(input, x, z, 3) : WHITE;
    const aboveS = blocks[padIndex(x, y + 1, z)]!;
    const covered = STATE_FLUID[aboveS] === fluid;
    const h00 = covered ? 1 : this.fluidHeightAt(blocks, x, y, z, fluid);
    const h10 = covered ? 1 : this.fluidHeightAt(blocks, x + 1, y, z, fluid);
    const h01 = covered ? 1 : this.fluidHeightAt(blocks, x, y, z + 1, fluid);
    const h11 = covered ? 1 : this.fluidHeightAt(blocks, x + 1, y, z + 1, fluid);
    const eStill = this.atlas.entry(still);
    const eFlow = this.atlas.entry(flow);
    const [stu, stv] = this.tileOrigin(still);
    const [ftu, ftv] = this.tileOrigin(flow);
    const own = light[padIndex(x, y, z)]!;
    const flat = h00 === h10 && h00 === h01 && h00 === h11;
    const emit = (verts: [number, number, number][], uvs: [number, number][], isStill: boolean, l: number, shade: number, group: number): void => {
      b.ensure();
      const q = b.quads;
      const e = isStill ? eStill : eFlow;
      for (let k = 0; k < 4; k++) {
        const [px, py, pz] = verts[k]!;
        this.vertex(b, q * 4 + k, input, x + px, y + py, z + pz, 1 | (1 << 5), uvs[k]![0], uvs[k]![1], isStill ? stu : ftu, isStill ? stv : ftv, tr, tg, tb, Math.round(shade * 255), (l >> 4) * 16, (l & 15) * 16, e.n ?? 1, e.t ?? 1);
      }
      b.group[q] = group;
      b.quads++;
    };
    const cull = this.cullOpaque;
    const sameOrOpaque = (n: number): boolean => STATE_FLUID[n] === fluid || cull[n] === 1;
    if (!covered) {
      const l = Math.max(own, light[padIndex(x, y + 1, z)]!);
      const top: [number, number, number][] = [
        [0, h00, 0],
        [0, h01, 1],
        [1, h11, 1],
        [1, h10, 0],
      ];
      // A sloped surface shows the flowing texture running downhill (the
      // texture scrolls along v, so v follows the steepest of the four
      // directions); a level one shows the still texture.
      const fx = h00 + h01 - h10 - h11;
      const fz = h00 + h10 - h01 - h11;
      const sloped = !flat && Math.abs(fx) + Math.abs(fz) > 0.02;
      const uvAt = ([px, , pz]: [number, number, number]): [number, number] => {
        if (!sloped) return [px, pz];
        if (Math.abs(fx) >= Math.abs(fz)) return fx > 0 ? [1 - pz, px] : [pz, 1 - px];
        return fz > 0 ? [px, pz] : [1 - px, 1 - pz];
      };
      const uvs = top.map(uvAt);
      // A sloped surface is not axis-aligned: it can face the camera from any side
      emit(top, uvs, !sloped, l, 1, flat ? 1 : GROUP_OTHER);
      if (water) {
        // underside of the surface visible from below
        emit([top[3]!, top[2]!, top[1]!, top[0]!], [uvs[3]!, uvs[2]!, uvs[1]!, uvs[0]!], !sloped, l, 0.9, flat ? 0 : GROUP_OTHER);
      }
    }
    // sides
    const sides: [number, [number, number, number][], number][] = [
      [2, [[1, h10, 0], [1, 0, 0], [0, 0, 0], [0, h00, 0]], 0.8],
      [3, [[0, h01, 1], [0, 0, 1], [1, 0, 1], [1, h11, 1]], 0.8],
      [4, [[0, h00, 0], [0, 0, 0], [0, 0, 1], [0, h01, 1]], 0.6],
      [5, [[1, h11, 1], [1, 0, 1], [1, 0, 0], [1, h10, 0]], 0.6],
    ];
    for (const [f, verts, shade] of sides) {
      const ni = padIndex(x + DX[f]!, y, z + DZ[f]!);
      const n = blocks[ni]!;
      if (sameOrOpaque(n)) continue;
      const l = light[ni]!;
      const uvs: [number, number][] = [
        [0, 1 - verts[0]![1] * 0.5],
        [0, 1],
        [1, 1],
        [1, 1 - verts[3]![1] * 0.5],
      ];
      emit(verts, uvs, false, Math.max(l, own), shade, f);
    }
    const belowS = blocks[padIndex(x, y - 1, z)]!;
    if (!sameOrOpaque(belowS)) {
      emit([[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], [[0, 0], [0, 1], [1, 1], [1, 0]], true, light[padIndex(x, y - 1, z)]!, 0.5, 0);
    }
    void s;
  }

  /**
   * Which faces of the section are connected through non-opaque blocks
   * (flood fill), as 15 pair bits. Used to cull sections hidden behind
   * solid terrain.
   */
  private visibility(blocks: Uint16Array): number {
    const seen = this.visSeen;
    const queue = this.visQueue;
    let solid = 0;
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const o = STATE_OPAQUE[blocks[padIndex(x, y, z)]!] ?? 0;
          seen[(y << 8) | (z << 4) | x] = o;
          solid += o;
        }
    if (solid === 0) return VIS_ALL;
    if (solid === 4096) return 0;
    let vis = 0;
    for (let start = 0; start < 4096; start++) {
      if (seen[start]) continue;
      // flood fill one open region, collecting the faces it touches
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      let faces = 0;
      while (head < tail) {
        const i = queue[head++]!;
        const x = i & 15;
        const z = (i >> 4) & 15;
        const y = i >> 8;
        if (y === 0) faces |= 1;
        else if (!seen[i - 256]) {
          seen[i - 256] = 1;
          queue[tail++] = i - 256;
        }
        if (y === 15) faces |= 2;
        else if (!seen[i + 256]) {
          seen[i + 256] = 1;
          queue[tail++] = i + 256;
        }
        if (z === 0) faces |= 4;
        else if (!seen[i - 16]) {
          seen[i - 16] = 1;
          queue[tail++] = i - 16;
        }
        if (z === 15) faces |= 8;
        else if (!seen[i + 16]) {
          seen[i + 16] = 1;
          queue[tail++] = i + 16;
        }
        if (x === 0) faces |= 16;
        else if (!seen[i - 1]) {
          seen[i - 1] = 1;
          queue[tail++] = i - 1;
        }
        if (x === 15) faces |= 32;
        else if (!seen[i + 1]) {
          seen[i + 1] = 1;
          queue[tail++] = i + 1;
        }
      }
      for (let a = 0; a < 6; a++) {
        if (!(faces & (1 << a))) continue;
        for (let b2 = a + 1; b2 < 6; b2++) if (faces & (1 << b2)) vis |= 1 << PAIR_BIT[a]![b2]!;
      }
      if (vis === VIS_ALL) break;
    }
    return vis;
  }
}
