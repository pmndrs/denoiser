#!/usr/bin/env node
// Examples dev hub / launcher.
//   yarn examples               -> ONE dev server for everything: the landing page (examples/site) at /,
//                                  every example at /<dir>/ (same paths as the deployed site). Each
//                                  example's Vite server starts on its first visit, with its own
//                                  vite.config, so HMR, aliases and the /models + /tzas middlewares work.
//   yarn examples --port 5160   -> hub port (default 5160; next free one if taken)
//   yarn examples --list        -> print the examples and their standalone dev ports
//   yarn examples <name>        -> just that example's own dev server (`yarn workspace <name> dev`)
// Names may be abbreviated (any unique prefix / substring), e.g. `three`, `test`, `bench`, `smoke`.
import { readdirSync, readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(root, 'examples');
const siteDir = path.join(examplesDir, 'site');

const examples = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(examplesDir, d.name, 'package.json')))
  .map((d) => {
    const dir = path.join(examplesDir, d.name);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const dev = pkg.scripts?.dev ?? '';
    const port = dev.match(/--port\s+(\d+)/)?.[1] ?? '5173';
    const configFile = ['vite.config.ts', 'vite.config.mjs', 'vite.config.js']
      .map((f) => path.join(dir, f))
      .find(existsSync);
    return { dir: d.name, root: dir, name: pkg.name, port, configFile, description: pkg.description ?? '', hasDev: Boolean(pkg.scripts?.dev) };
  })
  .filter((e) => e.hasDev)
  .sort((a, b) => a.port.localeCompare(b.port));

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const hubPort = portArg >= 0 ? Number(args[portArg + 1]) : 5160;
const query = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');

if (args.includes('--list')) {
  const pad = Math.max(...examples.map((e) => e.name.length));
  console.log('\nRunnable examples (all of them: `yarn examples`; one standalone: `yarn examples <name>`).');
  console.log('Standalone ports are preferred; Vite falls through to the next free one if taken.\n');
  for (const e of examples) {
    console.log(`  ${e.name.padEnd(pad)}  :${e.port}+  ${e.description}`);
  }
  console.log('');
  process.exit(0);
}

if (query) {
  const matches = examples.filter((e) => e.name === query)
    .concat(examples.filter((e) => e.name !== query && e.name.includes(query)));

  if (matches.length === 0) {
    console.error(`No example matching "${query}". Run \`yarn examples --list\` to see the list.`);
    process.exit(1);
  }
  if (matches.length > 1 && matches[0].name !== query) {
    console.error(`"${query}" is ambiguous: ${matches.map((m) => m.name).join(', ')}`);
    process.exit(1);
  }

  const target = matches[0];
  console.log(`Starting ${target.name} (preferred port ${target.port}, next free if taken) ...\n`);
  spawn('yarn', ['workspace', target.name, 'dev'], { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' })
    .on('exit', (code) => process.exit(code ?? 0));
} else {
  await hub();
}

async function hub() {
  // Examples that import `denoiser` without a source alias resolve its built dist/.
  if (!existsSync(path.join(root, 'packages', 'denoiser', 'dist'))) {
    console.log('packages/denoiser/dist is missing; running `yarn build:lib` first ...\n');
    const r = spawnSync('yarn', ['build:lib'], { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  const { createServer } = await import('vite');
  const byDir = new Map(examples.filter((e) => e.configFile).map((e) => [e.dir, e]));
  const servers = new Map(); // dir -> Promise<ViteDevServer>
  const server = http.createServer(handle);
  server.setMaxListeners(0); // one HMR upgrade listener per started example

  function vite(e) {
    if (!servers.has(e.dir)) {
      console.log(`  starting ${e.dir} ...`);
      const p = createServer({
        configFile: e.configFile,
        root: e.root,
        base: `/${e.dir}/`,
        appType: 'mpa',
        clearScreen: false,
        logLevel: 'warn',
        // All examples share this one HTTP server; Vite routes each HMR socket by its base path.
        server: { middlewareMode: true, ws: { server } },
      }).then((s) => { console.log(`  ready    /${e.dir}/`); return s; });
      p.catch(() => servers.delete(e.dir));
      servers.set(e.dir, p);
    }
    return servers.get(e.dir);
  }

  function notFound(res) {
    res.statusCode = 404;
    res.end('Not found');
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const first = url.pathname.split('/')[1] ?? '';

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(landingPage());
      return;
    }
    if (first === 'shots') {
      const file = path.join(siteDir, decodeURIComponent(url.pathname));
      if (!file.startsWith(siteDir) || !existsSync(file) || !statSync(file).isFile()) return notFound(res);
      createReadStream(file).pipe(res);
      return;
    }
    if (first === 'docs') {
      res.writeHead(302, { Location: 'https://pmndrs.github.io/denoiser/docs/' });
      res.end();
      return;
    }

    // /<example>/... goes to that example's server. Root-absolute requests an example
    // makes itself (/models, /tzas, /dump) go to the example the page came from.
    let e = byDir.get(first);
    if (e && url.pathname === `/${first}`) {
      res.writeHead(302, { Location: `/${first}/${url.search}` });
      res.end();
      return;
    }
    if (!e && req.headers.referer) {
      e = byDir.get(new URL(req.headers.referer).pathname.split('/')[1] ?? '');
    }
    if (!e) return notFound(res);

    try {
      const s = await vite(e);
      s.middlewares(req, res, () => notFound(res));
    } catch (err) {
      console.error(`  ${e.dir} failed to start:`, err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`Vite failed to start for examples/${e.dir}:\n\n${err?.stack ?? err}`);
    }
  }

  // The deployed landing page, plus a list of the examples it doesn't link (dev harnesses).
  function landingPage() {
    const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8');
    const linked = new Set([...html.matchAll(/href="\.\/([^/"]+)\//g)].map((m) => m[1]));
    const rest = [...byDir.values()].filter((e) => !linked.has(e.dir));
    if (rest.length === 0) return html;
    const items = rest
      .map((e) => `<li><a href="./${e.dir}/">${e.dir}</a> <span>${escapeHtml(e.description)}</span></li>`)
      .join('\n');
    const section = `
      <section class="devonly">
        <h2>Dev harnesses <small>(local only, not deployed)</small></h2>
        <ul>${items}</ul>
      </section>
      <style>
        .devonly { margin-top: 2.5rem; }
        .devonly h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }
        .devonly h2 small { color: var(--muted); font-weight: normal; font-size: 0.85rem; }
        .devonly ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
        .devonly li { color: var(--muted); font-size: 0.9rem; }
        .devonly a { color: var(--accent); text-decoration: none; margin-right: 0.5rem; font-family: ui-monospace, monospace; }
      </style>`;
    return html.replace('</main>', `</main>${section}`);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  let port = hubPort;
  await new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code !== 'EADDRINUSE' || port > hubPort + 20) return reject(err);
      server.listen(++port);
    });
    server.listen(port, resolve);
  });

  console.log(`\nExamples hub: http://localhost:${port}/`);
  console.log('Each example starts on its first visit. Examples that import `denoiser` use its built');
  console.log('dist/: re-run `yarn build:lib` after changing the library.\n');

  const shutdown = async () => {
    await Promise.allSettled([...servers.values()].map(async (p) => (await p).close()));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
