import { defineConfig } from 'vite';

// three + the upscaler (a TempNode subclass) are served as source and deduped:
// there must be exactly ONE three instance or node classes from one copy are
// not recognised by the other (same rule as upscale-pipeline).
export default defineConfig({
  base: './',
  esbuild: { target: 'esnext' }, // three r185 / TSL use top-level await
  build: { target: 'esnext' },
  resolve: { dedupe: ['three'] },
  server: { fs: { allow: ['../..'] } },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler', 'denoiser'],
    esbuildOptions: { target: 'esnext' },
  },
});
