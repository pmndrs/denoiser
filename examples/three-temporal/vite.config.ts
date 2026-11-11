import { dirname, resolve } from 'path';
import { existsSync, realpathSync } from 'fs';
import { defineConfig } from 'vite';

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
  esbuild: { target: 'esnext' }, // three / TSL use top-level await
  build: {
    target: 'esnext',
    // pages: the SSR comparison (index), the shadows + SSR scene, and its static/dynamic split experiment
    rollupOptions: { input: { index: 'index.html', shadows: 'shadows.html', 'shadows-split': 'shadows-split.html', 'reflections-hybrid': 'reflections-hybrid.html', 'reflection-probes': 'reflection-probes.html', 'reflections-rooms': 'reflections-rooms.html' } },
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
