/**
 * V7 - The Halloween Update, phase 2, in the browser:
 *  - the title screen's two village scenes (a Trick-or-Treat Village, an
 *    Abandoned Village with ghosts over it);
 *  - a Trick-or-Treat Village in a world made in the season: pumpkins, the
 *    orange and purple lights, skulls by the doors, by night and by day; the
 *    Admin Panel listing its doors (2 to 4 Trick Homes) and going to one; the
 *    Teleport tab's two new entries;
 *  - an Abandoned Village: ruins, ghosts in broad daylight, zombie villagers
 *    and guardians that don't burn;
 *  - the costume heads, placed and worn (drawn on a player's head);
 *  - a world made after the cutoff: its villages are ordinary.
 * Screenshots: tests/e2e/out/villages-*.png (UPDATE_LOG_SHOTS=1 also keeps
 * clean copies for the Update Log in tests/e2e/out/clean).
 *
 *   npx vite build && node tests/e2e/villages.mjs        (ONLY=title|trick|abandoned|heads|after for one part)
 *
 * The world is seed "test-seed" (generator 9): a Trick-or-Treat eligible
 * desert village at (-136, 952) and an Abandoned Village out in the plains at
 * (3784, -3560), open country for the pictures.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4197;
const ONLY = process.env.ONLY ?? '';
const part = (p) => !ONLY || ONLY.split(',').includes(p);
const IN_SEASON = '2026-10-31T23:00:00Z';
const AFTER = '2026-11-07T08:01:00Z';
const SEED = 'test-seed';
const TRICK = { x: -136, z: 952 };
const ABANDONED = { x: 3784, z: -3560 };
const HEADS = ['skeleton_skull', 'zombie_head', 'creeper_head', 'herobrine_head'];

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
if (part('title')) {
  for (const scene of ['trick_village', 'abandoned_village']) {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}&title=${scene}`);
    await p.getByText('Singleplayer').waitFor({ timeout: 30000 });
    await panoramaReady(p, 7000);
    const s = await p.evaluate(() => {
      const pan = window.minehonk.panorama;
      const r = pan.renderer;
      return { scene: pan.sceneName, ghosts: r.ghosts.count };
    });
    check(`${scene}: built (${s.scene}), ${s.ghosts} ghost${s.ghosts === 1 ? '' : 's'} drifting by`, s.scene === scene && s.ghosts > 0);
    await p.screenshot({ path: `${OUT}/villages-title-${scene}.png` });
    await p.evaluate(() => (document.querySelector('.title-screen').style.visibility = 'hidden'));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/halloween-scene-${scene}.png` });
    await p.close();
  }
  // In turn with the others
  const p = await newPage();
  await p.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await p.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await panoramaReady(p, 500);
  const seen = new Set([await p.evaluate(() => window.minehonk.panorama.sceneName)]);
  for (let i = 0; i < 5; i++) {
    const was = await p.evaluate(() => window.minehonk.panorama.sceneName);
    await p.evaluate(() => (window.minehonk.panorama.sceneStart = -1e9));
    await p.waitForFunction((was) => window.minehonk.panorama.ready && window.minehonk.panorama.sceneName !== was, was, { timeout: 180000 });
    seen.add(await p.evaluate(() => window.minehonk.panorama.sceneName));
  }
  check(`the title screen's five Halloween scenes take turns (${[...seen].join(', ')})`, seen.size === 5 && seen.has('trick_village') && seen.has('abandoned_village'));
  await p.close();
}

// ======================================================================== a Trick-or-Treat Village
if (part('trick') || part('abandoned') || part('heads')) {
  const page = await newPage();
  const { cmd, admin, waitChunks, countBlocks, view, ground } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${IN_SEASON}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 7));
  await newWorld(page, 'Villages', SEED);
  await waitChunks(3000);
  await cmd('/gamemode creative');

  if (part('trick')) {
    await cmd(`/tp ${TRICK.x} 120 ${TRICK.z}`, 2500);
    await waitChunks(9000);
    const gy = await ground(TRICK.x, TRICK.z);
    const n = await countBlocks(TRICK.x, TRICK.z, 56, DRESSING);
    const lights = n.factory_light_orange + n.factory_light_purple;
    const heads = HEADS.reduce((s, h) => s + n[h], 0);
    check(`the village is dressed: ${n.hallow_pumpkin} Hallow Pumpkins, ${n.jack_o_lantern} jack o'lanterns, ${lights} lights, ${heads} heads`, n.hallow_pumpkin > 8 && lights > 10 && heads > 0 && n.jack_o_lantern > 2);
    // Overview at night, then by day: from above the highest roof near the plaza
    const top = await page.evaluate(([x0, z0]) => {
      const w = window.minehonk.game.world;
      let h = 0;
      for (let x = x0 - 24; x <= x0 + 24; x += 2) for (let z = z0 - 24; z <= z0 + 24; z += 2) h = Math.max(h, w.heightAt(x, z));
      return h;
    }, [TRICK.x, TRICK.z]);
    const camY = Math.min(top + 4, gy + 22);
    await cmd('/time set midnight', 600);
    await view({ x: TRICK.x - 16.5, y: camY, z: TRICK.z + 16.5 }, { x: TRICK.x, y: gy, z: TRICK.z }, 4000);
    await page.screenshot({ path: `${OUT}/villages-trick-village.png` });
    await cmd('/time set noon', 600);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/villages-trick-village-day.png` });
    // Its doors, from the Admin Panel
    const r = await admin('village_doors');
    const info = r.data?.doors;
    const tricks = info?.doors.filter((d) => d.kind === 'trick').length ?? 0;
    check(`the Admin Panel lists ${info?.doors.length} doors, ${tricks} of them Trick Homes`, r.ok && tricks >= 2 && tricks <= 4 && info.doors.length > tricks && Math.abs(info.x - TRICK.x) < 2);
    // A door at night: pumpkins, a skull, the lights along the eaves (one with a skull if there is one)
    const doors = info?.doors ?? [];
    const withSkull = await page.evaluate((doors) => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      const heads = new Set(['skeleton_skull', 'zombie_head', 'creeper_head'].map((id) => reg.blockById.get(id).num));
      for (const d of doors)
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) {
            const st = g.world.getState(d.out[0] + dx, d.out[1] + 1, d.out[2] + dz);
            if (st && heads.has(reg.blockOfState(st))) return d.id;
          }
      return doors[0]?.id ?? -1;
    }, doors);
    const door = doors.find((d) => d.id === withSkull) ?? doors[0];
    if (door) {
      const f = { x: door.out[0] - door.x, z: door.out[2] - door.z };
      await cmd('/time set midnight', 600);
      await view({ x: door.x + 0.5 + f.x * 4.5, y: door.y + 1.4, z: door.z + 0.5 + f.z * 4.5 }, { x: door.x + 0.5, y: door.y + 1.2, z: door.z + 0.5 }, 3000);
      await page.screenshot({ path: `${OUT}/villages-trick-village-door.png` });
    }
    // The Admin Panel's Halloween tab: the doors
    await cmd('/time set noon', 600);
    await page.evaluate(() => window.minehonk.openAdmin());
    await page.locator('.admin-panel').waitFor();
    await page.locator('.admin-tab[data-tab="halloween"]').dispatchEvent('mousedown');
    await page.waitForTimeout(1200);
    await page.locator('.btn.halloween-doors-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.halloween-door').length > 0, null, { timeout: 60000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.halloween-door')].map((d) => d.querySelector('.halloween-door-kind').textContent));
    check(`the Halloween tab shows the doors (${rows.filter((r) => r === 'Trick Home').length} Trick Homes of ${rows.length})`, rows.length === doors.length && rows.filter((r) => r === 'Trick Home').length === tricks);
    await page.evaluate(() => document.querySelector('.halloween-doors')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/halloween-admin-villages.png`, keepMenu: true });
    // ...and goes to one
    await page.locator('.halloween-door .btn', { hasText: 'Go' }).first().click();
    await page.waitForTimeout(2500);
    const at = await page.evaluate(() => {
      const b = window.minehonk.game.player.body;
      return { x: Math.floor(b.x), z: Math.floor(b.z) };
    });
    check(`"Go" stands you in front of the door (${at.x}, ${at.z})`, at.x === doors[0].out[0] && at.z === doors[0].out[2]);
    // The Teleport tab lists both villages
    await page.evaluate(() => window.minehonk.openAdmin());
    await page.locator('.admin-panel').waitFor();
    await page.locator('.admin-tab[data-tab="teleport"]').dispatchEvent('mousedown');
    await page.waitForTimeout(800);
    const opts = await page.evaluate(() => [...document.querySelectorAll('.admin-panel select option')].map((o) => o.textContent));
    check('the Teleport tab offers Trick-or-Treat Village and Abandoned Village', opts.includes('Trick-or-Treat Village') && opts.includes('Abandoned Village'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ======================================================================== an Abandoned Village
  if (part('abandoned')) {
    await cmd('/time set noon', 600);
    await cmd(`/tp ${ABANDONED.x} 120 ${ABANDONED.z}`, 2500);
    await waitChunks(10000);
    const gy = await ground(ABANDONED.x, ABANDONED.z);
    // The village itself (an underground ruin nearby has lanterns of its own)
    const n = await countBlocks(ABANDONED.x, ABANDONED.z, 40, ['cobweb', 'vine', 'lantern', 'torch', 'wall_torch', 'soul_lantern', 'mossy_cobblestone'], gy - 8);
    check(`the ruins: ${n.cobweb} cobwebs, ${n.vine} vines, ${n.lantern + n.torch + n.wall_torch} lanterns or torches, ${n.soul_lantern} soul lanterns`, n.cobweb > 15 && n.vine > 10 && n.lantern + n.torch + n.wall_torch === 0);
    await view({ x: ABANDONED.x - 18, y: gy + 11, z: ABANDONED.z + 18 }, { x: ABANDONED.x, y: gy, z: ABANDONED.z }, 9000);
    const day = await page.evaluate(() => ({ ghosts: window.minehonk.game.renderer?.ghosts?.count ?? -1, area: window.minehonk.game.hauntedArea }));
    check(`ghosts drift over it in broad daylight (${day.ghosts})`, day.ghosts > 0 && !!day.area);
    await page.screenshot({ path: `${OUT}/villages-abandoned-village.png` });
    // Its people, not burning at noon
    const mobs = await page.evaluate(() =>
      [...window.minehonk.game.entities.values()]
        .filter((e) => ['zombie_villager', 'zombie', 'skeleton', 'husk', 'stray'].includes(e.type))
        .map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z, fire: e.meta.fire === true })),
    );
    const zv = mobs.filter((m) => m.type === 'zombie_villager');
    check(`${zv.length} zombie villagers and ${mobs.length - zv.length} undead guardians, none burning at noon`, zv.length > 0 && mobs.length - zv.length >= 5 && mobs.every((m) => !m.fire));
    const target = zv.sort((a, b) => Math.hypot(a.x - ABANDONED.x, a.z - ABANDONED.z) - Math.hypot(b.x - ABANDONED.x, b.z - ABANDONED.z))[0];
    if (target) {
      await view({ x: target.x + 3.5, y: target.y + 4.5, z: target.z + 3.5 }, { x: target.x, y: target.y + 1, z: target.z }, 2500);
      // Look again where it has walked to
      await page.evaluate(() => {
        const g = window.minehonk.game;
        const b = g.player.body;
        const e = [...g.entities.values()].filter((e) => e.type === 'zombie_villager').sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
        if (!e) return;
        const dx = e.x - b.x;
        const dz = e.z - b.z;
        g.player.yaw = Math.atan2(-dx, -dz);
        g.player.pitch = -Math.atan2(e.y + 1 - (b.y + 1.62), Math.hypot(dx, dz));
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/villages-abandoned-guardians.png` });
    }
    // Inside a ruined house: the nearest chest whose roof has fallen in (open sky over it)
    const chest = await page.evaluate(([cx, cz]) => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      const num = reg.blockById.get('chest').num;
      let best = null;
      for (let x = cx - 40; x <= cx + 40; x++)
        for (let z = cz - 40; z <= cz + 40; z++)
          for (let y = 50; y < 120; y++) {
            const st = g.world.getState(x, y, z);
            if (st && reg.blockOfState(st) === num) {
              const open = g.world.heightAt(x, z) <= y + 2;
              const d = Math.hypot(x - cx, z - cz) + (open ? 0 : 1000);
              if (!best || d < best.d) best = { x, y, z, d };
            }
          }
      return best;
    }, [ABANDONED.x, ABANDONED.z]);
    if (chest) {
      await cmd('/time set noon', 600);
      // From just over the broken walls, looking down into the room
      const spot = { x: chest.x + 2.5, y: chest.y + 3.4, z: chest.z + 3.5 };
      await view(spot, { x: chest.x + 0.5, y: chest.y + 0.5, z: chest.z + 0.5 }, 3000);
      await page.screenshot({ path: `${OUT}/villages-abandoned-inside.png` });
    }
    // Night: still haunted, still there
    await cmd('/time set midnight', 600);
    await view({ x: ABANDONED.x - 18, y: gy + 11, z: ABANDONED.z + 18 }, { x: ABANDONED.x, y: gy, z: ABANDONED.z }, 8000);
    const night = await page.evaluate(() => window.minehonk.game.renderer?.ghosts?.count ?? -1);
    check(`...and by night (${night} ghosts)`, night > 0);
    await page.screenshot({ path: `${OUT}/villages-abandoned-night.png` });
    await cmd('/time set noon', 600);
  }

  // ======================================================================== the heads
  if (part('heads')) {
    await cmd('/tp 0 140 0', 2500);
    await waitChunks(4000);
    // A row of fence posts with the heads on, on a platform in the air
    const base = await page.evaluate(() => {
      const b = window.minehonk.game.player.body;
      return { x: Math.floor(b.x), y: Math.floor(b.y) + 2, z: Math.floor(b.z) - 6 };
    });
    await cmd(`/fill ${base.x - 4} ${base.y - 1} ${base.z - 2} ${base.x + 4} ${base.y - 1} ${base.z + 2} grass_block`, 800);
    for (let i = 0; i < 4; i++) {
      const x = base.x - 3 + i * 2;
      await cmd(`/fill ${x} ${base.y} ${base.z} ${x} ${base.y} ${base.z} oak_fence`, 300);
      await cmd(`/fill ${x} ${base.y + 1} ${base.z} ${x} ${base.y + 1} ${base.z} ${HEADS[i]}[facing=south]`, 300);
    }
    await view({ x: base.x + 0.5, y: base.y + 0.2, z: base.z + 5.5 }, { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 }, 2500);
    const placed = await countBlocks(base.x, base.z, 5, HEADS, base.y - 2);
    check(`the four heads stand on their posts (${Object.values(placed).join(', ')})`, HEADS.every((h) => placed[h] === 1));
    await page.screenshot({ path: `${OUT}/villages-heads.png` });
    // Worn: put one on (used in the air), as the server tells everyone
    await page.evaluate(() => {
      const g = window.minehonk.game;
      g.player.pitch = -1.2;
    });
    await cmd('/give creeper_head 1', 800);
    // Hold it (whichever hotbar slot it went to), then use it with nothing in front
    await page.evaluate(() => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      const num = reg.itemById.get('creeper_head').num;
      const idx = g.invSlots.findIndex((s) => s && s.id === num);
      const hot = idx >= 36 ? idx - 36 : idx;
      g.send({ t: 'hotbar', slot: hot });
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.minehonk.game.send({ t: 'use', hand: 0, action: 'start' }));
    await page.waitForTimeout(1200);
    const helmet = await page.evaluate(() => {
      const g = window.minehonk.game;
      const reg = window.minehonkRegistry;
      // The helmet slot (index 5 of the player's slots)
      const s = g.invSlots[5];
      return s ? reg.itemOf(s.id)?.id : null;
    });
    check(`a creeper head used in the air goes on your head (${helmet})`, helmet === 'creeper_head');
    // Other players wearing heads (and a carved pumpkin), drawn the way every client draws them
    await page.evaluate(([base, heads]) => {
      const g = window.minehonk.game;
      const E = window.minehonkClientEntity;
      const wear = [...heads, 'carved_pumpkin'];
      wear.forEach((h, i) => {
        // Facing the camera (south)
        const e = new E(-100 - i, 'player', base.x - 4 + i * 2 + 0.5, base.y, base.z + 2.5, Math.PI, 0, { name: ['Ann', 'Bo', 'Cy', 'Di', 'Ed'][i], headwear: h });
        e.headYaw = Math.PI;
        g.entities.set(e.id, e);
        g.renderer.entities.add(e);
      });
    }, [base, HEADS]);
    await view({ x: base.x + 0.5, y: base.y + 0.6, z: base.z + 9.5 }, { x: base.x + 0.5, y: base.y + 1.2, z: base.z + 2.5 }, 2500);
    await page.screenshot({ path: `${OUT}/villages-heads-worn.png` });
    const drawn = await page.evaluate(() => {
      let n = 0;
      window.minehonk.game.renderer.entities.group.traverse((o) => {
        if (o.isMesh && Array.isArray(o.material) && o.material.length === 6 && o.geometry?.parameters?.width > 0.5 && o.geometry.parameters.width < 0.6) n++;
      });
      return n;
    });
    check(`each worn head is drawn on its player (${drawn})`, drawn >= 5);
  }
  await page.close();
}

// ======================================================================== after the cutoff
if (part('after')) {
  const page = await newPage();
  const { cmd, waitChunks, countBlocks } = helpers(page);
  await page.goto(`http://localhost:${PORT}/?clock=${AFTER}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await newWorld(page, 'Villages after', SEED);
  await waitChunks(2000);
  await cmd('/gamemode creative');
  await cmd(`/tp ${TRICK.x} 120 ${TRICK.z}`, 2500);
  await waitChunks(8000);
  const n = await countBlocks(TRICK.x, TRICK.z, 48, DRESSING);
  check(`a world made after the cutoff: the same village is ordinary (${Object.values(n).reduce((s, v) => s + v, 0)} Halloween blocks)`, Object.values(n).reduce((s, v) => s + v, 0) === 0);
  await page.close();
}

await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${errors.length ? `, ${errors.length} page errors` : ''}`);
process.exit(failed.length || errors.length ? 1 : 0);
