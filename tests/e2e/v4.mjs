/**
 * V4 browser check: a cheats world, the Admin Panel's World Update tab, the
 * Error Biome and its Glitched Structure (a stage started, the quest tracker
 * and boss bar shown), a V4 village and the fluid rig. Screenshots go to
 * tests/e2e/out/v4-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4174;
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
const errors = [];
let failed = false;

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => {
  errors.push(String(e));
  console.log('[pageerror]', e);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text());
    console.log('[error]', m.text());
  }
});
const shot = (name) => page.screenshot({ path: `${OUT}/v4-${name}.png` });
const check = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log('  ok:', msg);
};
const openTab = async () => {
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor({ timeout: 5000 });
  await page.locator('.admin-tab[data-tab="v4"]').dispatchEvent('mousedown');
  await page.waitForTimeout(400);
};
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
const pos = () => page.evaluate(() => { const b = window.minehonk.game.player.body; return [b.x, b.y, b.z]; });
const look = (yaw, pitch) => page.evaluate(([y, p]) => { const pl = window.minehonk.game.player; pl.yaw = y; pl.pitch = p; }, [yaw, pitch]);
const teleportRow = async (label) => {
  await openTab();
  const before = await pos();
  await page.locator('.admin-panel .row', { hasText: label }).first().getByRole('button', { name: 'Teleport' }).click();
  await page.waitForFunction((b) => { const p = window.minehonk.game.player.body; return Math.hypot(p.x - b[0], p.y - b[1], p.z - b[2]) > 8; }, before, { timeout: 180000 });
  await closePanel();
  await page.waitForTimeout(6000);
};

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.waitForTimeout(300);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill('glitched-quest');
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  // The World Update tab
  await openTab();
  check((await page.locator('.admin-panel .row', { hasText: 'Glitched Structure' }).count()) >= 2, 'World Update tab lists the Glitched Structure (Overworld and Nether)');
  await shot('admin-tab');
  await closePanel();

  // The Error Biome from its surface
  await teleportRow('Error Biome');
  const biome = await page.evaluate(() => { const b = window.minehonk.game.player.body; return window.minehonk.game.world.biomeAt(b.x, b.z).id; });
  check(biome === 'error_biome', `standing in the Error Biome (${biome})`);
  await look(Math.PI / 2, -0.45);
  await page.waitForTimeout(2500);
  await shot('error-biome');
  await look(-Math.PI / 4, -0.15);
  await page.waitForTimeout(1500);
  await shot('error-biome-2');

  // Into the Glitched Structure: start stage 1 from the panel
  await teleportRow('Glitched Structure');
  await openTab();
  await page.getByRole('button', { name: 'Start next stage' }).click();
  await page.waitForTimeout(800);
  await closePanel();
  await page.waitForTimeout(2500);
  const tracker = await page.locator('.quest-tracker').textContent();
  check(/Glitched Structure/.test(tracker ?? '') && /Stage 1/.test(tracker ?? ''), `quest tracker shows the stage: ${tracker}`);
  check((await page.locator('.boss-bar').count()) > 0, 'stage boss bar shown');
  await look(Math.PI, -0.3);
  await page.waitForTimeout(800);
  await shot('glitched-structure');

  // A V4 village
  await teleportRow('Village');
  await look(0.6, -0.25);
  await page.waitForTimeout(2500);
  await shot('village');
  await look(2.4, -0.2);
  await page.waitForTimeout(1500);
  await shot('village-2');

  // The fluid rig
  await openTab();
  await page.getByRole('button', { name: 'Build fluid test rig' }).click();
  await closePanel();
  await look(-Math.PI / 2 + 0.2, -0.5);
  await page.waitForTimeout(12000);
  await shot('fluid-rig');

  const real = errors.filter((e) => !/texImage3D|WebGL/.test(e));
  check(real.length === 0, `no page errors (${real.join(' | ')})`);
  console.log('V4 E2E: PASS');
} catch (e) {
  failed = true;
  console.log('V4 E2E: FAIL', e);
  await shot('failure').catch(() => {});
} finally {
  await browser.close();
  stop();
  process.exit(failed ? 1 : 0);
}
