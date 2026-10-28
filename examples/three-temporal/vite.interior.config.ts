import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';

// The interior lab (interior-lab.html, panes in interior-pane.html): Ben Houston's webgpu_interior example, one copy
// per denoiser setup, side by side.
// three.js comes from a checkout of his branch (webgpu_preview_interior), not from npm: `three`, `three/webgpu`,
// `three/tsl` and `three/addons/` resolve into it, and its examples/ folder is served as the public dir (models,
// textures, example.css). The denoiser packages resolve to their source, like the review bench.
//   yarn workspace three-temporal interior     -> http://127.0.0.1:5270/interior-lab.html
// THREE_INTERIOR_REPO overrides the checkout (default: ../three.js next to this repo). @pmndrs/upscaler resolves to the
// source of the upscaler repo (UPSCALER_REPO, default ../upscaler), the code its 09-kitchen-sink example runs.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const threeRepo = path.resolve(process.env.THREE_INTERIOR_REPO ?? here('../../../three.js'));
const upscalerRepo = path.resolve(process.env.UPSCALER_REPO ?? here('../../../upscaler'));
const pkg = (p: string) => here(`../../packages/${p}`);

export default defineConfig({
  publicDir: path.join(threeRepo, 'examples'),
  esbuild: { target: 'esnext' },
  resolve: {
    alias: [
      { find: /^three$/, replacement: path.join(threeRepo, 'src/Three.WebGPU.js') },
      { find: /^three\/webgpu$/, replacement: path.join(threeRepo, 'src/Three.WebGPU.js') },
      { find: /^three\/tsl$/, replacement: path.join(threeRepo, 'src/Three.TSL.js') },
      { find: /^three\/addons\//, replacement: path.join(threeRepo, 'examples/jsm') + '/' },
      { find: /^denoiser\/three$/, replacement: pkg('denoiser/src/three.ts') },
      { find: /^@pmndrs\/denoiser-(core|ffx|realtime|three)$/, replacement: pkg('denoiser-$1/src/index.ts') },
      { find: /^@pmndrs\/upscaler$/, replacement: path.join(upscalerRepo, 'src/index.ts') },
      { find: /^@pmndrs\/upscaler-(three|core)$/, replacement: path.join(upscalerRepo, 'packages/$1/src/index.ts') },
      { find: /^@pmndrs\/upscaler-(three|core)\/(.*)$/, replacement: path.join(upscalerRepo, 'packages/$1/src/$2.ts') },
    ],
  },
  build: { rollupOptions: { input: { lab: here('interior-lab.html'), pane: here('interior-pane.html') } } },
  server: { fs: { allow: ['../..', threeRepo, upscalerRepo] } },
  optimizeDeps: { noDiscovery: true, include: [], esbuildOptions: { target: 'esnext' } },
});
