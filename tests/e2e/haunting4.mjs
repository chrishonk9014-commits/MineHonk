/**
 * V7 phase 4 in the browser: the Admin Panel's Haunting tab (the character
 * picker, each character's endings, showing one near you, talking to one
 * and seeing who answered), then each new character's haunting from the
 * panel (Null: things taken, a null sign, the colour draining away, the
 * world erased, Connection Lost; Green Steve: him waving, his house, a copy
 * wearing your name, the bedrock room, replaced; the Cave Dweller: it
 * watching, the hunt, dragged into its den, dawn), and an automatic
 * Herobrine haunting in progress (rolled into a world, begun by itself,
 * noticing you run). Screenshots: tests/e2e/out/haunting4-*.png.
 *
 *   npx vite build && node tests/e2e/haunting4.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve('tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4196;
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// UPDATE_LOG_SHOTS=1: each screenshot also gets a clean copy in tests/e2e/out/clean (no HUD), for the Update Log
if (process.env.UPDATE_LOG_SHOTS) {
  const CLEAN = path.join(OUT, 'clean');
  fs.mkdirSync(CLEAN, { recursive: true });
  const shoot = page.screenshot.bind(page);
  const HIDE = ['.hotbar', '.crosshair', '.debug', '.debug-right', '.quest-tracker', '.cheats-indicator', '.chat', '.xpbar', '.xplevel', '.stat-row', '.item-name', '.toast', '.subtitles'];
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

const inGame = () =>
  page.waitForFunction(() => {
    const l = document.querySelector('.loading');
    return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
  }, null, { timeout: 180000 });
async function newWorld(name, seed = 'haunting4-e2e') {
  await page.getByText('Singleplayer').click();
  await page.getByText('Create New World').first().click();
  await page.locator('.screen:not(.hidden) input').first().fill(name);
  await page.getByText('More World Options...').click();
  await page.locator('input[placeholder="Leave blank for a random seed"]').fill(seed);
  const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
  if ((await cheatsOff.count()) > 0) await cheatsOff.click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
  await inGame();
}
async function openWorld(name) {
  await page.getByText('Singleplayer').click();
  await page.waitForTimeout(600);
  await page.locator('.screen:not(.hidden) .list-item', { hasText: name }).first().click();
  await page.locator('.screen:not(.hidden) button', { hasText: 'Play Selected World' }).click();
  await inGame();
}
const cmd = (t) => page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), t);
/** Flat open grass around the player, and the time. */
async function clearing(time = 6000, r = 20) {
  await cmd(`/fill ~-${r} ~ ~-${r} ~${r} ~8 ~${r} air`);
  await cmd(`/fill ~-${r} ~-1 ~-${r} ~${r} ~-1 ~${r} grass_block`);
  await cmd(`/fill ~-${r} ~-4 ~-${r} ~${r} ~-2 ~${r} dirt`);
  await cmd('/gamerule doMobSpawning false');
  await cmd(`/time set ${time}`);
  await page.waitForTimeout(1500);
}
async function openHauntTab() {
  await page.evaluate(() => window.minehonk.openAdmin());
  await page.locator('.admin-panel').waitFor();
  await page.locator('.admin-tab[data-tab="haunt"]').dispatchEvent('mousedown');
  await page.waitForTimeout(900);
}
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
/** Every line of chat since the page opened (the chat goes with the game when it ends), and what is on screen now. */
const chatText = () => page.evaluate(() => [...(window.__chatLog ?? []), ...[...document.querySelectorAll('.chat .line')].map((e) => e.textContent)].join('\n')).catch(() => '');
/** Turns to look at the nearest entity of a type (with this name tag, if given); how far it is, or null. */
const lookAt = (type, name = null) =>
  page.evaluate(
    ([type, name]) => {
      const g = window.minehonk.game;
      if (!g) return null;
      const b = g.player.body;
      const e = [...g.entities.values()].filter((x) => x.type === type && (name === null || x.meta?.name === name)).sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
      if (!e) return null;
      const dx = e.x - b.x;
      const dz = e.z - b.z;
      const d = Math.hypot(dx, dz);
      g.player.yaw = Math.atan2(-dx, -dz);
      const h = type === 'cave_dweller' ? 2.4 : type === 'creeper' ? 1.1 : 1.6;
      g.player.pitch = -Math.atan2(e.y + h - (b.y + 1.62), d) * 0.9;
      return d;
    },
    [type, name],
  );
const look = (yawStep = 0.35) =>
  page.evaluate((s) => {
    const p = window.minehonk.game?.player;
    if (!p) return;
    p.yaw = (p.yaw + s) % (Math.PI * 2);
    p.pitch = 0.05;
  }, yawStep);
/** The nearest block of one of these ids around the player, or null. */
const nearestBlock = (ids, r = 30) =>
  page.evaluate(
    ([ids, r]) => {
      const g = window.minehonk.game;
      if (!g) return null;
      const b = g.player.body;
      const reg = window.minehonkRegistry;
      const names = new Map([...reg.blockById.values()].map((x) => [x.num, x.id]));
      let best = null;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++)
          for (let dy = -6; dy <= 8; dy++) {
            const x = Math.floor(b.x) + dx;
            const y = Math.floor(b.y) + dy;
            const z = Math.floor(b.z) + dz;
            const id = names.get(reg.blockOfState(g.world.getState(x, y, z)));
            if (!ids.includes(id)) continue;
            const d = Math.hypot(dx, dy, dz);
            if (!best || d < best.d) best = { x, y, z, id, d };
          }
      return best;
    },
    [ids, r],
  );
/** Stands a few blocks from a spot, looking at it. */
async function viewBlock(at, back = 4, up = 1.5) {
  await page.evaluate(
    ([at, back, up]) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const dx = at.x + 0.5 - b.x;
      const dz = at.z + 0.5 - b.z;
      const d = Math.hypot(dx, dz) || 1;
      const x = at.x + 0.5 - (dx / d) * back;
      const z = at.z + 0.5 - (dz / d) * back;
      g.send({ t: 'chat', text: `/tp ${x.toFixed(1)} ${(at.y + up).toFixed(1)} ${z.toFixed(1)}` });
    },
    [at, back, up],
  );
  await page.waitForTimeout(900);
  await page.evaluate((at) => {
    const g = window.minehonk.game;
    const b = g.player.body;
    const dx = at.x + 0.5 - b.x;
    const dz = at.z + 0.5 - b.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = -Math.atan2(at.y + 0.5 - (b.y + 1.62), Math.hypot(dx, dz));
  }, at);
  await page.waitForTimeout(500);
}
const step = () => page.evaluate(() => document.querySelector('.haunt-scene')?.dataset.step ?? '').catch(() => '');
const atTitle = () => page.evaluate(() => !window.minehonk?.game).catch(() => true);
const status = () => page.locator('.admin-body').innerText();

await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = 6));
await page.evaluate(() => {
  window.__chatLog = [];
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('line') && n.parentElement?.classList.contains('chat')) window.__chatLog.push(n.textContent);
  }).observe(document.body, { childList: true, subtree: true });
});

// ------------------------------------------------------------------ the Admin Panel
await newWorld('Cast');
await clearing(6000);
await openHauntTab();
const names = { herobrine: 'Herobrine', null: 'Null', green_steve: 'Green Steve', cave_dweller: 'The Cave Dweller' };
check('the tab has a character picker with all four', (await page.locator('.haunt-char').count()) === 4 && (await page.locator('.haunt-char.active').textContent()) === 'Herobrine');
check("Herobrine's endings and the owner's choice are as before", (await page.locator('.haunt-ending').textContent()) === 'Ending: Random' && (await page.locator('.haunt-finale').textContent()) === 'At the end: Delete the world');
await page.screenshot({ path: `${OUT}/haunting4-tab-herobrine.png`, keepHud: true });
const endings = { null: ['Disconnected: null'], green_steve: ['Random', 'The bedrock room', 'Replaced'], cave_dweller: ['Random', 'Taken', 'Dawn'] };
for (const c of ['null', 'green_steve', 'cave_dweller']) {
  await page.locator(`.haunt-char-${c}`).click();
  await page.waitForTimeout(300);
  const t = await status();
  const seen = [];
  for (let i = 0; i < endings[c].length; i++) {
    seen.push((await page.locator('.haunt-ending').textContent()).replace('Ending: ', ''));
    if (endings[c].length > 1) await page.locator('.haunt-ending').click();
  }
  check(`${names[c]}: its own blurb, stages and endings (${seen.join(', ')})`, t.includes(names[c] === 'The Cave Dweller' ? 'Cave Dweller' : names[c]) && /Admin Panel only/.test(t) && JSON.stringify(seen) === JSON.stringify(endings[c]));
  await page.screenshot({ path: `${OUT}/haunting4-tab-${c}.png`, keepHud: true });
  // Talk to it: no haunting needed; it says who answered
  await page.locator('.haunt-talk-text').fill('who are you?');
  await page.locator('.haunt-talk-send').click();
  await page.locator('.haunt-talk-out .haunt-talk-line').waitFor({ timeout: 20000 });
  const out = await page.locator('.haunt-talk-out').innerText();
  check(`${names[c]} answers the test conversation, and the panel says who answered (${out.replace(/\s+/g, ' ').slice(0, 120)})`, /Answered by\s+(Claude|The scripted lines)/.test(out));
  await page.screenshot({ path: `${OUT}/haunting4-talk-${c}.png`, keepHud: true });
  // Show it near me
  await page.locator('.haunt-appear').click();
  await page.waitForTimeout(600);
  await closePanel();
  const mob = c === 'null' ? 'null_entity' : c;
  let d = null;
  for (let k = 0; k < 10 && d === null; k++) {
    d = await lookAt(mob);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
  check(`${names[c]} shows itself near you (${d?.toFixed(1)} blocks)`, d !== null && d < 30);
  // A step closer, for a good look
  if (d !== null) {
    await page.evaluate((mob) => {
      const g = window.minehonk.game;
      const b = g.player.body;
      const e = [...g.entities.values()].find((x) => x.type === mob);
      if (!e) return;
      const dx = e.x - b.x;
      const dz = e.z - b.z;
      const n = Math.hypot(dx, dz) || 1;
      const k = Math.max(0, n - (mob === 'cave_dweller' ? 6.5 : 5.5)) / n;
      g.send({ t: 'chat', text: `/tp ${(b.x + dx * k).toFixed(2)} ${b.y.toFixed(2)} ${(b.z + dz * k).toFixed(2)}` });
    }, mob);
    await page.waitForTimeout(700);
    await lookAt(mob);
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${OUT}/haunting4-appear-${c}.png` });
  await page.waitForTimeout(12500);
  check(`${names[c]} is gone again`, (await lookAt(mob)) === null);
  await openHauntTab();
}
await closePanel();
await page.evaluate(() => window.minehonk.quitToTitle());
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });

// ------------------------------------------------------------------ Null
await newWorld('Nothing');
await clearing(6000);
// Something of yours for it to take: torches and a little wall behind you
await cmd('/fill ~-6 ~ ~5 ~6 ~1 ~5 oak_planks');
for (const dx of [-4, 0, 4]) await cmd(`/setblock ~${dx} ~ ~3 torch`);
await openHauntTab();
await page.locator('.haunt-char-null').click();
while ((await page.locator('.haunt-finale').textContent()) !== 'At the end: Keep the world') await page.locator('.haunt-finale').click();
await page.locator('.haunt-minutes').fill('2');
await page.locator('.haunt-minutes').dispatchEvent('change');
await page.locator('.haunt-start').click();
await page.waitForTimeout(900);
const nst = await status();
check('Null starts from the panel (status: Null, from the Admin Panel)', /Haunting\s+Null/.test(nst) && /From the Admin Panel/.test(nst) && /Something is missing/.test(nst));
await page.screenshot({ path: `${OUT}/haunting4-null-status.png`, keepHud: true });
await page.locator('.haunt-skip').click();
await page.waitForTimeout(500);
await closePanel();
{
  const shots = new Set();
  const steps = [];
  let drainMax = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    if (await atTitle()) break;
    const s = await step();
    if (s && steps[steps.length - 1] !== s) steps.push(s);
    const st = await page.evaluate(() => ({ drain: window.minehonk.game?.drain ?? 0, n: [...(window.minehonk.game?.entities.values() ?? [])].filter((e) => e.type === 'null_entity').length })).catch(() => ({ drain: 0, n: 0 }));
    drainMax = Math.max(drainMax, st.drain);
    if (st.n && !shots.has('figure') && !s) {
      await lookAt('null_entity');
      shots.add('figure');
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/haunting4-null-figure.png` });
    } else if (!s) await look(0.4);
    if (!shots.has('sign') && !s) {
      const sign = await nearestBlock(['sign'], 24);
      if (sign) {
        shots.add('sign');
        await viewBlock(sign, 3, 0);
        await page.screenshot({ path: `${OUT}/haunting4-null-sign.png` });
      }
    }
    if (!shots.has('drain') && st.drain > 0.65 && !s) {
      shots.add('drain');
      await page.screenshot({ path: `${OUT}/haunting4-null-drain.png`, keepHud: true });
    }
    if (s === 'erase' && !shots.has('erase')) {
      shots.add('erase');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/haunting4-null-erase.png` });
    }
    await page.waitForTimeout(400);
  }
  const chat = await chatText();
  check(`Null's figure showed itself (${[...shots].join(', ')})`, shots.has('figure'));
  check('it left a sign: null', shots.has('sign'));
  check(`the colour drained away (${drainMax.toFixed(2)})`, drainMax > 0.65);
  check('its words: lowercase, few', /i am what is left/.test(chat) || /almost empty/.test(chat));
  check(`its end: the world erased (${steps.join(' > ')})`, steps.includes('erase'));
}
await page.locator('.haunt-end-null').waitFor({ timeout: 60000 });
const nullEnd = await page.locator('.haunt-end-null').innerText();
check('Connection Lost: Disconnected: null', /Connection Lost/.test(nullEnd) && /Disconnected: null/.test(nullEnd));
await page.waitForTimeout(6500);
check('a quiet note: everything it took has been put back', /put back/.test(await page.locator('.haunt-end-null .fake-ban-note.shown').innerText()));
await page.screenshot({ path: `${OUT}/haunting4-null-end.png`, keepHud: true });
await page.locator('.haunt-end-null button', { hasText: 'Back to Title Screen' }).click();
check('the colour is back on the title screen', (await page.evaluate(() => document.querySelector('canvas')?.style.filter ?? '')) === '');

// ------------------------------------------------------------------ Green Steve
await newWorld('Brother');
await clearing(6000, 24);
await openHauntTab();
await page.locator('.haunt-char-green_steve').click();
while ((await page.locator('.haunt-finale').textContent()) !== 'At the end: Keep the world') await page.locator('.haunt-finale').click();
while ((await page.locator('.haunt-ending').textContent()) !== 'Ending: The bedrock room') await page.locator('.haunt-ending').click();
await page.locator('.haunt-minutes').fill('3');
await page.locator('.haunt-minutes').dispatchEvent('change');
await page.locator('.haunt-start').click();
await page.waitForTimeout(800);
await closePanel();
{
  const shots = new Set();
  const steps = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 260000) {
    if (await atTitle()) break;
    const s = await step();
    if (s && steps[steps.length - 1] !== s) steps.push(s);
    if (!s) {
      const name = await page.evaluate(() => window.minehonk.game?.player?.name ?? window.minehonk.profile?.name ?? '').catch(() => '');
      const friend = !shots.has('friend') ? await lookAt('green_steve', 'Green Steve') : null;
      if (friend !== null && friend < 50) {
        shots.add('friend');
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${OUT}/haunting4-green-friend.png` });
      } else {
        const copy = !shots.has('copy') && name ? await lookAt('green_steve', name) : null;
        if (copy !== null && copy < 40) {
          shots.add('copy');
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${OUT}/haunting4-green-copy.png` });
        } else await look(0.4);
      }
      if (!shots.has('house')) {
        const house = await nearestBlock(['blue_terracotta'], 32);
        if (house) {
          shots.add('house');
          // From outside, the door and the sign
          const sign = await nearestBlock(['sign'], 32);
          await viewBlock(sign ?? house, 6, 0.5);
          await page.screenshot({ path: `${OUT}/haunting4-green-house.png` });
        }
      }
      if (!shots.has('creeper')) {
        const cr = await lookAt('creeper');
        if (cr !== null && cr < 8) {
          shots.add('creeper');
          await page.screenshot({ path: `${OUT}/haunting4-green-creeper.png` });
        }
      }
    }
    if (s === 'rise' && !shots.has('room')) {
      shots.add('room');
      await page.waitForTimeout(3600);
      await page.screenshot({ path: `${OUT}/haunting4-green-room.png` });
    }
    if (s === 'flash' && !shots.has('flash')) {
      shots.add('flash');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/haunting4-green-flash.png` });
    }
    // Halfway through, along to the copies
    if (Date.now() - t0 > 30000 && !shots.has('skipped')) {
      shots.add('skipped');
      await openHauntTab();
      await page.locator('.haunt-skip').click();
      await page.waitForTimeout(300);
      await page.locator('.haunt-skip').click();
      await page.waitForTimeout(300);
      await closePanel();
    }
    await page.waitForTimeout(400);
  }
  const chat = await chatText();
  check('"Green Steve joined the world"', /Green Steve joined the world/.test(chat));
  check(`him waving far off (${[...shots].join(', ')})`, shots.has('friend'));
  check('a copy of you wearing your name', shots.has('copy'));
  check('his house with blue clay in the floor', shots.has('house'));
  check('"Hello, brother."', /Hello, brother\./.test(chat));
  check(`the bedrock room, then a white flash (${steps.join(' > ')})`, shots.has('room') && steps.includes('flash'));
}
await page.locator('.haunt-end-green_steve').waitFor({ timeout: 60000 });
check('his end screen', /Hello, brother\./.test(await page.locator('.haunt-end-green_steve').innerText()));
await page.screenshot({ path: `${OUT}/haunting4-green-end.png`, keepHud: true });
await page.locator('.haunt-end-green_steve button', { hasText: 'Back to Title Screen' }).click();
// The other ending, straight to it
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await newWorld('Replaced');
await clearing(6000, 16);
await openHauntTab();
await page.locator('.haunt-char-green_steve').click();
while ((await page.locator('.haunt-finale').textContent()) !== 'At the end: Keep the world') await page.locator('.haunt-finale').click();
while ((await page.locator('.haunt-ending').textContent()) !== 'Ending: Replaced') await page.locator('.haunt-ending').click();
await page.locator('.haunt-start').click();
await page.waitForTimeout(700);
await page.locator('.haunt-to-end').click();
await page.waitForTimeout(400);
await closePanel();
{
  const steps = [];
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !(await atTitle())) {
    const s = await step();
    if (s && steps[steps.length - 1] !== s) steps.push(s);
    if (s === 'watch' && !shot && Date.now() - t0 > 0) {
      await page.waitForTimeout(5500);
      shot = true;
      await page.screenshot({ path: `${OUT}/haunting4-green-replaced.png` });
    }
    await page.waitForTimeout(250);
  }
  check(`replaced: watched from outside yourself as he walks off wearing your name (${steps.join(' > ')})`, shot);
}
await page.locator('.haunt-end-green_steve').waitFor({ timeout: 30000 });
check('"You were replaced."', /You were replaced\./.test(await page.locator('.haunt-end-green_steve').innerText()));
await page.screenshot({ path: `${OUT}/haunting4-green-replaced-end.png`, keepHud: true });
await page.locator('.haunt-end-green_steve button', { hasText: 'Back to Title Screen' }).click();

// ------------------------------------------------------------------ the Cave Dweller
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await newWorld('Below');
await clearing(14000, 20);
// A door and some wall torches for it
await cmd('/fill ~-3 ~ ~6 ~3 ~3 ~6 stone');
await cmd('/fill ~-2 ~1 ~5 ~-2 ~1 ~5 wall_torch');
await cmd('/fill ~2 ~1 ~5 ~2 ~1 ~5 wall_torch');
await openHauntTab();
await page.locator('.haunt-char-cave_dweller').click();
while ((await page.locator('.haunt-finale').textContent()) !== 'At the end: Keep the world') await page.locator('.haunt-finale').click();
while ((await page.locator('.haunt-ending').textContent()) !== 'Ending: Taken') await page.locator('.haunt-ending').click();
await page.locator('.haunt-minutes').fill('2');
await page.locator('.haunt-minutes').dispatchEvent('change');
await page.locator('.haunt-start').click();
await page.waitForTimeout(700);
await page.locator('.haunt-skip').click();
await page.waitForTimeout(400);
await closePanel();
{
  const shots = new Set();
  const steps = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    if (await atTitle()) break;
    const s = await step();
    if (s && steps[steps.length - 1] !== s) steps.push(s);
    if (!s) {
      const d = await lookAt('cave_dweller');
      const anim = await page.evaluate(() => {
        const g = window.minehonk.game;
        const e = [...(g?.entities.values() ?? [])].find((x) => x.type === 'cave_dweller');
        return e ? String(e.meta.hbAnim ?? '') : null;
      });
      if (d !== null && anim === 'stare' && !shots.has('watch')) {
        shots.add('watch');
        await page.screenshot({ path: `${OUT}/haunting4-dweller-watch.png` });
      } else if (d !== null && anim === 'crawl' && !shots.has('crawl')) {
        shots.add('crawl');
        await page.screenshot({ path: `${OUT}/haunting4-dweller-crawl.png` });
      } else if (d !== null && anim === 'lunge' && !shots.has('lunge')) {
        shots.add('lunge');
        await page.screenshot({ path: `${OUT}/haunting4-dweller-lunge.png` });
      } else if (d === null) await look(0.45);
    }
    if (s === 'drag' && !shots.has('drag')) {
      shots.add('drag');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/haunting4-dweller-drag.png` });
    }
    if (s === 'eyes' && !shots.has('eyes')) {
      shots.add('eyes');
      await page.waitForTimeout(2800);
      await page.screenshot({ path: `${OUT}/haunting4-dweller-eyes.png` });
    }
    await page.waitForTimeout(350);
  }
  const chat = await chatText();
  check(`it watched, frozen, from the edge of the light (${[...shots].join(', ')})`, shots.has('watch'));
  check('it crawled on all fours', shots.has('crawl') || shots.has('lunge'));
  check('its whispers', /\.\.\.found you\.\.\./.test(chat) || /\.\.\.down here\.\.\./.test(chat));
  check(`taken: grabbed, dragged into the dark, eyes opening (${steps.join(' > ')})`, ['grab', 'drag', 'black', 'eyes'].every((x) => steps.includes(x)));
}
await page.locator('.haunt-end-cave_dweller').waitFor({ timeout: 30000 });
check('"You were taken."', /You were taken\./.test(await page.locator('.haunt-end-cave_dweller').innerText()));
await page.screenshot({ path: `${OUT}/haunting4-dweller-end.png`, keepHud: true });
await page.locator('.haunt-end-cave_dweller button', { hasText: 'Back to Title Screen' }).click();
// Dawn
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await newWorld('Dawn');
await clearing(14000, 16);
await openHauntTab();
await page.locator('.haunt-char-cave_dweller').click();
while ((await page.locator('.haunt-finale').textContent()) !== 'At the end: Keep the world') await page.locator('.haunt-finale').click();
while ((await page.locator('.haunt-ending').textContent()) !== 'Ending: Dawn') await page.locator('.haunt-ending').click();
await page.locator('.haunt-start').click();
await page.waitForTimeout(700);
await page.locator('.haunt-to-end').click();
await page.waitForTimeout(400);
await closePanel();
{
  let hunted = false;
  let dawn = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 80000 && !(await atTitle())) {
    const st = await page.evaluate(() => {
      const g = window.minehonk.game;
      return g ? { t: g.dayTime ?? g.world?.dayTime ?? 0, d: [...g.entities.values()].some((e) => e.type === 'cave_dweller') } : null;
    }).catch(() => null);
    if (!st) break;
    if (st.d && !hunted) {
      hunted = true;
      await lookAt('cave_dweller');
      await page.screenshot({ path: `${OUT}/haunting4-dweller-hunt.png` });
    } else if (st.d) await lookAt('cave_dweller');
    if (hunted && !st.d && !dawn) {
      dawn = true;
      await page.evaluate(() => {
        const p = window.minehonk.game.player;
        // East, where the sun comes up
        p.pitch = -0.08;
        p.yaw = -Math.PI / 2;
      });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/haunting4-dweller-dawn.png` });
    }
    await page.waitForTimeout(300);
  }
  check('the hunt, then dawn: it went back down', hunted && dawn);
}
await page.locator('.haunt-end-cave_dweller').waitFor({ timeout: 30000 });
check('"You saw the sun come up."', /You saw the sun come up\./.test(await page.locator('.haunt-end-cave_dweller').innerText()));
await page.screenshot({ path: `${OUT}/haunting4-dweller-dawn-end.png`, keepHud: true });
await page.locator('.haunt-end-cave_dweller button', { hasText: 'Back to Title Screen' }).click();

// ------------------------------------------------------------------ the automatic haunting
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
// A player who beat Herobrine for real: the next world they make gets the roll
await page.evaluate(() => localStorage.setItem('minehonk.herobrineBeaten', JSON.stringify({ at: Date.now(), how: 'now' })));
await newWorld('Rolled');
await page.evaluate(() => window.minehonk.quitToTitle());
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
const worldsIn = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('minehonk', 1);
        r.onsuccess = () => {
          const q = r.result.transaction('worlds', 'readonly').objectStore('worlds').getAll();
          q.onsuccess = () => res(q.result.map((w) => ({ id: w.id, name: w.name, roll: w.flags?.autoHaunt ?? null })));
        };
      }),
  );
const rolledWorld = (await worldsIn()).find((w) => w.name === 'Rolled');
check(`a world made by someone who beat him gets the roll (${JSON.stringify(rolledWorld?.roll)})`, rolledWorld?.roll && typeof rolledWorld.roll.haunted === 'boolean' && rolledWorld.roll.played === 0);
check('worlds made before (by someone who had not) have none', (await worldsIn()).filter((w) => w.name !== 'Rolled').every((w) => !w.roll));
// One whose roll came up, Herobrine due after a few seconds of play
await page.evaluate(
  (id) =>
    new Promise((res) => {
      const r = indexedDB.open('minehonk', 1);
      r.onsuccess = () => {
        const tx = r.result.transaction('worlds', 'readwrite');
        const s = tx.objectStore('worlds');
        const q = s.get(id);
        q.onsuccess = () => {
          const w = q.result;
          w.flags = { ...(w.flags ?? {}), autoHaunt: { haunted: true, after: 20 * 20, played: 0, at: Date.now() } };
          s.put(w, id);
        };
        tx.oncomplete = () => res(true);
      };
    }),
  rolledWorld.id,
);
await openWorld('Rolled');
await clearing(13000, 20);
await openHauntTab();
const waiting = await status();
check(`the panel shows it waiting (${waiting.match(/Automatic haunting\s+[^\n]+/)?.[0] ?? ''})`, /Automatic haunting\s+Waiting: Herobrine comes after/.test(waiting));
await page.screenshot({ path: `${OUT}/haunting4-auto-waiting.png`, keepHud: true });
await closePanel();
const before = await chatText();
await page.waitForTimeout(25000);
await openHauntTab();
const running = await status();
check('it began by itself, and nothing announced it', /Started\s+By itself/.test(running) && /Automatic haunting\s+Running now/.test(running) && (await chatText()) === before);
check('it runs about 45 minutes', /Time\s+\d+:\d\d \/ 45:00/.test(running));
check('End and Reset are offered', (await page.locator('.haunt-stop').textContent()).startsWith('End it') && (await page.locator('.haunt-restart').count()) === 1);
await page.screenshot({ path: `${OUT}/haunting4-auto-status.png`, keepHud: true });
// Along to "Closer" (the panel moving it along means it counts for nothing, but it plays the same)
await page.locator('.haunt-skip').click();
await page.waitForTimeout(300);
await page.locator('.haunt-skip').click();
await page.waitForTimeout(300);
await closePanel();
// Running for a while (round and round the clearing, so nothing stops you): he notices
await page.keyboard.down('KeyW');
await page.keyboard.down('ControlLeft');
let remark = null;
let sight = false;
const t2 = Date.now();
while (Date.now() - t2 < 40000 && !remark) {
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const p = window.minehonk.game?.player;
    if (p) p.yaw = (p.yaw + 0.17) % (Math.PI * 2);
  });
  const c = await page.evaluate(() => [...document.querySelectorAll('.chat .line.chat-herobrine')].map((e) => e.textContent).join('\n'));
  remark = /WHERE ARE YOU RUNNING|YOU CANNOT OUTRUN ME|SLOW DOWN/.exec(c)?.[0] ?? null;
}
await page.keyboard.up('ControlLeft');
await page.keyboard.up('KeyW');
check(`he notices you running (${remark})`, !!remark);
await page.screenshot({ path: `${OUT}/haunting4-auto-notice.png`, keepHud: true });
// When he notices you running he shows himself, a little way off
for (let i = 0; i < 120 && !sight; i++) {
  const d = await lookAt('herobrine');
  if (d !== null) {
    sight = true;
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/haunting4-auto-sighting.png` });
  } else if (i > 20) await look(0.5);
  await page.waitForTimeout(250);
}
check('his figure, in an automatic haunting', sight);
// End it: over for good
await openHauntTab();
await page.locator('.haunt-stop').click();
await page.waitForTimeout(900);
check('ended from the panel: over for good', /Automatic haunting\s+Over, for good/.test(await status()));
await closePanel();

check(`no page errors (${errors.join(' | ').slice(0, 300)})`, errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `HAUNTING4 E2E: FAIL (${failed.length})` : 'HAUNTING4 E2E: PASS');
process.exit(failed.length ? 1 : 0);
