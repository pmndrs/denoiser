import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Default: the published @pmndrs/upscaler (so the public site build works like a consumer's).
// UPSCALER_SRC=/path/to/upscaler/src/index.ts swaps in a local checkout for A/B work against unreleased changes.
// Three is deduped so the upscaler and this example share one instance.
const ffx = fileURLToPath(new URL('../../packages/denoiser-ffx/src/index.ts', import.meta.url));
const alias: Record<string, string> = { '@pmndrs/denoiser-ffx': ffx };
if (process.env.UPSCALER_SRC) alias['@pmndrs/upscaler'] = process.env.UPSCALER_SRC;

export default defineConfig({
  base: './',
  esbuild: { target: 'esnext' }, // three / TSL use top-level await
  build: { target: 'esnext' },
  resolve: { dedupe: ['three'], alias },
  server: { fs: { allow: ['../..', ...(process.env.UPSCALER_SRC ? [process.env.UPSCALER_SRC.replace(/\/src\/.*$/, '')] : [])] } },
  optimizeDeps: { exclude: ['three', 'three/webgpu', 'three/tsl', '@pmndrs/upscaler'], esbuildOptions: { target: 'esnext' } },
});
