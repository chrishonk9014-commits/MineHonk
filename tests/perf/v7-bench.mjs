/**
 * V7 phase 5: the Halloween Update against V6.5, on the same machine, seed
 * and view distance. Serves a build (either version), creates a Creative world
 * with cheats on the seed with a Trick-or-Treat Village (v7-villages), and
 * measures: the village at night with ghosts, a Trick Home's fight (V6.5: the
 * same house with the same monsters), and plain terrain by day. Server tick
 * time comes from /tps after each.
 *
 *   npx vite build --outDir dist-bench-v7          (and the V6.5 checkout's build)
 *   LABEL=v7 node tests/perf/v7-bench.mjs dist-bench-v7
 *   LABEL=v6.5 TRICK_AT=<from the V7 run> node tests/perf/v7-bench.mjs dist-bench-v65
 *
 * Results are printed and written to tests/perf/out/<label>.json.
 * Headless Chromium uses software WebGL (SwiftShader), so absolute FPS is far
 * below a real GPU. Compare runs made on the same machine, and read the main
 * thread JS time and draw calls, which carry over to real hardware.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DIST = process.argv[2] ?? 'dist-bench';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const LABEL = process.env.LABEL ?? 'run';
const MEASURE_MS = Number(process.env.MEASURE_MS ?? 8000);
const VIEW = (process.env.VIEW ?? '1280x720').split('x').map(Number);
const RENDER_DISTANCE = process.env.RD ? Number(process.env.RD) : null;
const OUT = path.resolve('tests/perf/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 4191);

/** Resident memory (MB) of Chromium's renderer and GPU processes, sampled from ps. */
function processRss() {
  let renderer = 0;
  let gpu = 0;
  try {
    for (const line of execSync('ps -eo rss=,args=', { encoding: 'utf8' }).split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!m || !m[2].includes('chrom')) continue;
      const mb = Number(m[1]) / 1024;
      if (m[2].includes('--type=renderer')) renderer = Math.max(renderer, mb);
      else if (m[2].includes('--type=gpu-process')) gpu = Math.max(gpu, mb);
    }
  } catch {
    /* ps missing */
  }
  return { renderer: Math.round(renderer), gpu: Math.round(gpu) };
}
// Peak renderer memory between measurements, so a runaway scenario is visible even if it crashes
const rssPeak = { renderer: 0, gpu: 0 };
setInterval(() => {
  const r = processRss();
  rssPeak.renderer = Math.max(rssPeak.renderer, r.renderer);
  rssPeak.gpu = Math.max(rssPeak.gpu, r.gpu);
  if (process.env.RSS_LOG && r.renderer > 4000) console.log(`  renderer rss ${r.renderer} MB`);
}, 2000).unref();

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No build in ${DIST}. Run: npx vite build --minify false --outDir ${DIST}`);
  process.exit(1);
}
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  // UNCAPPED=1 renders without vsync. With software WebGL that lets the page queue
  // frames far faster than they can be drawn, which shows up as huge stalls and memory.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
const page = await browser.newPage({ viewport: { width: VIEW[0], height: VIEW[1] } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[error]', m.text());
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });

await page.goto(`http://localhost:${PORT}/?clock=2026-10-20T12:00:00Z`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
if (RENDER_DISTANCE) await page.evaluate((rd) => (window.minehonk.settings.renderDistance = rd), RENDER_DISTANCE);
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill(process.env.SEED ?? 'v7-villages');
for (let i = 0; i < 6; i++) {
  const txt = await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).textContent();
  if (txt.includes('Creative')) break;
  await page.locator('.screen:not(.hidden) button', { hasText: 'Game Mode:' }).click();
}
const cheatsOff = page.locator('.screen:not(.hidden) button', { hasText: 'Allow Cheats: OFF' });
if ((await cheatsOff.count()) > 0) await cheatsOff.click();
await page.locator('.screen:not(.hidden) button', { hasText: 'Create New World' }).last().click();
const tJoin = Date.now();
await page.waitForFunction(() => {
  const l = document.querySelector('.loading');
  return l && l.classList.contains('hidden') && window.minehonk?.game?.joined;
}, null, { timeout: 180000 });
const joinMs = Date.now() - tJoin;
console.log(`world ready in ${joinMs} ms (render distance ${await page.evaluate(() => window.minehonk.settings.renderDistance)})`);

// ------------------------------------------------------------------ instrumentation
await page.evaluate(() => {
  const g = window.minehonk.game;
  const r = g.renderer;
  const B = (window.__bench = { on: false, frames: [], mesh: [], last: 0, chat: [] });
  // Setup commands pause rendering so the (CPU-starved) integrated server can keep up
  const origRender = g.render.bind(g);
  g.render = (...args) => {
    if (!B.pause) origRender(...args);
  };
  const origAdd = g.chat.add.bind(g.chat);
  g.chat.add = (text, ...rest) => {
    B.chat.push(String(text));
    return origAdd(text, ...rest);
  };
  const origFrame = g.frame;
  // Count every pass of a frame (world, hand, overlay), not just the last one
  r.renderer.info.autoReset = false;
  g.frame = (now) => {
    r.renderer.info.reset();
    const t0 = performance.now();
    origFrame(now);
    if (!B.on) return;
    const t1 = performance.now();
    const info = r.renderer.info.render;
    B.frames.push([now - B.last, t1 - t0, info.calls, info.triangles]);
    B.last = now;
  };
  const cr = r.chunks;
  const origMsg = cr.onWorkerMessage.bind(cr);
  cr.onWorkerMessage = (wi, m) => {
    if (B.on && m && m.type === 'mesh') B.mesh.push(m.ms);
    origMsg(wi, m);
  };
  // re-bind worker handlers to the wrapper
  cr.workers?.forEach((w, i) => (w.onmessage = (ev) => cr.onWorkerMessage(i, ev.data)));
});

const wait = (ms) => page.waitForTimeout(ms);
const chatLines = () => page.evaluate(() => window.__bench.chat);
/** Sends a command and waits for the server's reply, retrying when rate limited (a slow server drains the chat budget slowly). */
/** Menus pause the single-player server (and with it the chat rate limit): close any that are open. */
const noMenus = () =>
  page.evaluate(() => {
    const app = window.minehonk;
    for (let i = 0; i < 5 && app.screenOpen; i++) app.pop();
  });
const cmd = async (text) => {
  await noMenus();
  await page.evaluate(() => (window.__bench.pause = true));
  try {
    return await sendCmd(text);
  } finally {
    await page.evaluate(() => (window.__bench.pause = false));
  }
};
const sendCmd = async (text) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = (await chatLines()).length;
    await page.evaluate((t) => window.minehonk.game.send({ t: 'chat', text: t }), text);
    let reply = null;
    for (let i = 0; i < 40 && reply === null; i++) {
      await wait(250);
      const lines = await chatLines();
      if (lines.length > before) reply = lines.slice(before).join(' | ');
    }
    if (reply && reply.includes('too quickly')) {
      await wait(4000);
      continue;
    }
    if (process.env.VERBOSE) console.log(`  ${text} -> ${reply}`);
    await wait(300);
    return reply;
  }
  console.log(`  command gave up: ${text}`);
  return null;
};
/**
 * Waits until terrain streaming is done: nothing queued for meshing and the
 * loaded chunk and section counts unchanged for 3 seconds. (A fast mesher
 * empties its queue between chunk batches, so "queue empty" alone is not enough.)
 */
let lastSettleMs = 0;
const settle = async (maxMs = 30000) => {
  const t0 = Date.now();
  let last = '';
  let stableSince = 0;
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => {
      const g = window.minehonk.game;
      const st = g.renderer.chunks.stats();
      const l = document.querySelector('.loading');
      return { busy: st.dirty + st.jobs, key: `${g.world.chunks.size}/${st.sections}`, loading: !(l && l.classList.contains('hidden')) };
    });
    const quiet = s.busy === 0 && !s.loading && s.key === last;
    last = s.key;
    if (!quiet) stableSince = 0;
    else if (!stableSince) stableSince = Date.now();
    else if (Date.now() - stableSince >= 3000) break;
    await wait(250);
  }
  lastSettleMs = Date.now() - t0;
  return lastSettleMs;
};
const setLook = (yaw, pitch) => page.evaluate(([y, p]) => Object.assign(window.minehonk.game.player, { yaw: y, pitch: p }), [yaw, pitch]);
const lastChat = async () => (await chatLines()).slice(-3);

async function measure(name, during) {
  await noMenus();
  await page.evaluate(() => {
    window.__bench.frames = [];
    window.__bench.mesh = [];
    window.__bench.last = performance.now();
    window.__bench.on = true;
    if (window.gc) window.gc();
  });
  const mem0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  const job = during ? during() : null;
  await wait(MEASURE_MS);
  if (job) await job;
  const { profile } = await cdp.send('Profiler.stop');
  const data = await page.evaluate(() => {
    const B = window.__bench;
    B.on = false;
    const g = window.minehonk.game;
    return {
      frames: B.frames.slice(1),
      mesh: B.mesh,
      mem: performance.memory?.usedJSHeapSize ?? 0,
      chunks: g.world.chunks.size,
      sections: g.renderer.chunks.stats(),
      entities: g.entities.size,
      dim: g.dimension,
      pos: [g.player.body.x, g.player.body.y, g.player.body.z].map(Math.round),
    };
  });
  const wall = Date.now() - t0;
  const dts = data.frames.map((f) => f[0]).filter((d) => d > 0);
  const js = data.frames.map((f) => f[1]);
  const sorted = [...dts].sort((a, b) => a - b);
  const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const res = {
    name,
    frames: dts.length,
    avgFps: +(dts.length / (wall / 1000)).toFixed(1),
    avgFrameMs: +avg(dts).toFixed(2),
    p95FrameMs: +pct(sorted, 0.95).toFixed(1),
    maxFrameMs: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
    minFps: +(1000 / (pct(sorted, 0.99) || 1)).toFixed(1),
    avgJsMs: +avg(js).toFixed(2),
    p95JsMs: +pct([...js].sort((a, b) => a - b), 0.95).toFixed(2),
    avgDrawCalls: Math.round(avg(data.frames.map((f) => f[2]))),
    avgTriangles: Math.round(avg(data.frames.map((f) => f[3]))),
    meshJobs: data.mesh.length,
    avgMeshMs: +avg(data.mesh).toFixed(2),
    heapMB: +(data.mem / 1048576).toFixed(1),
    heapDeltaMB: +((data.mem - mem0) / 1048576).toFixed(1),
    chunks: data.chunks,
    meshes: data.sections.meshes,
    pending: data.sections.dirty,
    entities: data.entities,
    dim: data.dim,
    pos: data.pos,
    hot: hotFunctions(profile, 12),
    settleMs: lastSettleMs,
    rssMB: processRss().renderer,
    rssPeakMB: rssPeak.renderer,
    gpuRssMB: rssPeak.gpu,
  };
  rssPeak.renderer = rssPeak.gpu = 0;
  console.log(
    `${name.padEnd(16)} fps ${String(res.avgFps).padStart(5)} | frame ${res.avgFrameMs}ms p95 ${res.p95FrameMs} max ${res.maxFrameMs} | js ${res.avgJsMs}ms p95 ${res.p95JsMs} | calls ${res.avgDrawCalls} tris ${res.avgTriangles} | mesh ${res.meshJobs}x${res.avgMeshMs}ms | heap ${res.heapMB}MB (${res.heapDeltaMB >= 0 ? '+' : ''}${res.heapDeltaMB}) | rss ${res.rssMB}MB peak ${res.rssPeakMB} gpu ${res.gpuRssMB} | chunks ${res.chunks} meshes ${res.meshes} ents ${res.entities}`,
  );
  for (const h of res.hot.slice(0, 8)) console.log(`    ${h.pct.toFixed(1).padStart(5)}%  ${h.fn}`);
  return res;
}

/** Self time per function from a CDP profile (main thread only). */
function hotFunctions(profile, n) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const counts = new Map();
  for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
  let total = 0;
  for (const [id, c] of counts) {
    const nd = byId.get(id);
    const cf = nd.callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    const file = cf.url ? cf.url.split('/').pop() : '';
    const key = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + c);
    total += c;
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([fn, c]) => ({ fn, pct: (100 * c) / Math.max(1, total) }));
}

// ------------------------------------------------------------------ scenarios
const results = [];
const tickMs = async () => {
  await cmd('/tps');
  const l = (await lastChat()).find((x) => x.includes('TPS')) ?? '';
  const m = /tick ([\d.]+)ms/.exec(l);
  return m ? Number(m[1]) : null;
};
const run = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return;
  try {
    const r = await fn();
    r.serverTickMs = await tickMs();
    console.log(`  server tick ${r.serverTickMs} ms`);
    results.push(r);
  } catch (e) {
    console.log(`${name} failed: ${e.message}`);
  }
};
const isV7 = await page.evaluate(() => !!window.minehonk.game.renderer.ghosts);
console.log(`build: ${isV7 ? 'V7' : 'V6.5'}`);
await cmd('/gamerule doDaylightCycle false');
await cmd('/weather clear 100000');
await page.evaluate(() => (window.minehonk.game.player.flying = true));
const spawn0 = await page.evaluate(() => {
  const b = window.minehonk.game.player.body;
  return [b.x, b.y, b.z];
});

await run('spawn-day', async () => {
  await cmd('/time set 6000');
  await settle(120000);
  await setLook(0.6, 0.05);
  return measure('spawn-day');
});

// The Trick-or-Treat Village (V6.5: the same village, plain), at night, ghosts drifting over it
await run('village-night', async () => {
  await cmd('/time set 18000');
  await cmd('/tp 552 110 1000');
  await page.evaluate(() => (window.minehonk.game.player.flying = true));
  await settle(90000);
  await setLook(0.6, 0.55);
  return measure('village-night', async () => {
    if (!isV7) return;
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.minehonk.game.renderer.ghosts.showNow());
      await wait(MEASURE_MS / 3 - 50);
    }
  });
});

// A Trick Home's fight: three monsters in a house, the player inside with them
await run('trick-home', async () => {
  await cmd('/time set 18000');
  let at = process.env.TRICK_AT ? process.env.TRICK_AT.split(',').map(Number) : null;
  if (isV7) {
    await cmd('/tp 552 90 1000');
    await settle(60000);
    const r = await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'halloween', op: 'trick', trick: 'undead' }));
    if (!r.ok) throw new Error(r.text);
    await noMenus();
    // The grab, the drag, the door slamming
    await wait(7000);
    at = await page.evaluate(() => {
      const p = window.minehonk.game.player;
      return [p.body.x, p.body.y, p.body.z, p.yaw, p.pitch].map((v) => +v.toFixed(2));
    });
    console.log(`  TRICK_AT=${at.join(',')}`);
  } else {
    if (!at) throw new Error('TRICK_AT is needed (from the V7 run)');
    await page.evaluate(() => (window.minehonk.game.player.flying = false));
    await cmd(`/tp ${at[0]} ${at[1]} ${at[2]}`);
    await settle(60000);
    for (const [m, dx] of [
      ['zombie', 1.5],
      ['skeleton', -1.5],
      ['zombie', 0],
    ])
      await cmd(`/summon ${m} ~${dx} ~ ~2`);
  }
  await setLook(at[3], at[4]);
  return measure('trick-home');
});

const out = { label: LABEL, date: new Date().toISOString(), view: VIEW, renderDistance: await page.evaluate(() => window.minehonk.settings.renderDistance), joinMs, results };
fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(out, null, 2));
console.log(`wrote tests/perf/out/${LABEL}.json`);
await browser.close();
stop();
process.exit(0);
