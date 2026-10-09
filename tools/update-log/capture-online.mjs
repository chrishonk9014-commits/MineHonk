/**
 * Screenshots of browser multiplayer for the Update Log: signing in, the
 * Host tab and its settings, a friend's JOIN button, two players in one
 * world, the hosting panel, joining by code and the public list. Runs the
 * cloud hub locally under Wrangler, like tests/e2e/online.mjs.
 *
 *   node tools/update-log/capture-online.mjs   (then tools/update-log/build-images.mjs)
 *
 * Writes tests/e2e/out/clean/ul-mp-*.png.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const HUB_PORT = 8787;
const WEB_PORT = 4189;
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const OUT = path.resolve('tests/e2e/out/clean');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync('dist-online/index.html') || process.env.REBUILD) {
  console.log('building dist-online...');
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-online'], { stdio: 'ignore', env: { ...process.env, VITE_HUB_URL: HUB } });
  execFileSync('git', ['checkout', 'public/assets/minehonk-pixel.otf'], { stdio: 'ignore' });
}
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-ul-'));
const wrangler = path.resolve('node_modules/.bin/wrangler');
execFileSync(wrangler, ['d1', 'migrations', 'apply', 'minehonk-hub', '--local', '--persist-to', persist], { cwd: 'hub', stdio: 'ignore', env: { ...process.env, CI: '1' } });
const children = [];
const start = (cmd, args, opts) => {
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  children.push(c);
  return c;
};
start(wrangler, ['dev', '--port', String(HUB_PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--var', 'DEV:1', '--var', 'STUN_URLS:none'], { cwd: 'hub', env: { ...process.env, CI: '1' } });
const web = start('npx', ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--outDir', 'dist-online']);
process.on('exit', () => {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {}
  }
  fs.rmSync(persist, { recursive: true, force: true });
});
for (let i = 0; i < 200; i++) {
  try {
    if ((await fetch(`${HUB}/api/health`)).ok) break;
  } catch {}
  await wait(500);
}
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes(String(WEB_PORT)) && r()));

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, String(e).slice(0, 300)));
  await page.goto(`${WEB}/`);
  await page.getByText('Multiplayer', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => {
    window.minehonk.settings.renderDistance = 6;
    window.minehonk.settings.maxFps = 15;
  });
  return { name, page };
}
const top = (p) => p.page.locator('.screens > .screen:not(.hidden)').last();
const click = async (p, text) => {
  await top(p).locator('button', { hasText: text }).first().click();
  await p.page.waitForTimeout(200);
};
const tabTo = async (p, t) => {
  await top(p).locator(`.online-chip[data-tab="${t}"]`).click();
  await p.page.waitForTimeout(400);
};
async function cycleTo(scr, label, want) {
  const b = scr.locator('button', { hasText: `${label}:` }).first();
  for (let i = 0; i < 8; i++) {
    if ((await b.textContent()).includes(want)) return;
    await b.click();
  }
  throw new Error(`${label} never showed ${want}`);
}
const shot = async (p, name, opts = {}) => {
  await p.page.waitForTimeout(opts.settle ?? 600);
  await p.page.screenshot({ path: path.join(OUT, `ul-mp-${name}.png`) });
  console.log('shot', name);
};
const inGame = (p) => p.page.waitForFunction(() => window.minehonk.game?.joined && !document.querySelector('.loading:not(.hidden)'), null, { timeout: 180000 });
const until = async (fn, ms = 20000, step = 500) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await wait(step);
  }
};

async function signUp(p, screenshot) {
  await p.page.getByText('Multiplayer', { exact: true }).click();
  await top(p).locator('button', { hasText: 'Create Account' }).first().waitFor({ timeout: 30000 });
  if (screenshot) await shot(p, 'signin');
  await click(p, 'Create Account');
  await top(p).locator('input[placeholder="Player name"]').fill(p.name);
  await top(p).locator('input[placeholder="Password"]').fill('correct horse battery');
  await top(p).locator('input[placeholder="Repeat password"]').fill('correct horse battery');
  await top(p).locator('button', { hasText: 'Create Account' }).last().click();
  await top(p).locator('.online-chip').first().waitFor({ timeout: 30000 });
}

const host = await player('Honk');
const friend = await player('Pip');
const stranger = await player('Wren');

// Accounts, made on the website
await signUp(host, true);
await signUp(friend);
await signUp(stranger);

// Friends
await tabTo(host, 'friends');
await top(host).locator('input[placeholder="Player name"]').fill('Pip');
await click(host, 'Add Friend');
await tabTo(friend, 'friends');
await top(friend).locator('.list-item', { hasText: 'Honk' }).locator('button', { hasText: 'Accept' }).click();
await friend.page.waitForTimeout(800);

// The Host tab and a new world's settings
await tabTo(host, 'host');
await shot(host, 'host-tab');
await click(host, 'Create New World');
const form = top(host);
await form.locator('input[placeholder="World name"]').fill('Honk Island');
await cycleTo(form, 'Visibility', 'Friends');
await cycleTo(form, 'Allow Cheats', 'ON');
await shot(host, 'host-form');
await click(host, 'Start Hosting');
await host.page.waitForFunction(() => window.minehonk.game?.joined && window.minehonk.hostSession?.details?.joinCode, null, { timeout: 180000 });
await inGame(host);
const code = await host.page.evaluate(() => window.minehonk.hostSession.details.joinCode);

// The friend sees where the host is, with JOIN
await until(async () => {
  await tabTo(friend, 'friends');
  const row = top(friend).locator('.friend-row', { hasText: 'Honk' });
  return (await row.count()) && (await row.locator('.join-btn').count()) > 0;
});
await shot(friend, 'friends-join');
await top(friend).locator('.friend-row', { hasText: 'Honk' }).locator('.join-btn').click();
await inGame(friend);

// Two players in one world: the friend steps back and looks at the host
await friend.page.waitForTimeout(3000);
await friend.page.keyboard.down('KeyS');
await friend.page.waitForTimeout(900);
await friend.page.keyboard.up('KeyS');
await friend.page.waitForTimeout(800);
await host.page.evaluate(() => window.minehonk.game.send({ t: 'chat', text: 'Welcome to Honk Island!' }));
await friend.page.evaluate(() => {
  const g = window.minehonk.game;
  const me = g.player.body;
  const other = [...g.entities.values()].find((e) => e.type === 'player');
  if (other) {
    g.player.yaw = Math.atan2(other.x - me.x, other.z - me.z);
    g.player.pitch = 0.15;
  }
  g.hudHidden = true;
});
await shot(friend, 'together', { settle: 2500 });

// The hosting panel: the join code, who is playing, and the owner's tools
await host.page.evaluate(() => window.minehonk.openPause());
await click(host, 'Hosting...');
await top(host).locator('.join-code').waitFor({ timeout: 10000 });
await shot(host, 'hosting-panel');
// Public, for the list
await click(host, 'Settings...');
await cycleTo(top(host), 'Visibility', 'Public');
await click(host, 'Save');
await top(host).locator('.join-code').waitFor({ timeout: 10000 });
await host.page.evaluate(() => window.minehonk.closeScreens());

// Joining by code
await tabTo(stranger, 'join');
await top(stranger).locator('input[placeholder^="Join code"]').fill(code);
await shot(stranger, 'join-code');

// The public list
await tabTo(stranger, 'public');
await until(async () => {
  await click(stranger, 'Refresh');
  return (await top(stranger).locator('.public-world', { hasText: 'Honk Island' }).count()) > 0;
});
await shot(stranger, 'public');

await browser.close();
console.log('done');
process.exit(0);
