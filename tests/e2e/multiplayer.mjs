/**
 * Multiplayer end-to-end test: runs the real hub server (serving the built
 * client), then two independent browser profiles create accounts; one
 * creates an online world, the other joins it with the join code, and they
 * chat. Requires `npx vite build && npm run build:server` first.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 18765;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minehonk-mp-'));
if (!fs.existsSync('dist-server/server.mjs') || !fs.existsSync('dist/index.html')) {
  console.error('Build first: npx vite build && npm run build:server');
  process.exit(1);
}

const hub = spawn('node', ['dist-server/server.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, STATIC_DIR: 'dist', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const hubLog = [];
hub.stdout.on('data', (d) => hubLog.push(String(d)));
hub.stderr.on('data', (d) => hubLog.push(String(d)));
const stop = () => {
  try {
    process.kill(-hub.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
};
process.on('exit', stop);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('hub did not start')), 20000);
  hub.stdout.on('data', (d) => {
    if (String(d).includes('listening')) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
const url = `http://127.0.0.1:${PORT}/`;

async function openPlayer(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${label} pageerror]`, e));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${label} error] ${m.text()}`);
  });
  await page.goto(url);
  await page.getByText('Multiplayer').waitFor({ timeout: 30000 });
  return page;
}

const screen = (page) => page.locator('.screen:not(.hidden)').last();

async function createAccount(page, name, password) {
  await page.getByText('Multiplayer').click();
  await screen(page).getByRole('button', { name: 'Create Account' }).first().click();
  await screen(page).locator('input[placeholder="Player name"]').fill(name);
  await screen(page).locator('input[placeholder="Password"]').fill(password);
  await screen(page).locator('input[placeholder="Repeat password"]').fill(password);
  await screen(page).locator('button', { hasText: 'Create Account' }).last().click();
  await page.getByText(`Signed in as ${name}`).waitFor({ timeout: 15000 });
}

async function waitInGame(page) {
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 120000 });
}

try {
  const alice = await openPlayer('alice');
  const bob = await openPlayer('bob');
  await createAccount(alice, 'AliceMH', 'alice password 1');
  await createAccount(bob, 'BobMH', 'bob password 22');
  await alice.screenshot({ path: `${OUT}/mp-01-lobby.png` });

  // Alice creates a world
  await screen(alice).getByRole('button', { name: 'Create World' }).click();
  await screen(alice).locator('input[placeholder="World name"]').fill('Honk Town');
  await screen(alice).locator('input[placeholder="Seed (optional)"]').fill('e2e-seed');
  await alice.screenshot({ path: `${OUT}/mp-02-create.png` });
  await screen(alice).getByRole('button', { name: 'Create', exact: true }).click();
  await alice.getByText('Join code:').waitFor({ timeout: 20000 });
  const text = await screen(alice).innerText();
  const code = /([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(text)?.[1];
  if (!code) throw new Error('no join code shown: ' + text);
  console.log('join code', code);
  await screen(alice).getByRole('button', { name: 'Back' }).click();
  await alice.getByText('Honk Town').first().waitFor();
  await alice.screenshot({ path: `${OUT}/mp-03-worlds.png` });
  await screen(alice).getByRole('button', { name: 'Join World' }).click();
  await waitInGame(alice);
  console.log('alice in game');

  // Bob joins with the code
  await screen(bob).getByRole('button', { name: 'Join by Code' }).click();
  await screen(bob).locator('input[placeholder="ABC7-92KD"]').fill(code.toLowerCase().replace('-', ''));
  await screen(bob).getByRole('button', { name: 'Join', exact: true }).click();
  await waitInGame(bob);
  console.log('bob in game');

  // Both see each other and can chat
  await alice.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'player'), null, { timeout: 30000 });
  await bob.evaluate(() => window.minehonk.game.send({ t: 'chat', text: 'hello honk town' }));
  await alice.getByText('hello honk town').waitFor({ timeout: 10000 });
  await alice.waitForTimeout(1500);
  await alice.screenshot({ path: `${OUT}/mp-04-alice.png` });
  // Bob steps back and turns around to look at Alice
  await bob.mouse.click(640, 360);
  await bob.keyboard.down('s');
  await bob.waitForTimeout(900);
  await bob.keyboard.up('s');
  await bob.evaluate(() => {
    const g = window.minehonk.game;
    const other = [...g.entities.values()].find((e) => e.type === 'player');
    if (other) {
      const dx = other.x - g.player.body.x;
      const dz = other.z - g.player.body.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = 0.1;
    }
  });
  await bob.waitForTimeout(1500);
  await bob.screenshot({ path: `${OUT}/mp-05-bob.png` });
  // Bob is not an operator: no join code for him
  const bobInfo = await bob.evaluate(() => window.minehonk.game.worldInfo);
  if (bobInfo.joinCode) throw new Error('join code leaked to a non-operator');
  console.log('roles', JSON.stringify({ bob: bobInfo.role }));
  console.log('MP E2E: PASS');
} catch (e) {
  failed = true;
  console.error('MP E2E: FAIL', e);
  console.error(hubLog.join('').slice(-3000));
} finally {
  await browser.close();
  stop();
  process.exit(failed ? 1 : 0);
}
