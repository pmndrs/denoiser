import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import path, { dirname, resolve } from 'node:path';
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
//
// The reflection pages (reflection-probes, reflections-rooms, reflections-hybrid) take their probes
// and GGX sampling from @pmndrs/reflections. TEMPORARY until it is published: it is resolved from
// the source of a `reflections` checkout next to this repo (or next to any parent folder, so
// worktrees find it too), or at $REFLECTIONS_REPO. Its own imports of three / three-mesh-bvh are
// deduped to this example's copies (one three instance per page).
function findReflections(): string | null {
  const entry = (repo: string) => resolve(repo, 'src/three.ts');
  const env = process.env.REFLECTIONS_REPO;
  if (env) return existsSync(entry(env)) ? realpathSync(env) : null;
  for (let dir = resolve(__dirname, '..'); dirname(dir) !== dir; dir = dirname(dir)) {
    const repo = resolve(dirname(dir), 'reflections');
    if (existsSync(entry(repo))) return realpathSync(repo);
  }
  return null;
}
const reflectionsRepo = findReflections();
if (!reflectionsRepo) {
  console.warn('[three-temporal] @pmndrs/reflections not found (no ../reflections checkout, $REFLECTIONS_REPO unset): the reflection pages will not load.');
}
// the package's own links outside its repo (downsampler, @pmndrs/bvh) must be on the allow list too
const reflectionsLinks = reflectionsRepo
  ? ['packages/core/node_modules/downsampler', 'packages/core/node_modules/@pmndrs/bvh']
      .map((p) => resolve(reflectionsRepo, p)).filter((p) => existsSync(p)).map((p) => realpathSync(p))
  : [];

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
  resolve: {
    dedupe: ['three', 'three-mesh-bvh'],
    alias: reflectionsRepo
      ? [
          { find: /^@pmndrs\/reflections\/three$/, replacement: resolve(reflectionsRepo, 'src/three.ts') },
          { find: /^@pmndrs\/reflections\/core$/, replacement: resolve(reflectionsRepo, 'src/core.ts') },
          { find: /^@pmndrs\/reflections$/, replacement: resolve(reflectionsRepo, 'src/index.ts') },
        ]
      : [],
  },
  server: { fs: { allow: ['../..', ...(reflectionsRepo ? [reflectionsRepo] : []), ...reflectionsLinks] } },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler', 'denoiser', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    esbuildOptions: { target: 'esnext' },
  },
});
