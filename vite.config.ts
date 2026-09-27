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
    proxy: {
      '/api': 'http://localhost:25580',
      '/ws': { target: 'ws://localhost:25580', ws: true },
    },
  },
});
