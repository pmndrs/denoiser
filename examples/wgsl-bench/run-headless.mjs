#!/usr/bin/env node
// Run the WGSL bench page in headless Chrome (WebGPU) once per query string and
// print its log + JSON results. Needs the dev server up: `yarn dev` (port 5190).
//
//   node run-headless.mjs                                    # facade, fp32 + fp16
//   node run-headless.mjs "mode=net&precision=fp16&profile=1"
//   node run-headless.mjs "mode=net&runtimes=wgsl&tiling=4,2,2,8,8"
//
// No puppeteer: CDP over Node's native WebSocket (as examples/kernels-smoke).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WGSL_BENCH_URL ?? 'http://localhost:5190/';
const TIMEOUT = Number(process.env.WGSL_BENCH_TIMEOUT ?? 600_000);
const QUIET = process.env.QUIET === '1';
const MODES = process.argv.slice(2).length ? process.argv.slice(2) : ['precision=fp32', 'precision=fp16'];

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

async function runMode(query) {
  const port = 9800 + Math.floor(Math.random() * 150);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-features=Vulkan', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `wgsl-bench-${process.pid}-${Date.now()}`)}`,
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
    const deadline = Date.now() + TIMEOUT;
    let r;
    while (Date.now() < deadline) {
      r = await cdp.evalJs('JSON.stringify(window.__wgslBench ?? null)').then(JSON.parse).catch(() => null);
      if (r?.ready || r?.error) break;
      await sleep(500);
    }
    r ??= { error: 'timed out' };
    if (!r.ready && !r.error) r.error = 'timed out';
    r.log = await cdp.evalJs(`document.querySelector('#status').textContent`);
    return r;
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    chrome.kill('SIGKILL');
  }
}

for (const mode of MODES) {
  console.log(`\n=== ${mode}`);
  try {
    const r = await runMode(mode);
    console.log(r.log);
    delete r.log;
    if (!QUIET) console.log(JSON.stringify(r));
  } catch (err) {
    console.log(`FAILED: ${err.stack ?? err}`);
  }
}
