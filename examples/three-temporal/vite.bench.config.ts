import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import { rtCapture } from '../../tools/rt-capture/src/vite-plugin';
import review from './vite.review.config';

// The shadow bench (shadow-bench.html; docs/research/rt-denoiser/results/SHADOW-BENCH.md): the review bench's config
// (denoiser packages served from SOURCE, so an edit in packages/denoiser-realtime reloads the bench without a
// `yarn build:lib`) plus the bench's file endpoints, rtCapture's under another prefix and root:
//   /__shadow-bench/*   captures/gt/<key>.f32   cached ground truths (config.ts gtKey)
//                       outputs/<run id>/       runs (run.json, images)
// Root: $SHADOW_BENCH_DIR, else examples/three-temporal/out/shadow-bench (gitignored).
//   yarn workspace three-temporal shadow-bench   -> http://127.0.0.1:5266/shadow-bench.html
const root = process.env.SHADOW_BENCH_DIR ?? fileURLToPath(new URL('./out/shadow-bench', import.meta.url));

export default mergeConfig(review, { plugins: [rtCapture({ root, endpoint: '/__shadow-bench' })] });
