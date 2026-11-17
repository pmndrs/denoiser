#!/usr/bin/env node
// Headless check for the three-temporal demos (Chrome + WebGPU over CDP, no puppeteer).
// Needs the dev server up: `yarn dev` (port 5220).
//
//   node run-headless.mjs shadows     # shadows.html: every shadow / reflection mode, contact-hardening
//                                     # crop, flicker, NaN checks, measured per-pass GPU costs
//   node run-headless.mjs shadows --diag   # + the FSR3 flicker diagnosis (__t.diag with FSR3 on)
//   node run-headless.mjs ssr         # index.html: webgpu_postprocessing_ssr_denoise port, three vs FFX
//   node run-headless.mjs reflections probes|rooms|hybrid [--ref DIR]
//                                     # reflection-probes / reflections-rooms / reflections-hybrid: every
//                                     # lookup or mode per scenario, same frame counts each run; --ref DIR
//                                     # diffs each shot against the same-named PNG in DIR (another build)
//
// Screenshots go to ./out/ (or $OUT). Exit code 1 if a sanity check fails. $PORT overrides 5220.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT ?? 5220);
const OUT = process.env.OUT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const scenario = process.argv[2] ?? 'shadows';
const flags = new Set(process.argv.slice(3));
const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const REFL_PAGES = { probes: 'reflection-probes.html', rooms: 'reflections-rooms.html', hybrid: 'reflections-hybrid.html' };
const reflPage = scenario === 'reflections' ? (process.argv[3] ?? 'rooms') : null;
const refDir = argAfter('--ref');
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
  // a hung GPU process must not hang CI forever
  setTimeout(() => { console.error('FAILED: timed out'); process.exit(3); }, 600_000).unref();
  const port = 9300 + Math.floor(Math.random() * 500);
  const page = reflPage ? REFL_PAGES[reflPage] : scenario === 'ssr' ? 'index.html' : 'shadows.html';
  const url = `http://127.0.0.1:${PORT}/${page}?manual=1${scenario === 'ssr' && flags.has('--timing') ? '&timing=1' : ''}`;
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
      state = await cdp.evalJs('JSON.stringify({ ready: !!(window.__t?.ready || window.__p), err: window.__error ?? null })', false).then(JSON.parse).catch(() => null);
      if (state?.ready || state?.err) break;
      await sleep(500);
    }
    if (!state?.ready) throw new Error(`page not ready: ${JSON.stringify(state)}\n${results.logs.join('\n')}`);
    console.log(`page ${page} ready`);

    if (reflPage) await runReflections(cdp); else if (scenario === 'ssr') await runSsr(cdp); else await runShadows(cdp);

    const gpuErrors = await cdp.evalJs('JSON.stringify(window.__t?.gpuErrors ?? [])').then(JSON.parse);
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
  const info = await T('window.__t.info');
  console.log('  ', JSON.stringify(info));
  check('BVH built over the real scene meshes', info.triangles > 5000, `${info.triangles} triangles in ${info.bvhBuildMs.toFixed(0)} ms`);
  const grab = async (modes, warm) => {
    await T(`window.__t.setModes(${JSON.stringify({ moving: false, ...modes })})`);
    await T(`window.__t.step(${warm})`);
    return cdp.evalJs('window.__t.capture()');
  };
  const SH = ['map', 'noisy', 'ffx', 'ref'];
  const warmOf = (s) => (s === 'ref' ? 140 : 40);

  console.log('shadow modes (wide shot, static camera, reflections = SSR + FFX):');
  for (const s of SH) savePng(`shadows-${s}.png`, await grab({ shot: 0, shadow: s, refl: 'ffx' }, warmOf(s)));
  console.log('reflection modes (wide shot, shadows = FFX):');
  for (const r of ['env', 'noisy', 'ffx']) savePng(`reflections-${r}.png`, await grab({ shot: 0, shadow: 'ffx', refl: r }, 40));

  console.log('contact hardening (same frame for each mode; wide shot and close-up):');
  const LABELS = { map: 'three.js shadow map (VSM)', noisy: '1 ray/pixel, raw', ffx: '1 ray/pixel + ffxShadows', ref: 'reference (2048 rays/pixel)' };
  for (const [name, shot, crop, scale] of [['contact-hardening-wide', 0, [230, 290, 640, 250], 1], ['contact-hardening', 1, [220, 190, 740, 290], 0.7]]) {
    const caps = {};
    for (const s of ['map', 'noisy', 'ffx', 'ref']) caps[s] = await grab({ shot, shadow: s, refl: 'ffx' }, warmOf(s));
    for (const s of ['map', 'noisy', 'ffx', 'ref']) if (shot === 1) savePng(`close-${s}.png`, caps[s]);
    savePng(`${name}.png`, await T(`window.__t.montage(${JSON.stringify(['map', 'ffx', 'ref'].map((s) => ({ url: caps[s], label: LABELS[s] })))}, ${JSON.stringify(crop)}, ${scale})`));
  }
  await T('window.__t.setModes({ shot: 0 })');
  // landing-page thumbnail: close-up, three's shadow map (left) vs ray traced + FFX (right)
  const tA = await grab({ shot: 1, shadow: 'map', refl: 'env' }, 40);
  const tB = await grab({ shot: 1, shadow: 'ffx', refl: 'ffx' }, 40);
  savePng('thumb-640x400.png', await T(`window.__t.thumb(${JSON.stringify(tA)}, ${JSON.stringify(tB)}, ['three.js shadow map', '1 ray + FFX'], [96, 0, 864, 540])`));
  await T('window.__t.setModes({ shot: 0 })');

  console.log('moving camera (FFX shadows + reflections):');
  await T('window.__t.setModes({ moving: true, shot: 0, shadow: "ffx", refl: "ffx" })');
  for (let i = 0; i < 3; i++) {
    await T('window.__t.step(45)');
    savePng(`moving-${i}.png`, await cdp.evalJs('window.__t.capture()'));
  }
  const fin = await T('window.__t.finiteCheck()');
  check('no NaN/Inf in denoised shadows (moving)', fin.shadows.bad === 0, JSON.stringify(fin.shadows));
  check('no NaN/Inf in denoised reflections (moving)', fin.reflections.bad === 0, JSON.stringify(fin.reflections));
  await T('window.__t.cut()');
  await T('window.__t.step(2)');
  const fin2 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf right after camera cut', fin2.shadows.bad === 0 && fin2.reflections.bad === 0);
  savePng('after-cut.png', await cdp.evalJs('window.__t.capture()'));
  await T('window.__t.cut()');

  console.log('temporal flicker (static camera, per-pixel std of luma over 20 frames):');
  const f = await T('window.__t.flicker(20, 30, 0.02)');
  console.log('  ', JSON.stringify(f));
  check('shadow penumbra pixels found', f.pixels > 500, `${f.pixels} px`);
  check('FFX shadow flicker far below raw 1 ray/pixel', f.ffx < 0.35 * f.noisy, `${f.noisy.toFixed(4)} -> ${f.ffx.toFixed(4)}`);

  console.log('GPU cost per mode (ms, median of 40 frames, 960x540; rows are estimates, frame = measured span):');
  const fmt = (c) => `frame ${c.total.toFixed(2)} | raster ${c.raster.toFixed(2)} shadowmap ${c['shadow map'].toFixed(2)} rays ${c['ray trace'].toFixed(2)} ssr ${c.SSR.toFixed(2)} ffx ${c.denoise.toFixed(2)} (sh ${c['ffx shadows (compute)'].toFixed(2)} / refl ${c['ffx reflections (compute)'].toFixed(2)}) composite ${c.composite.toFixed(2)}`;
  for (const [s, r] of [['map', 'env'], ['noisy', 'env'], ['ffx', 'env'], ['map', 'noisy'], ['map', 'ffx'], ['ffx', 'ffx']]) {
    await T(`window.__t.setModes({ moving: true, shot: 0, shadow: '${s}', refl: '${r}' })`);
    const c = await T('window.__t.costs(40)');
    console.log(`  shadows=${s.padEnd(5)} refl=${r.padEnd(5)} ${fmt(c)}`);
  }

  console.log('half resolution + FSR3 2x (the toggle on the page):');
  await T('window.__t.setModes({ upscale: true, moving: true, shot: 0, shadow: "ffx", refl: "ffx" })');
  console.log(`  shadows=ffx   refl=ffx   ${fmt(await T('window.__t.costs(40)'))}`);
  await T('window.__t.setModes({ moving: false })');
  await T('window.__t.step(60)');
  savePng('fsr3-ffx.png', await cdp.evalJs('window.__t.capture()'));
  const fin3 = await T('window.__t.finiteCheck()');
  check('no NaN/Inf with FSR3 (half-res denoisers)', fin3.shadows.bad === 0 && fin3.reflections.bad === 0, JSON.stringify(fin3));
  if (flags.has('--diag')) console.log('  diag (FSR3):', JSON.stringify(await T('window.__t.diag()')));
  await T('window.__t.setModes({ upscale: false })');
  await T('window.__t.step(10)');
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

/** Mean / max abs difference (0-255, rgb) and the share of channels off by more than 8, of two PNG data URLs, decoded in the page. */
const IMAGE_DIFF = `async (a, b) => {
  const load = (u) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = u; });
  const px = async (u) => { const i = await load(u); const c = new OffscreenCanvas(i.width, i.height); const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const A = await px(a), B = await px(b);
  if (A.length !== B.length) return { sizeMismatch: true };
  let s = 0, m = 0, over = 0, n = 0, la = 0, lb = 0;
  for (let k = 0; k < A.length; k++) { if ((k & 3) === 3) continue; const d = Math.abs(A[k] - B[k]); s += d; n++; la += A[k]; lb += B[k]; if (d > m) m = d; if (d > 8) over++; }
  return { mean: s / n, max: m, over8: over / n, lumA: la / n, lumB: lb / n };
}`;

/**
 * The reflection pages (W24 of @pmndrs/reflections: they switched from local copies of the probes and
 * the GGX sampling to the package). Same calls, same frame counts every run, so two builds can be
 * diffed shot by shot with --ref. The lookups / modes that take no random samples (probe lookups, the
 * probe mode) should match closely; the 1-sample modes are denoised noise and only match on average.
 */
async function runReflections(cdp) {
  const T = (expr) => cdp.evalJs(`(async () => JSON.stringify(await (${expr})))()`).then((s) => (s === undefined ? undefined : JSON.parse(s)));
  const diffs = [];
  const shoot = async (name, dataUrl) => {
    savePng(name, dataUrl);
    const ref = refDir && path.join(refDir, name);
    if (ref && fs.existsSync(ref)) {
      const d = await T(`(${IMAGE_DIFF})(${JSON.stringify(dataUrl)}, ${JSON.stringify('data:image/png;base64,' + fs.readFileSync(ref).toString('base64'))})`);
      diffs.push({ name, ...d });
      console.log(`    vs ref: mean ${d.mean?.toFixed(3)}, max ${d.max}, >8: ${((d.over8 ?? 0) * 100).toFixed(2)}%, luminance ${d.lumB?.toFixed(2)} -> ${d.lumA?.toFixed(2)}`);
    }
  };
  if (reflPage === 'probes') {
    console.log('  ', await cdp.evalJs("document.querySelector('#status').textContent"));
    await T("(window.__p.stop(), window.__p.setObject('None'), true)");
    const poses = [
      ['wide', { pos: [0, 2.5, 16], target: [0, 2.5, 0] }],
      ['left-room', { pos: [-1.2, 1.6, 3.6], target: [-5, 0.8, -1] }],
      ['doorway', { pos: [5, 1.5, 2.5], target: [-3, 1, -0.5] }],
    ];
    for (const lookup of ['warp', 'none', 'hw']) {
      await T(`window.__p.setLookup('${lookup}')`);
      for (const [pn, pose] of poses) {
        await T(`window.__p.setPose(${JSON.stringify(pose)})`);
        for (const [gn, rough] of [['plain', null], ['grid-mirror', 0.08], ['grid-rough', 0.6]]) {
          await T(rough === null ? 'window.__p.setGrid(false)' : `window.__p.setGrid(true, ${rough})`);
          await shoot(`probes-${lookup}-${pn}-${gn}.png`, await T('window.__p.shot()'));
        }
      }
      await T('window.__p.setGrid(false)');
      await T("window.__p.setPose({ pos: [0, 2.5, 16], target: [0, 2.5, 0] })");
      await T("window.__p.setObject('Sphere', [-4, 1.6, 2], 0)");
      await shoot(`probes-${lookup}-mirror-sphere.png`, await T('window.__p.shot()'));
      await T("window.__p.setObject('None')");
    }
    console.log('  ', await cdp.evalJs("document.querySelector('#status').textContent"));
  } else {
    const info = await T('window.__t.info');
    console.log('  ', JSON.stringify(info));
    const ids = reflPage === 'rooms' ? ['rooms', 'ball', 'table', 'stale', 'doorway'] : ['mirror', 'offscreen', 'moving', 'contact', 'rough', 'sources'];
    const modes = reflPage === 'rooms' ? ['probe', 'ssr', 'hybrid'] : ['probe', 'ssr', 'hybrid', 'rt'];
    for (const id of ids) {
      for (const m of modes) {
        await T(`window.__t.scenario('${id}')`);
        await T(`window.__t.setModes(${JSON.stringify({ refl: m, compare: 'none' })})`);
        await T('window.__t.step(40)');
        await shoot(`${reflPage}-${id}-${m}.png`, await cdp.evalJs('window.__t.capture()'));
      }
      // the scenario's own split view (its two modes side by side), as a visitor sees it
      await T(`window.__t.scenario('${id}')`);
      await T('window.__t.step(40)');
      await shoot(`${reflPage}-${id}-split.png`, await cdp.evalJs('window.__t.capture()'));
    }
  }
  if (diffs.length) {
    const worst = diffs.reduce((a, b) => (b.mean > a.mean ? b : a));
    console.log(`  ${diffs.length} shots diffed; worst mean ${worst.mean.toFixed(3)} (${worst.name}), max of max ${Math.max(...diffs.map((d) => d.max))}`);
    fs.writeFileSync(path.join(OUT, `${reflPage}-diffs.json`), JSON.stringify(diffs, null, 1));
  }
}

main().catch((e) => { console.error('FAILED:', e.stack ?? e); process.exit(2); });
