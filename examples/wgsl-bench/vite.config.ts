import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// Serve the (gitignored) converted models and the OIDN .tza weights for local dev:
// /models/* -> packages/denoiser/models (ORT runtime), /tzas/* -> packages/denoiser/tzas (kernels).
const pkg = fileURLToPath(new URL('../../packages/denoiser', import.meta.url));
const serveDir = (prefix: string, dir: string) => ({
  name: `serve-${prefix}`,
  configureServer(server: { middlewares: { use: (p: string, fn: (req: { url?: string }, res: NodeJS.WritableStream & { setHeader(k: string, v: string): void }, next: () => void) => void) => void } }) {
    server.middlewares.use(`/${prefix}`, (req, res, next) => {
      const file = path.join(dir, decodeURIComponent((req.url ?? '').split('?')[0]));
      if (!existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  // allow serving the .onnx/.tza files that live outside this example (repo root)
  server: { fs: { allow: ['../..'] } },
  // onnxruntime-web ships prebuilt wasm/jsep assets; don't let esbuild pre-bundle it
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  plugins: [serveDir('models', path.join(pkg, 'models')), serveDir('tzas', path.join(pkg, 'tzas'))],
});
