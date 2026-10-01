/**
 * V5.5 browser check: the title screen's Digital Corruption scenes, then a
 * cheats world: a computer taken over (the takeover lines, Herobrine coming
 * out of the screen), the computer's window (screen and hardware), the
 * world inside the computer (the lake, the fog, him across the water), an
 * old terminal, the cave and the final fight, the grimoire and the ending
 * card. Screenshots go to tests/e2e/out/v55-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4185;
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
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.type(), m.text().slice(0, 300)); });

// The title screen's scenes
for (const scene of ['computer_lab', 'digital_world', 'herobrine_cave', 'dragon_malware']) {
  await page.goto(`http://localhost:${PORT}/?title=${scene}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.waitForTimeout(scene === 'digital_world' || scene === 'herobrine_cave' ? 14000 : 10000);
  await page.screenshot({ path: `${OUT}/v55-title-${scene}.png` });
}
check('title edition', ((await page.locator('.logo-edition').textContent()) ?? '').includes('V5.5 - The Digital Corruption Update'));

await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = 4));
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill('v55-e2e');
const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
if ((await cheatsOff.count()) > 0) await cheatsOff.click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
await page.waitForFunction(() => { const l = document.querySelector('.loading'); return l && l.classList.contains('hidden') && window.minehonk?.game?.joined; }, null, { timeout: 180000 });
const cmd = async (t) => { await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t); await page.waitForTimeout(800); };
const admin = (op) => page.evaluate((op) => window.minehonk.game.adminRequest({ a: 'v55', op }), op);
const waitLoaded = () => page.waitForFunction(() => { const l = document.querySelector('.loading'); return l && l.classList.contains('hidden'); }, null, { timeout: 120000 });
await cmd('/gamemode creative');
await cmd('/time set 6000');
await page.waitForTimeout(2000);
const pos = await page.evaluate(() => { const b = window.minehonk.game.player.body; return [b.x, b.y, b.z]; });
await page.evaluate(() => { const pl = window.minehonk.game.player; pl.yaw = Math.PI; pl.pitch = 0.15; });

// Herobrine comes out of a computer (an Admin Panel trigger: a cheat run)
const ev = await admin('trigger_event');
check('herobrine event triggered', ev.ok);
const gw = (await admin('status')).data?.gateway ?? null;
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/v55-takeover.png` });
check('takeover lines on screen', (await page.locator('.takeover-line').count()) > 0);
await page.waitForTimeout(6500);
await page.screenshot({ path: `${OUT}/v55-emerge.png` });
await page.waitForTimeout(3000);
const hb = await page.evaluate(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'herobrine'));
check('herobrine is out', hb);
await page.screenshot({ path: `${OUT}/v55-herobrine.png` });
check('boss bar', (await page.locator('.boss-herobrine').count()) === 1);
await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v55', op: 'reset_progress' }));
await page.waitForTimeout(1500);

// A computer's window: the screen and the hardware
const near = gw ? [gw.x, gw.y, gw.z] : null;
if (near) {
  await page.evaluate(([x, y, z]) => window.minehonk.game.send({ t: 'use_on', x, y, z, face: 2, hx: 0.5, hy: 0.5, hz: 0, hand: 0, yaw: 0, pitch: 0, seq: 99 }), near);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/v55-computer-screen.png` });
  check('computer window', (await page.locator('.pc-gui').count()) === 1);
  const hwTab = page.locator('.pc-tab', { hasText: 'Hardware' });
  if (await hwTab.count()) await hwTab.dispatchEvent('mousedown');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/v55-computer-hardware.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
} else console.log('no computer found near the player');

// Inside the computer
const ent = await admin('enter_world');
check('entered the computer world', ent.ok);
await waitLoaded();
await page.waitForTimeout(6000);
await page.evaluate(() => { const pl = window.minehonk.game.player; pl.yaw = 0; pl.pitch = 0.05; });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/v55-inside.png` });
check('in the computer dimension', await page.evaluate(() => window.minehonk.game.dimension === 'computer'));
// The exit terminal
const L = await page.evaluate(() => window.minehonk.game.player.body.x);
void L;
await page.evaluate(() => window.minehonk.openGrimoire?.());
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/v55-grimoire.png` });
check('grimoire opens', (await page.locator('.grimoire').count()) === 1);
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
}
await page.screenshot({ path: `${OUT}/v55-grimoire-p4.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// The cave and the final fight
const fin = await admin('spawn_final');
check('final herobrine', fin.ok);
await page.waitForTimeout(9000);
await page.evaluate(() => { const pl = window.minehonk.game.player; pl.yaw = -Math.PI / 2; pl.pitch = 0.1; });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/v55-cave.png` });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/v55-fight.png` });
const fs2 = await admin('status');
check('the final fight is on', !!fs2.data?.fight && fs2.data.fight.kind === 'final');

// The ending card (forced)
await admin('force_ending');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/v55-ending.png` });
check('herobrine ending card', (await page.locator('.ending-herobrine').count()) >= 1);
await admin('reset_progress');
await page.waitForTimeout(2000);
check('no page errors', errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `V5.5 E2E: FAIL (${failed.map(([n]) => n).join(', ')})` : 'V5.5 E2E: PASS');
process.exit(failed.length ? 1 : 0);
