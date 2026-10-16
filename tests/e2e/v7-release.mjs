/**
 * V7 phase 5 in the browser: the release, end to end, with screenshots
 * (tests/e2e/out/v7r-*.png; UPDATE_LOG_SHOTS=1 also writes clean copies
 * for the Update Log).
 *
 *  - menu:    every Halloween title scene (the buttons stay readable), and
 *             the normal title screen after the cutoff;
 *  - season:  a full season playthrough in a Creative world: flying into a
 *             real Trick-or-Treat Village (discovered), a sack and a costume,
 *             the quest moving on, knocking at Candy Homes until it is done,
 *             a Trick Home, the advancements' Halloween tab, saved and loaded;
 *  - after:   the same world with "Simulate date: just after the cutoff":
 *             knocking turned away, no quest, the sack and costume still work;
 *  - always:  an Always on world after the cutoff: still Halloween;
 *  - admin:   the Admin Panel's Halloween and Haunting tabs, at a small and a
 *             large window (nothing overflows);
 *  - log:     the final V7 Update Log entry (and the V6.5 and V6 tabs);
 *  - oldsave: a V6.5 save (tests/fixtures/worlds/v6.5.json) put into the
 *             browser's storage and played;
 *  - multi:   a two-player session on the dedicated server (needs
 *             npm run build:server): both see the same village, one knocks.
 *
 *   npx vite build && node tests/e2e/v7-release.mjs   (ONLY=menu,season,... for some parts)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4197;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const part = (n) => !ONLY || ONLY.includes(n);
const checks = [];
const check = (name, ok) => {
  checks.push([name, !!ok]);
  console.log(ok ? 'ok  ' : 'FAIL', name);
};
const SEED = 'v7-villages';
const VILLAGE = { x: 552, z: 1000 };
/** The season playthrough's village (same seed): most of its Candy Homes open onto the street, enough for the quest's 10 candy. */
const QUEST_VILLAGE = { x: 1368, z: -2072 };
const IN_SEASON = '2026-10-20T20:00:00Z';
const AFTER = '2026-11-10T20:00:00Z';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const kill = (proc) => {
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', () => kill(server));
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];

/** A page (its own browser profile), with clean Update Log copies of screenshots when asked. */
async function newPage(viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  if (process.env.UPDATE_LOG_SHOTS) {
    const CLEAN = path.join(OUT, 'clean');
    fs.mkdirSync(CLEAN, { recursive: true });
    const shoot = page.screenshot.bind(page);
    const HIDE = ['.hotbar', '.crosshair', '.debug', '.debug-right', '.quest-tracker', '.cheats-indicator', '.chat', '.xpbar', '.xplevel', '.stat-row', '.item-name', '.toast', '.subtitles', '.boss-bars'];
    page.screenshot = async (opts = {}) => {
      if (opts.path && !opts.keepHud) {
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
      const { keepHud, ...rest } = opts;
      void keepHud;
      return shoot(rest);
    };
  }
  return page;
}

async function goto(page, query = `clock=${IN_SEASON}`) {
  await page.goto(`http://localhost:${PORT}/?${query}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    window.minehonk.settings.renderDistance = 6;
    window.__chatLog = [];
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList.contains('line') && n.parentElement?.classList.contains('chat')) window.__chatLog.push(n.textContent);
          // What is said at a door (a voice behind it, the villager, the sack)
          if (n.classList.contains('speech')) (window.__speech ??= []).push(n.textContent);
        }
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const inGame = (page) =>
  page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
async function newWorld(page, name, { seed = SEED, creative = true, always = false } = {}) {
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) input').first().fill(name);
  if (creative)
    for (let i = 0; i < 6; i++) {
      const txt = await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).textContent();
      if (txt.includes('Creative')) break;
      await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).click();
    }
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  if (always) await page.locator('.screen:not(.hidden) button', { hasText: 'Halloween content: Seasonal' }).click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await inGame(page);
}
async function openWorld(page, name) {
  await page.getByText('Singleplayer').click();
  await page.waitForTimeout(600);
  await page.locator('.screen:not(.hidden) .list-item', { hasText: name }).first().click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Play Selected World' }).click();
  await inGame(page);
}
const cmd = (page, t) => page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t);
const admin = (page, a) => page.evaluate((a) => window.minehonk.game.adminRequest(a), a);
const noMenus = (page) =>
  page.evaluate(() => {
    const app = window.minehonk;
    for (let i = 0; i < 6 && app.screenOpen; i++) app.pop();
  });
const quit = async (page) => {
  await page.evaluate(() => window.minehonk.quitToTitle());
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
};
const tracker = (page) => page.evaluate(() => document.querySelector('.quest-tracker:not(.hidden)')?.textContent ?? '');
const chatText = (page) => page.evaluate(() => [...(window.__chatLog ?? []), ...[...document.querySelectorAll('.chat .line')].map((e) => e.textContent)].join('\n')).catch(() => '');
const item = (page, id) => page.evaluate((id) => window.minehonkRegistry.itemById.get(id).num, id);
/** As the creative menu does: an item into a slot of the player's window (36-44: the hotbar; 5: the head). */
const creative = async (page, slot, id, count = 1) => {
  const num = await item(page, id);
  await page.evaluate(([slot, num, count]) => window.minehonk.game.send({ t: 'creative_set', slot, item: { id: num, count } }), [slot, num, count]);
  await page.waitForTimeout(300);
};
/** Flies there in steps the server accepts (no teleport: a teleport is a cheat, and the place it lands counts for nothing). */
async function flyTo(page, x, z, y = null, near = 1) {
  let last = null;
  let stuck = 0;
  for (let i = 0; i < 1500; i++) {
    // Stuck (under a roof, against a wall): given up on, the caller tries another way
    const at = await page.evaluate(() => {
      const b = window.minehonk.game.player.body;
      return [b.x, b.y, b.z];
    });
    stuck = last && Math.hypot(at[0] - last[0], at[1] - last[1], at[2] - last[2]) < 0.02 ? stuck + 1 : 0;
    last = at;
    if (stuck > 40) return false;
    const done = await page.evaluate(
      ([x, z, y, near]) => {
        const g = window.minehonk.game;
        const b = g.player.body;
        g.player.flying = true;
        const dx = x - b.x;
        const dz = z - b.z;
        const d = Math.hypot(dx, dz);
        const ty = y ?? Math.max(b.y, g.world.heightAt(Math.floor(b.x), Math.floor(b.z)) + 6);
        // There: over the spot and (when asked) at its height
        if (d < near && (y == null || Math.abs(ty - b.y) < Math.min(0.6, near + 0.1))) return true;
        // No faster than flying really is (the server puts a player moving too fast back)
        const now = performance.now();
        const step = (9 * Math.min(200, now - (window.__flyAt ?? now - 70))) / 1000;
        window.__flyAt = now;
        const s = Math.min(d, step);
        if (d > 0.01) {
          b.x += (dx / d) * s;
          b.z += (dz / d) * s;
        }
        b.y += Math.max(-step, Math.min(step, ty - b.y));
        b.vx = b.vy = b.vz = 0;
        g.player.yaw = Math.atan2(-dx, -dz);
        return false;
      },
      [x, z, y, near],
    );
    if (done) return true;
    await page.waitForTimeout(70);
  }
  return false;
}
/** The Trick-or-Treat doors the server says are near (lower block and facing). */
const doorsNear = (page) => page.evaluate(() => window.minehonk.game.knockDoors ?? []);
const FACE = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
/** Walks (in small steps) to a door's step, faces it and knocks with G. */
async function knockAt(page, d, out = 1) {
  const [x, y, z, facing] = d;
  const [fx, fz] = FACE[facing];
  // Over the street in front of it, `out` blocks out where the sky is open (above the roofs), then
  // straight down; then hovering a step or two out (flying, as a Creative player may) until it is in
  // sight to knock on (steps, eaves and lanterns differ from house to house)
  const k0 = Math.max(1.3, out);
  // First back out from under the last door's eaves, the way the test came down to it (open sky)
  if (page.__lastOpen) {
    const b = await page.evaluate(() => window.minehonk.game.player.body.y);
    await flyTo(page, page.__lastOpen[0], page.__lastOpen[1], b + 0.3, 0.3);
  }
  page.__lastOpen = [x + 0.5 + fx * k0, z + 0.5 + fz * k0];
  const top = await page.evaluate(() => window.minehonk.game.player.body.y);
  await flyTo(page, x + 0.5 + fx * k0, z + 0.5 + fz * k0, Math.max(top, y + 12));
  await flyTo(page, x + 0.5 + fx * k0, z + 0.5 + fz * k0, y + 0.6, 0.3);
  let seen = null;
  for (const [k, h] of [
    [1.3, 0.3],
    [1.6, 0.8],
    [2.0, 0.3],
    [2.4, 1.0],
    [1.0, 0.5],
  ]) {
    await flyTo(page, x + 0.5 + fx * k, z + 0.5 + fz * k, y + h, 0.15);
    await page.waitForTimeout(300);
    await page.evaluate(([x, y, z]) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const dx = x + 0.5 - b.x;
      const dz = z + 0.5 - b.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = -Math.atan2(y + 1 - (b.y + 1.62), Math.hypot(dx, dz));
    }, [x, y, z]);
    await page.waitForTimeout(350);
    seen = await page.evaluate(() => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const t = g.interaction.target;
      return { at: [b.x, b.y, b.z].map((v) => v.toFixed(1)).join(' '), target: t ? `${t.x} ${t.y} ${t.z}` : 'none', knock: g.knockTarget()?.join(' ') ?? null };
    });
    if (seen.knock) break;
  }
  if (!seen.knock) console.log(`     no knock prompt at ${x} ${y} ${z}: ${JSON.stringify(seen)}`);
  await page.keyboard.press('g');
  await page.waitForTimeout(800);
}

/** Looks at a door from where the player stands and knocks with G. */
async function aimAndKnock(page, d) {
  const [x, y, z] = d;
  await page.evaluate(([x, y, z]) => {
    const g = window.minehonk.game;
    const b = g.player.body;
    const dx = x + 0.5 - b.x;
    const dz = z + 0.5 - b.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = -Math.atan2(y + 1 - (b.y + 1.62), Math.hypot(dx, dz));
  }, [x, y, z]);
  await page.waitForTimeout(500);
  const knock = await page.evaluate(() => window.minehonk.game.knockTarget()?.join(' ') ?? null);
  if (!knock) console.log(`     no knock prompt at ${x} ${y} ${z}`);
  await page.keyboard.press('g');
  await page.waitForTimeout(800);
}

await (async () => {
  // ====================================================================== menu
  if (part('menu')) {
    const page = await newPage();
    // SCENES=a,b to look at some only
    const scenes = ['haunted_forest', 'trick_village', 'pumpkin_patch', 'trick_or_treat', 'ghost_forest', 'abandoned_village', 'haunted_camp', 'ghost_marsh'].filter((s) => !process.env.SCENES || process.env.SCENES.split(',').includes(s));
    for (const s of scenes) {
      await goto(page, `clock=${IN_SEASON}&title=${s}`);
      await page.waitForFunction(() => window.minehonk.panorama?.ready, null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(7000);
      const sc = await page.evaluate(() => {
        const pan = window.minehonk.panorama;
        return { scene: pan.sceneName, ghosts: pan.renderer.ghosts.count, figure: pan.boss?.type ?? null };
      });
      if (s === 'ghost_forest') check(`ghost_forest: ghosts drift between the trees (${sc.ghosts})`, sc.scene === s && sc.ghosts > 0);
      if (s === 'haunted_camp') check(`haunted_camp: one of the haunting's characters watches the camp (${sc.figure})`, sc.scene === s && ['cave_dweller', 'green_steve', 'null_entity'].includes(sc.figure));
      const btn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.screen:not(.hidden) button')].find((x) => x.textContent === 'Singleplayer');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return { w: r.width, h: r.height, color: cs.color, bg: cs.backgroundColor || cs.backgroundImage };
      });
      check(`title scene ${s}: shown, its buttons in view`, btn && btn.w > 100 && btn.h > 20);
      await page.screenshot({ path: `${OUT}/v7r-title-${s}.png`, keepHud: true });
      // Without the menu, for the Update Log
      await page.evaluate(() => (document.querySelector('.title-screen').style.visibility = 'hidden'));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/v7r-scene-${s}.png` });
    }
    // After the cutoff: the End Expansion's title screen comes back
    await goto(page, `clock=${AFTER}`);
    await page.waitForTimeout(6000);
    const logo = await page.evaluate(() => document.querySelector('.logo')?.className ?? '');
    check('after the cutoff the normal (non-Halloween) title screen is back', !/halloween/.test(logo));
    await page.screenshot({ path: `${OUT}/v7r-title-after.png`, keepHud: true });
    await page.context().close();
  }

  // ====================================================================== season
  if (part('season') || part('after')) {
    const page = await newPage();
    await goto(page);
    await newWorld(page, 'Season Playthrough');
    const info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
    check('a new world in the season: Halloween content on', info?.active === true && info.reason === 'season');
    await cmd(page, '/time set 14000');
    await cmd(page, '/gamerule doMobSpawning false');
    await cmd(page, '/gamerule doDaylightCycle false');
    // A teleport well away from the village (its landing place is a cheat's), then flying in for real
    await cmd(page, `/tp ${QUEST_VILLAGE.x + 260} 150 ${QUEST_VILLAGE.z}`);
    await page.waitForTimeout(2500);
    // In over the roofs, then down among them (a village is found from within it, not from high above)
    const arrived = await flyTo(page, QUEST_VILLAGE.x, QUEST_VILLAGE.z);
    const roofs = await page.evaluate(([x, z]) => window.minehonk.game.world.heightAt(x, z), [QUEST_VILLAGE.x, QUEST_VILLAGE.z]);
    await flyTo(page, QUEST_VILLAGE.x, QUEST_VILLAGE.z, roofs + 8, 0.5);
    await page.waitForTimeout(3000);
    check('flew into the Trick-or-Treat Village', arrived);
    const ach = () => page.evaluate(() => [...(window.__chatLog ?? [])].join('\n'));
    await page.waitForFunction(() => (window.__chatLog ?? []).some((l) => /Spooky Streets/.test(l)), null, { timeout: 20000 }).catch(() => {});
    check('finding it for real: the advancement "Spooky Streets"', /Spooky Streets/.test(await ach()));
    await page.screenshot({ path: `${OUT}/v7r-village-found.png`, keepHud: true });
    // A sack and a costume from the creative menu (a Creative world's own mode is normal play), and it on
    const q0 = await tracker(page);
    check(`the quest tracker, on its first step ("${q0}")`, /Trick or Treat!/.test(q0) && /Sack/.test(q0));
    await creative(page, 36, 'trick_or_treat_sack');
    await creative(page, 37, 'carved_pumpkin');
    await page.waitForTimeout(1200);
    await creative(page, 5, 'carved_pumpkin');
    await creative(page, 37, 'zombie_head');
    await page.waitForTimeout(1500);
    const q1 = await tracker(page);
    check(`with a sack and a costume on, the quest moves on ("${q1}")`, /Find a Trick-or-Treat Village|Knock/.test(q1));
    await page.screenshot({ path: `${OUT}/v7r-quest-knock.png`, keepHud: true });
    check('a costume: "Dressed to Scare"', /Dressed to Scare/.test(await ach()));
    // Knocking at Candy Homes until the quest is done (each home once; Trick Homes are left for later)
    await page.evaluate(() => (window.minehonk.game.player.selectedSlot = 0));
    const tried = new Set();
    const key = (x, y, z) => `${x},${y},${z}`;
    let tricks = null;
    let candyShot = false;
    for (let round = 0; round < 24 && !/\[Trick or Treat!\]/.test(await ach()); round++) {
      // The next door (where the doors are: the Admin Panel's lookup, which changes nothing; the knocking
      // itself is done by flying up to it and pressing G): the nearest not yet tried with open sky over
      // its step (a test flies down to it; a door under a roof or a tree in an alley is left out)
      const r = await admin(page, { a: 'halloween', op: 'village_doors' });
      const list = (r.data?.doors?.doors ?? []).filter((d) => !d.used && !tried.has(key(d.x, d.y, d.z)) && !(tricks && d.kind === 'trick'));
      // How far out along the street there is open sky to come down through (none: left out)
      const open = await page.evaluate(
        (list) =>
          list.map((d) => {
            const fx = d.out[0] - d.x;
            const fz = d.out[2] - d.z;
            for (let k = 1; k <= 6; k++) if (window.minehonk.game.world.heightAt(d.x + fx * k, d.z + fz * k) <= d.y + 1) return k;
            return 0;
          }),
        list,
      );
      const b = await page.evaluate(() => ({ x: window.minehonk.game.player.body.x, z: window.minehonk.game.player.body.z }));
      const ok = list.map((d, i) => ({ d, k: open[i] })).filter((o) => o.k > 0);
      const pick = ok.sort((a, c) => Math.hypot(a.d.x - b.x, a.d.z - b.z) - Math.hypot(c.d.x - b.x, c.d.z - b.z))[0];
      if (!pick) {
        console.log(`     no door left to fly down to (${list.length} not tried)`);
        break;
      }
      const next = pick.d;
      tried.add(key(next.x, next.y, next.z));
      const dx = next.out[0] - next.x;
      const dz = next.out[2] - next.z;
      const d = [next.x, next.y, next.z, dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north'];
      await page.evaluate(() => (window.__speech = []));
      await knockAt(page, d, pick.k);
      await page.waitForTimeout(1200);
      const scene = await page.evaluate(() => document.querySelector('.haunt-scene')?.dataset.step ?? '');
      console.log(`     knocked at ${d.join(' ')}: scene "${scene}", said: ${(await page.evaluate(() => (window.__speech ?? []).join(' | '))) || '(nothing)'}`);
      if (scene === 'grab' || scene === 'drag' || /trick/i.test(scene)) {
        tricks = d;
        await page.waitForTimeout(5000);
        await page.screenshot({ path: `${OUT}/v7r-trick-home.png`, keepHud: true });
        // Out through the door (the run ends, to be tried again)
        const [x, y, z, facing] = d;
        const [fx, fz] = FACE[facing];
        await page.evaluate(([x, y, z]) => window.minehonk.game.send({ t: 'use_on', x, y, z, face: 2, hx: 0.5, hy: 0.5, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: 999 }), [x, y, z]);
        await flyTo(page, x + 0.5 + fx * 4, z + 0.5 + fz * 4, y + 1);
        await page.waitForTimeout(4000);
        continue;
      }
      // A Candy Home: watch it a moment, then skip
      await page.waitForTimeout(2500);
      if (!candyShot && scene) {
        candyShot = true;
        await page.screenshot({ path: `${OUT}/v7r-candy-home.png`, keepHud: true });
      }
      await page.keyboard.press('Space');
      await page.waitForTimeout(1500);
    }
    const all = await ach();
    check('candy from a Candy Home for real: "Sweet!"', /Sweet!/.test(all));
    check(`the quest finished for real: the advancement "Trick or Treat!" (${(await tracker(page)) || 'tracker gone'})`, /\[Trick or Treat!\]/.test(all));
    if (tricks) check('a Trick Home found: "Not a Treat"', /Not a Treat/.test(all));
    await page.screenshot({ path: `${OUT}/v7r-quest-done.png`, keepHud: true });
    // The advancements screen's Halloween tab
    await page.evaluate(() => window.minehonk.openAchievements());
    await page.waitForTimeout(800);
    await page.locator('.screen:not(.hidden) button.chip', { hasText: 'Halloween' }).click();
    await page.waitForTimeout(800);
    const tab = await page.locator('.screen:not(.hidden) .adv-list').innerText();
    check('the advancements screen has a Halloween tab, the seasonal ones marked', /Spooky Streets/.test(tab) && /Halloween/.test(tab) && (await page.locator('.adv-season').count()) > 0);
    check('the haunting one is hidden until earned', /\?\?\?/.test(tab) && !/It Came Back/.test(tab));
    await page.screenshot({ path: `${OUT}/v7r-advancements.png` });
    await noMenus(page);
    // Saved, quit, opened again: the quest, the sack and the advancements are all still there
    await quit(page);
    await openWorld(page, 'Season Playthrough');
    await page.waitForTimeout(3000);
    const kept = await page.evaluate(() => {
      const g = window.minehonk.game;
      return { sack: g.invSlots.some((s) => s && window.minehonkRegistry.itemOf(s.id).id === 'trick_or_treat_sack' && s.tag?.data?.candy) };
    });
    check('saved and loaded: the sack still holds its candy', kept.sack);

    // ==================================================================== after
    if (part('after')) {
      // The same world, "Simulate date: just after the cutoff" from the Admin Panel
      await page.evaluate(() => window.minehonk.openAdmin());
      await page.locator('.admin-panel').waitFor();
      await page.locator('.admin-tab[data-tab="halloween"]').dispatchEvent('mousedown');
      await page.waitForTimeout(800);
      await page.locator('.halloween-date-after').click();
      await page.waitForTimeout(1500);
      const panel = await page.locator('.admin-body').innerText();
      check(`the Halloween tab shows it off, the date simulated ("${panel.split('\n').slice(0, 6).join(' / ')}")`, /Halloween content\s*OFF/.test(panel) && /simulated/i.test(panel));
      // From the top: the world's state (off, the date simulated) and the tests
      await page.evaluate(() => document.querySelector('.admin-body')?.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/v7r-admin-after.png` });
      await noMenus(page);
      await page.waitForTimeout(1000);
      const off = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
      check('the world is told: Halloween off, simulated date after', off.active === false && off.date === 'after');
      const doors = await doorsNear(page);
      check('no doors to knock on now', doors.length === 0);
      check('no quest tracker now', !(await tracker(page)));
      // The sack still opens and the costume is still on
      const still = await page.evaluate(() => {
        const g = window.minehonk.game;
        return { head: window.minehonkRegistry.itemOf(g.invSlots[5]?.id ?? 0)?.id };
      });
      check(`the costume is still worn (${still.head})`, still.head === 'carved_pumpkin');
      await page.screenshot({ path: `${OUT}/v7r-after-world.png`, keepHud: true });
      // Back to real, then closing the world forgets the test
      await quit(page);
      await openWorld(page, 'Season Playthrough');
      await page.waitForTimeout(1500);
      const back = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
      check('opened again: the test is gone (never saved), the season is real again', back.active === true && back.date === 'real');
      await quit(page);
    }
    await page.context().close();
  }

  // ====================================================================== always
  if (part('always')) {
    const page = await newPage();
    await goto(page, `clock=${AFTER}`);
    await newWorld(page, 'Always Halloween', { always: true });
    const info = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
    check('an Always on world after the cutoff: Halloween content still on', info?.active === true && info.reason === 'always' && info.inSeason === false);
    await cmd(page, '/time set 14000');
    await cmd(page, '/gamerule doDaylightCycle false');
    await cmd(page, `/tp ${VILLAGE.x} 120 ${VILLAGE.z}`);
    await page.waitForTimeout(6000);
    const r = await admin(page, { a: 'halloween', op: 'village_doors' });
    const info2 = r.data?.doors;
    check(`its village is dressed for real (${info2?.doors?.length ?? 0} doors, built ${info2?.built}, cheat-made ${info2?.cheat})`, info2?.built && !info2.cheat && info2.doors.length > 0);
    // In front of one of them: it can be knocked on
    await admin(page, { a: 'halloween', op: 'door_tp', door: info2?.doors?.[0]?.id ?? 0 });
    await page.waitForTimeout(3000);
    const doors = await doorsNear(page);
    check(`its doors can be knocked on (${doors.length})`, doors.length > 0);
    // From above the roofs a little way off, looking down over the dressed village
    const roofs = await page.evaluate(([x, z]) => window.minehonk.game.world.heightAt(x, z), [VILLAGE.x, VILLAGE.z]);
    await flyTo(page, VILLAGE.x + 22, VILLAGE.z + 22, roofs + 14, 0.5);
    await page.evaluate(([x, y, z]) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      g.player.yaw = Math.atan2(-(x - b.x), -(z - b.z));
      g.player.pitch = -Math.atan2(y - (b.y + 1.62), Math.hypot(x - b.x, z - b.z));
    }, [VILLAGE.x, roofs, VILLAGE.z]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/v7r-always-on.png` });
    await quit(page);
    await page.context().close();
  }

  // ====================================================================== admin
  if (part('admin')) {
    for (const [w, h] of [
      [800, 600],
      [1920, 1080],
    ]) {
      const page = await newPage({ width: w, height: h });
      await goto(page);
      await newWorld(page, `Admin ${w}`);
      for (const tab of ['halloween', 'haunt']) {
        await page.evaluate(() => window.minehonk.openAdmin());
        await page.locator('.admin-panel').waitFor();
        await page.locator(`.admin-tab[data-tab="${tab}"]`).dispatchEvent('mousedown');
        await page.waitForTimeout(1200);
        const fit = await page.evaluate(() => {
          const p = document.querySelector('.admin-panel');
          const b = document.querySelector('.admin-body');
          const r = p.getBoundingClientRect();
          const wide = [...p.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'auto' && getComputedStyle(e).overflowX !== 'scroll' && e.clientWidth > 0 && !e.matches('input,select,textarea'));
          return { inView: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, overflow: wide.map((e) => e.className).slice(0, 4), bodyScroll: b.scrollWidth <= b.clientWidth + 2 };
        });
        check(`${tab} tab at ${w}x${h}: in view, nothing spilling out sideways (${fit.overflow.join(', ') || 'none'})`, fit.inView && fit.bodyScroll && fit.overflow.length === 0);
        if (tab === 'halloween') {
          // The season tests: force off, then a simulated date, then real
          await page.locator('.halloween-content-off').click();
          await page.waitForTimeout(1200);
          const t = await page.locator('.admin-body').innerText();
          check(`${w}: "Force off" turns it off for the world`, /Halloween content\s*OFF/.test(t) && /Force off/.test(t));
          await page.locator('.halloween-date-before').click();
          await page.waitForTimeout(1200);
          await page.screenshot({ path: `${OUT}/v7r-admin-halloween-${w}.png` });
          await page.locator('.halloween-content-real').click();
          await page.locator('.halloween-date-real').click();
          await page.waitForTimeout(800);
          const back = await page.evaluate(() => window.minehonk.game.worldInfo.halloween);
          check(`${w}: back to real`, back.active === true && back.content === 'real' && back.date === 'real');
        } else await page.screenshot({ path: `${OUT}/v7r-admin-haunt-${w}.png` });
        await noMenus(page);
      }
      await quit(page);
      await page.context().close();
    }
  }

  // ====================================================================== log
  if (part('log')) {
    const page = await newPage();
    await goto(page, `clock=${AFTER}`);
    await page.getByText('Options...').click();
    await page.getByText('Update Log').click();
    await page.waitForTimeout(1500);
    const tabs = await page.locator('.ul-version').allInnerTexts();
    check(`after the cutoff the Update Log still has V7, V6.5 and V6 (${tabs.join(' | ')})`, tabs.some((t) => /V7/.test(t)) && tabs.some((t) => /V6\.5/.test(t)) && tabs.some((t) => /^V6\b|V6 /.test(t)));
    await page.screenshot({ path: `${OUT}/v7r-log-overview.png` });
    const text = await page.locator('.ul-book').innerText();
    check('the V7 entry says it is complete', /complete|all five phases/i.test(text));
    for (const id of ['advancements', 'menu']) {
      const nav = page.locator('.ul-nav-item', { hasText: id === 'advancements' ? 'Advancements' : 'Title Screen' }).first();
      if (await nav.count()) {
        await nav.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${OUT}/v7r-log-${id}.png` });
      }
    }
    await page.locator('.ul-version', { hasText: 'V6.5' }).first().click();
    await page.waitForTimeout(800);
    check('multiplayer is in the V6.5 tab', /Play Together|multiplayer/i.test(await page.locator('.ul-book').innerText()));
    await page.context().close();
  }

  // ====================================================================== oldsave
  if (part('oldsave')) {
    const page = await newPage();
    await goto(page);
    const fx = JSON.parse(fs.readFileSync('tests/fixtures/worlds/v6.5.json', 'utf8'));
    const id = fx.level.id;
    // The fixture's player is this browser's profile, and its world goes into IndexedDB as V6.5 kept it
    await page.evaluate(
      async ([fx, id]) => {
        localStorage.setItem('minehonk.profile', JSON.stringify({ uuid: fx.expect.player.uuid, name: fx.expect.player.name }));
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('minehonk', 1);
          r.onupgradeneeded = () => ['worlds', 'chunks', 'players', 'meta'].forEach((s) => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s));
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const tx = db.transaction(['worlds', 'chunks', 'players', 'meta'], 'readwrite');
        tx.objectStore('worlds').put(fx.level, id);
        for (const [k, v] of Object.entries(fx.players)) tx.objectStore('players').put(v, `${id}/${k}`);
        for (const [k, v] of Object.entries(fx.meta)) tx.objectStore('meta').put(v, `${id}/${k}`);
        for (const [k, b64] of Object.entries(fx.chunks)) {
          const [dim, cx, cz] = k.split(':');
          tx.objectStore('chunks').put(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), `${id}/${dim}/${cx},${cz}`);
        }
        await new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error))));
        db.close();
      },
      [fx, id],
    );
    await goto(page);
    await openWorld(page, fx.level.name);
    await page.waitForTimeout(3000);
    const got = await page.evaluate(([px, py, pz]) => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      const at = (x, y, z) => [...reg.blockById.values()].find((b) => b.num === reg.blockOfState(g.world.getState(x, y, z)))?.id;
      return { pillar: [0, 1, 2, 3].map((i) => at(px, py + i, pz)), inv: g.invSlots.filter(Boolean).map((s) => reg.itemOf(s.id).id), halloween: g.worldInfo.halloween };
    }, [fx.expect.pillar.x, fx.expect.pillar.y, fx.expect.pillar.z]);
    check(`a V6.5 save plays in the browser: its blocks (${got.pillar.join(', ')})`, got.pillar.join() === fx.expect.pillar.blocks.join());
    check(`...its player's things (${got.inv.join(', ')})`, fx.expect.inventory.every((e) => got.inv.includes(e.id)));
    check('...and it is a Seasonal world (Halloween on in the season)', got.halloween?.setting === 'seasonal' && got.halloween.active === true);
    await page.evaluate(([x, y, z]) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      g.player.yaw = Math.atan2(-(x + 0.5 - b.x), -(z + 0.5 - b.z));
      g.player.pitch = 0.1;
    }, [fx.expect.pillar.x, fx.expect.pillar.y, fx.expect.pillar.z]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/v7r-old-save.png`, keepHud: true });
    await quit(page);
    await page.context().close();
  }

  // ====================================================================== multi
  if (part('multi')) {
    if (!fs.existsSync('dist-server/server.mjs')) {
      check('two players: needs npm run build:server first', false);
      return;
    }
    const MPORT = 18767;
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'minehonk-v7r-'));
    const hub = spawn('node', ['dist-server/server.mjs'], { env: { ...process.env, PORT: String(MPORT), DATA_DIR: data, STATIC_DIR: 'dist', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const log = [];
    hub.stdout.on('data', (d) => log.push(String(d)));
    hub.stderr.on('data', (d) => log.push(String(d)));
    await new Promise((r) => hub.stdout.on('data', (d) => String(d).includes('listening') && r()));
    try {
      const open = async (label) => {
        const p = await newPage();
        await p.goto(`http://127.0.0.1:${MPORT}/`);
        await p.getByText('Multiplayer').waitFor({ timeout: 30000 });
        await p.evaluate(() => {
          window.minehonk.settings.renderDistance = 6;
          new MutationObserver((ms) => {
            for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('speech')) (window.__speech ??= []).push(n.textContent);
          }).observe(document.body, { childList: true, subtree: true });
        });
        void label;
        return p;
      };
      const screen = (p) => p.locator('.screen:not(.hidden)').last();
      const account = async (p, name) => {
        await p.getByText('Multiplayer').click();
        await screen(p).getByRole('button', { name: 'Create Account' }).first().click();
        await screen(p).locator('input[placeholder="Player name"]').fill(name);
        await screen(p).locator('input[placeholder="Password"]').fill('halloween password 7');
        await screen(p).locator('input[placeholder="Repeat password"]').fill('halloween password 7');
        await screen(p).locator('button', { hasText: 'Create Account' }).last().click();
        await p.getByText(`Signed in as ${name}`).waitFor({ timeout: 15000 });
      };
      const alice = await open('alice');
      const bob = await open('bob');
      await account(alice, 'AliceV7');
      await account(bob, 'BobV7');
      await screen(alice).getByRole('button', { name: 'Create World' }).click();
      await screen(alice).locator('input[placeholder="World name"]').fill('Halloween Town');
      await screen(alice).locator('input[placeholder="Seed (optional)"]').fill(SEED);
      await screen(alice).getByRole('button', { name: 'Create', exact: true }).click();
      await alice.getByText('Join code:').waitFor({ timeout: 20000 });
      const code = /([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(await screen(alice).innerText())?.[1];
      await screen(alice).getByRole('button', { name: 'Back' }).click();
      await alice.getByText('Halloween Town').first().waitFor();
      await screen(alice).getByRole('button', { name: 'Join World' }).click();
      await inGame(alice);
      await screen(bob).getByRole('button', { name: 'Join by Code' }).click();
      await screen(bob).locator('input[placeholder="ABC7-92KD"]').fill(code.toLowerCase().replace('-', ''));
      await screen(bob).getByRole('button', { name: 'Join', exact: true }).click();
      await inGame(bob);
      for (const [n, p] of [['alice', alice], ['bob', bob]]) console.log(`     ${n}: ${JSON.stringify(await p.evaluate(() => ({ yaw: window.minehonk.game.player.yaw, pitch: window.minehonk.game.player.pitch, sens: window.minehonk.settings.sensitivity, locked: document.pointerLockElement != null })))}`);
      const hw = await Promise.all([alice, bob].map((p) => p.evaluate(() => window.minehonk.game.worldInfo.halloween)));
      check('two players on a dedicated server: the server tells both the same (Halloween on)', hw.every((h) => h?.active === true && h.setting === 'seasonal'));
      // The owner turns cheats on, gives Bob a sack and a costume and brings both to the village
      check('cheats on (the owner)', (await admin(alice, { a: 'set_cheats', on: true })).ok);
      await alice.waitForFunction(() => window.minehonk.game.worldInfo?.admin === true, null, { timeout: 10000 });
      const notAdmin = await admin(bob, { a: 'halloween', op: 'test', content: 'off' });
      check('Bob (not an operator) cannot use the season tests', !notAdmin.ok);
      for (const it of ['trick_or_treat_sack', 'carved_pumpkin']) await admin(alice, { a: 'give', item: it, count: 1, target: 'BobV7' });
      await cmd(alice, '/time set 14000');
      await cmd(alice, '/gamerule doDaylightCycle false');
      // No skeletons for Bob at night, and the owner a Creative player (no fall from the teleport's height)
      await cmd(alice, '/gamerule doMobSpawning false');
      await cmd(alice, '/gamemode creative');
      await cmd(alice, `/tp ${VILLAGE.x} 120 ${VILLAGE.z}`);
      await alice.waitForTimeout(6000);
      // A Candy Home of the village (the owner's lookup); Alice a few steps off, Bob (a Survival player:
      // no flying) brought to its step
      // (the server may still be busy making the village's chunks: asked again a moment later)
      const quick = (p, a) => Promise.race([admin(p, a), new Promise((r) => setTimeout(() => r({ ok: false, text: 'no answer in 20 s' }), 20000))]);
      let look = null;
      for (let t = 0; t < 3 && !look?.ok; t++) {
        if (t) await alice.waitForTimeout(5000);
        look = await quick(alice, { a: 'halloween', op: 'village_doors' });
        if (!look.ok) console.log(`     village_doors: ${look.text}; status: ${(await quick(alice, { a: 'halloween', op: 'status' })).text}; chat: ${(await chatText(alice)).split('\n').slice(-3).join(' | ')}`);
      }
      // One that opens onto an open street (Alice stands out there in the open, under the sky)
      const homes = (look.data?.doors?.doors ?? []).filter((h) => h.kind === 'candy' && !h.used);
      const opens = await alice.evaluate(
        (list) =>
          list.map((h) => {
            const fx = h.out[0] - h.x;
            const fz = h.out[2] - h.z;
            for (let k = 1; k <= 6; k++) if (window.minehonk.game.world.heightAt(h.x + fx * k, h.z + fz * k) <= h.y + 1) return k;
            return 0;
          }),
        homes,
      );
      const i = opens.findIndex((k) => k > 0);
      const home = homes[i];
      if (!home) throw new Error(`no Candy Home on an open street (${look.text})`);
      const fx = home.out[0] - home.x;
      const fz = home.out[2] - home.z;
      const d = [home.x, home.y, home.z, fx > 0 ? 'east' : fx < 0 ? 'west' : fz > 0 ? 'south' : 'north'];
      const [x, y, z] = d;
      const k = opens[i];
      // (/tp takes a player to a player: Alice goes to the step first and brings Bob, then stands back)
      await cmd(alice, `/tp ${(x + 0.5 + fx * 1.3).toFixed(2)} ${y + 0.2} ${(z + 0.5 + fz * 1.3).toFixed(2)}`);
      await alice.waitForTimeout(3000);
      const aliceDoors = await doorsNear(alice);
      await cmd(alice, '/tp BobV7 AliceV7');
      await alice.waitForTimeout(1500);
      // Alice across the street and a little to the side, at the door's height
      await cmd(alice, `/tp ${(x + 0.5 + fx * (k + 2.5) + fz * 1.5).toFixed(1)} ${y + 0.2} ${(z + 0.5 + fz * (k + 2.5) + fx * 1.5).toFixed(1)}`);
      await Promise.all([alice, bob].map((p) => p.waitForTimeout(6000)));
      // What each was told at the step (Alice before she stood back)
      const dd = [aliceDoors, await doorsNear(bob)];
      const has = (list) => list.some((e) => e[0] === x && e[1] === y && e[2] === z && e[3] === d[3]);
      check(`both are told of the same Trick-or-Treat door (${dd[0].length} / ${dd[1].length} near them)`, has(dd[0]) && has(dd[1]));
      // Bob puts the costume on and knocks; Alice stands by and watches the door
      // (the given items can still be on their way: tried until the pumpkin is on his head)
      for (let t = 0; t < 10; t++) {
        const on = await bob.evaluate((seq) => {
          const g = window.minehonk.game;
          if (window.minehonkRegistry.itemOf(g.invSlots[5]?.id ?? 0)?.id === 'carved_pumpkin') return true;
          const i = g.invSlots.findIndex((s, k) => k !== 5 && s && window.minehonkRegistry.itemOf(s.id).id === 'carved_pumpkin');
          if (i >= 0) g.send({ t: 'click', window: 0, slot: i, button: 0, mode: 'quick', seq });
          return false;
        }, 50 + t);
        if (on) break;
        await bob.waitForTimeout(800);
      }
      const sackSlot = await bob.evaluate(() => window.minehonk.game.invSlots.findIndex((s) => s && window.minehonkRegistry.itemOf(s.id).id === 'trick_or_treat_sack'));
      if (sackSlot >= 0 && sackSlot < 9) await bob.evaluate((i) => (window.minehonk.game.player.selectedSlot = i), sackSlot);
      await aimAndKnock(bob, d);
      await bob.waitForTimeout(2500);
      console.log(`     Bob at the door: ${JSON.stringify(await bob.evaluate(() => ({ said: window.__speech ?? [], head: window.minehonkRegistry.itemOf(window.minehonk.game.invSlots[5]?.id ?? 0)?.id ?? null, scene: document.querySelector('.haunt-scene')?.dataset.step ?? '' })))}`);
      await alice.evaluate(([x, y, z]) => {
        const g = window.minehonk.game;
        const b = g.player.body;
        g.player.yaw = Math.atan2(-(x + 0.5 - b.x), -(z + 0.5 - b.z));
        g.player.pitch = -Math.atan2(y + 1.2 - (b.y + 1.62), Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z));
      }, [x, y, z]);
      await alice.waitForTimeout(800);
      await alice.screenshot({ path: `${OUT}/v7r-mp-alice.png` });
      await bob.screenshot({ path: `${OUT}/v7r-mp-bob.png`, keepHud: true });
      const bobCandy = await bob.evaluate(() => window.minehonk.game.invSlots.some((s) => s && window.minehonkRegistry.itemOf(s.id).id === 'trick_or_treat_sack' && Object.values(s.tag?.data?.candy ?? {}).some((n) => n > 0)));
      const aliceCandy = await alice.evaluate(() => window.minehonk.game.invSlots.some((s) => s && window.minehonkRegistry.itemOf(s.id).id === 'trick_or_treat_sack'));
      check('the knock answered Bob: candy in his sack (and nothing for Alice)', bobCandy && !aliceCandy);
      await bob.screenshot({ path: `${OUT}/v7r-mp-bob-after.png`, keepHud: true });
    } catch (e) {
      check(`two players: ${e.message}`, false);
      console.log(log.join('').slice(-2000));
    } finally {
      kill(hub);
      await new Promise((r) => setTimeout(r, 1000));
      try {
        fs.rmSync(data, { recursive: true, force: true });
      } catch {
        /* the server was still writing as it stopped */
      }
    }
  }
})();

check(`no page errors (${errors.slice(0, 3).join(' | ')})`, errors.length === 0);
const failed = checks.filter(([, ok]) => !ok);
console.log(`\nV7 release E2E: ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
await browser.close();
kill(server);
process.exit(failed.length ? 1 : 0);
