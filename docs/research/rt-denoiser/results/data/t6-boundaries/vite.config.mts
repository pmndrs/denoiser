// T6 detection harness page (results/T6-boundaries.md); the config of ../upscaler-guides/vite.config.mts.
//   RT_REALTIME_SRC=<pinned src> node node_modules/vite/bin/vite.js docs/research/rt-denoiser/results/data/t6-boundaries --config docs/research/rt-denoiser/results/data/t6-boundaries/vite.config.mts --port <p> --strictPort --host 127.0.0.1
// (FSR3_SRC is only allowed for serving, as in the upscaler harness; nothing here imports it.)
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { rtCapture } from '../../../../../../tools/rt-capture/src/vite-plugin';
import { sceneAssets } from '../../../../../../examples/three-temporal/scene-assets-plugin';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const fsr3 = process.env.FSR3_SRC ?? '/Users/dex/Developer/fsr3/src';
const realtime = process.env.RT_REALTIME_SRC;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [rtCapture(), sceneAssets()],
  server: { fs: { allow: [repo, fsr3, ...(realtime ? [realtime] : [])] }, hmr: false },
  esbuild: { target: 'esnext' },
  optimizeDeps: { exclude: ['three', 'three/webgpu', 'three/tsl', 'three-mesh-bvh'], esbuildOptions: { target: 'esnext' } },
  resolve: {
    dedupe: ['three'],
    alias: [
      { find: '@pmndrs/denoiser-ffx', replacement: `${repo}packages/denoiser-ffx/src/index.ts` },
      { find: /^@fsr3\/(.*)$/, replacement: `${fsr3}/$1` },
      ...(realtime ? [{ find: /^(\.\.\/)+packages\/denoiser-realtime\/src\/index$/, replacement: `${realtime}/index.ts` }] : []),
    ],
  },
});
