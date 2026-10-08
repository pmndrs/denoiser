#!/usr/bin/env node
// Run the FidelityFX test bed in headless Chrome (WebGPU) and print JSON results.
// Needs the dev server: `yarn workspace ffx-denoiser dev` (http://127.0.0.1:5210/).
//
//   node run-headless.mjs                                  # eval + bench, shadows
//   node run-headless.mjs "signal=shadows&mode=eval" "signal=shadows&mode=bench"
//   node run-headless.mjs --shot=out/shadows-45.png "signal=shadows&stopAt=45&refspp=1024"
//   BASE=http://127.0.0.1:5211/ CHROME=/path/to/chrome node run-headless.mjs ...
//
// No puppeteer: CDP over Node's native WebSocket (as examples/kernels-smoke).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5210/';
const args = process.argv.slice(2);
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7);
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice(7);
const queries = args.filter((a) => !a.startsWith('--'));
const RUNS = queries.length ? queries : ['signal=shadows&mode=eval', 'signal=shadows&mode=bench'];

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

async function run(query) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDir = path.join(os.tmpdir(), `ffx-denoiser-${process.pid}-${Date.now()}`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features', // unquantized timestamp queries
    '--window-size=1960,1000', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
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
    const deadline = Date.now() + 15 * 60_000;
    let r;
    while (Date.now() < deadline) {
      r = await cdp.evalJs('JSON.stringify(window.__ffx ?? null)').then(JSON.parse).catch(() => null);
      if (r?.ready || r?.error) break;
      await sleep(1000);
    }
    r ??= { error: 'timed out' };
    if (shot && r.ready) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
      writeFileSync(shot, Buffer.from(data, 'base64'));
      r.screenshot = path.resolve(shot);
    }
    r.log = await cdp.evalJs(`document.querySelector('#status').textContent`).catch(() => '');
    return r;
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    chrome.kill('SIGKILL');
  }
}

const all = [];
for (const query of RUNS) {
  console.log(`\n=== ${query}`);
  try {
    const r = await run(query);
    console.log(r.log);
    delete r.log;
    if (r.results?.perFrame) {
      const { perFrame, ...rest } = r.results;
      console.log(JSON.stringify({ ...r, results: rest }));
    } else console.log(JSON.stringify(r));
    all.push({ query, ...r });
  } catch (err) {
    console.log(`FAILED: ${err.stack ?? err}`);
    all.push({ query, error: String(err) });
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 1));
