/** Loads the generated texture atlases and builds GPU textures + icons. */
import * as THREE from 'three';
import type { AtlasMeta } from '../render/atlasInfo';
import { ItemIcons } from '../render/ItemIcons';
import type { GameAssets } from '../render/WorldRenderer';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function loadJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Builds a full mip chain by 2x2 averaging. Colour is averaged over visible
 * texels only (so cut-out edges don't darken) and alpha keeps the 254
 * "tint me" marker when any contributing texel carried it.
 */
function buildMips(img: HTMLImageElement): ImageData[] {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  let cur = ctx.getImageData(0, 0, img.width, img.height);
  const out: ImageData[] = [cur];
  while (cur.width > 1 || cur.height > 1) {
    const w = Math.max(1, cur.width >> 1);
    const h = Math.max(1, cur.height >> 1);
    const next = new ImageData(w, h);
    const s = cur.data;
    const d = next.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let vis = 0;
        let tint = false;
        let opaqueCount = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(cur.width - 1, x * 2 + dx);
            const sy = Math.min(cur.height - 1, y * 2 + dy);
            const i = (sy * cur.width + sx) * 4;
            const al = s[i + 3]!;
            a += al;
            if (al > 0) {
              r += s[i]!;
              g += s[i + 1]!;
              b += s[i + 2]!;
              vis++;
            }
            if (al === 254) tint = true;
            if (al >= 254) opaqueCount++;
          }
        }
        const o = (y * w + x) * 4;
        if (vis > 0) {
          d[o] = r / vis;
          d[o + 1] = g / vis;
          d[o + 2] = b / vis;
        }
        let alpha = a / 4;
        // Cut-out textures: keep coverage from collapsing at distance
        if (opaqueCount >= 2) alpha = 255;
        if (tint && alpha >= 250) alpha = 254;
        else if (alpha >= 254) alpha = 255;
        d[o + 3] = alpha;
      }
    }
    out.push(next);
    cur = next;
  }
  return out;
}

export async function loadAssets(onProgress?: (text: string) => void): Promise<GameAssets> {
  onProgress?.('Loading textures...');
  const [blockImage, itemImage, blockMeta, itemMeta] = await Promise.all([
    loadImage('assets/blocks.png'),
    loadImage('assets/items.png'),
    loadJson<AtlasMeta>('assets/blocks.json'),
    loadJson<AtlasMeta>('assets/items.json'),
  ]);
  onProgress?.('Building atlas...');
  const mips = buildMips(blockImage);
  const tex = new THREE.Texture();
  tex.image = mips[0]!;
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  const icons = new ItemIcons(blockImage, blockMeta, itemImage, itemMeta);
  // Fonts must be ready before measuring text in the UI
  try {
    await document.fonts.load('16px "MineHonk Pixel"');
  } catch {
    /* fallback font */
  }
  return { blockAtlas: tex, blockMeta, blockImage, itemImage, itemMeta, icons };
}

/** CSS background textures for buttons and menu backgrounds, drawn from the block atlas. */
export function applyUiTextures(icons: ItemIcons): void {
  const set = (name: string, texName: string, dim: number, opacity: number): void => {
    const t = icons.texture(texName, 'block');
    if (!t) return;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.globalAlpha = opacity;
    ctx.drawImage(t, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, 16, 16);
    document.documentElement.style.setProperty(name, `url(${c.toDataURL()})`);
  };
  set('--menu-tex', 'dirt', 0.72, 1);
  // Semi-transparent so the button's hover colour shows through
  set('--btn-tex', 'stone', 0.2, 0.35);
}
