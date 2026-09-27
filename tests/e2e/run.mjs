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
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if (process.env.CHEATS && (await cheatsOff.count()) > 0) await cheatsOff.click();
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
  if (process.env.TP) {
    // Optional sightseeing: teleport (needs CHEATS=1) and look around
    const [tx, ty, tz, yaw = '0', pitch = '0.3'] = process.env.TP.split(',');
    await page.evaluate((cmd) => window.minehonk.game.send({ t: 'chat', text: cmd }), `/tp ${tx} ${ty} ${tz}`);
    await page.waitForTimeout(1000);
    await page.evaluate(([y, p]) => {
      const g = window.minehonk.game;
      g.player.yaw = Number(y);
      g.player.pitch = Number(p);
      if (g.player.abilities.mayFly) g.player.flying = true;
    }, [yaw, pitch]);
    await page.waitForFunction(() => window.minehonk.game.renderer.chunks.stats().dirty < 30, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/03b-teleport.png` });
    if (process.env.TP_ONLY) {
      await browser.close();
      stopServer();
      process.exit(0);
    }
  }
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
  // Horizon view
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.player.yaw = Math.PI * 0.75;
    g.player.pitch = -0.15;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04b-horizon.png` });
  // Mine the block underfoot with a simulated held left mouse button
  const mined = await page.evaluate(async () => {
    const app = window.minehonk;
    const g = app.game;
    app.input.locked = true;
    // Look at the ground just in front (not under our feet, so we can place it back)
    g.player.yaw = 0;
    g.player.pitch = 0.95;
    await new Promise((r) => setTimeout(r, 300));
    const t = g.interaction.target;
    if (!t) return { error: 'no target' };
    const before = g.world.getState(t.x, t.y, t.z);
    const canvas = document.getElementById('game-canvas');
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    const t0 = performance.now();
    while (performance.now() - t0 < 8000 && g.world.getState(t.x, t.y, t.z) !== 0) await new Promise((r) => setTimeout(r, 100));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    const brokeIn = performance.now() - t0;
    // wait for the drop to be picked up
    const t1 = performance.now();
    let count = 0;
    while (performance.now() - t1 < 6000) {
      count = g.invSlots.reduce((a, s) => a + (s ? s.count : 0), 0);
      if (count > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { before, after: g.world.getState(t.x, t.y, t.z), brokeIn: Math.round(brokeIn), items: g.invSlots.map((s, i) => (s ? [i, s.id, s.count] : null)).filter(Boolean), entities: g.entities.size };
  });
  console.log('mined', JSON.stringify(mined));
  if (mined.error || mined.after !== 0 || mined.items.length === 0) throw new Error('mining failed: ' + JSON.stringify(mined));
  // Place it back: select the slot holding the item and right click the block below
  const placed = await page.evaluate(async () => {
    const g = window.minehonk.game;
    const slot = g.invSlots.findIndex((s, i) => s && i >= 36 && i <= 44);
    if (slot < 0) return { error: 'item not in hotbar' };
    g.selected = slot - 36;
    g.send({ t: 'hotbar', slot: slot - 36 });
    await new Promise((r) => setTimeout(r, 400));
    const t = g.interaction.target;
    if (!t) return { error: 'no target to place on' };
    const canvas = document.getElementById('game-canvas');
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    await new Promise((r) => setTimeout(r, 1500));
    const count = g.invSlots.reduce((a, s) => a + (s ? s.count : 0), 0);
    return { target: [t.x, t.y, t.z, t.face], count };
  });
  console.log('placed', JSON.stringify(placed));
  if (placed.error || placed.count !== 0) throw new Error('placing failed: ' + JSON.stringify(placed));
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
