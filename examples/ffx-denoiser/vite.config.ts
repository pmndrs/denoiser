import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// FFX_DIST=1 tests the built package (dist); default aliases the TS source so
// shader edits hot-reload without a rollup rebuild.
const src = fileURLToPath(new URL('../../packages/denoiser-ffx/src/index.ts', import.meta.url));

export default defineConfig({
  // Relative base so the built bundle works under the Pages subpath (/denoiser/ffx-denoiser/).
  base: './',
  server: { fs: { allow: ['../..'] } },
  resolve: process.env.FFX_DIST ? {} : { alias: { '@pmndrs/denoiser-ffx': src } },
});
