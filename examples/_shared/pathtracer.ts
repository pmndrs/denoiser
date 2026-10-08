// Sample-count helpers for three-gpu-pathtracer's WebGPUPathTracer (0.0.27+).
//
// The tracer no longer exposes a synchronous `samples` counter: per-pixel counts
// are measured with `getSampleCountsAsync()` (the default wavefront backend
// reduces them on the GPU and reads them back). Accumulation is capped by the
// tracer's own `maxSamples` (every pixel stops at exactly that count), so the
// examples set it instead of gating `renderSample()` themselves.
//
// Imported via a RELATIVE path, like ../../_shared/chrome.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Sample count every pixel has reached (min over the image). */
export async function samplesNow(pathTracer: any): Promise<number> {
  const counts = await pathTracer.getSampleCountsAsync();
  return Math.floor(counts?.min ?? 0);
}

/**
 * Polls the per-pixel sample count without blocking a rAF loop: call `poll()`
 * once per frame and read `value`. `reset()` (call it whenever the
 * accumulation restarts) zeroes the value and drops measurements that were in
 * flight across the reset, so a stale count can't trigger a denoise of the new view.
 */
export function sampleCounter(pathTracer: any) {
  let epoch = 0;
  let inFlight = false;
  const state = {
    value: 0,
    poll() {
      if (inFlight) return;
      inFlight = true;
      const e = epoch;
      samplesNow(pathTracer)
        .then((n) => { if (e === epoch) state.value = n; })
        .catch(() => { /* renderer not ready / lost — next poll retries */ })
        .finally(() => { inFlight = false; });
    },
    reset() {
      epoch++;
      state.value = 0;
    },
  };
  return state;
}

/**
 * Accumulate until every pixel has exactly `target` samples (sets the tracer's
 * `maxSamples` to `target`, so it can't overshoot) and return the count reached.
 * Stops after `maxMs` of wall-clock time regardless.
 */
export async function accumulateTo(
  pathTracer: any, device: GPUDevice, target: number, maxMs = 120000,
): Promise<number> {
  pathTracer.maxSamples = target;
  const t0 = performance.now();
  let n = await samplesNow(pathTracer);
  while (n < target && performance.now() - t0 < maxMs) {
    for (let i = 0; i < 8; i++) pathTracer.renderSample();
    await device.queue.onSubmittedWorkDone();
    n = await samplesNow(pathTracer);
  }
  return n;
}
