#!/usr/bin/env node
// Run the replay page in headless Chrome (WebGPU) and print each run's summary.
// Needs the dev server (from the repo root):
//   node node_modules/vite/bin/vite.js tools/rt-capture --port 5230 --strictPort --host 127.0.0.1
//
//   node tools/rt-capture/run-headless.mjs "capture=synthetic-plane&denoiser=accumulate" \
//        "capture=synthetic-plane&denoiser=passthrough" [--json out.json]
//   BASE=http://127.0.0.1:5230/ CHROME=/path/to/chrome node tools/rt-capture/run-headless.mjs ...
//
// Then score: node tools/rt-capture/compare.mjs synthetic-plane
// (pattern: examples/ffx-denoiser/run-headless.mjs; CDP over Node's WebSocket, no puppeteer)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5230/';
const args = process.argv.slice(2);
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice(7);
const RUNS = args.filter((a) => !a.startsWith('--'));
if (!RUNS.length) RUNS.push('capture=synthetic-plane&denoiser=passthrough', 'capture=synthetic-plane&denoiser=accumulate');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, timeoutMs = 15000) {
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
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.value;
  };
  return { send, evalJs };
}

async function run(query) {
  const port = 9800 + Math.floor(Math.random() * 400);
  const userDir = path.join(os.tmpdir(), `rt-capture-${process.pid}-${Date.now()}`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features',
    '--window-size=1200,900', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    `${BASE}?${query}`,
  ], { stdio: 'ignore' });
  let ws;
  try {
    const targets = await httpJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = cdpClient(ws);
    await cdp.send('Runtime.enable');
    const deadline = Date.now() + 30 * 60_000;
    let r;
    while (Date.now() < deadline) {
      r = await cdp.evalJs('JSON.stringify(window.__rtc ?? null)').then(JSON.parse).catch(() => null);
      if (r?.ready || r?.error) break;
      await sleep(500);
    }
    r ??= { error: 'timed out' };
    r.log = await cdp.evalJs(`document.querySelector('#status').textContent`).catch(() => '');
    return r;
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    chrome.kill('SIGKILL');
  }
}

const all = [];
let failed = 0;
for (const query of RUNS) {
  console.log(`\n=== ${query}`);
  try {
    const r = await run(query);
    if (r.error) { failed++; console.log(r.log); console.log(`ERROR: ${r.error}`); } else console.log(JSON.stringify(r.results));
    all.push({ query, ...r });
  } catch (err) {
    failed++;
    console.log(`FAILED: ${err.stack ?? err}`);
    all.push({ query, error: String(err) });
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 1));
process.exit(failed ? 1 : 0);
