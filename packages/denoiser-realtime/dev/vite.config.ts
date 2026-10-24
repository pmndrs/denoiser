import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Dev page for @pmndrs/denoiser-realtime (port 5240). Aliases the TS source so
// shader edits hot-reload without a rollup rebuild.
const src = fileURLToPath(new URL('../src/index.ts', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { fs: { allow: ['../../..'] } },
  resolve: { alias: { '@pmndrs/denoiser-realtime': src } },
});
