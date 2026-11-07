// Headless runner for the reflection bench (G1, track R). Drives examples/three-temporal/reflect-bench.html through its
// scripted API (window.__rb: configure / step / grab), frame-locked: the page's loop is stopped and every frame is
// rendered on request, so frame k of a run is the same frame on every run.
//
//   node rb-run.mjs plan.json            (plan: see below; or a JS module exporting `plan`)
//
// Env: RB_URL (default http://127.0.0.1:5303/reflect-bench.html, the review config = package source),
//      RB_OUT (PNG frames; default $TMPDIR/rb-out), RB_W / RB_H (window, default 1400 x 900 = a 1400 x 757 canvas, as the 2026-10-28 numbers).
//
// Plan: { base: {...configure fields}, runs: [ { name, cfg: {...}, still?: { warm, frames }, orbit?: { warm, samples: [k...] },
//         timing?: { frames }, ref?: true } ] }
//   still  : `warm` frames, then `frames` grabs (default 24), `stride` frames apart (default 8), still pose -> <out>/<name>/s-NN.png
//   orbit  : the scripted orbit from t = 0; frames grabbed at the listed frame indices -> <out>/<name>/o-KKK.png
//   timing : `frames` more frames with per-pass GPU timestamps -> medians in <out>/<name>/timing.json
//   ref    : also render the accumulated traced reference (same scene / resolver / pose; shared per scene key) and the
//            region masks -> <out>/refs/<key>/{still,regions,o-KKK}.png
// Every run starts from a rebuilt graph (fresh histories, fresh denoiser instances).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.RB_URL ?? 'http://127.0.0.1:5303/reflect-bench.html';
const OUT = process.env.RB_OUT ?? path.join(os.tmpdir(), 'rb-out');
const W = Number(process.env.RB_W ?? 1400), H = Number(process.env.RB_H ?? 900);
const planArg = process.argv[2];
if (!planArg) { console.error('usage: node rb-run.mjs plan.json'); process.exit(2); }
const plan = planArg.endsWith('.json') ? JSON.parse(fs.readFileSync(planArg, 'utf8')) : (await import(path.resolve(planArg))).plan;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
  `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'rb-' + Date.now())}`, 'about:blank',
], { stdio: 'ignore' });
const kill = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', kill);
setTimeout(() => { console.log('TIMEOUT'); kill(); process.exit(3); }, Number(process.env.RB_TIMEOUT ?? 3600) * 1000).unref();

let targets;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
const tab = targets.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
};
const send = (method, params = {}) => new Promise((res, rej) => { pend.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 180; i++) { try { if (await ev('!!(window.__rb && window.__rb.ready)')) break; } catch { /* loading */ } await sleep(1000); }
await ev('__rb.setManual(true)');
console.log('ready; features:', (await ev('__rb.features()')).filter((f) => /timestamp|f16/.test(f)).join(','));

const savePng = (file, dataUrl) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64')); };
const configure = (cfg) => ev(`__rb.configure(${JSON.stringify(cfg)})`);
const step = (n, o = {}) => ev(`__rb.step(${n}, ${JSON.stringify(o)})`);
const grabTo = async (file) => { const r = await step(1, { grab: true }); savePng(file, r.png); };
// The reference and the masks depend on the scene, the resolver and the pose only.
const refKey = (c) => [c.preset ?? '-', c.modelRough ?? '-', `t${c.tableRough ?? 0}`, `nm${c.normalMaps ?? true ? 1 : 0}`, `fsr${c.resolve ?? '1.5'}`].join('_').replace(/[^\w.-]/g, '');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

const summary = [];
for (const run of plan.runs) {
  const t0 = Date.now();
  const cfg = { ...(plan.base ?? {}), ...(run.cfg ?? {}) };
  const dir = path.join(OUT, run.name);
  fs.mkdirSync(dir, { recursive: true });
  const info = { name: run.name, cfg, refKey: refKey(cfg) };
  if (run.still) {
    const r = await configure({ ...cfg, orbit: false, orbitHold: false, view: cfg.view ?? 'image' });
    info.size = r.size;
    await step(run.still.warm ?? 60);
    // stride: frames between grabs. Temporal filters correlate neighbouring frames, so a std over consecutive frames
    // misses slow undulation; stride 8 over 24 grabs (192 frames) sees it (the 2026-10-28 screenshots were ~6 apart).
    const stride = run.still.stride ?? 8;
    for (let k = 0; k < (run.still.frames ?? 24); k++) {
      if (stride > 1) await step(stride - 1);
      await grabTo(path.join(dir, `s-${String(k).padStart(2, '0')}.png`));
    }
  }
  if (run.timing) {
    if (!run.still) { await configure({ ...cfg, orbit: false }); await step(30); }
    const r = await step(run.timing.frames ?? 60, { timings: true });
    const per = {};
    for (const fr of r.times) for (const [den, m] of Object.entries(fr)) for (const [pass, ms] of Object.entries(m)) ((per[den] ??= {})[pass] ??= []).push(ms);
    info.timing = Object.fromEntries(Object.entries(per).map(([den, m]) => [den, Object.fromEntries(Object.entries(m).map(([p, a]) => [p, +median(a).toFixed(4)]))]));
    fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(info.timing, null, 1));
  }
  if (run.orbit) {
    await configure({ ...cfg, orbit: true, orbitHold: false, orbitT: 0, view: cfg.view ?? 'image' });
    const samples = [...run.orbit.samples].sort((a, b) => a - b);
    let f = 0;
    for (const k of samples) { if (k > f) await step(k - f); await grabTo(path.join(dir, `o-${String(k).padStart(3, '0')}.png`)); f = k + 1; }
  }
  if (run.ref) {
    const rdir = path.join(OUT, 'refs', info.refKey);
    if (!fs.existsSync(path.join(rdir, 'still.png'))) {
      await configure({ ...cfg, refl: 'ref', orbit: false, orbitHold: false, view: 'image' });
      await step(run.refFrames ?? 200);
      info.refCount = await ev('__rb.refCount()');
      await grabTo(path.join(rdir, 'still.png'));
      await configure({ ...cfg, orbit: false, view: 'regions' });
      await step(3);
      await grabTo(path.join(rdir, 'regions.png'));
    }
    for (const k of run.orbit?.samples ?? []) {
      const file = path.join(rdir, `o-${String(k).padStart(3, '0')}.png`);
      if (fs.existsSync(file)) continue;
      // the orbit run's frame k is drawn after k + 1 animate() steps: tCam = (k + 1) / 60
      await configure({ ...cfg, refl: 'ref', orbit: true, orbitHold: true, orbitT: (k + 1) / 60, view: 'image' });
      await step(run.refFrames ?? 200);
      await grabTo(file);
    }
  }
  info.seconds = Math.round((Date.now() - t0) / 100) / 10;
  summary.push(info);
  console.log(`${run.name}: ${info.seconds}s${info.timing ? ' timing ' + JSON.stringify(Object.fromEntries(Object.entries(info.timing).map(([k, v]) => [k, v.total])))
    : ''}`);
}
fs.writeFileSync(path.join(OUT, `runs-${plan.tag ?? 'plan'}.json`), JSON.stringify(summary, null, 1));
console.log([...new Set(logs)].slice(0, 25).join('\n') || 'no errors/warnings');
kill();
process.exit(0);
