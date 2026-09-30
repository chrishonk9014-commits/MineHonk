/**
 * Block model baking: converts every block state into render quads.
 * Coordinates are in block-local units (0..1), UVs in tile units (0..1).
 * Runs in mesher workers and on the main thread (item icons, hand model).
 */
import { blocks, STATE_BLOCK, getProp, stateCount, blockOf } from '../../common/registry/blocks';
import type { BlockDef, TintKind } from '../../common/registry/blockTypes';

export type V3 = [number, number, number];
export type UV = [number, number];

export interface ModelQuad {
  pos: [V3, V3, V3, V3];
  uv: [UV, UV, UV, UV];
  tex: string;
  /** Face direction for shading/normal (0..5) or -1 for free quads (plants). */
  face: number;
  /** Cull against neighbour in this direction (-1 = never culled). */
  cull: number;
  tint: TintKind;
}

export const enum ModelKind {
  None = 0,
  Cube = 1,
  Liquid = 2,
  Quads = 3,
}

export interface BakedModel {
  kind: ModelKind;
  /** Cube: texture per face (down, up, north, south, west, east) and UV rotation (0..3). */
  cubeTex?: string[];
  cubeRot?: number[];
  cubeTint?: TintKind[];
  quads?: ModelQuad[];
  /** Whether identical neighbours hide shared faces (glass, leaves, water). */
  selfCull: boolean;
  /** Emits ambient occlusion (full cubes). */
  ao: boolean;
}

// ---------------------------------------------------------------- geometry helpers

type FaceKey = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
const FACE_INDEX: Record<FaceKey, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

export interface FaceSpec {
  tex: string;
  /** UV rect in pixels [u0, v0, u1, v1]; defaults from element coordinates. */
  uv?: [number, number, number, number];
  cull?: FaceKey | null;
  tint?: TintKind;
  rot?: number;
}

/** Axis-aligned element from/to in pixels (0..16), like block model JSON. */
export function element(from: V3, to: V3, faces: Partial<Record<FaceKey, FaceSpec>>): ModelQuad[] {
  const [x0, y0, z0] = from.map((v) => v / 16) as V3;
  const [x1, y1, z1] = to.map((v) => v / 16) as V3;
  const out: ModelQuad[] = [];
  for (const [k, spec] of Object.entries(faces) as [FaceKey, FaceSpec][]) {
    if (!spec) continue;
    let pos: [V3, V3, V3, V3];
    let auto: [number, number, number, number];
    switch (k) {
      case 'up':
        pos = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]];
        auto = [from[0], from[2], to[0], to[2]];
        break;
      case 'down':
        pos = [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]];
        auto = [from[0], 16 - to[2], to[0], 16 - from[2]];
        break;
      case 'north':
        pos = [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]];
        auto = [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
        break;
      case 'south':
        pos = [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]];
        auto = [from[0], 16 - to[1], to[0], 16 - from[1]];
        break;
      case 'west':
        pos = [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]];
        auto = [from[2], 16 - to[1], to[2], 16 - from[1]];
        break;
      default:
        pos = [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]];
        auto = [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
    }
    const [u0, v0, u1, v1] = (spec.uv ?? auto).map((v) => v / 16) as [number, number, number, number];
    // vertex order a,b,c,d maps to uv (u0,v0),(u0,v1),(u1,v1),(u1,v0) for all faces
    let uv: [UV, UV, UV, UV] = [
      [u0, v0],
      [u0, v1],
      [u1, v1],
      [u1, v0],
    ];
    const rot = ((spec.rot ?? 0) / 90) & 3;
    for (let r = 0; r < rot; r++) uv = [uv[1], uv[2], uv[3], uv[0]];
    out.push({ pos, uv, tex: spec.tex, face: FACE_INDEX[k], cull: spec.cull ? FACE_INDEX[spec.cull] : -1, tint: spec.tint ?? 'none' });
  }
  return out;
}

/** All six faces with the same texture, culled on block boundaries where flush. */
function box(from: V3, to: V3, tex: string | Partial<Record<FaceKey, string>>, tint: TintKind = 'none', skip: FaceKey[] = []): ModelQuad[] {
  const faces: Partial<Record<FaceKey, FaceSpec>> = {};
  const keys: FaceKey[] = ['down', 'up', 'north', 'south', 'west', 'east'];
  for (const k of keys) {
    if (skip.includes(k)) continue;
    const t = typeof tex === 'string' ? tex : tex[k] ?? tex.north ?? Object.values(tex)[0]!;
    const flush = (k === 'down' && from[1] === 0) || (k === 'up' && to[1] === 16) || (k === 'north' && from[2] === 0) || (k === 'south' && to[2] === 16) || (k === 'west' && from[0] === 0) || (k === 'east' && to[0] === 16);
    faces[k] = { tex: t, cull: flush ? k : null, tint };
  }
  return element(from, to, faces);
}

/** Rotates quads around the Y axis (block center) by 0/90/180/270 degrees (clockwise from above). */
export function rotY(quads: ModelQuad[], deg: number): ModelQuad[] {
  const r = (((deg / 90) % 4) + 4) % 4;
  if (r === 0) return quads;
  const mapFace = (f: number): number => {
    if (f < 2) return f;
    // clockwise: north->east->south->west
    const order = [2, 5, 3, 4];
    const i = order.indexOf(f);
    return order[(i + r) % 4]!;
  };
  return quads.map((q) => ({
    ...q,
    pos: q.pos.map(([x, y, z]) => {
      let px = x - 0.5;
      let pz = z - 0.5;
      for (let k = 0; k < r; k++) {
        const t = px;
        px = -pz;
        pz = t;
      }
      return [px + 0.5, y, pz + 0.5] as V3;
    }) as [V3, V3, V3, V3],
    face: mapFace(q.face),
    cull: q.cull < 0 ? -1 : mapFace(q.cull),
  }));
}

/** Rotates around the X axis by 90/180/270 (for vertical/horizontal variants). */
export function rotX(quads: ModelQuad[], deg: number): ModelQuad[] {
  const r = (((deg / 90) % 4) + 4) % 4;
  if (r === 0) return quads;
  const mapFace = (f: number): number => {
    // rotating +90 about X: up -> north? order: up(1) -> south(3) -> down(0) -> north(2)
    if (f === 4 || f === 5) return f;
    const order = [1, 3, 0, 2];
    const i = order.indexOf(f);
    return order[(i + r) % 4]!;
  };
  return quads.map((q) => ({
    ...q,
    pos: q.pos.map(([x, y, z]) => {
      let py = y - 0.5;
      let pz = z - 0.5;
      for (let k = 0; k < r; k++) {
        const t = py;
        py = -pz;
        pz = t;
      }
      return [x, py + 0.5, pz + 0.5] as V3;
    }) as [V3, V3, V3, V3],
    face: mapFace(q.face),
    cull: q.cull < 0 ? -1 : mapFace(q.cull),
  }));
}

function facingDeg(f: string | undefined): number {
  // models authored facing north; rotate clockwise
  switch (f) {
    case 'east':
      return 90;
    case 'south':
      return 180;
    case 'west':
      return 270;
    default:
      return 0;
  }
}

/** Two diagonal planes (flowers, saplings). */
function cross(tex: string, tint: TintKind = 'none', h = 1, inset = 0.14): ModelQuad[] {
  const a = inset;
  const b = 1 - inset;
  const mk = (p: [V3, V3, V3, V3]): ModelQuad => ({ pos: p, uv: [[0, 1 - h], [0, 1], [1, 1], [1, 1 - h]], tex, face: -1, cull: -1, tint });
  const q1 = mk([[a, h, a], [a, 0, a], [b, 0, b], [b, h, b]]);
  const q2 = mk([[b, h, b], [b, 0, b], [a, 0, a], [a, h, a]]);
  const q3 = mk([[a, h, b], [a, 0, b], [b, 0, a], [b, h, a]]);
  const q4 = mk([[b, h, a], [b, 0, a], [a, 0, b], [a, h, b]]);
  return [q1, q2, q3, q4];
}

/** # shaped crop planes. */
function cropPlanes(tex: string, tint: TintKind = 'none'): ModelQuad[] {
  const out: ModelQuad[] = [];
  const mk = (p: [V3, V3, V3, V3]): ModelQuad => ({ pos: p, uv: [[0, 0], [0, 1], [1, 1], [1, 0]], tex, face: -1, cull: -1, tint });
  for (const o of [0.25, 0.75]) {
    out.push(mk([[0, 1, o], [0, 0, o], [1, 0, o], [1, 1, o]]));
    out.push(mk([[1, 1, o], [1, 0, o], [0, 0, o], [0, 1, o]]));
    out.push(mk([[o, 1, 1], [o, 0, 1], [o, 0, 0], [o, 1, 0]]));
    out.push(mk([[o, 1, 0], [o, 0, 0], [o, 0, 1], [o, 1, 1]]));
  }
  return out;
}

// ---------------------------------------------------------------- texture resolution

function tx(def: BlockDef, key: string, fallback?: string): string {
  const t = def.tex;
  return t[key] ?? (fallback ? t[fallback] : undefined) ?? t.side ?? t.all ?? t.top ?? t.particle ?? 'missing_block';
}

function cubeTextures(def: BlockDef, state: number): { tex: string[]; rot: number[]; tint: TintKind[] } {
  // Blocks with a lit look (redstone lamp) or a texture per part (glitched portal frame)
  const part = def.props?.part ? getProp(state, 'part') : undefined;
  const all = def.tex.on && getProp(state, 'lit') === 'true' ? def.tex.on : part && def.tex[String(part)] ? def.tex[String(part)] : def.tex.all;
  const top = def.tex.top ?? all ?? def.tex.side!;
  const bottom = def.tex.bottom ?? (def.tex.top && !def.tex.all ? def.tex.top : undefined) ?? all ?? top;
  const side = def.tex.side ?? all ?? top;
  let tex = [bottom, top, side, side, side, side];
  let rot = [0, 0, 0, 0, 0, 0];
  const tintAll: TintKind = def.tint && def.tint !== 'grass' ? def.tint : 'none';
  let tint: TintKind[] = [tintAll, tintAll, tintAll, tintAll, tintAll, tintAll];
  if (def.id === 'grass_block') {
    const snowy = getProp(state, 'snowy') === 'true';
    tex = ['dirt', 'grass_block_top', snowy ? 'grass_block_snow' : 'grass_block_side', snowy ? 'grass_block_snow' : 'grass_block_side', snowy ? 'grass_block_snow' : 'grass_block_side', snowy ? 'grass_block_snow' : 'grass_block_side'];
    tint = ['none', 'grass', snowy ? 'none' : 'grass', snowy ? 'none' : 'grass', snowy ? 'none' : 'grass', snowy ? 'none' : 'grass'];
    return { tex, rot, tint };
  }
  if (def.id === 'podzol' || def.id === 'mycelium') {
    if (getProp(state, 'snowy') === 'true') tex = [tex[0]!, tex[1]!, 'grass_block_snow', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow'];
  }
  // Pillars / logs: axis
  const axis = getProp(state, 'axis');
  if (def.model === 'column' || (axis && def.model === 'cube')) {
    const end = def.tex.top ?? top;
    const s = def.tex.side ?? side;
    if (axis === 'x') {
      tex = [s, s, s, s, end, end];
      rot = [1, 1, 1, 1, 0, 0];
    } else if (axis === 'z') {
      tex = [s, s, end, end, s, s];
      rot = [0, 0, 0, 0, 1, 1];
    } else tex = [end, end, s, s, s, s];
    return { tex, rot, tint };
  }
  const facing = getProp(state, 'facing');
  const front = def.tex.front ? (getProp(state, 'lit') === 'true' && def.tex.front_lit ? def.tex.front_lit : def.tex.front) : undefined;
  if (front) {
    if (facing && ['north', 'south', 'west', 'east'].includes(facing)) {
      const fi = { north: 2, south: 3, west: 4, east: 5 }[facing as 'north']!;
      tex[fi] = front;
    } else if (def.id === 'crafting_table' || def.id === 'smithing_table') {
      tex[2] = front;
      tex[4] = front;
    } else tex[2] = front;
  }
  if ((def.id === 'barrel' || def.id === 'shulker_box') && facing) {
    const fi = ['down', 'up', 'north', 'south', 'west', 'east'].indexOf(facing);
    const opp = fi ^ 1;
    const t = def.tex.top!;
    const b = def.tex.bottom!;
    const s = def.tex.side!;
    tex = [s, s, s, s, s, s];
    tex[fi] = t;
    tex[opp] = b;
    if (fi >= 2) {
      // sides need rotation when lying
      rot = fi >= 4 ? [1, 1, 1, 1, 0, 0] : [0, 0, 0, 0, 1, 1];
    }
  }
  return { tex, rot, tint };
}

// ---------------------------------------------------------------- per-model builders

function slabModel(def: BlockDef, state: number): ModelQuad[] {
  const t = getProp(state, 'type');
  const tex = def.tex.all ?? def.tex.side!;
  const top = def.tex.top ?? tex;
  const bottom = def.tex.bottom ?? top;
  const faces = (y0: number, y1: number): ModelQuad[] =>
    element([0, y0, 0], [16, y1, 16], {
      down: { tex: bottom, cull: y0 === 0 ? 'down' : null },
      up: { tex: top, cull: y1 === 16 ? 'up' : null },
      north: { tex, cull: 'north' },
      south: { tex, cull: 'south' },
      west: { tex, cull: 'west' },
      east: { tex, cull: 'east' },
    });
  if (t === 'top') return faces(8, 16);
  if (t === 'double') return faces(0, 16);
  return faces(0, 8);
}

function stairsModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all ?? def.tex.side!;
  const facing = getProp(state, 'facing')!;
  const half = getProp(state, 'half');
  const shape = getProp(state, 'shape')!;
  const parts: [V3, V3][] = [[[0, 0, 0], [16, 8, 16]]];
  // high part for facing north: z 0..8
  switch (shape) {
    case 'inner_left':
      parts.push([[0, 8, 0], [16, 16, 8]], [[0, 8, 8], [8, 16, 16]]);
      break;
    case 'inner_right':
      parts.push([[0, 8, 0], [16, 16, 8]], [[8, 8, 8], [16, 16, 16]]);
      break;
    case 'outer_left':
      parts.push([[0, 8, 0], [8, 16, 8]]);
      break;
    case 'outer_right':
      parts.push([[8, 8, 0], [16, 16, 8]]);
      break;
    default:
      parts.push([[0, 8, 0], [16, 16, 8]]);
  }
  let quads: ModelQuad[] = [];
  for (const [f, t] of parts) quads.push(...box(f, t, tex));
  quads = rotY(quads, facingDeg(facing));
  if (half === 'top') quads = mirrorY(quads);
  return quads;
}

/** Vertical mirror (y -> 1-y); reverses winding so faces stay outward. */
export function mirrorY(quads: ModelQuad[]): ModelQuad[] {
  const mapFace = (f: number): number => (f === 0 ? 1 : f === 1 ? 0 : f);
  return quads.map((q) => ({
    ...q,
    pos: [q.pos[3], q.pos[2], q.pos[1], q.pos[0]].map(([x, y, z]) => [x, 1 - y, z]) as [V3, V3, V3, V3],
    uv: [q.uv[3], q.uv[2], q.uv[1], q.uv[0]],
    face: mapFace(q.face),
    cull: q.cull < 0 ? -1 : mapFace(q.cull),
  }));
}

function fenceModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all!;
  const q: ModelQuad[] = box([6, 0, 6], [10, 16, 10], tex);
  for (const [d, deg] of [
    ['north', 0],
    ['east', 90],
    ['south', 180],
    ['west', 270],
  ] as const) {
    if (getProp(state, d) !== 'true') continue;
    q.push(...rotY([...box([7, 12, 0], [9, 15, 6], tex, 'none', ['south']), ...box([7, 6, 0], [9, 9, 6], tex, 'none', ['south'])], deg));
  }
  return q;
}

function wallModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all!;
  const q: ModelQuad[] = [];
  if (getProp(state, 'up') === 'true') q.push(...box([4, 0, 4], [12, 16, 12], tex));
  for (const [d, deg] of [
    ['north', 0],
    ['east', 90],
    ['south', 180],
    ['west', 270],
  ] as const) {
    if (getProp(state, d) !== 'true') continue;
    q.push(...rotY(box([5, 0, 0], [11, 14, 8], tex, 'none', ['south']), deg));
  }
  if (q.length === 0) q.push(...box([4, 0, 4], [12, 16, 12], tex));
  return q;
}

function paneModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all!;
  const edge = def.tex.edge ?? tex;
  const q: ModelQuad[] = [];
  const conns = ['north', 'east', 'south', 'west'].filter((d) => getProp(state, d) === 'true');
  const post = element([7, 0, 7], [9, 16, 9], {
    up: { tex: edge, cull: 'up' },
    down: { tex: edge, cull: 'down' },
    north: { tex },
    south: { tex },
    west: { tex },
    east: { tex },
  });
  q.push(...post);
  for (const [d, deg] of [
    ['north', 0],
    ['east', 90],
    ['south', 180],
    ['west', 270],
  ] as const) {
    if (!conns.includes(d)) continue;
    q.push(
      ...rotY(
        element([7, 0, 0], [9, 16, 7], {
          up: { tex: edge, cull: 'up' },
          down: { tex: edge, cull: 'down' },
          west: { tex },
          east: { tex },
          north: { tex: edge, cull: 'north' },
        }),
        deg,
      ),
    );
  }
  return q;
}

function doorModel(def: BlockDef, state: number): ModelQuad[] {
  const facing = getProp(state, 'facing')!;
  const upper = getProp(state, 'half') === 'upper';
  const open = getProp(state, 'open') === 'true';
  const hinge = getProp(state, 'hinge');
  const tex = upper ? def.tex.top! : def.tex.bottom!;
  // Door panel along the south edge for facing north (panel on near side, see shapes.ts)
  let deg = facingDeg(facing);
  if (open) deg += hinge === 'left' ? 90 : -90;
  const quads = element([0, 0, 13], [16, 16, 16], {
    north: { tex },
    south: { tex, uv: [16, 0, 0, 16] },
    west: { tex, uv: [13, 0, 16, 16] },
    east: { tex, uv: [0, 0, 3, 16] },
    up: upper ? { tex, uv: [0, 13, 16, 16] } : undefined,
    down: !upper ? { tex, uv: [0, 13, 16, 16] } : undefined,
  });
  return rotY(quads, deg);
}

function trapdoorModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all!;
  const facing = getProp(state, 'facing')!;
  const open = getProp(state, 'open') === 'true';
  const top = getProp(state, 'half') === 'top';
  if (open) return rotY(box([0, 0, 13], [16, 16, 16], tex), facingDeg(facing));
  return top ? box([0, 13, 0], [16, 16, 16], tex) : box([0, 0, 0], [16, 3, 16], tex);
}

function torchModel(tex: string): ModelQuad[] {
  return element([7, 0, 7], [9, 10, 9], {
    up: { tex, uv: [7, 6, 9, 8] },
    down: { tex, uv: [7, 13, 9, 15] },
    north: { tex, uv: [7, 6, 9, 16] },
    south: { tex, uv: [7, 6, 9, 16] },
    west: { tex, uv: [7, 6, 9, 16] },
    east: { tex, uv: [7, 6, 9, 16] },
  });
}

function wallTorchModel(tex: string, facing: string): ModelQuad[] {
  // tilt: shift top away from wall. Build upright torch then shear.
  const base = torchModel(tex).map((q) => ({
    ...q,
    pos: q.pos.map(([x, y, z]) => [x, y + 3.5 / 16, z + 0.3 * (1 - y) + 0.2 - 0.0] as V3) as [V3, V3, V3, V3],
  }));
  // after shift the torch base sits near south edge (z~0.7..0.9) and top leans north
  const sheared = base.map((q) => ({ ...q, pos: q.pos.map(([x, y, z]) => [x, y, z - (y - 3.5 / 16) * 0.35 + 0.1] as V3) as [V3, V3, V3, V3] }));
  return rotY(sheared, facingDeg(facing));
}

function ladderModel(tex: string, facing: string): ModelQuad[] {
  const q = element([0, 0, 15.2], [16, 16, 15.2], { north: { tex }, south: { tex, uv: [16, 0, 0, 16] } });
  return rotY(q, facingDeg(facing));
}

function liquidMarker(): BakedModel {
  return { kind: ModelKind.Liquid, selfCull: true, ao: false };
}

function chestModel(def: BlockDef, state: number): ModelQuad[] {
  const base = def.tex.all!;
  const type = getProp(state, 'type') ?? 'single';
  const facing = getProp(state, 'facing')!;
  const top = base + '_top';
  const side = base + '_side';
  const front = base + '_front';
  let x0 = 1;
  let x1 = 15;
  if (type === 'left') x1 = 16;
  if (type === 'right') x0 = 0;
  const q = element([x0, 0, 1], [x1, 14, 15], {
    up: { tex: top },
    down: { tex: top, cull: 'down' },
    north: { tex: side },
    south: { tex: front },
    west: type === 'right' ? undefined : { tex: side },
    east: type === 'left' ? undefined : { tex: side },
  });
  // latch
  if (type === 'single' || type === 'left') {
    const lx = type === 'left' ? 15 : 7;
    q.push(...element([lx, 7, 15], [lx + 2, 11, 16], { south: { tex: 'iron_block' }, up: { tex: 'iron_block' }, down: { tex: 'iron_block' }, west: { tex: 'iron_block' }, east: { tex: 'iron_block' } }));
  }
  // chest models are authored facing south (front on +z); rotate so front faces `facing`
  return rotY(q, facingDeg(facing) + 180);
}

function bedModel(def: BlockDef, state: number): ModelQuad[] {
  const color = (def.data?.color as string) ?? 'red';
  const head = getProp(state, 'part') === 'head';
  const facing = getProp(state, 'facing')!;
  const topTex = `${color}_bed_${head ? 'head' : 'foot'}_top`;
  const side = `${color}_bed_side`;
  const q = element([0, 3, 0], [16, 9, 16], {
    up: { tex: topTex },
    down: { tex: 'bed_bottom' },
    north: head ? { tex: side } : undefined,
    south: !head ? { tex: side } : undefined,
    west: { tex: side },
    east: { tex: side },
  });
  // legs
  const legZ = head ? [0, 3] : [13, 16];
  for (const lx of [0, 13]) q.push(...box([lx, 0, legZ[0]!], [lx + 3, 3, legZ[1]!], 'oak_planks'));
  return rotY(q, facingDeg(facing));
}

function lanternModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all!;
  const hanging = getProp(state, 'hanging') === 'true';
  const dy = hanging ? 1 : 0;
  const q = [...box([5, dy, 5], [11, 7 + dy, 11], tex), ...box([6, 7 + dy, 6], [10, 9 + dy, 10], tex)];
  if (hanging) q.push(...cross('chain', 'none', 1, 0.44).map((c) => ({ ...c, pos: c.pos.map(([x, y, z]) => [x, 10 / 16 + y * (6 / 16), z]) as [V3, V3, V3, V3] })));
  return q;
}

function carpetLike(tex: string, h: number, tint: TintKind = 'none'): ModelQuad[] {
  return element([0, 0, 0], [16, h, 16], {
    up: { tex, cull: h === 16 ? 'up' : null, tint },
    down: { tex, cull: 'down', tint },
    north: { tex, cull: 'north', tint },
    south: { tex, cull: 'south', tint },
    west: { tex, cull: 'west', tint },
    east: { tex, cull: 'east', tint },
  });
}

function vineModel(def: BlockDef, state: number): ModelQuad[] {
  const tex = def.tex.all!;
  const tint = def.tint ?? 'none';
  const q: ModelQuad[] = [];
  const o = 0.8;
  for (const [d, deg] of [
    ['north', 0],
    ['east', 90],
    ['south', 180],
    ['west', 270],
  ] as const) {
    if (getProp(state, d) !== 'true') continue;
    q.push(...rotY(element([0, 0, o], [16, 16, o], { south: { tex, tint }, north: { tex, tint, uv: [16, 0, 0, 16] } }), deg));
  }
  if (getProp(state, 'up') === 'true') q.push(...element([0, 15.2, 0], [16, 15.2, 16], { down: { tex, tint }, up: { tex, tint } }));
  if (getProp(state, 'down') === 'true') q.push(...element([0, 0.8, 0], [16, 0.8, 16], { down: { tex, tint }, up: { tex, tint } }));
  return q;
}

function portalModel(tex: string, axis: string): ModelQuad[] {
  const q = element([0, 0, 6], [16, 16, 10], { north: { tex }, south: { tex } });
  return axis === 'z' ? rotY(q, 90) : q;
}

function buttonModel(tex: string, state: number, lever: boolean): ModelQuad[] {
  const face = getProp(state, 'face');
  const facing = getProp(state, 'facing')!;
  const pressed = getProp(state, 'powered') === 'true';
  let q: ModelQuad[];
  if (lever) {
    q = [...box([5, 0, 4], [11, 3, 12], 'cobblestone'), ...element([7, 1, 7], [9, 11, 9], { north: { tex }, south: { tex }, west: { tex }, east: { tex }, up: { tex } })];
    const tilt = pressed ? -0.3 : 0.3;
    q = q.map((qq, i) => (i < 6 ? qq : { ...qq, pos: qq.pos.map(([x, y, z]) => [x, y, z + (y - 1 / 16) * tilt] as V3) as [V3, V3, V3, V3] }));
  } else q = box([5, 0, 6], [11, pressed ? 1 : 2, 10], tex);
  if (face === 'ceiling') q = rotX(rotX(q, 90), 90);
  else if (face === 'wall') q = rotX(q, 90);
  // wall: authored against north wall then rotated; facing points away from wall
  return rotY(q, facingDeg(face === 'wall' ? facing : facing) + (face === 'wall' ? 180 : 0));
}

function signModel(state: number, wall: boolean): ModelQuad[] {
  const tex = 'oak_planks';
  if (wall) return rotY(box([0, 4.5, 14], [16, 12.5, 16], tex), facingDeg(getProp(state, 'facing')));
  const board = box([0, 7, 7.25], [16, 15, 8.75], tex);
  const post = box([7.25, 0, 7.25], [8.75, 7, 8.75], 'oak_log');
  const rot = parseInt(getProp(state, 'rotation') ?? '0', 10);
  const ang = (rot * 22.5 * Math.PI) / 180;
  return [...board, ...post].map((q) => ({
    ...q,
    face: -1,
    cull: -1,
    pos: q.pos.map(([x, y, z]) => {
      const px = x - 0.5;
      const pz = z - 0.5;
      return [px * Math.cos(ang) - pz * Math.sin(ang) + 0.5, y, px * Math.sin(ang) + pz * Math.cos(ang) + 0.5] as V3;
    }) as [V3, V3, V3, V3],
  }));
}

/** Redstone dust: a dot with arms to connected sides, climbing walls where it goes up. */
function wireModel(def: BlockDef, state: number): ModelQuad[] {
  const on = parseInt(getProp(state, 'power') ?? '0', 10) > 0;
  const line = on ? def.tex.on! : def.tex.all!;
  const dot = on ? def.tex.on_dot! : def.tex.dot!;
  const y = 0.25;
  const q: ModelQuad[] = [];
  q.push(...element([0, y, 0], [16, y, 16], { up: { tex: dot }, down: { tex: dot } }));
  const dirs: [string, number][] = [
    ['north', 0],
    ['east', 90],
    ['south', 180],
    ['west', 270],
  ];
  for (const [d, deg] of dirs) {
    const v = getProp(state, d);
    if (v === 'none') continue;
    // Arm from the centre to the north edge, rotated into place
    const arm = element([0, y + 0.01, 0], [16, y + 0.01, 8], { up: { tex: line, uv: [0, 0, 16, 8], rot: 0 }, down: { tex: line, uv: [0, 0, 16, 8] } });
    q.push(...rotY(arm, deg));
    if (v === 'up') q.push(...rotY(element([0, 0, 0.3], [16, 16, 0.3], { south: { tex: line }, north: { tex: line } }), deg));
  }
  return q;
}

function custom(def: BlockDef, state: number): ModelQuad[] {
  switch (def.id) {
    case 'scaffolding':
      return [...box([0, 14, 0], [16, 16, 16], { up: def.tex.top!, down: def.tex.bottom!, north: def.tex.side!, south: def.tex.side!, west: def.tex.side!, east: def.tex.side! }), ...box([0, 0, 0], [2, 14, 2], def.tex.side!), ...box([14, 0, 0], [16, 14, 2], def.tex.side!), ...box([0, 0, 14], [2, 14, 16], def.tex.side!), ...box([14, 0, 14], [16, 14, 16], def.tex.side!)];
    case 'cake': {
      const bites = parseInt(getProp(state, 'bites') ?? '0', 10);
      return element([1 + bites * 2, 0, 1], [15, 8, 15], { up: { tex: def.tex.top! }, down: { tex: def.tex.bottom! }, north: { tex: def.tex.side! }, south: { tex: def.tex.side! }, west: { tex: bites > 0 ? def.tex.inner! : def.tex.side! }, east: { tex: def.tex.side! } });
    }
    case 'flower_pot': {
      const q = box([5, 0, 5], [11, 6, 11], def.tex.all!);
      const plant = getProp(state, 'plant');
      if (plant && plant !== 'none') {
        const pb = blocks.find((b) => b.id === plant);
        const tex = pb?.def.tex.all ?? pb?.def.tex.side;
        if (tex) {
          // The plant sits in the soil, a little smaller than in the ground
          const c = cross(tex, pb!.def.tint ?? 'none', 0.75, 0.2).map((qq) => ({ ...qq, pos: qq.pos.map(([px, py, pz]) => [0.5 + (px - 0.5) * 0.75, 0.25 + py, 0.5 + (pz - 0.5) * 0.75] as V3) as [V3, V3, V3, V3] }));
          q.push(...c);
        }
      }
      return q;
    }
    case 'candle': {
      // One to four candles grouped on the block, like a little cluster
      const n = parseInt(getProp(state, 'candles') ?? '1', 10);
      const tex = getProp(state, 'lit') === 'true' ? def.tex.lit! : def.tex.all!;
      const spots: [number, number, number][][] = [
        [[7, 7, 6]],
        [[5, 7, 6], [9, 6, 5]],
        [[5, 8, 6], [9, 8, 5], [7, 5, 4]],
        [[5, 5, 6], [9, 5, 5], [5, 9, 4], [9, 9, 3]],
      ];
      const out: ModelQuad[] = [];
      for (const [cx, cz, h] of spots[n - 1]!) {
        const sides = { tex, uv: [6, 16 - h, 8, 16] as [number, number, number, number] };
        out.push(...element([cx, 0, cz], [cx + 2, h, cz + 2], { up: { tex, uv: [6, 6, 8, 8] }, north: sides, south: sides, west: sides, east: sides }));
        // Wick and flame on a small cross above the wax
        out.push(
          ...cross(tex, 'none', 1, 0).map((q) => ({
            ...q,
            pos: q.pos.map(([px, py, pz]) => [(cx + 1) / 16 + (px - 0.5) * 0.25, h / 16 + py * 0.375, (cz + 1) / 16 + (pz - 0.5) * 0.25] as V3) as [V3, V3, V3, V3],
            uv: [[6 / 16, 0], [6 / 16, 6 / 16], [10 / 16, 6 / 16], [10 / 16, 0]] as [UV, UV, UV, UV],
          })),
        );
      }
      return out;
    }
    case 'cactus_flower':
      // A small bloom sitting on top of the cactus below
      return [...box([6, 0, 6], [10, 2, 10], def.tex.all!, 'none', ['down']), ...cross(def.tex.all!, 'none', 0.5, 0.22)];
    case 'ancient_urn': {
      const side = def.tex.all!;
      const top = def.tex.top!;
      return [...box([3, 0, 3], [13, 11, 13], { up: top, down: top, north: side, south: side, west: side, east: side }), ...box([5, 11, 5], [11, 14, 11], { up: top, down: top, north: side, south: side, west: side, east: side }), ...box([4, 14, 4], [12, 15, 12], { up: top, down: top, north: side, south: side, west: side, east: side })];
    }
    case 'bracket_fungus': {
      // Shelves growing out of the log behind (authored facing north, the log to the south)
      const t = { up: def.tex.top!, down: def.tex.all!, north: def.tex.all!, south: def.tex.all!, west: def.tex.all!, east: def.tex.all! };
      return rotY([...box([2, 5, 9], [14, 7, 16], t), ...box([5, 10, 11], [12, 11.5, 16], t)], facingDeg(getProp(state, 'facing')));
    }
    case 'seashell': {
      const t = def.tex.all!;
      return [...box([4, 0, 5], [12, 2, 11], t), ...box([6, 2, 6], [10, 3, 10], t)];
    }
    case 'big_dripleaf': {
      // A stem up to a wide leaf that droops as it tilts
      const tilt = getProp(state, 'tilt');
      const drop = tilt === 'full' ? 4 : tilt === 'partial' ? 2 : 0;
      const leaf = element([0, 15 - drop, 0], [16, 15 - drop, 16], { up: { tex: def.tex.top! }, down: { tex: def.tex.top! } });
      const rim = element([0, 13 - drop, 0], [16, 15 - drop, 16], { north: { tex: def.tex.side! }, south: { tex: def.tex.side! }, west: { tex: def.tex.side! }, east: { tex: def.tex.side! } });
      const stem = cross(def.tex.stem!, 'none', 0.85, 0.3);
      return [...rotY([...leaf, ...rim], facingDeg(getProp(state, 'facing'))), ...stem];
    }
    case 'sculk_shrieker': {
      // A sculk base with a bony, open-mouthed top
      const base = element([0, 0, 0], [16, 8, 16], { up: { tex: def.tex.top! }, down: { tex: def.tex.bottom!, cull: 'down' }, north: { tex: def.tex.side!, cull: 'north' }, south: { tex: def.tex.side!, cull: 'south' }, west: { tex: def.tex.side!, cull: 'west' }, east: { tex: def.tex.side!, cull: 'east' } });
      const inner = element([1, 8, 1], [15, 15, 15], { north: { tex: def.tex.inner! }, south: { tex: def.tex.inner! }, west: { tex: def.tex.inner! }, east: { tex: def.tex.inner! } });
      return [...base, ...inner];
    }
    case 'conduit': {
      // A small cage floating in the middle of the block
      const t = def.tex.all!;
      return box([5, 5, 5], [11, 11, 11], t);
    }
    case 'stonecutter':
      return [...element([0, 0, 0], [16, 9, 16], { up: { tex: def.tex.top! }, down: { tex: def.tex.bottom!, cull: 'down' }, north: { tex: def.tex.side!, cull: 'north' }, south: { tex: def.tex.side!, cull: 'south' }, west: { tex: def.tex.side!, cull: 'west' }, east: { tex: def.tex.side!, cull: 'east' } })];
    case 'redstone_wire':
      return wireModel(def, state);
    case 'sculk_sensor':
      return element([0, 0, 0], [16, 8, 16], { up: { tex: getProp(state, 'phase') === 'active' ? def.tex.on! : def.tex.top! }, down: { tex: def.tex.bottom!, cull: 'down' }, north: { tex: def.tex.side!, cull: 'north' }, south: { tex: def.tex.side!, cull: 'south' }, west: { tex: def.tex.side!, cull: 'west' }, east: { tex: def.tex.side!, cull: 'east' } });
    case 'chorus_plant': {
      const q = box([4, 4, 4], [12, 12, 12], def.tex.all!);
      const arms: [string, V3, V3][] = [
        ['north', [4, 4, 0], [12, 12, 4]],
        ['south', [4, 4, 12], [12, 12, 16]],
        ['west', [0, 4, 4], [4, 12, 12]],
        ['east', [12, 4, 4], [16, 12, 12]],
        ['up', [4, 12, 4], [12, 16, 12]],
        ['down', [4, 0, 4], [12, 4, 12]],
      ];
      for (const [d, f, t] of arms) if (getProp(state, d) === 'true') q.push(...box(f, t, def.tex.all!));
      return q;
    }
    default:
      return box([0, 0, 0], [16, 16, 16], def.tex.all ?? def.tex.side ?? 'missing_block');
  }
}

function bakeState(state: number): BakedModel {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const def = bt.def;
  const tint = def.tint ?? 'none';
  const quads = (q: ModelQuad[], ao = false): BakedModel => ({ kind: ModelKind.Quads, quads: q, selfCull: false, ao });
  switch (def.model) {
    case 'none':
      return { kind: ModelKind.None, selfCull: false, ao: false };
    case 'cube':
    case 'column':
    case 'mushroom_block': {
      const { tex, rot, tint: t } = cubeTextures(def, state);
      if (def.id === 'end_portal_frame') break;
      const selfCull = def.layer === 'cutout' || def.layer === 'translucent';
      return { kind: ModelKind.Cube, cubeTex: tex, cubeRot: rot, cubeTint: t, selfCull, ao: true };
    }
    case 'liquid':
      return liquidMarker();
    case 'cross':
      if (def.id === 'sugar_cane' || def.id === 'kelp' || def.id === 'seagrass' || def.id.endsWith('_coral') || def.id === 'twisting_vines') return quads(cross(def.tex.all!, tint, 1, 0.14));
      if (def.id === 'sweet_berry_bush') return quads(cross(`sweet_berry_bush_stage${getProp(state, 'age') ?? 0}`, 'none'));
      return quads(cross(def.tex.all!, tint));
    case 'crop': {
      const age = getProp(state, 'age') ?? '0';
      const base = def.tex.all!;
      return quads(cropPlanes(`${base}${age}`, 'none'));
    }
    case 'double_plant': {
      const upper = getProp(state, 'half') === 'upper';
      return quads(cross(upper ? def.tex.top! : def.tex.bottom!, tint));
    }
    case 'slab':
      return quads(slabModel(def, state), true);
    case 'stairs':
      return quads(stairsModel(def, state), true);
    case 'fence':
      return quads(fenceModel(def, state));
    case 'fence_gate': {
      const tex = def.tex.all!;
      const open = getProp(state, 'open') === 'true';
      const facing = getProp(state, 'facing')!;
      const dy = getProp(state, 'in_wall') === 'true' ? -3 : 0;
      let q = [...box([0, 5 + dy, 7], [2, 16 + dy, 9], tex), ...box([14, 5 + dy, 7], [16, 16 + dy, 9], tex)];
      if (open) q.push(...box([0, 6 + dy, 9], [2, 15 + dy, 15], tex), ...box([14, 6 + dy, 9], [16, 15 + dy, 15], tex));
      else q.push(...box([2, 6 + dy, 7], [14, 9 + dy, 9], tex), ...box([2, 12 + dy, 7], [14, 15 + dy, 9], tex), ...box([6, 9 + dy, 7], [10, 12 + dy, 9], tex));
      q = rotY(q, facingDeg(facing));
      return quads(q);
    }
    case 'wall':
      return quads(wallModel(def, state));
    case 'pane':
    case 'bars':
      return quads(paneModel(def, state));
    case 'door':
      return quads(doorModel(def, state));
    case 'trapdoor':
      return quads(trapdoorModel(def, state));
    case 'torch':
      return quads(torchModel(getProp(state, 'lit') === 'false' && def.tex.off ? def.tex.off : def.tex.all!));
    case 'wall_torch':
      return quads(wallTorchModel(getProp(state, 'lit') === 'false' && def.tex.off ? def.tex.off : def.tex.all!, getProp(state, 'facing')!));
    case 'ladder':
      return quads(ladderModel(def.tex.all!, getProp(state, 'facing')!));
    case 'carpet':
      return quads(carpetLike(def.tex.all!, 1, tint));
    case 'pressure_plate':
      return quads(element([1, 0, 1], [15, getProp(state, 'powered') === 'true' ? 0.5 : 1, 15], { up: { tex: def.tex.all! }, down: { tex: def.tex.all!, cull: 'down' }, north: { tex: def.tex.all! }, south: { tex: def.tex.all! }, west: { tex: def.tex.all! }, east: { tex: def.tex.all! } }));
    case 'snow_layer': {
      const l = parseInt(getProp(state, 'layers') ?? '1', 10);
      return quads(carpetLike(def.tex.all!, l * 2), true);
    }
    case 'farmland': {
      const moist = getProp(state, 'moisture') === '7';
      return quads(element([0, 0, 0], [16, 15, 16], { up: { tex: moist ? def.tex.top_moist! : def.tex.top! }, down: { tex: 'dirt', cull: 'down' }, north: { tex: 'dirt', cull: 'north' }, south: { tex: 'dirt', cull: 'south' }, west: { tex: 'dirt', cull: 'west' }, east: { tex: 'dirt', cull: 'east' } }), true);
    }
    case 'path':
      return quads(element([0, 0, 0], [16, 15, 16], { up: { tex: def.tex.top! }, down: { tex: 'dirt', cull: 'down' }, north: { tex: def.tex.side!, cull: 'north' }, south: { tex: def.tex.side!, cull: 'south' }, west: { tex: def.tex.side!, cull: 'west' }, east: { tex: def.tex.side!, cull: 'east' } }), true);
    case 'cactus':
      return quads([
        ...element([0, 0, 0], [16, 16, 16], { up: { tex: def.tex.top!, cull: 'up' }, down: { tex: def.tex.bottom!, cull: 'down' } }),
        ...element([1, 0, 1], [15, 16, 15], { north: { tex: def.tex.side!, uv: [0, 0, 16, 16] }, south: { tex: def.tex.side!, uv: [0, 0, 16, 16] }, west: { tex: def.tex.side!, uv: [0, 0, 16, 16] }, east: { tex: def.tex.side!, uv: [0, 0, 16, 16] } }),
      ]);
    case 'chest':
      return quads(chestModel(def, state));
    case 'bed':
      return quads(bedModel(def, state));
    case 'lantern':
      return quads(lanternModel(def, state));
    case 'portal':
      return { kind: ModelKind.Quads, quads: portalModel(def.tex.all!, getProp(state, 'axis') ?? 'x'), selfCull: true, ao: false };
    case 'end_portal':
      return quads(element([0, 0, 0], [16, 12, 16], { up: { tex: def.tex.all! }, down: { tex: def.tex.all!, cull: 'down' } }));
    case 'end_portal_frame': {
      const q = element([0, 0, 0], [16, 13, 16], { up: { tex: def.tex.top! }, down: { tex: def.tex.bottom!, cull: 'down' }, north: { tex: def.tex.side!, cull: 'north' }, south: { tex: def.tex.side!, cull: 'south' }, west: { tex: def.tex.side!, cull: 'west' }, east: { tex: def.tex.side!, cull: 'east' } });
      if (getProp(state, 'eye') === 'true') q.push(...box([4, 13, 4], [12, 16, 12], def.tex.eye!));
      return quads(q);
    }
    case 'enchanting_table':
      return quads(element([0, 0, 0], [16, 12, 16], { up: { tex: def.tex.top! }, down: { tex: def.tex.bottom!, cull: 'down' }, north: { tex: def.tex.side!, cull: 'north' }, south: { tex: def.tex.side!, cull: 'south' }, west: { tex: def.tex.side!, cull: 'west' }, east: { tex: def.tex.side!, cull: 'east' } }));
    case 'anvil': {
      const t = def.tex.all!;
      const top = def.tex.top ?? t;
      const q = [...box([2, 0, 2], [14, 4, 14], t), ...box([4, 4, 3], [12, 5, 13], t), ...box([6, 5, 4], [10, 10, 12], t), ...element([3, 10, 0], [13, 16, 16], { up: { tex: top }, down: { tex: t }, north: { tex: t }, south: { tex: t }, west: { tex: t }, east: { tex: t } })];
      return quads(rotY(q, facingDeg(getProp(state, 'facing')) + 90));
    }
    case 'brewing_stand':
      return quads([...box([1, 0, 1], [15, 2, 15], def.tex.base!), ...box([7, 2, 7], [9, 14, 9], def.tex.all!)]);
    case 'cauldron': {
      const side = def.tex.all!;
      const inner = def.tex.inner!;
      const top = def.tex.top!;
      const q = [
        ...element([0, 3, 0], [16, 16, 16], { north: { tex: side, cull: 'north' }, south: { tex: side, cull: 'south' }, west: { tex: side, cull: 'west' }, east: { tex: side, cull: 'east' }, up: { tex: top, cull: 'up' } }),
        ...element([2, 4, 2], [14, 16, 14], { north: { tex: inner }, south: { tex: inner }, west: { tex: inner }, east: { tex: inner }, up: { tex: inner } }).map((qq) => ({ ...qq, pos: [qq.pos[3], qq.pos[2], qq.pos[1], qq.pos[0]] as [V3, V3, V3, V3], face: qq.face === 1 ? 1 : qq.face ^ 1 })),
        ...box([0, 0, 0], [4, 3, 2], side),
        ...box([12, 0, 0], [16, 3, 2], side),
        ...box([0, 0, 14], [4, 3, 16], side),
        ...box([12, 0, 14], [16, 3, 16], side),
      ];
      const lvl = parseInt(getProp(state, 'level') ?? '0', 10);
      if (lvl > 0 && def.id === 'cauldron') q.push(...element([2, 4 + lvl * 3, 2], [14, 4 + lvl * 3, 14], { up: { tex: 'water_still', tint: 'water' } }));
      if (lvl > 0 && def.id === 'composter') q.push(...element([2, 2 + lvl * 1.5, 2], [14, 2 + lvl * 1.5, 14], { up: { tex: 'dirt' } }));
      return quads(q);
    }
    case 'sign':
      return quads(signModel(state, false));
    case 'wall_sign':
      return quads(signModel(state, true));
    case 'vine':
      return quads(vineModel(def, state));
    case 'lily_pad':
      return quads(element([0, 0.25, 0], [16, 0.25, 16], { up: { tex: def.tex.all!, tint: 'lily' }, down: { tex: def.tex.all!, tint: 'lily' } }));
    case 'fire': {
      const t = def.tex.all!;
      const planes: ModelQuad[] = [];
      for (const o of [1.6, 14.4]) {
        planes.push(...element([0, 0, o], [16, 16, o], { north: { tex: t }, south: { tex: t } }));
        planes.push(...element([o, 0, 0], [o, 16, 16], { west: { tex: t }, east: { tex: t } }));
      }
      return quads([...planes.map((q) => ({ ...q, face: -1 })), ...cross(t)]);
    }
    case 'button':
      return quads(buttonModel(def.tex.all!, state, false));
    case 'lever':
      return quads(buttonModel(def.tex.all!, state, true));
    case 'chain':
    case 'rod': {
      const axis = getProp(state, 'axis') ?? ({ up: 'y', down: 'y', north: 'z', south: 'z', west: 'x', east: 'x' } as Record<string, string>)[getProp(state, 'facing') ?? 'up'] ?? 'y';
      let q = def.id === 'bamboo' ? box([6, 0, 6], [10, 16, 10], def.tex.all!) : def.model === 'rod' ? box([7, 0, 7], [9, 16, 9], def.tex.all!) : cross(def.tex.all!, 'none', 1, 0.44);
      if (axis === 'x') q = rotY(rotX(q, 90), 90);
      else if (axis === 'z') q = rotX(q, 90);
      return quads(q);
    }
    case 'dripstone': {
      const up = getProp(state, 'vertical_direction') === 'up';
      let q = cross(def.tex.all!, 'none', 1, 0.3);
      if (!up) q = q.map((qq) => ({ ...qq, pos: qq.pos.map(([x, y, z]) => [x, 1 - y, z]) as [V3, V3, V3, V3], uv: qq.uv.map(([u, v]) => [u, 1 - v]) as [UV, UV, UV, UV] })).map((qq) => ({ ...qq, pos: [qq.pos[3], qq.pos[2], qq.pos[1], qq.pos[0]] as [V3, V3, V3, V3], uv: [qq.uv[3], qq.uv[2], qq.uv[1], qq.uv[0]] as [UV, UV, UV, UV] }));
      return quads(q);
    }
    case 'dragon_egg':
      return quads([...box([1, 0, 1], [15, 8, 15], def.tex.all!), ...box([3, 8, 3], [13, 13, 13], def.tex.all!), ...box([5, 13, 5], [11, 16, 11], def.tex.all!)]);
    case 'campfire': {
      const lit = getProp(state, 'lit') === 'true';
      const q = [...box([1, 0, 0], [5, 4, 16], def.tex.log!), ...box([11, 0, 0], [15, 4, 16], def.tex.log!), ...box([0, 3, 1], [16, 7, 5], def.tex.log!), ...box([0, 3, 11], [16, 7, 15], def.tex.log!)];
      if (lit) q.push(...cross(def.tex.fire!, 'none', 1, 0.2));
      return quads(rotY(q, facingDeg(getProp(state, 'facing'))));
    }
    case 'hanging_plant': {
      let t = def.tex.all!;
      if (def.id === 'cave_vines' && getProp(state, 'berries') === 'true') t = def.tex.lit!;
      return quads(cross(t, tint));
    }
    case 'custom':
      return quads(custom(def, state));
    case 'layer':
      return quads(carpetLike(def.tex.all!, 2));
  }
  // generic fallback: full cube quads
  return quads(box([0, 0, 0], [16, 16, 16], tx(def, 'all')));
}

let baked: BakedModel[] | null = null;

export function bakedModels(): BakedModel[] {
  if (baked) return baked;
  const n = stateCount();
  baked = new Array(n);
  for (let s = 0; s < n; s++) {
    try {
      baked[s] = bakeState(s);
    } catch (e) {
      baked[s] = { kind: ModelKind.Quads, quads: box([0, 0, 0], [16, 16, 16], 'missing_block'), selfCull: false, ao: false };
      console.warn('model bake failed for', blockOf(s).id, e);
    }
  }
  return baked;
}

export function modelFor(state: number): BakedModel {
  return bakedModels()[state]!;
}
