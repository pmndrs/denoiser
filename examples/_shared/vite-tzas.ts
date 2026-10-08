// Vite dev plugin: serve the repo's OIDN .tza weights at /tzas so the wgsl / webnn /
// kernels runtimes work offline (examples/_shared/stack.ts points them here in dev;
// production builds use the runtimes' CDN default).
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const tzasDir = fileURLToPath(new URL('../../packages/denoiser/tzas', import.meta.url));

export function serveTzas(): Plugin {
  return {
    name: 'serve-tzas',
    configureServer(server) {
      server.middlewares.use('/tzas', (req, res, next) => {
        const file = path.join(tzasDir, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}
