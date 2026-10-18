import { defineConfig } from 'vite';

// three + the upscaler (a TempNode subclass) are served as source and deduped:
// there must be exactly ONE three instance or node classes from one copy are
// not recognised by the other (same rule as upscale-pipeline).
export default defineConfig({
  base: './',
  esbuild: { target: 'esnext' }, // three / TSL use top-level await
  build: {
    target: 'esnext',
    // pages: the SSR comparison (index), the shadows + SSR scene, and its static/dynamic split experiment
    rollupOptions: { input: { index: 'index.html', shadows: 'shadows.html', 'shadows-split': 'shadows-split.html' } },
  },
  resolve: { dedupe: ['three'] },
  server: { fs: { allow: ['../..'] } },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler', 'denoiser', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    esbuildOptions: { target: 'esnext' },
  },
});
