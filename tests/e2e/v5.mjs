/**
 * V5 browser check: a cheats world, the Admin Panel's test production line
 * (rendered machines, conveyors, cables, a monitor), a machine window, the
 * Engineering Crafting Table with the Engineering Book beside it, the book
 * on its own and the creative Engineering tab. Screenshots go to
 * tests/e2e/out/v5-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4182;
const checks = [];
const check = (name, ok) => {
  checks.push([name, !!ok]);
  console.log(ok ? 'ok  ' : 'FAIL', name);
};
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('[pageerror]', e); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = 4));
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill('v5-e2e');
const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
if ((await cheatsOff.count()) > 0) await cheatsOff.click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
await page.waitForFunction(() => { const l = document.querySelector('.loading'); return l && l.classList.contains('hidden') && window.minehonk?.game?.joined; }, null, { timeout: 180000 });
const cmd = async (t) => { await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t); await page.waitForTimeout(800); };
await cmd('/gamemode creative');
await cmd('/time set 6000');
await page.waitForTimeout(2000);
const pos = await page.evaluate(() => { const b = window.minehonk.game.player.body; return [b.x, b.y, b.z]; });
console.log('player at', pos.map((v) => v.toFixed(1)).join(' '));
const rig = await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v5', op: 'test_rig' }));
check('test line built', rig.ok);
const x0 = Math.floor(pos[0]) + 2, y0 = Math.floor(pos[1]), z0 = Math.floor(pos[2]) + 2;
await page.waitForTimeout(4000);
// Look at the rig from above and in front
const look = async (from, at) => {
  await cmd(`/tp ${from[0]} ${from[1]} ${from[2]}`);
  const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2];
  await page.evaluate(([y, p]) => { const pl = window.minehonk.game.player; pl.yaw = y; pl.pitch = p; pl.flying = true; }, [Math.atan2(-dx, -dz), -Math.atan2(dy, Math.hypot(dx, dz))]);
  await page.waitForTimeout(3000);
};
await cmd('/gamemode spectator');
await look([x0 + 4.5, y0 + 3.5, z0 - 3.5], [x0 + 4.5, y0, z0 + 0.5]);
await page.screenshot({ path: `${OUT}/v5-rig.png` });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/v5-rig-later.png` });
await cmd('/gamemode creative');
await page.waitForTimeout(500);
// Machine window: use the crusher
const useOn = (x, y, z) => page.evaluate(([x, y, z]) => window.minehonk.game.send({ t: 'use_on', x, y, z, face: 2, hx: 0.5, hy: 0.5, hz: 0, hand: 0, yaw: 0, pitch: 0, seq: 99 }), [x, y, z]);
await page.evaluate(() => { const g = window.minehonk.game; g.selected = 8; g.send({ t: 'hotbar', slot: 8 }); g.send({ t: 'creative_set', slot: 44, item: null }); });
await useOn(x0 + 6, y0, z0);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/v5-machine.png` });
check('machine window open', (await page.locator('.eng-gui').count()) === 1);
check('machine at work', (await page.locator('.eng-status').textContent().catch(() => '')) === 'Working');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// The Engineering Table with the book beside it
await cmd(`/fill ${x0 + 2} ${y0} ${z0 - 2} ${x0 + 2} ${y0} ${z0 - 2} engineering_table`);
await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v5', op: 'kit_basic' }));
await page.waitForTimeout(800);
await useOn(x0 + 2, y0, z0 - 2);
await page.waitForTimeout(1500);
const chip = page.locator('.eb-entry-chip', { hasText: 'Copper Wire' }).first();
if (await chip.count()) await chip.click();
else {
  await page.locator('.eb-chapter', { hasText: 'Power' }).click();
  await page.waitForTimeout(300);
  await page.locator('.eb-entry-chip', { hasText: 'Copper Wire' }).first().click();
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/v5-table.png` });
check('table with the book beside it', (await page.locator('.eng-book').count()) === 1);
check('book entry shows a recipe', (await page.locator('.eb-recipe').count()) >= 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// The book alone, at a chapter
await page.evaluate(() => window.minehonk.openEngineeringBook('logic_gate'));
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/v5-book.png` });
check('book opens at an entry', ((await page.locator('.eb-title').first().textContent()) ?? '').includes('Logic Gate'));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// Inventory icons of the creative engineering tab
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
const tab = page.locator('.tab[title="Engineering"]');
await page.screenshot({ path: `${OUT}/v5-creative-tabs.png` });
if (await tab.count()) await tab.dispatchEvent('mousedown');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/v5-creative.png` });
check('creative engineering tab', (await page.locator('.tab.active[title="Engineering"]').count()) === 1);
check('no page errors', errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `V5 E2E: FAIL (${failed.map(([n]) => n).join(', ')})` : 'V5 E2E: PASS');
process.exit(failed.length ? 1 : 0);
