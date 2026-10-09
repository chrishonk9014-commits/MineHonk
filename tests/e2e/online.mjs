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

// Counts the WebRTC connections a page makes; `breakRtc` makes every one of them fail
// (no candidates at all), the way a strict network would
function rtcProbe({ breakRtc }) {
  const P = window.RTCPeerConnection;
  window.__pcCount = 0;
  window.RTCPeerConnection = class extends P {
    constructor(cfg = {}) {
      super(breakRtc ? { ...cfg, iceServers: [], iceTransportPolicy: 'relay' } : cfg);
      window.__pcCount++;
    }
  };
}

async function openPage(p) {
  if (p.page && !p.page.isClosed()) await p.page.close();
  const page = await p.ctx.newPage();
  page.on('pageerror', (e) => {
    errors.push(`${p.name}: ${e}`);
    console.log(`[${p.name} pageerror]`, String(e).slice(0, 300));
  });
  page.on('console', (m) => {
    if (process.env.VERBOSE || m.type() === 'error' || m.type() === 'warning' || /\[join\]|\[host\]|\[lobby\]|anticheat/.test(m.text())) console.log(`[${p.name} ${m.type()}]`, m.text().slice(0, 300));
  });
  await page.goto(`${WEB}/${p.opts.query ?? ''}`);
  await page.getByText('Multiplayer', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => {
    window.minehonk.settings.renderDistance = 4;
    // Five software-rendered browsers share a few cores: draw less often (the game still ticks 20 times a second)
    window.minehonk.settings.maxFps = 10;
    // Counts what each game receives, by message type (shown when something hangs)
    const app = window.minehonk;
    const start = app.startGame.bind(app);
    window.__msgCounts = {};
    app.startGame = (conn) => {
      start(conn);
      const h = conn.onMessage;
      conn.onMessage = (m) => {
        window.__msgCounts[m.t] = (window.__msgCounts[m.t] ?? 0) + 1;
        h(m);
      };
    };
  });
  p.page = page;
}

async function player(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 960, height: 600 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
  await ctx.addInitScript(rtcProbe, { breakRtc: !!opts.breakRtc });
  const p = { name, ctx, opts, page: null };
  await openPage(p);
  return p;
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

/** Clicks a cycling button ("Label: value") until it shows the wanted value. */
async function cycleTo(scr, label, want) {
  const b = scr.locator('button', { hasText: `${label}:` }).first();
  for (let i = 0; i < 6; i++) {
    if ((await b.textContent()).includes(want)) return;
    await b.click();
  }
  throw new Error(`${label} never showed ${want}`);
}

async function fillHostForm(scr, o) {
  if (o.visibility) await cycleTo(scr, 'Visibility', o.visibility);
  if (o.cheats !== undefined) await cycleTo(scr, 'Allow Cheats', o.cheats ? 'ON' : 'OFF');
  if (o.joiners) await cycleTo(scr, 'Joiners', o.joiners);
}

async function hostNew(p, worldName, o = {}) {
  await tabTo(p, 'host');
  await click(p, 'Create New World');
  const scr = top(p);
  await scr.locator('input[placeholder="World name"]').fill(worldName);
  await fillHostForm(scr, { visibility: 'Friends', cheats: false, ...o });
  await click(p, 'Start Hosting');
  await p.page.waitForFunction(() => window.minehonk.game?.joined && window.minehonk.hostSession?.details?.joinCode, null, { timeout: 120000 });
  return p.page.evaluate(() => ({ code: window.minehonk.hostSession.details.joinCode, id: window.minehonk.hostSession.details.id }));
}

const inGame = async (p, ms = 120000) => {
  try {
    await p.page.waitForFunction(() => window.minehonk.game?.joined && !document.querySelector('.loading:not(.hidden)'), null, { timeout: ms });
  } catch (e) {
    console.log(`[${p.name} state]`, await p.page.evaluate(() => ({ status: [...document.querySelectorAll('.status-line')].map((x) => x.textContent).join(' | '), loading: document.querySelector('.loading')?.innerText, screens: [...document.querySelectorAll('.screens > .screen:not(.hidden)')].map((x) => x.innerText.slice(0, 200)), transport: window.minehonk.conn?.transport, joined: window.minehonk.game?.joined, stats: window.minehonk.conn?.stats, counts: window.__msgCounts, pos: window.minehonk.game && [window.minehonk.game.player.body.x, window.minehonk.game.player.body.y, window.minehonk.game.player.body.z], frozen: window.minehonk.game?.player.frozen, chunks: window.minehonk.game?.world.chunks?.size, renderDistance: window.minehonk.settings.renderDistance })));
    throw e;
  }
};
const playerNames = (p) => p.page.evaluate(() => (window.minehonk.game?.players ?? []).map((x) => x.name).sort());
const transport = (p) => p.page.evaluate(() => window.minehonk.conn?.transport ?? null);
const chatLines = (p) => p.page.evaluate(() => [...document.querySelectorAll('.chat .line')].map((e) => e.textContent).join('\n'));
const sendChat = (p, text) => p.page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), text);
const leaveToTitle = (p) => p.page.evaluate(() => window.minehonk.quitToTitle());
const adminAs = (p, action) => p.page.evaluate((a) => window.minehonk.game.adminRequest(a), action);
const roleOf = (p, name) => p.page.evaluate((n) => window.minehonk.game.players.find((x) => x.name === n)?.role ?? null, name);
const stateAt = (p, b) => p.page.evaluate(({ x, y, z }) => window.minehonk.game.world.getState(x, y, z), b);
const pcCount = (p) => p.page.evaluate(() => window.__pcCount);
const bodyText = (p) => p.page.evaluate(() => document.body.innerText);
const until = async (fn, ms = 15000, step = 250) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await wait(step);
  }
};
const compat = (p) => p.page.evaluate(() => window.minehonkNet.compatKey());
const ticketError = (p, id, c) => p.page.evaluate(([id, c]) => window.minehonk.cloudApi.ticket(id, c).then(() => 'ok', (e) => e.message), [id, c]);

async function joinByCode(p, code) {
  await tabTo(p, 'join');
  await top(p).locator('input[placeholder^="Join code"]').fill(code);
  await top(p).locator('button.join-go').click();
}

/** Title screen > Multiplayer, already signed in (the session is remembered). */
async function toOnline(p) {
  await p.page.getByText('Multiplayer', { exact: true }).click();
  await top(p).locator('.online-chip').first().waitFor({ timeout: 30000 });
}

/** Pause menu > Hosting... */
async function openPanel(p) {
  await p.page.evaluate(() => {
    const app = window.minehonk;
    if (app.game?.player.dead) app.game.respawn();
    app.closeScreens();
  });
  await p.page.waitForTimeout(300);
  await p.page.evaluate(() => window.minehonk.openPause());
  await click(p, 'Hosting...');
  await top(p).locator('.join-code').waitFor({ timeout: 10000 });
}
const closeMenus = (p) => p.page.evaluate(() => window.minehonk.closeScreens());

/** Hosting panel > Settings... > change > Save, back in game. */
async function changeHosting(p, o) {
  await openPanel(p);
  await click(p, 'Settings...');
  await fillHostForm(top(p), o);
  await click(p, 'Save');
  await top(p).locator('.join-code').waitFor({ timeout: 10000 });
  await closeMenus(p);
  await p.page.waitForTimeout(800);
}

async function panelAction(p, who, label, confirm = null) {
  await openPanel(p);
  await top(p).locator('.list-item', { hasText: who }).locator('button', { hasText: label }).click();
  if (confirm) await top(p).locator('button', { hasText: confirm }).last().click();
  await p.page.waitForTimeout(500);
  await closeMenus(p);
}

/** Walks `p` (holding W, jumping steps) until it is a few blocks from `from`; returns the distance. */
async function walkAway(p, from, ms = 12000) {
  const where = (q) => q.page.evaluate(() => {
    const b = window.minehonk.game.player.body;
    return [b.x, b.y, b.z, b.collidedH];
  });
  const t0 = Date.now();
  let turn = 0;
  await p.page.keyboard.down('KeyW');
  let d = 0;
  while (Date.now() - t0 < ms) {
    const [ax, , az] = await where(from);
    const [bx, , bz, blocked] = await where(p);
    d = Math.hypot(bx - ax, bz - az);
    if (d > 4) break;
    // Head away from the other player (turning a bit more each time we get stuck)
    await p.page.evaluate((yaw) => (window.minehonk.game.player.yaw = yaw), Math.atan2(-(bx - ax || 1), -(bz - az)) + turn);
    if (blocked) {
      await p.page.keyboard.press('Space');
      turn += 0.7;
    }
    await wait(250);
  }
  await p.page.keyboard.up('KeyW');
  await wait(600);
  return d;
}

const hostOf = await player('Hosty');
const joiner = await player('Joiny');

// ------------------------------------------------------------------ host, join by code, play together
let world = null;
if (section('core')) {
  await signUp(hostOf);
  await signUp(joiner);
  check('accounts created in two browsers', hostOf.uuid && joiner.uuid);
  world = await hostNew(hostOf, 'Shared Castle', { visibility: 'Private (code only)' });
  check(`the host got a join code (${world.code})`, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(world.code));
  await hostOf.page.screenshot({ path: `${OUT}/online-host.png` });
  await joinByCode(joiner, world.code);
  await inGame(joiner);
  check(`the joiner is in (over ${await transport(joiner)})`, (await transport(joiner)) === 'rtc');
  await joiner.page.waitForFunction(() => window.minehonk.game.players.length === 2, null, { timeout: 30000 });
  check('they see each other', JSON.stringify(await playerNames(hostOf)) === JSON.stringify(['Hosty', 'Joiny']) && JSON.stringify(await playerNames(joiner)) === JSON.stringify(['Hosty', 'Joiny']), JSON.stringify(await playerNames(hostOf)));
  const seen = await until(() => hostOf.page.evaluate((u) => [...window.minehonk.game.entities.values()].some((e) => e.type === 'player' && e.meta?.uuid === u) || [...window.minehonk.game.entities.values()].some((e) => e.type === 'player'), joiner.uuid), 15000);
  check('the host sees the joiner in the world', seen);
  await sendChat(joiner, 'hello from the other browser');
  await hostOf.page.waitForFunction(() => document.body.innerText.includes('hello from the other browser'), null, { timeout: 15000 }).catch(() => {});
  check('chat reaches the host', (await chatLines(hostOf)).includes('hello from the other browser'));
  await joiner.page.screenshot({ path: `${OUT}/online-joiner.png` });

  // ---- breaking and placing blocks (survival, a builder)
  // Both spawn on the same spot: walk away first, or the host picks up the drops
  const apart = await walkAway(joiner, hostOf);
  check(`the joiner walks away from the host (${apart.toFixed(1)} blocks)`, apart > 3);
  await joiner.page.waitForFunction(() => window.minehonk.game.player.body.onGround, null, { timeout: 30000 });
  // The full block the joiner stands on (at the edge of a dip, that is not the one under their centre)
  const under = await joiner.page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    const y = Math.round(b.y) - 1;
    const types = new Map([...window.minehonkRegistry.blockById.values()].map((t) => [t.num, t]));
    const cube = (x, z) => types.get(window.minehonkRegistry.blockOfState(g.world.getState(x, y, z)))?.def.model === 'cube';
    const cols = [[Math.floor(b.x), Math.floor(b.z)]];
    for (const dx of [-0.29, 0.29]) for (const dz of [-0.29, 0.29]) cols.push([Math.floor(b.x + dx), Math.floor(b.z + dz)]);
    const [x, z] = cols.find(([x, z]) => cube(x, z)) ?? cols[0];
    return { x, y, z };
  });
  // Start digging, hold, finish (a finish that comes too soon is refused, so wait longer each time)
  // Done when the block is gone: air, or water flowing in on a beach
  const dig = async (b) => {
    const was = await stateAt(hostOf, b);
    for (const hold of [800, 1600, 3200, 6400]) {
      await joiner.page.evaluate(({ x, y, z }) => window.minehonk.game.send({ t: 'dig', action: 'start', x, y, z, face: 1 }), b);
      await wait(hold);
      await joiner.page.evaluate(({ x, y, z }) => window.minehonk.game.send({ t: 'dig', action: 'finish', x, y, z, face: 1 }), b);
      if (await until(async () => (await stateAt(hostOf, b)) !== was, 1500)) return true;
    }
    return false;
  };
  // Plants (tall grass is two blocks high) or snow around the joiner are in the way, as they would be for the crosshair
  for (const dy of [2, 1]) {
    const b = { ...under, y: under.y + dy };
    if ((await stateAt(hostOf, b)) !== 0) await dig(b);
  }
  const before = await stateAt(hostOf, under);
  const broken = await dig(under);
  if (!broken) console.log('dig debug', JSON.stringify({ under, joiner: await joiner.page.evaluate(() => { const b = window.minehonk.game.player.body; return [b.x, b.y, b.z, b.onGround]; }), hostView: await hostOf.page.evaluate(() => [...window.minehonk.game.entities.values()].filter((e) => e.type === 'player').map((e) => [e.x, e.y, e.z])) }));
  check(`the joiner breaks a block and the host sees it go (state ${before})`, before !== 0 && broken);
  const hasItem = () => joiner.page.evaluate(() => window.minehonk.game.invSlots.some((s) => s && s.count > 0));
  let picked = await until(hasItem, 3000);
  // Standing on the edge of the hole: step towards the drop, as a player would
  for (let i = 0; i < 4 && !picked; i++) {
    await joiner.page.evaluate(() => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const item = [...g.entities.values()].filter((e) => e.type === 'item').sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
      if (item) g.player.yaw = Math.atan2(-(item.x - b.x), -(item.z - b.z));
    });
    await joiner.page.keyboard.down('KeyW');
    await wait(250);
    await joiner.page.keyboard.up('KeyW');
    picked = await until(hasItem, 2000);
  }
  if (!picked) console.log('pickup debug', JSON.stringify(await joiner.page.evaluate(() => { const g = window.minehonk.game; const b = g.player.body; return { body: [b.x, b.y, b.z, b.onGround], items: [...g.entities.values()].filter((e) => e.type === 'item').map((e) => [e.x, e.y, e.z]), gm: g.player.gamemode }; })));
  check('the joiner picks up what dropped', picked);

  // ---- the Admin Panel: owner's choice, operators only, announced
  const give = { a: 'give', item: 'diamond', count: 64 };
  let r = await adminAs(joiner, give);
  check('a builder gets no Admin Panel (cheats off)', !r.ok, r.text);
  await changeHosting(hostOf, { cheats: true });
  const cheatsOn = await until(() => joiner.page.evaluate(() => !!window.minehonk.game.worldInfo?.cheats), 10000);
  check('the owner turns cheats on while hosting, and the joiner sees it', cheatsOn);
  r = await adminAs(hostOf, { a: 'gamemode', mode: 'creative' });
  check('the owner uses the Admin Panel (creative for themselves)', r.ok, r.text);
  r = await adminAs(joiner, give);
  check('a builder still gets no Admin Panel with cheats on', !r.ok, r.text);
  await panelAction(hostOf, 'Joiny', 'Make Op');
  const opped = await until(async () => (await roleOf(hostOf, 'Joiny')) === 'operator', 10000);
  check('the owner makes the joiner an operator from the player list', opped);
  const achievements = () => joiner.page.evaluate(() => [...document.querySelectorAll('.chat .line')].filter((e) => /\[.*\]$/.test(e.textContent ?? '') && /has made the advancement|Advancement/.test(e.textContent ?? '')).length);
  const achBefore = await achievements();
  r = await adminAs(joiner, give);
  check('an operator uses the Admin Panel with cheats on', r.ok, r.text);
  const announced = await until(async () => (await chatLines(hostOf)).includes('[Admin] Joiny used: give diamond ×64'), 8000);
  check('admin actions are announced in chat', announced);
  await wait(1500);
  check('cheated diamonds earn no advancement', (await achievements()) === achBefore);

  // ---- fighting a mob together
  await adminAs(joiner, { a: 'give', item: 'diamond_sword', count: 1 });
  await adminAs(joiner, { a: 'time', value: 18000 });
  const zombiesBefore = await joiner.page.evaluate(() => [...window.minehonk.game.entities.values()].filter((e) => e.type === 'zombie').map((e) => e.id));
  r = await adminAs(joiner, { a: 'spawn', mob: 'zombie', count: 1 });
  check('the operator spawns a zombie', r.ok, r.text);
  const zombieId = await until(() => joiner.page.evaluate((old) => [...window.minehonk.game.entities.values()].find((e) => e.type === 'zombie' && !old.includes(e.id))?.id ?? null, zombiesBefore), 10000);
  await joiner.page.evaluate(() => {
    const g = window.minehonk.game;
    for (let i = 0; i < 9; i++) {
      g.selected = i;
      if (g.held()?.id === window.minehonkRegistry.itemById.get('diamond_sword').num) break;
    }
    g.send({ t: 'hotbar', slot: g.selected });
  });
  const hostSaw = await until(() => hostOf.page.evaluate((id) => window.minehonk.game.entities.has(id), zombieId), 10000);
  check('the host sees the zombie too', hostSaw);
  // Face the zombie, walk up to it (jumping steps), and hit it with the sword
  const fight = { killed: false, hits: 0, id: zombieId };
  let walking = false;
  const fightEnd = Date.now() + 60000;
  while (Date.now() < fightEnd) {
    const st = await joiner.page.evaluate((id) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const zs = [...g.entities.values()].filter((e) => e.type === 'zombie' && !e.dead);
      const z = id !== null ? zs.find((e) => e.id === id) : zs.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
      if (!z) return { gone: id !== null };
      const dx = z.x - b.x;
      const dz = z.z - b.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      const d = Math.hypot(dx, z.y - b.y, dz);
      if (d < 3.2) {
        g.send({ t: 'swing' });
        g.send({ t: 'attack', id: z.id });
      }
      return { id: z.id, d, hit: d < 3.2, blocked: b.collidedH };
    }, fight.id);
    if (st.gone) {
      fight.killed = true;
      break;
    }
    if (st.id) fight.id = st.id;
    if (st.hit) fight.hits++;
    const want = !st.hit && st.d > 2.2;
    if (want !== walking) {
      walking = want;
      await (want ? joiner.page.keyboard.down('KeyW') : joiner.page.keyboard.up('KeyW'));
    }
    if (walking && st.blocked) await joiner.page.keyboard.press('Space');
    await wait(650);
  }
  if (walking) await joiner.page.keyboard.up('KeyW');
  check(`the joiner fights the zombie and wins (${fight.hits} hits)`, fight.killed && fight.hits > 0, JSON.stringify(fight));
  await adminAs(joiner, { a: 'time', value: 1000 });
  // (others may have spawned at night: it is this one that must be gone)
  const goneForHost = await until(() => hostOf.page.evaluate((id) => !window.minehonk.game.entities.get(id) || window.minehonk.game.entities.get(id).dead, fight.id), 10000);
  check('the zombie is gone for the host too', goneForHost);

  // ---- announcements off, cheats off
  await openPanel(hostOf);
  await click(hostOf, 'Announce Admin Actions');
  await closeMenus(hostOf);
  await wait(1500);
  r = await adminAs(joiner, { a: 'give', item: 'dirt', count: 3 });
  await wait(1500);
  check('the owner can turn the announcements off', r.ok && !(await chatLines(hostOf)).includes('[Admin] Joiny used: give dirt'), r.text);
  // Building: dirt on top of the block beside the joiner (with no plants in the eyes)
  const here = await joiner.page.evaluate(() => {
    const b = window.minehonk.game.player.body;
    return { x: Math.floor(b.x), y: Math.round(b.y), z: Math.floor(b.z) };
  });
  for (const dy of [1, 0]) if ((await stateAt(hostOf, { ...here, y: here.y + dy })) !== 0) await dig({ ...here, y: here.y + dy });
  const placeAt = await joiner.page.evaluate(() => {
    const g = window.minehonk.game;
    const dirt = window.minehonkRegistry.itemById.get('dirt').num;
    for (let i = 0; i < 9; i++) {
      g.selected = i;
      if (g.held()?.id === dirt) break;
    }
    g.send({ t: 'hotbar', slot: g.selected });
    const b = g.player.body;
    const fy = Math.round(b.y);
    // On top of a neighbouring block at foot or head height, with room above it (a face the player can see)
    const near = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) near.push([dx, dz]);
    for (const dy of [-1, 0, -2, 1])
      for (const [dx, dz] of near) {
        const x = Math.floor(b.x) + dx;
        const z = Math.floor(b.z) + dz;
        const y = fy + dy;
        if (g.world.getState(x, y, z) !== 0 && g.world.getState(x, y + 1, z) === 0 && g.world.getState(x, y + 2, z) === 0) {
          g.send({ t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: g.player.yaw, pitch: g.player.pitch, seq: 1 });
          // On top, or in place of a replaceable block (snow, grass) that was clicked
          return { x, y: y + 1, z, base: y };
        }
      }
    return null;
  });
  const dirtState = await hostOf.page.evaluate(() => window.minehonkState('dirt'));
  const placed = placeAt && (await until(async () => (await stateAt(hostOf, placeAt)) !== 0 || (await stateAt(hostOf, { ...placeAt, y: placeAt.base })) === dirtState, 8000));
  if (!placed)
    console.log('place debug', JSON.stringify(await joiner.page.evaluate(() => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const x0 = Math.floor(b.x), y0 = Math.round(b.y), z0 = Math.floor(b.z);
      const rows = [];
      for (let dy = -2; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) rows.push(`${dy},${dz}: ` + [-1, 0, 1].map((dx) => g.world.getState(x0 + dx, y0 + dy, z0 + dz)).join(' '));
      return { body: [b.x, b.y, b.z, b.onGround, b.inWater], held: g.held(), rows };
    })));
  check('the joiner places a block and the host sees it', placed, JSON.stringify(placeAt));
  await changeHosting(hostOf, { cheats: false });
  await until(() => joiner.page.evaluate(() => !window.minehonk.game.worldInfo?.cheats), 10000);
  r = await adminAs(joiner, give);
  check('an operator gets nothing with cheats off', !r.ok, r.text);

  // ---- leaving and coming back
  const saved = await joiner.page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    return { inv: g.invSlots.filter(Boolean).map((s) => `${s.id}x${s.count}`).sort(), x: b.x, y: b.y, z: b.z };
  });
  await leaveToTitle(joiner);
  const left = await until(async () => JSON.stringify(await playerNames(hostOf)) === JSON.stringify(['Hosty']), 10000);
  check('the host sees the joiner leave', left);
  await toOnline(joiner);
  await joinByCode(joiner, world.code);
  await inGame(joiner);
  await wait(1500);
  const back = await joiner.page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    return { inv: g.invSlots.filter(Boolean).map((s) => `${s.id}x${s.count}`).sort(), x: b.x, y: b.y, z: b.z };
  });
  check('coming back restores inventory and position', JSON.stringify(back.inv) === JSON.stringify(saved.inv) && Math.hypot(back.x - saved.x, back.z - saved.z) < 2, JSON.stringify({ saved, back }));
  check('the operator role is remembered', (await roleOf(hostOf, 'Joiny')) === 'operator');

  // ---- the host closes the tab
  await hostOf.page.close();
  const hostLeft = await until(async () => (await bodyText(joiner)).includes('The host left the game'), 20000);
  check('the joiner is told "The host left the game"', hostLeft);
  await joiner.page.screenshot({ path: `${OUT}/online-host-left.png` });
}

// ------------------------------------------------------------------ friends
let farm = null;
const carol = section('public') || section('security') || section('bandwidth') ? await player('Carol') : null;
if (section('friends')) {
  if (!hostOf.uuid) {
    await signUp(hostOf);
    await signUp(joiner);
  } else {
    await openPage(hostOf);
    await openPage(joiner);
    await toOnline(hostOf);
    await toOnline(joiner);
  }
  await tabTo(hostOf, 'friends');
  await top(hostOf).locator('input[placeholder="Player name"]').fill('Joiny');
  await click(hostOf, 'Add Friend');
  await tabTo(joiner, 'friends');
  await top(joiner).locator('.list-item', { hasText: 'Hosty' }).locator('button', { hasText: 'Accept' }).click();
  await joiner.page.waitForTimeout(800);
  const friendsNow = await joiner.page.evaluate(() => window.minehonk.cloudApi.friends()).then((f) => f.friends.map((x) => x.name));
  check('two players become friends (request, accept)', friendsNow.includes('Hosty'), JSON.stringify(friendsNow));
  farm = await hostNew(hostOf, 'Friendly Farm', { visibility: 'Friends', cheats: true });
  // The host stays safe while the tests click through menus
  await adminAs(hostOf, { a: 'gamemode', mode: 'creative' });
  // The friend's list shows where they are, and JOIN (no code)
  const joinRow = await until(async () => {
    await tabTo(joiner, 'friends');
    const row = top(joiner).locator('.friend-row', { hasText: 'Hosty' });
    return (await row.count()) && (await row.textContent()).includes('Playing Friendly Farm') && (await row.locator('.join-btn').count()) > 0;
  }, 15000, 1000);
  check('a friend sees "Playing Friendly Farm — JOIN"', joinRow);
  check('the friends list shows Cheats ON', (await top(joiner).locator('.friend-row', { hasText: 'Hosty' }).locator('.badge.cheats').count()) > 0);
  // Everything the loading screen says while joining
  await joiner.page.evaluate(() => {
    const app = window.minehonk;
    const show = app.setLoading.bind(app);
    window.__loadingTexts = [];
    app.setLoading = (text, detail) => {
      window.__loadingTexts.push(`${text} ${detail ?? ''}`);
      return show(text, detail);
    };
  });
  await top(joiner).locator('.friend-row', { hasText: 'Hosty' }).locator('.join-btn').click();
  await inGame(joiner);
  const loadingText = (await joiner.page.evaluate(() => window.__loadingTexts)).find((t) => /Hosted by/.test(t)) ?? '';
  check('the friend joins without a code', JSON.stringify(await playerNames(joiner)) === JSON.stringify(['Hosty', 'Joiny']));
  check('joining shows Cheats ON', /Cheats ON/.test(loadingText), loadingText);
  await leaveToTitle(joiner);
  await changeHosting(hostOf, { visibility: 'Private (code only)' });
  await toOnline(joiner);
  const noJoin = await until(async () => {
    await tabTo(joiner, 'friends');
    const row = top(joiner).locator('.friend-row', { hasText: 'Hosty' });
    return (await row.count()) && (await row.locator('.join-btn').count()) === 0;
  }, 15000, 1000);
  check('with Private, the JOIN button disappears', noJoin);
  // An invitation gets them in anyway
  await openPanel(hostOf);
  await click(hostOf, 'Invite Friends');
  await top(hostOf).locator('.list-item', { hasText: 'Joiny' }).locator('button', { hasText: 'Invite' }).click();
  const toast = await until(async () => (await joiner.page.locator('.invite-toast', { hasText: 'Hosty invited you to Friendly Farm' }).count()) > 0, 10000);
  check('the invite arrives as a toast ("Hosty invited you to Friendly Farm")', toast);
  await joiner.page.screenshot({ path: `${OUT}/online-invite.png` });
  await click(hostOf, 'Done');
  await closeMenus(hostOf);
  await joiner.page.locator('.invite-toast .join-btn').first().click();
  await inGame(joiner);
  check('the invite gets the friend into a private world', (await playerNames(joiner)).includes('Hosty'));
}

// ------------------------------------------------------------------ the relay when direct connections fail
let dave = null;
if (section('relay') && farm) {
  dave = await player('Dave', { breakRtc: true });
  await signUp(dave);
  const t0 = Date.now();
  await joinByCode(dave, farm.code);
  await dave.page.waitForFunction(() => window.minehonk.conn?.transport === 'relay', null, { timeout: 60000 }).catch(() => {});
  const tRelay = Date.now();
  await dave.page.waitForFunction(() => window.minehonk.game?.joined, null, { timeout: 120000 }).catch(() => {});
  const tWelcome = Date.now();
  await inGame(dave);
  console.log('relay timing', JSON.stringify({ relayAfter: (tRelay - t0) / 1000, welcomeAfter: (tWelcome - t0) / 1000, inGameAfter: (Date.now() - t0) / 1000, stats: await dave.page.evaluate(() => window.minehonk.conn?.stats) }));
  check(`direct connection fails and the relay takes over (${await transport(dave)}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`, (await transport(dave)) === 'relay' && (await pcCount(dave)) > 0);
  await sendChat(dave, 'relayed hello');
  check('chat works over the relay', await until(async () => (await chatLines(hostOf)).includes('relayed hello'), 10000));
}

// ------------------------------------------------------------------ public worlds, over the relay only
if (section('public') && farm) {
  const pcsBefore = await pcCount(hostOf);
  await changeHosting(hostOf, { visibility: 'Public' });
  await signUp(carol);
  await tabTo(carol, 'public');
  const listed = await until(async () => {
    await click(carol, 'Refresh');
    return (await top(carol).locator('.public-world', { hasText: 'Friendly Farm' }).count()) > 0;
  }, 15000, 1000);
  const row = top(carol).locator('.public-world', { hasText: 'Friendly Farm' });
  const rowText = listed ? await row.textContent() : '';
  check('the public list shows the world, its host, players, mode and version', listed && /Hosty/.test(rowText) && /\d+\/\d+ playing/.test(rowText) && /v\d/.test(rowText), rowText);
  check('the public list shows Cheats ON', (await row.locator('.badge.cheats').count()) > 0);
  await top(carol).locator('input[placeholder="Search worlds or hosts"]').fill('zzz');
  check('search hides worlds that do not match', (await top(carol).locator('.public-world').count()) === 0);
  // Typed key by key, as a person would: the box keeps the focus and every letter
  const searchBox = top(carol).locator('input[placeholder="Search worlds or hosts"]');
  await searchBox.fill('');
  await searchBox.click();
  await carol.page.keyboard.type('farm', { delay: 60 });
  const typed = await carol.page.evaluate(() => [document.activeElement?.getAttribute('placeholder'), document.activeElement?.value]);
  check('search finds it, typed letter by letter', (await top(carol).locator('.public-world').count()) === 1 && typed[0] === 'Search worlds or hosts' && typed[1] === 'farm', JSON.stringify(typed));
  await carol.page.screenshot({ path: `${OUT}/online-public.png` });
  await row.locator('.join-btn').click();
  await inGame(carol);
  check(`a stranger joins a public world over ${await transport(carol)}`, (await transport(carol)) === 'relay');
  check('the stranger never opens a direct connection', (await pcCount(carol)) === 0, String(await pcCount(carol)));
  check('the host never opens one to the stranger', (await pcCount(hostOf)) === pcsBefore, `${pcsBefore} -> ${await pcCount(hostOf)}`);
  const relayed = await hostOf.page.evaluate(() => window.minehonk.hostSession.transports());
  check('the host counts the relayed players', relayed.relay === (dave ? 2 : 1), JSON.stringify(relayed));
}

// ------------------------------------------------------------------ a phone
let phone = null;
if (section('mobile') && farm) {
  phone = await player('Phony', { viewport: { width: 390, height: 844 }, touch: true });
  await signUp(phone);
  await tabTo(phone, 'host');
  await click(phone, 'Create New World');
  check('hosting on a phone says it works best on a computer', (await top(phone).textContent()).includes('Hosting works best on a computer'));
  await click(phone, 'Cancel');
  await joinByCode(phone, farm.code);
  await inGame(phone);
  check('a phone joins and plays', (await playerNames(phone)).includes('Hosty') && (await phone.page.locator('.touch-layer:not(.hidden)').count()) > 0);
  console.log('phone download', JSON.stringify(await phone.page.evaluate(() => ({ transport: window.minehonk.conn.transport, kb: Math.round(window.minehonk.conn.stats.bytesIn / 1024), counts: window.__msgCounts }))));
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('nothing spills sideways on the phone', !overflow);
  await phone.page.screenshot({ path: `${OUT}/online-phone.png` });
}

// ------------------------------------------------------------------ the host's upload with four players
if (section('bandwidth') && farm && joiner && carol && dave && phone) {
  const joiners = [joiner, carol, dave, phone];
  const inWorld = await until(async () => (await playerNames(hostOf)).length === 5, 20000);
  check('host plus four players in one world', inWorld, JSON.stringify(await playerNames(hostOf)));
  const joinerStats = () => Promise.all(joiners.map((j) => j.page.evaluate(() => ({ transport: window.minehonk.conn?.transport, ...window.minehonk.conn?.stats }))));
  const j0 = await joinerStats();
  const s0 = await hostOf.page.evaluate(() => ({ ...window.minehonk.hostSession.stats, now: performance.now() }));
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  for (let round = 0; round < 12; round++) {
    await Promise.all(joiners.map((j, i) => j.page.keyboard.down(keys[(round + i) % 4]).catch(() => {})));
    await wait(5000);
    await Promise.all(joiners.map((j, i) => j.page.keyboard.up(keys[(round + i) % 4]).catch(() => {})));
  }
  const s1 = await hostOf.page.evaluate(() => ({ ...window.minehonk.hostSession.stats, now: performance.now() }));
  const j1 = await joinerStats();
  const secs = (s1.now - s0.now) / 1000;
  // Messages that reach the hub's relay (the free plan counts incoming WebSocket messages)
  const relayedJoinerMsgs = j1.reduce((n, j, i) => n + (j.transport === 'relay' ? j.messagesOut - j0[i].messagesOut : 0), 0);
  const bw = {
    players: 4,
    seconds: Math.round(secs),
    totalKBps: +((s1.bytesSent - s0.bytesSent) / 1024 / secs).toFixed(1),
    perPlayerKBps: +((s1.bytesSent - s0.bytesSent) / 1024 / secs / 4).toFixed(1),
    rtcKBps: +((s1.rtc - s0.rtc) / 1024 / secs).toFixed(1),
    relayKBps: +((s1.relay - s0.relay) / 1024 / secs).toFixed(1),
    transports: await hostOf.page.evaluate(() => window.minehonk.hostSession.transports()),
    relayMessagesPerSecFromHost: +((s1.relayMessagesOut - s0.relayMessagesOut) / secs).toFixed(1),
    relayMessagesPerSecFromJoiners: +(relayedJoinerMsgs / secs).toFixed(1),
    joinerDownloadKBps: j1.map((j, i) => +((j.bytesIn - j0[i].bytesIn) / 1024 / secs).toFixed(1)),
  };
  fs.writeFileSync(`${OUT}/online-bandwidth.json`, JSON.stringify(bw, null, 2));
  console.log('host upload:', JSON.stringify(bw));
  check(`the host's upload with four players is measured (${bw.totalKBps} KB/s)`, bw.totalKBps > 0);
}

// ------------------------------------------------------------------ security
if (section('security') && farm && carol) {
  const c = await compat(carol);
  check('another game version is turned away', (await ticketError(carol, farm.id, '1:old')) === 'Version mismatch — refresh the page');
  // A forged ticket: the hub's relay refuses it, and so does the host over WebRTC
  const forged = await carol.page.evaluate(async ([id, c]) => {
    const t = await window.minehonk.cloudApi.ticket(id, c);
    const [body, sig] = t.ticket.split('.');
    const pad = (s) => s.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(pad(body) + '='.repeat((4 - (body.length % 4)) % 4)));
    claims.name = 'Hosty';
    const fake = `${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
    const relay = await new Promise((resolve) => {
      const ws = new WebSocket(window.minehonk.cloudApi.socketUrl(`/relay/${id}`), ['minehonk', `ticket.${fake}`]);
      ws.onopen = () => resolve('opened');
      ws.onclose = () => resolve('refused');
    });
    const lobby = window.minehonk.lobby;
    const rtc = await new Promise((resolve) => {
      const off = lobby.on((m) => {
        if (m.t === 'signal' && m.sid === 'forged' && m.data.kind === 'refused') {
          off();
          resolve(m.data.reason);
        }
      });
      lobby.send({ t: 'signal', to: t.host, world: id, sid: 'forged', data: { kind: 'offer', sdp: 'v=0', ticket: fake, relayOnly: false } });
      setTimeout(() => resolve('no answer'), 8000);
    });
    return { relay, rtc };
  }, [farm.id, c]);
  check('a forged ticket is refused by the relay', forged.relay === 'refused', JSON.stringify(forged));
  check('a forged ticket is refused by the host', /expired/.test(forged.rtc), JSON.stringify(forged));
  // A visitor with a modified client
  await changeHosting(hostOf, { joiners: 'Visitors' });
  const visitorAdmin = await adminAs(carol, { a: 'give', item: 'diamond', count: 64 });
  const spot = await carol.page.evaluate(() => {
    const b = window.minehonk.game.player.body;
    return { x: Math.floor(b.x) + 1, y: Math.round(b.y) - 1, z: Math.floor(b.z) };
  });
  const was = await stateAt(hostOf, spot);
  await carol.page.evaluate(({ x, y, z }) => {
    const g = window.minehonk.game;
    g.send({ t: 'dig', action: 'start', x, y, z, face: 1 });
    g.send({ t: 'dig', action: 'finish', x, y, z, face: 1 });
  }, spot);
  await wait(1500);
  check('a visitor cannot use the Admin Panel, even with cheats on and a modified client', !visitorAdmin.ok, visitorAdmin.text);
  check('a visitor cannot break blocks', (await stateAt(hostOf, spot)) === was);
  await changeHosting(hostOf, { joiners: 'Builders' });
  // Banned
  await panelAction(hostOf, 'Carol', 'Ban', 'Ban');
  const kicked = await until(async () => /banned/i.test(await bodyText(carol)), 10000);
  check('a banned player is removed', kicked);
  const again = await until(async () => {
    const e = await ticketError(carol, farm.id, c);
    return e === "You're banned from this world" ? e : null;
  }, 10000, 1000);
  check('a banned player cannot come back', again === "You're banned from this world");
}

// ------------------------------------------------------------------ Open to Multiplayer, then the host leaves (relay and direct)
if (section('open') && hostOf.uuid) {
  if (hostOf.page.isClosed() || (await hostOf.page.evaluate(() => !!window.minehonk.game))) {
    await openPage(hostOf);
  }
  // A plain single player world, then the pause menu
  await hostOf.page.evaluate(() => window.minehonk.startWorld('wopen', { id: 'wopen', name: 'Quiet Valley', seed: 'quiet', mode: 'survival', difficulty: 'normal', godHearts: 10, cheats: false, owner: null }));
  await inGame(hostOf);
  await hostOf.page.evaluate(() => (window.__firstGame = window.minehonk.game));
  await hostOf.page.evaluate(() => window.minehonk.openPause());
  await click(hostOf, 'Open to Multiplayer');
  await top(hostOf).locator('input[placeholder="World name"]').waitFor({ timeout: 15000 });
  await fillHostForm(top(hostOf), { visibility: 'Private (code only)' });
  await click(hostOf, 'Start Hosting');
  await top(hostOf).locator('.join-code').waitFor({ timeout: 30000 });
  const code = await hostOf.page.evaluate(() => window.minehonk.hostSession?.details?.joinCode);
  check(`Open to Multiplayer puts a running world online (${code})`, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code ?? ''));
  check('without restarting it', await hostOf.page.evaluate(() => window.__firstGame === window.minehonk.game));
  await closeMenus(hostOf);
  const others = [joiner, dave].filter(Boolean);
  for (const j of others) {
    if (await j.page.evaluate(() => !!window.minehonk.game)) await leaveToTitle(j);
    await openPage(j);
    await toOnline(j);
    await joinByCode(j, code);
    await inGame(j);
  }
  const ways = await Promise.all(others.map(transport));
  check(`players join it (${ways.join(', ')})`, (await playerNames(hostOf)).length === others.length + 1 && ways[0] === 'rtc' && (!dave || ways[1] === 'relay'));
  await hostOf.page.close();
  for (const j of others) {
    const told = await until(async () => (await bodyText(j)).includes('The host left the game'), 20000);
    check(`${j.name} (over ${j === dave ? 'the relay' : 'WebRTC'}) is told the host left`, told);
  }
}

fs.writeFileSync(`${OUT}/online-hub.log`, hubLog.join(''));
console.log(checks.filter(([, ok]) => !ok).length ? `ONLINE E2E: FAIL (${checks.filter(([, ok]) => !ok).map(([n]) => n).join(', ')})` : 'ONLINE E2E: PASS');
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
cleanup();
process.exit(checks.some(([, ok]) => !ok) ? 1 : 0);
