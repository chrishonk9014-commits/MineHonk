/**
 * Compact mob model authoring: parts are described with sizes, pivots and
 * colours; UVs are packed automatically and a skin is painted per part
 * (with optional face details). Produces a BoxModel-compatible definition.
 */
import * as THREE from 'three';
import type { ModelDef, PartDef } from './BoxModel';
import { Random, hashString } from '../../../common/math/rng';

export type FaceName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface Colors {
  all?: string;
  top?: string;
  bottom?: string;
  front?: string;
  back?: string;
  side?: string;
}

export interface KitPart {
  name: string;
  parent?: string;
  pivot: [number, number, number];
  from: [number, number, number];
  size: [number, number, number];
  rot?: [number, number, number];
  inflate?: number;
  colors: Colors;
  /** Noise strength for this part's texture. */
  noise?: number;
  /** Extra painting on specific faces: receives the face rectangle (texture pixels). */
  paint?: (p: FacePainter) => void;
  /** Part is hidden (e.g. alternative layers toggled at runtime). */
  hidden?: boolean;
}

export interface FacePainter {
  /** Draws pixels on a face, x/y relative to the face's top-left (as seen from outside). */
  px(face: FaceName, x: number, y: number, color: string, w?: number, h?: number): void;
  /** Fills a whole face. */
  fill(face: FaceName, color: string): void;
  /** Random speckles over a face. */
  speckle(face: FaceName | 'all', color: string, density: number): void;
  readonly size: [number, number, number];
  readonly rng: Random;
}

interface Placed {
  part: KitPart;
  u: number;
  v: number;
}

function faceRect(pl: Placed, face: FaceName): [number, number, number, number] {
  const [w, h, d] = pl.part.size.map((n) => Math.max(1, Math.ceil(n))) as [number, number, number];
  const { u, v } = pl;
  switch (face) {
    case 'top':
      return [u + d, v, w, d];
    case 'bottom':
      return [u + d + w, v, w, d];
    case 'right':
      return [u, v + d, d, h];
    case 'front':
      return [u + d, v + d, w, h];
    case 'left':
      return [u + d + w, v + d, d, h];
    case 'back':
      return [u + 2 * d + w, v + d, w, h];
  }
}

export interface KitModel {
  def: ModelDef;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
}

const cache = new Map<string, KitModel>();

/** Builds (and caches by key) a model definition + painted skin. */
export function kitModel(key: string, parts: KitPart[], scale = 1): KitModel {
  const cached = cache.get(key);
  if (cached) return cached;
  // Shelf-pack the box unwraps
  const TW = 128;
  let x = 0;
  let y = 0;
  let shelf = 0;
  const placed: Placed[] = [];
  const sorted = [...parts].sort((a, b) => b.size[1] + b.size[2] - (a.size[1] + a.size[2]));
  for (const p of sorted) {
    const [w, h, d] = p.size.map((n) => Math.max(1, Math.ceil(n))) as [number, number, number];
    const uw = 2 * (w + d);
    const vh = d + h;
    if (x + uw > TW) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    placed.push({ part: p, u: x, v: y });
    x += uw;
    shelf = Math.max(shelf, vh);
  }
  let TH = 16;
  while (TH < y + shelf) TH *= 2;
  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d')!;
  const rng = new Random(hashString(key));
  for (const pl of placed) {
    const p = pl.part;
    const c = p.colors;
    const noise = p.noise ?? 0.1;
    const fill = (face: FaceName, col: string | undefined): void => {
      if (!col) return;
      const [fx, fy, fw, fh] = faceRect(pl, face);
      ctx.fillStyle = col;
      ctx.fillRect(fx, fy, fw, fh);
      if (noise > 0)
        for (let yy = fy; yy < fy + fh; yy++)
          for (let xx = fx; xx < fx + fw; xx++) {
            const n = (rng.next() - 0.5) * noise;
            ctx.fillStyle = n > 0 ? `rgba(255,255,255,${n})` : `rgba(0,0,0,${-n})`;
            ctx.fillRect(xx, yy, 1, 1);
          }
    };
    fill('top', c.top ?? c.all);
    fill('bottom', c.bottom ?? c.all);
    fill('front', c.front ?? c.all);
    fill('back', c.back ?? c.all);
    fill('left', c.side ?? c.all);
    fill('right', c.side ?? c.all);
    if (p.paint) {
      const size = p.size.map((n) => Math.max(1, Math.ceil(n))) as [number, number, number];
      const fp: FacePainter = {
        size,
        rng,
        px(face, px, py, col, w = 1, h = 1) {
          const [fx, fy, fw, fh] = faceRect(pl, face);
          if (px >= fw || py >= fh) return;
          ctx.fillStyle = col;
          ctx.fillRect(fx + px, fy + py, Math.min(w, fw - px), Math.min(h, fh - py));
        },
        fill(face, col) {
          const [fx, fy, fw, fh] = faceRect(pl, face);
          ctx.fillStyle = col;
          ctx.fillRect(fx, fy, fw, fh);
        },
        speckle(face, col, density) {
          const faces: FaceName[] = face === 'all' ? ['top', 'bottom', 'front', 'back', 'left', 'right'] : [face];
          for (const f of faces) {
            const [fx, fy, fw, fh] = faceRect(pl, f);
            for (let yy = 0; yy < fh; yy++)
              for (let xx = 0; xx < fw; xx++)
                if (rng.next() < density) {
                  ctx.fillStyle = col;
                  ctx.fillRect(fx + xx, fy + yy, 1, 1);
                }
          }
        },
      };
      p.paint(fp);
    }
  }
  // Assemble the part tree
  const defs = new Map<string, PartDef>();
  const roots: PartDef[] = [];
  for (const pl of placed) {
    const p = pl.part;
    defs.set(p.name, { name: p.name, pivot: p.pivot, from: p.from, size: p.hidden ? [0, 0, 0] : p.size, uv: [pl.u, pl.v], rot: p.rot, inflate: p.inflate, children: [] });
  }
  for (const p of parts) {
    const d = defs.get(p.name)!;
    if (p.parent && defs.has(p.parent)) defs.get(p.parent)!.children!.push(d);
    else roots.push(d);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  const model: KitModel = { def: { texW: TW, texH: TH, parts: roots, scale }, texture, canvas };
  cache.set(key, model);
  return model;
}

// ---------------------------------------------------------------------------
// Part templates
// ---------------------------------------------------------------------------
export function eyes(p: FacePainter, y: number, col: string, spread = 1, pupil?: string): void {
  const w = p.size[0];
  const cx = Math.floor(w / 2);
  p.px('front', cx - 1 - spread, y, col, 1, 1);
  p.px('front', cx + spread, y, col, 1, 1);
  if (pupil) {
    p.px('front', cx - 2 - spread, y, pupil);
    p.px('front', cx + 1 + spread, y, pupil);
  }
}

/** Standard humanoid body (feet at y=0, 32px tall) with custom colours. */
export function humanoidParts(o: {
  head: Colors;
  body: Colors;
  arms: Colors;
  legs: Colors;
  face?: (p: FacePainter) => void;
  bodyPaint?: (p: FacePainter) => void;
  armW?: number;
  limbW?: number;
  headSize?: [number, number, number];
  tall?: number;
  hat?: Colors;
  hatPaint?: (p: FacePainter) => void;
}): KitPart[] {
  const aw = o.armW ?? 4;
  const lw = o.limbW ?? 4;
  const legH = 12 + (o.tall ?? 0);
  const armH = 12 + (o.tall ?? 0) * 0.6;
  const hs = o.headSize ?? [8, 8, 8];
  const parts: KitPart[] = [
    { name: 'body', pivot: [0, legH, 0], from: [-4, 0, -2], size: [8, 12, 4], colors: o.body, paint: o.bodyPaint },
    { name: 'head', parent: 'body', pivot: [0, 12, 0], from: [-hs[0] / 2, 0, -hs[2] / 2], size: hs, colors: o.head, paint: o.face },
    { name: 'rightArm', parent: 'body', pivot: [-(4 + aw / 2), 10, 0], from: [-aw / 2, -armH + 2, -lw / 2], size: [aw, armH, lw], colors: o.arms },
    { name: 'leftArm', parent: 'body', pivot: [4 + aw / 2, 10, 0], from: [-aw / 2, -armH + 2, -lw / 2], size: [aw, armH, lw], colors: o.arms },
    { name: 'rightLeg', pivot: [-2, legH, 0], from: [-lw / 2, -legH, -lw / 2], size: [lw, legH, lw], colors: o.legs },
    { name: 'leftLeg', pivot: [2, legH, 0], from: [-lw / 2, -legH, -lw / 2], size: [lw, legH, lw], colors: o.legs },
  ];
  if (o.hat) parts.push({ name: 'hat', parent: 'head', pivot: [0, 0, 0], from: [-hs[0] / 2, 0, -hs[2] / 2], size: hs, inflate: 0.5, colors: o.hat, paint: o.hatPaint, noise: 0.05 });
  return parts;
}

/** Four-legged body. Front of the animal faces +Z. */
export function quadParts(o: {
  body: [number, number, number];
  legH: number;
  legW: number;
  head: [number, number, number];
  headOffset?: [number, number];
  bodyColors: Colors;
  legColors: Colors;
  headColors: Colors;
  face?: (p: FacePainter) => void;
  bodyPaint?: (p: FacePainter) => void;
  tail?: { size: [number, number, number]; colors: Colors; rot?: number };
  snout?: { size: [number, number, number]; colors: Colors; y?: number };
  horns?: Colors;
  ears?: { size: [number, number, number]; colors: Colors };
}): KitPart[] {
  const [bw, bh, bl] = o.body;
  const bodyY = o.legH + bh / 2;
  const lx = bw / 2 - o.legW / 2;
  const lz = bl / 2 - o.legW / 2;
  const [hw, hh, hl] = o.head;
  const [hy, hz] = o.headOffset ?? [bh / 2 - 1, 0];
  const parts: KitPart[] = [
    { name: 'body', pivot: [0, bodyY, 0], from: [-bw / 2, -bh / 2, -bl / 2], size: [bw, bh, bl], colors: o.bodyColors, paint: o.bodyPaint },
    { name: 'head', pivot: [0, bodyY + hy, bl / 2 + hz], from: [-hw / 2, -hh / 2, -1], size: [hw, hh, hl], colors: o.headColors, paint: o.face },
  ];
  const legs: [string, number, number][] = [
    ['leg0', -lx, lz],
    ['leg1', lx, lz],
    ['leg2', -lx, -lz],
    ['leg3', lx, -lz],
  ];
  for (const [n, x, z] of legs) parts.push({ name: n, pivot: [x, o.legH, z], from: [-o.legW / 2, -o.legH, -o.legW / 2], size: [o.legW, o.legH, o.legW], colors: o.legColors });
  if (o.tail) parts.push({ name: 'tail', parent: 'body', pivot: [0, bh / 2 - 1, -bl / 2], from: [-o.tail.size[0] / 2, -o.tail.size[1], -o.tail.size[2]], size: o.tail.size, colors: o.tail.colors, rot: [o.tail.rot ?? 0.3, 0, 0] });
  if (o.snout) parts.push({ name: 'snout', parent: 'head', pivot: [0, o.snout.y ?? -hh / 2 + o.snout.size[1] / 2 + 0.5, hl - 1], from: [-o.snout.size[0] / 2, -o.snout.size[1] / 2, 0], size: o.snout.size, colors: o.snout.colors });
  if (o.horns) {
    parts.push({ name: 'hornL', parent: 'head', pivot: [hw / 2, hh / 2, 1], from: [0, 0, 0], size: [1, 3, 1], colors: o.horns });
    parts.push({ name: 'hornR', parent: 'head', pivot: [-hw / 2 - 1, hh / 2, 1], from: [0, 0, 0], size: [1, 3, 1], colors: o.horns });
  }
  if (o.ears) {
    parts.push({ name: 'earL', parent: 'head', pivot: [hw / 2 - 1, hh / 2, 1], from: [0, 0, 0], size: o.ears.size, colors: o.ears.colors });
    parts.push({ name: 'earR', parent: 'head', pivot: [-hw / 2 - o.ears.size[0] + 1, hh / 2, 1], from: [0, 0, 0], size: o.ears.size, colors: o.ears.colors });
  }
  return parts;
}
