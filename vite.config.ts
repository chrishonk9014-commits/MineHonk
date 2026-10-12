import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The texture atlases keep fixed names in public/assets, so browsers (and the
 * GitHub Pages CDN) may hold on to an older copy after an update: new blocks
 * then have no texture. A hash of their contents goes on every request.
 */
function assetVersion(): string {
  const h = createHash('sha1');
  for (const f of ['blocks.png', 'blocks.json', 'items.png', 'items.json', 'font.json']) {
    try {
      h.update(readFileSync(`public/assets/${f}`));
    } catch {
      /* not generated yet */
    }
  }
  return h.digest('hex').slice(0, 10);
}

/** The game's version (package.json): shown in the public world list, checked when joining. */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/**
 * The cloud hub for "Playing online": VITE_HUB_URL, or for the GitHub Pages
 * build the deployed hub's address (hub/deployed-url.txt, written after the
 * deploy workflow first runs).
 */
function hubUrl(): string {
  if (process.env.VITE_HUB_URL !== undefined) return process.env.VITE_HUB_URL.replace(/\/+$/, '');
  if (!process.env.PAGES_BASE) return '';
  try {
    return readFileSync('hub/deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export default defineConfig({
  root: '.',
  // GitHub Pages serves the game from /<repo>/ (PAGES_BASE=/MineHonk/ npx vite build)
  base: process.env.PAGES_BASE ?? '/',
  publicDir: 'public',
  define: {
    __ASSET_VERSION__: JSON.stringify(assetVersion()),
    __GAME_VERSION__: JSON.stringify(pkg.version),
    __HUB_URL__: JSON.stringify(hubUrl()),
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    host: true,
    // `npm run server` (PORT=8080) in another terminal provides multiplayer during development
    proxy: {
      '/api': 'http://localhost:8080',
      '/play': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
