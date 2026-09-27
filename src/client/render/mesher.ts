/**
 * Chunk section mesher. Operates on a padded 18^3 copy of the section so that
 * neighbour lookups never cross chunk objects.
 */
import { STATE_OPAQUE, STATE_LAYER, STATE_BLOCK, STATE_FLUID, getProp, initBlocks } from '../../common/registry/blocks';
import { bakedModels, ModelKind, type BakedModel } from './models';
import { AtlasLookup, type AtlasMeta } from './atlasInfo';
import type { TintKind } from '../../common/registry/blockTypes';

export const PAD = 18;
export const padIndex = (x: number, y: number, z: number): number => ((y + 1) * PAD + (z + 1)) * PAD + (x + 1);

export interface MeshInput {
  blocks: Uint16Array;
  light: Uint8Array;
  /** Per padded column (18*18): grass rgb, foliage rgb, water rgb = 9 bytes. */
  tints: Uint8Array;
  fancyLeaves: boolean;
  smoothLighting: boolean;
}

export interface LayerMesh {
  pos: Uint16Array;
  uv: Uint16Array;
  col: Uint8Array;
  light: Uint8Array;
  quads: number;
}

const TINT_INDEX: Record<TintKind, number> = { none: 0, grass: 1, foliage: 2, water: 3, birch: 4, spruce: 5, stem: 6, lily: 7 };
const FIXED_TINT: Record<number, [number, number, number]> = { 4: [0x80, 0xa7, 0x55], 5: [0x61, 0x99, 0x61], 6: [0x80, 0xc0, 0x40], 7: [0x20, 0x80, 0x30] };
const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
const AO_LEVEL = [0.45, 0.65, 0.83, 1.0];
const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];

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

interface ResolvedQuad {
  pos: Float32Array; // 12
  uv: Uint16Array; // 8 (atlas normalized *65535)
  face: number;
  cull: number;
  tint: number;
  frames: number;
  ftime: number;
}

interface Resolved {
  kind: ModelKind;
  layer: number;
  selfCull: boolean;
  ao: boolean;
  cubeUV?: Uint16Array[]; // per face 8 values
  cubeTint?: number[];
  cubeAnim?: [number, number][];
  quads?: ResolvedQuad[];
  fluid: number;
  isLeaves: boolean;
}

class Builder {
  pos: Uint16Array;
  uv: Uint16Array;
  col: Uint8Array;
  light: Uint8Array;
  quads = 0;
  constructor(cap = 1024) {
    this.pos = new Uint16Array(cap * 12);
    this.uv = new Uint16Array(cap * 8);
    this.col = new Uint8Array(cap * 16);
    this.light = new Uint8Array(cap * 16);
  }
  ensure(): void {
    const cap = this.pos.length / 12;
    if (this.quads < cap) return;
    const n = cap * 2;
    const grow = <T extends Uint16Array | Uint8Array>(a: T, per: number): T => {
      const b = new (a.constructor as { new (n: number): T })(n * per);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 12);
    this.uv = grow(this.uv, 8);
    this.col = grow(this.col, 16);
    this.light = grow(this.light, 16);
  }
  finish(): LayerMesh {
    return {
      pos: this.pos.slice(0, this.quads * 12),
      uv: this.uv.slice(0, this.quads * 8),
      col: this.col.slice(0, this.quads * 16),
      light: this.light.slice(0, this.quads * 16),
      quads: this.quads,
    };
  }
}

export class Mesher {
  private readonly resolved: Resolved[] = [];
  private readonly atlas: AtlasLookup;
  private readonly eps: number;

  constructor(meta: AtlasMeta) {
    initBlocks();
    this.atlas = new AtlasLookup(meta);
    this.eps = 0.02 / meta.tile;
    const models = bakedModels();
    for (let s = 0; s < models.length; s++) this.resolved.push(this.resolve(s, models[s]!));
  }

  private tileUV(name: string, u: number, v: number): [number, number] {
    const e = this.atlas.entry(name);
    // tiny inset to avoid sampling neighbour tiles
    const uu = Math.min(1 - this.eps, Math.max(this.eps, u));
    const vv = Math.min(1 - this.eps, Math.max(this.eps, v));
    return this.atlas.uv(e.i, uu, vv);
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
      r.isLeaves = r.layer === 2 && m.cubeTint!.some((t) => t === 'foliage' || t === 'birch' || t === 'spruce') ;
      r.cubeUV = [];
      r.cubeTint = [];
      r.cubeAnim = [];
      for (let f = 0; f < 6; f++) {
        const name = m.cubeTex![f]!;
        const rot = m.cubeRot![f]!;
        const uv = new Uint16Array(8);
        for (let k = 0; k < 4; k++) {
          const [u, v] = CUBE_UV[(k + rot) & 3]!;
          const [au, av] = this.tileUV(name, u, v);
          uv[k * 2] = Math.round(au * 65535);
          uv[k * 2 + 1] = Math.round(av * 65535);
        }
        r.cubeUV.push(uv);
        r.cubeTint.push(TINT_INDEX[m.cubeTint![f]!]);
        const e = this.atlas.entry(name);
        r.cubeAnim.push([e.n ?? 1, e.t ?? 1]);
      }
    } else if (m.kind === ModelKind.Quads) {
      r.quads = m.quads!.map((q) => {
        const pos = new Float32Array(12);
        const uv = new Uint16Array(8);
        for (let k = 0; k < 4; k++) {
          pos[k * 3] = q.pos[k]![0];
          pos[k * 3 + 1] = q.pos[k]![1];
          pos[k * 3 + 2] = q.pos[k]![2];
          const [au, av] = this.tileUV(q.tex, q.uv[k]![0], q.uv[k]![1]);
          uv[k * 2] = Math.round(au * 65535);
          uv[k * 2 + 1] = Math.round(av * 65535);
        }
        const e = this.atlas.entry(q.tex);
        return { pos, uv, face: q.face, cull: q.cull, tint: TINT_INDEX[q.tint], frames: e.n ?? 1, ftime: e.t ?? 1 };
      });
    } else if (m.kind === ModelKind.Liquid) {
      r.layer = STATE_LAYER[state]!;
    }
    return r;
  }

  private waterStill: [number, number, number, number] | null = null;

  mesh(input: MeshInput): LayerMesh[] {
    const { blocks, light } = input;
    const builders = [new Builder(64), new Builder(1024), new Builder(256), new Builder(256)];
    const res = this.resolved;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const pi = padIndex(x, y, z);
          const s = blocks[pi]!;
          if (s === 0) continue;
          const r = res[s];
          if (!r || r.kind === ModelKind.None) continue;
          const b = builders[r.layer]!;
          if (r.kind === ModelKind.Cube) this.meshCube(b, input, x, y, z, s, r);
          else if (r.kind === ModelKind.Quads) this.meshQuads(b, input, x, y, z, s, r);
          else this.meshLiquid(b, input, x, y, z, s, r);
        }
      }
    }
    void light;
    return builders.map((b) => b.finish());
  }

  private culled(s: number, n: number, r: Resolved, fancyLeaves: boolean): boolean {
    if (n === 0) return false;
    if (STATE_OPAQUE[n]) return true;
    if (r.selfCull && STATE_BLOCK[n] === STATE_BLOCK[s]) return !(r.isLeaves && fancyLeaves);
    return false;
  }

  private tintColor(input: MeshInput, x: number, z: number, tint: number): [number, number, number] {
    if (tint === 0) return [255, 255, 255];
    if (tint >= 4) return FIXED_TINT[tint]!;
    const ci = ((z + 1) * PAD + (x + 1)) * 9 + (tint - 1) * 3;
    return [input.tints[ci]!, input.tints[ci + 1]!, input.tints[ci + 2]!];
  }

  private meshCube(b: Builder, input: MeshInput, x: number, y: number, z: number, s: number, r: Resolved): void {
    const { blocks, light, smoothLighting } = input;
    for (let f = 0; f < 6; f++) {
      const ni = padIndex(x + DX[f]!, y + DY[f]!, z + DZ[f]!);
      if (this.culled(s, blocks[ni]!, r, input.fancyLeaves)) continue;
      b.ensure();
      const q = b.quads;
      const [tr, tg, tb] = this.tintColor(input, x, z, r.cubeTint![f]!);
      const corners = CUBE_FACES[f]!;
      const aos = [3, 3, 3, 3];
      const sky = [0, 0, 0, 0];
      const blk = [0, 0, 0, 0];
      const nl = light[ni]!;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!;
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
          const o1 = STATE_OPAQUE[blocks[s1i]!]!;
          const o2 = STATE_OPAQUE[blocks[s2i]!]!;
          const oc = STATE_OPAQUE[blocks[ci]!]!;
          aos[k] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
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
          sky[k] = Math.round((ss / cnt) * 16);
          blk[k] = Math.round((sb / cnt) * 16);
        } else {
          sky[k] = (nl >> 4) * 16;
          blk[k] = (nl & 15) * 16;
        }
      }
      const flip = aos[0]! + aos[2]! < aos[1]! + aos[3]!;
      const shade = FACE_SHADE[f]!;
      const [frames, ftime] = r.cubeAnim![f]!;
      const uv = r.cubeUV![f]!;
      for (let kk = 0; kk < 4; kk++) {
        const k = flip ? (kk + 1) & 3 : kk;
        const c = corners[k]!;
        const vi = q * 4 + kk;
        b.pos[vi * 3] = (x + c[0]) * 256;
        b.pos[vi * 3 + 1] = (y + c[1]) * 256;
        b.pos[vi * 3 + 2] = (z + c[2]) * 256;
        b.uv[vi * 2] = uv[k * 2]!;
        b.uv[vi * 2 + 1] = uv[k * 2 + 1]!;
        b.col[vi * 4] = tr;
        b.col[vi * 4 + 1] = tg;
        b.col[vi * 4 + 2] = tb;
        b.col[vi * 4 + 3] = Math.round(shade * AO_LEVEL[aos[k]!]! * 255);
        b.light[vi * 4] = sky[k]!;
        b.light[vi * 4 + 1] = blk[k]!;
        b.light[vi * 4 + 2] = frames;
        b.light[vi * 4 + 3] = ftime;
      }
      b.quads++;
    }
  }

  private meshQuads(b: Builder, input: MeshInput, x: number, y: number, z: number, s: number, r: Resolved): void {
    const { blocks, light } = input;
    const own = light[padIndex(x, y, z)]!;
    for (const qd of r.quads!) {
      if (qd.cull >= 0) {
        const ni = padIndex(x + DX[qd.cull]!, y + DY[qd.cull]!, z + DZ[qd.cull]!);
        const n = blocks[ni]!;
        if (STATE_OPAQUE[n] || (r.selfCull && STATE_BLOCK[n] === STATE_BLOCK[s])) continue;
      }
      // Light: from the neighbour for boundary faces, else own cell (max with above for thin shapes)
      let l = own;
      if (qd.cull >= 0) l = light[padIndex(x + DX[qd.cull]!, y + DY[qd.cull]!, z + DZ[qd.cull]!)]!;
      else if (qd.face >= 0) {
        const ni = padIndex(x + DX[qd.face]!, y + DY[qd.face]!, z + DZ[qd.face]!);
        if (!STATE_OPAQUE[blocks[ni]!]) l = Math.max(l, light[ni]!);
      }
      if (STATE_OPAQUE[s] === 0 && l === 0) {
        // blocks inside opaque surroundings (e.g. slab under slab) sample above
        l = light[padIndex(x, y + 1, z)]!;
      }
      b.ensure();
      const q = b.quads;
      const [tr, tg, tb] = this.tintColor(input, x, z, qd.tint);
      const shade = qd.face >= 0 ? FACE_SHADE[qd.face]! : 1;
      for (let k = 0; k < 4; k++) {
        const vi = q * 4 + k;
        b.pos[vi * 3] = Math.round((x + qd.pos[k * 3]!) * 256);
        b.pos[vi * 3 + 1] = Math.round((y + qd.pos[k * 3 + 1]!) * 256);
        b.pos[vi * 3 + 2] = Math.round((z + qd.pos[k * 3 + 2]!) * 256);
        b.uv[vi * 2] = qd.uv[k * 2]!;
        b.uv[vi * 2 + 1] = qd.uv[k * 2 + 1]!;
        b.col[vi * 4] = tr;
        b.col[vi * 4 + 1] = tg;
        b.col[vi * 4 + 2] = tb;
        b.col[vi * 4 + 3] = Math.round(shade * 255);
        b.light[vi * 4] = (l >> 4) * 16;
        b.light[vi * 4 + 1] = (l & 15) * 16;
        b.light[vi * 4 + 2] = qd.frames;
        b.light[vi * 4 + 3] = qd.ftime;
      }
      b.quads++;
    }
  }

  private fluidHeightAt(blocks: Uint16Array, x: number, y: number, z: number, fluid: number): number {
    // corner height from the 4 cells sharing this corner (x,z are corner coords 0..16)
    let sum = 0;
    let cnt = 0;
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const cx = x + dx;
      const cz = z + dz;
      const s = blocks[padIndex(cx, y, cz)]!;
      if (STATE_FLUID[s] === fluid) {
        const above = blocks[padIndex(cx, y + 1, cz)]!;
        if (STATE_FLUID[above] === fluid) return 1;
        const lvl = parseInt(getProp(s, 'level') ?? '0', 10);
        const h = lvl === 0 ? 8 / 9 : lvl >= 8 ? 1 : (8 - lvl) / 9;
        sum += h;
        cnt++;
      } else if (!STATE_OPAQUE[s]) {
        cnt += 0;
      }
    }
    return cnt ? sum / cnt : 8 / 9;
  }

  private meshLiquid(b: Builder, input: MeshInput, x: number, y: number, z: number, s: number, r: Resolved): void {
    const { blocks, light } = input;
    const fluid = r.fluid;
    const water = fluid === 1;
    const still = water ? 'water_still' : 'lava_still';
    const flow = water ? 'water_flow' : 'lava_flow';
    const [tr, tg, tb] = water ? this.tintColor(input, x, z, 3) : [255, 255, 255];
    const aboveS = blocks[padIndex(x, y + 1, z)]!;
    const covered = STATE_FLUID[aboveS] === fluid;
    const h00 = covered ? 1 : this.fluidHeightAt(blocks, x, y, z, fluid);
    const h10 = covered ? 1 : this.fluidHeightAt(blocks, x + 1, y, z, fluid);
    const h01 = covered ? 1 : this.fluidHeightAt(blocks, x, y, z + 1, fluid);
    const h11 = covered ? 1 : this.fluidHeightAt(blocks, x + 1, y, z + 1, fluid);
    const eStill = this.atlas.entry(still);
    const eFlow = this.atlas.entry(flow);
    const own = light[padIndex(x, y, z)]!;
    const emit = (verts: [number, number, number][], uvs: [number, number][], tex: string, l: number, shade: number, frames: number, ftime: number): void => {
      b.ensure();
      const q = b.quads;
      for (let k = 0; k < 4; k++) {
        const vi = q * 4 + k;
        const [px, py, pz] = verts[k]!;
        b.pos[vi * 3] = Math.round((x + px) * 256);
        b.pos[vi * 3 + 1] = Math.round((y + py) * 256);
        b.pos[vi * 3 + 2] = Math.round((z + pz) * 256);
        const [au, av] = this.tileUV(tex, uvs[k]![0], uvs[k]![1]);
        b.uv[vi * 2] = Math.round(au * 65535);
        b.uv[vi * 2 + 1] = Math.round(av * 65535);
        b.col[vi * 4] = tr;
        b.col[vi * 4 + 1] = tg;
        b.col[vi * 4 + 2] = tb;
        b.col[vi * 4 + 3] = Math.round(shade * 255);
        b.light[vi * 4] = (l >> 4) * 16;
        b.light[vi * 4 + 1] = (l & 15) * 16;
        b.light[vi * 4 + 2] = frames;
        b.light[vi * 4 + 3] = ftime;
      }
      b.quads++;
    };
    const sameOrOpaque = (n: number): boolean => STATE_FLUID[n] === fluid || STATE_OPAQUE[n] === 1;
    if (!covered) {
      const l = Math.max(own, light[padIndex(x, y + 1, z)]!);
      const top: [number, number, number][] = [
        [0, h00, 0],
        [0, h01, 1],
        [1, h11, 1],
        [1, h10, 0],
      ];
      const uvs: [number, number][] = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ];
      emit(top, uvs, still, l, 1, eStill.n ?? 1, eStill.t ?? 1);
      if (water) {
        // underside of the surface visible from below
        emit([top[3]!, top[2]!, top[1]!, top[0]!], [uvs[3]!, uvs[2]!, uvs[1]!, uvs[0]!], still, l, 0.9, eStill.n ?? 1, eStill.t ?? 1);
      }
    }
    // sides
    const sides: [number, [number, number, number][], number, number][] = [
      [2, [[1, h10, 0], [1, 0, 0], [0, 0, 0], [0, h00, 0]], 0.8, 0],
      [3, [[0, h01, 1], [0, 0, 1], [1, 0, 1], [1, h11, 1]], 0.8, 0],
      [4, [[0, h00, 0], [0, 0, 0], [0, 0, 1], [0, h01, 1]], 0.6, 0],
      [5, [[1, h11, 1], [1, 0, 1], [1, 0, 0], [1, h10, 0]], 0.6, 0],
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
      emit(verts, uvs, flow, Math.max(l, own), shade, eFlow.n ?? 1, eFlow.t ?? 1);
    }
    const belowS = blocks[padIndex(x, y - 1, z)]!;
    if (!sameOrOpaque(belowS)) {
      emit([[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], [[0, 0], [0, 1], [1, 1], [1, 0]], still, light[padIndex(x, y - 1, z)]!, 0.5, eStill.n ?? 1, eStill.t ?? 1);
    }
    void s;
    void this.waterStill;
  }
}
