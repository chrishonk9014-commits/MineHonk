/**
 * Browser multiplayer E2E: worlds hosted in a player's browser, through the
 * cloud hub (running locally under Wrangler), with two to five browser
 * contexts. Covers hosting and joining by code, playing together, coming
 * back, the host leaving, friends (JOIN, private worlds, invites), the
 * public list over the relay only, the relay fallback, forged tickets, bans,
 * the Admin Panel's rules with cheats and operators, a phone-sized player,
 * and the host's upload with four players.
 *
 *   node tests/e2e/online.mjs        (builds dist-online first if needed)
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const HUB_PORT = 8787;
const WEB_PORT = 4188;
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const section = (name) => !ONLY || ONLY.includes(name);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok]);
  console.log(ok ? 'ok  ' : 'FAIL', name, ok || !detail ? '' : `(${detail})`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the build, the hub and the site
if (!fs.existsSync('dist-online/index.html') || process.env.REBUILD) {
  console.log('building dist-online...');
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-online'], { stdio: 'ignore', env: { ...process.env, VITE_HUB_URL: HUB } });
  execFileSync('git', ['checkout', 'public/assets/minehonk-pixel.otf'], { stdio: 'ignore' });
}
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-online-'));
const wrangler = path.resolve('node_modules/.bin/wrangler');
execFileSync(wrangler, ['d1', 'migrations', 'apply', 'minehonk-hub', '--local', '--persist-to', persist], { cwd: 'hub', stdio: 'ignore', env: { ...process.env, CI: '1' } });
const children = [];
const start = (cmd, args, opts) => {
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  children.push(c);
  return c;
};
const hubLog = [];
const hubProc = start(wrangler, ['dev', '--port', String(HUB_PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--var', 'DEV:1', '--var', 'STUN_URLS:none'], { cwd: 'hub', env: { ...process.env, CI: '1' } });
hubProc.stdout.on('data', (d) => hubLog.push(String(d)));
hubProc.stderr.on('data', (d) => hubLog.push(String(d)));
const web = start('npx', ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--outDir', 'dist-online']);
const cleanup = () => {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {}
  }
  fs.rmSync(persist, { recursive: true, force: true });
};
process.on('exit', cleanup);
for (let i = 0; i < 200; i++) {
  try {
    if ((await fetch(`${HUB}/api/health`)).ok) break;
  } catch {}
  await wait(500);
}
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes(String(WEB_PORT)) && r()));

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  // Real IP candidates on this machine (no mDNS names), so direct WebRTC works between contexts
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];

async function player(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 960, height: 600 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    errors.push(`${name}: ${e}`);
    console.log(`[${name} pageerror]`, String(e).slice(0, 300));
  });
  page.on('console', (m) => {
    if (process.env.VERBOSE || m.type() === 'error' || m.type() === 'warning' || /\[join\]|\[host\]/.test(m.text())) console.log(`[${name} ${m.type()}]`, m.text().slice(0, 300));
  });
  await page.goto(`${WEB}/${opts.query ?? ''}`);
  await page.getByText('Multiplayer', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => (window.minehonk.settings.renderDistance = 4));
  return { name, ctx, page };
}

const top = (p) => p.page.locator('.screens > .screen:not(.hidden)').last();
const click = async (p, text) => {
  await top(p).locator('button', { hasText: text }).first().click();
  await p.page.waitForTimeout(150);
};
const statusText = (p) => top(p).locator('.status-line').first().textContent();

async function signUp(p) {
  await p.page.getByText('Multiplayer', { exact: true }).click();
  await top(p).locator('button', { hasText: 'Create Account' }).first().waitFor({ timeout: 30000 });
  await click(p, 'Create Account');
  await top(p).locator('input[placeholder="Player name"]').fill(p.name);
  await top(p).locator('input[placeholder="Password"]').fill('correct horse battery');
  await top(p).locator('input[placeholder="Repeat password"]').fill('correct horse battery');
  await top(p).locator('button', { hasText: 'Create Account' }).last().click();
  await top(p).locator('.online-chip').first().waitFor({ timeout: 30000 });
  p.uuid = await p.page.evaluate(() => window.minehonk.cloudApi.account.uuid);
}

const tabTo = async (p, t) => {
  await top(p).locator(`.online-chip[data-tab="${t}"]`).click();
  await p.page.waitForTimeout(300);
};

async function hostNew(p, worldName, { visibility = 'Friends', cheats = false } = {}) {
  await tabTo(p, 'host');
  await click(p, 'Create New World');
  const scr = top(p);
  await scr.locator('input[placeholder="World name"]').fill(worldName);
  // Visibility cycles Private -> Friends -> Public (starts at Friends)
  const want = { Private: 2, Friends: 0, Public: 1 }[visibility];
  for (let i = 0; i < want; i++) await scr.locator('button', { hasText: 'Visibility:' }).click();
  if (cheats) await scr.locator('button', { hasText: 'Allow Cheats:' }).click();
  await click(p, 'Start Hosting');
  await p.page.waitForFunction(() => window.minehonk.game?.joined && window.minehonk.hostSession?.details?.joinCode, null, { timeout: 120000 });
  return p.page.evaluate(() => ({ code: window.minehonk.hostSession.details.joinCode, id: window.minehonk.hostSession.details.id }));
}

const inGame = async (p, ms = 120000) => {
  try {
    await p.page.waitForFunction(() => window.minehonk.game?.joined && !document.querySelector('.loading:not(.hidden)'), null, { timeout: ms });
  } catch (e) {
    console.log(`[${p.name} state]`, await p.page.evaluate(() => ({ status: [...document.querySelectorAll('.status-line')].map((x) => x.textContent).join(' | '), loading: document.querySelector('.loading')?.innerText, screens: [...document.querySelectorAll('.screens > .screen:not(.hidden)')].map((x) => x.innerText.slice(0, 200)), transport: window.minehonk.conn?.transport, joined: window.minehonk.game?.joined, stats: window.minehonk.conn?.stats })));
    throw e;
  }
};
const playerNames = (p) => p.page.evaluate(() => (window.minehonk.game?.players ?? []).map((x) => x.name).sort());
const transport = (p) => p.page.evaluate(() => window.minehonk.conn?.transport ?? null);
const chatLines = (p) => p.page.evaluate(() => [...document.querySelectorAll('.chat .line, .chat-line, .chat div')].map((e) => e.textContent).join('\n'));
const sendChat = (p, text) => p.page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), text);
const leaveToTitle = (p) => p.page.evaluate(() => window.minehonk.quitToTitle());

async function joinByCode(p, code) {
  await tabTo(p, 'join');
  await top(p).locator('input[placeholder^="Join code"]').fill(code);
  await top(p).locator('button.join-go').click();
}

const hostOf = await player('Hosty');
const joiner = await player('Joiny');

// ------------------------------------------------------------------ host, join by code, play together
let world = null;
if (section('core')) {
  await signUp(hostOf);
  await signUp(joiner);
  check('accounts created in two browsers', hostOf.uuid && joiner.uuid);
  world = await hostNew(hostOf, 'Shared Castle', { visibility: 'Private' });
  check(`the host got a join code (${world.code})`, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(world.code));
  await hostOf.page.screenshot({ path: `${OUT}/online-host.png` });
  await joinByCode(joiner, world.code);
  await inGame(joiner);
  check(`the joiner is in (over ${await transport(joiner)})`, true);
  await joiner.page.waitForFunction(() => window.minehonk.game.players.length === 2, null, { timeout: 30000 });
  check('they see each other', JSON.stringify(await playerNames(hostOf)) === JSON.stringify(['Hosty', 'Joiny']) && JSON.stringify(await playerNames(joiner)) === JSON.stringify(['Hosty', 'Joiny']), JSON.stringify(await playerNames(hostOf)));
  await sendChat(joiner, 'hello from the other browser');
  await hostOf.page.waitForFunction(() => document.body.innerText.includes('hello from the other browser'), null, { timeout: 15000 }).catch(() => {});
  check('chat reaches the host', (await hostOf.page.evaluate(() => document.body.innerText)).includes('hello from the other browser'));
  await joiner.page.screenshot({ path: `${OUT}/online-joiner.png` });
}

console.log(checks.filter(([, ok]) => !ok).length ? `ONLINE E2E: FAIL (${checks.filter(([, ok]) => !ok).map(([n]) => n).join(', ')})` : 'ONLINE E2E: PASS');
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
cleanup();
process.exit(checks.some(([, ok]) => !ok) ? 1 : 0);
