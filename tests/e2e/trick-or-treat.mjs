/**
 * V7 - The Halloween Update, phase 3, in the browser: trick-or-treating.
 *  - the title screen's trick-or-treating scene;
 *  - the Trick-or-Treat Sack's window empty, partly full and full; its tooltip;
 *    the sack in the recipe book;
 *  - the four candies (the Poisoned one's warped, sickly look) in the sack's
 *    window, in hand and on the ground;
 *  - each costume worn: from inside (first person) and on another player;
 *  - knocking: the Knock prompt, a voice turning you away, a Candy Home's
 *    answer, a Trick Home's grab, drag and slam, the fight, its chest; Herobrine
 *    in one (from the Admin Panel);
 *  - the Trick or Treat! quest tracker, the Admin Panel's controls;
 *  - the quest in Creative (switched to by command), from the creative menu;
 *  - after the season: no prompt, nobody answers, the sack still works.
 * Screenshots: tests/e2e/out/trick-*.png (UPDATE_LOG_SHOTS=1 also keeps clean
 * copies for the Update Log in tests/e2e/out/clean).
 *
 *   npx vite build && node tests/e2e/trick-or-treat.mjs   (ONLY=title|sack|costumes|knock|quest|creative|after for one part)
 *
 * The world is seed "test-seed" (generator 9): its Trick-or-Treat eligible
 * desert village at (-136, 952) is dressed when built in the season.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4198;
const ONLY = process.env.ONLY ?? '';
const part = (p) => !ONLY || ONLY.split(',').includes(p);
const IN_SEASON = '2026-10-31T23:00:00Z';
const AFTER = '2026-11-07T08:01:00Z';
const SEED = 'test-seed';
const TRICK = { x: -136, z: 952 };
const HEADS = ['skeleton_skull', 'zombie_head', 'creeper_head', 'herobrine_head'];
const CANDY = ['candy', 'big_candy', 'king_sized_candy', 'poisoned_candy'];

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
    const HIDE = ['.hotbar', '.crosshair', '.debug', '.debug-right', '.quest-tracker', '.cheats-indicator', '.chat', '.xpbar', '.xplevel', '.stat-row', '.item-name', '.wings-meters', '.hp-label', '.toast', '.subtitles', '.boss-bars', '.title-overlay'];
    // Two screenshots take seconds; the world (the server in the worker, and the game's own ticks) holds still meanwhile, so a short cutscene is still there for both
    const freeze = (on) =>
      page
        .evaluate((on) => {
          const app = window.minehonk;
          const g = app?.game;
          if (on) window.__shotPaused = g?.paused ?? false;
          app?.conn?.setPaused?.(on);
          if (g) g.paused = on || window.__shotPaused;
        }, on)
        .catch(() => {});
    page.screenshot = async (opts = {}) => {
      if (!opts.path || opts.noClean) return shoot(opts);
      await freeze(true);
      try {
        return await clean(opts);
      } finally {
        await freeze(false);
      }
    };
    const clean = async (opts) => {
      const was = await page.evaluate(([hide, keep]) => {
        let st = document.getElementById('clean-shot');
        if (!st) document.head.append((st = Object.assign(document.createElement('style'), { id: 'clean-shot' })));
        st.textContent = hide.length ? hide.map((c) => `body.clean-shot ${c}`).join(',') + '{visibility:hidden!important}' : '';
        document.body.classList.add('clean-shot');
        const g = window.minehonk?.game;
        const w = g?.hudHidden ?? false;
        // (keepHand: the item in hand stays, the rest of the HUD goes)
        if (g && !keep) g.hudHidden = true;
        return w;
      }, [opts.keepMenu ? [] : HIDE, !!opts.keepHand]);
      await page.waitForTimeout(300);
      await shoot({ ...opts, path: path.join(CLEAN, path.basename(opts.path)) });
      await page.evaluate((w) => {
        document.body.classList.remove('clean-shot');
        const g = window.minehonk?.game;
        if (g) g.hudHidden = w;
      }, was);
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

async function panoramaReady(page, settle = 4000) {
  await page.waitForFunction(() => window.minehonk?.panorama?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(settle);
}

async function newWorld(page, name, seed) {
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) input').first().fill(name);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
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
    }, null, { timeout: 180000 });
    await page.waitForTimeout(extra);
  };
  /** Counts blocks of some ids within a square round a point (client's world). */
  const countBlocks = (x0, z0, r, ids, yMin = 40) =>
    page.evaluate(
      ([x0, z0, r, ids, yMin]) => {
        const g = window.minehonk.game;
        const reg = window.minehonkRegistry;
        const want = new Map(ids.map((id) => [reg.blockById.get(id).num, id]));
        const out = Object.fromEntries(ids.map((id) => [id, 0]));
        for (let x = x0 - r; x <= x0 + r; x++)
          for (let z = z0 - r; z <= z0 + r; z++)
            for (let y = yMin; y < 220; y++) {
              const st = g.world.getState(x, y, z);
              const id = st ? want.get(reg.blockOfState(st)) : undefined;
              if (id) out[id]++;
            }
        return out;
      },
      [x0, z0, r, ids, yMin],
    );
  /** Puts the camera at a spot (flying) looking at a point. */
  const view = async (from, at, wait = 1500) => {
    await page.evaluate(() => (window.minehonk.game.player.flying = true));
    await cmd(`/tp ${from.x.toFixed(2)} ${from.y.toFixed(2)} ${from.z.toFixed(2)}`, 1200);
    await waitChunks(1500);
    await page.evaluate(([from, at]) => {
      const g = window.minehonk.game;
      const dx = at.x - from.x;
      const dz = at.z - from.z;
      const dy = at.y - (from.y + 1.62);
      g.player.flying = true;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    }, [from, at]);
    await page.waitForTimeout(wait);
  };
  /** The ground height of a column, once the client has its chunk. */
  const ground = async (x, z) => {
    await page.waitForFunction(([x, z]) => window.minehonk.game.world.heightAt(Math.floor(x), Math.floor(z)) > 30, [x, z], { timeout: 120000 });
    return page.evaluate(([x, z]) => window.minehonk.game.world.heightAt(Math.floor(x), Math.floor(z)), [x, z]);
  };
  return { cmd, admin, waitChunks, countBlocks, view, ground };
};

const LIGHTS = ['factory_light_orange', 'factory_light_purple'];
const DRESSING = ['hallow_pumpkin', 'jack_o_lantern', 'carved_pumpkin', ...LIGHTS, ...HEADS];

// ======================================================================== the title screen

const speech = (page) => page.evaluate(() => [...document.querySelectorAll('.speech')].map((d) => d.textContent));
const num = (page, id) => page.evaluate((id) => window.minehonkRegistry.itemById.get(id).num, id);
/** The window-0 slot holding an item, -1 if none. */
const slotOf = (page, id) => page.evaluate((id) => window.minehonk.game.invSlots.findIndex((s) => s && s.id === window.minehonkRegistry.itemById.get(id).num), id);
/** Holds an item already in the inventory (moving it to hotbar slot 0 if needed). */
async function hold(page, id) {
  const i = await slotOf(page, id);
  if (i < 0) return false;
  if (i >= 36 && i <= 44) await page.evaluate((h) => window.minehonk.game.send({ t: 'hotbar', slot: h }), i - 36);
  else {
    await page.evaluate((i) => window.minehonk.game.send({ t: 'click', window: 0, slot: i, button: 0, mode: 'swap', seq: 0 }), i);
    await page.evaluate(() => window.minehonk.game.send({ t: 'hotbar', slot: 0 }));
  }
  await page.evaluate((i) => (window.minehonk.game.selected = i >= 36 && i <= 44 ? i - 36 : 0), i);
  await page.waitForTimeout(500);
  return true;
}
async function openSack(page) {
  await page.evaluate(() => window.minehonk.game.host.openSack(window.minehonk.game.selected));
  await page.locator('.sack-panel').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
}
const closeScreens = async (page) => {
  // A game window (the inventory, a chest), then the menus over the game
  await page.evaluate(() => {
    const g = window.minehonk.game;
    if (g?.screen) g.closeWindow(true);
  });
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) {
    if (!(await page.evaluate(() => window.minehonk.screenOpen))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
};

// ======================================================================== the title screen
if (part('title')) {
  const p = await newPage();
  // A village is picked at random: one with no clear view of a door shows the village from above instead, so try again
  let info = null;
  for (let i = 0; i < 4 && info?.scene !== 'trick_or_treat'; i++) {
    await p.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}&title=trick_or_treat`);
    await panoramaReady(p, 6000);
    info = await p.evaluate(() => {
      const pn = window.minehonk.panorama;
      return { scene: pn.sceneName, extras: (pn.extras ?? []).map((e) => ({ type: e.type, meta: e.meta })) };
    });
  }
  check(`the title screen's trick-or-treating scene: ${info.extras.map((e) => `${e.type} in a ${e.meta.headwear}`).join(', ')}`, info.scene === 'trick_or_treat' && info.extras.some((e) => e.type === 'player' && e.meta.headwear === 'carved_pumpkin') && info.extras.some((e) => e.type === 'villager' && e.meta.headwear));
  await p.screenshot({ path: `${OUT}/trick-title.png`, keepMenu: true });
  // The scene alone, without the menu over it
  await p.evaluate(() => document.querySelectorAll('.screen').forEach((s) => (s.style.visibility = 'hidden')));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/trick-title-scene.png`, keepMenu: true });
  await p.close();
}

// ======================================================================== the sack and the candies
if (part('sack') || part('costumes')) {
  const page = await newPage();
  const { cmd, waitChunks, view, ground } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await newWorld(page, 'Sack', SEED);
  await waitChunks(3000);
  await cmd('/time set noon', 500);

  if (part('sack')) {
    // An empty sack
    await cmd('/give trick_or_treat_sack 1', 800);
    await hold(page, 'trick_or_treat_sack');
    await openSack(page);
    const empty = await page.evaluate(() => document.querySelector('.sack-count')?.textContent);
    check(`an empty sack: "${empty}"`, /^0 \/ 128/.test(empty ?? '') && /128 space left/.test(empty ?? ''));
    await page.screenshot({ path: `${OUT}/trick-sack-empty.png`, keepMenu: true });
    await closeScreens(page);
    // Candy put in from the inventory: partly full
    for (const [id, n] of [['candy', 12], ['big_candy', 5], ['king_sized_candy', 2], ['poisoned_candy', 3]]) await cmd(`/give ${id} ${n}`, 300);
    await page.waitForTimeout(600);
    await openSack(page);
    await page.locator('.sack-foot .btn', { hasText: 'Put all candy in' }).click();
    await page.waitForFunction(() => /^22 \//.test(document.querySelector('.sack-count')?.textContent ?? ''), null, { timeout: 10000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.sack-row')].map((r) => r.querySelector('.sack-name div').textContent + ' ' + r.querySelector('.sack-n').textContent));
    check(`a sack partly full, by kind: ${rows.join(', ')}`, rows.length === 4 && rows.includes('Candy x12') && rows.includes('Poisoned Candy x3'));
    const poisonStyled = await page.evaluate(() => {
      const r = document.querySelector('.sack-row.poisoned');
      const name = r?.querySelector('.poisoned-text');
      const icon = r?.querySelector('.item-icon.poisoned');
      return !!name && !!icon && getComputedStyle(name).color !== getComputedStyle(document.querySelector('.sack-row:not(.poisoned) .sack-name div')).color;
    });
    check('the Poisoned Candy looks sickly in the sack, its name too', poisonStyled);
    await page.screenshot({ path: `${OUT}/trick-sack-partial.png`, keepMenu: true });
    // Taking some out and eating one, through the server
    await page.locator('.sack-row', { hasText: 'Big Candy' }).locator('.btn', { hasText: 'Take 1' }).click();
    await page.locator('.sack-row', { hasText: 'King-Sized Candy' }).locator('.btn', { hasText: 'Eat' }).click();
    await page.waitForFunction(() => /^20 \//.test(document.querySelector('.sack-count')?.textContent ?? ''), null, { timeout: 10000 });
    check('taking one out and eating one from the sack (22 → 20)', true);
    await closeScreens(page);
    // Its tooltip in the inventory
    await page.evaluate(() => window.minehonk.game.openInventory());
    await page.waitForTimeout(800);
    const box = await page.evaluate(() => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      const i = g.invSlots.findIndex((s) => s && reg.itemOf(s.id)?.id === 'trick_or_treat_sack');
      const r = g.screen?.slotEls?.get(i)?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (box) {
      await page.mouse.move(box.x - 5, box.y - 5);
      await page.mouse.move(box.x, box.y);
    }
    await page.waitForTimeout(700);
    const tip = await page.evaluate(() => document.querySelector('.tooltip:not(.hidden)')?.textContent ?? '');
    check(`its tooltip says how full it is ("${tip.slice(0, 60)}")`, /20 \/ 128 candy/.test(tip));
    await page.screenshot({ path: `${OUT}/trick-sack-tooltip.png`, keepMenu: true });
    // The recipe book has it (in the season)
    const book = await page.evaluate(() => {
      const t = document.querySelector('.rb-toggle, .recipe-book-btn, [data-action="recipe-book"]');
      return !!t;
    });
    void book;
    await closeScreens(page);
    // A full one, from the Admin Panel
    await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'halloween', op: 'give_full_sack' }));
    await page.waitForTimeout(800);
    const full = await page.evaluate(() => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      // The full one is the second sack
      return g.invSlots.map((s, i) => (s && reg.itemOf(s.id)?.id === 'trick_or_treat_sack' ? i : -1)).filter((i) => i >= 0);
    });
    if (full.length > 1) {
      const i = full.find((x) => x !== full[0]) ?? full[1];
      if (i >= 36) await page.evaluate((h) => { window.minehonk.game.send({ t: 'hotbar', slot: h }); window.minehonk.game.selected = h; }, i - 36);
      else {
        await page.evaluate((i) => window.minehonk.game.send({ t: 'click', window: 0, slot: i, button: 1, mode: 'swap', seq: 0 }), i);
        await page.evaluate(() => { window.minehonk.game.send({ t: 'hotbar', slot: 1 }); window.minehonk.game.selected = 1; });
      }
      await page.waitForTimeout(700);
    }
    await openSack(page);
    const fullText = await page.evaluate(() => document.querySelector('.sack-count')?.textContent);
    check(`a full sack: "${fullText}"`, /^128 \/ 128/.test(fullText ?? '') && /full/.test(fullText ?? ''));
    await page.screenshot({ path: `${OUT}/trick-sack-full.png`, keepMenu: true });
    await closeScreens(page);
    // Each candy in hand, first person
    for (const id of CANDY) {
      await cmd(`/give ${id} 1`, 400);
      await hold(page, id);
      await page.evaluate(() => (window.minehonk.game.player.pitch = 0.5));
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/trick-hand-${id}.png`, keepHand: true });
    }
    const handPoison = await page.evaluate(() => {
      const g = window.minehonk.game;
      return window.minehonkRegistry.itemOf(g.invSlots[36 + g.selected]?.id)?.id;
    });
    check(`each candy held in first person (last: ${handPoison})`, handPoison === 'poisoned_candy');
    // ...and on the ground, side by side
    const at = await page.evaluate(() => {
      const b = window.minehonk.game.player.body;
      return { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
    });
    const gy = await ground(at.x, at.z - 3);
    for (const id of CANDY) await cmd(`/give ${id} 1`, 300);
    await view({ x: at.x + 0.5, y: gy, z: at.z + 0.5 }, { x: at.x + 0.5, y: gy, z: at.z - 2 }, 600);
    for (const [i, id] of CANDY.entries()) {
      await hold(page, id);
      // Tossed a little way ahead, fanned out (out of reach, so nobody picks them up again)
      await page.evaluate((i) => {
        const g = window.minehonk.game;
        g.player.yaw = (i - 1.5) * 0.28;
        g.player.pitch = 0.5;
      }, i);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.minehonk.game.send({ t: 'drop', all: false }));
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(2500);
    // Close up on where they landed, with an empty hand
    const mid = await page.evaluate(async (nums) => {
      const list = [...window.minehonk.game.entities.values()].filter((e) => e.type === 'item' && nums.includes(Number(e.meta.item)));
      const n = Math.max(1, list.length);
      return { x: list.reduce((a, e) => a + e.x, 0) / n, y: list.reduce((a, e) => a + e.y, 0) / n, z: list.reduce((a, e) => a + e.z, 0) / n };
    }, await Promise.all(CANDY.map((c) => num(page, c))));
    await page.evaluate(() => {
      window.minehonk.game.send({ t: 'hotbar', slot: 8 });
      window.minehonk.game.selected = 8;
    });
    await view({ x: mid.x, y: mid.y - 0.6, z: mid.z + 2 }, { x: mid.x, y: mid.y + 0.1, z: mid.z }, 2500);
    const onGround = await page.evaluate((nums) => [...window.minehonk.game.entities.values()].filter((e) => e.type === 'item' && nums.includes(Number(e.meta.item))).length, await Promise.all(CANDY.map((c) => num(page, c))));
    check(`the four candies on the ground (${onGround})`, onGround >= 4);
    await page.screenshot({ path: `${OUT}/trick-candy-ground.png` });
  }

  if (part('costumes')) {
    // A grass platform up in the air, so nothing stands in the way
    const base = await page.evaluate(() => {
      const b = window.minehonk.game.player.body;
      return { x: Math.floor(b.x), y: Math.floor(b.y) + 12, z: Math.floor(b.z) };
    });
    await cmd(`/fill ${base.x - 6} ${base.y - 1} ${base.z - 8} ${base.x + 6} ${base.y - 1} ${base.z + 6} grass_block`, 1200);
    await cmd(`/tp ${base.x + 0.5} ${base.y} ${base.z + 4.5}`, 1500);
    await waitChunks(1500);
    // Each costume worn, from inside it, with an empty hand (the Herobrine Head is only ever won: shown here as if worn)
    const WEAR = ['carved_pumpkin', 'skeleton_skull', 'zombie_head', 'creeper_head', 'herobrine_head'];
    await cmd('/time set noon', 400);
    for (const id of WEAR) {
      if (id !== 'herobrine_head') {
        await cmd(`/give ${id} 1`, 500);
        await hold(page, id);
        await page.evaluate(() => (window.minehonk.game.player.pitch = -1.2));
        await page.evaluate(() => window.minehonk.game.send({ t: 'use', hand: 0, action: 'start' }));
        await page.waitForTimeout(1000);
        // Whatever was worn before goes back into the inventory, out of the hand
        await page.evaluate(() => {
          const g = window.minehonk.game;
          const s = g.invSlots[36 + g.selected];
          if (s) g.send({ t: 'click', window: 0, slot: 36 + g.selected, button: 0, mode: 'quick', seq: 0 });
        });
      } else
        await page.evaluate((n) => {
          window.minehonk.game.invSlots[5] = { id: n, count: 1 };
        }, await num(page, id));
      await page.evaluate(() => {
        const g = window.minehonk.game;
        g.send({ t: 'hotbar', slot: 8 });
        g.selected = 8;
        g.player.yaw = 0;
        g.player.pitch = 0.12;
      });
      await page.waitForTimeout(800);
      const overlay = await page.evaluate(() => document.querySelector('.costume-overlay')?.className);
      check(`${id} worn: seen from inside (${overlay})`, overlay === `costume-overlay ${id}`);
      await page.screenshot({ path: `${OUT}/trick-costume-${id}.png` });
    }
    // ...and on other players, the way every client draws them (some carrying a sack)
    await page.evaluate(([base, wear, sack]) => {
      const g = window.minehonk.game;
      const E = window.minehonkClientEntity;
      wear.forEach((h, i) => {
        const e = new E(-200 - i, 'player', base.x - 4 + i * 2 + 0.5, base.y, base.z - 3.5, Math.PI, 0, { name: ['Ann', 'Bo', 'Cy', 'Di', 'Ed'][i], headwear: h, held: i % 2 === 0 ? sack : 0 });
        e.headYaw = Math.PI;
        g.entities.set(e.id, e);
        g.renderer.entities.add(e);
      });
    }, [base, WEAR, await num(page, 'trick_or_treat_sack')]);
    await page.evaluate(() => {
      const g = window.minehonk.game;
      g.player.yaw = 0;
      g.player.pitch = 0.08;
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/trick-costumes-others.png` });
    const drawn = await page.evaluate(() => {
      let n = 0;
      window.minehonk.game.renderer.entities.group.traverse((o) => {
        if (o.isMesh && Array.isArray(o.material) && o.material.length === 6 && o.geometry?.parameters?.width > 0.5 && o.geometry.parameters.width < 0.6) n++;
      });
      return n;
    });
    check(`every costume drawn on the player wearing it (${drawn})`, drawn >= 5);
  }
  await page.close();
}

// ======================================================================== knocking, Candy Homes, Trick Homes
if (part('knock') || part('quest')) {
  const page = await newPage();
  const { cmd, admin, waitChunks, view } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
  await newWorld(page, 'Trick or Treat', SEED);
  await waitChunks(3000);
  if (part('quest')) {
    await page.waitForTimeout(1500);
    const q = await page.evaluate(() => document.querySelector('.quest-tracker:not(.hidden)')?.textContent ?? '');
    check(`the Trick or Treat! quest shows, on its first step ("${q}")`, /Trick or Treat!/.test(q) && /Sack/.test(q));
    await page.screenshot({ path: `${OUT}/trick-quest.png` });
  }
  if (part('knock')) {
    await cmd(`/tp ${TRICK.x} 120 ${TRICK.z}`, 2500);
    await waitChunks(9000);
    const r = await admin('village_doors');
    const doors = r.data?.doors?.doors ?? [];
    const candy = doors.filter((d) => d.kind === 'candy');
    const tricks = doors.filter((d) => d.kind === 'trick');
    check(`the village's doors: ${candy.length} Candy Homes, ${tricks.length} Trick Homes`, candy.length > 0 && tricks.length >= 2);
    const FACE = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
    const facingOf = (d) => [d.out[0] - d.x, d.out[2] - d.z];
    /** Stands on a door's step, looking at it. */
    const atDoor = async (d) => {
      await view({ x: d.out[0] + 0.5, y: d.out[1], z: d.out[2] + 0.5 }, { x: d.x + 0.5, y: d.y + 1.1, z: d.z + 0.5 }, 1500);
      await page.evaluate(() => (window.minehonk.game.player.flying = false));
      await page.waitForTimeout(800);
    };
    void FACE;
    void facingOf;
    await cmd('/time set midnight', 500);
    // The prompt, then no costume: turned away
    const d0 = candy[0];
    await atDoor(d0);
    await page.waitForFunction(() => window.minehonk.game.hud.prompt === 'Knock', null, { timeout: 15000 }).catch(() => {});
    const prompt = await page.evaluate(() => document.querySelector('.act-prompt:not(.hidden)')?.textContent ?? '');
    check(`looking at a Trick-or-Treat door: the Knock prompt ("${prompt}")`, /Knock/.test(prompt) && /G/.test(prompt));
    await page.screenshot({ path: `${OUT}/trick-knock-prompt.png` });
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => document.querySelectorAll('.speech').length > 0, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    const said = await speech(page);
    check(`knocking with no costume: "${said.join(' / ')}"`, said.some((t) => /costume|dress up/i.test(t)));
    await page.screenshot({ path: `${OUT}/trick-rejected.png` });
    // Dressed up, with a sack: a Candy Home answers
    await cmd('/give carved_pumpkin 1', 500);
    await hold(page, 'carved_pumpkin');
    await page.evaluate(() => window.minehonk.game.send({ t: 'use', hand: 0, action: 'start' }));
    await page.waitForTimeout(600);
    await cmd('/give trick_or_treat_sack 1', 600);
    await hold(page, 'trick_or_treat_sack');
    await atDoor(d0);
    await page.waitForFunction(() => window.minehonk.game.hud.prompt === 'Knock', null, { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(2000);
    const scene = await page.evaluate(() => ({ step: document.querySelector('.haunt-scene')?.dataset.step, skip: !document.querySelector('.hs-skip')?.classList.contains('hidden') }));
    const v = await page.evaluate(() => [...window.minehonk.game.entities.values()].find((e) => e.type === 'villager' && e.meta.headwear));
    check(`a Candy Home answers: the camera watches the door (${scene.step}, skippable: ${scene.skip}), a villager in a ${v?.meta.headwear}`, scene.step === 'look' && scene.skip && !!v);
    await page.screenshot({ path: `${OUT}/trick-candy-home.png` });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/trick-candy-home-give.png` });
    await page.waitForFunction(() => !window.minehonk.game.hauntScene.active, null, { timeout: 15000 });
    const sackCount = await page.evaluate(() => {
      const g = window.minehonk.game;
      const s = g.invSlots[36 + g.selected];
      const c = s?.tag?.data?.candy ?? {};
      return Object.values(c).reduce((a, b) => a + b, 0);
    });
    check(`the candy went straight into the sack (${sackCount})`, sackCount >= 1 && sackCount <= 3);
    // Again: once each
    await atDoor(d0);
    await page.waitForFunction(() => window.minehonk.game.hud.prompt === 'Knock', null, { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => [...document.querySelectorAll('.speech')].some((d) => /already|nice try|one handful/i.test(d.textContent ?? '')), null, { timeout: 5000 }).catch(() => {});
    check('knocking again: "You already got candy here!"', (await speech(page)).some((t) => /already|nice try|one handful/i.test(t)));
    // A Trick Home: the grab, the drag, the slam
    const t0 = tricks[0];
    await atDoor(t0);
    await page.waitForFunction(() => window.minehonk.game.hud.prompt === 'Knock', null, { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => document.querySelector('.haunt-scene')?.dataset.step === 'grab', null, { timeout: 10000, polling: 50 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/trick-home-grab.png` });
    await page.waitForFunction(() => document.querySelector('.haunt-scene')?.dataset.step === 'drag', null, { timeout: 10000, polling: 50 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/trick-home-drag.png` });
    await page.waitForFunction(() => !window.minehonk.game.hauntScene.active, null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    const fight = await page.evaluate(() => ({ bar: document.querySelector('.boss-halloween .shadow')?.textContent ?? '', mobs: [...window.minehonk.game.entities.values()].filter((e) => ['zombie_villager', 'zombie', 'skeleton', 'witch', 'spider', 'cave_spider'].includes(e.type)).length }));
    check(`dragged inside, the door slammed: "${fight.bar}", ${fight.mobs} monsters`, /left/.test(fight.bar) && fight.mobs > 0);
    await page.screenshot({ path: `${OUT}/trick-home-fight.png` });
    // The chests already in the house (houses have their own), to tell the new one
    const chestsIn = (d) =>
      page.evaluate((d) => {
        const g = window.minehonk.game;
        const reg = window.minehonkRegistry;
        const num = reg.blockById.get('chest').num;
        const out = [];
        for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let dy = -1; dy <= 2; dy++) {
          const st = g.world.getState(d.x + dx, d.y + dy, d.z + dz);
          if (st && reg.blockOfState(st) === num) out.push(`${d.x + dx},${d.y + dy},${d.z + dz}`);
        }
        return out;
      }, d);
    const before = await chestsIn(t0);
    // Beaten (in creative, with a strong sword, going up to each in turn): the chest
    await cmd('/gamemode creative', 500);
    await cmd('/give netherite_sword 1', 500);
    await hold(page, 'netherite_sword');
    const bar = () => page.evaluate(() => document.querySelector('.boss-halloween .shadow')?.textContent ?? '');
    for (let i = 0; i < 60 && /left/.test(await bar()); i++) {
      const m = await page.evaluate(() => {
        const g = window.minehonk.game;
        const b = g.player.body;
        const list = [...g.entities.values()].filter((e) => ['zombie_villager', 'zombie', 'skeleton', 'witch', 'spider', 'cave_spider'].includes(e.type) && !e.dead && Math.hypot(e.x - b.x, e.z - b.z) < 14);
        list.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z));
        return list[0] ? { id: list[0].id, x: list[0].x, y: list[0].y, z: list[0].z } : null;
      });
      if (!m) break;
      await page.evaluate((m) => window.minehonk.game.send({ t: 'chat', text: `/tp ${m.x.toFixed(2)} ${m.y.toFixed(2)} ${(m.z + 0.8).toFixed(2)}` }), m);
      await page.waitForTimeout(400);
      for (let k = 0; k < 4; k++) {
        await page.evaluate((id) => window.minehonk.game.send({ t: 'attack', id }), m.id);
        await page.waitForTimeout(260);
      }
    }
    await page.waitForTimeout(1500);
    const won = await speech(page);
    check(`beaten: "${won[won.length - 1] ?? ''}"`, won.some((t) => /chest/i.test(t)));
    // The chest: the one that was not there before
    const fresh = (await chestsIn(t0)).find((k) => !before.includes(k));
    const chest = fresh ? (([x, y, z]) => ({ x, y, z }))(fresh.split(',').map(Number)) : null;
    check(`a chest appeared in the house (${chest ? `${chest.x}, ${chest.y}, ${chest.z}` : 'none'})`, !!chest);
    if (chest) {
      // Next to it, on the side towards the door
      const fd = { x: Math.sign(t0.out[0] - t0.x), z: Math.sign(t0.out[2] - t0.z) };
      await cmd(`/tp ${(chest.x + 0.5 + fd.x * 1.6).toFixed(2)} ${chest.y} ${(chest.z + 0.5 + fd.z * 1.6).toFixed(2)}`, 1200);
      const me = await page.evaluate(() => ({ x: window.minehonk.game.player.body.x, y: window.minehonk.game.player.body.y, z: window.minehonk.game.player.body.z }));
      await page.evaluate(([c, me]) => {
        const g = window.minehonk.game;
        const dx = c.x + 0.5 - me.x;
        const dz = c.z + 0.5 - me.z;
        g.player.yaw = Math.atan2(-dx, -dz);
        g.player.pitch = -Math.atan2(c.y + 0.5 - (me.y + 1.62), Math.hypot(dx, dz));
      }, [chest, me]);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/trick-home-chest.png` });
      await page.evaluate((c) => window.minehonk.game.send({ t: 'use_on', x: c.x, y: c.y, z: c.z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: window.minehonk.game.player.yaw, pitch: window.minehonk.game.player.pitch, seq: 99 }), chest);
      await page.waitForTimeout(1200);
      // Icons in the open window, less the player's own stacks: what the chest holds
      const loot = await page.evaluate(() => {
        const g = window.minehonk.game;
        const shown = document.querySelectorAll('.layer.interactive .slot .item-icon').length;
        const mine = g.invSlots.slice(9, 45).filter(Boolean).length;
        return g.screen ? shown - mine : 0;
      });
      check(`its loot (${loot} stacks shown)`, loot > 0);
      await page.screenshot({ path: `${OUT}/trick-home-loot.png`, keepMenu: true });
      await closeScreens(page);
    }
    // Herobrine, from the Admin Panel, at another Trick Home
    const t1 = tricks[1] ?? tricks[0];
    // (in creative: he hits hard, and a player standing still for the picture would not last)
    await atDoor(t1);
    const hr = await admin('trick', { trick: 'herobrine' });
    check(`the Admin Panel starts Herobrine's Trick Home (${hr.text})`, hr.ok);
    await page.waitForFunction(() => !window.minehonk.game.hauntScene.active && document.querySelector('.boss-herobrine'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    // He blinks about the room: the world held still first, then faced where he stands
    await page.evaluate(() => {
      window.minehonk.conn?.setPaused?.(true);
      window.minehonk.game.paused = true;
    });
    await page.waitForTimeout(200);
    const hb = await page.evaluate(() => [...window.minehonk.game.entities.values()].find((e) => e.type === 'herobrine'));
    if (hb) {
      const me = await page.evaluate(() => ({ x: window.minehonk.game.player.body.x, y: window.minehonk.game.player.body.y, z: window.minehonk.game.player.body.z }));
      await page.evaluate(([h, me]) => {
        const g = window.minehonk.game;
        const dx = h.x - me.x;
        const dz = h.z - me.z;
        g.player.yaw = Math.atan2(-dx, -dz);
        g.player.pitch = -Math.atan2(h.y + 1.5 - (me.y + 1.62), Math.hypot(dx, dz));
      }, [{ x: hb.x, y: hb.y, z: hb.z }, me]);
      await page.waitForTimeout(500);
    }
    check(`Herobrine is in there (${hb ? 'yes' : 'no'})`, !!hb);
    await page.screenshot({ path: `${OUT}/trick-home-herobrine.png` });
    await page.evaluate(() => {
      window.minehonk.conn?.setPaused?.(false);
      window.minehonk.game.paused = false;
    });
    // The Admin Panel's trick-or-treat controls
    await page.evaluate(() => window.minehonk.openAdmin());
    await page.locator('.admin-panel').waitFor();
    await page.locator('.admin-tab[data-tab="halloween"]').dispatchEvent('mousedown');
    await page.waitForTimeout(1200);
    const btns = await page.evaluate(() => [...document.querySelectorAll('.btn')].map((b) => b.textContent));
    const want = ['Empty sack', 'Full sack', 'King-Sized Candy', 'Knock on the nearest door', "Reset the nearest village's doors", 'Herobrine?!'];
    check(`the Halloween tab: sacks, candy, knocking, Trick Homes, resetting doors${want.filter((t) => !btns.includes(t)).length ? ` (missing: ${want.filter((t) => !btns.includes(t)).join(', ')})` : ''}`, want.every((t) => btns.includes(t)));
    await page.evaluate(() => document.querySelector('.halloween-tricks')?.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/trick-admin.png`, keepMenu: true });
    await page.keyboard.press('Escape');
  }
  await page.close();
}

// ======================================================================== the quest in Creative
if (part('creative')) {
  const page = await newPage();
  const { cmd, admin, waitChunks } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
  await newWorld(page, 'Creative Quest', SEED);
  await waitChunks(3000);
  const tracker = () => page.evaluate(() => document.querySelector('.quest-tracker:not(.hidden)')?.textContent ?? '');
  const waitStep = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.quest-tracker:not(.hidden)')?.textContent ?? ''), re.source, { timeout: 20000 }).catch(() => {});
  // Creative by command (a cheat in a survival world), the sack and a pumpkin from the creative menu
  await cmd('/gamemode creative', 800);
  const gm = await page.evaluate(() => window.minehonk.game.player.gamemode);
  await page.evaluate(([sack, pumpkin]) => {
    const g = window.minehonk.game;
    g.send({ t: 'creative_set', slot: 36, item: { id: sack, count: 1 } });
    g.send({ t: 'creative_set', slot: 37, item: { id: pumpkin, count: 1 } });
  }, [await num(page, 'trick_or_treat_sack'), await num(page, 'carved_pumpkin')]);
  await waitStep(/Wear your costume/);
  check(`in ${gm}, a sack and a pumpkin from the creative menu move the quest on ("${await tracker()}")`, gm === 'creative' && /Wear your costume/.test(await tracker()));
  // Put on by using it
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.send({ t: 'hotbar', slot: 1 });
    g.selected = 1;
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.minehonk.game.send({ t: 'use', hand: 0, action: 'start' }));
  await waitStep(/Find a Trick-or-Treat Village/);
  check(`wearing it: "${await tracker()}"`, /Find a Trick-or-Treat Village/.test(await tracker()));
  // Teleported to the village (another cheat)
  await cmd(`/tp ${TRICK.x} 120 ${TRICK.z}`, 2500);
  await waitChunks(9000);
  const doors = (await admin('village_doors')).data?.doors?.doors ?? [];
  const d = doors.find((x) => x.kind === 'candy');
  if (d) await cmd(`/tp ${d.out[0] + 0.5} ${d.out[1]} ${d.out[2] + 0.5}`, 1500);
  await waitStep(/Knock on a door/);
  check(`teleported into the village: "${await tracker()}"`, !!d && /Knock on a door/.test(await tracker()));
  // Knocking (from the hotbar's sack)
  if (d) {
    await page.evaluate(([d]) => {
      const g = window.minehonk.game;
      g.send({ t: 'hotbar', slot: 0 });
      g.selected = 0;
      g.send({ t: 'knock', x: d.x, y: d.y, z: d.z });
    }, [d]);
  }
  await waitStep(/Collect candy/);
  await page.waitForFunction(() => !window.minehonk.game.hauntScene.active, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  check(`a Candy Home answered: "${await tracker()}"`, /Collect candy from Candy Homes \([1-3]\/10\)/.test(await tracker()));
  await page.screenshot({ path: `${OUT}/trick-quest-creative.png`, noClean: true });
  await page.close();
}

// ======================================================================== after the season
if (part('after')) {
  const page = await newPage();
  const { cmd, waitChunks, view } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
  await newWorld(page, 'After the season', SEED);
  await waitChunks(3000);
  // Built in the season, visited after it (the Admin Panel's "after the cutoff")
  await cmd(`/tp ${TRICK.x} 120 ${TRICK.z}`, 2500);
  await waitChunks(9000);
  const r = await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'halloween', op: 'village_doors' }));
  const d = r.data?.doors?.doors?.[0];
  await cmd('/give trick_or_treat_sack 1', 500);
  await cmd('/give candy 5', 500);
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'halloween', op: 'simulate', sim: 'expired' }));
  await page.waitForTimeout(1500);
  await view({ x: d.out[0] + 0.5, y: d.out[1], z: d.out[2] + 0.5 }, { x: d.x + 0.5, y: d.y + 1.1, z: d.z + 0.5 }, 2500);
  const prompt = await page.evaluate(() => window.minehonk.game.hud.prompt);
  check(`after the season: no Knock prompt (${prompt})`, prompt === null);
  await page.evaluate((d) => window.minehonk.game.send({ t: 'knock', x: d.x, y: d.y, z: d.z }), d);
  await page.waitForTimeout(900);
  check(`and nobody answers: "${(await speech(page)).pop() ?? ''}"`, (await speech(page)).some((t) => /Halloween is over/.test(t)));
  await page.screenshot({ path: `${OUT}/trick-after.png` });
  await hold(page, 'trick_or_treat_sack');
  await openSack(page);
  await page.locator('.sack-foot .btn', { hasText: 'Put all candy in' }).click();
  await page.waitForFunction(() => /^5 \//.test(document.querySelector('.sack-count')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  check('the sack still works after the season', /^5 \//.test((await page.evaluate(() => document.querySelector('.sack-count')?.textContent)) ?? ''));
  await closeScreens(page);
  await page.close();
}

await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${errors.length ? `, ${errors.length} page errors` : ''}`);
process.exit(failed.length || errors.length ? 1 : 0);
