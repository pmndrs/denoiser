import { defineConfig } from 'vite';
import { rtCapture } from './src/vite-plugin';

// Replay page + capture I/O endpoints. From the repo root:
//   node node_modules/vite/bin/vite.js tools/rt-capture --port 5230 --strictPort --host 127.0.0.1
export default defineConfig({
  plugins: [rtCapture()],
  server: { fs: { allow: ['../..'] } },
});
