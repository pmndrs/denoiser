# Ben Houston's PR #35228 nodes, vendored for the workbench

Copied from mrdoob/three.js pull/35228 at head `3210e46f672ccf880f3ed8af53d623e8abc54264` (branch
`ssr-coverage-environment`, 2026-10-27). three.js is MIT (c) three.js authors. These files are for the comparison
bench only. Nothing in `packages/` may import them; they are not part of our denoisers.

| File | PR path |
|---|---|
| CoverageDenoiseNode.js, SSRNode.js, HiZNode.js, TRAANode.js, JointBilateralUpsample.js, ImportanceSampledEnvironment.js, boxBlur.js | examples/jsm/tsl/display/ |
| TAAUtils.js, SpecularHelpers.js, FASTNoise.js, RNoise.js | examples/jsm/tsl/utils/ |
| `public/ben-fast/gauss1-ema01-separate05.png`, `LICENSE.txt` (FAST noise, EA, BSD-3-Clause) | examples/textures/noises/fast/ |

Local changes, nothing else:
- `../utils/X.js` imports point at `./X.js`.
- `isBackgroundDepth` and `projectionDepth` come from `tsl-shims.js` (copied from the PR's `src/`), since three r186
  doesn't export them.

Not vendored: `ReprojectedRadianceNode` (his "previous frame" trace source) and `ScreenSpaceGBufferNode`
(his half-resolution guides). Both depend on the PR's core changes to `PassNode` and `VelocityNode`.

To update: `git fetch https://github.com/mrdoob/three.js.git pull/35228/head` in a three.js checkout, then copy
the files again from `FETCH_HEAD` and redo the two changes above.
