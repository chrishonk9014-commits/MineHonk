/** Builds the pixel font (OTF for CSS + JSON for canvas text). */
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { glyphTable } from './textures/font';

export function buildFont(outDir: string): void {
  const table = glyphTable();
  const PX = 128;
  const upm = PX * 8;
  const glyphs: opentype.Glyph[] = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: PX * 4, path: new opentype.Path() })];
  for (const [ch, g] of Object.entries(table)) {
    const p = new opentype.Path();
    g.rows.forEach((row, r) => {
      let x = 0;
      while (x < row.length) {
        if (row[x] !== '#') {
          x++;
          continue;
        }
        let e = x;
        while (e < row.length && row[e] === '#') e++;
        // baseline between rows 6 and 7: row r occupies y from (6-r)*PX to (7-r)*PX
        const y0 = (6 - r) * PX;
        const y1 = y0 + PX;
        const x0 = x * PX;
        const x1 = e * PX;
        // counter-clockwise outer contour (CFF)
        p.moveTo(x0, y0);
        p.lineTo(x1, y0);
        p.lineTo(x1, y1);
        p.lineTo(x0, y1);
        p.close();
        x = e;
      }
    });
    glyphs.push(new opentype.Glyph({ name: 'u' + ch.codePointAt(0)!.toString(16), unicode: ch.codePointAt(0)!, advanceWidth: (g.w + 1) * PX, path: p }));
  }
  const font = new opentype.Font({ familyName: 'MineHonk Pixel', styleName: 'Regular', unitsPerEm: upm, ascender: PX * 7, descender: -PX * 2, glyphs });
  fs.writeFileSync(path.join(outDir, 'minehonk-pixel.otf'), Buffer.from(font.toArrayBuffer()));
  fs.writeFileSync(path.join(outDir, 'font.json'), JSON.stringify(table));
}
