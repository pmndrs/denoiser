// TASKS.md rule 11: one heavy GPU job at a time on the Mac. mkdir-based lock at $RT_GPU_LOCK
// (default /tmp/rt-gpu.lock) with an owner file; a lock older than 3 h whose owner has no live
// headless Chrome is reported stale and removed. Timing runs also need the GPU otherwise idle:
// `waitForQuietGpu()` waits until no other headless Chrome is running.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LOCK = process.env.RT_GPU_LOCK ?? '/tmp/rt-gpu.lock';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AGENT = 'T0-scorecard';

export function headlessChromes() {
  try {
    const out = execSync("ps -axo pid=,ppid=,command= | grep -i 'google chrome' | grep -e '--headless' | grep -v 'Helper' | grep -v grep || true", { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch { return []; }
}

/** CPU % summed over every headless-Chrome process (browser, GPU and renderer helpers of the harness profiles):
 * an orphaned idle Chrome (0 %) does not disturb timings, a running page does. */
export function headlessLoad() {
  try {
    const out = execSync("ps -axo pcpu=,command= | grep -i 'google chrome' | grep -e 'rt-headless' -e '--headless' | grep -v grep || true", { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).reduce((a, l) => a + (parseFloat(l) || 0), 0);
  } catch { return 0; }
}

export async function acquireGpu(task, { log = console.log, pollMs = 4000 } = {}) {
  let warned = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(path.join(LOCK, 'owner'), `${AGENT} ${task} ${new Date().toString()}\n`);
      return () => { try { rmSync(LOCK, { recursive: true, force: true }); } catch { /* released */ } };
    } catch {
      const owner = path.join(LOCK, 'owner');
      let age = 0;
      try { age = (Date.now() - statSync(owner).mtimeMs) / 3.6e6; } catch { /* no owner file */ }
      if (age > 3 && headlessChromes().length === 0) {
        log(`GPU lock at ${LOCK} is stale (${age.toFixed(1)} h, no headless Chrome): removing it`);
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (!warned) { log(`waiting for the GPU lock (${existsSync(owner) ? readFileSync(owner, 'utf8').trim() : 'owner unknown'})`); warned = true; }
      await sleep(pollMs);
    }
  }
}

/** Timing protocol (rule 11): the lock is held by the caller; also require that no other headless Chrome is working
 * (summed CPU below `maxLoad` %, three samples in a row). Waits up to `maxMs`, then throws. */
export async function waitForQuietGpu({ log = console.log, pollMs = 5000, maxMs = 20 * 60000, maxLoad = 8 } = {}) {
  const t0 = Date.now();
  let quiet = 0;
  for (;;) {
    const load = headlessLoad();
    quiet = load < maxLoad ? quiet + 1 : 0;
    if (quiet >= 3) return;
    if (Date.now() - t0 > maxMs) throw new Error(`GPU not idle after ${maxMs / 60000} min: headless Chrome load ${load.toFixed(0)} %`);
    if (quiet === 0) log(`waiting for the GPU to go idle (headless Chrome load ${load.toFixed(0)} %, ${headlessChromes().length} process(es))`);
    await sleep(pollMs);
  }
}

export async function withGpuLock(task, fn, opts) {
  const release = await acquireGpu(task, opts);
  try { return await fn(); } finally { release(); }
}
