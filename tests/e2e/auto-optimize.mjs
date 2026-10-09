/**
 * Auto Optimize in the browser: severe lag (slowed frames) for a few seconds
 * lowers one setting at a time with a toast and a chat line, saves it, and
 * Options > Video Settings can undo it all or switch it off. Automated
 * browsers have it off unless the page asks (?autoopt), so the other tests
 * keep their settings. Screenshots: tests/e2e/out/auto-optimize-*.png.
 *
 *   npx vite build && node tests/e2e/auto-optimize.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4191;
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Every frame can be made slow: the busy wait happens before the game's own frame
await page.addInitScript(() => {
  window.__lag = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf(() => {
      const t0 = performance.now();
      while (performance.now() - t0 < window.__lag);
      cb(performance.now());
    });
});

const settings = () => page.evaluate(() => {
  const s = window.minehonk.settings;
  return { particles: s.particles, clouds: s.clouds, resolutionScale: s.resolutionScale, renderDistance: s.renderDistance, autoOptimize: s.autoOptimize, undo: s.autoOptimizeUndo, saved: JSON.parse(localStorage.getItem('minehonk.settings') ?? '{}') };
});
const toast = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => (t.style.transform === 'translateX(0px)' || t.style.transform === 'translateX(0)' ? t.textContent : '')).join(''));
const chat = () => page.evaluate(() => [...document.querySelectorAll('.chat .line')].map((e) => e.textContent).join('\n'));

// Automated browsers leave it off unless asked
await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => {
  window.minehonk.settings.renderDistance = 10;
  window.minehonk.settings.particles = 'all';
  window.minehonk.settings.clouds = true;
  localStorage.setItem('minehonk.settings', JSON.stringify(window.minehonk.settings));
});
await page.goto(`http://localhost:${PORT}/?autoopt`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
check('Auto Optimize is on by default', (await settings()).autoOptimize === true);
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
await page.waitForFunction(() => {
  const l = document.querySelector('.loading');
  return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
}, null, { timeout: 180000 });
check('the game in this page may optimize (?autoopt)', await page.evaluate(() => window.minehonk.game.autoOptimizer.enabled));

// Severe lag: about 6 frames a second
await page.waitForTimeout(9000);
await page.evaluate(() => (window.__lag = 160));
await page.waitForFunction(() => window.minehonk.settings.autoOptimizeUndo, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);
let s = await settings();
check(`severe lag lowers the first setting (particles: ${s.particles})`, s.particles === 'decreased' && s.clouds === true);
check(`a toast says so (${await toast()})`, /Lag detected/.test(await toast()) && /Particles: Decreased/.test(await toast()));
check('a chat line explains it and how to undo it', /Auto Optimize: the game was running at \d+ fps, so it lowered Particles: Decreased\. To undo it or turn it off: Options > Video Settings\./.test(await chat()));
check('the change is saved, with what to put back', s.saved.particles === 'decreased' && s.saved.autoOptimizeUndo?.particles === 'all');
await page.screenshot({ path: `${OUT}/auto-optimize-toast.png` });
// Still lagging: the next step comes after the cooldown
await page.waitForFunction(() => !window.minehonk.settings.clouds, null, { timeout: 40000 }).catch(() => {});
s = await settings();
check(`still lagging, the next setting goes (clouds: ${s.clouds})`, s.clouds === false);

// Smooth again: Video Settings undoes it all
await page.evaluate(() => (window.__lag = 0));
await page.evaluate(() => window.minehonk.openPause());
await page.locator('.screen:not(.hidden) button', { hasText: 'Options...' }).first().click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Video Settings...' }).click();
const undo = page.locator('button.auto-opt-undo');
check(`Video Settings offers to undo it (${await undo.textContent().catch(() => '')})`, /Undo Auto Optimize \(\d+ settings?\)/.test((await undo.textContent().catch(() => '')) ?? ''));
check('and shows the switch', (await page.locator('.screen:not(.hidden) button', { hasText: 'Auto Optimize: ON' }).count()) === 1);
await page.screenshot({ path: `${OUT}/auto-optimize-video-settings.png` });
const before = s.undo;
await undo.click();
s = await settings();
check(`Undo puts back what it lowered (${JSON.stringify(before)})`, s.particles === 'all' && s.clouds === true && s.renderDistance === 10 && s.undo === null && s.saved.autoOptimizeUndo === null);
check('the Undo button goes away', (await page.locator('button.auto-opt-undo').count()) === 0);

// Switched off: lag changes nothing
await page.locator('.screen:not(.hidden) button', { hasText: 'Auto Optimize: ON' }).click();
check('the switch turns it off (and saves it)', (await settings()).saved.autoOptimize === false);
await page.evaluate(() => window.minehonk.closeScreens());
await page.waitForTimeout(500);
await page.evaluate(() => (window.__lag = 160));
await page.waitForTimeout(12000);
await page.evaluate(() => (window.__lag = 0));
s = await settings();
check('switched off, lag changes nothing', s.particles === 'all' && s.clouds === true && s.undo === null);

check(`no page errors (${errors.join(' | ').slice(0, 300)})`, errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `AUTO OPTIMIZE E2E: FAIL (${failed.length})` : 'AUTO OPTIMIZE E2E: PASS');
process.exit(failed.length ? 1 : 0);
