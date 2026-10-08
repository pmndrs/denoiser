#!/usr/bin/env node
// Headless check for the three-temporal demos (Chrome + WebGPU over CDP, no puppeteer).
// Needs the dev server up: `yarn dev` (port 5220).
//
//   node run-headless.mjs shadows     # shadows.html: stochastic area-light shadow + SSR, noisy vs denoised
//   node run-headless.mjs ssr         # index.html: webgpu_postprocessing_ssr_denoise port, three vs FFX
//   node run-headless.mjs shadows --upscale   # same, rendered at 1/2 res + FSR3
//
// Screenshots go to ./out/. Exit code 1 if a sanity check fails.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5220;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const scenario = process.argv[2] ?? 'shadows';
const flags = new Set(process.argv.slice(3));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try { return await (await fetch(url)).json(); } catch (e) { lastErr = e; await sleep(250); }
  }
  throw lastErr ?? new Error(`timeout ${url}`);
}

function cdpClient(ws, onEvent) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === undefined) { onEvent?.(msg); return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'eval error');
    return r.result.value;
  };
  return { send, evalJs };
}

const savePng = (name, dataUrl) => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('  saved', path.relative(process.cwd(), file));
  return file;
};

const results = { checks: [], logs: [] };
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
};

async function main() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const page = scenario === 'ssr' ? 'index.html' : 'shadows.html';
  const url = `http://127.0.0.1:${PORT}/${page}?manual=1${flags.has('--upscale') ? '&upscale=1' : ''}${flags.has('--nojitter') ? '&nojitter=1' : ''}${scenario === 'ssr' && flags.has('--timing') ? '&timing=1' : ''}`;
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-features=Vulkan', '--window-size=1100,900', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `three-temporal-${Date.now()}`)}`, url,
  ], { stdio: 'ignore' });
  let ws;
  try {
    const targets = await httpJson(`http://127.0.0.1:${port}/json`);
    const tab = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = cdpClient(ws, (msg) => {
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        results.logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') results.logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) results.logs.push(`log.${msg.params.entry.level}: ${msg.params.entry.text.slice(0, 300)}`);
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    const deadline = Date.now() + 240_000;
    let state;
    while (Date.now() < deadline) {
      state = await cdp.evalJs('JSON.stringify({ ready: !!window.__t?.ready, err: window.__error ?? null })', false).then(JSON.parse).catch(() => null);
      if (state?.ready || state?.err) break;
      await sleep(500);
    }
    if (!state?.ready) throw new Error(`page not ready: ${JSON.stringify(state)}\n${results.logs.join('\n')}`);
    console.log(`page ${page} ready`);

    if (scenario === 'ssr') await runSsr(cdp); else await runShadows(cdp);

    const gpuErrors = await cdp.evalJs('JSON.stringify(window.__t.gpuErrors)').then(JSON.parse);
    const validation = [...gpuErrors, ...results.logs.filter((l) => /invalid|validation|uncaptured/i.test(l))];
    check('no WebGPU validation errors', validation.length === 0, validation.slice(0, 3).join(' | '));
    if (results.logs.length) console.log('console warnings/errors:\n  ' + [...new Set(results.logs)].slice(0, 12).join('\n  '));
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    chrome.kill('SIGKILL');
  }
  const failed = results.checks.filter((c) => !c.ok);
  console.log(failed.length ? `\n${failed.length} check(s) FAILED` : '\nall checks passed');
  process.exit(failed.length ? 1 : 0);
}

async function runShadows(cdp) {
  const T = (expr) => cdp.evalJs(`(async () => JSON.stringify(await (${expr})))()`).then((s) => (s === undefined ? undefined : JSON.parse(s)));
  const shot = async (name, modes, warm = 40) => {
    await T(`window.__t.setModes(${JSON.stringify({ moving: false, ...modes })})`);
    await T(`window.__t.step(${warm})`);
    return savePng(name, await cdp.evalJs('window.__t.capture()'));
  };
  const up = flags.has('--upscale') ? '-fsr' : '';
  console.log('screenshots (static camera, 40 warm-up frames each):');
  await shot(`shadows-noisy${up}.png`, { shadow: 'noisy', refl: 'noisy' });
  await shot(`shadows-denoised${up}.png`, { shadow: 'denoised', refl: 'denoised' });
  await shot(`shadows-only-denoised${up}.png`, { shadow: 'denoised', refl: 'noisy' });
  await shot(`refl-only-denoised${up}.png`, { shadow: 'noisy', refl: 'denoised' });

  console.log('moving camera sequence:');
  await T('window.__t.setModes({ moving: true, shadow: "denoised", refl: "denoised" })');
  for (let i = 0; i < 3; i++) {
    await T('window.__t.step(30)');
    savePng(`shadows-moving-${i}${up}.png`, await cdp.evalJs('window.__t.capture()'));
  }
  const fin = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in denoised shadows (moving)', fin.shadows.bad === 0, JSON.stringify(fin.shadows));
  check('no NaN/Inf in denoised reflections (moving)', fin.reflections.bad === 0, JSON.stringify(fin.reflections));
  await T('window.__t.cut()');
  await T('window.__t.step(2)');
  const fin2 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf right after camera cut', fin2.shadows.bad === 0 && fin2.reflections.bad === 0);
  savePng(`shadows-after-cut${up}.png`, await cdp.evalJs('window.__t.capture()'));

  console.log('temporal noise (static camera, per-pixel std of luma over 24 frames):');
  const m = await T('window.__t.measure(24, 24, 0.02)');
  console.log('  ', JSON.stringify(m));
  check('shadow penumbra pixels found', m.shadows.pixels > 500, `${m.shadows.pixels} px`);
  check('denoised shadow flicker far below noisy', m.shadows.denoisedStd < 0.35 * m.shadows.noisyStd,
    `${m.shadows.noisyStd.toFixed(4)} -> ${m.shadows.denoisedStd.toFixed(4)}`);
  check('reflection pixels found', m.reflections.pixels > 500, `${m.reflections.pixels} px`);
  check('denoised reflection flicker below noisy', m.reflections.denoisedStd < 0.6 * m.reflections.noisyStd,
    `${m.reflections.noisyStd.toFixed(4)} -> ${m.reflections.denoisedStd.toFixed(4)}`);
  console.log('gpuTimings (ms, per pass; may be empty without timestamp-query):', JSON.stringify(await T('window.__t.timings()')));
}

async function runSsr(cdp) {
  const T = (expr) => cdp.evalJs(`(async () => JSON.stringify(await (${expr})))()`).then((s) => (s === undefined ? undefined : JSON.parse(s)));
  const meta = await T('window.__t.info');
  console.log('  ', JSON.stringify(meta));
  const shot = async (name, view, warm) => {
    await T(`window.__t.setView(${JSON.stringify(view)})`);
    if (warm) await T(`window.__t.step(${warm})`);
    return savePng(name, await cdp.evalJs('window.__t.capture()'));
  };
  console.log('screenshots (same camera pose, same frame count; 60 warm-up frames):');
  await T('window.__t.setMoving(false)');
  await T('window.__t.step(60)');
  for (const v of ['three', 'ffx', 'noisy', 'split']) {
    await shot(`ssr-${v}.png`, v, v === 'three' ? 0 : 0);
  }
  console.log('moving-camera sequence:');
  await T('window.__t.setMoving(true)');
  await T('window.__t.setView("split")');
  for (let i = 0; i < 4; i++) {
    await T('window.__t.step(20)');
    savePng(`ssr-moving-${i}.png`, await cdp.evalJs('window.__t.capture()'));
  }
  const fin = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in FFX reflection output (moving)', fin.ffx.bad === 0, JSON.stringify(fin.ffx));
  const st = await T('window.__t.measure(16, 24, 0.02)');
  console.log('  temporal std:', JSON.stringify(st));
  check('FFX temporal flicker below raw noisy', st.ffx.std < 0.6 * st.noisy.std, `${st.noisy.std.toFixed(4)} -> ${st.ffx.std.toFixed(4)}`);
  if (flags.has('--timing')) console.log('  GPU ms/frame (render passes via timestamp queries; FFX compute via gpuTimings):', JSON.stringify(await T('window.__t.timings()')));
}

main().catch((e) => { console.error('FAILED:', e.stack ?? e); process.exit(2); });
