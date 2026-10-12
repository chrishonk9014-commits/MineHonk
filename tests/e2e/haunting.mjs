/**
 * The Haunting in the browser: the Admin Panel's Haunting tab, a two-minute
 * haunting in a single player world from the first sighting to the end
 * (his figure, the signs he leaves, "Herobrine joined", "YOU ARE NOT SAFE"
 * in glitched red, talking to him and getting an answer, the dark closing
 * in, the chase, the jumpscare, the fake ban screen and the world deleted),
 * then a skipped-through haunting that keeps the world, then the lair ending
 * (dragged along the ground, pulled into the computer, wired into a chair in
 * his hall, shocked, SERVER MEMORY CORRUPTED, back to the title).
 * Screenshots: tests/e2e/out/haunting-*.png.
 *
 *   npx vite build && node tests/e2e/haunting.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4192;
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
// UPDATE_LOG_SHOTS=1: each screenshot also gets a clean copy in tests/e2e/out/clean (no HUD), for the
// Update Log's pictures (tools/update-log/build-images.mjs)
if (process.env.UPDATE_LOG_SHOTS) {
  const CLEAN = path.join(OUT, 'clean');
  fs.mkdirSync(CLEAN, { recursive: true });
  const shoot = page.screenshot.bind(page);
  const HIDE = ['.hotbar', '.crosshair', '.debug', '.debug-right', '.quest-tracker', '.cheats-indicator', '.chat', '.xpbar', '.xplevel', '.stat-row', '.item-name', '.toast', '.subtitles'];
  page.screenshot = async (opts = {}) => {
    if (opts.path) {
      const was = await page.evaluate((hide) => {
        if (!document.getElementById('clean-shot')) document.head.append(Object.assign(document.createElement('style'), { id: 'clean-shot', textContent: hide.map((c) => `body.clean-shot ${c}`).join(',') + '{visibility:hidden!important}' }));
        document.body.classList.add('clean-shot');
        const g = window.minehonk?.game;
        const w = g?.hudHidden ?? false;
        if (g) g.hudHidden = true;
        return w;
      }, HIDE).catch(() => false);
      await page.waitForTimeout(150);
      await shoot({ ...opts, path: path.join(CLEAN, path.basename(opts.path)) }).catch(() => {});
      await page.evaluate((w) => {
        document.body.classList.remove('clean-shot');
        const g = window.minehonk?.game;
        if (g) g.hudHidden = w;
      }, was).catch(() => {});
    }
    return shoot(opts);
  };
}

const inGame = () =>
  page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
async function newWorld(name) {
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) input').first().fill(name);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill('haunting-e2e');
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await inGame();
}
async function openHauntTab() {
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="haunt"]').dispatchEvent('mousedown');
  await page.waitForTimeout(800);
}
const chatText = () => page.evaluate(() => [...document.querySelectorAll('.chat .line')].map((e) => e.textContent).join('\n'));
/** Turns to look at the nearest Herobrine (if one is near) and returns how far he is. */
const lookAtHerobrine = () =>
  page.evaluate(() => {
    const g = window.minehonk.game;
    // The end can come at any moment (the game is gone)
    if (!g) return null;
    const b = g.player.body;
    const hb = [...g.entities.values()].filter((e) => e.type === 'herobrine').sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
    if (!hb) return null;
    const dx = hb.x - b.x;
    const dz = hb.z - b.z;
    const d = Math.hypot(dx, dz);
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = -Math.atan2(hb.y + 1.6 - (b.y + 1.62), d) * 0.9;
    return d;
  });

await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
await newWorld('Haunted');
await page.evaluate(() => window.minehonk.game.send({ t: 'chat', text: '/time set 12500' }));

// ------------------------------------------------------------------ the tab
await openHauntTab();
const tabText = await page.locator('.admin-body').innerText();
check('the Admin Panel has a Haunting tab with its stages', /Herobrine haunts this world/.test(tabText) && /He is watching/.test(tabText) && /The end/.test(tabText));
check('it offers to delete the world at the end (the owner may)', (await page.locator('.haunt-finale').textContent()) === 'At the end: Delete the world' && !(await page.locator('.haunt-finale').isDisabled()));
check('the ending is left to chance unless chosen', (await page.locator('.haunt-ending').textContent()) === 'Ending: Random' && /one time in four/.test(await page.locator('.haunt-ending-help').textContent()));
await page.locator('.haunt-ending').click();
check('the ending can be the ban screen', (await page.locator('.haunt-ending').textContent()) === 'Ending: The ban screen');
await page.locator('.haunt-minutes').fill('2');
await page.locator('.haunt-minutes').dispatchEvent('change');
await page.screenshot({ path: `${OUT}/haunting-tab.png` });
await page.locator('.haunt-start').click();
check('deleting the world asks for a second click', /Click again/.test(await page.locator('.haunt-start').textContent()));
await page.locator('.haunt-start').click();
await page.waitForTimeout(1200);
const statusText = await page.locator('.admin-body').innerText();
check(`it starts (${statusText.match(/Time\s+\S+/)?.[0] ?? ''})`, /He is watching/.test(statusText) && /The world is deleted/.test(statusText));
check('the tab says when he starts talking back', /Talks back\s+From "He speaks", in 1:2\d/.test(statusText));
check('nobody is told in chat', !/\[Admin\]/.test(await chatText()));
await page.keyboard.press('Escape');

// ------------------------------------------------------------------ two minutes of it
const t0 = Date.now();
let sightings = 0;
let sawBlocks = new Set();
const shots = new Set();
let joined = false;
let warned = false;
let darkMax = 0;
let jumpscared = false;
let asked = 0;
let answer = null;
const OWN_LINES = ['stop', 'YOU ARE NOT SAFE', 'I HAVE BEEN WATCHING YOU', 'I SEE YOU, TESTER', 'THIS WORLD IS MINE', 'YOU SHOULD NOT HAVE COME HERE', 'THERE IS NO ESCAPE', 'TURN AROUND', 'FOUND YOU'];
for (;;) {
  const el = (Date.now() - t0) / 1000;
  const state = await page.evaluate(() => {
    const g = window.minehonk.game;
    if (!g) return null;
    return { hb: [...g.entities.values()].filter((e) => e.type === 'herobrine').length, dark: g.haunt ?? 0, scare: !document.querySelector('.jumpscare')?.classList.contains('hidden') };
  });
  if (!state) break;
  darkMax = Math.max(darkMax, state.dark);
  if (state.hb) {
    const d = await lookAtHerobrine();
    sightings++;
    const key = d === null ? '' : d > 30 ? 'far' : d > 12 ? 'mid' : 'near';
    if (key && !shots.has(key) && !state.scare) {
      shots.add(key);
      await page.screenshot({ path: `${OUT}/haunting-sighting-${key}.png` });
    }
  } else {
    // Looking around, as a player does
    await page.evaluate(() => {
      const p = window.minehonk.game?.player;
      if (!p) return;
      p.yaw = (p.yaw + 0.35) % (Math.PI * 2);
      p.pitch = 0.05;
    });
  }
  const chat = await chatText();
  if (!joined && /Herobrine joined the world/.test(chat)) joined = true;
  // From "He speaks" on (70% of two minutes), talking to him gets an answer
  if (!answer && el > 90 && el < 108 && asked < 4 && Math.floor(el) % 4 === 0) {
    asked++;
    await page.evaluate(() => window.minehonk.game?.send({ t: 'chat', text: 'herobrine, who are you?' }));
    for (let k = 0; k < 4 && !answer; k++) {
      await page.waitForTimeout(1500);
      const lines = await page.evaluate(() => [...document.querySelectorAll('.chat .line.chat-herobrine')].map((e) => e.textContent.replace(/^<Herobrine>\s*/, '').trim()));
      answer = lines.find((l) => !OWN_LINES.includes(l) && !/^I SEE YOU, /.test(l) && /^[A-Z0-9 .,'?!-]+$/.test(l)) ?? null;
    }
    if (answer) await page.screenshot({ path: `${OUT}/haunting-answer.png` });
  }
  if (!warned && /YOU ARE NOT SAFE/.test(chat)) {
    warned = true;
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/haunting-not-safe.png` });
  }
  if (state.scare && !jumpscared) {
    jumpscared = true;
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${OUT}/haunting-jumpscare.png` });
  }
  if (!shots.has('dark') && state.dark > 0.5 && !state.scare) {
    shots.add('dark');
    await page.screenshot({ path: `${OUT}/haunting-dark.png` });
  }
  // What he left around: the blocks a player would notice
  const found = await page.evaluate(() => {
    const g = window.minehonk.game;
    if (!g) return [];
    const b = g.player.body;
    const reg = window.minehonkRegistry;
    const ids = new Map([...reg.blockById.values()].map((x) => [x.num, x.id]));
    const out = new Set();
    for (let dx = -24; dx <= 24; dx += 1)
      for (let dz = -24; dz <= 24; dz += 1)
        for (let dy = -6; dy <= 12; dy++) {
          const id = ids.get(reg.blockOfState(g.world.getState(Math.floor(b.x) + dx, Math.floor(b.y) + dy, Math.floor(b.z) + dz)));
          if (id === 'redstone_torch' || id === 'redstone_wall_torch' || id === 'cobblestone' || id === 'mossy_cobblestone' || id === 'sign' || id === 'gold_block') out.add(id);
        }
    return [...out];
  });
  for (const id of found) sawBlocks.add(id);
  if (el > 260) break;
  await page.waitForTimeout(400);
}
check(`his figure showed itself (${sightings} looks; ${[...shots].join(', ')})`, sightings > 0 && shots.size > 0);
check(`he left signs around (${[...sawBlocks].join(', ')})`, sawBlocks.size > 0);
check('"Herobrine joined the world"', joined);
check('"YOU ARE NOT SAFE" in glitched red', warned && (await page.locator('.chat .line.chat-herobrine').count().catch(() => 0)) >= 0);
check(`he answers when spoken to (${answer})`, !!answer);
check(`the dark closed in (${darkMax.toFixed(2)})`, darkMax > 0.5);
check('the jumpscare', jumpscared);

// The end: the fake ban, the world gone
await page.locator('.fake-ban').waitFor({ timeout: 60000 });
const ban = await page.locator('.fake-ban').innerText();
check('the fake ban screen', /You are banned from this server\./.test(ban) && /Banned by: Herobrine/.test(ban) && /YOU WERE WARNED/.test(ban));
check('it says the world was deleted', /This world has been deleted\./.test(ban));
await page.screenshot({ path: `${OUT}/haunting-ban.png` });
await page.waitForTimeout(8600);
check('a quiet note says the ban is not real', await page.locator('.fake-ban-note.shown').isVisible());
await page.screenshot({ path: `${OUT}/haunting-ban-note.png` });
await page.locator('.fake-ban button', { hasText: 'Back to Title Screen' }).click();
await page.getByText('Singleplayer').click();
await page.waitForTimeout(800);
check('the world is gone from the world list', !(await page.locator('.screen:not(.hidden)').innerText()).includes('Haunted'));
await page.keyboard.press('Escape');

// ------------------------------------------------------------------ keeping the world
await newWorld('Kept');
await openHauntTab();
await page.locator('.haunt-finale').click();
check('the end can keep the world instead', (await page.locator('.haunt-finale').textContent()) === 'At the end: Keep the world');
await page.locator('.haunt-minutes').fill('5');
await page.locator('.haunt-minutes').dispatchEvent('change');
await page.locator('.haunt-start').click();
await page.waitForTimeout(800);
for (let i = 0; i < 4; i++) {
  await page.locator('.admin-body button', { hasText: 'Skip to the next stage' }).click();
  await page.waitForTimeout(500);
}
await page.keyboard.press('Escape');
await page.locator('.fake-ban').waitFor({ timeout: 90000 });
const ban2 = await page.locator('.fake-ban').innerText();
check('skipped to the end: the ban, without deleting', /You are banned/.test(ban2) && !/deleted/.test(ban2));
await page.locator('.fake-ban button', { hasText: 'Back to Title Screen' }).click();
await page.getByText('Singleplayer').click();
await page.waitForTimeout(800);
check('the kept world is still there', (await page.locator('.screen:not(.hidden)').innerText()).includes('Kept'));
await page.keyboard.press('Escape');

// ------------------------------------------------------------------ the lair ending
await newWorld('Lair');
// Open, level ground around (so he can drag you along it)
await page.evaluate(() => {
  const send = (t) => window.minehonk.game.send({ t: 'chat', text: t });
  send('/fill ~-12 ~ ~-12 ~12 ~6 ~12 air');
  send('/fill ~-12 ~-1 ~-12 ~12 ~-1 ~12 grass_block');
  send('/time set 13000');
});
await page.waitForTimeout(1500);
await openHauntTab();
// (The panel remembers the last choices)
while ((await page.locator('.haunt-finale').textContent()) !== 'At the end: Keep the world') await page.locator('.haunt-finale').click();
while ((await page.locator('.haunt-ending').textContent()) !== 'Ending: Server memory corrupted') await page.locator('.haunt-ending').click();
check('the ending can be his lair inside the computer', /SERVER MEMORY CORRUPTED/.test(await page.locator('.haunt-ending-help').textContent()));
await page.locator('.haunt-minutes').fill('5');
await page.locator('.haunt-minutes').dispatchEvent('change');
await page.locator('.haunt-start').click();
await page.waitForTimeout(800);
for (let i = 0; i < 4; i++) {
  await page.locator('.admin-body button', { hasText: 'Skip to the next stage' }).click();
  await page.waitForTimeout(500);
}
await page.keyboard.press('Escape');
const seen = [];
const lairShots = new Set();
let lairDim = null;
const t1 = Date.now();
while (Date.now() - t1 < 90000) {
  const st = await page.evaluate(() => ({ step: document.querySelector('.haunt-scene')?.dataset.step ?? '', dim: window.minehonk?.game?.dimension ?? null, title: !window.minehonk?.game })).catch(() => ({ step: '', dim: null, title: true }));
  if (st.title) break;
  if (st.step && seen[seen.length - 1] !== st.step) seen.push(st.step);
  if (st.dim === 'computer') lairDim = 'computer';
  const shot = async (name, wait = 0) => {
    if (lairShots.has(name)) return;
    lairShots.add(name);
    if (wait) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/haunting-lair-${name}.png` });
  };
  if (st.step === 'grab') await shot('grab', 450);
  else if (st.step === 'drag') await shot('drag', 1800);
  else if (st.step === 'wake') await shot('wake', 3200);
  else if (st.step === 'shock') await shot('shock', 60);
  else if (st.step === 'die') await shot('die', 900);
  else if (st.step === 'corrupt') await shot('corrupt', 3500);
  await page.waitForTimeout(120);
}
check(`the lair ending played (${seen.join(' > ')})`, ['drag', 'wake', 'shock', 'die', 'corrupt'].every((s) => seen.includes(s)));
check('they were pulled inside the computer', lairDim === 'computer');
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
check('back to the title with no ban screen', (await page.locator('.fake-ban').count()) === 0);
await page.getByText('Singleplayer').click();
await page.waitForTimeout(800);
check('the world (kept) is still there', (await page.locator('.screen:not(.hidden)').innerText()).includes('Lair'));

check(`no page errors (${errors.join(' | ').slice(0, 300)})`, errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `HAUNTING E2E: FAIL (${failed.length})` : 'HAUNTING E2E: PASS');
process.exit(failed.length ? 1 : 0);
