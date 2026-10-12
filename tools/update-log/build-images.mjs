/**
 * Makes the Update Log's pictures (public/updatelog/v6/*.webp) from game
 * screenshots:
 *
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/v6.mjs      the End Expansion (clean copies in tests/e2e/out/clean)
 *   node tools/update-log/capture-online.mjs       browser multiplayer
 *   node tools/update-log/build-images.mjs         resize, brighten and encode
 *
 * Encoding runs in the Chromium that Playwright already uses, so nothing else
 * needs installing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SHOTS = path.resolve('tests/e2e/out');
const OUT = path.resolve('public/updatelog/v6');
fs.mkdirSync(OUT, { recursive: true });

/**
 * The End is dark: game views get an automatic exposure (brightened towards an average
 * brightness, up to 2.2 times). Menus and windows are left as they are.
 */
const GAME = 'auto';
const shots = [];
const add = (name, src, opts = {}) => shots.push({ name, src, width: 800, filter: GAME, ...opts });

add('title-expanded-end', 'clean/v6-title-expanded-end.png', { width: 1280 });
for (const t of ['crystal-fields', 'end-eclipse']) add(`title-${t}`, `clean/v6-title-${t}.png`);
// The eclipse is meant to be dark
add('eclipse-sky', 'clean/v6-eclipse-sky.png', { filter: 'brightness(1.15)' });
for (const n of ['portal-dormant', 'portal-alive', 'arrival', 'chorus-tree', 'ender-bridge', 'crystal-generator', 'void-skiff', 'ancient-gateway', 'discovery-title', 'glyph-wall', 'dragon-nest', 'dragon-nest-crack', 'storm', 'storm-remnant', 'eclipse-monolith', 'citadel-exterior', 'citadel-glyph', 'citadel-parkour', 'guardian-phase1', 'guardian-phase2', 'guardian-phase3', 'guardian-victory', 'telegraph-lunge', 'telegraph-throw', 'telegraph-sentinel', 'telegraph-bulwark'])
  add(n, `clean/v6-${n}.png`);
for (const b of ['end_barrens', 'shattered_end', 'astral_end', 'highlands', 'end_crystal_fields', 'chorus_forest', 'void_wastes']) add(`biome-${b}`, `clean/v6-biome-${b}.png`);
for (const m of ['endling', 'void_stalker', 'chorus_beast', 'end_crystal_mite', 'end_phantom']) add(`mob-${m}`, `clean/v6-mob-${m}.png`);
for (const o of ['ender_ore', 'void_crystal_ore', 'ancient_end_fragment', 'astral_ore']) add(`ore-${o}`, `clean/v6-ore-${o}.png`);
for (const s of ['end_outpost', 'end_settlement', 'end_ruins', 'end_library', 'end_observatory', 'end_shipyard', 'end_metropolis', 'end_palace', 'end_colossus', 'crystal_cathedral', 'void_observatory', 'end_fortress', 'fallen_city'])
  add(`structure-${s}`, `clean/v6-structure-${s}.png`);
for (const c of ['guardian_sentinel', 'guardian_bulwark']) add(`construct-${c}`, `clean/v6-construct-${c}.png`);
for (const d of ['breath-wave', 'wing-gust', 'roar', 'pillar-weave', 'strafing-dive', 'crystal-fury', 'edge-strike', 'dragon-storm']) add(`dragon-${d}`, `clean/v6-dragon-${d}.png`);
// Windows and menus: as they are
for (const n of ['teleport-node', 'elytra-smithing', 'elytra-tooltip', 'ender-alloy-armor', 'glyph-tablet', 'admin-teleport-end']) add(n, `clean/v6-${n}.png`, { filter: '' });
// The quest tracker is part of the HUD, so this one keeps it
add('quest-tracker', 'v6-quest-tracker.png');
for (const m of ['signin', 'host-tab', 'host-form', 'hosting-panel', 'friends-join', 'join-code', 'public']) add(`mp-${m}`, `clean/ul-mp-${m}.png`, { filter: '' });
add('mp-together', 'clean/ul-mp-together.png');

const missing = shots.filter((s) => !fs.existsSync(path.join(SHOTS, s.src)));
if (missing.length) {
  console.error('Missing screenshots (run the captures first):\n  ' + missing.map((s) => s.src).join('\n  '));
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage();
let total = 0;
for (const s of shots) {
  const b64 = fs.readFileSync(path.join(SHOTS, s.src)).toString('base64');
  const url = await page.evaluate(
    async ({ b64, width, filter }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const w = Math.min(width, img.width);
      const h = Math.round((w * img.height) / img.width);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      if (filter === 'auto') {
        // Average brightness (Rec. 709 luma), then a brightness factor towards 0.36, from 1.0 to 2.2
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4 * 7) {
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
        const k = Math.min(2.2, Math.max(1, 0.36 / Math.max(0.01, sum / n)));
        ctx.clearRect(0, 0, w, h);
        filter = `brightness(${k.toFixed(2)}) contrast(1.05) saturate(1.08)`;
      }
      if (filter) ctx.filter = filter;
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/webp', 0.8);
    },
    { b64, width: s.width, filter: s.filter },
  );
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  fs.writeFileSync(path.join(OUT, `${s.name}.webp`), buf);
  total += buf.length;
}
await browser.close();
console.log(`${shots.length} pictures, ${(total / 1024).toFixed(0)} KB in ${path.relative(process.cwd(), OUT)}`);
