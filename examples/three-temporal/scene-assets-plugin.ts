// Dev-server endpoint for third-party scene models that are NOT in this repository (Bistro, Sponza:
// examples/three-temporal/CAPTURES.md "Bistro and Sponza"). The realtime pages' ?scene=bistro|sponza
// fetch them from /__scene-assets/<file>; the files are read from a folder outside git:
//   $RT_SCENE_ASSETS, else <repo>/../vsm/bench/public/assets (Dennis's VSM checkout, a sibling of this repo).
// Expected layout: sponza/Sponza.gltf + sponza/Sponza.bin, bistro/bistro-uncompressed.glb.
// Missing files answer 404 here (Vite's SPA fallback would answer index.html with 200; LESSONS e2).
import type { Plugin, Connect } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCENE_ASSETS_DIR = path.resolve(process.env.RT_SCENE_ASSETS ?? path.join(REPO, '..', 'vsm', 'bench', 'public', 'assets'));
const PREFIX = '/__scene-assets/';
const TYPES: Record<string, string> = { '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream' };

export function sceneAssets(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = req.url ? new URL(req.url, 'http://x').pathname : '';
    if (!pathname.startsWith(PREFIX)) return next();
    const rel = path.posix.normalize(decodeURIComponent(pathname.slice(PREFIX.length)));
    const ext = path.extname(rel).toLowerCase();
    const file = path.join(SCENE_ASSETS_DIR, ...rel.split('/'));
    if (rel.startsWith('..') || rel.split('/').includes('..') || !TYPES[ext] || !file.startsWith(SCENE_ASSETS_DIR + path.sep) || !existsSync(file)) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain');
      res.end(`scene asset not found: ${rel} (looked in ${SCENE_ASSETS_DIR}; set RT_SCENE_ASSETS, see examples/three-temporal/CAPTURES.md)`);
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', TYPES[ext]);
    res.setHeader('content-length', String(statSync(file).size));
    res.setHeader('cache-control', 'no-store');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'three-temporal-scene-assets',
    configureServer(server) { server.middlewares.use(handler); },
  };
}
