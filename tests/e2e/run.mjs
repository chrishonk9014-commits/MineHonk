/**
 * End-to-end smoke test: serves the production build, opens it in headless
 * Chromium (software WebGL), creates a world, waits for terrain, plays a few
 * seconds and saves screenshots to tests/e2e/out.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4173;
const mode = process.argv[2] ?? 'survival';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const errors = [];
let failed = false;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    if (process.env.VERBOSE || m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('[pageerror]', e);
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}/01-title.png` });
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.waitForTimeout(300);
  // Configure the new world
  const seed = process.env.SEED ?? 'e2e-seed';
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  if (mode !== 'survival') {
    const modes = { creative: 'Creative', god: 'God Mode', hardcore: 'Hardcore' };
    for (let i = 0; i < 6; i++) {
      const txt = await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).textContent();
      if (txt.includes(modes[mode])) break;
      await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).click();
    }
  }
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if (process.env.CHEATS && (await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.screenshot({ path: `${OUT}/02-create.png` });
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game;
  }, null, { timeout: 180000 });
  console.log(`world ready in ${Date.now() - t0} ms`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/03-ingame.png` });
  if (process.env.GALLERY) {
    // Summon a line-up of mobs in front of the player for a visual check
    const list = process.env.GALLERY.split(',');
    await page.evaluate(async (mobs) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      // Commands are rate limited like chat: space them out
      const send = async (text) => {
        g.send({ t: 'chat', text });
        await wait(1100);
      };
      const px = Math.floor(b.x);
      const pz = Math.floor(b.z);
      const y = 120;
      g.player.flying = true;
      await send(`/tp ${px} ${y + 1} ${pz + 2}`);
      await send(`/fill ${px - 12} ${y - 1} ${pz - 16} ${px + 12} ${y - 1} ${pz + 6} grass_block`);
      await send('/time set 6000');
      for (let i = 0; i < mobs.length; i++) {
        const row = Math.floor(i / 6);
        const col = i % 6;
        const close = mobs.length <= 6;
        await send(`/summon ${mobs[i]} ${close ? px + 0.5 + (i - (mobs.length - 1) / 2) * 2.5 : px - 7.5 + col * 3} ${y} ${close ? pz - 3 : pz - 4 - row * 5} noai`);
      }
      g.player.yaw = Number(localStorage.getItem('e2e.yaw') || 0);
      g.player.pitch = mobs.length <= 6 ? 0.3 : 0.3;
      window.minehonk.settings.fov = Number(localStorage.getItem('e2e.fov') || 70);
    }, list);
    await page.waitForTimeout(2500);
    console.log('gallery pos', JSON.stringify(await page.evaluate(() => {
      const g = window.minehonk.game;
      return { p: [g.player.body.x, g.player.body.y, g.player.body.z], mobs: [...g.entities.values()].map((e) => [e.type, Math.round(e.x), Math.round(e.y), Math.round(e.z)]), chat: [...document.querySelectorAll('.chat .line')].map((l) => l.textContent).slice(-20) };
    })));
    await page.screenshot({ path: `${OUT}/gallery.png` });
    await browser.close();
    stopServer();
    process.exit(0);
  }
  if (process.env.STATIONS) {
    // Visual check of workstation screens (needs CHEATS=1)
    const send = async (text) => {
      await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), text);
      await page.waitForTimeout(1100);
    };
    const pos = await page.evaluate(() => {
      const b = window.minehonk.game.player.body;
      return [Math.floor(b.x), Math.floor(b.z)];
    });
    const [px, pz] = pos;
    const y = 120;
    await send(`/fill ${px - 4} ${y} ${pz - 4} ${px + 4} ${y} ${pz + 4} stone`);
    await send(`/tp ${px + 0.5} ${y + 1} ${pz + 0.5}`);
    await send(`/fill ${px - 2} ${y + 1} ${pz - 4} ${px + 2} ${y + 2} ${pz - 4} bookshelf`);
    await send(`/fill ${px} ${y + 1} ${pz - 2} ${px} ${y + 1} ${pz - 2} enchanting_table`);
    await send(`/fill ${px + 2} ${y + 1} ${pz} ${px + 2} ${y + 1} ${pz} anvil`);
    await send(`/fill ${px - 2} ${y + 1} ${pz} ${px - 2} ${y + 1} ${pz} brewing_stand`);
    await send('/xp 30L');
    await send('/give lapis_lazuli 16');
    await send('/give iron_sword');
    await send('/give blaze_powder 4');
    await send('/give nether_wart 4');
    await send('/give iron_ingot 4');
    const stations = [['enchanting', px, y + 1, pz - 2], ['anvil', px + 2, y + 1, pz], ['brewing', px - 2, y + 1, pz]];
    for (const [name, x, by, z] of stations) {
      await page.evaluate(([x, by, z]) => {
        const g = window.minehonk.game;
        g.player.pitch = 0.9;
        g.send({ t: 'use_on', x, y: by, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: g.player.yaw, pitch: g.player.pitch, seq: 0 });
      }, [x, by, z]);
      await page.waitForTimeout(1500);
      // Shift-click the sword and lapis into the enchanting table to show offers
      if (name === 'enchanting') {
        const centres = await page.evaluate(() => [...document.querySelectorAll('.gui .inv-hotbar .slot')].slice(0, 2).map((e) => {
          const r = e.getBoundingClientRect();
          return [r.x + r.width / 2, r.y + r.height / 2];
        }));
        await page.keyboard.down('Shift');
        for (const [cx, cy] of [centres[1], centres[0]]) {
          await page.mouse.click(cx, cy);
          await page.waitForTimeout(300);
        }
        await page.keyboard.up('Shift');
        await page.waitForTimeout(800);
        console.log('offers', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ench-option')].map((o) => o.textContent))));
      }
      const info = await page.evaluate(() => ({ title: [...document.querySelectorAll('.gui .gtitle')].map((t) => t.textContent) }));
      console.log(name, JSON.stringify(info));
      await page.screenshot({ path: `${OUT}/station-${name}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    await browser.close();
    stopServer();
    process.exit(0);
  }
  if (process.env.TP) {
    // Optional sightseeing: teleport (needs CHEATS=1) and look around
    const [tx, ty, tz, yaw = '0', pitch = '0.3'] = process.env.TP.split(',');
    await page.evaluate((cmd) => window.minehonk.game.send({ t: 'chat', text: cmd }), `/tp ${tx} ${ty} ${tz}`);
    await page.waitForTimeout(1000);
    await page.evaluate(([y, p]) => {
      const g = window.minehonk.game;
      g.player.yaw = Number(y);
      g.player.pitch = Number(p);
      if (g.player.abilities.mayFly) g.player.flying = true;
    }, [yaw, pitch]);
    await page.waitForFunction(() => window.minehonk.game.renderer.chunks.stats().dirty < 30, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/03b-teleport.png` });
    if (process.env.TP_ONLY) {
      await browser.close();
      stopServer();
      process.exit(0);
    }
  }
  // Walk forward and look around
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.player.pitch = 0.5;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-walk.png` });
  const info = await page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    return { pos: [b.x, b.y, b.z], chunks: g.world.chunks.size, fps: g.fps, entities: g.entities.size, health: g.stats.health, maxHealth: g.stats.maxHealth, mode: g.player.gamemode, target: g.interaction.target };
  });
  console.log('state', JSON.stringify(info));
  // Horizon view
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.player.yaw = Math.PI * 0.75;
    g.player.pitch = -0.15;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04b-horizon.png` });
  // Mine the block underfoot with a simulated held left mouse button
  const mined = await page.evaluate(async () => {
    const app = window.minehonk;
    const g = app.game;
    app.input.locked = true;
    // Look at the ground just in front (not under our feet, so we can place it back)
    g.player.yaw = 0;
    g.player.pitch = 0.95;
    const canvas = document.getElementById('game-canvas');
    const count = () => g.invSlots.reduce((a, s) => a + (s ? s.count : 0), 0);
    const attempts = [];
    // Some surface blocks (snow layers, grass plants) drop nothing by hand: keep digging
    for (let attempt = 0; attempt < 4 && count() === 0; attempt++) {
      await new Promise((r) => setTimeout(r, 300));
      const t = g.interaction.target;
      if (!t) return { error: 'no target', attempts };
      const before = g.world.getState(t.x, t.y, t.z);
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      const t0 = performance.now();
      while (performance.now() - t0 < 8000 && g.world.getState(t.x, t.y, t.z) !== 0) await new Promise((r) => setTimeout(r, 100));
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      const brokeIn = Math.round(performance.now() - t0);
      const t1 = performance.now();
      while (performance.now() - t1 < 3000 && count() === 0) await new Promise((r) => setTimeout(r, 100));
      attempts.push({ before, after: g.world.getState(t.x, t.y, t.z), brokeIn });
    }
    return { attempts, after: 0, items: g.invSlots.map((s, i) => (s ? [i, s.id, s.count] : null)).filter(Boolean) };
  });
  console.log('mined', JSON.stringify(mined));
  if (mined.error || mined.after !== 0 || mined.items.length === 0) throw new Error('mining failed: ' + JSON.stringify(mined));
  // Place it back: select the slot holding the item and right click the block below
  const placed = await page.evaluate(async () => {
    const g = window.minehonk.game;
    const slot = g.invSlots.findIndex((s, i) => s && i >= 36 && i <= 44);
    if (slot < 0) return { error: 'item not in hotbar' };
    g.selected = slot - 36;
    g.send({ t: 'hotbar', slot: slot - 36 });
    await new Promise((r) => setTimeout(r, 400));
    const t = g.interaction.target;
    if (!t) return { error: 'no target to place on' };
    const canvas = document.getElementById('game-canvas');
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    await new Promise((r) => setTimeout(r, 1500));
    const count = g.invSlots.reduce((a, s) => a + (s ? s.count : 0), 0);
    return { target: [t.x, t.y, t.z, t.face], count };
  });
  console.log('placed', JSON.stringify(placed));
  if (placed.error || placed.count !== 0) throw new Error('placing failed: ' + JSON.stringify(placed));
  // Open inventory
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-inventory.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Debug screen
  await page.keyboard.press('F3');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-debug.png` });
  await page.keyboard.press('F3');
  // Pause and quit
  await page.evaluate(() => window.minehonk.openPause());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-pause.png` });
  await page.getByText('Save and Quit to Title').click();
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.getByText('Singleplayer').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/08-worlds.png` });
} catch (e) {
  failed = true;
  console.error('E2E FAILED:', e);
} finally {
  await browser.close();
  stopServer();
}
const serious = errors.filter((e) => !/favicon|AudioContext/.test(e));
if (serious.length) {
  console.error('Console errors:\n' + serious.join('\n'));
  failed = true;
}
console.log(failed ? 'E2E: FAIL' : 'E2E: PASS');
process.exit(failed ? 1 : 0);
