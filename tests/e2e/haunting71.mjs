/**
 * V7.1 in the browser: several hauntings at once from the Admin Panel's
 * Haunting tab. "Start all four" starts Herobrine, Null, Green Steve and the
 * Cave Dweller side by side; the tab lists each one running and marks them
 * in the picker; each says its own lines; Stop for one leaves the others;
 * Stop all ends the rest. Also: the tab fits a small window.
 * Screenshots: tests/e2e/out/haunting71-*.png.
 *
 *   npx vite build && node tests/e2e/haunting71.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4197;
const checks = [];
const check = (name, ok) => {
  checks.push([name, !!ok]);
  console.log(ok ? 'ok  ' : 'FAIL', name);
};
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
process.on('exit', () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const inGame = () =>
  page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
async function newWorld(name, seed = 'haunting4-e2e') {
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) input').first().fill(name);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await inGame();
}
async function openWorld(name) {
  await page.getByText('Singleplayer').click();
  await page.waitForTimeout(600);
  await page.locator('.screen:not(.hidden) .list-item', { hasText: name }).first().click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Play Selected World' }).click();
  await inGame();
}
const cmd = (t) => page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t);
/** Flat open grass around the player, and the time. */
async function clearing(time = 6000, r = 20) {
  await cmd(`/fill ~-${r} ~ ~-${r} ~${r} ~8 ~${r} air`);
  await cmd(`/fill ~-${r} ~-1 ~-${r} ~${r} ~-1 ~${r} grass_block`);
  await cmd(`/fill ~-${r} ~-4 ~-${r} ~${r} ~-2 ~${r} dirt`);
  await cmd('/gamerule doMobSpawning false');
  await cmd(`/time set ${time}`);
  await page.waitForTimeout(1500);
}
async function openHauntTab() {
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="haunt"]').dispatchEvent('mousedown');
  await page.waitForTimeout(900);
}
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
const chatText = () => page.evaluate(() => [...(window.__chatLog ?? []), ...[...document.querySelectorAll('.chat .line')].map((e) => e.textContent)].join('\n')).catch(() => '');
const running = () => page.locator('.haunt-running').innerText();
const look = (s = 0.35) =>
  page.evaluate((s) => {
    const p = window.minehonk.game?.player;
    if (p) p.yaw = (p.yaw + s) % (Math.PI * 2);
  }, s);

await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
await page.evaluate(() => {
  window.__chatLog = [];
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('line')) window.__chatLog.push(n.textContent);
  }).observe(document.body, { childList: true, subtree: true });
});
await newWorld('Four', 'haunting71-e2e');
await clearing(6000);
await openHauntTab();
check('nobody haunting at first', /Haunting\s+Nobody/.test(await running()));
check('Start all four is offered', (await page.locator('.haunt-start-all').textContent()) === 'Start all four');
await page.locator('.haunt-all-minutes').fill('2');
await page.locator('.haunt-start-all').click();
await page.waitForTimeout(1200);
const four = await running();
const names = ['Herobrine', 'Null', 'Green Steve', 'The Cave Dweller'];
check(`all four haunting at once (${four.replace(/\s+/g, ' ').slice(0, 200)})`, names.every((n) => four.includes(n)) && (await page.locator('.haunt-run').count()) === 4);
check('the picker marks all four as haunting', (await page.locator('.haunt-char.haunt-on').count()) === 4);
check('Start all four is spent', await page.locator('.haunt-start-all').isDisabled() && (await page.locator('.haunt-start-all').textContent()) === 'All four are haunting');
await page.evaluate(() => document.querySelectorAll('.admin-panel, .admin-panel *').forEach((e) => e.scrollTop && (e.scrollTop = 0)));
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/haunting71-all-four.png` });
// Each one's own controls: picked, it is running
await page.locator('.haunt-char-green_steve').click();
await page.waitForTimeout(400);
check("Green Steve picked: his own controls (Stop Green Steve)", (await page.locator('.haunt-stop').textContent()).includes('Green Steve') && (await page.locator('.haunt-skip').count()) === 1);
await page.screenshot({ path: `${OUT}/haunting71-green-steve.png` });
// A small window: nothing spills out
await page.setViewportSize({ width: 800, height: 600 });
await page.waitForTimeout(500);
const spill = await page.evaluate(() => [...document.querySelectorAll('.admin-panel *')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).map((e) => e.className).slice(0, 5));
check(`the tab fits 800x600 (${spill.join(', ')})`, spill.length === 0);
await page.screenshot({ path: `${OUT}/haunting71-small.png` });
await page.setViewportSize({ width: 1280, height: 720 });
await closePanel();
// They all go on, each in its own voice
for (let i = 0; i < 90; i++) {
  await look(0.3);
  await page.waitForTimeout(500);
}
const chat = await chatText();
const who = { 'Green Steve': /Green Steve joined the world|hi!|can I play with you/, Null: /\bnull\b/ };
for (const [n, re] of Object.entries(who)) check(`${n} speaks while the others haunt`, re.test(chat));
await page.screenshot({ path: `${OUT}/haunting71-playing.png` });
await openHauntTab();
const later = await running();
check(`all four still running, each further on (${later.replace(/\s+/g, ' ').slice(0, 200)})`, names.every((n) => later.includes(n)) && !/0:00 \//.test(later));
// Stop one: the others carry on
await page.locator('.haunt-char-null').click();
await page.waitForTimeout(300);
await page.locator('.haunt-stop').click();
await page.waitForTimeout(1000);
const three = await running();
check(`Null stopped, the other three go on (${three.replace(/\s+/g, ' ').slice(0, 160)})`, !three.includes('Null') && (await page.locator('.haunt-run').count()) === 3);
check('Null can be started again (the start form shows)', (await page.locator('.haunt-start').count()) === 1 && (await page.locator('.haunt-start-all').textContent()) === 'Start the other one');
await page.screenshot({ path: `${OUT}/haunting71-three.png` });
// Stop all
await page.locator('.haunt-stop-all').click();
await page.waitForTimeout(1000);
check('Stop all: nobody haunting', /Haunting\s+Nobody/.test(await running()) && (await page.locator('.haunt-char.haunt-on').count()) === 0);
await closePanel();

check(`no page errors (${errors.join(' | ').slice(0, 300)})`, errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `HAUNTING71 E2E: FAIL (${failed.length})` : 'HAUNTING71 E2E: PASS');
process.exit(failed.length ? 1 : 0);
