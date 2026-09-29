/**
 * V1 features end to end in a real browser: the Recipe Book in the inventory,
 * the Admin Panel (give items, spawn mobs, structure and biome teleports,
 * performance tab) and the cheats indicator. Requires `npx vite build`.
 * Screenshots go to tests/e2e/out/v1-*.png.
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
const shot = (name) => page.screenshot({ path: `${OUT}/v1-${name}.png` });
const check = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log('  ok:', msg);
};
const game = () => page.evaluate(() => !!window.minehonk?.game);
const invIds = () =>
  page.evaluate(() => {
    const g = window.minehonk.game;
    return g.invSlots.filter(Boolean).map((s) => ({ id: s.id, count: s.count, admin: !!s.tag?.admin }));
  });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.waitForTimeout(300);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill('v1-e2e');
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
  check(await game(), 'world loaded');
  await page.waitForTimeout(1500);
  // Record every advancement toast from here on: admin actions must never produce one
  await page.evaluate(() => {
    const hud = window.minehonk.game.hud;
    const toast = hud.toast.bind(hud);
    window.__toasts = [];
    hud.toast = (title, text) => {
      window.__toasts.push(`${title}: ${text}`);
      return toast(title, text);
    };
  });

  // Cheats indicator
  const indicator = await page.locator('.cheats-indicator').textContent();
  check(indicator.includes('Cheats enabled'), `cheats indicator shows: ${indicator}`);

  // ---------------------------------------------------------------- recipe book
  await page.evaluate(() => window.minehonk.game.openInventory());
  await page.locator('.rb-button').waitFor({ timeout: 5000 });
  await page.locator('.rb-button').dispatchEvent('mousedown');
  await page.locator('.recipe-book').waitFor({ timeout: 5000 });
  const rows = await page.locator('.rb-row').count();
  check(rows > 700, `recipe book lists ${rows} recipes`);
  await page.locator('.rb-search').fill('iron pickaxe');
  await page.waitForTimeout(200);
  const filtered = await page.locator('.rb-row').count();
  check(filtered > 0 && filtered < 20, `search narrows to ${filtered}`);
  await page.locator('.rb-row').first().dispatchEvent('mousedown');
  await page.waitForTimeout(200);
  const status = await page.locator('.rb-status').textContent();
  check(status.includes('Missing'), `empty inventory shows missing ingredients: ${status}`);
  await shot('recipe-book');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- admin panel
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  await shot('admin-items');
  // Give: search, select, give 3 iron ingots and a diamond pickaxe
  await page.locator('.admin-items > .field').fill('iron ingot');
  await page.waitForTimeout(300);
  await page.locator('.admin-cell').first().dispatchEvent('mousedown');
  await page.locator('.admin-detail .admin-num').fill('3');
  await page.locator('.admin-detail .btn.admin-go').click();
  await page.waitForTimeout(800);
  await page.locator('.admin-items > .field').fill('stick');
  await page.waitForTimeout(300);
  await page.locator('.admin-cell').first().dispatchEvent('mousedown');
  await page.locator('.admin-detail .admin-num').fill('2');
  await page.locator('.admin-detail .btn.admin-go').click();
  await page.waitForTimeout(800);
  const inv = await invIds();
  check(inv.length >= 2 && inv.every((s) => s.admin), `given items arrived marked as cheat items (${JSON.stringify(inv)})`);
  const statusText = await page.locator('.admin-status').textContent();
  check(/Gave/.test(statusText), `status: ${statusText}`);

  // Spawn mobs
  await page.locator('.admin-tab[data-tab="mobs"]').dispatchEvent('mousedown');
  await page.locator('.admin-items > .field').fill('cow');
  await page.waitForTimeout(200);
  await page.locator('.admin-row').first().dispatchEvent('mousedown');
  await page.locator('.admin-detail .admin-num').fill('3');
  await page.locator('.admin-detail .btn.admin-go').click();
  await page.waitForTimeout(1500);
  const cows = await page.evaluate(() => [...window.minehonk.game.entities.values()].filter((e) => e.type === 'cow').length);
  check(cows >= 3, `spawned cows visible: ${cows}`);
  await shot('admin-mobs');

  // Structure teleport
  await page.locator('.admin-tab[data-tab="teleport"]').dispatchEvent('mousedown');
  await page.waitForTimeout(500);
  await shot('admin-teleport');
  const sel = page.locator('.admin-col').first().locator('select').nth(1);
  await sel.selectOption('village');
  await page.locator('.admin-col').first().getByRole('button', { name: 'Find nearest' }).click();
  await page.locator('.admin-result .admin-kv').first().waitFor({ timeout: 60000 });
  const found = await page.locator('.admin-result').first().textContent();
  check(/Village/.test(found) && /blocks/.test(found), `nearest village: ${found.replace(/\s+/g, ' ')}`);
  await shot('admin-found');
  const before = await page.evaluate(() => [window.minehonk.game.player.body.x, window.minehonk.game.player.body.z]);
  await page.locator('.admin-result').first().getByRole('button', { name: 'TELEPORT' }).click();
  await page.waitForFunction(() => !document.querySelector('.admin-panel'), null, { timeout: 90000 });
  // The server prepares the destination chunks first, then moves the player
  const tTp = Date.now();
  await page.waitForFunction(
    ([bx, bz]) => {
      const b = window.minehonk.game.player.body;
      return Math.hypot(b.x - bx, b.z - bz) > 30;
    },
    before,
    { timeout: 120000, polling: 250 },
  );
  console.log(`  teleport completed ${Date.now() - tTp} ms after the panel closed`);
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return !l || l.classList.contains('hidden');
  }, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => [window.minehonk.game.player.body.x, window.minehonk.game.player.body.y, window.minehonk.game.player.body.z]);
  check(Math.hypot(after[0] - before[0], after[2] - before[1]) > 30, `teleported to the village (${after.map(Math.round)}, from ${before.map(Math.round)})`);
  await shot('village');

  // Underground finder (V2): deep dark and the Ancient City
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="teleport"]').dispatchEvent('mousedown');
  await page.waitForTimeout(500);
  const under = page.locator('.admin-result').last();
  for (const [btn, name] of [['Find Deep Dark', 'Deep Dark'], ['Find Ancient City', 'Ancient City']]) {
    await page.getByRole('button', { name: btn }).click();
    await page.waitForFunction((n) => {
      const boxes = document.querySelectorAll('.admin-result');
      const t = boxes[boxes.length - 1]?.textContent ?? '';
      return t.includes(n) || /No |not /.test(t);
    }, name, { timeout: 120000 });
    const txt = (await under.textContent()).replace(/\s+/g, ' ');
    check(txt.includes(name) && /blocks/.test(txt), `underground finder: ${txt}`);
  }
  await shot('admin-underground');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Biome teleport (Nether biome from the overworld)
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="teleport"]').dispatchEvent('mousedown');
  await page.waitForTimeout(500);
  await page.locator('.admin-col').first().locator('select').first().selectOption('nether');
  await page.waitForTimeout(200);
  const biomeSel = page.locator('.admin-col').nth(1).locator('select').first();
  const options = await biomeSel.locator('option').allTextContents();
  check(options.length > 0, `nether biomes offered: ${options.join(', ')}`);
  await page.locator('.admin-col').nth(1).getByRole('button', { name: 'Teleport' }).first().click();
  await page.waitForFunction(() => window.minehonk.game.dimension === 'nether', null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return !l || l.classList.contains('hidden');
  }, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  check(true, 'arrived in the nether biome');
  await shot('nether-biome');
  const toasts = await page.evaluate(() => window.__toasts.filter((t) => t.startsWith('Advancement')));
  check(toasts.length === 0, `no advancement from any admin action (${JSON.stringify(toasts)})`);

  // Performance tab
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="perf"]').dispatchEvent('mousedown');
  await page.waitForTimeout(2500);
  const perf = await page.locator('.admin-stats').allTextContents();
  check(perf.join(' ').includes('Server TPS'), 'performance tab shows server stats');
  await shot('admin-perf');
  check(errors.length === 0, `no page errors (${errors.length})`);
  console.log('V1 E2E: PASS');
} catch (e) {
  failed = true;
  console.error('V1 E2E: FAIL', e);
  await shot('failure').catch(() => {});
} finally {
  await browser.close();
  stop();
  process.exit(failed ? 1 : 0);
}
