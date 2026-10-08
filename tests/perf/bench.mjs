/**
 * Performance benchmark. Serves a build, creates a Creative world with cheats,
 * then runs a set of scenarios and records frame timings, main-thread JS time,
 * draw calls, meshing and generation times, memory and a CPU profile.
 *
 *   npx vite build --minify false --outDir dist-bench   (readable profiles)
 *   node tests/perf/bench.mjs [dist-bench] [scenario,scenario...]
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
const PORT = 4190;

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

await page.goto(`http://localhost:${PORT}/`);
await page.getByText('Singleplayer').waitFor({ timeout: 30000 });
if (RENDER_DISTANCE) await page.evaluate((rd) => (window.minehonk.settings.renderDistance = rd), RENDER_DISTANCE);
await page.getByText('Singleplayer').click();
await page.getByText('Create New World').first().click();
await page.waitForTimeout(300);
await page.getByText('More World Options...').click();
await page.locator('input[placeholder="Leave blank for a random seed"]').fill(process.env.SEED ?? 'bench-seed');
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
const run = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return;
  try {
    results.push(await fn());
  } catch (e) {
    console.log(`${name} failed: ${e.message}`);
  }
};

await cmd('/time set 6000');
await cmd('/gamerule doDaylightCycle false');
await cmd('/weather clear 100000');
const spawn0 = await page.evaluate(() => {
  const b = window.minehonk.game.player.body;
  return [b.x, b.y, b.z];
});
await page.evaluate(() => (window.minehonk.game.player.flying = true));

await run('spawn-still', async () => {
  const s = await settle(120000);
  console.log(`  initial terrain settled in ${s} ms`);
  await setLook(0.6, 0.05);
  return measure('spawn-still');
});

await run('overlook', async () => {
  await cmd(`/tp ${spawn0[0]} ${spawn0[1] + 45} ${spawn0[2]}`);
  await settle(60000);
  await setLook(2.2, 0.35);
  return measure('overlook');
});

await run('fly', async () => {
  await cmd(`/tp ${spawn0[0]} ${spawn0[1] + 25} ${spawn0[2]}`);
  await settle(30000);
  await setLook(Math.PI, 0.1);
  // Creative flight: hold forward + sprint so new chunks stream in
  return measure('fly', async () => {
    await page.keyboard.down('ControlLeft');
    await page.keyboard.down('KeyW');
    await wait(MEASURE_MS - 200);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ControlLeft');
  });
});

await run('mobs', async () => {
  await cmd(`/tp ${spawn0[0]} ${spawn0[1] + 2} ${spawn0[2]}`);
  await settle(30000);
  const kinds = ['zombie', 'skeleton', 'cow', 'pig', 'sheep', 'chicken', 'creeper', 'spider'];
  const N = Number(process.env.MOBS ?? 24);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 6 + (i % 4) * 3;
    await cmd(`/summon ${kinds[i % kinds.length]} ~${(Math.cos(a) * r).toFixed(1)} ~1 ~${(Math.sin(a) * r).toFixed(1)}`);
  }
  await wait(1000);
  await setLook(0, 0.35);
  return measure('mobs');
});

await run('cave', async () => {
  await cmd('/gamemode spectator');
  await cmd(`/tp ${spawn0[0] + 40} 24 ${spawn0[2] + 40}`);
  await settle(20000);
  // Stand in a real cave: an air pocket with rock above (inside solid rock nothing is culled)
  const spot = await page.evaluate(([x0, z0]) => {
    const w = window.minehonk.game.world;
    // Caves are filled with cave_air, not plain air
    // (builds without the helper: cave_air is state 1 in the unchanged block registry)
    const caveAir = window.minehonkState?.('cave_air') ?? 1;
    const open = (x, y, z) => {
      const s = w.getState(x, y, z);
      return s === 0 || s === caveAir;
    };
    for (let r = 0; r <= 40; r += 2)
      for (let a = 0; a < Math.max(1, r * 2); a++) {
        const x = Math.round(x0 + Math.cos((a / Math.max(1, r * 2)) * Math.PI * 2) * r);
        const z = Math.round(z0 + Math.sin((a / Math.max(1, r * 2)) * Math.PI * 2) * r);
        for (let y = 12; y < 40; y++) {
          if (!open(x, y, z) || !open(x, y + 1, z) || open(x, y - 1, z)) continue;
          let roof = 0;
          for (let h = y + 2; h < y + 40 && !roof; h++) if (!open(x, h, z)) roof = h;
          if (roof && roof - y < 12) return [x + 0.5, y, z + 0.5];
        }
      }
    return null;
  }, [spawn0[0] + 40, spawn0[2] + 40]);
  if (spot) {
    await cmd(`/tp ${spot[0]} ${spot[1]} ${spot[2]}`);
    await settle(30000);
  } else console.log('  no cave found, measuring from inside the rock');
  await setLook(1.2, 0.0);
  const r = await measure('cave');
  await cmd('/gamemode creative');
  await page.evaluate(() => (window.minehonk.game.player.flying = true));
  return r;
});

await run('ocean', async () => {
  // Nearest ocean via the biome map around spawn
  const loc = await page.evaluate(async () => {
    const g = window.minehonk.game;
    return { x: g.player.body.x, z: g.player.body.z };
  });
  await cmd(`/tp ${Math.round(loc.x + 600)} 90 ${Math.round(loc.z + 600)}`);
  await settle(60000);
  await setLook(0.3, 0.3);
  return measure('far-terrain');
});

for (const dim of ['nether', 'end', 'farlands']) {
  await run(dim, async () => {
    await cmd(`/dimension ${dim}`);
    await page.waitForFunction((d) => window.minehonk.game.dimension === d, dim, { timeout: 180000 }).catch(async (e) => {
      console.log('  chat:', (await lastChat()).join(' | '));
      throw e;
    });
    await page.evaluate(() => (window.minehonk.game.player.flying = true));
    // The End: look at the main island from its edge (far out there is only void)
    if (dim === 'end') await cmd('/tp 70 90 70');
    await settle(60000);
    await setLook(dim === 'end' ? 0.785 : 0.8, dim === 'end' ? 0.35 : 0.15);
    return measure(dim);
  });
}

// V6: the End's outer islands next to the Expanded End's seven biomes (compare at RD=8)
await run('end-outer', async () => {
  if ((await page.evaluate(() => window.minehonk.game.dimension)) !== 'end') {
    await cmd('/dimension end');
    await page.waitForFunction(() => window.minehonk.game.dimension === 'end', null, { timeout: 180000 });
  }
  await page.evaluate(() => (window.minehonk.game.player.flying = true));
  await cmd('/tp 1500 95 0');
  await settle(60000);
  await setLook(0.785, 0.3);
  return measure('end-outer');
});
for (const biome of ['end_barrens', 'shattered_end', 'astral_end', 'highlands', 'end_crystal_fields', 'chorus_forest', 'void_wastes']) {
  await run(`end-${biome}`, async () => {
    const r = await page.evaluate((b) => window.minehonk.game.adminRequest({ a: 'v6', op: 'tp_biome', biome: b }), biome);
    if (!r.ok) throw new Error(r.text);
    await page.evaluate(() => (window.minehonk.game.player.flying = true));
    await page.evaluate(() => (window.minehonk.game.player.body.y += 25));
    await settle(60000);
    await setLook(0.785, 0.3);
    return measure(`end-${biome}`);
  });
}

// V6 phase 5: the Expanded End under a Void Storm and under the End Eclipse (the Astral End, compare with end-astral_end)
for (const [name, start, stop] of [
  ['end-storm', 'storm_start', 'storm_stop'],
  ['end-eclipse', 'eclipse_start', 'eclipse_stop'],
]) {
  await run(name, async () => {
    const r = await page.evaluate(() => window.minehonk.game.adminRequest({ a: 'v6', op: 'tp_biome', biome: 'astral_end' }));
    if (!r.ok) throw new Error(r.text);
    await page.evaluate(() => (window.minehonk.game.player.flying = true));
    await page.evaluate(() => (window.minehonk.game.player.body.y += 25));
    const s = await page.evaluate((op) => window.minehonk.game.adminRequest({ a: 'v6', op }), start);
    if (!s.ok) throw new Error(s.text);
    await settle(60000);
    // A storm breaks a few seconds after it is called, and the sky takes a few seconds to turn
    await wait(8000);
    await setLook(0.785, 0.3);
    const m = await measure(name);
    await page.evaluate((op) => window.minehonk.game.adminRequest({ a: 'v6', op }), stop);
    return m;
  });
}

await cmd('/dimension overworld').catch(() => {});
await page.waitForFunction(() => window.minehonk.game.dimension === 'overworld', null, { timeout: 180000 }).catch(() => {});
await wait(2000);
await cmd('/tps');
const tps = (await lastChat()).find((l) => l.includes('TPS')) ?? '';
console.log('server:', tps);

const out = { label: LABEL, date: new Date().toISOString(), view: VIEW, joinMs, server: tps, results };
fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(out, null, 2));
console.log(`wrote tests/perf/out/${LABEL}.json`);
await browser.close();
stop();
process.exit(0);
