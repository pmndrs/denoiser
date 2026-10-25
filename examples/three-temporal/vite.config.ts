import { defineConfig } from 'vite';
import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';
import { sceneAssets } from './scene-assets-plugin';

// three + the upscaler (a TempNode subclass) are served as source and deduped:
// there must be exactly ONE three instance or node classes from one copy are
// not recognised by the other (same rule as upscale-pipeline).
export default defineConfig({
  base: './',
  // rtCapture(): capture I/O endpoints (/__rt-capture/*) for realtime-gi's capture mode (?path=orbit&ref=1);
  // files go to tools/rt-capture/captures/, or $RT_CAPTURE_DIR/captures/ (dev server only)
  // sceneAssets(): /__scene-assets/* serves the Bistro / Sponza models of ?scene=bistro|sponza
  // ($RT_SCENE_ASSETS, default examples/three-temporal/scene-assets (Git LFS); CAPTURES.md "Bistro and Sponza")
  plugins: [rtCapture(), sceneAssets()],
  esbuild: { target: 'esnext' }, // three / TSL use top-level await
  build: {
    target: 'esnext',
    // pages: the SSR comparison (index), the shadows + SSR scene, and its static/dynamic split experiment
    rollupOptions: { input: { index: 'index.html', shadows: 'shadows.html', 'shadows-split': 'shadows-split.html', 'reflections-hybrid': 'reflections-hybrid.html', 'reflection-probes': 'reflection-probes.html', 'reflections-rooms': 'reflections-rooms.html', 'realtime-shadows': 'realtime-shadows.html', 'realtime-gi': 'realtime-gi.html', 'realtime-glass': 'realtime-glass.html' } },
  },
  resolve: { dedupe: ['three'] },
  server: { fs: { allow: ['../..'] } },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler', 'denoiser', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    esbuildOptions: { target: 'esnext' },
  },
});
