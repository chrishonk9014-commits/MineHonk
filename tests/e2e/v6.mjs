/**
 * V6 browser check (the End Expansion): a cheats world, the Expansion Portal
 * on the main End island (dormant, then alive once the Ender Dragon is
 * defeated from the Admin Panel), a walk through it into the Expanded End,
 * and one look at each of its seven biomes by Admin Panel teleport (sky,
 * fog, F3 biome line).
 *
 * Phase 2: each of the five new mobs in its biome, the ores in cut walls, a
 * giant chorus tree, two telegraphed attacks as they wind up (a Void
 * Stalker's crouch, a Chorus Beast's throw arc), and Ender Alloy armor worn
 * by the player.
 *
 * Phase 3: the structure locator; each End City variant and each giant
 * structure (the world's own, or built here from the Admin Panel when the
 * world has none); a giant's discovery title; both Guardian Constructs and
 * their telegraphs; a wall of Ender Glyph Stone and its glyphs; the Dragon's
 * Nest from inside and its crack.
 *
 * Phase 4: the Admin Panel's End test line over the void (a Crystal
 * Generator charging a Void Cell, an End Processor, a Crystal Grower), its
 * Ender Bridge reaching out, a Teleportation Node's window, a Void Skiff
 * fuelled, boarded and flown, a repaired ancient gateway, the quest tracker,
 * and an upgraded Elytra's tooltip.
 *
 * Phase 5: a Void Storm (its warning, its sky, a Storm Remnant), the End
 * Eclipse (its sky, a monolith), the Void Citadel (its title, the tower from
 * outside, a Glyph Lock floor, the parkour route), each of the End
 * Guardian's phases and its victory title, each of the Dragon's new moves,
 * and V6's four title screen scenes with their edition text. Screenshots go
 * to tests/e2e/out/v6-*.png.
 */
import { spawn, execFileSync } from 'node:child_process';
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
// UPDATE_LOG_SHOTS=1: each screenshot also gets a clean copy in tests/e2e/out/clean (no hotbar,
// crosshair, hand, debug text, chat or quest tracker; titles, banners, boss bars and windows stay),
// for the Update Log's pictures (tools/update-log/build-images.mjs)
if (process.env.UPDATE_LOG_SHOTS) {
  const CLEAN = path.join(OUT, 'clean');
  fs.mkdirSync(CLEAN, { recursive: true });
  const shoot = page.screenshot.bind(page);
  const HIDE = ['.hotbar', '.crosshair', '.debug', '.debug-right', '.quest-tracker', '.cheats-indicator', '.chat', '.xpbar', '.xplevel', '.stat-row', '.item-name', '.wings-meters', '.hp-label', '.toast', '.subtitles', '.title-screen'];
  page.screenshot = async (opts = {}) => {
    if (opts.path) {
      const hud = await page.evaluate((hide) => {
        if (!document.getElementById('clean-shot')) document.head.append(Object.assign(document.createElement('style'), { id: 'clean-shot', textContent: hide.map((c) => `body.clean-shot ${c}`).join(',') + '{visibility:hidden!important}' }));
        document.body.classList.add('clean-shot');
        const g = window.minehonk?.game;
        const was = g?.hudHidden ?? false;
        if (g) g.hudHidden = true;
        return was;
      }, HIDE);
      await page.waitForTimeout(300);
      await shoot({ ...opts, path: path.join(CLEAN, path.basename(opts.path)) });
      await page.evaluate((was) => {
        document.body.classList.remove('clean-shot');
        const g = window.minehonk?.game;
        if (g) g.hudHidden = was;
      }, hud);
    }
    return shoot(opts);
  };
}
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

// The Admin Panel's Teleport tab lists the Expanded End with the End's biomes and structures (from the
// Overworld they are searched from the arrival platform). Found only: a cheat visit would mark the End.
await page.evaluate(() => window.minehonk.openAdmin());
await page.locator('.admin-panel').waitFor();
await page.locator('.admin-tab[data-tab="teleport"]').dispatchEvent('mousedown');
await page.waitForTimeout(500);
await page.locator('.admin-col').first().locator('select').first().selectOption('end');
await page.waitForTimeout(200);
const tpStructures = page.locator('.admin-col').first();
const tpBiomes = page.locator('.admin-col').nth(1);
const endStructures = await tpStructures.locator('select').nth(1).locator('option').allTextContents();
const endBiomes = await tpBiomes.locator('select').first().locator('option').allTextContents();
check(`End structures include the Expanded End's (${endStructures.join(', ')})`, ['End City', "Dragon's Nest", 'End Outpost (Expanded End)', 'Crystal Cathedral (Expanded End)', 'The Fallen City (Expanded End)', 'Void Citadel (Expanded End)'].every((n) => endStructures.includes(n)));
check(`End biomes include the Expanded End's (${endBiomes.join(', ')})`, ['End Highlands', 'Chorus Forest (Expanded End)', 'End Highlands (Expanded End)', 'Void Wastes (Expanded End)'].every((n) => endBiomes.includes(n)));
await tpStructures.locator('select').nth(1).selectOption('end_outpost');
await tpStructures.getByRole('button', { name: 'Find nearest' }).click();
await tpStructures.locator('.admin-result .admin-kv').first().waitFor({ timeout: 60000 });
const foundOutpost = (await tpStructures.locator('.admin-result').textContent()).replace(/\s+/g, ' ');
check(`Teleport tab finds an End Outpost: ${foundOutpost}`, /End Outpost/.test(foundOutpost) && /The End/.test(foundOutpost) && /blocks/.test(foundOutpost));
await tpBiomes.locator('select').first().selectOption('chorus_forest');
await tpBiomes.getByRole('button', { name: 'Find nearest' }).first().click();
await tpBiomes.locator('.admin-result .admin-kv').first().waitFor({ timeout: 60000 });
const foundForest = (await tpBiomes.locator('.admin-result').first().textContent()).replace(/\s+/g, ' ');
check(`Teleport tab finds a Chorus Forest: ${foundForest}`, /Chorus Forest \(Expanded End\)/.test(foundForest) && /The End/.test(foundForest));
await page.screenshot({ path: `${OUT}/v6-admin-teleport-end.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

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

// ---------------------------------------------------------------- phase 2
const sites = JSON.parse(execFileSync('npx', ['tsx', 'tests/e2e/v6-sites.ts', 'v6-e2e']).toString());
const here = () => page.evaluate(() => {
  const b = window.minehonk.game.player.body;
  return { x: b.x, y: b.y, z: b.z };
});
const entitiesOf = (type) => page.evaluate((t) => [...window.minehonk.game.entities.values()].filter((e) => e.type === t).map((e) => ({ id: e.id, x: e.x, y: e.y, z: e.z, meta: e.meta })), type);
const fly = () => page.evaluate(() => (window.minehonk.game.player.flying = true));
const goTo = async (x, y, z) => {
  await cmd(`/tp ${x} ${y} ${z}`);
  await fly();
  await waitChunks();
};

/** Firm ground about `dist` blocks from (x, z) in direction (dx, dz): the first standing spot found, or null. */
const groundAt = (x, y, z, dx, dz, dist, room = 3) =>
  page.evaluate(([x, y, z, dx, dz, dist, room]) => {
    const w = window.minehonk.game.world;
    for (const d of [dist, dist - 1, dist + 1, dist - 2, dist + 2, dist + 3]) {
      const gx = Math.floor(x + dx * d);
      const gz = Math.floor(z + dz * d);
      for (let gy = Math.floor(y) + 5; gy > Math.floor(y) - 10; gy--) {
        let clear = w.getState(gx, gy - 1, gz) !== 0;
        for (let k = 0; k < room && clear; k++) clear = w.getState(gx, gy + k, gz) === 0;
        if (clear) return { x: gx + 0.5, y: gy, z: gz + 0.5, d };
      }
    }
    return null;
  }, [x, y, z, dx, dz, dist, room]);

// Each mob in its own biome, on firm ground in front of the camera (held still for the picture)
for (const [mob, biome, dist, up, eyeAbove] of [
  ['endling', 'chorus_forest', 3.5, 0, 1.2],
  ['void_stalker', 'void_wastes', 5, 0, 1],
  ['chorus_beast', 'chorus_forest', 9, 0, 2],
  ['end_crystal_mite', 'end_crystal_fields', 2.5, 0, 1],
  ['end_phantom', 'astral_end', 8, 5, 0],
]) {
  const r = await adminTp('tp_biome', { biome });
  check(`teleported to ${biome} for the ${mob}`, r.ok);
  await waitChunks();
  await fly();
  const p = await here();
  const room = mob === 'endling' || mob === 'end_crystal_mite' ? 1 : 3;
  let g = up ? { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + up, z: Math.floor(p.z) - dist + 0.5, d: dist } : null;
  for (const [dx, dz] of [[0, -1], [1, 0], [-1, 0], [0, 1], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) if (!g) g = await groundAt(p.x, p.y, p.z, dx, dz, dist, room);
  check(`firm ground for the ${mob}`, !!g);
  if (!g) continue;
  await cmd(`/summon ${mob} ${g.x} ${g.y} ${g.z} noai`);
  await page.waitForTimeout(1500);
  check(`${mob} is there`, (await entitiesOf(mob)).length > 0);
  // The camera a little above the mob's ground, looking down at it
  const eye = await page.evaluate(([gy, above]) => {
    const pl = window.minehonk.game.player;
    pl.body.y = gy + above;
    return pl.body.y + 1.62;
  }, [g.y, eyeAbove]);
  // Aim at where the mob actually is
  const m = (await entitiesOf(mob))[0];
  const cam = await here();
  const targetY = m.y + (mob === 'chorus_beast' ? 1.5 : mob === 'void_stalker' ? 1.1 : 0.3);
  const hd = Math.hypot(m.x - cam.x, m.z - cam.z);
  await look(Math.atan2(-(m.x - cam.x), -(m.z - cam.z)), Math.atan2(eye - targetY, hd));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/v6-mob-${mob}.png` });
}

// The ores, in walls cut open beside them (a crystal lamp in the ceiling to see by)
for (const [ore, at] of Object.entries(sites.ores)) {
  await goTo(at.x + 0.5, at.y, at.z - 4.5);
  await cmd(`/fill ${at.x - 3} ${at.y} ${at.z - 6} ${at.x + 3} ${at.y + 3} ${at.z - 1} air`);
  await cmd(`/fill ${at.x} ${at.y + 4} ${at.z - 3} ${at.x} ${at.y + 4} ${at.z - 3} crystal_lamp`);
  await page.evaluate(([x, y, z]) => {
    const b = window.minehonk.game.player.body;
    b.x = x;
    b.y = y;
    b.z = z;
  }, [at.x + 0.5, at.y + 0.2, at.z - 4.5]);
  await look(Math.PI, 0.15);
  await page.waitForTimeout(2500);
  const seen = await page.evaluate(([x, y, z]) => window.minehonk.game.world.getState(x, y, z), [at.x, at.y, at.z]);
  check(`${ore} is in the cut wall`, seen !== 0);
  await page.screenshot({ path: `${OUT}/v6-ore-${ore}.png` });
}

// A giant chorus tree
if (sites.tree) {
  const t = sites.tree;
  await goTo(t.x + 0.5, t.lo + 7, t.z - 15.5);
  await look(Math.PI, -0.12);
  await page.waitForTimeout(2500);
  const stalk = await page.evaluate(([x, y, z]) => window.minehonk.game.world.getState(x, y, z), [t.x, t.lo + 2, t.z]);
  check('the giant chorus tree is there', stalk !== 0);
  await page.screenshot({ path: `${OUT}/v6-chorus-tree.png` });
}

// Telegraphs, on a player in survival: a Void Stalker crouching, a Chorus Beast showing its throw's arc
{
  const r = await adminTp('tp_arrival');
  check('back on the arrival platform', r.ok);
  await waitChunks();
  await cmd('/gamemode survival');
  await page.waitForTimeout(1500);
  const p = await here();
  await look(0, 0.1);
  await cmd(`/summon void_stalker ${Math.floor(p.x) + 0.5} ${Math.floor(p.y)} ${Math.floor(p.z) - 5.5}`);
  const crouched = await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'void_stalker' && e.meta.tele === 'lunge'), null, { timeout: 20000 }).then(() => true, () => false);
  check('a Void Stalker crouches before its lunge (seen by the client)', crouched);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/v6-telegraph-lunge.png` });
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v6', op: 'kill_mobs' }));
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'heal' }));
  await page.waitForTimeout(1000);
  // A beast angered by a hit up close, then the player steps well back: it throws chorus
  const bs = await groundAt(p.x, p.y, p.z, 1, 0, 4.5);
  await cmd(`/summon chorus_beast ${bs.x} ${bs.y} ${bs.z}`);
  await page.waitForTimeout(1500);
  // Up close for the hit (a punch from where the player stood can fall short of the beast)
  const beast = (await entitiesOf('chorus_beast'))[0];
  check('the Chorus Beast is there', !!beast);
  if (beast) {
    await cmd(`/tp ${beast.x - 2.4} ${bs.y} ${beast.z}`);
    for (let i = 0; i < 3; i++) {
      await page.evaluate((id) => window.minehonk.game.send({ t: 'attack', id }), beast.id);
      await page.waitForTimeout(250);
    }
  }
  const back = await groundAt(bs.x, bs.y, bs.z, -1, 0, 11);
  if (back) await cmd(`/tp ${back.x} ${back.y} ${back.z}`);
  await look(-Math.PI / 2, 0.05);
  const winding = await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'chorus_beast' && e.meta.tele === 'throw'), null, { timeout: 30000 }).then(() => true, () => false);
  // (straight away: the wind-up lasts little more than a second)
  const arcShown = await page.evaluate(() => [...window.minehonk.game.renderer.worldFx.markers.values()].some((mk) => mk.kind === 'warn_arc'));
  await page.screenshot({ path: `${OUT}/v6-telegraph-throw.png` });
  check('a Chorus Beast winds up its throw (seen by the client)', winding);
  check("the throw's arc is shown", arcShown);
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v6', op: 'kill_mobs' }));
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'heal' }));
}

// Ender Alloy armor, worn (right-click each piece from the hotbar), on the inventory's player doll
{
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'clear_inventory' }));
  await admin('give_set', { set: 'ender_alloy_armor' });
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(`Digit${i + 1}`);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.minehonk.game.send({ t: 'use', hand: 0, action: 'start' }));
    await page.waitForTimeout(400);
  }
  const worn = await page.evaluate(() => [5, 6, 7, 8].map((i) => window.minehonk.game.invSlots[i]?.id ?? 0));
  check('a full set of Ender Alloy armor is worn', worn.every((n) => n > 0));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/v6-ender-alloy-armor.png` });
  await page.keyboard.press('Escape');
}

// ---------------------------------------------------------------- phase 3
const sites3 = JSON.parse(execFileSync('npx', ['tsx', 'tests/e2e/v6-structure-sites.ts', 'v6-e2e']).toString());
const KINDS = ['end_outpost', 'end_settlement', 'end_ruins', 'end_library', 'end_observatory', 'end_shipyard', 'end_metropolis', 'end_palace', 'end_colossus', 'crystal_cathedral', 'void_observatory', 'end_fortress', 'fallen_city'];
const GIANTS = new Set(['end_colossus', 'crystal_cathedral', 'void_observatory', 'end_fortress', 'fallen_city']);
await cmd('/gamemode creative');
await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'clear_inventory' }));
await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'heal' }));

// The locator (from the arrival platform) finds what the generator placed
{
  const r = await adminTp('tp_arrival');
  check('back at the arrival platform for the locator', r.ok);
  await waitChunks();
  const loc = await admin('locate_structures');
  check('the structure locator answers', loc.ok);
  const located = loc.data?.located ?? [];
  for (const [id, at] of Object.entries(sites3.structures)) check(`the locator finds the ${id} the generator placed`, located.some((f) => f.id === id && f.at && f.at.x === at.x && f.at.z === at.z));
  check("the locator shows the Dragon's Nest", !!loc.data?.nest);
}

/** Holds the camera at a spot in creative flight (set again after the landing settles). */
const pin = (x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const g = window.minehonk.game;
    g.player.flying = true;
    const b = g.player.body;
    b.x = x;
    b.y = y;
    b.z = z;
    b.vx = b.vy = b.vz = 0;
    return b.y;
  }, [x, y, z]);

/** Looks at a structure from a camera spot outside it, then screenshots it. */
const view = async (id, cam, wait) => {
  await goTo(cam.x, cam.y, cam.z);
  await pin(cam.x, cam.y, cam.z);
  await look(cam.yaw, cam.pitch);
  await page.waitForTimeout(wait);
  await pin(cam.x, cam.y, cam.z);
  await look(cam.yaw, cam.pitch);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/v6-structure-${id}.png` });
};

// Walking into a giant for the first time: its title on screen (the music sting plays with it). The title
// shows once per giant per player, and the biome teleports above may already have passed through the nearest
// giants, so the farthest from the arrival platform are tried first
{
  const a = sites3.arrival;
  const giants = KINDS.filter((k) => GIANTS.has(k) && sites3.structures[k]).sort((p, q) => Math.hypot(sites3.structures[q].x - a.x, sites3.structures[q].z - a.z) - Math.hypot(sites3.structures[p].x - a.x, sites3.structures[p].z - a.z));
  let shown = null;
  for (const id of giants) {
    const at = sites3.structures[id];
    await page.evaluate(() => {
      const t = document.querySelector('.title-overlay');
      if (t) t.textContent = '';
    });
    await goTo(at.inside.x, at.inside.y, at.inside.z);
    await pin(at.inside.x, at.inside.y, at.inside.z);
    const title = await page.waitForFunction(() => {
      const t = document.querySelector('.title-overlay');
      return !!t && /^THE /.test(t.innerText) && Number(getComputedStyle(t).opacity) > 0.6;
    }, null, { timeout: 12000 }).then(() => true, () => false);
    if (!title) continue;
    shown = id;
    await page.screenshot({ path: `${OUT}/v6-discovery-title.png` });
    break;
  }
  check(`walking into a giant shows its title (${shown})`, !!shown);
}

// Each variant and each giant: the world's own where it has one, otherwise built here from the Admin Panel
for (const id of KINDS) {
  const at = sites3.structures[id];
  if (at) {
    await view(id, at.cam, GIANTS.has(id) ? 9000 : 5000);
    const c = await page.evaluate(([x, y0, y1, z]) => {
      const w = window.minehonk.game.world;
      let n = 0;
      for (let y = y0; y <= y1; y++) if (w.getState(x, y, z) !== 0) n++;
      return n;
    }, [at.x, at.y - 2, at.y + 30, at.z]);
    check(`the ${id} stands where the generator placed it`, c > 0);
    continue;
  }
  // Built from the panel over the Shattered End (the giant's own biome), then looked at from outside
  const r = await adminTp('tp_biome', { biome: id === 'fallen_city' ? 'shattered_end' : 'highlands' });
  check(`teleported to build the ${id}`, r.ok);
  await waitChunks();
  await fly();
  const p = await here();
  const g = await admin('generate_here', { structure: id });
  check(`the Admin Panel plans the ${id} here`, g.ok);
  // A chunk a tick, into the loaded chunks only (any farther ones wait for a player): wait until it stops
  const total = (await admin('status')).data?.structures?.building ?? 0;
  let left = total;
  for (let i = 0, still = 0; i < 120 && left > 0 && still < 5; i++) {
    await page.waitForTimeout(1000);
    const now = (await admin('status')).data?.structures?.building ?? 0;
    still = now === left ? still + 1 : 0;
    left = now;
  }
  check(`the ${id} is built around the player, a chunk at a time (${total - left} of ${total} chunks loaded)`, total > 0 && left < total);
  const d = GIANTS.has(id) ? 95 : 45;
  await view(id, { x: p.x + d * 0.7, y: p.y + d * 0.4, z: p.z + d * 0.7, yaw: Math.atan2(0.7, 0.7), pitch: Math.atan2(d * 0.4 + 1.62 - 10, d) }, 6000);
}

// The Guardian Constructs, standing still for their picture, then winding up on a survival player
{
  const r = await adminTp('tp_arrival');
  check('back on the arrival platform for the Constructs', r.ok);
  await waitChunks();
  await fly();
  const p = await here();
  for (const [mob, dist, eyeAbove, targetUp] of [
    ['guardian_sentinel', 5, 1.2, 1.3],
    ['guardian_bulwark', 7, 1.6, 1.5],
  ]) {
    let g = null;
    for (const [dx, dz] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) if (!g) g = await groundAt(p.x, p.y, p.z, dx, dz, dist, 3);
    check(`firm ground for the ${mob}`, !!g);
    if (!g) continue;
    await cmd(`/summon ${mob} ${g.x} ${g.y} ${g.z} noai`);
    await page.waitForTimeout(1500);
    const m = (await entitiesOf(mob))[0];
    check(`${mob} is there`, !!m);
    if (!m) continue;
    const eye = await page.evaluate(([x, gy, z, above]) => {
      const pl = window.minehonk.game.player;
      pl.body.x = x;
      pl.body.y = gy + above;
      pl.body.z = z;
      return pl.body.y + 1.62;
    }, [p.x, g.y, p.z, eyeAbove]);
    const cam = await here();
    const hd = Math.hypot(m.x - cam.x, m.z - cam.z);
    await look(Math.atan2(-(m.x - cam.x), -(m.z - cam.z)), Math.atan2(eye - (m.y + targetUp), hd));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/v6-construct-${mob}.png` });
    await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v6', op: 'kill_mobs' }));
    await page.waitForTimeout(800);
  }
  // Their telegraphs, on a player in survival: the Sentinel's glowing arm, the Bulwark's ring of cracks
  await cmd('/gamemode survival');
  await page.waitForTimeout(1500);
  const q = await here();
  await look(0, 0.25);
  await cmd(`/summon guardian_sentinel ${Math.floor(q.x) + 0.5} ${Math.floor(q.y)} ${Math.floor(q.z) - 2.5}`);
  const punch = await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'guardian_sentinel' && (e.meta.tele === 'punch' || e.meta.tele === 'bolt')), null, { timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/v6-telegraph-sentinel.png` });
  check('a Sentinel winds up before it strikes (seen by the client)', punch);
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v6', op: 'kill_mobs' }));
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'heal' }));
  await page.waitForTimeout(1000);
  await cmd(`/summon guardian_bulwark ${Math.floor(q.x) + 0.5} ${Math.floor(q.y)} ${Math.floor(q.z) - 3.5}`);
  await look(0, 0.45);
  const pound = await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'guardian_bulwark' && e.meta.tele === 'pound'), null, { timeout: 40000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  const cracks = await page.evaluate(() => [...window.minehonk.game.renderer.worldFx.markers.values()].some((mk) => mk.kind === 'warn_cracks'));
  await page.screenshot({ path: `${OUT}/v6-telegraph-bulwark.png` });
  check('a Bulwark winds up its ground pound (seen by the client)', pound);
  check("the pound's ring of cracks is shown", cracks);
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v6', op: 'kill_mobs' }));
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'heal' }));
  await cmd('/gamemode creative');
}

// A wall of Ender Glyph Stone; using one shows its glyphs and nothing else
if (sites3.glyphs) {
  const gl = sites3.glyphs;
  await goTo(gl.cam.x, gl.cam.y, gl.cam.z);
  await page.evaluate(([x, y, z]) => {
    const b = window.minehonk.game.player.body;
    b.x = x;
    b.y = y;
    b.z = z;
  }, [gl.cam.x, gl.cam.y, gl.cam.z]);
  await look(gl.cam.yaw, gl.cam.pitch);
  await page.waitForTimeout(3000);
  const seen = await page.evaluate(([x, y, z]) => window.minehonk.game.world.getState(x, y, z), [gl.x, gl.y, gl.z]);
  check('the glyph wall is there', seen !== 0);
  await page.screenshot({ path: `${OUT}/v6-glyph-wall.png` });
  await page.evaluate(([x, y, z]) => window.minehonk.game.send({ t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0, seq: 1 }), [gl.x, gl.y, gl.z]);
  const tablet = await page.waitForSelector('.glyph-screen', { timeout: 10000 }).then(() => true, () => false);
  check('using Ender Glyph Stone shows its glyphs', tablet);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/v6-glyph-tablet.png` });
  await page.keyboard.press('Escape');
} else check('a glyph wall was found in the world', false);

// The Dragon's Nest (the dragon was defeated above): carved as the main island loads, then a look inside
{
  const r = await adminTp('tp_nest');
  check("teleported to the Dragon's Nest", r.ok);
  await waitChunks();
  let built = false;
  for (let i = 0; i < 90 && !built; i++) {
    built = !!(await admin('status')).data?.structures?.nest?.built;
    if (!built) await page.waitForTimeout(1000);
  }
  check("the Dragon's Nest is carved after the dragon's defeat", built);
  const r2 = await adminTp('tp_nest');
  check('teleported into the Nest', r2.ok);
  await waitChunks();
  await page.waitForTimeout(3000);
  // Face the widest open direction of the chamber
  const yaw = await page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    let best = 0;
    let bestOpen = -1;
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * Math.PI * 2;
      let open = 0;
      for (let d = 1; d <= 40; d++) {
        if (g.world.getState(Math.floor(b.x - Math.sin(yaw) * d), Math.floor(b.y + 2), Math.floor(b.z - Math.cos(yaw) * d)) !== 0) break;
        open++;
      }
      if (open > bestOpen) {
        bestOpen = open;
        best = yaw;
      }
    }
    return best;
  });
  await look(yaw, 0.05);
  await page.waitForTimeout(2000);
  const covered = await page.evaluate(() => {
    const g = window.minehonk.game;
    const b = g.player.body;
    for (let y = Math.floor(b.y) + 2; y < 200; y++) if (g.world.getState(Math.floor(b.x), y, Math.floor(b.z)) !== 0) return true;
    return false;
  });
  check('the Nest is under the island (rock overhead)', covered);
  await page.screenshot({ path: `${OUT}/v6-dragon-nest.png` });
  // And its way in: the crack in front of the Expansion Portal, seen from above the portal looking down it
  const ent = (await admin('status')).data?.structures?.nest?.entrance;
  check("the Nest's entrance is known", Array.isArray(ent));
  if (ent) {
    const cam = { x: ent[0] + 0.5, y: ent[1] + 14, z: ent[2] + 7.5 };
    await goTo(cam.x, cam.y, cam.z);
    await pin(cam.x, cam.y, cam.z);
    await page.waitForTimeout(1500);
    // Down the crack: from the top of it towards the chamber
    const aim = { x: ent[0] + 0.5, y: ent[1] - 6, z: ent[2] - 12 };
    const pitch = Math.atan2(cam.y + 1.62 - aim.y, cam.z - aim.z);
    await pin(cam.x, cam.y, cam.z);
    await look(0, pitch);
    await page.waitForTimeout(2000);
    const camY = await pin(cam.x, cam.y, cam.z);
    check('the camera is up over the crack', Math.abs(camY - cam.y) < 1);
    const open = await page.evaluate(([x, y, z]) => window.minehonk.game.world.getState(x, y, z), [ent[0], ent[1] - 1, ent[2] - 3]);
    check('the crack is open in the ground', open === 0);
    await page.screenshot({ path: `${OUT}/v6-dragon-nest-crack.png` });
  }
}

// ---------------------------------------------------------------- phase 4
await cmd('/gamemode creative');
await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'clear_inventory' }));
const stateOf = (str) => page.evaluate((s) => window.minehonkState(s), str);
const setSlot = (slot, id, count = 1, tag) =>
  page.evaluate(([slot, id, count, tag]) => {
    const it = window.minehonkRegistry.itemById.get(id);
    window.minehonk.game.send({ t: 'creative_set', slot, item: it ? { id: it.num, count, ...(tag ? { tag } : {}) } : null });
  }, [slot, id, count, tag ?? null]);
const hotbar = async (i) => {
  await page.keyboard.press(`Digit${i + 1}`);
  await page.waitForTimeout(200);
};
let seqNo = 90000;
const useOnBlock = (x, y, z, face = 1) => page.evaluate(([x, y, z, face, seq]) => window.minehonk.game.send({ t: 'use_on', x, y, z, face, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: window.minehonk.game.player.yaw, pitch: window.minehonk.game.player.pitch, seq }), [x, y, z, face, seqNo++]);
/** Moves the camera (a real teleport: the server checks every move), then holds it there. */
const moveTo = async (x, y, z) => {
  await cmd(`/tp ${x} ${y} ${z}`);
  await fly();
  await page.waitForTimeout(700);
  await pin(x, y, z);
};
/** Aims the camera from where it is at a point. */
const aimAt = (x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const pl = window.minehonk.game.player;
    const b = pl.body;
    const dx = x - b.x;
    const dy = y - (b.y + 1.62);
    const dz = z - b.z;
    pl.yaw = Math.atan2(-dx, -dz);
    // (a positive pitch looks down)
    pl.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  }, [x, y, z]);

// The End test line, built out over open void beside the arrival platform: a Crystal Generator charging a Void Cell,
// an End Processor, a Crystal Grower, two Teleportation Nodes, and an Ender Bridge reaching out east
let rig = null;
{
  const r = await adminTp('tp_arrival');
  check('back at the arrival platform for the End test line', r.ok);
  await waitChunks();
  await fly();
  // Open void: a run of empty columns east of a spot (nothing in them at any height)
  const spot = await page.evaluate(() => {
    const g = window.minehonk.game;
    const w = g.world;
    const b = g.player.body;
    const empty = (x, z) => {
      if (!w.isLoaded(x, z)) return false;
      for (let y = 0; y < 220; y += 2) if (w.getState(x, y, z) !== 0) return false;
      return true;
    };
    let best = null;
    for (let r = 16; r <= 96 && !best; r += 8)
      for (let a = 0; a < 32 && !best; a++) {
        const x = Math.floor(b.x + Math.cos((a / 32) * Math.PI * 2) * r);
        const z = Math.floor(b.z + Math.sin((a / 32) * Math.PI * 2) * r);
        let ok = true;
        for (let k = 0; k <= 48 && ok; k += 3) for (let dz = -1; dz <= 4 && ok; dz++) ok = empty(x + k, z + dz);
        if (ok) best = { x, z };
      }
    return best ? { ...best, y: Math.floor(b.y) } : null;
  });
  check('open void found beside the arrival platform', !!spot);
  if (spot) {
    await goTo(spot.x - 1.5, spot.y, spot.z - 1.5);
    await pin(spot.x - 1.5, spot.y, spot.z - 1.5);
    const built = await admin('end_rig');
    check('the End test line is built', built.ok);
    const o = built.data?.rig;
    if (o) rig = { x: o[0], y: o[1], z: o[2] };
    console.log('rig at', JSON.stringify(rig), 'spot', JSON.stringify(spot));
    await page.waitForTimeout(6000);
    // From above and in front of the line
    const cam = { x: rig.x + 4.5, y: rig.y + 4, z: rig.z + 6.5 };
    await moveTo(cam.x, cam.y, cam.z);
    await aimAt(rig.x + 4.5, rig.y + 0.5, rig.z + 0.5);
    await page.waitForTimeout(2500);
    await pin(cam.x, cam.y, cam.z);
    await aimAt(rig.x + 4.5, rig.y + 0.5, rig.z + 0.5);
    await page.waitForTimeout(1000);
    const states = await page.evaluate(([x, y, z]) => [0, 2, 4, 6, 8, 10].map((dx) => window.minehonk.game.world.getState(x + dx, y, z + (dx === 10 ? 1 : 0))), [rig.x, rig.y, rig.z]);
    check('the test line is on screen (machines in place)', states.every((st) => st !== 0));
    await page.screenshot({ path: `${OUT}/v6-crystal-generator.png` });
    // The bridge: Ender Light out over the void, seen along its length
    const light = await page.evaluate(([x, y, z]) => {
      const w = window.minehonk.game.world;
      let n = 0;
      for (let k = 11; k <= 74; k++) if (w.getState(x + k, y, z) !== 0) n++;
      return n;
    }, [rig.x, rig.y, rig.z + 1]);
    check(`the Ender Bridge reaches out over the void (${light} blocks)`, light >= 40);
    const bcam = { x: rig.x + 8.5, y: rig.y + 3.5, z: rig.z + 4.5 };
    await moveTo(bcam.x, bcam.y, bcam.z);
    await aimAt(rig.x + 40, rig.y, rig.z + 1.5);
    await page.waitForTimeout(2000);
    await pin(bcam.x, bcam.y, bcam.z);
    await aimAt(rig.x + 40, rig.y, rig.z + 1.5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/v6-ender-bridge.png` });
    // A Teleportation Node's window: its name, the lock, the other node with its cost
    await moveTo(rig.x + 8.5, rig.y + 0.2, rig.z + 1.5);
    await useOnBlock(rig.x + 8, rig.y, rig.z);
    await page.waitForTimeout(1500);
    check('the node window is open', (await page.locator('.eng-gui').count()) === 1);
    const nodeText = (await page.locator('.eng-gui').textContent().catch(() => '')) ?? '';
    check('the node window lists the other node', /Node 2|Node 1/.test(nodeText));
    await page.screenshot({ path: `${OUT}/v6-teleport-node.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

// The Void Skiff: put on the line's floor, fuelled, boarded, flown out over the void (seen from behind)
if (rig) {
  await setSlot(36, 'void_skiff');
  await setSlot(37, 'void_shard', 64);
  await hotbar(0);
  // (on the line's south edge, clear of the machines; it flies off south over the void)
  await moveTo(rig.x + 2.5, rig.y + 0.2, rig.z + 3.5);
  await useOnBlock(rig.x + 4, rig.y - 1, rig.z + 3);
  await page.waitForTimeout(1500);
  const skiff = (await entitiesOf('void_skiff'))[0];
  check('the Void Skiff is placed', !!skiff);
  if (skiff) {
    await hotbar(1);
    await page.evaluate((id) => window.minehonk.game.send({ t: 'interact', id, hand: 0 }), skiff.id);
    await page.waitForTimeout(600);
    await setSlot(37, null);
    await page.waitForTimeout(400);
    await page.evaluate((id) => window.minehonk.game.send({ t: 'interact', id, hand: 0 }), skiff.id);
    await page.waitForTimeout(1500);
    const aboard = await page.evaluate(() => window.minehonk.game.player.vehicle?.kind ?? null);
    check('boarded the Void Skiff as its pilot', aboard === 'skiff');
    await page.evaluate(() => {
      const pl = window.minehonk.game.player;
      pl.yaw = Math.PI;
      pl.pitch = -0.15;
    });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await page.waitForTimeout(2500);
    await page.keyboard.up('Space');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
    const flown = (await entitiesOf('void_skiff'))[0];
    check('the skiff flew out over the void', !!flown && flown.z > skiff.z + 4 && flown.meta?.lit === true);
    // Seen from behind and above (third person, looking down past the pilot at the void)
    await page.evaluate(() => {
      const pl = window.minehonk.game.player;
      pl.yaw = Math.PI;
      pl.pitch = 0.45;
    });
    await page.keyboard.press('F5');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/v6-void-skiff.png` });
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(300);
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(500);
  }
}

// A repaired ancient gateway: the nearest broken portal with a pair, mended and linked from the Admin Panel
{
  await cmd('/gamemode creative');
  const r = await adminTp('quest_tp', { quest: 'broken_gateway' });
  check(`teleported to a broken portal (${r.text})`, r.ok);
  await waitChunks();
  await fly();
  const done = await admin('quest_complete', { quest: 'broken_gateway' });
  check('the gateway and its pair are repaired', done.ok);
  await page.waitForTimeout(3000);
  const gx = await stateOf('ancient_gateway[axis=x]');
  const gz = await stateOf('ancient_gateway[axis=z]');
  const sheet = await page.evaluate(([gx, gz]) => {
    const g = window.minehonk.game;
    const w = g.world;
    const b = g.player.body;
    const cells = [];
    for (let dx = -24; dx <= 24; dx++)
      for (let dz = -24; dz <= 24; dz++)
        for (let dy = -16; dy <= 16; dy++) {
          const st = w.getState(Math.floor(b.x) + dx, Math.floor(b.y) + dy, Math.floor(b.z) + dz);
          if (st === gx || st === gz) cells.push([Math.floor(b.x) + dx, Math.floor(b.y) + dy, Math.floor(b.z) + dz, st === gx ? 'x' : 'z']);
        }
    return cells;
  }, [gx, gz]);
  check(`the ancient gateway is lit (${sheet.length} cells)`, sheet.length >= 4);
  if (sheet.length) {
    const c = sheet.reduce((a, s) => [a[0] + s[0] / sheet.length, a[1] + s[1] / sheet.length, a[2] + s[2] / sheet.length], [0, 0, 0]);
    const axis = sheet[0][3];
    // In front of the sheet, on whichever side is open
    let cam = null;
    for (const sgn of [1, -1]) {
      const p = axis === 'x' ? [c[0] + 0.5, c[1] - 0.5, c[2] + 0.5 + sgn * 6] : [c[0] + 0.5 + sgn * 6, c[1] - 0.5, c[2] + 0.5];
      const open = await page.evaluate(([x, y, z]) => window.minehonk.game.world.getState(Math.floor(x), Math.floor(y + 1), Math.floor(z)) === 0, p);
      if (open && !cam) cam = p;
    }
    cam ??= axis === 'x' ? [c[0] + 0.5, c[1] + 1, c[2] + 6.5] : [c[0] + 6.5, c[1] + 1, c[2] + 0.5];
    await moveTo(cam[0], cam[1], cam[2]);
    await aimAt(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
    await page.waitForTimeout(2500);
    await pin(cam[0], cam[1], cam[2]);
    await aimAt(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/v6-ancient-gateway.png` });
  }
  await admin('quest_reset', { quest: 'broken_gateway' });
}

// The quest tracker: an observatory's quest started, its next step on the HUD
{
  const r = await adminTp('quest_tp', { quest: 'lost_observatory' });
  check(`teleported to a Lost Observatory (${r.text})`, r.ok);
  await waitChunks();
  await fly();
  const st = await admin('quest_start', { quest: 'lost_observatory' });
  check('the observatory quest is started', st.ok);
  const shown = await page.waitForFunction(() => {
    const q = document.querySelector('.quest-end');
    return !!q && /Repair the lens/.test(q.textContent ?? '');
  }, null, { timeout: 15000 }).then(() => true, () => false);
  check('the quest tracker shows the next step', shown);
  await look(0, 0.1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/v6-quest-tracker.png` });
  await admin('quest_reset', { quest: 'lost_observatory' });
}

// An Elytra upgraded at a smithing table (through the window's clicks, as a player does it), then its tooltip
{
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'clear_inventory' }));
  await cmd('/gamemode survival');
  const given = await admin('give_set', { set: 'elytra_modules' });
  check('the Elytra and modules are given', given.ok);
  await page.waitForTimeout(800);
  const at = await here();
  const table = [Math.floor(at.x) + 2, Math.floor(at.y), Math.floor(at.z)];
  await cmd(`/fill ${table[0]} ${table[1]} ${table[2]} ${table[0]} ${table[1]} ${table[2]} smithing_table`);
  await cmd(`/fill ${table[0]} ${table[1] + 1} ${table[2]} ${table[0]} ${table[1] + 1} ${table[2]} air`);
  /** The hotbar slot holding an item (by id), or -1. */
  const hotbarOf = (id) => page.evaluate((id) => {
    const it = window.minehonkRegistry.itemById.get(id);
    const inv = window.minehonk.game.invSlots;
    for (let i = 0; i < 9; i++) if (inv[36 + i]?.id === it.num) return i;
    return -1;
  }, id);
  const click = (slot) => page.evaluate(([slot, seq]) => {
    const g = window.minehonk.game;
    g.send({ t: 'click', window: g.window.id, slot, button: 0, mode: 'pickup', seq });
  }, [slot, seqNo++]);
  for (const mod of ['reinforced_module', 'thrust_module', 'ender_blink_module']) {
    // (a new window each time: clicks for the last one, already closed, would be ignored)
    const before = await page.evaluate(() => window.minehonk.game.window?.id ?? -1);
    await useOnBlock(table[0], table[1], table[2]);
    const open = await page.waitForFunction((before) => {
      const w = window.minehonk.game.window;
      return !!w && w.kind === 'smithing' && w.id !== before;
    }, before, { timeout: 10000 }).then(() => true, () => false);
    await page.waitForTimeout(400);
    check(`the smithing table is open for the ${mod}`, open);
    // Elytra into the base slot, the module beside it, the result back into the hotbar
    const e = await hotbarOf('elytra');
    const m = await hotbarOf(mod);
    await click(30 + e);
    await page.waitForTimeout(300);
    await click(0);
    await page.waitForTimeout(300);
    await click(30 + m);
    await page.waitForTimeout(300);
    await click(1);
    await page.waitForTimeout(600);
    if (mod === 'ender_blink_module') await page.screenshot({ path: `${OUT}/v6-elytra-smithing.png` });
    await click(2);
    await page.waitForTimeout(300);
    await click(30 + e);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  const ups = await page.evaluate(() => {
    const g = window.minehonk.game;
    const it = window.minehonkRegistry.itemById.get('elytra');
    return g.invSlots.find((s) => s?.id === it.num)?.tag?.data?.upgrades ?? null;
  });
  check(`the Elytra carries three upgrades (${JSON.stringify(ups)})`, Array.isArray(ups) && ups.length === 3);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1500);
  let tip = '';
  const slots = page.locator('.slot');
  const n = await slots.count();
  for (let i = n - 1; i >= 0 && !/Upgrades/.test(tip); i--) {
    const box = await slots.nth(i).boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
    await page.waitForTimeout(120);
    tip = (await page.locator('.tooltip:not(.hidden)').textContent().catch(() => '')) ?? '';
  }
  check('the Elytra tooltip lists its upgrades', /Upgrades \(3\/3\)/.test(tip) && /Thrust/.test(tip) && /Ender Blink/.test(tip));
  await page.screenshot({ path: `${OUT}/v6-elytra-tooltip.png` });
  await page.keyboard.press('Escape');
  await cmd('/gamemode creative');
}

// ---------------------------------------------------------------- phase 5
await cmd('/gamemode creative');
const bannerText = () => page.evaluate(() => [...document.querySelectorAll('.hack-warn-text')].map((e) => e.textContent).join(' | '));
const bodyText = () => page.locator('body').innerText();
const look5 = () => page.evaluate(() => ({ ...window.minehonk.game.endEvents.look }));

// A Void Storm over the Astral End: the warning, the violet murk, debris marked where it will land
{
  const r = await adminTp('tp_biome', { biome: 'astral_end' });
  check('to the Astral End for the storm', r.ok);
  await waitChunks();
  await fly();
  await page.evaluate(() => (window.minehonk.game.player.body.y += 6));
  const s = await admin('storm_start');
  check('a Void Storm called from the Admin Panel', s.ok);
  await page.waitForTimeout(1200);
  check('its warning banner', /VOID STORM APPROACHING/.test(await bannerText()));
  await page.waitForTimeout(12000);
  const l = await look5();
  check(`the storm's sky (storm ${l.storm.toFixed(2)})`, l.storm > 0.5);
  await look(0.6, 0.25);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/v6-storm.png` });
  // A Storm Remnant rises near the player
  let rem = [];
  for (let i = 0; i < 20 && !rem.length; i++) {
    await page.waitForTimeout(1500);
    rem = await page.evaluate(() => {
      const g = window.minehonk.game;
      const w = g.world;
      const b = g.player.body;
      const want = new Set(['remnant_stone', 'remnant_bricks'].map((id) => window.minehonkRegistry.blockById.get(id).num));
      const blockOf = (st) => window.minehonkRegistry.blockOfState(st);
      const out = [];
      for (let x = Math.floor(b.x - 40); x <= b.x + 40; x++)
        for (let z = Math.floor(b.z - 40); z <= b.z + 40; z++)
          for (let y = Math.floor(b.y - 10); y <= b.y + 30; y++) {
            const st = w.getState(x, y, z);
            if (st && want.has(blockOf(st))) out.push([x, y, z]);
          }
      return out;
    });
  }
  check(`a Storm Remnant near the player (${rem.length} blocks)`, rem.length > 0);
  if (rem.length) {
    const c = rem.reduce((a, q) => [a[0] + q[0] / rem.length, a[1] + q[1] / rem.length, a[2] + q[2] / rem.length], [0, 0, 0]);
    const cam = { x: c[0] + 9, y: c[1] + 5, z: c[2] + 9 };
    await moveTo(cam.x, cam.y, cam.z);
    await aimAt(c[0], c[1], c[2]);
    await page.waitForTimeout(2000);
    await pin(cam.x, cam.y, cam.z);
    await aimAt(c[0], c[1], c[2]);
    await page.screenshot({ path: `${OUT}/v6-storm-remnant.png` });
  }
  check('the storm stops', (await admin('storm_stop')).ok);
}

// The End Eclipse: the dark disc ringed with light, stars through the fog, a monolith
{
  const e = await admin('eclipse_start');
  check('an End Eclipse called from the Admin Panel', e.ok);
  await page.waitForTimeout(12000);
  const l = await look5();
  check(`the eclipse's sky (eclipse ${l.eclipse.toFixed(2)})`, l.eclipse > 0.7);
  // Up towards the disc (high in the north-east)
  await look(Math.atan2(-0.35, 0.52), -0.75);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/v6-eclipse-sky.png` });
  let mono = [];
  for (let i = 0; i < 10 && !mono.length; i++) {
    await page.waitForTimeout(1500);
    mono = await page.evaluate(() => {
      const g = window.minehonk.game;
      const w = g.world;
      const b = g.player.body;
      const want = window.minehonkRegistry.blockById.get('monolith_obsidian').num;
      const out = [];
      for (let x = Math.floor(b.x - 40); x <= b.x + 40; x++)
        for (let z = Math.floor(b.z - 40); z <= b.z + 40; z++)
          for (let y = Math.floor(b.y - 30); y <= b.y + 30; y++) {
            const st = w.getState(x, y, z);
            if (st && window.minehonkRegistry.blockOfState(st) === want) out.push([x, y, z]);
          }
      return out;
    });
  }
  check(`Eclipse Monoliths near the player (${mono.length} blocks)`, mono.length > 0);
  if (mono.length) {
    const m0 = mono[0];
    const col = mono.filter((q) => Math.abs(q[0] - m0[0]) <= 2 && Math.abs(q[2] - m0[2]) <= 2);
    const c = col.reduce((a, q) => [a[0] + q[0] / col.length, a[1] + q[1] / col.length, a[2] + q[2] / col.length], [0, 0, 0]);
    const cam = { x: c[0] + 8, y: c[1] + 2, z: c[2] + 8 };
    await moveTo(cam.x, cam.y, cam.z);
    await aimAt(c[0], c[1] + 1, c[2]);
    await page.waitForTimeout(2000);
    await pin(cam.x, cam.y, cam.z);
    await aimAt(c[0], c[1] + 1, c[2]);
    await page.screenshot({ path: `${OUT}/v6-eclipse-monolith.png` });
  }
  check('the eclipse ends', (await admin('eclipse_stop')).ok);
}

/** Every fx message the client gets from now on (telegraphs, banners), for framing shots. */
await page.evaluate(() => {
  const g = window.minehonk.game;
  window.__fx = [];
  const orig = g.onMessage.bind(g);
  g.onMessage = (m) => {
    if (m.t === 'fx') window.__fx.push(m);
    return orig(m);
  };
});
const fxSince = (n, kinds) => page.evaluate(([n, kinds]) => window.__fx.slice(n).filter((m) => kinds.includes(m.kind)), [n, kinds]);
const fxCount = () => page.evaluate(() => window.__fx.length);
/** The top of the ground under (x, z), searched down from y0 (null over the void). */
const topAt = (x, z, y0 = 120) =>
  page.evaluate(([x, z, y0]) => {
    const w = window.minehonk.game.world;
    for (let y = y0; y > 0; y--) if (w.getState(Math.floor(x), y, Math.floor(z))) return y;
    return null;
  }, [x, z, y0]);

// The Void Citadel: found (a title), from outside, a puzzle floor and the parkour shaft
let cit = null;
{
  const r = await adminTp('citadel_tp', { spot: 'entrance' });
  check('to the Void Citadel', r.ok);
  await waitChunks();
  await page.waitForTimeout(3000);
  check('its title', /THE VOID CITADEL/.test(await bodyText()));
  cit = (await admin('status')).data?.citadel ?? null;
  check('the Citadel has a site', !!cit?.site);
  if (cit?.site) {
    const [cx, cz] = cit.site;
    const ey = cit.entrance?.[1] ?? 100;
    // From above one corner: the island on top, its entrance hall, and the tower hanging down into the void
    const cam = { x: cx + 30, y: ey + 6, z: cz + 30 };
    await moveTo(cam.x, cam.y, cam.z);
    await aimAt(cx, ey - 25, cz);
    await page.waitForTimeout(5000);
    await pin(cam.x, cam.y, cam.z);
    await aimAt(cx, ey - 25, cz);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/v6-citadel-exterior.png` });
    const floors = cit.floors ?? [];
    const glyph = floors.findIndex((f) => f.kind === 'glyph');
    const park = floors.findIndex((f) => f.kind === 'parkour');
    check('a Glyph Lock floor and a parkour floor', glyph >= 0 && park >= 0);
    if (glyph >= 0) {
      const g = await adminTp('citadel_tp', { spot: String(glyph + 1) });
      check('to the Glyph Lock floor', g.ok);
      await waitChunks();
      await page.waitForTimeout(2000);
      const murals = await page.evaluate(() => {
        const g = window.minehonk.game;
        const w = g.world;
        const b = g.player.body;
        const want = window.minehonkRegistry.blockById.get('citadel_glyph').num;
        const out = [];
        for (let x = Math.floor(b.x - 40); x <= b.x + 40; x++)
          for (let z = Math.floor(b.z - 40); z <= b.z + 40; z++)
            for (let y = Math.floor(b.y - 4); y <= b.y + 10; y++) {
              const st = w.getState(x, y, z);
              if (st && window.minehonkRegistry.blockOfState(st) === want) out.push([x, y, z]);
            }
        return out;
      });
      check(`the mural is there (${murals.length} glyphs)`, murals.length >= 3);
      if (murals.length) {
        const c = murals.reduce((a, q) => [a[0] + q[0] / murals.length, a[1] + q[1] / murals.length, a[2] + q[2] / murals.length], [0, 0, 0]);
        // Stand in the room facing the mural (a real move: the server checks every one)
        const inward = [cx - c[0], cz - c[2]];
        const d = Math.hypot(...inward) || 1;
        const cam = { x: c[0] + 0.5 + (inward[0] / d) * 9, y: c[1] - 1, z: c[2] + 0.5 + (inward[1] / d) * 9 };
        await moveTo(cam.x, cam.y, cam.z);
        await aimAt(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
        await page.waitForTimeout(1500);
        await pin(cam.x, cam.y, cam.z);
        await aimAt(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
        await page.screenshot({ path: `${OUT}/v6-citadel-glyph.png` });
      }
    }
    if (park >= 0) {
      const g = await adminTp('citadel_tp', { spot: String(park + 1) });
      check('to the parkour floor', g.ok);
      await waitChunks();
      await page.waitForTimeout(2000);
      const lights = await page.evaluate(() => {
        const g = window.minehonk.game;
        const w = g.world;
        const b = g.player.body;
        const want = window.minehonkRegistry.blockById.get('ender_light').num;
        const tiles = window.minehonkRegistry.blockById.get('citadel_tiles').num;
        const out = [];
        for (let x = Math.floor(b.x - 40); x <= b.x + 40; x++)
          for (let z = Math.floor(b.z - 40); z <= b.z + 40; z++)
            for (let y = Math.floor(b.y - 4); y <= b.y + 4; y++) {
              const st = w.getState(x, y, z);
              const id = st ? window.minehonkRegistry.blockOfState(st) : -1;
              if (id === want || (id === tiles && (Math.abs(x - g.player.body.x) > 18 || Math.abs(z - g.player.body.z) > 18))) out.push([x, y, z]);
            }
        return out;
      });
      check(`the route over the void (${lights.length} blocks)`, lights.length > 10);
      // Outside the tower's west face, looking down the route
      const fy = Math.floor(await page.evaluate(() => window.minehonk.game.player.body.y));
      const cam = { x: cx - 32, y: fy + 6, z: cz - 6 };
      await moveTo(cam.x, cam.y, cam.z);
      await aimAt(cx - 21, fy - 1, cz + 4);
      await page.waitForTimeout(2500);
      await pin(cam.x, cam.y, cam.z);
      await aimAt(cx - 21, fy - 1, cz + 4);
      await page.screenshot({ path: `${OUT}/v6-citadel-parkour.png` });
    }
  }
}

// The End Guardian: each phase, then its fall (a victory title, never an ending card)
{
  const r = await adminTp('citadel_tp', { spot: 'arena' });
  check('to the arena', r.ok);
  await waitChunks();
  await page.waitForTimeout(2000);
  const site = (await admin('status')).data?.citadel?.site;
  const sp = await admin('guardian_spawn');
  check('the Guardian wakes (Admin Panel)', sp.ok);
  await page.waitForTimeout(4000);
  // From a corner of the arena's hall, high enough to see over its shoulders
  const corner = site ? { x: site[0] + 14.5, y: 25, z: site[1] + 14.5 } : null;
  if (corner) await moveTo(corner.x, corner.y, corner.z);
  const shotGuardian = async (name) => {
    const at = () =>
      page.evaluate(() => {
        const e = [...window.minehonk.game.entities.values()].find((x) => x.type === 'end_guardian');
        return e ? [e.x, e.y, e.z] : null;
      });
    let gp = await at();
    if (!gp) return false;
    if (corner) await pin(corner.x, corner.y, corner.z);
    await aimAt(gp[0], gp[1] + 2.5, gp[2]);
    await page.waitForTimeout(800);
    gp = (await at()) ?? gp;
    await aimAt(gp[0], gp[1] + 2.5, gp[2]);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    return true;
  };
  check('phase 1 (AWAKENING) on screen', await shotGuardian('v6-guardian-phase1'));
  check('to phase 2', (await admin('guardian_phase')).ok);
  await page.waitForTimeout(3500);
  check('phase 2 (VOID SHIFT): its pylons up', await page.evaluate(() => [...window.minehonk.game.entities.values()].filter((x) => x.type === 'guardian_pylon').length === 4));
  await shotGuardian('v6-guardian-phase2');
  check('to phase 3', (await admin('guardian_phase')).ok);
  await page.waitForTimeout(3500);
  await shotGuardian('v6-guardian-phase3');
  check('its defeat (forced: nothing counts)', (await admin('guardian_defeat')).ok);
  await page.waitForTimeout(1500);
  check('the victory title', /THE END GUARDIAN HAS FALLEN/.test(await bodyText()));
  await page.screenshot({ path: `${OUT}/v6-guardian-victory.png` });
  check('no ending card', (await page.locator('.ending-card:not(.hidden)').count()) === 0);
  await page.waitForTimeout(4000);
  await admin('guardian_reset');
}

// The Dragon's new moves, one at a time (a respawned, cheat-made dragon)
{
  const r = await adminTp('tp_portal');
  check('back to the main island', r.ok);
  await waitChunks();
  await cmd('/gamemode survival');
  await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'flight', on: true }));
  await fly();
  const rs = await admin('dragon_respawn');
  check('the Dragon respawned (Admin Panel)', rs.ok);
  await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'ender_dragon'), null, { timeout: 60000 }).catch(() => {});
  const dragonAt = () =>
    page.evaluate(() => {
      const e = [...window.minehonk.game.entities.values()].find((x) => x.type === 'ender_dragon');
      return e ? { x: e.x, y: e.y, z: e.z, phase: e.meta?.phase ?? null } : null;
    });
  const heal = () => page.evaluate(() => window.minehonk.game.adminRequest({ a: 'heal' }));
  const portalY = (await topAt(0.5, 0.5, 90)) ?? 64;
  /** Somewhere on the island to stand (hovering a little over the ground). */
  const standAt = async (x, z, up = 3) => {
    const gy = (await topAt(x, z, 100)) ?? portalY;
    await moveTo(x, gy + 1 + up, z);
    return gy + 1 + up;
  };
  /** Frames a telegraph (from the fx it sent) and the Dragon together, from where the player stands. */
  const frame = async (tele) => {
    const d = await dragonAt();
    const b = await page.evaluate(() => ({ ...window.minehonk.game.player.body }));
    const tx = tele ? (tele.x1 !== undefined ? (tele.x + tele.x1) / 2 : tele.x) : b.x;
    const ty = tele ? (tele.y1 !== undefined ? (tele.y + tele.y1) / 2 : tele.y) : b.y;
    const tz = tele ? (tele.z1 !== undefined ? (tele.z + tele.z1) / 2 : tele.z) : b.z;
    if (!d) return aimAt(tx, ty, tz);
    // Between the two, nearer the telegraph
    const k = Math.min(0.5, 14 / Math.max(1, Math.hypot(d.x - tx, d.z - tz)));
    await aimAt(tx + (d.x - tx) * k, ty + (d.y + 2 - ty) * k, tz + (d.z - tz) * k);
  };
  // The lowest crystal: beside its pillar, it is the nearest one
  const crystals = await page.evaluate(() => [...window.minehonk.game.entities.values()].filter((e) => e.type === 'end_crystal').map((e) => [e.x, e.y, e.z]));
  crystals.sort((a, b) => a[1] - b[1]);
  for (const t of ['breath_wave', 'strafing_dive', 'edge_strike', 'crystal_fury', 'pillar_weave', 'dragon_storm', 'roar', 'wing_gust']) {
    await heal();
    // Where to stand for each: mid-island for the line attacks, beside a crystal's pillar for its fury,
    // well back from the portal (outside the gust) for what it does when it lands
    if (t === 'breath_wave' || t === 'strafing_dive' || t === 'edge_strike' || t === 'dragon_storm') await standAt(-14.5, 18.5, 4);
    else if (t === 'crystal_fury' && crystals.length) {
      const c = crystals[0];
      const d = Math.hypot(c[0], c[2]) || 1;
      await moveTo(c[0] - (c[0] / d) * 6, c[1] - 4, c[2] - (c[2] / d) * 6);
    } else if (t === 'pillar_weave') await moveTo(-20.5, portalY + 40, 52.5);
    else await standAt(-16.5, 9.5, 5);
    const n0 = await fxCount();
    const res = await admin('dragon_test', { test: t });
    check(`Dragon test: ${t} (${res.text})`, res.text.length > 0);
    let tele = null;
    if (t === 'roar' || t === 'wing_gust') {
      // These come when it lands on the portal
      await page.waitForFunction(() => [...window.minehonk.game.entities.values()].some((e) => e.type === 'ender_dragon' && e.meta?.phase === 'perch'), null, { timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(t === 'roar' ? 300 : 700);
      await aimAt(0.5, portalY + 4, 0.5);
    } else if (t === 'dragon_storm' || t === 'pillar_weave') {
      await page.waitForTimeout(t === 'dragon_storm' ? 4000 : 2500);
      const d = await dragonAt();
      if (d) await aimAt(d.x, d.y + 2, d.z);
    } else {
      const kinds = t === 'edge_strike' ? ['warn_circle'] : ['warn_beam'];
      for (let i = 0; i < 60 && !tele; i++) {
        await page.waitForTimeout(150);
        tele = (await fxSince(n0, kinds))[0] ?? null;
      }
      if (tele && (t === 'breath_wave' || t === 'strafing_dive')) {
        // From past the far end of its line, looking back along it at the Dragon
        const len = Math.hypot(tele.x1 - tele.x, tele.z1 - tele.z) || 1;
        const ux = (tele.x1 - tele.x) / len;
        const uz = (tele.z1 - tele.z) / len;
        await moveTo(tele.x1 + ux * 8 - uz * 5, tele.y1 + 6, tele.z1 + uz * 8 + ux * 5);
        await frame(tele);
      } else if (tele && t === 'edge_strike') {
        // From the island, a little above the marked edge
        const d = Math.hypot(tele.x, tele.z) || 1;
        await moveTo(tele.x - (tele.x / d) * 16, tele.y + 8, tele.z - (tele.z / d) * 16);
        await aimAt(tele.x, tele.y + 1, tele.z);
      } else if (tele && t === 'crystal_fury') await aimAt(tele.x, tele.y - 1, tele.z);
      else await frame(tele);
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/v6-dragon-${t.replace(/_/g, '-')}.png` });
  }
  await cmd('/gamemode creative');
}

// The title screen: V6's four scenes and its edition
for (const scene of ['expanded_end', 'crystal_fields', 'void_citadel', 'end_eclipse']) {
  await page.goto(`http://localhost:${PORT}/?title=${scene}`);
  await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
  await page.waitForTimeout(scene === 'void_citadel' ? 16000 : 12000);
  await page.screenshot({ path: `${OUT}/v6-title-${scene.replace(/_/g, '-')}.png` });
}
check('the edition: V6 - The End Expansion', ((await page.locator('.logo-edition').textContent()) ?? '').includes('V6 - The End Expansion'));

check('no page errors', errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `V6 E2E: FAIL (${failed.map(([n]) => n).join(', ')})` : 'V6 E2E: PASS');
process.exit(failed.length ? 1 : 0);
