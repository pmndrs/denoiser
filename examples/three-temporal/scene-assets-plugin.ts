// Dev-server endpoint for the third-party scene models (Bistro, Sponza: examples/three-temporal/CAPTURES.md
// "Bistro and Sponza", licences in scene-assets/NOTICE.md). The realtime pages' ?scene=bistro|sponza
// fetch them from /__scene-assets/<file>; the files are read from:
//   $RT_SCENE_ASSETS, else examples/three-temporal/scene-assets (Git LFS, skipped by default clones: .lfsconfig;
//   git lfs pull --include "examples/three-temporal/scene-assets/**" --exclude "").
// Expected layout: sponza/Sponza.gltf + sponza/Sponza.bin, bistro/bistro-uncompressed.glb.
// Missing files answer 404 here (Vite's SPA fallback would answer index.html with 200; LESSONS e2).
import type { Plugin, Connect } from 'vite';
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCENE_ASSETS_DIR = path.resolve(process.env.RT_SCENE_ASSETS ?? path.join(REPO, 'examples', 'three-temporal', 'scene-assets'));
const PREFIX = '/__scene-assets/';
const LFS_PULL = 'git lfs pull --include "examples/three-temporal/scene-assets/**" --exclude ""';

/** A Git LFS pointer file (the model was not fetched) instead of the model itself. */
function isLfsPointer(file: string): boolean {
  if (statSync(file).size > 1024) return false;
  const buf = Buffer.alloc(64);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, 64, 0); } finally { closeSync(fd); }
  return buf.toString('latin1').startsWith('version https://git-lfs');
}
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
    if (isLfsPointer(file)) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain');
      res.end(`scene asset ${rel} is a Git LFS pointer (not fetched by default clones); run: ${LFS_PULL}`);
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
