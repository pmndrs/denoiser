import { defineConfig } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rtCapture } from './src/vite-plugin';

// Replay page + capture I/O endpoints. From the repo root:
//   node node_modules/vite/bin/vite.js tools/rt-capture --port 5230 --strictPort --host 127.0.0.1
//
// Environment (all optional):
//   RT_REALTIME_SRC=<dir>  pin denoiser/realtime to a frozen copy of its src/ (as the test bed's
//                          vite.config.ts: `git archive <commit> packages/denoiser-realtime/src | tar -x -C <d>`,
//                          then <d>/packages/denoiser-realtime/src), so results don't move while
//                          another agent edits the package (Vite serves src/ live)
//   RT_NO_HMR=1            no HMR: a file edit then never reloads a running headless page
// `/tzas/*` serves the OIDN weights (packages/denoiser/tzas) for the offline `oidn` entries.
const root = fileURLToPath(new URL('../..', import.meta.url));
const tzas = path.join(root, 'packages/denoiser/tzas');
const realtime = process.env.RT_REALTIME_SRC;
const alias: { find: string | RegExp; replacement: string }[] = [];
if (realtime) alias.push({ find: /^(\.\.\/)+packages\/denoiser-realtime\/src\/index$/, replacement: `${realtime}/index.ts` });

export default defineConfig({
  plugins: [rtCapture(), {
    name: 'serve-oidn-weights',
    configureServer(server) {
      server.middlewares.use('/tzas', (req, res) => {
        const file = path.join(tzas, path.basename(decodeURIComponent((req.url ?? '').split('?')[0])));
        // a real 404 (Vite's SPA fallback would answer index.html with 200)
        if (!existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  }],
  server: {
    fs: { allow: ['../..', ...(realtime ? [realtime] : [])] },
    ...(process.env.RT_NO_HMR ? { hmr: false } : {}),
  },
  resolve: { alias },
});
