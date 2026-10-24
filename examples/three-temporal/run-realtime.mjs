#!/usr/bin/env node
// Headless checks for the denoiser/realtime pages (Chrome + WebGPU over CDP, no puppeteer),
// same pattern as run-headless.mjs. Needs a dev server: `yarn dev` (port 5220) or --port=N.
//
//   node run-realtime.mjs shadows [--port=5220] [--query=sampler=white] [--metrics] [--bench]
//        realtime-shadows.html: loads, screenshots (split / FFX / ours / noisy / reference),
//        NaN checks (static, moving, after a cut), denoiser GPU ms, and with --metrics the
//        static-camera PSNR / FLIP vs a 4096-ray reference
//        --metrics-only skips the screenshots (fresh page: at 1080p a long page session ran the tab out of memory)
//   node run-realtime.mjs gi [...]    realtime-gi.html: diffuse + specular + AO, same checks
//   node run-realtime.mjs bench --page=realtime-shadows --view=ffx|ours [--query=...]
//   node run-realtime.mjs bench --page=realtime-gi --signal=specular --view=ours|other   (joint / FFX reflections)
//        one denoiser per page load, per-pass ms (median / min of 120 frames)
//   node run-realtime.mjs smoke --page=shadows.html     load any page, report errors only
//   node run-realtime.mjs path [--page=realtime-shadows|realtime-gi] [--at=0,20,39,48,63] [--view=split]
//        screenshots along the scripted camera path (?path=orbit)
//   node run-realtime.mjs capture [--set=moving] [--windows=name:start:frames,...] [--refShadow=1024]
//        [--refDiffuse=1024] [--refSpec=256] [--dry] [--no-validate]
//        realtime-gi.html?path=orbit&ref=1: writes CAPTURE-FORMAT v0 captures of the scripted camera
//        path with a converged reference per pose (CAPTURES.md here), then tools/rt-capture/validate.mjs.
//        Default set "moving": three-orbit (path frames 0-39) and three-pan (32-63; the pan starts at 8).
//
// Screenshots go to ./out/ (or $OUT); --json=file writes the results. Exit 1 if a check fails.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const scenario = args.find((a) => !a.startsWith('--')) ?? 'shadows';
const PORT = Number(opt('port', 5220));
const OUT = process.env.OUT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { scenario, checks: [], logs: [], data: {} };
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
};
const savePng = (name, dataUrl) => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('  saved', path.relative(process.cwd(), file));
};

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

async function openPage(url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-headless-m6-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
    '--window-size=1100,900', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url,
  ], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  let port;
  for (let i = 0; i < 100 && !port; i++) { await sleep(150); if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, 'utf8').split('\n')[0]; }
  if (!port) throw new Error('Chrome did not start');
  let tab;
  for (let i = 0; i < 60 && !tab; i++) {
    try { tab = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* not yet */ }
    if (!tab) await sleep(250);
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
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
  const close = () => { try { ws.close(); } catch { /* noop */ } chrome.kill('SIGKILL'); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500); };
  return { cdp, close };
}

async function waitReady(cdp, probe = 'window.__t?.ready', timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await cdp.evalJs(`JSON.stringify({ ready: !!(${probe}), err: window.__error ?? null })`, false).then(JSON.parse).catch(() => null);
    if (state?.ready || state?.err) break;
    await sleep(500);
  }
  return state;
}

const validationOf = async (cdp) => {
  const gpu = await cdp.evalJs('JSON.stringify(window.__t?.gpuErrors ?? [])').then(JSON.parse).catch(() => []);
  return [...gpu, ...results.logs.filter((l) => /invalid|validation|uncaptured|exception/i.test(l))];
};

// Evaluates a page expression; a call that hangs (e.g. a lost device stops the frame loop) fails
// after --stepTimeout ms with the page's status line instead of waiting for the global timeout.
function makeT(cdp) {
  const limit = Number(opt('stepTimeout', 600_000));
  return async (expr) => {
    let timer;
    const dead = new Promise((_, rej) => { timer = setTimeout(async () => {
      const st = await Promise.race([cdp.evalJs("document.querySelector('#status')?.textContent ?? ''", false).catch(() => '?'), sleep(5000).then(() => '(page unresponsive)')]);
      rej(new Error(`step timed out after ${limit} ms: ${expr.slice(0, 80)} | status: ${st.slice(0, 200)} | logs: ${results.logs.slice(-3).join(' | ')}`));
    }, limit); });
    try {
      const s = await Promise.race([cdp.evalJs(`(async () => JSON.stringify(await (${expr})))()`), dead]);
      return s === undefined ? undefined : JSON.parse(s);
    } finally { clearTimeout(timer); }
  };
}

async function runShadows(cdp) {
  const T = makeT(cdp);
  const info = await T('window.__t.info');
  console.log('  ', JSON.stringify(info));
  results.data.info = info;
  check('BVH built over the scene meshes', info.triangles > 5000, `${info.triangles} triangles`);
  const tag = info.sampler === 'white' ? '-white' : '';
  if (!flag('metrics-only')) await shadowShots(T, cdp, tag);
  if (flag('metrics')) await shadowMetrics(T, info);
}

async function shadowShots(T, cdp, tag) {
  await T('window.__t.setModes({ moving: false, shot: 0, show: "lit" })');
  for (const v of ['split', 'ffx', 'ours', 'noisy', 'ref']) {
    await T(`window.__t.setModes({ view: '${v}' })`);
    await T(`window.__t.step(${v === 'ref' ? 260 : 60})`);
    savePng(`realtime-shadows${tag}-${v}.png`, await cdp.evalJs('window.__t.capture()'));
  }
  await T('window.__t.setModes({ view: "split", show: "mask" })');
  await T('window.__t.step(30)');
  savePng(`realtime-shadows${tag}-split-mask.png`, await cdp.evalJs('window.__t.capture()'));
  await T('window.__t.setModes({ show: "lit", shot: 1 })');
  await T('window.__t.step(60)');
  savePng(`realtime-shadows${tag}-close-split.png`, await cdp.evalJs('window.__t.capture()'));
  const fin0 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in either output (static)', fin0.ffx.bad === 0 && fin0.ours.bad === 0, JSON.stringify(fin0));

  await T('window.__t.setModes({ view: "split", moving: true, shot: 0 })');
  for (let i = 0; i < 2; i++) { await T('window.__t.step(45)'); savePng(`realtime-shadows${tag}-moving-${i}.png`, await cdp.evalJs('window.__t.capture()')); }
  const fin1 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in either output (moving)', fin1.ffx.bad === 0 && fin1.ours.bad === 0, JSON.stringify(fin1));
  await T('window.__t.cut()');
  await T('window.__t.step(2)');
  const fin2 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf right after a camera cut', fin2.ffx.bad === 0 && fin2.ours.bad === 0, JSON.stringify(fin2));
  await T('window.__t.cut()');

  console.log('denoiser GPU ms in split view (both run every frame; bench one per page load for costs):');
  const c = await T('window.__t.costs(60)');
  results.data.splitCosts = c;
  for (const k of ['ffx', 'ours']) console.log(`  ${k}: ${Object.entries(c[k]).map(([p, s]) => `${p} ${s.median.toFixed(3)}`).join(', ')}`);

}

async function shadowMetrics(T, info) {
  {
    console.log('static camera vs the converged reference (wide shot, then close-up):');
    for (const shot of opt('shots', '0,1').split(',').map(Number)) {
      await T(`window.__t.setModes({ moving: false, shot: ${shot}, t: 0 })`);
      const m = await T(`window.__t.metrics({ frames: ${Number(opt('frames', 64))}, errImages: ${info.w <= 960} })`);
      const tag2 = `${info.sampler === 'white' ? '-white' : ''}${info.w !== 960 ? '-' + info.h : ''}`;
      for (const [k, url] of Object.entries(m.errImages ?? {})) savePng(`realtime-shadows${tag2}-err-shot${shot}-${k}.png`, url);
      delete m.errImages;
      results.data[`metrics-shot${shot}`] = m;
      console.log(`  shot ${shot}: ${m.receivers} receivers, ${m.penumbraPx} penumbra px, ${m.refRays} ref rays, ppd ${m.ppd}`);
      for (const r of m.rows) console.log(`   f${String(r.frame).padStart(3)}  ` + ['noisy', 'ffx', 'ours'].map((k) => `${k} ${r[k].psnr.toFixed(2)} / pen ${r[k].penumbra.toFixed(2)}`).join('   '));
      console.log('   FLIP (last frame):', JSON.stringify(m.flip));
      const last = m.rows.at(-1);
      check(`metrics shot ${shot}: no NaN in readbacks`, last.ffx.bad === 0 && last.ours.bad === 0);
    }
  }
}

async function runGi(cdp) {
  const T = makeT(cdp);
  const info = await T('window.__t.info');
  console.log('  ', JSON.stringify(info));
  results.data.info = info;
  await T('window.__t.setModes({ moving: false, shot: 0 })');
  for (const [sig, views] of [['lit', ['split', 'noisy', 'ref']], ['diffuse', ['split', 'noisy', 'ref']], ['specular', ['split', 'noisy', 'ref']], ['ao', ['split', 'noisy', 'ref']]]) {
    for (const v of views) {
      await T(`window.__t.setModes({ signal: '${sig}', view: '${v}' })`);
      await T(`window.__t.step(${v === 'ref' ? 260 : 60})`);
      savePng(`realtime-gi-${sig}-${v}.png`, await cdp.evalJs('window.__t.capture()'));
    }
  }
  await T('window.__t.setModes({ signal: "lit", view: "split" })');
  const fin0 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in outputs (static)', Object.values(fin0).every((r) => r.bad === 0), JSON.stringify(fin0));
  await T('window.__t.setModes({ moving: true })');
  for (let i = 0; i < 2; i++) { await T('window.__t.step(45)'); savePng(`realtime-gi-moving-${i}.png`, await cdp.evalJs('window.__t.capture()')); }
  const fin1 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in outputs (moving)', Object.values(fin1).every((r) => r.bad === 0), JSON.stringify(fin1));
  await T('window.__t.cut()');
  await T('window.__t.step(2)');
  const fin2 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf right after a camera cut', Object.values(fin2).every((r) => r.bad === 0), JSON.stringify(fin2));
  await T('window.__t.cut()');
  const c = await T('window.__t.costs(60)');
  results.data.costs = c;
  for (const [k, m] of Object.entries(c)) console.log(`  ${k}: ${Object.entries(m).map(([p, s]) => `${p} ${s.median.toFixed(3)}`).join(', ')}`);
  if (flag('metrics')) {
    for (const shot of opt('shots', '0,1').split(',').map(Number)) {
      await T(`window.__t.setModes({ moving: false, shot: ${shot}, t: 0 })`);
      const m = await T(`window.__t.metrics({ frames: ${Number(opt('frames', 64))} })`);
      results.data[`metrics-shot${shot}`] = m;
      console.log(`  shot ${shot}:`, JSON.stringify(m.summary ?? m));
    }
  }
}

async function runBench(cdp) {
  const T = makeT(cdp);
  const view = opt('view', 'ours');
  const sig = opt('signal');
  await T(`window.__t.setModes({ ${sig ? `signal: '${sig}', ` : ''}view: '${view}', moving: ${!flag('static')} })`);
  await T('window.__t.step(60)');
  const c = await T(`window.__t.costs(${Number(opt('frames', 120))})`);
  results.data.costs = c;
  for (const [k, m] of Object.entries(c)) if (Object.keys(m).length) console.log(`  ${k}: ${Object.entries(m).map(([p, s]) => `${p} ${s.median.toFixed(3)} (min ${s.min.toFixed(3)})`).join(', ')}`);
}

// Screenshots along the scripted path (?path=orbit): the page starts at path frame 0 and advances one
// path frame per rendered frame, so after k steps it shows path frame k.
async function runPathShots(cdp) {
  const T = makeT(cdp);
  const at = opt('at', '0,20,39,48,63').split(',').map(Number);
  await T(`window.__t.setModes({ view: '${opt('view', 'split')}', moving: true })`);
  let f = 0;
  for (const k of at) {
    if (k > f) { await T(`window.__t.step(${k - f})`); f = k; }
    // capture() renders one more frame; pause so it shows path frame k
    await T('window.__t.setModes({ moving: false })');
    savePng(`${opt('page', 'realtime-shadows')}-path-${String(k).padStart(2, '0')}.png`, await cdp.evalJs('window.__t.capture()'));
    await T('window.__t.setModes({ moving: true })');
  }
}

// The moving-camera capture set (CAPTURES.md): name:start:frames on the 64-frame path of src/realtime/path.ts
export const CAPTURE_SETS = { moving: 'three-orbit:0:40,three-pan:32:32' };

async function runCapture(cdp) {
  const T = makeT(cdp);
  const info = await T('window.__t.info');
  console.log('  ', JSON.stringify(info));
  if (!info.capMode) throw new Error('page is not in capture mode (needs path=orbit&ref=1)');
  const windows = (opt('windows') ?? CAPTURE_SETS[opt('set', 'moving')]).split(',').map((w) => {
    const [name, start, frames] = w.split(':');
    return { name, start: Number(start ?? 0), frames: Number(frames ?? 64) };
  });
  const refs = { refShadow: Number(opt('refShadow', 1024)), refDiffuse: Number(opt('refDiffuse', 1024)), refSpec: Number(opt('refSpec', 256)) };
  for (const w of windows) {
    console.log(`capture ${w.name}: path frames ${w.start}..${w.start + w.frames - 1}, ${JSON.stringify(refs)}`);
    const r = await T(`window.__t.capturePath(${JSON.stringify({ ...w, ...refs, write: !flag('dry') })})`);
    results.data[w.name] = r;
    console.log(`  ${r.frames} frames in ${r.seconds} s (${(r.seconds / r.frames).toFixed(2)} s/frame), refs ${JSON.stringify(r.refRays)}, gpu errors ${r.gpuErrors}`);
    check(`capture ${w.name} written`, flag('dry') || !!r.path, r.path ?? '');
    if (!flag('dry') && !flag('no-validate')) {
      const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
      const v = spawnSync(process.execPath, [path.join(repo, 'tools', 'rt-capture', 'validate.mjs'), w.name, '--quiet'], { stdio: 'inherit', env: process.env });
      check(`validate.mjs ${w.name}`, v.status === 0, `exit ${v.status}`);
    }
  }
}

async function main() {
  setTimeout(() => { console.error('FAILED: timed out'); process.exit(3); }, Number(opt('timeout', 1_800_000))).unref();
  const page = scenario === 'smoke' ? opt('page', 'shadows.html') : `${opt('page', scenario === 'gi' || scenario === 'capture' ? 'realtime-gi' : 'realtime-shadows').replace(/\.html$/, '')}.html`;
  const extra = [scenario === 'capture' ? 'path=orbit&ref=1' : scenario === 'path' ? 'path=orbit' : '', opt('query', '')].filter(Boolean).join('&');
  const url = `http://127.0.0.1:${PORT}/${page}?manual=1${extra ? '&' + extra : ''}`;
  console.log(url);
  const { cdp, close } = await openPage(url);
  try {
    if (scenario === 'smoke') {
      // pages without the manual-stepping hooks: let them run, then look at the console
      const state = await waitReady(cdp, "window.__t?.ready || window.__ffx?.ready || document.querySelector('#status')?.textContent?.startsWith('ready')", 120_000);
      await sleep(4000);
      const status = await cdp.evalJs("document.querySelector('#status, .dn-status')?.textContent?.slice(0, 200) ?? ''", false).catch(() => '');
      console.log('  status:', JSON.stringify(status));
      check(`${page} loads`, !!state?.ready && !state?.err, JSON.stringify(state));
    } else {
      const state = await waitReady(cdp);
      if (!state?.ready) throw new Error(`page not ready: ${JSON.stringify(state)}\n${results.logs.join('\n')}`);
      console.log(`page ${page} ready`);
      if (scenario === 'shadows') await runShadows(cdp);
      else if (scenario === 'gi') await runGi(cdp);
      else if (scenario === 'bench') await runBench(cdp);
      else if (scenario === 'capture') await runCapture(cdp);
      else if (scenario === 'path') await runPathShots(cdp);
    }
    const validation = await validationOf(cdp);
    check('no WebGPU validation errors / exceptions', validation.length === 0, validation.slice(0, 3).join(' | '));
    if (results.logs.length) console.log('console warnings/errors:\n  ' + [...new Set(results.logs)].slice(0, 12).join('\n  '));
  } finally {
    close();
  }
  const json = opt('json');
  if (json) fs.writeFileSync(json, JSON.stringify(results, null, 1));
  const failed = results.checks.filter((c) => !c.ok);
  console.log(failed.length ? `\n${failed.length} check(s) FAILED` : '\nall checks passed');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FAILED:', e.stack ?? e); process.exit(2); });
