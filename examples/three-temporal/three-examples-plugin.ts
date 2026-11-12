// Dev-server endpoint for three.js example assets (models, HDRs) from a local three.js checkout: the workbench's
// /__three-examples/<path> requests are answered from $THREE_EXAMPLES, else ../three.js/examples next to this repo.
// Missing files answer 404, and the workbench falls back to the r186 tag on GitHub for upstream assets
// (src/workbench/scenes.ts). Only the asset folders are served.
import type { Connect, Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.resolve(process.env.THREE_EXAMPLES ?? path.join(REPO, '..', 'three.js', 'examples'));
const PREFIX = '/__three-examples/';
const ALLOWED = ['models/', 'textures/'];
const TYPES: Record<string, string> = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.ktx2': 'image/ktx2' };

export function threeExamples(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = req.url ? decodeURIComponent(new URL(req.url, 'http://x').pathname) : '';
    if (!pathname.startsWith(PREFIX)) return next();
    const rel = pathname.slice(PREFIX.length);
    const file = path.resolve(DIR, rel);
    if (!ALLOWED.some((a) => rel.startsWith(a)) || !file.startsWith(DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', statSync(file).size);
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  };
  return { name: 'three-examples', configureServer: (s) => { s.middlewares.use(handler); }, configurePreviewServer: (s) => { s.middlewares.use(handler); } };
}
