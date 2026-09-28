/**
 * Where does frame time go in a wide view? Renders the same overlook with
 * variations of the chunk shaders and settings and reports the frame time of
 * each (software WebGL, so fragment and vertex work both show).
 *   npx vite build && node tools/perf/shader-cost.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4178;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve()));
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill('bench-seed');
const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
if ((await cheatsOff.count()) > 0) await cheatsOff.click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
await page.waitForFunction(() => {
  const l = document.querySelector('.loading');
  return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
}, null, { timeout: 180000 });
const cmd = async (t) => {
  await page.evaluate((x) => window.minehonk.game.send({ t: 'chat', text: x }), t);
  await page.waitForTimeout(1500);
};
await cmd('/gamemode creative');
const p0 = await page.evaluate(() => {
  const b = window.minehonk.game.player.body;
  return [Math.round(b.x), Math.round(b.y), Math.round(b.z)];
});
await cmd(`/tp ${p0[0]} ${p0[1] + 45} ${p0[2]}`);
await page.evaluate(() => (window.minehonk.game.player.flying = true));
await page.waitForTimeout(60000);
await page.evaluate(() => Object.assign(window.minehonk.game.player, { yaw: 2.2, pitch: 0.35 }));

/** Average frame time with the game frozen, rendering the same frame repeatedly. */
async function frameMs(label) {
  const ms = await page.evaluate(async () => {
    const g = window.minehonk.game;
    g.running = false;
    cancelAnimationFrame(g.rafId);
    const gl = g.renderer.renderer.getContext();
    const px = new Uint8Array(4);
    // warm up (shader compile)
    g.render(0, 16);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    const N = 8;
    for (let i = 0; i < N; i++) {
      g.render(0, 16);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the frame to finish
    }
    const dt = (performance.now() - t0) / N;
    g.running = true;
    g.last = performance.now();
    g.rafId = requestAnimationFrame(g.frame);
    return dt;
  });
  const info = await page.evaluate(() => {
    const r = window.minehonk.game.renderer.renderer.info.render;
    return `${r.calls} calls, ${r.triangles} tris`;
  });
  console.log(`${label.padEnd(44)} ${ms.toFixed(1)} ms/frame (${info})`);
  return ms;
}

const setFrag = (fn) =>
  page.evaluate((src) => {
    const mats = window.minehonk.game.renderer.chunks.materials;
    const orig = (window.__origFrag ??= mats.map((m) => m.fragmentShader));
    // eslint-disable-next-line no-new-func
    const f = new Function('s', `return (${src})(s)`);
    mats.forEach((m, i) => {
      m.fragmentShader = f(orig[i]);
      m.needsUpdate = true;
    });
  }, fn.toString());

await frameMs('current');
await setFrag((s) => s.replace(/textureGrad\(uAtlas, uv, [^;]*\);/, 'texture(uAtlas, uv);'));
await frameMs('texture() instead of textureGrad (seams)');
await setFrag((s) => s.replace('void main() {', 'void main() { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return;'));
await frameMs('flat colour fragment shader');
await setFrag((s) => s);
await page.evaluate(() => (window.minehonk.game.renderer.chunks.facingCull = false));
await frameMs('no face-direction culling');
await page.evaluate(() => (window.minehonk.game.renderer.chunks.facingCull = true));
const layers = (v) => page.evaluate((vis) => window.minehonk.game.renderer.chunks.group.children.forEach((m) => (m.visible = vis(m.name))), v.toString());
await page.evaluate(() => {
  const cr = window.minehonk.game.renderer.chunks;
  const orig = cr.buildDrawLists.bind(cr);
  // Keep a layer filter across renders (buildDrawLists sets visibility every frame)
  cr.buildDrawLists = (cam) => {
    orig(cam);
    if (window.__layerFilter) for (const m of cr.group.children) if (!window.__layerFilter(m.name)) m.visible = false;
  };
});
const filter = (src) => page.evaluate((s) => (window.__layerFilter = s ? new Function('n', `return (${s})(n)`) : null), src);
await filter('(n) => false');
await frameMs('no terrain at all (sky, entities, hand)');
await filter("(n) => n === 'opaque'");
await frameMs('opaque terrain only');
await filter("(n) => n !== 'cutout'");
await frameMs('without cutout (leaves, plants)');
await filter("(n) => n !== 'translucent'");
await frameMs('without translucent (water, glass)');
await filter(null);
void layers;
await page.evaluate(() => {
  const m = window.minehonk.game.renderer.chunks.materials[2];
  m.side = 0; // FrontSide
  m.needsUpdate = true;
});
await frameMs('cutout single-sided');
await page.evaluate(() => {
  const m = window.minehonk.game.renderer.chunks.materials[2];
  m.side = 2; // DoubleSide
  m.needsUpdate = true;
});
await page.evaluate(() => (window.minehonk.game.renderer.chunks.occlusion = false));
await frameMs('no cave culling');
await page.evaluate(() => (window.minehonk.game.renderer.chunks.occlusion = true));
// Leaves: Fast (faces between neighbouring leaves are culled)
await page.evaluate(() => {
  const g = window.minehonk.game;
  g.settings.fancyLeaves = false;
  g.renderer.chunks.rebuildAll();
});
await page.waitForFunction(() => {
  const s = window.minehonk.game.renderer.chunks.stats();
  return s.dirty === 0 && s.jobs === 0;
}, null, { timeout: 120000, polling: 500 });
await frameMs('Leaves: Fast');
await page.evaluate(() => (window.minehonk.game.renderer.chunks.occlusion = true));
await page.evaluate(() => (window.minehonk.game.renderer.renderer.setPixelRatio(0.5)));
await frameMs('half resolution');
await browser.close();
stop();
process.exit(0);
