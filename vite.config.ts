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

export default defineConfig({
  root: '.',
  // GitHub Pages serves the game from /<repo>/ (PAGES_BASE=/MineHonk/ npx vite build)
  base: process.env.PAGES_BASE ?? '/',
  publicDir: 'public',
  define: {
    __ASSET_VERSION__: JSON.stringify(assetVersion()),
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
