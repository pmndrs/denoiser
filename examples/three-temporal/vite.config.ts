import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';
import { sceneAssets } from './scene-assets-plugin';
import { threeExamples } from './three-examples-plugin';

// /tzas/*: the OIDN weights (packages/denoiser/tzas) for the review bench's OIDN sides (src/review/oidn.ts, E-2b);
// a real 404 for a missing file (Vite's SPA fallback would answer index.html with 200), as tools/rt-capture/vite.config.ts.
const TZAS = fileURLToPath(new URL('../../packages/denoiser/tzas', import.meta.url));
const oidnWeights = (): Plugin => ({
  name: 'serve-oidn-weights',
  configureServer(server) {
    server.middlewares.use('/tzas', (req, res) => {
      const file = path.join(TZAS, path.basename(decodeURIComponent((req.url ?? '').split('?')[0])));
      if (!existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  },
});

// three + the upscaler (a TempNode subclass) are served as source and deduped:
// there must be exactly ONE three instance or node classes from one copy are
// not recognised by the other (same rule as upscale-pipeline).
export default defineConfig({
  base: './',
  // rtCapture(): capture I/O endpoints (/__rt-capture/*) for realtime-gi's capture mode (?path=orbit&ref=1);
  // files go to tools/rt-capture/captures/, or $RT_CAPTURE_DIR/captures/ (dev server only)
  // sceneAssets(): /__scene-assets/* serves the Bistro / Sponza models of ?scene=bistro|sponza
  // ($RT_SCENE_ASSETS, default examples/three-temporal/scene-assets (Git LFS); CAPTURES.md "Bistro and Sponza")
  // threeExamples(): /__three-examples/* serves models from a local three.js checkout (reflect-bench; falls back to GitHub r186)
  plugins: [rtCapture(), sceneAssets(), threeExamples(), oidnWeights()],
  esbuild: { target: 'esnext' }, // three / TSL use top-level await
  build: {
    target: 'esnext',
    // pages: the SSR comparison (index), the shadows + SSR scene, and its static/dynamic split experiment; review.html is the
    // review bench (`yarn review` serves it against the packages' source: vite.review.config.ts)
    rollupOptions: { input: { index: 'index.html', shadows: 'shadows.html', 'shadows-split': 'shadows-split.html', 'reflections-hybrid': 'reflections-hybrid.html', 'reflection-probes': 'reflection-probes.html', 'reflections-rooms': 'reflections-rooms.html', 'realtime-shadows': 'realtime-shadows.html', 'realtime-gi': 'realtime-gi.html', 'realtime-glass': 'realtime-glass.html', review: 'review.html', golden: 'golden.html', 'reflect-bench': 'reflect-bench.html' } },
  },
  resolve: { dedupe: ['three'] },
  server: { fs: { allow: ['../..'] } },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler', 'denoiser', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    esbuildOptions: { target: 'esnext' },
  },
});
