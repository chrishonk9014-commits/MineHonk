/**
 * Culling must never change the picture. Renders the same frames with face
 * direction culling and cave (visibility graph) culling switched on and off
 * and compares the pixels. The game loop is stopped while comparing, so time,
 * animations and the camera are identical in both renders.
 * Requires `npx vite build`. Diff images go to tests/e2e/out/eq-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4176;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
let failed = false;

const settle = (ms = 90000) =>
  page
    .waitForFunction(
      () => {
        const s = window.minehonk.game.renderer.chunks.stats();
        return s.dirty === 0 && s.jobs === 0;
      },
      null,
      { timeout: ms, polling: 500 },
    )
    .catch(() => console.log('  (terrain still meshing)'));
const cmd = async (text) => {
  await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), text);
  await page.waitForTimeout(1500);
};

/** Renders one frame with the given culling and returns the screenshot. */
async function frame(cull) {
  await page.evaluate((c) => {
    const g = window.minehonk.game;
    g.renderer.chunks.facingCull = c;
    g.renderer.chunks.occlusion = c;
    g.render(0, 16);
    g.render(0, 16);
  }, cull);
  return PNG.sync.read(await page.screenshot());
}

function compare(a, b, name) {
  const diff = new PNG({ width: a.width, height: a.height });
  let bad = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    const hit = d > 40;
    if (hit) bad++;
    diff.data[i] = hit ? 255 : a.data[i] * 0.3;
    diff.data[i + 1] = hit ? 0 : a.data[i + 1] * 0.3;
    diff.data[i + 2] = hit ? 0 : a.data[i + 2] * 0.3;
    diff.data[i + 3] = 255;
  }
  fs.writeFileSync(`${OUT}/eq-${name}.png`, PNG.sync.write(diff));
  fs.writeFileSync(`${OUT}/eq-${name}-view.png`, PNG.sync.write(a));
  return bad / (a.width * a.height);
}

async function views(label, looks) {
  await settle();
  // Freeze the game: no ticks, no animation, same camera for both renders
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.running = false;
    cancelAnimationFrame(g.rafId);
  });
  let worst = 0;
  for (const [i, [yaw, pitch]] of looks.entries()) {
    await page.evaluate(([y, p]) => Object.assign(window.minehonk.game.player, { yaw: y, pitch: p }), [yaw, pitch]);
    const quads = () => page.evaluate(() => window.minehonk.game.renderer.chunks.stats().drawnQuads);
    const on = await frame(true);
    const qOn = await quads();
    const off = await frame(false);
    const qOff = await quads();
    const frac = compare(on, off, `${label}-${i}`);
    worst = Math.max(worst, frac);
    console.log(`  ${label} view ${i}: ${(frac * 100).toFixed(3)}% pixels differ | quads drawn ${qOff} -> ${qOn} with culling (${Math.round((1 - qOn / qOff) * 100)}% fewer)`);
  }
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.renderer.chunks.facingCull = true;
    g.renderer.chunks.occlusion = true;
    g.running = true;
    g.last = performance.now();
    g.rafId = requestAnimationFrame(g.frame);
  });
  return worst;
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.waitForTimeout(300);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill('render-eq');
  const creative = page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' });
  for (let i = 0; i < 6 && !(await creative.textContent()).includes('Creative'); i++) await creative.click();
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
  // Chat lines fade over time; keep them out of the comparison
  await page.addStyleTag({ content: '.chat { visibility: hidden !important; }' });
  await cmd('/time set noon');
  await cmd('/weather clear');
  await cmd('/gamerule doDaylightCycle false');
  const spawn0 = await page.evaluate(() => {
    const b = window.minehonk.game.player.body;
    return [Math.round(b.x), Math.round(b.y), Math.round(b.z)];
  });
  const around = [0, 1.57, 3.14, 4.71].map((y) => [y, 0.15]);
  let worst = await views('ground', around);
  await cmd(`/tp ${spawn0[0]} 150 ${spawn0[2]}`);
  worst = Math.max(worst, await views('overlook', [[0.5, 0.6], [3.6, 0.45], [2, 1.4]]));
  await cmd('/gamemode spectator');
  await cmd(`/tp ${spawn0[0]} 30 ${spawn0[2]}`);
  await settle();
  const cave = await page.evaluate(([x0, z0]) => {
    const w = window.minehonk.game.world;
    // Caves are filled with cave_air, not plain air
    const caveAir = window.minehonkState?.('cave_air') ?? -1;
    const open = (x, y, z) => {
      const s = w.getState(x, y, z);
      return s === 0 || s === caveAir;
    };
    for (let r = 0; r <= 64; r += 2)
      for (let a = 0; a < Math.max(1, r * 2); a++) {
        const x = Math.round(x0 + Math.cos((a / Math.max(1, r * 2)) * Math.PI * 2) * r);
        const z = Math.round(z0 + Math.sin((a / Math.max(1, r * 2)) * Math.PI * 2) * r);
        for (let y = 6; y < 70; y++) {
          if (!open(x, y, z) || !open(x, y + 1, z) || open(x, y - 1, z)) continue;
          let roof = 0;
          for (let h = y + 2; h < y + 60 && !roof; h++) if (!open(x, h, z)) roof = h;
          if (roof && roof - y < 16) return [x + 0.5, y, z + 0.5];
        }
      }
    return null;
  }, [spawn0[0], spawn0[2]]);
  if (cave) {
    await cmd(`/tp ${cave[0]} ${cave[1]} ${cave[2]}`);
    worst = Math.max(worst, await views('cave', [[0, 0], [1.57, -0.3], [3.14, 0.3], [4.71, 0]]));
  } else console.log('  no cave found near spawn');
  // Culling may only remove what is hidden: allow a hair of rasterisation noise
  if (worst > 0.001) throw new Error(`culling changed ${(worst * 100).toFixed(3)}% of a frame (see tests/e2e/out/eq-*.png)`);
  console.log('RENDER EQUIVALENCE: PASS');
} catch (e) {
  failed = true;
  console.error('RENDER EQUIVALENCE: FAIL', e);
} finally {
  await browser.close();
  stop();
  process.exit(failed ? 1 : 0);
}
