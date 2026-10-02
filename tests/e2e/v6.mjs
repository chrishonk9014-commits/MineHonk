/**
 * V6 browser check (Phase 1, the End Expansion): a cheats world, the
 * Expansion Portal on the main End island (dormant, then alive once the
 * Ender Dragon is defeated from the Admin Panel), a walk through it into the
 * Expanded End, and one look at each of its seven biomes by Admin Panel
 * teleport (sky, fog, F3 biome line). Screenshots go to tests/e2e/out/v6-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4186;
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
page.on('pageerror', (e) => {
  errors.push(String(e));
  console.log('[pageerror]', e);
});
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.type(), m.text().slice(0, 300));
});

await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = 8));
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill('v6-e2e');
const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
if ((await cheatsOff.count()) > 0) await cheatsOff.click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
await page.waitForFunction(() => {
  const l = document.querySelector('.loading');
  return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
}, null, { timeout: 180000 });
const cmd = async (t) => {
  await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t);
  await page.waitForTimeout(800);
};
const admin = (op, extra = {}) => page.evaluate(([op, extra]) => window.minehonk.game.adminRequest({ a: 'v6', op, ...extra }), [op, extra]);
/** Admin teleports answer twice: "preparing" (progress), then the landing. */
const adminTp = (op, extra = {}) => admin(op, extra);
const waitChunks = async () => {
  await page.waitForFunction(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    return !g.player.frozen && g.world.isLoaded(b.x, b.z);
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
};
const look = (yaw, pitch) => page.evaluate(([yaw, pitch]) => {
  const pl = window.minehonk.game.player;
  pl.yaw = yaw;
  pl.pitch = pitch;
}, [yaw, pitch]);
await cmd('/gamemode creative');

// The main island: the Expansion Portal, dormant
const tp = await adminTp('tp_portal');
check('teleported to the Expansion Portal', tp.ok);
await waitChunks();
await page.waitForTimeout(3000);
let st = (await admin('status')).data;
check('portal built on the main island', !!st?.portal?.built);
check('portal dormant before the dragon is defeated', st?.portal && !st.portal.active);
// Look at it (it stands three blocks to +z of the landing spot)
await look(Math.PI, -0.3);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/v6-portal-dormant.png` });

// Force the dragon: wait for it, then defeat it from the panel
await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'ender_dragon'), null, { timeout: 60000 });
const dd = await admin('defeat_dragon');
check('dragon defeated', dd.ok);
await page.waitForTimeout(13000);
st = (await admin('status')).data;
check('portal alive after the dragon', st?.portal?.active && st?.dragonDefeated);
await look(Math.PI, -0.3);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/v6-portal-alive.png` });

// Walk through it
// (the frame's bottom row is a step up: jump into the opening)
await look(Math.PI, 0.1);
await page.keyboard.down('KeyW');
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
}
await page.keyboard.up('KeyW');
await page.waitForFunction(() => {
  const b = window.minehonk.game.player.body;
  return Math.hypot(b.x, b.z) > 6000;
}, null, { timeout: 30000 }).catch(() => {});
const there = await page.evaluate(() => {
  const g = window.minehonk.game;
  const b = g.player.body;
  return { dim: g.dimension, d: Math.hypot(b.x, b.z) };
});
check('went through the portal (still in the End)', there.dim === 'end' && there.d > 6000);
await waitChunks();
await page.waitForTimeout(4000);
await look(0, 0.1);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/v6-arrival.png` });

// Each biome, by Admin Panel teleport
const biomes = (await admin('status')).data?.biomes ?? [];
check('seven biomes listed', biomes.length === 7);
await page.keyboard.press('F3');
for (const b of biomes) {
  const r = await adminTp('tp_biome', { biome: b.id });
  check(`teleported to ${b.name}`, r.ok);
  await waitChunks();
  // Rise a little above the ground (creative flight), let the sky and fog blend in, then face the most open direction
  await page.evaluate(() => {
    const g = window.minehonk.game;
    g.player.flying = true;
    g.player.body.y += 8;
  });
  await page.waitForTimeout(6000);
  const yaw = await page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    let best = 0;
    let bestOpen = -1;
    for (let i = 0; i < 8; i++) {
      const yaw = (i / 8) * Math.PI * 2;
      let open = 0;
      for (let d = 1; d <= 24; d++) {
        const x = Math.floor(b.x - Math.sin(yaw) * d);
        const z = Math.floor(b.z - Math.cos(yaw) * d);
        if (g.world.getState(x, Math.floor(b.y + 1.6), z) !== 0) break;
        open++;
      }
      if (open > bestOpen) {
        bestOpen = open;
        best = yaw;
      }
    }
    return best;
  });
  await look(yaw, 0.18);
  await page.waitForTimeout(1500);
  const here = await page.evaluate(() => window.minehonk.game.endAtmos.dominant?.id ?? null);
  check(`${b.name}: the client sees the biome`, here === b.id);
  const f3 = await page.locator('body').innerText();
  check(`${b.name}: F3 shows its name`, f3.includes(`Expanded End: ${b.name}`));
  await page.screenshot({ path: `${OUT}/v6-biome-${b.id}.png` });
}
await page.keyboard.press('F3');
check('no page errors', errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `V6 E2E: FAIL (${failed.map(([n]) => n).join(', ')})` : 'V6 E2E: PASS');
process.exit(failed.length ? 1 : 0);
