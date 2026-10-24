import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';

// FFX_DIST=1 tests the built package (dist); default aliases the TS source so
// shader edits hot-reload without a rollup rebuild.
const src = fileURLToPath(new URL('../../packages/denoiser-ffx/src/index.ts', import.meta.url));
// RT_REALTIME_SRC=<dir> pins denoiser/realtime to a frozen copy of its src/ (e.g. `git archive
// <commit> packages/denoiser-realtime/src | tar -x -C <dir>`, then <dir>/packages/denoiser-realtime/src):
// results then don't move while another agent edits the package (Vite serves src/ live).
const realtime = process.env.RT_REALTIME_SRC;
const alias: { find: string | RegExp; replacement: string }[] = [];
if (!process.env.FFX_DIST) alias.push({ find: '@pmndrs/denoiser-ffx', replacement: src });
if (realtime) alias.push({ find: /^(\.\.\/)+packages\/denoiser-realtime\/src\/index$/, replacement: `${realtime}/index.ts` });

export default defineConfig({
  // Relative base so the built bundle works under the Pages subpath (/denoiser/realtime-denoiser/).
  base: './',
  // rtCapture(): capture I/O endpoints (/__rt-capture/*) for ?mode=capture and ?mode=replay;
  // files go to tools/rt-capture/captures|outputs, or $RT_CAPTURE_DIR/captures|outputs.
  plugins: [rtCapture()],
  server: { fs: { allow: ['../..', ...(realtime ? [realtime] : [])] } },
  resolve: { alias },
});
