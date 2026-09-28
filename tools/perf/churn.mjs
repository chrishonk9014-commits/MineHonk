/**
 * Why do sections keep re-meshing in a still scene? Loads a world, waits, then
 * counts chunk, block and light updates from the server for a while.
 *   npx vite build && node tools/perf/churn.mjs [seconds]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const SECONDS = Number(process.argv[2] ?? 20);
const PORT = 4177;
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
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
await page.evaluate(() => (window.minehonk.settings.renderDistance = Number(new URLSearchParams(location.search).get('rd') ?? 8)));
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill('bench-seed');
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
await page.waitForFunction(() => {
  const l = document.querySelector('.loading');
  return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
}, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = window.minehonk.game;
  const w = g.world;
  const C = (window.__churn = { chunk: 0, rechunk: 0, block: 0, light: 0, dirty: 0, jobs: 0, msgs: {}, lightAt: {}, blockAt: {} });
  const load = w.loadChunk.bind(w);
  w.loadChunk = (data) => {
    const before = w.chunks.size;
    const c = load(data);
    if (w.chunks.size === before) C.rechunk++;
    else C.chunk++;
    return c;
  };
  const setBlock = w.setBlock.bind(w);
  w.setBlock = (x, y, z, s) => {
    C.block++;
    const k = `${x >> 4},${z >> 4}`;
    C.blockAt[k] = (C.blockAt[k] ?? 0) + 1;
    return setBlock(x, y, z, s);
  };
  const setLight = w.setLightSection.bind(w);
  w.setLightSection = (cx, cz, sy, d) => {
    C.light++;
    const k = `${cx},${cz},${sy}`;
    C.lightAt[k] = (C.lightAt[k] ?? 0) + 1;
    return setLight(cx, cz, sy, d);
  };
  const cr = g.renderer.chunks;
  const mark = cr.markDirty.bind(cr);
  cr.markDirty = (...a) => {
    C.dirty++;
    return mark(...a);
  };
  const onMsg = g.conn.onMessage;
  g.conn.onMessage = (m) => {
    C.msgs[m.t] = (C.msgs[m.t] ?? 0) + 1;
    return onMsg(m);
  };
});
for (let t = 0; t < 4; t++) {
  const before = await page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__churn, lightAt: undefined, blockAt: undefined })));
  await page.waitForTimeout(SECONDS * 250);
  const after = await page.evaluate(() => {
    const C = window.__churn;
    const g = window.minehonk.game;
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { ...C, lightAt: top(C.lightAt), blockAt: top(C.blockAt), chunks: g.world.chunks.size, stats: g.renderer.chunks.stats(), meshed: g.renderer.chunks.meshedLastSecond };
  });
  const d = (k) => after[k] - before[k];
  console.log(`t+${((t + 1) * SECONDS) / 4}s: chunks ${after.chunks} new ${d('chunk')} resent ${d('rechunk')} | blocks ${d('block')} | light sections ${d('light')} | markDirty ${d('dirty')} | meshed/s ${after.meshed} | pending ${after.stats.dirty} jobs ${after.stats.jobs}`);
  const msgs = Object.fromEntries(Object.entries(after.msgs).map(([k, v]) => [k, v - (before.msgs[k] ?? 0)]).filter(([, v]) => v > 0));
  console.log('   messages', JSON.stringify(msgs));
  console.log('   top light sections', JSON.stringify(after.lightAt), 'top block chunks', JSON.stringify(after.blockAt));
}
await browser.close();
stop();
process.exit(0);
