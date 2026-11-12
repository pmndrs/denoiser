// Cross-platform headless Chrome (WebGPU) over CDP, plus an optional Vite dev server.
// Shared by tools/rt-capture/run-headless.mjs and examples/realtime-denoiser/run-headless.mjs.
// No dependencies: Node >= 22 (global fetch + WebSocket).
//
//   Chrome:  $CHROME wins; else the default install path for the platform
//            (macOS /Applications, Windows Program Files / LocalAppData, Linux /usr/bin).
//   Flags:   --use-angle=metal on macOS only (Windows keeps Chrome's default D3D11 ANGLE;
//            WebGPU itself runs on D3D12 / Metal / Vulkan through Dawn either way).
//            $CHROME_FLAGS adds more (space separated).
//   Profile: a fresh temp dir under os.tmpdir(), removed afterwards.
//   Port:    --remote-debugging-port=0; the port is read from <profile>/DevToolsActivePort.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome executable for this platform ($CHROME overrides). */
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const env = process.env;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
      .filter(Boolean)
      .map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] ?? [];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`Chrome not found (looked in: ${candidates.join(', ') || 'nothing for ' + process.platform}); set CHROME=<path to the chrome executable>`);
  return hit;
}

/** Command-line flags for a headless WebGPU page. */
export function chromeArgs({ userDir, url, windowSize = '1200,900' }) {
  const a = [
    '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features', // unquantized timestamp queries
    `--window-size=${windowSize}`, '--remote-debugging-port=0', `--user-data-dir=${userDir}`,
  ];
  if (process.platform === 'darwin') a.push('--use-angle=metal');
  if (process.env.CHROME_FLAGS) a.push(...process.env.CHROME_FLAGS.split(/\s+/).filter(Boolean));
  a.push(url);
  return a;
}

async function httpJson(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try { return await (await fetch(url)).json(); } catch (e) { lastErr = e; await sleep(250); }
  }
  throw lastErr ?? new Error(`timeout ${url}`);
}

function cdpClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.value;
  };
  return { send, evalJs };
}

const connect = async (url) => {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return ws;
};

/**
 * Open `url` in a fresh headless Chrome. Returns { cdp, close }; always call close().
 */
export async function openPage(url, { windowSize } = {}) {
  const userDir = mkdtempSync(path.join(os.tmpdir(), 'rt-headless-'));
  const chrome = spawn(chromePath(), chromeArgs({ userDir, url, windowSize }), { stdio: 'ignore' });
  let exited = false;
  chrome.on('exit', () => { exited = true; });
  chrome.on('error', () => { exited = true; });
  let ws;
  const close = async () => {
    try { ws?.close(); } catch { /* noop */ }
    // ask the browser to quit (lets Windows release the profile), then make sure
    try {
      if (port && !exited) {
        const v = await httpJson(`http://127.0.0.1:${port}/json/version`, 2000);
        const bws = await connect(v.webSocketDebuggerUrl);
        bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        for (let i = 0; i < 30 && !exited; i++) await sleep(100);
        try { bws.close(); } catch { /* noop */ }
      }
    } catch { /* fall through to kill */ }
    if (!exited) chrome.kill('SIGKILL');
    for (let i = 0; i < 20 && !exited; i++) await sleep(100);
    try { rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp dir, best effort */ }
  };
  let port = 0;
  try {
    const portFile = path.join(userDir, 'DevToolsActivePort');
    const deadline = Date.now() + 30000;
    while (!port && Date.now() < deadline) {
      if (exited) throw new Error(`Chrome exited at startup (${chromePath()})`);
      if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]) || 0;
      if (!port) await sleep(100);
    }
    if (!port) throw new Error('Chrome did not report a DevTools port');
    // the page target can take a moment to appear
    let page;
    while (!page && Date.now() < deadline) {
      const targets = await httpJson(`http://127.0.0.1:${port}/json`);
      page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!page) await sleep(200);
    }
    if (!page) throw new Error('no page target');
    ws = await connect(page.webSocketDebuggerUrl);
    const cdp = cdpClient(ws);
    await cdp.send('Runtime.enable');
    return { cdp, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/**
 * Poll `window[stateVar]` until it is `{ ready }` or `{ error }` (or the deadline passes).
 */
export async function waitForState(cdp, stateVar, { timeoutMs = 45 * 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let r = null;
  while (Date.now() < deadline) {
    r = await cdp.evalJs(`JSON.stringify(window.${stateVar} ?? null)`).then(JSON.parse).catch(() => null);
    if (r?.ready || r?.error) return r;
    await sleep(intervalMs);
  }
  return { ...(r ?? {}), error: 'timed out' };
}

/**
 * Make sure a Vite dev server answers at `base`. If it doesn't, start one for `root`
 * (`node <vite>/bin/vite.js <root> --port <port> --strictPort --host 127.0.0.1`, no shell)
 * and return { base, stop } (stop() kills only a server this call started).
 */
export async function ensureVite({ root, base, timeoutMs = 60000, log = console.log }) {
  const up = async () => { try { return (await fetch(base)).ok; } catch { return false; } };
  if (await up()) return { base, started: false, stop: async () => {} };
  const u = new URL(base);
  const req = createRequire(path.join(path.resolve(root), 'package.json'));
  const pkgFile = req.resolve('vite/package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const bin = path.join(path.dirname(pkgFile), typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vite);
  log(`starting vite for ${root} on ${base}`);
  const child = spawn(process.execPath, [bin, path.resolve(root), '--port', u.port || '80', '--strictPort', '--host', u.hostname], {
    stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const deadline = Date.now() + timeoutMs;
  while (!(await up())) {
    if (exited || Date.now() > deadline) { child.kill(); throw new Error(`vite did not start on ${base}:\n${out}`); }
    await sleep(250);
  }
  return {
    base, started: true,
    stop: async () => { if (!exited) child.kill(); for (let i = 0; i < 20 && !exited; i++) await sleep(100); },
  };
}

/** Repo root (this file is tools/rt-capture/lib/headless.mjs). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
