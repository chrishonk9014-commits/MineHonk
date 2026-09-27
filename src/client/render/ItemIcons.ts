import { POTION_BY_ID } from '../../common/data/potions';
/**
 * Generates inventory icons: isometric cubes for full blocks, flat sprites
 * for items/plants. Icons are cached as data URLs (for DOM UI).
 */
import { items } from '../../common/registry/items';
import { blockById } from '../../common/registry/blocks';
import { modelFor, ModelKind } from './models';
import type { AtlasMeta } from './atlasInfo';

const SIZE = 32;
const DEFAULT_TINT: Record<string, [number, number, number]> = {
  grass: [0x7c, 0xbd, 0x6b],
  foliage: [0x48, 0xb5, 0x18],
  birch: [0x80, 0xa7, 0x55],
  spruce: [0x61, 0x99, 0x61],
  water: [0x3f, 0x76, 0xe4],
  lily: [0x20, 0x80, 0x30],
};

export class ItemIcons {
  private readonly cache = new Map<number, string>();
  private readonly texCache = new Map<string, HTMLCanvasElement>();

  constructor(
    private readonly blockImg: HTMLImageElement,
    private readonly blockMeta: AtlasMeta,
    private readonly itemImg: HTMLImageElement,
    private readonly itemMeta: AtlasMeta,
  ) {}

  /** A 16x16 canvas for a named texture (first animation frame), optionally tinted. */
  texture(name: string, atlas: 'block' | 'item' = 'block', tint?: string): HTMLCanvasElement | null {
    const key = atlas + ':' + name + ':' + (tint ?? '');
    const cached = this.texCache.get(key);
    if (cached) return cached;
    const meta = atlas === 'block' ? this.blockMeta : this.itemMeta;
    const img = atlas === 'block' ? this.blockImg : this.itemImg;
    const e = meta.textures[name];
    if (!e) return null;
    const cols = meta.width / meta.tile;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, (e.i % cols) * 16, Math.floor(e.i / cols) * 16, 16, 16, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16);
    const t = tint ? DEFAULT_TINT[tint] : undefined;
    for (let i = 0; i < data.data.length; i += 4) {
      const a = data.data[i + 3]!;
      if (a === 254 && t) {
        data.data[i] = (data.data[i]! * t[0]) / 255;
        data.data[i + 1] = (data.data[i + 1]! * t[1]) / 255;
        data.data[i + 2] = (data.data[i + 2]! * t[2]) / 255;
      }
      if (a > 0 && a < 255 && atlas === 'block' && !name.includes('glass') && !name.startsWith('water') && name !== 'ice' && !name.includes('slime') && !name.includes('honey')) data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    this.texCache.set(key, c);
    return c;
  }

  /** Icon for a specific stack (potions are tinted by their contents). */
  iconFor(stack: { id: number; tag?: { potion?: string } }): string {
    const potion = stack.tag?.potion;
    if (!potion) return this.icon(stack.id);
    const key = `${stack.id}:${potion}`;
    const cached = this.stackCache.get(key);
    if (cached) return cached;
    const c = this.render(stack.id);
    const color = POTION_BY_ID.get(potion)?.color ?? 0x385dc6;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const tr = (color >> 16) & 255;
    const tg = (color >> 8) & 255;
    const tb = color & 255;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      // Liquid pixels are the saturated blue ones in the base bottle sprite
      if (b > r + 40 && b > g + 30) {
        const lum = (r + g + b) / 3 / 128;
        d[i] = Math.min(255, tr * lum);
        d[i + 1] = Math.min(255, tg * lum);
        d[i + 2] = Math.min(255, tb * lum);
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    this.stackCache.set(key, url);
    return url;
  }

  private readonly stackCache = new Map<string, string>();

  icon(itemNum: number): string {
    const cached = this.cache.get(itemNum);
    if (cached) return cached;
    const url = this.render(itemNum).toDataURL();
    this.cache.set(itemNum, url);
    return url;
  }

  /** Renders the icon onto a new canvas. */
  render(itemNum: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const it = items[itemNum];
    if (!it) return c;
    // Item atlas sprite first
    const own = this.texture(it.id, 'item');
    if (own) {
      ctx.drawImage(own, 0, 0, SIZE, SIZE);
      return c;
    }
    const blockId = it.def.block;
    const bt = blockId ? blockById.get(blockId) : undefined;
    if (!bt) return this.missing(ctx, c);
    const def = bt.def;
    const model = modelFor(bt.defaultState);
    const tint = def.tint && def.tint !== 'none' ? def.tint : undefined;
    const isoModels = ['cube', 'column', 'slab', 'stairs', 'mushroom_block', 'chest', 'farmland', 'path', 'snow_layer', 'carpet', 'enchanting_table', 'end_portal_frame', 'cactus', 'fence', 'wall', 'anvil', 'cauldron', 'custom', 'pressure_plate'];
    if (model.kind === ModelKind.Cube || isoModels.includes(def.model)) {
      let top: string;
      let left: string;
      let right: string;
      if (model.kind === ModelKind.Cube) {
        top = model.cubeTex![1]!;
        left = model.cubeTex![3]!;
        right = model.cubeTex![5]!;
        if (def.tex.front) left = def.tex.front;
      } else if (def.model === 'chest') {
        top = def.tex.all + '_top';
        left = def.tex.all + '_front';
        right = def.tex.all + '_side';
      } else {
        top = def.tex.top ?? def.tex.all ?? def.tex.side ?? 'missing_block';
        left = def.tex.side ?? def.tex.all ?? top;
        right = left;
      }
      const hFrac = def.model === 'slab' ? 0.5 : def.model === 'carpet' || def.model === 'pressure_plate' ? 0.1 : def.model === 'snow_layer' ? 0.15 : def.model === 'farmland' || def.model === 'path' ? 0.94 : def.model === 'enchanting_table' ? 0.75 : 1;
      const faceTint = (name: string): string | undefined => {
        if (def.id === 'grass_block') return name === 'grass_block_top' || name === 'grass_block_side' ? 'grass' : undefined;
        return tint;
      };
      this.iso(ctx, this.texture(top, 'block', faceTint(top)), this.texture(left, 'block', faceTint(left)), this.texture(right, 'block', faceTint(right)), hFrac);
      return c;
    }
    // Flat sprite from block texture
    let spriteName = def.tex.all ?? def.tex.bottom ?? def.tex.top ?? def.tex.side;
    if (def.model === 'double_plant') spriteName = def.tex.top;
    if (def.model === 'door') spriteName = def.tex.top;
    if (def.model === 'bed') spriteName = `${def.data?.color ?? 'red'}_bed_head_top`;
    if (def.model === 'crop') spriteName = `${def.tex.all}${(def.data?.maxAge as number) ?? 7}`;
    const tex = spriteName ? this.texture(spriteName, 'block', tint) : null;
    if (!tex) return this.missing(ctx, c);
    ctx.drawImage(tex, 0, 0, SIZE, SIZE);
    return c;
  }

  private missing(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement): HTMLCanvasElement {
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
    ctx.fillStyle = '#000';
    ctx.fillRect(16, 0, 16, 16);
    ctx.fillRect(0, 16, 16, 16);
    return c;
  }

  /** Isometric cube with three shaded faces. */
  private iso(ctx: CanvasRenderingContext2D, top: HTMLCanvasElement | null, left: HTMLCanvasElement | null, right: HTMLCanvasElement | null, hFrac: number): void {
    const s = SIZE;
    const cx = s / 2;
    const hw = s * 0.44; // half width of the cube
    const q = hw * 0.5; // quarter height of top rhombus
    const h = s * 0.5 * hFrac; // side height
    const topY = s * 0.5 - (h + 2 * q) / 2 + 1 + (1 - hFrac) * s * 0.2;
    const shadeFace = (tex: HTMLCanvasElement, dark: number): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const g = c.getContext('2d')!;
      g.drawImage(tex, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(0,0,0,${dark})`;
      g.fillRect(0, 0, 16, 16);
      return c;
    };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (left) {
      // left face: from (cx-hw, topY+q) down h, to (cx, topY+2q)
      ctx.setTransform(hw / 16, q / 16, 0, h / 16, cx - hw, topY + q);
      const src = shadeFace(left, 0.25);
      ctx.drawImage(src, 0, hFrac < 1 ? 16 * (1 - hFrac) : 0, 16, 16 * hFrac, 0, 0, 16, 16);
    }
    if (right) {
      ctx.setTransform(hw / 16, -q / 16, 0, h / 16, cx, topY + 2 * q);
      const src = shadeFace(right, 0.45);
      ctx.drawImage(src, 0, hFrac < 1 ? 16 * (1 - hFrac) : 0, 16, 16 * hFrac, 0, 0, 16, 16);
    }
    if (top) {
      // top rhombus: map (0,0)->(cx-hw, topY+q), (16,0)->(cx, topY), (0,16)->(cx, topY+2q)
      ctx.setTransform(hw / 16, -q / 16, hw / 16, q / 16, cx - hw, topY + q);
      ctx.drawImage(top, 0, 0);
    }
    ctx.restore();
  }
}
