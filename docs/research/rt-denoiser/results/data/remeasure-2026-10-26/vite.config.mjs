import { mergeConfig } from '/Users/dex/Developer/Denoiser-nrd-cleanroom/node_modules/vite/dist/node/index.js';
import base from '/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser/vite.config.ts';
const S = '/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/remeasure26';
export default mergeConfig(base, {
  root: '/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser',
  server: { hmr: false, fs: { allow: [S, '/Users/dex/Developer/Denoiser-nrd-cleanroom'] } },
  resolve: { alias: [{ find: /^(\.\.\/)+tools\/rt-capture\/src\/denoisers$/, replacement: S + '/wrap/registry-wrap.ts' }] },
});
