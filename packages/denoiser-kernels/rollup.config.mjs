import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import path from 'node:path';

// Dependencies stay external — consumers (and the `denoiser` preset) resolve them.
const external = ["@huggingface/kernels", "@pmndrs/denoiser-core"];

export default {
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
};
