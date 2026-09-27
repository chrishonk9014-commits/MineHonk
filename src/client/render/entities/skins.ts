/**
 * Procedurally painted entity skins (original designs). Each painter draws
 * onto a canvas using the box-unwrap layout expected by the models.
 */
import * as THREE from 'three';
import { Random, hashString } from '../../../common/math/rng';

export type SkinPainter = (ctx: CanvasRenderingContext2D, rng: Random) => void;

/** Fills a box unwrap region with per-face colours + noise. */
export function paintBox(ctx: CanvasRenderingContext2D, rng: Random, u: number, v: number, w: number, h: number, d: number, faces: { top?: string; bottom?: string; front?: string; back?: string; side?: string; all?: string }, noise = 0.08): void {
  const f = (x: number, y: number, ww: number, hh: number, col: string | undefined): void => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, ww, hh);
    if (noise > 0) {
      for (let yy = y; yy < y + hh; yy++) {
        for (let xx = x; xx < x + ww; xx++) {
          const n = (rng.next() - 0.5) * noise;
          ctx.fillStyle = n > 0 ? `rgba(255,255,255,${n})` : `rgba(0,0,0,${-n})`;
          ctx.fillRect(xx, yy, 1, 1);
        }
      }
    }
  };
  const a = faces.all;
  f(u + d, v, w, d, faces.top ?? a);
  f(u + d + w, v, w, d, faces.bottom ?? a);
  f(u, v + d, d, h, faces.side ?? a);
  f(u + d, v + d, w, h, faces.front ?? a);
  f(u + d + w, v + d, d, h, faces.side ?? a);
  f(u + 2 * d + w, v + d, w, h, faces.back ?? a);
}

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, col: string, w = 1, h = 1): void {
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w, h);
}

/** The default player look: original "Honk" adventurer. */
export const paintPlayer: SkinPainter = (ctx, rng) => {
  const skin = '#c8926a';
  const skinD = '#a87450';
  const hair = '#4a2e1a';
  const shirt = '#2f8f7a';
  const shirtD = '#236e5e';
  const pants = '#34427a';
  const shoe = '#3a3a3a';
  // head
  paintBox(ctx, rng, 0, 0, 8, 8, 8, { all: skin, top: hair, back: hair });
  // hair fringe on sides/front top rows
  px(ctx, 8, 8, hair, 8, 2);
  px(ctx, 0, 8, hair, 8, 3);
  px(ctx, 16, 8, hair, 8, 3);
  px(ctx, 24, 8, hair, 8, 8);
  // face
  px(ctx, 9, 12, '#ffffff', 2, 1);
  px(ctx, 13, 12, '#ffffff', 2, 1);
  px(ctx, 10, 12, '#2a4a8a');
  px(ctx, 13, 12, '#2a4a8a');
  px(ctx, 11, 14, skinD, 2, 1);
  px(ctx, 10, 15, '#8a4a3a', 4, 1);
  // body
  paintBox(ctx, rng, 16, 16, 8, 12, 4, { all: shirt, top: shirt, bottom: pants });
  px(ctx, 20, 20, shirtD, 8, 1);
  px(ctx, 23, 20, '#e8c040', 2, 2);
  px(ctx, 20, 30, '#5a3a1a', 8, 2);
  // arms (right arm at 40,16, left arm at 32,48)
  for (const [u, v] of [
    [40, 16],
    [32, 48],
  ] as const) {
    paintBox(ctx, rng, u, v, 4, 12, 4, { all: shirt, bottom: skin });
    px(ctx, u, v + 4 + 7, skin, 16, 5);
  }
  // legs
  for (const [u, v] of [
    [0, 16],
    [16, 48],
  ] as const) {
    paintBox(ctx, rng, u, v, 4, 12, 4, { all: pants, bottom: shoe });
    px(ctx, u, v + 4 + 9, shoe, 16, 3);
  }
};

const skinCache = new Map<string, THREE.CanvasTexture>();

export function skinTexture(key: string, w: number, h: number, painter: SkinPainter): THREE.CanvasTexture {
  let t = skinCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  painter(ctx, new Random(hashString(key)));
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  skinCache.set(key, t);
  return t;
}
