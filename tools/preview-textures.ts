/** Debug: renders named atlas textures tiled 2x2 at 4x scale into a contact sheet. */
import fs from 'node:fs';
import { PNG } from 'pngjs';
const [kind = 'blocks', out = 'preview.png', ...names] = process.argv.slice(2);
const atlas = PNG.sync.read(fs.readFileSync(`public/assets/${kind}.png`));
const meta = JSON.parse(fs.readFileSync(`public/assets/${kind}.json`, 'utf8')) as { columns: number; textures: Record<string, { i: number }> };
const list = names.length ? names : Object.keys(meta.textures);
const S = 4;
const cell = 16 * 2 * S + 8;
const cols = Math.min(8, list.length);
const rows = Math.ceil(list.length / cols);
const png = new PNG({ width: cols * cell, height: rows * cell });
png.data.fill(40);
list.forEach((n, k) => {
  const e = meta.textures[n];
  if (!e) return;
  const tx = (e.i % meta.columns) * 16;
  const ty = Math.floor(e.i / meta.columns) * 16;
  const ox = (k % cols) * cell + 4;
  const oy = Math.floor(k / cols) * cell + 4;
  for (let y = 0; y < 32 * S; y++) {
    for (let x = 0; x < 32 * S; x++) {
      const sx = tx + (Math.floor(x / S) % 16);
      const sy = ty + (Math.floor(y / S) % 16);
      const si = (sy * atlas.width + sx) * 4;
      const di = ((oy + y) * png.width + ox + x) * 4;
      const a = atlas.data[si + 3]! / 255;
      const bg = ((x >> 3) + (y >> 3)) % 2 ? 90 : 60;
      // show tint-marked texels with a green tint for preview
      const tint = atlas.data[si + 3] === 254;
      const r = atlas.data[si]! * (tint ? 0.55 : 1);
      const g = atlas.data[si + 1]! * (tint ? 0.85 : 1);
      const b = atlas.data[si + 2]! * (tint ? 0.4 : 1);
      png.data[di] = r * a + bg * (1 - a);
      png.data[di + 1] = g * a + bg * (1 - a);
      png.data[di + 2] = b * a + bg * (1 - a);
      png.data[di + 3] = 255;
    }
  }
});
fs.writeFileSync(out, PNG.sync.write(png));
console.log('wrote', out);
