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

interface PlayerLook {
  skin: string;
  skinD: string;
  hair: string;
  shirt: string;
  shirtD: string;
  pants: string;
  eyes: string;
}

const SKIN_TONES: [string, string][] = [
  ['#c8926a', '#a87450'],
  ['#e8b890', '#c89870'],
  ['#8a5a3a', '#6a4028'],
  ['#5a3a24', '#442a18'],
  ['#f0c8a8', '#d0a888'],
];
const HAIR = ['#4a2e1a', '#1e1a18', '#c89a4a', '#8a3a1a', '#6a6a6a', '#e8d8a8'];
const SHIRTS: [string, string][] = [
  ['#2f8f7a', '#236e5e'],
  ['#b83a3a', '#8e2a2a'],
  ['#3a6ab8', '#2a4e8e'],
  ['#d8a030', '#b08020'],
  ['#7a3ab8', '#5e2a8e'],
  ['#3a9a3a', '#2a7a2a'],
  ['#e0e0e0', '#b8b8b8'],
  ['#e06a9a', '#b8507a'],
  ['#303038', '#202028'],
  ['#e07a30', '#b85e20'],
];
const PANTS = ['#34427a', '#3a3a3a', '#5a4030', '#2a5a4a', '#6a6a78', '#4a2a5a'];
const EYES = ['#2a4a8a', '#3a6a2a', '#5a3a1a', '#4a4a4a'];

/** A stable look for a player name (the original "Honk" adventurer for the default). */
export function playerLook(name: string | null): PlayerLook {
  if (!name) return { skin: '#c8926a', skinD: '#a87450', hair: '#4a2e1a', shirt: '#2f8f7a', shirtD: '#236e5e', pants: '#34427a', eyes: '#2a4a8a' };
  const r = new Random(hashString('look:' + name.toLowerCase()));
  const [skin, skinD] = SKIN_TONES[r.int(SKIN_TONES.length)]!;
  const [shirt, shirtD] = SHIRTS[r.int(SHIRTS.length)]!;
  return { skin, skinD, hair: HAIR[r.int(HAIR.length)]!, shirt, shirtD, pants: PANTS[r.int(PANTS.length)]!, eyes: EYES[r.int(EYES.length)]! };
}

/** Skin texture for a player (cached per name). */
export function playerSkin(name: string | null): THREE.CanvasTexture {
  const look = playerLook(name);
  return skinTexture(`player:${name?.toLowerCase() ?? 'default'}`, 64, 64, (ctx, rng) => paintPlayerLook(ctx, rng, look));
}

/** The default player look: original "Honk" adventurer. */
export const paintPlayer: SkinPainter = (ctx, rng) => paintPlayerLook(ctx, rng, playerLook(null));

function paintPlayerLook(ctx: CanvasRenderingContext2D, rng: Random, look: PlayerLook): void {
  const { skin, skinD, hair, shirt, shirtD, pants } = look;
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
  px(ctx, 10, 12, look.eyes);
  px(ctx, 13, 12, look.eyes);
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
}

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
