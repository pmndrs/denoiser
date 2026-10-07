#!/usr/bin/env node
// Drive the eval page in headless Chrome once per (runtime, precision), merge
// with native OIDN results (tools/eval/native.py), and write
// tools/eval/out/report.{json,md}. Needs the dev server up (`yarn dev`, :5196).
//
//   node run.mjs                         # full matrix
//   node run.mjs ort:fp32 wgsl:fp16      # subset (-> report-partial-<ts>.{md,json})
//   ONLY='spheres/' node run.mjs         # filter cases (regex on scene/model)
//
// Headless Chrome runs with --enable-unsafe-webgpu, which exposes the
// experimental subgroup-matrix feature: `wgsl` fp32 uses it, `wgsl-portable`
// is the kernel normal users get.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5196/';
const OUT = fileURLToPath(new URL('../../tools/eval/out/', import.meta.url));
const COMBOS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'ort:fp32', 'ort:fp16', 'kernels:fp32', 'kernels:fp16', 'wgsl:fp32', 'wgsl-portable:fp32', 'wgsl:fp16',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCombo(runtime, precision) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const q = new URLSearchParams({ runtime, precision, ...(process.env.ONLY ? { only: process.env.ONLY } : {}) });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu',
    '--enable-features=Vulkan', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `denoiser-eval-${Date.now()}`)}`,
    `${BASE}?${q}`,
  ], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 60 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
    }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
    const evalJs = (expression) => new Promise((resolve, reject) => {
      pending.set(++id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result?.result?.value)));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    let printed = 0;
    for (const deadline = Date.now() + 45 * 60_000; Date.now() < deadline;) {
      const s = await evalJs('JSON.stringify({ done: window.__eval?.done, n: window.__eval?.results.length, log: document.querySelector("#status").textContent })')
        .then(JSON.parse).catch(() => null);
      if (s?.log) {
        const lines = s.log.split('\n');
        for (; printed < lines.length - 1; printed++) console.log(`  [${runtime}:${precision}] ${lines[printed]}`);
      }
      if (s?.done) break;
      await sleep(1000);
    }
    const state = JSON.parse(await evalJs('JSON.stringify(window.__eval)'));
    ws.close();
    return state;
  } finally {
    chrome.kill('SIGKILL');
  }
}

// ---- report ---------------------------------------------------------------------

const fmt = (v, d = 1) => (v == null ? '—' : v === Infinity || v === null ? '∞' : v.toFixed(d));
const q = (v) => (v ? `${v.psnr === null || v.psnr === Infinity ? '∞' : v.psnr.toFixed(1)} / ${v.maxByte}` : '—');

function report(native, runs) {
  const cases = Object.keys(native.results);
  const label = (r) => `${r.runtime} ${r.precision}`;
  const get = (r, key) => r.results.find((x) => `${x.scene}/${x.model}` === key);
  const md = [];
  md.push('# Denoiser eval: every RT model, every runtime, vs native OIDN', '');
  md.push(`Generated ${new Date().toISOString()} by examples/eval/run.mjs. Native: OIDN 2.5.1 (${native.device.split('\n').find((l) => l.includes('Name')) ?? ''}).`);
  md.push('Inputs are rounded to fp16 for every setup. Quality = PSNR (dB) / max 8-bit Δ against native OIDN **CPU** output (the reference implementation, same weights); HDR compared after x/(1+x) + gamma 2.2. Timings = warm median, `denoiseTextures` → texture, awaited (web) / `oidnDenoise` filter time (native, excludes host IO).', '');

  for (const size of ['1080', '512']) {
    md.push(`## Speed @ ${size === '1080' ? '1920×1080' : '512²'} (ms, warm median)`, '');
    md.push(`| case | native Metal | native CPU | ${runs.map(label).join(' | ')} |`);
    md.push(`|---|---|---|${runs.map(() => '---').join('|')}|`);
    for (const key of cases) {
      const n = native.results[key];
      md.push(`| ${key} | ${fmt(n.metal[size].median)} | ${fmt(n.cpu[size].median, 0)} | ${runs.map((r) => {
        const x = get(r, key);
        return x?.error ? 'ERR' : fmt(x?.time?.[size]?.median);
      }).join(' | ')} |`);
    }
    md.push('');
  }

  md.push('## Quality vs native CPU (PSNR dB / max 8-bit Δ)', '');
  md.push(`| case | native Metal | ${runs.map(label).join(' | ')} |`);
  md.push(`|---|---|${runs.map(() => '---').join('|')}|`);
  for (const key of cases) {
    // native Metal vs CPU as max abs difference of the raw float outputs
    md.push(`| ${key} | max abs ${native.results[key].metalVsCpuMaxAbs.toExponential(1)} | ${runs.map((r) => {
      const x = get(r, key);
      return x?.error ? 'ERR' : q(x?.vsNativeCpu);
    }).join(' | ')} |`);
  }
  md.push('');

  md.push('## Quality vs converged reference (LDR scenes, PSNR dB)', '');
  md.push(`| case | native CPU | ${runs.map(label).join(' | ')} |`);
  md.push(`|---|---|${runs.map(() => '---').join('|')}|`);
  for (const key of cases.filter((k) => !k.startsWith('hdrdump'))) {
    const any = runs.map((r) => get(r, key)).find((x) => x?.nativeVsReference != null);
    md.push(`| ${key} | ${fmt(any?.nativeVsReference, 2)} | ${runs.map((r) => {
      const x = get(r, key);
      return x?.error ? 'ERR' : fmt(x?.vsReference, 2);
    }).join(' | ')} |`);
  }
  md.push('');

  md.push('## Cold start (ms): engine load / first call @ 512² (includes compile)', '');
  md.push(`| case | ${runs.map(label).join(' | ')} |`);
  md.push(`|---|${runs.map(() => '---').join('|')}|`);
  for (const key of cases) {
    md.push(`| ${key} | ${runs.map((r) => {
      const x = get(r, key);
      return x?.error ? 'ERR' : `${fmt(x?.loadMs, 0)} / ${fmt(x?.time?.['512']?.cold, 0)}`;
    }).join(' | ')} |`);
  }
  md.push('');
  return md.join('\n');
}

const native = JSON.parse(readFileSync(path.join(OUT, 'native.json'), 'utf8'));
const runs = [];
for (const combo of COMBOS) {
  const [runtime, precision] = combo.split(':');
  console.log(`=== ${runtime} ${precision}`);
  const state = await runCombo(runtime, precision);
  if (state.error) console.log(`  page error: ${state.error}`);
  runs.push(state);
}
// Partial runs (combo subset or ONLY filter) never overwrite the full report.
const partial = process.argv.slice(2).length > 0 || !!process.env.ONLY;
const stem = partial ? `report-partial-${Date.now()}` : 'report';
writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify({ native, runs }, null, 1));
writeFileSync(path.join(OUT, `${stem}.md`), report(native, runs));
console.log(`\nwrote ${path.join(OUT, `${stem}.md`)}`);
