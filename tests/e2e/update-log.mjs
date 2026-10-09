/**
 * The Update Log in the browser: Options > Update Log from the title screen,
 * every section of the V6 entry with its pictures loaded, a card linking to
 * its section, a picture opened large and closed with Esc, a recipe and item
 * icons drawn, Done back to Options; then the same on a phone-sized screen and
 * from the pause menu of a world. Screenshots: tests/e2e/out/update-log-*.png.
 *
 *   npx vite build && node tests/e2e/update-log.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4190;
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
const errors = [];

async function openLog(page) {
  await page.locator('.screen:not(.hidden) button', { hasText: 'Options...' }).first().click();
  await page.locator('button.ul-open').click();
  await page.locator('.ul-book').waitFor();
}
/** Waits for the page's pictures that are in view (or all of them) to load; returns [loaded, total, broken]. */
const pictures = (page) =>
  page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('.ul-page img')];
    for (const i of imgs) i.loading = 'eager';
    await Promise.all(
      imgs.map((i) =>
        i.complete
          ? null
          : new Promise((r) => {
              i.addEventListener('load', r, { once: true });
              i.addEventListener('error', r, { once: true });
            }),
      ),
    );
    return [imgs.filter((i) => i.naturalWidth > 0).length, imgs.length, imgs.filter((i) => i.complete && !i.naturalWidth).map((i) => i.getAttribute('src'))];
  });

// ------------------------------------------------------------------ desktop, from the title screen
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await openLog(page);
  check('Options has an Update Log button that opens the log', await page.locator('.ul-book').isVisible());
  check('it opens on V6 - The End Expansion', (await page.locator('.ul-hero-name').textContent()) === 'The End Expansion' && (await page.locator('.ul-version.active').textContent()).startsWith('V6'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/update-log-overview.png` });

  const sections = await page.locator('.ul-nav-item').evaluateAll((els) => els.map((e) => [e.dataset.section, e.textContent]));
  check(`the V6 log has its sections (${sections.length}): ${sections.map((s) => s[1]).join(', ')}`, sections.length >= 17);
  let allPictures = 0;
  const broken = [];
  for (const [id, title] of sections) {
    await page.locator(`.ul-nav-item[data-section="${id}"]`).click();
    await page.waitForTimeout(150);
    const shown = (await page.locator('.ul-title').textContent()) === title;
    const [ok, total, bad] = await pictures(page);
    allPictures += total;
    broken.push(...bad);
    if (!shown || ok !== total) check(`section ${title}: shown and ${ok}/${total} pictures load`, false);
    if (['biomes', 'resources', 'citadel', 'multiplayer'].includes(id)) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/update-log-${id}.png` });
    }
  }
  check(`every section opens with all its pictures (${allPictures} pictures${broken.length ? `, broken: ${broken.join(', ')}` : ''})`, allPictures > 60 && broken.length === 0);

  // Icons, recipes and advancements come from the game's data
  await page.locator('.ul-nav-item[data-section="resources"]').click();
  await page.waitForTimeout(200);
  const icons = await page.locator('.ul-page .item-icon').count();
  const recipe = await page.locator('.ul-page .ul-recipe').first().textContent();
  check(`item icons and a real recipe (${icons} icons; "${recipe}")`, icons > 30 && /Ender Alloy Ingot/.test(recipe));
  await page.locator('.ul-page .ul-recipe').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/update-log-recipe.png` });
  await page.locator('.ul-nav-item[data-section="advancements"]').click();
  await page.waitForTimeout(200);
  const adv = await page.locator('.ul-adv').count();
  check(`the advancements list (${adv})`, adv >= 50);

  // A card on the overview opens its section; the next button moves on
  await page.locator('.ul-nav-item[data-section="overview"]').click();
  await page.locator('.ul-card.link', { hasText: 'The Void Citadel' }).click();
  check('an overview card opens its section', (await page.locator('.ul-title').textContent()) === 'The Void Citadel');
  await page.locator('.btn.ul-next').last().click();
  check('the next button goes to the following section', (await page.locator('.ul-title').textContent()) === 'The End Guardian');

  // A picture, large; Esc closes the picture first, then the log
  await page.locator('.ul-page .ul-figure').first().click();
  await page.waitForTimeout(300);
  check('a picture opens large', await page.locator('.ul-lightbox:not(.hidden) .ul-lightbox-img').isVisible());
  await page.screenshot({ path: `${OUT}/update-log-lightbox.png` });
  await page.keyboard.press('Escape');
  check('Esc closes the picture and keeps the log open', (await page.locator('.ul-lightbox.hidden').count()) === 1 && (await page.locator('.ul-book').isVisible()));
  await page.locator('.ul-close').click();
  check('Done goes back to Options', (await page.locator('.ul-book').count()) === 0 && (await page.locator('button.ul-open').isVisible()));
  // It remembers where it was
  await page.locator('button.ul-open').click();
  check('reopened, it is where it was left', (await page.locator('.ul-title').textContent()) === 'The End Guardian');
  await page.keyboard.press('Escape');
  check('Esc closes the log', (await page.locator('.ul-book').count()) === 0);

  // From the pause menu of a world
  await page.keyboard.press('Escape');
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
  await page.evaluate(() => window.minehonk.openPause());
  await openLog(page);
  await page.waitForTimeout(800);
  check('the log opens from the pause menu, over the world', await page.locator('.update-log-screen.dim .ul-book').isVisible());
  await page.screenshot({ path: `${OUT}/update-log-in-game.png` });
  await page.close();
}

// ------------------------------------------------------------------ a phone (portrait and landscape)
for (const [w, h, name] of [
  [390, 844, 'phone'],
  [844, 390, 'phone-landscape'],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await openLog(page);
  await page.waitForTimeout(800);
  const fit = await page.evaluate(() => {
    const b = document.querySelector('.ul-book').getBoundingClientRect();
    const text = parseFloat(getComputedStyle(document.querySelector('.ul-text')).fontSize);
    return { inside: b.left >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1, text, scroll: document.querySelector('.ul-page').scrollHeight > document.querySelector('.ul-page').clientHeight };
  });
  check(`${name}: the log fits the screen with readable text (${fit.text}px) and scrolls`, fit.inside && fit.text >= 12 && fit.scroll);
  await page.locator('.ul-nav-item[data-section="multiplayer"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/update-log-${name}.png` });
  await ctx.close();
}

check(`no page errors (${errors.join(' | ').slice(0, 300)})`, errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `UPDATE LOG E2E: FAIL (${failed.length})` : 'UPDATE LOG E2E: PASS');
process.exit(failed.length ? 1 : 0);
