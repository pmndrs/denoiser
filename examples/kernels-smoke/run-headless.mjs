#!/usr/bin/env node
// Run the kernels smoke page in headless Chrome (WebGPU) for each mode and print
// the results as JSON. Needs the dev server up: `yarn dev` (port 5185).
//
//   node run-headless.mjs                       # default matrix
//   node run-headless.mjs "precision=fp16&shared=1"
//   node run-headless.mjs "facade.html?precision=fp16"   # Denoiser facade, ORT vs kernels runtime
//
// No puppeteer: talks CDP over Node's native WebSocket (same approach as
// tools/capture-gallery/capture.mjs).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5185/';
const MODES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'precision=fp32&shared=0',
  'precision=fp32&shared=1',
  'precision=fp16&shared=0',
  'precision=fp16&shared=1',
];

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
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.value;
  };
  return { send, evalJs };
}

async function runMode(query) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-features=Vulkan', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `kernels-smoke-${Date.now()}`)}`,
    query.includes('.html') ? `${BASE}${query}` : `${BASE}?${query}`,
  ], { stdio: 'ignore' });
  let ws;
  try {
    const targets = await httpJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = cdpClient(ws);
    await cdp.send('Runtime.enable');

    const deadline = Date.now() + 180_000;
    let r;
    while (Date.now() < deadline) {
      r = await cdp.evalJs('JSON.stringify(window.__kernelsSmoke ?? null)').then(JSON.parse).catch(() => null);
      if (r?.ready || r?.error) break;
      await sleep(500);
    }
    if (r?.ready && !r.bench) {
      await cdp.evalJs(`(async () => { document.querySelector('#bench').click();
        while (!window.__kernelsSmoke.bench) await new Promise(r => setTimeout(r, 200)); })()`, true);
      r = JSON.parse(await cdp.evalJs('JSON.stringify(window.__kernelsSmoke)'));
    }
    r ??= { error: 'timed out' };
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
    console.log(JSON.stringify(r));
  } catch (err) {
    console.log(`FAILED: ${err.stack ?? err}`);
  }
}
