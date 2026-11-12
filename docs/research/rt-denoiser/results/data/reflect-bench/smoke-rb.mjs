// headless smoke test of the workbench: load, wait for __rb.ready, run JSON steps (js / wait / shot) from argv[2]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'rb');
const URL_ = process.env.WB_URL ?? 'http://127.0.0.1:5220/reflect-bench.html';
const steps = JSON.parse(process.argv[2] ?? '[]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-sandbox', '--use-angle=metal', '--enable-unsafe-webgpu', '--window-size=1400,900', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'wb-' + Date.now())}`, 'about:blank'], { stdio: 'ignore' });
setTimeout(() => { console.log('TIMEOUT'); chrome.kill('SIGKILL'); process.exit(3); }, 560000).unref();
let targets; for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
const tab = targets.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled' && (process.env.ALLLOG || ['error', 'warning'].includes(m.params.type))) logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600)); };
const send = (method, params = {}) => new Promise((res, rej) => { pend.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
fs.mkdirSync(OUT, { recursive: true });
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64')); };
for (let i = 0; i < 120; i++) { if ((await ev('!!(window.__rb && window.__rb.ready)')) === true) break; await sleep(1000); }
console.log('ready:', await ev('!!(window.__rb && window.__rb.ready)'));
for (const s of steps) {
  if (s.js) console.log('js:', s.js.slice(0, 70), '->', JSON.stringify(await ev(s.js))?.slice(0, 600));
  if (s.wait) await sleep(s.wait);
  if (s.shot) await shot(s.shot);
}
console.log('status:', await ev("document.getElementById('status')?.textContent"));
console.log([...new Set(logs)].slice(0, 25).join('\n') || 'no errors/warnings');
chrome.kill('SIGKILL'); process.exit(0);
