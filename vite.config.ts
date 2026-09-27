import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
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
