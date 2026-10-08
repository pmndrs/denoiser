import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';
import path from 'node:path';

// One package, several entry points: `denoiser` (core + ORT preset),
// `denoiser/core`, `denoiser/ort`, `denoiser/kernels`, `denoiser/wgsl`, `denoiser/ffx`, `denoiser/webnn`, `denoiser/three`, `denoiser/auto`. The internal workspace
// packages (@pmndrs/denoiser-*) are BUNDLED — never published — and built in one
// pass so the entries share chunks (one copy of Denoiser/TiledEngine, so
// `denoiser` and `denoiser/core` classes are the same). Runtime libraries stay
// external: onnxruntime-web (dependency), @huggingface/kernels and three (optional peers).
const input = {
    index: './src/index.ts',
    core: './src/core.ts',
    ort: './src/ort.ts',
    kernels: './src/kernels.ts',
    wgsl: './src/wgsl.ts',
    ffx: './src/ffx.ts',
    webnn: './src/webnn.ts',
    three: './src/three.ts',
    auto: './src/auto.ts',
};
const external = [
    'onnxruntime-web',
    'onnxruntime-web/webgpu',
    '@huggingface/kernels',
    'three',
    /^three\//,
];

export default [
    {
        input,
        external,
        output: [
            { dir: 'dist', format: 'es', sourcemap: true, exports: 'named',
                entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
            { dir: 'dist', format: 'cjs', sourcemap: true, exports: 'named',
                entryFileNames: '[name].cjs', chunkFileNames: 'chunks/[name]-[hash].cjs' },
        ],
        plugins: [
            nodeResolve(),
            commonjs(),
            typescript({ tsconfig: path.resolve('tsconfig.json') }),
        ],
    },
    {
        input,
        external: [...external, /^@webgpu\//],
        output: { dir: 'dist', format: 'es', entryFileNames: '[name].d.ts', chunkFileNames: 'chunks/[name]-[hash].d.ts' },
        plugins: [dts({ respectExternal: true, tsconfig: path.resolve('tsconfig.json') })],
    },
];
