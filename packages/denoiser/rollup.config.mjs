import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';
import path from 'node:path';

// The preset BUNDLES @pmndrs/denoiser-core + @pmndrs/denoiser-ort (JS from their
// dist builds, types inlined by rollup-plugin-dts) so the published `denoiser`
// stays one self-contained package. onnxruntime-web ships its own wasm/jsep
// assets and is large — keep it external (a regular dependency).
const external = [
    'onnxruntime-web',
    'onnxruntime-web/webgpu',
];

export default [
    {
        input: './src/index.ts',
        external,
        output: [
            { file: 'dist/index.mjs', format: 'es', sourcemap: true, exports: 'named' },
            { file: 'dist/index.cjs', format: 'cjs', sourcemap: true, exports: 'named' },
        ],
        plugins: [
            nodeResolve(),
            commonjs(),
            typescript({ tsconfig: path.resolve('tsconfig.json') }),
        ],
    },
    {
        input: './src/index.ts',
        external: [...external, /^@webgpu\//],
        output: { file: 'dist/index.d.ts', format: 'es' },
        plugins: [dts({ respectExternal: true, tsconfig: path.resolve('tsconfig.json') })],
    },
];
