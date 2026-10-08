#!/usr/bin/env node
// Load a webnn-bench page in headless Chrome with WebNN enabled, wait for
// window.__result ({ ready | error }) and print the page log + JSON.
//   node run-headless.mjs "index.html?model=rt_hdr_small&precision=fp16"
// Env: CHROME=<binary> (default: stable), BASE (default http://127.0.0.1:5200/),
// TIMEOUT ms, STREAM=1 (print the page log as it grows).
// No puppeteer: CDP over Node's native WebSocket (as examples/kernels-smoke).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5200/';
const TIMEOUT = Number(process.env.TIMEOUT ?? 900_000);
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['probe.html'];
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

async function run(page) {
  const port = 9600 + Math.floor(Math.random() * 150);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-features=WebMachineLearningNeuralNetwork', `--remote-debugging-port=${port}`,
    ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : []),
    `--user-data-dir=${path.join(os.tmpdir(), `webnn-bench-${process.pid}-${Date.now()}`)}`,
    `${BASE}${page}`,
  ], { stdio: 'ignore' });
  let ws;
  try {
    const targets = await httpJson(`http://127.0.0.1:${port}/json`);
    const t = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = cdpClient(ws);
    await cdp.send('Runtime.enable');
    const deadline = Date.now() + TIMEOUT;
    let r = null;
    let lastLog = '';
    while (Date.now() < deadline) {
      r = await cdp.evalJs('JSON.stringify(window.__result ?? null)').then(JSON.parse).catch(() => null);
      const log = await cdp.evalJs(`document.querySelector('#status')?.textContent ?? ''`).catch(() => '');
      if (process.env.STREAM === '1' && log.length > lastLog.length) { process.stdout.write(log.slice(lastLog.length)); lastLog = log; }
      if (r?.ready || r?.error || r?.ml !== undefined) break;
      await sleep(1000);
    }
    r ??= { error: 'timed out' };
    if (!r.ready && !r.error && r.ml === undefined) r.error = 'timed out';
    r.log = await cdp.evalJs(`document.querySelector('#status')?.textContent ?? ''`).catch(() => '');
    return r;
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    chrome.kill('SIGKILL');
  }
}

for (const page of pages) {
  console.log(`\n=== ${page}`);
  try {
    const r = await run(page);
    if (process.env.STREAM !== '1') console.log(r.log);
    delete r.log;
    console.log('RESULT ' + JSON.stringify(r));
  } catch (err) {
    console.log(`FAILED: ${err.stack ?? err}`);
  }
}
