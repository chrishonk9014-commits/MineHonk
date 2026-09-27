/**
 * Asset pipeline: paints all procedural pixel-art textures and packs them
 * into atlases under public/assets/.
 *
 *   blocks.png / blocks.json  - 16x16 block textures (animated frames in a row)
 *   items.png  / items.json   - 16x16 item sprites
 *
 * Artists can override any texture by dropping a PNG with the same name into
 * assets/overrides/{blocks,items}/ – overrides always win over painters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Tex } from './textures/canvas';
import { PainterRegistry, type Painted } from './textures/registry';
import { registerNatural } from './textures/blocksNatural';
import { registerWood } from './textures/blocksWood';
import { registerDeco } from './textures/blocksDeco';
import { registerDims } from './textures/blocksDims';
import { registerItems } from './textures/items';
import { BLOCK_DEFS } from '../src/common/data/blocks';
import { buildFont } from './gen-font';

const OUT = path.resolve('public/assets');
const OVERRIDES = path.resolve('assets/overrides');
fs.mkdirSync(OUT, { recursive: true });

function loadOverride(kind: string, name: string): Painted | null {
  const p = path.join(OVERRIDES, kind, name + '.png');
  if (!fs.existsSync(p)) return null;
  const png = PNG.sync.read(fs.readFileSync(p));
  const frames: Tex[] = [];
  const n = Math.max(1, Math.floor(png.height / 16));
  for (let f = 0; f < n; f++) {
    const t = new Tex(16, 16, name);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const sx = Math.floor((x * png.width) / 16);
        const i = ((f * 16 + y) * png.width + sx) * 4;
        t.set(x, y, [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!]);
      }
    }
    frames.push(t);
  }
  return { frames, frameTime: 2 };
}

interface AtlasEntry {
  /** Tile index of the first frame. */
  i: number;
  /** Frame count (frames are consecutive tiles in the same row). */
  n?: number;
  /** Ticks per frame. */
  t?: number;
}

function pack(kind: string, reg: PainterRegistry, names: string[], columns = 32): { png: PNG; map: Record<string, AtlasEntry> } {
  const painted: [string, Painted][] = [];
  for (const n of names) {
    const p = loadOverride(kind, n) ?? reg.paint(n);
    if (p) painted.push([n, p]);
  }
  // Animated first so they get their own rows cleanly.
  painted.sort((a, b) => b[1].frames.length - a[1].frames.length);
  const map: Record<string, AtlasEntry> = {};
  let col = 0;
  let row = 0;
  const placed: { x: number; y: number; t: Tex }[] = [];
  for (const [n, p] of painted) {
    const len = p.frames.length;
    if (col + len > columns) {
      row++;
      col = 0;
    }
    map[n] = len > 1 ? { i: row * columns + col, n: len, t: p.frameTime } : { i: row * columns + col };
    p.frames.forEach((f, k) => placed.push({ x: col + k, y: row, t: f }));
    col += len;
  }
  const rows = row + 1;
  let h = 1;
  while (h < rows) h *= 2;
  const png = new PNG({ width: columns * 16, height: h * 16 });
  png.data.fill(0);
  for (const { x, y, t } of placed) {
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const si = (py * 16 + px) * 4;
        const di = ((y * 16 + py) * png.width + x * 16 + px) * 4;
        png.data[di] = t.data[si]!;
        png.data[di + 1] = t.data[si + 1]!;
        png.data[di + 2] = t.data[si + 2]!;
        png.data[di + 3] = t.data[si + 3]!;
      }
    }
  }
  return { png, map };
}

// ---- blocks ----
const blockReg = new PainterRegistry();
registerNatural(blockReg);
registerWood(blockReg);
registerDeco(blockReg);
registerDims(blockReg);

const referenced = new Set<string>();
for (const d of BLOCK_DEFS) for (const v of Object.values(d.tex)) if (v) referenced.add(v);
const blockNames = [...new Set([...blockReg.painters.keys()])];
const missing = [...referenced].filter((n) => !blockReg.has(n) && !fs.existsSync(path.join(OVERRIDES, 'blocks', n + '.png')));
// Names that are only logical references (resolved by the model baker to suffixed textures).
const LOGICAL = /^(wheat|carrots|potatoes|beetroots|sunroot|nether_wart)_stage$|^(chest|trapped_chest|ender_chest)$|_wool$/;
const realMissing = missing.filter((n) => !LOGICAL.test(n));
if (realMissing.length) console.warn(`[gen-assets] ${realMissing.length} block textures without painter:`, realMissing.join(' '));

const blocks = pack('blocks', blockReg, blockNames);
fs.writeFileSync(path.join(OUT, 'blocks.png'), PNG.sync.write(blocks.png));
fs.writeFileSync(path.join(OUT, 'blocks.json'), JSON.stringify({ tile: 16, columns: 32, width: blocks.png.width, height: blocks.png.height, textures: blocks.map }));
console.log(`[gen-assets] blocks atlas ${blocks.png.width}x${blocks.png.height}, ${Object.keys(blocks.map).length} textures`);

// ---- items ----
const itemReg = new PainterRegistry();
registerItems(itemReg);
const items = pack('items', itemReg, [...itemReg.painters.keys()]);
fs.writeFileSync(path.join(OUT, 'items.png'), PNG.sync.write(items.png));
fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify({ tile: 16, columns: 32, width: items.png.width, height: items.png.height, textures: items.map }));
console.log(`[gen-assets] items atlas ${items.png.width}x${items.png.height}, ${Object.keys(items.map).length} textures`);

buildFont(OUT);
console.log('[gen-assets] font written');
