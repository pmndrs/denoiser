import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';

// FFX_DIST=1 tests the built package (dist); default aliases the TS source so
// shader edits hot-reload without a rollup rebuild.
const src = fileURLToPath(new URL('../../packages/denoiser-ffx/src/index.ts', import.meta.url));

export default defineConfig({
  // Relative base so the built bundle works under the Pages subpath (/denoiser/realtime-denoiser/).
  base: './',
  // rtCapture(): capture I/O endpoints (/__rt-capture/*) for ?mode=capture and ?mode=replay;
  // files go to tools/rt-capture/captures|outputs, or $RT_CAPTURE_DIR/captures|outputs.
  plugins: [rtCapture()],
  server: { fs: { allow: ['../..'] } },
  resolve: process.env.FFX_DIST ? {} : { alias: { '@pmndrs/denoiser-ffx': src } },
});
