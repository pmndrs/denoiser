// Harness page for results/UPSCALER-GUIDES.md: scores disocclusion detectors against exact ground truth.
//   node node_modules/vite/bin/vite.js docs/research/rt-denoiser/results/data/upscaler-guides --port 5490 --strictPort --host 127.0.0.1
// FSR3_SRC = the @pmndrs/upscaler source (MIT, ../fsr3; read-only: we import its WGSL and constants writer).
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
