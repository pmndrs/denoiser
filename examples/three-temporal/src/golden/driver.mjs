#!/usr/bin/env node
// Node driver of the golden-scene contract (GOLDEN.md): headless Chrome over CDP (tools/rt-capture/lib/headless.mjs) around
// golden.html's window.__golden. Needs the dev server: node node_modules/vite/bin/vite.js examples/three-temporal
// --port 5301 --strictPort --host 127.0.0.1 (RT_SCENE_ASSETS=<dir with sponza/ and bistro/> for G3 / G4).
//
//   import { openGolden } from './driver.mjs';
//   const g = await openGolden({ port: 5301, scene: 'G3', path: 'orbit', mode: 'run', denoiser: 'ours', res: 'half', seed: 1 });
//   await g.step(1); const buf = await g.read({ signal: 'diffuse', kind: 'output' }); await g.close();
//
// CLI:
//   node driver.mjs list [--port=5301]
//   node driver.mjs record --scene=G3 --path=orbit --mode=run --denoiser=ours --reads=diffuse:output,diffuse:reference
//        [--frames=0-63|0,8,16] [--out=dir] [--res=half] [--seed=1] [--guides=1] [--options='{"gi.filter":"recurrent"}']
//   node driver.mjs determinism --scene=G2 [--path=occluder] [--frames=0-5] [--reads=diffuse:noisy,shadow:noisy,specular:noisy]
//        two page loads with the same seed: the SHA-256 of every read must match, plus a different seed must differ
//   node driver.mjs snapshot --scene=G5 --frames=0,32 --reads=display:output,display:reference [--gain=1] [--out=dir]   PNGs
//   node driver.mjs time --scene=G3 --res=1080p [--n=60]       steady-state per-pass GPU ms + wall ms (hold the GPU lock)
//   node driver.mjs capture --scene=G2 --path=occluder [--frames=48] [--name=golden-G2-occluder]   writes a CAPTURE-FORMAT capture
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from '../../../../tools/rt-capture/lib/headless.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Opens golden.html for one configuration. Returns { call, step, read, hash, ..., close }. */
export async function openGolden(o = {}) {
  const port = o.port ?? 5301;
  const host = o.host ?? '127.0.0.1';
  const params = new URLSearchParams();
  for (const k of ['scene', 'path', 'mode', 'denoiser', 'res', 'w', 'h', 'seed', 'referenceSpp', 'perfectSpp', 'referenceSppSpec', 'signals', 'difRays', 'visGrid', 'refSeed']) {
    if (o[k] !== undefined) params.set(k, String(o[k]));
  }
  if (o.options) params.set('options', typeof o.options === 'string' ? o.options : JSON.stringify(o.options));
  if (o.withReference) params.set('withReference', '1');
  if (o.lean) params.set('lean', '1');
  if (o.list) params.set('list', '1');
  const url = `http://${host}:${port}/golden.html?${params}`;
  const page = await openPage(url, { windowSize: '1100,700' });
  const { cdp } = page;
  const deadline = Date.now() + (o.readyTimeoutMs ?? 600_000);
  let state;
  while (Date.now() < deadline) {
    state = await cdp.evalJs('JSON.stringify({ ready: !!window.__golden?.ready, err: window.__error ?? null, status: document.querySelector("#status")?.textContent ?? "" })').then(JSON.parse).catch(() => null);
    if (state?.ready || state?.err) break;
    await sleep(300);
  }
  if (!state?.ready) { await page.close(); throw new Error(`golden page not ready: ${state?.err ?? state?.status ?? 'timeout'} (${url})`); }
  const call = (expr) => cdp.evalJs(`(async () => JSON.stringify(await (${expr})))()`, true).then((s) => (s === undefined ? undefined : JSON.parse(s)));
  const CHUNK = 1 << 20; // bytes per CDP message (single messages above a few MB stall Node's WebSocket)
  const read = async (spec) => {
    const m = await call(`window.__golden.readStart(${JSON.stringify(spec)})`);
    const out = Buffer.alloc(m.bytes);
    for (let off = 0; off < m.bytes; off += CHUNK) {
      const n = Math.min(CHUNK, m.bytes - off);
      Buffer.from(await call(`window.__golden.readChunk(${off}, ${n})`), 'base64').copy(out, off);
    }
    const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    return { width: m.width, height: m.height, channels: m.channels, data: new Float32Array(ab) };
  };
  return {
    url, call, read,
    info: () => call('window.__golden.info()'),
    list: () => call('window.__golden.list()'),
    state: () => call('window.__golden.state()'),
    reset: () => call('window.__golden.reset()'),
    seek: (f) => call(`window.__golden.seek(${f})`),
    step: (n = 1) => call(`window.__golden.step(${n})`),
    hash: (spec) => call(`window.__golden.hash(${JSON.stringify(spec)})`),
    timings: () => call('window.__golden.timings()'),
    time: (n = 60, warm = 10) => call(`window.__golden.time(${n}, ${warm})`),
    capture: (c) => call(`window.__golden.capture(${JSON.stringify(c ?? {})})`),
    gpuErrors: () => call('window.__golden.gpuErrors'),
    close: () => page.close(),
  };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const frameList = (s, max = 1e9) => {
  if (!s) return null;
  return s.split(',').flatMap((p) => { const m = p.match(/^(\d+)-(\d+)$/); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i) : [+p]; }).filter((f) => f < max);
};
const cfgFromArgs = () => {
  const c = { port: Number(opt('port', 5301)) };
  for (const k of ['scene', 'path', 'mode', 'denoiser', 'res', 'w', 'h', 'seed', 'referenceSpp', 'perfectSpp', 'referenceSppSpec', 'signals', 'difRays', 'visGrid', 'refSeed']) {
    const v = opt(k); if (v !== undefined) c[k] = v;
  }
  if (opt('options')) c.options = opt('options');
  if (args.includes('--withReference')) c.withReference = true;
  if (args.includes('--lean')) c.lean = true;
  return c;
};
/** 8-bit PNG from float rgb/gray in [0, 1] (row 0 = top). */
export function writePng(file, buf, scale = 1) {
  const { width: w, height: h, channels: c, data } = buf;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
      const v = data[(y * w + x) * c + (c === 1 ? 0 : k)] * scale;
      raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? v : 0) * 255)));
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let r = n; for (let k = 0; k < 8; k++) r = r & 1 ? 0xedb88320 ^ (r >>> 1) : r >>> 1; return r >>> 0; });
  const crc = (b) => { let r = 0xffffffff; for (const x of b) r = crcT[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (t, b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); const tb = Buffer.concat([Buffer.from(t), b]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(tb)); return Buffer.concat([l, tb, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const f32 = (file, data) => fs.writeFileSync(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));

async function record() {
  const c = cfgFromArgs();
  const reads = (opt('reads', 'diffuse:output') ?? '').split(',').filter(Boolean).map((s) => { const [signal, kind] = s.split(':'); return { signal, kind: kind ?? 'output' }; });
  if (reads.some((r) => r.kind === 'reference') && !c.mode) c.mode = 'reference';
  const g = await openGolden(c);
  try {
    const info = await g.info();
    const frames = frameList(opt('frames')) ?? Array.from({ length: info.frames }, (_, i) => i);
    const guides = opt('guides', '0') === '1' ? ['depth', 'viewz', 'normal', 'roughness', 'motion', 'motion_z', 'albedo', 'f0', 'mask_mover'] : [];
    const name = `${info.scene}_${info.path}_${info.mode}_${info.denoiser}_${info.width}x${info.height}_s${info.seed}`;
    const out = path.resolve(opt('out', path.join(HERE, '..', '..', 'out', 'golden')), name);
    fs.mkdirSync(out, { recursive: true });
    const csv = ['frame,pass,ms'];
    let commit = ''; try { commit = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim(); } catch { /* no git */ }
    let prev = -2;
    for (const f of frames) {
      if (f !== prev + 1) await g.seek(f);
      const r = await g.step(1);
      prev = f;
      const dir = path.join(out, `frame_${String(f).padStart(4, '0')}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const spec of reads) { const b = await g.read(spec); f32(path.join(dir, `${spec.signal}.${spec.kind}.f32`), b.data); }
      for (const s of guides) { const b = await g.read({ signal: s, kind: 'output' }); f32(path.join(dir, `${s}.f32`), b.data); }
      for (const [k, v] of Object.entries(r.gpuMs)) csv.push(`${f},${k},${v}`);
      csv.push(`${f},wall,${r.wallMs}`);
      console.log(`frame ${f}: wall ${r.wallMs.toFixed(1)} ms, gpu total ${(r.gpuMs.total ?? 0).toFixed(2)} ms${r.referenceMs ? `, references ${(r.referenceMs / 1000).toFixed(1)} s` : ''}`);
    }
    fs.writeFileSync(path.join(out, 'timings.csv'), csv.join('\n') + '\n');
    fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify({ ...info, reads, guides, frames, commit, date: new Date().toISOString(), channels: Object.fromEntries((await g.list()).signals.map((s) => [s.name, s.channels])) }, null, 1));
    console.log('wrote', out, 'gpuErrors:', (await g.gpuErrors()).length);
  } finally { await g.close(); }
}

async function snapshot() {
  const c = cfgFromArgs();
  const reads = (opt('reads', 'display:output') ?? '').split(',').filter(Boolean).map((s) => { const [signal, kind] = s.split(':'); return { signal, kind: kind ?? 'output' }; });
  if (reads.some((r) => r.kind === 'reference') && !c.mode) c.mode = 'reference';
  const g = await openGolden(c);
  try {
    const frames = frameList(opt('frames', '0'));
    const out = path.resolve(opt('out', path.join(HERE, '..', '..', 'out', 'snap')));
    fs.mkdirSync(out, { recursive: true });
    let prev = -2;
    for (const f of frames) {
      if (f !== prev + 1) await g.seek(f);
      const r = await g.step(1); prev = f;
      for (const spec of reads) {
        const b = await g.read(spec);
        const file = path.join(out, `${c.scene ?? 'G2'}_${c.path ?? 'def'}_f${String(f).padStart(2, '0')}_${spec.signal}.${spec.kind}.png`);
        writePng(file, b, Number(opt('gain', 1)));
        console.log(file, `wall ${r.wallMs.toFixed(0)} ms`);
      }
    }
  } finally { await g.close(); }
}

async function determinism() {
  const c = cfgFromArgs();
  c.mode ??= 'run';
  const frames = frameList(opt('frames', '0-5'));
  const reads = (opt('reads', 'diffuse:noisy,shadow:noisy,specular:noisy,ao:noisy,display:noisy,depth:output,motion:output') ?? '').split(',').filter(Boolean).map((s) => { const [signal, kind] = s.split(':'); return { signal, kind: kind ?? 'output' }; });
  const run = async (seed) => {
    const g = await openGolden({ ...c, seed });
    try {
      const out = {};
      let prev = -2;
      for (const f of frames) {
        if (f !== prev + 1) await g.seek(f);
        await g.step(1); prev = f;
        for (const spec of reads) out[`f${f}.${spec.signal}.${spec.kind}`] = await g.hash(spec);
      }
      return out;
    } finally { await g.close(); }
  };
  const seed = Number(c.seed ?? 1);
  const a = await run(seed), b = await run(seed), d = await run(seed + 1);
  const keys = Object.keys(a);
  const bad = keys.filter((k) => a[k] !== b[k]);
  const noisy = keys.filter((k) => k.endsWith('.noisy'));
  const differs = noisy.filter((k) => a[k] !== d[k]);
  console.log(JSON.stringify({ scene: c.scene, path: c.path ?? 'default', mode: c.mode, seed, reads: keys.length, mismatchSameSeed: bad, noisyInputsDifferentSeedDiffer: `${differs.length}/${noisy.length}` }, null, 1));
  if (bad.length) process.exit(1);
}

async function main() {
  if (cmd === 'list') {
    const g = await openGolden({ port: Number(opt('port', 5301)), list: true });
    console.log(JSON.stringify(await g.list(), null, 1));
    await g.close();
  } else if (cmd === 'record') await record();
  else if (cmd === 'determinism') await determinism();
  else if (cmd === 'snapshot') await snapshot();
  else if (cmd === 'time') {
    const g = await openGolden({ ...cfgFromArgs(), mode: 'run', lean: true });
    try { console.log(JSON.stringify({ info: await g.info(), time: await g.time(Number(opt('n', 60))) }, null, 1)); } finally { await g.close(); }
  } else if (cmd === 'capture') {
    const c = cfgFromArgs(); c.mode = 'capture';
    const g = await openGolden(c);
    try {
      const info = await g.info();
      const res = await g.capture({ name: opt('name', `golden-${info.scene}-${info.path}`), start: Number(opt('start', 0)), frames: Number(opt('frames', info.frames)) });
      console.log(JSON.stringify(res, null, 1));
    } finally { await g.close(); }
  } else if (cmd) { console.error(`unknown command ${cmd}`); process.exit(2); }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
