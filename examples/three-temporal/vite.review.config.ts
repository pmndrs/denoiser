import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from './vite.config';

// The review bench (review.html) served against the denoiser packages' SOURCE instead of packages/denoiser/dist, so
// the bench shows today's defaults and options without a `yarn build:lib` (results/REVIEW-BENCH.md):
//   yarn workspace three-temporal review     -> http://127.0.0.1:5262/review.html
// REVIEW_DIST=1 keeps the built dist (what the other pages of `yarn dev` use).
const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));
const alias = process.env.REVIEW_DIST ? [] : [
  { find: /^denoiser\/three$/, replacement: pkg('denoiser/src/three.ts') },
  { find: /^denoiser\/realtime$/, replacement: pkg('denoiser/src/realtime.ts') },
  { find: /^@pmndrs\/denoiser-(core|ffx|realtime|three)$/, replacement: pkg('denoiser-$1/src/index.ts') },
];

export default mergeConfig(base, { resolve: { alias } });
