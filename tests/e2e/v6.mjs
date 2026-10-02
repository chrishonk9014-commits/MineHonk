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
 * Nest from inside and its crack. Screenshots go to tests/e2e/out/v6-*.png.
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
  const beast = (await entitiesOf('chorus_beast'))[0];
  if (beast) await page.evaluate((id) => window.minehonk.game.send({ t: 'attack', id }), beast.id);
  await page.waitForTimeout(300);
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

/** Looks at a structure from a camera spot outside it, then screenshots it. */
const view = async (id, cam, wait) => {
  await goTo(cam.x, cam.y, cam.z);
  await page.evaluate(([x, y, z]) => {
    const b = window.minehonk.game.player.body;
    b.x = x;
    b.y = y;
    b.z = z;
  }, [cam.x, cam.y, cam.z]);
  await look(cam.yaw, cam.pitch);
  await page.waitForTimeout(wait);
  await look(cam.yaw, cam.pitch);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/v6-structure-${id}.png` });
};

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

// Walking into a giant: its title, once (the music sting plays with it)
{
  const id = KINDS.find((k) => GIANTS.has(k) && sites3.structures[k]);
  const at = sites3.structures[id];
  await goTo(at.x + 0.5, at.y + 3, at.z + 0.5);
  const title = await page.waitForFunction(() => /^THE /.test(document.querySelector('.title-overlay')?.innerText ?? ''), null, { timeout: 20000 }).then(() => true, () => false);
  check(`walking into the ${id} shows its title`, title);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/v6-discovery-title.png` });
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
    const cam = { x: ent[0] + 0.5, y: ent[1] + 12, z: ent[2] + 7.5 };
    await goTo(cam.x, cam.y, cam.z);
    await page.evaluate(([x, y, z]) => {
      const b = window.minehonk.game.player.body;
      b.x = x;
      b.y = y;
      b.z = z;
    }, [cam.x, cam.y, cam.z]);
    await look(0, 0.95);
    await page.waitForTimeout(2500);
    const open = await page.evaluate(([x, y, z]) => window.minehonk.game.world.getState(x, y, z), [ent[0], ent[1] - 1, ent[2] - 3]);
    check('the crack is open in the ground', open === 0);
    await page.screenshot({ path: `${OUT}/v6-dragon-nest-crack.png` });
  }
}

check('no page errors', errors.length === 0);
await browser.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `V6 E2E: FAIL (${failed.map(([n]) => n).join(', ')})` : 'V6 E2E: PASS');
process.exit(failed.length ? 1 : 0);
