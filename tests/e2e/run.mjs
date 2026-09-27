/**
 * End-to-end smoke test: serves the production build, opens it in headless
 * Chromium (software WebGL), creates a world, waits for terrain, plays a few
 * seconds and saves screenshots to tests/e2e/out.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4173;
const mode = process.argv[2] ?? 'survival';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const errors = [];
let failed = false;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    if (process.env.VERBOSE || m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('[pageerror]', e);
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}/01-title.png` });
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.waitForTimeout(300);
  // Configure the new world
  const seed = process.env.SEED ?? 'e2e-seed';
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  if (mode !== 'survival') {
    const modes = { creative: 'Creative', god: 'God Mode', hardcore: 'Hardcore' };
    for (let i = 0; i < 6; i++) {
      const txt = await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).textContent();
      if (txt.includes(modes[mode])) break;
      await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).click();
    }
  }
  await page.screenshot({ path: `${OUT}/02-create.png` });
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game;
  }, null, { timeout: 180000 });
  console.log(`world ready in ${Date.now() - t0} ms`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/03-ingame.png` });
  // Walk forward and look around
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.player.pitch = 0.5;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-walk.png` });
  const info = await page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    return { pos: [b.x, b.y, b.z], chunks: g.world.chunks.size, fps: g.fps, entities: g.entities.size, health: g.stats.health, maxHealth: g.stats.maxHealth, mode: g.player.gamemode, target: g.interaction.target };
  });
  console.log('state', JSON.stringify(info));
  // Open inventory
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-inventory.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Debug screen
  await page.keyboard.press('F3');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-debug.png` });
  await page.keyboard.press('F3');
  // Pause and quit
  await page.evaluate(() => window.minehonk.openPause());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-pause.png` });
  await page.getByText('Save and Quit to Title').click();
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.getByText('Singleplayer').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/08-worlds.png` });
} catch (e) {
  failed = true;
  console.error('E2E FAILED:', e);
} finally {
  await browser.close();
  stopServer();
}
const serious = errors.filter((e) => !/favicon|AudioContext/.test(e));
if (serious.length) {
  console.error('Console errors:\n' + serious.join('\n'));
  failed = true;
}
console.log(failed ? 'E2E: FAIL' : 'E2E: PASS');
process.exit(failed ? 1 : 0);
