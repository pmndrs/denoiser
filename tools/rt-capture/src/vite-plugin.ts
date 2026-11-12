// Vite dev-server endpoints for capture I/O (CAPTURE-FORMAT v0). Pages POST raw f32 /
// JSON / CSV bodies; files land under <root>/captures/ and <root>/outputs/ (gitignored),
// and are served back for replay.
//
//   import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';
//   export default defineConfig({ plugins: [rtCapture()], server: { fs: { allow: ['../..'] } } });
//
// Endpoints (default prefix /__rt-capture):
//   POST /put?path=captures/<name>/frame_0000/depth.f32   body = file bytes (overwrites)
//   POST /rm?path=captures/<name>                          recursive delete (≥ 2 levels deep)
//   GET  /files/<captures|outputs>/<...>                   file bytes (404 if missing)
//   GET  /list?path=captures                               [{ name, dir }]
//   GET  /info                                             { root, commit, dirty }
// Root: options.root, else $RT_CAPTURE_DIR, else tools/rt-capture/.
import type { Plugin, Connect } from 'vite';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RtCaptureOptions {
  /** Folder holding captures/ and outputs/. Default $RT_CAPTURE_DIR or tools/rt-capture/. */
  root?: string;
  /** URL prefix. Default '/__rt-capture'. */
  endpoint?: string;
}

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP = ['captures', 'outputs'];

export function rtCapture(options: RtCaptureOptions = {}): Plugin {
  const root = path.resolve(options.root ?? process.env.RT_CAPTURE_DIR ?? TOOL_DIR);
  const prefix = (options.endpoint ?? '/__rt-capture').replace(/\/$/, '');

  /** Validate a relative path under captures/ or outputs/; returns the absolute path. */
  const resolveRel = (rel: string | null, minDepth = 1): string => {
    if (!rel) throw new HttpError(400, 'missing path');
    const norm = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\/+/, '');
    const parts = norm.split('/');
    if (norm.startsWith('..') || parts.includes('..') || !TOP.includes(parts[0]) || parts.length < minDepth) {
      throw new HttpError(400, `path must be under captures/ or outputs/ (got "${rel}")`);
    }
    return path.join(root, ...parts);
  };

  const handler: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url?.startsWith(prefix + '/')) return next();
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.slice(prefix.length);
    try {
      if (route === '/put' && req.method === 'POST') {
        const file = resolveRel(url.searchParams.get('path'), 2);
        mkdirSync(path.dirname(file), { recursive: true });
        const ws = createWriteStream(file);
        req.pipe(ws);
        ws.on('finish', () => send(res, 200, { ok: true, bytes: ws.bytesWritten }));
        ws.on('error', (e) => send(res, 500, { error: String(e) }));
        return;
      }
      if (route === '/rm' && req.method === 'POST') {
        const p = resolveRel(url.searchParams.get('path'), 2);
        rmSync(p, { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      if (route.startsWith('/files/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const file = resolveRel(decodeURIComponent(route.slice('/files/'.length)), 2);
        if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not found' });
        const ext = path.extname(file);
        res.statusCode = 200;
        res.setHeader('Content-Type', ext === '.json' ? 'application/json' : ext === '.csv' || ext === '.md' ? 'text/plain' : 'application/octet-stream');
        res.setHeader('Content-Length', statSync(file).size);
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
        return;
      }
      if (route === '/list' && req.method === 'GET') {
        const p = resolveRel(url.searchParams.get('path') ?? 'captures');
        const entries = existsSync(p) ? readdirSync(p).sort().map((name) => ({ name, dir: statSync(path.join(p, name)).isDirectory() })) : [];
        return send(res, 200, entries);
      }
      if (route === '/info' && req.method === 'GET') {
        return send(res, 200, { root, ...gitInfo() });
      }
      return send(res, 404, { error: `unknown endpoint ${req.method} ${route}` });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return send(res, status, { error: String((e as Error).message ?? e) });
    }
  };

  return {
    name: 'rt-capture',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function gitInfo(): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: TOOL_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: TOOL_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}
