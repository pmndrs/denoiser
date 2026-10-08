import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// /models -> converted .onnx (ORT), /tzas -> OIDN weights (kernels, WGSL),
// /eval -> tools/eval/out (inputs, native outputs, plan.json from tools/eval/native.py).
const root = fileURLToPath(new URL('../..', import.meta.url));
const dirs: Record<string, string> = {
  '/models': path.join(root, 'packages/denoiser/models'),
  '/tzas': path.join(root, 'packages/denoiser/tzas'),
  '/eval': path.join(root, 'tools/eval/out'),
};

export default defineConfig({
  server: { fs: { allow: ['../..'] } },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  plugins: [{
    name: 'serve-eval-data',
    configureServer(server) {
      for (const [prefix, dir] of Object.entries(dirs)) {
        server.middlewares.use(prefix, (req, res, next) => {
          const file = path.join(dir, decodeURIComponent((req.url ?? '').split('?')[0]));
          if (!existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader('Content-Type', 'application/octet-stream');
          createReadStream(file).pipe(res);
        });
      }
    },
  }],
});
