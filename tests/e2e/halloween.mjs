/**
 * V7 - The Halloween Update, phase 1, in the browser:
 *  - the title screen in the season: Halloween scenes built from real terrain
 *    (a foggy forest with Herobrine far off, a glowing pumpkin patch, a misty
 *    marsh), ghosts drifting over them, taking turns; and back to the End
 *    Expansion's scenes after the cutoff;
 *  - "Halloween content: Seasonal / Always on" under More World Options;
 *  - in a world: the server's answer, natural pumpkins in every dimension
 *    (the Overworld, the Nether, the End and the Expanded End, the Farlands,
 *    inside the computer), a ghost at night, the Admin Panel's Halloween tab
 *    (placing each pumpkin, a ghost now, simulating the cutoff);
 *  - worlds created after the cutoff: Seasonal ones get nothing new, Always on
 *    ones keep it;
 *  - the Update Log's V7 and V6.5 tabs, with V6 still its own.
 * Screenshots: tests/e2e/out/halloween-*.png (UPDATE_LOG_SHOTS=1 also keeps
 * clean copies for the Update Log in tests/e2e/out/clean). The clock is set
 * with ?clock= (test browsers only), so the result does not depend on the day
 * it runs.
 *
 *   npx vite build && node tests/e2e/halloween.mjs        (ONLY=title|world|after|log for one part)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4196;
const ONLY = process.env.ONLY ?? '';
const part = (p) => !ONLY || ONLY.split(',').includes(p);
const IN_SEASON = '2026-10-31T23:00:00Z';
const AFTER = '2026-11-07T08:01:00Z';
// Phase 2 adds the two villages to the rotation (their scenes are photographed by tests/e2e/villages.mjs)
const PHASE1_SCENES = ['haunted_forest', 'pumpkin_patch', 'ghost_marsh'];
const HALLOWEEN_SCENES = [...PHASE1_SCENES, 'trick_village', 'abandoned_village'];
const END_SCENES = ['expanded_end', 'crystal_fields', 'void_citadel', 'end_eclipse'];
const PUMPKINS = { overworld: 'hallow_pumpkin', nether: 'ember_pumpkin', end: 'ender_pumpkin', farlands: 'glitched_pumpkin', computer: 'data_pumpkin' };

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

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('[pageerror]', e);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('[console]', m.text().slice(0, 300));
  });
  // UPDATE_LOG_SHOTS=1: a clean copy of each screenshot (no HUD) for the Update Log's pictures
  if (process.env.UPDATE_LOG_SHOTS) {
    const CLEAN = path.join(OUT, 'clean');
    fs.mkdirSync(CLEAN, { recursive: true });
    const shoot = page.screenshot.bind(page);
    const HIDE = ['.hotbar', '.crosshair', '.debug', '.debug-right', '.quest-tracker', '.cheats-indicator', '.chat', '.xpbar', '.xplevel', '.stat-row', '.item-name', '.wings-meters', '.hp-label', '.toast', '.subtitles', '.boss-bars'];
    page.screenshot = async (opts = {}) => {
      if (opts.path && !opts.noClean) {
        const was = await page.evaluate((hide) => {
          let st = document.getElementById('clean-shot');
          if (!st) document.head.append((st = Object.assign(document.createElement('style'), { id: 'clean-shot' })));
          st.textContent = hide.length ? hide.map((c) => `body.clean-shot ${c}`).join(',') + '{visibility:hidden!important}' : '';
          document.body.classList.add('clean-shot');
          const g = window.minehonk?.game;
          const w = g?.hudHidden ?? false;
          if (g) g.hudHidden = true;
          return w;
        }, opts.keepMenu ? [] : HIDE);
        await page.waitForTimeout(300);
        await shoot({ ...opts, path: path.join(CLEAN, path.basename(opts.path)) });
        await page.evaluate((w) => {
          document.body.classList.remove('clean-shot');
          const g = window.minehonk?.game;
          if (g) g.hudHidden = w;
        }, was);
      }
      return shoot(opts);
    };
  }
  return page;
}

const inGame = (page) =>
  page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 240000 });

/** Waits for the title panorama to be built (and a little longer, so ghosts have faded in). */
async function panoramaReady(page, settle = 4000) {
  await page.waitForFunction(() => window.minehonk?.panorama?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(settle);
}

async function newWorld(page, name, seed, halloween = 'Seasonal') {
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) input').first().fill(name);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  const opt = page.locator('.screen:not(.hidden) button', { hasText: 'Halloween content:' });
  for (let i = 0; i < 3 && !(await opt.textContent()).includes(halloween); i++) await opt.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await inGame(page);
}

const helpers = (page) => {
  const cmd = async (t, wait = 800) => {
    await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t);
    await page.waitForTimeout(wait);
  };
  const admin = (op, extra = {}) => page.evaluate(([op, extra]) => window.minehonk.game.adminRequest({ a: 'halloween', op, ...extra }), [op, extra]);
  const waitChunks = async (extra = 2500) => {
    await page.waitForFunction(() => {
      const g = window.minehonk.game;
      const b = g.player.body;
      return !g.player.frozen && g.world.isLoaded(b.x, b.z) && g.world.dimension === g.dimension && document.querySelector('.loading')?.classList.contains('hidden');
    }, null, { timeout: 120000 });
    await page.waitForTimeout(extra);
  };
  /** Pumpkins (of the given ids) in the loaded chunks round the player, nearest first. */
  const findPumpkins = (ids) =>
    page.evaluate((ids) => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      const want = new Set(ids.map((id) => reg.blockById.get(id).num));
      const base = new Map(ids.map((id) => [reg.blockById.get(id).num, reg.blockById.get(id).baseState]));
      const FACING = ['north', 'south', 'west', 'east'];
      const b = g.player.body;
      const out = [];
      for (const c of g.world.chunks.values()) {
        for (let lz = 0; lz < 16; lz++)
          for (let lx = 0; lx < 16; lx++)
            for (let y = 1; y < 200; y++) {
              const x = (c.cx << 4) + lx;
              const z = (c.cz << 4) + lz;
              const st = g.world.getState(x, y, z);
              const num = st ? reg.blockOfState(st) : -1;
              if (want.has(num)) out.push({ x, y, z, d: Math.hypot(x - b.x, z - b.z), facing: FACING[st - base.get(num)] });
            }
      }
      return out.sort((a, c) => a.d - c.d);
    }, ids);
  /** Stands a few blocks from a block, looking at it. */
  const lookAt = async (p, back = 2.8, up = 0.8) => {
    // In front of its face first (it looks that way), then the other sides, for one with air to stand in
    const spot = await page.evaluate(([p, back, up]) => {
      const g = window.minehonk.game;
      const front = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[p.facing] ?? [0, 1];
      for (const [dx, dz] of [front, [front[0] * 0.7 + front[1] * 0.7, front[1] * 0.7 - front[0] * 0.7], [front[0] * 0.7 - front[1] * 0.7, front[1] * 0.7 + front[0] * 0.7], [0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const x = p.x + 0.5 + dx * back;
        const z = p.z + 0.5 + dz * back;
        const fy = Math.floor(p.y + up);
        if (!g.world.getState(Math.floor(x), fy, Math.floor(z)) && !g.world.getState(Math.floor(x), fy + 1, Math.floor(z))) return { x, y: p.y + up - 0.5, z };
      }
      return { x: p.x + 0.5, y: p.y + up + 1, z: p.z + 0.5 + back };
    }, [p, back, up]);
    await cmd(`/tp ${spot.x.toFixed(2)} ${spot.y.toFixed(2)} ${spot.z.toFixed(2)}`, 1500);
    await waitChunks(1500);
    await page.evaluate(([p]) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const dx = p.x + 0.5 - b.x;
      const dz = p.z + 0.5 - b.z;
      const dy = p.y + 0.5 - (b.y + 1.62);
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      g.player.flying = true;
    }, [p]);
    await page.waitForTimeout(1500);
  };
  return { cmd, admin, waitChunks, findPumpkins, lookAt };
};

// ======================================================================== the title screen
if (part('title')) {
  const page = await newPage();
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await panoramaReady(page, 1000);
  const t = await page.evaluate(() => ({ scene: window.minehonk.panorama.sceneName, logo: document.querySelector('.logo')?.className, edition: document.querySelector('.logo-edition')?.textContent, splash: document.querySelector('.splash')?.textContent, footer: document.querySelector('.footer')?.textContent }));
  check(`in the season the title shows a Halloween scene (${t.scene})`, HALLOWEEN_SCENES.includes(t.scene));
  check('the logo is dressed for Halloween, edition "V7 - The Halloween Update"', /halloween/.test(t.logo) && t.edition === 'V7 - The Halloween Update' && /V7 - The Halloween Update/.test(t.footer));
  check(`a Halloween splash (${t.splash})`, /Halloween|ghost|pumpkin|Boo|treat|behind|November|carved|dark|lights|Spooky|Farlands/i.test(t.splash));
  // The scenes take turns
  const first = t.scene;
  await page.evaluate(() => (window.minehonk.panorama.sceneStart = -1e9));
  await page.waitForFunction((first) => window.minehonk.panorama.ready && window.minehonk.panorama.sceneName !== first, first, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const second = await page.evaluate(() => ({ scene: window.minehonk.panorama.sceneName, opacity: document.getElementById('game-canvas').style.opacity }));
  check(`the next Halloween scene follows (${first} -> ${second.scene}) and fades back in`, HALLOWEEN_SCENES.includes(second.scene) && second.scene !== first && second.opacity !== '0');
  await page.close();

  for (const scene of PHASE1_SCENES) {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}&title=${scene}`);
    await p.getByText('Singleplayer').waitFor({ timeout: 30000 });
    await panoramaReady(p, 6000);
    const s = await p.evaluate(() => {
      const pan = window.minehonk.panorama;
      const r = pan.renderer;
      return { scene: pan.sceneName, ghosts: r.ghosts.count, herobrine: [...r.entities.entities?.values?.() ?? []].some((e) => e.type === 'herobrine') || !!pan.boss, calls: r.renderer.info.render.calls };
    });
    check(`${scene}: built (${s.scene}), ${s.ghosts} ghost${s.ghosts === 1 ? '' : 's'} in view, ${s.calls} draw calls`, s.scene === scene && s.ghosts > 0);
    if (scene === 'haunted_forest') check('haunted_forest: Herobrine stands far off at the end of the path', s.herobrine);
    const buttons = await p.evaluate(() => [...document.querySelectorAll('.title-screen .btn')].map((b) => getComputedStyle(b).opacity === '1' && b.getBoundingClientRect().width > 0).every(Boolean));
    check(`${scene}: the buttons stay readable on top`, buttons);
    await p.screenshot({ path: `${OUT}/halloween-title-${scene}.png` });
    // Without the menu, for the Update Log
    await p.evaluate(() => (document.querySelector('.title-screen').style.visibility = 'hidden'));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/halloween-scene-${scene}.png` });
    await p.close();
  }
  // Frame time: what the Halloween touches (ghosts, night fog) cost in the same scene, on the same machine
  {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}&title=pumpkin_patch`);
    await p.getByText('Singleplayer').waitFor({ timeout: 30000 });
    await panoramaReady(p, 3000);
    const rate = () =>
      p.evaluate(
        () =>
          new Promise((res) => {
            let n = 0;
            const t0 = performance.now();
            const f = () => (++n < 90 ? requestAnimationFrame(f) : res(Math.round((90 / (performance.now() - t0)) * 1000 * 10) / 10));
            requestAnimationFrame(f);
          }),
      );
    const withGhosts = await rate();
    await p.evaluate(() => {
      const g = window.minehonk.panorama.renderer.ghosts;
      g.ambient = 0;
      g.clear();
    });
    const without = await rate();
    console.log(`     pumpkin patch: ${withGhosts} fps with its ghosts, ${without} without (software WebGL)`);
    check('ghosts cost next to nothing to draw', withGhosts >= without * 0.85);
    await p.close();
  }

  // After the cutoff: the menu is back to normal
  const after = await newPage();
  await after.goto(`http://localhost:${PORT}/?clock=${AFTER}`);
  await after.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await panoramaReady(after, 1500);
  const a = await after.evaluate(() => ({ scene: window.minehonk.panorama.sceneName, logo: document.querySelector('.logo')?.className, splash: document.querySelector('.splash')?.textContent }));
  check(`after the cutoff the title is back to the End Expansion's scenes (${a.scene})`, END_SCENES.includes(a.scene) && !/halloween/.test(a.logo));
  await after.screenshot({ path: `${OUT}/halloween-title-after.png`, noClean: true });
  await after.close();
}

// ======================================================================== a world in the season
if (part('world')) {
  const page = await newPage();
  const { cmd, admin, waitChunks, findPumpkins, lookAt } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 7));
  // The world option, under More World Options
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.getByText('More World Options...').click();
  const opt = page.locator('.screen:not(.hidden) button', { hasText: 'Halloween content:' });
  const help = page.locator('.screen:not(.hidden) .halloween-help');
  check('More World Options offers "Halloween content: Seasonal" by default', (await opt.textContent()) === 'Halloween content: Seasonal' && /November 7, 2026/.test(await help.textContent()));
  await opt.click();
  check('...and "Always on"', (await opt.textContent()) === 'Halloween content: Always on' && /keeps Halloween content/.test(await help.textContent()));
  await page.screenshot({ path: `${OUT}/halloween-world-option.png`, keepMenu: true });
  await opt.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Cancel' }).last().click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  if (!(await page.getByText('Singleplayer').isVisible())) await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await newWorld(page, 'Halloween', 'halloween-e2e');
  await waitChunks(4000);
  let info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
  check(`the world's server says Halloween is on (${info?.reason})`, info?.active === true && info.reason === 'season' && info.setting === 'seasonal');
  await cmd('/gamemode creative');
  const home = await page.evaluate(() => {
    const b = window.minehonk.game.player.body;
    return { x: b.x, y: b.y, z: b.z };
  });

  // ------------------------------------------------ natural pumpkins, every dimension
  const visit = async (dim) => {
    if (dim === 'expanded_end') {
      await cmd('/tp 0 120 7200', 2000);
    } else if (dim !== 'overworld') {
      await cmd(`/dimension ${dim}`, 2500);
      // The End's main island, and the land round the computer world's middle (far out it is mostly sea)
      if (dim === 'end') await cmd('/tp 0 90 0', 2000);
      if (dim === 'computer') await cmd('/tp 0 110 0', 2000);
    }
    await waitChunks(dim === 'overworld' ? 6000 : 9000);
    const id = PUMPKINS[dim === 'expanded_end' ? 'end' : dim];
    let found = await findPumpkins([id]);
    // The Expanded End's islands are far apart: look round the arrival a little more
    for (let i = 0; i < 3 && !found.length; i++) {
      const b = await page.evaluate(() => window.minehonk.game.player.body);
      await cmd(`/tp ${Math.floor(b.x + 96)} ${Math.floor(b.y)} ${Math.floor(b.z)}`, 2000);
      await waitChunks(7000);
      found = await findPumpkins([id]);
    }
    const others = (await findPumpkins(Object.values(PUMPKINS).filter((p) => p !== id))).length;
    check(`${dim}: ${found.length} ${id}${found.length === 1 ? '' : 's'} grew on new land, and no other dimension's (${others})`, found.length > 0 && others === 0);
    if (found.length) {
      // At night where there is one (the Overworld and the Farlands)
      if (dim === 'overworld' || dim === 'farlands') await cmd('/time set midnight', 600);
      await lookAt(found[0]);
      await page.screenshot({ path: `${OUT}/halloween-pumpkin-${dim}.png` });
      if (dim === 'overworld' || dim === 'farlands') await cmd('/time set noon', 600);
    }
    return found;
  };
  const owFound = await visit('overworld');
  // A ghost at night: the Admin Panel's "Show a ghost now" (they come by themselves, but rarely)
  await cmd('/time set midnight', 600);
  if (owFound.length) await lookAt(owFound[0], 6, 3);
  const g1 = await admin('ghost');
  await page.waitForTimeout(2600);
  const ghosts = await page.evaluate(() => window.minehonk.game.renderer.ghosts.count);
  check(`"Show a ghost now": one drifts into view (${g1.text})`, g1.ok && ghosts === 1);
  await page.screenshot({ path: `${OUT}/halloween-ghost.png` });
  // Ghosts come by themselves on a Halloween night: speed up the wait
  await page.evaluate(() => (window.minehonk.game.renderer.ghosts.wait = 0.5));
  await page.waitForTimeout(12000);
  const natural = await page.evaluate(() => window.minehonk.game.renderer.ghosts.count);
  check(`at night with Halloween on, ghosts come by themselves (${natural})`, natural >= 1);
  // Nothing about them touches the world: no entities, no blocks
  const ents = await page.evaluate(() => [...window.minehonk.game.entities.values()].filter((e) => /ghost/.test(e.type)).length);
  check('ghosts are not entities (nothing can hit or follow them)', ents === 0);
  // Not by day
  await cmd('/time set noon', 600);
  await page.evaluate(() => {
    const gh = window.minehonk.game.renderer.ghosts;
    gh.clear();
    gh.wait = 0.5;
  });
  await page.waitForTimeout(3000);
  check('no ghosts by day', (await page.evaluate(() => window.minehonk.game.renderer.ghosts.count)) === 0);

  for (const dim of ['nether', 'end', 'expanded_end', 'farlands', 'computer']) await visit(dim);
  await cmd('/dimension overworld', 2500);
  await waitChunks(2000);
  // Back where the world began (the dimension trip lands wherever the last one was: here, at sea)
  await cmd(`/tp ${home.x.toFixed(2)} ${home.y.toFixed(2)} ${home.z.toFixed(2)}`, 1500);
  await page.evaluate(() => (window.minehonk.game.player.flying = false));
  await waitChunks(4000);

  // ------------------------------------------------ the Admin Panel's Halloween tab
  await cmd('/time set noon', 600);
  await page.evaluate(() => {
    const pl = window.minehonk.game.player;
    pl.yaw = 0;
    pl.pitch = 0.35;
  });
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="halloween"]').dispatchEvent('mousedown');
  await page.waitForTimeout(1500);
  const tab = await page.evaluate(() => document.querySelector('.halloween-state')?.textContent ?? '');
  check('the Halloween tab shows the state and why', /Halloween contentON/.test(tab) && /Seasonal/.test(tab) && /left/.test(tab) && /Halloween season \(until November 7, 2026/.test(tab));
  await page.screenshot({ path: `${OUT}/halloween-admin.png`, keepMenu: true });
  await page.locator('.btn.halloween-place-all').click();
  await page.waitForTimeout(1000);
  const status = await page.evaluate(() => document.querySelector('.admin-status')?.textContent ?? '');
  check(`"Place one of each" (${status})`, /Placed 5 pumpkins/.test(status));
  // Simulate a date just after the cutoff (V7 phase 5's season tests)
  await page.locator('.halloween-date-after').click();
  await page.waitForTimeout(1600);
  info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
  const tabOff = await page.evaluate(() => document.querySelector('.halloween-state')?.textContent ?? '');
  check('simulating a date after the cutoff turns it off for the world (and every player)', info?.active === false && info.date === 'after' && /Halloween contentOFF/.test(tabOff));
  await page.screenshot({ path: `${OUT}/halloween-admin-simulated.png`, keepMenu: true });
  await page.locator('.halloween-date-real').click();
  await page.waitForTimeout(1200);
  info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
  check('and back on with the real date', info?.active === true && info.date === 'real');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // The five pumpkins, by day and by night
  const row = await findPumpkins(Object.values(PUMPKINS));
  const near = row.filter((p) => p.d < 8);
  check(`the five pumpkins stand in front of the player (${near.length})`, near.length === 5);
  if (near.length) {
    const cx = near.reduce((s, p) => s + p.x, 0) / near.length;
    const cz = near.reduce((s, p) => s + p.z, 0) / near.length;
    const y = near[0].y;
    await cmd(`/tp ${(cx + 0.5).toFixed(2)} ${(y + 1.4).toFixed(2)} ${(cz + 5.5).toFixed(2)}`, 1500);
    await page.evaluate(() => {
      const pl = window.minehonk.game.player;
      pl.yaw = 0;
      pl.pitch = 0.32;
      pl.flying = true;
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/halloween-pumpkins-day.png` });
    await cmd('/time set midnight', 600);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/halloween-pumpkins-night.png` });
  }
  // The creative inventory's Halloween tab
  await cmd('/time set noon', 600);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  const ctab = page.locator('.tab[title="Halloween"]').first();
  check('the creative inventory has a Halloween tab', (await ctab.count()) > 0);
  if ((await ctab.count()) > 0) {
    await ctab.dispatchEvent('mousedown');
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${OUT}/halloween-creative-tab.png`, keepMenu: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.minehonk.quitToTitle());
  await page.getByText('Singleplayer').waitFor({ timeout: 60000 });
  await page.close();
}

// ======================================================================== worlds created after the cutoff
if (part('after')) {
  const page = await newPage();
  const { waitChunks, findPumpkins } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${AFTER}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 7));
  await newWorld(page, 'After Seasonal', 'halloween-e2e');
  await waitChunks(6000);
  let info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
  check(`after the cutoff a Seasonal world has Halloween off (${info?.reason})`, info?.active === false && info.reason === 'expired');
  const none = await findPumpkins(Object.values(PUMPKINS));
  check(`...and its new land grows no pumpkins (${none.length})`, none.length === 0);
  await page.evaluate(() => window.minehonk.quitToTitle());
  await page.getByText('Singleplayer').waitFor({ timeout: 60000 });
  await newWorld(page, 'After Always', 'halloween-e2e', 'Always on');
  await waitChunks(6000);
  info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
  check(`after the cutoff an Always on world keeps Halloween (${info?.reason})`, info?.active === true && info.reason === 'always');
  const some = await findPumpkins(Object.values(PUMPKINS));
  check(`...and its new land still grows pumpkins (${some.length})`, some.length > 0);
  await page.evaluate(() => window.minehonk.quitToTitle());
  await page.getByText('Singleplayer').waitFor({ timeout: 60000 });
  await page.close();
}

// ======================================================================== the Update Log
if (part('log')) {
  const page = await newPage();
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}&title=pumpkin_patch`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.locator('.screen:not(.hidden) button', { hasText: 'Options...' }).first().click();
  await page.locator('button.ul-open').click();
  await page.locator('.ul-book').waitFor();
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.ul-version')].map((v) => v.textContent));
  check(`the Update Log has V7, V6.5 and V6 tabs (${tabs.join(' | ')})`, tabs[0] === 'V7 - The Halloween Update' && tabs[1]?.startsWith('V6.5') && tabs[2] === 'V6 - The End Expansion');
  // Every picture on the page (lazy ones too: they are asked for now), or what has loaded after 15 s
  const pics = async () =>
    page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('.ul-page img')];
      for (const i of imgs) i.loading = 'eager';
      const loaded = (i) =>
        i.complete && i.naturalWidth > 0
          ? null
          : new Promise((r) => {
              i.addEventListener('load', r, { once: true });
              i.addEventListener('error', r, { once: true });
            });
      await Promise.race([Promise.all(imgs.map(loaded)), new Promise((r) => setTimeout(r, 15000))]);
      return [imgs.length, imgs.filter((i) => i.naturalWidth > 0).length];
    });
  const sections = async () => page.evaluate(() => [...document.querySelectorAll('.ul-nav-item')].map((n) => n.dataset.section));
  // V7
  const v7 = await sections();
  check(`V7's sections: ${v7.join(', ')}`, ['overview', 'season', 'pumpkins', 'ghosts', 'menu', 'villages', 'abandoned', 'heads', 'admin'].every((s) => v7.includes(s)));
  for (const id of v7) {
    await page.locator(`.ul-nav-item[data-section="${id}"]`).click();
    await page.waitForTimeout(500);
    const [n, ok] = await pics();
    check(`V7 ${id}: ${ok}/${n} pictures loaded`, ok === n);
    await page.screenshot({ path: `${OUT}/halloween-log-v7-${id}.png`, noClean: true });
  }
  // V6.5
  await page.locator('.ul-version[data-version="V6.5"]').click();
  await page.waitForTimeout(600);
  const v65 = await sections();
  check(`V6.5's sections: ${v65.join(', ')}`, ['multiplayer', 'haunting', 'auto_optimize'].every((s) => v65.includes(s)));
  for (const id of v65) {
    await page.locator(`.ul-nav-item[data-section="${id}"]`).click();
    await page.waitForTimeout(500);
    const [n, ok] = await pics();
    check(`V6.5 ${id}: ${ok}/${n} pictures loaded`, ok === n);
    await page.screenshot({ path: `${OUT}/halloween-log-v65-${id}.png`, noClean: true });
  }
  // V6: the End, without multiplayer
  await page.locator('.ul-version[data-version="V6"]').click();
  await page.waitForTimeout(600);
  const v6 = await sections();
  check('V6 keeps its End content, and multiplayer has moved to V6.5', v6.includes('portal') && v6.includes('guardian') && !v6.includes('multiplayer'));
  await page.screenshot({ path: `${OUT}/halloween-log-v6.png`, noClean: true });
  // A phone-sized screen: the tabs are still there
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(600);
  const phone = await page.evaluate(() => [...document.querySelectorAll('.ul-version')].filter((v) => v.getBoundingClientRect().width > 0).length);
  check(`on a phone the version tabs stay (${phone} visible)`, phone >= 2);
  await page.screenshot({ path: `${OUT}/halloween-log-phone.png`, noClean: true });
  await page.close();
}

await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${errors.length ? `, ${errors.length} page errors` : ''}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
process.exit(failed.length || errors.length ? 1 : 0);
