import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';
import { sceneAssets } from './scene-assets-plugin';
import { threeExamples } from './three-examples-plugin';

// three + the upscaler (a TempNode subclass) are served as source and deduped:
// there must be exactly ONE three instance or node classes from one copy are
// not recognised by the other (same rule as upscale-pipeline).
// The workbench imports the upscaler as `upscaler-src`: the source of the upscaler repo ($UPSCALER_REPO, default
// ../upscaler next to this repo), i.e. what its 09 / 10 examples run, ahead of the published package. Without the
// repo it falls back to the installed @pmndrs/upscaler. Other pages keep the installed package.
const upscalerRepo = path.resolve(process.env.UPSCALER_REPO ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../upscaler'));
const upscalerSrc = existsSync(path.join(upscalerRepo, 'src/index.ts'));
const upscalerAlias = upscalerSrc
  ? [
      { find: /^upscaler-src$/, replacement: path.join(upscalerRepo, 'src/index.ts') },
      { find: /^@pmndrs\/upscaler-(three|core)$/, replacement: path.join(upscalerRepo, 'packages/$1/src/index.ts') },
      { find: /^@pmndrs\/upscaler-(three|core)\/(.*)$/, replacement: path.join(upscalerRepo, 'packages/$1/src/$2.ts') },
    ]
  : [{ find: /^upscaler-src$/, replacement: '@pmndrs/upscaler' }];

export default defineConfig({
  base: './',
  // rtCapture(): capture I/O endpoints (/__rt-capture/*) for realtime-gi's capture mode (?path=orbit&ref=1);
  // files go to tools/rt-capture/captures/, or $RT_CAPTURE_DIR/captures/ (dev server only)
  // sceneAssets(): /__scene-assets/* serves the Bistro / Sponza models of ?scene=bistro|sponza
  // ($RT_SCENE_ASSETS, default examples/three-temporal/scene-assets (Git LFS); CAPTURES.md "Bistro and Sponza")
  // threeExamples(): /__three-examples/* serves models / HDRs from a local three.js checkout (the workbench; falls back to GitHub)
  plugins: [rtCapture(), sceneAssets(), threeExamples()],
  esbuild: { target: 'esnext' }, // three / TSL use top-level await
  build: {
    target: 'esnext',
    // pages: the SSR comparison (index), the shadows + SSR scene, and its static/dynamic split experiment; review.html is the
    // review bench (`yarn review` serves it against the packages' source: vite.review.config.ts)
    rollupOptions: { input: { index: 'index.html', shadows: 'shadows.html', 'shadows-split': 'shadows-split.html', 'reflections-hybrid': 'reflections-hybrid.html', 'reflection-probes': 'reflection-probes.html', 'reflections-rooms': 'reflections-rooms.html', 'realtime-shadows': 'realtime-shadows.html', 'realtime-gi': 'realtime-gi.html', 'realtime-glass': 'realtime-glass.html', review: 'review.html', workbench: 'workbench.html', 'reflect-bench': 'reflect-bench.html' } },
  },
  resolve: { dedupe: ['three'], alias: upscalerAlias },
  server: { fs: { allow: ['../..', ...(upscalerSrc ? [upscalerRepo] : [])] } },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler', 'denoiser', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    esbuildOptions: { target: 'esnext' },
  },
});
