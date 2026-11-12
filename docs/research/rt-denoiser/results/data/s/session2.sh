#!/bin/zsh
# Track S phase 1, second GPU-lock hold: (1) capture the static wide-shot control (needs the local path.ts patch),
# (2) replay it, (3) the 1080p cost bench (test bed, bench.mjs) and the timing-only probes (cost-hacks.py, reverted).
R=/Users/dex/Developer/Denoiser-track-s
D=$R/docs/research/rt-denoiser/results/data/s
cd $R
L=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
until mkdir "$L" 2>/dev/null; do sleep 0.3; done
echo "S session2: wide capture + 1080p cost bench $(date)" > "$L/owner"
trap 'rm -rf "$L"; git -C $R checkout -- packages/denoiser-realtime/src/shaders/shadow.ts' EXIT
srv() { pkill -f "vite.js .* --port 5304" ; sleep 1; (RT_NO_HMR=1 nohup node node_modules/vite/bin/vite.js $1 --port 5304 --strictPort --host 127.0.0.1 > /tmp/s-vite-$2.log 2>&1 &); sleep 4; }
# (1)
srv examples/three-temporal tt
(cd examples/three-temporal && node run-realtime.mjs capture --port=5304 --path=knot-wide --windows=three-knot-wide:0:48 --refShadow=2048 --refDiffuse=16 --refSpec=8 --stepTimeout=3600000 --timeout=3600000) > /tmp/s-cap-wide.log 2>&1
# (2)
srv tools/rt-capture rtc
runs=()
for r in s-def:denoiser=shadows s-ffx:denoiser=ffx-shadows a-al0:denoiser=shadows\&sh.antiLagGain=0 a-alh3:denoiser=shadows\&sh.antiLagHistory=3 \
  a-cg0:denoiser=shadows\&sh.clampGeometry=false a-stabbox2:denoiser=shadows\&sh.stabilizeBox=0.1 a-q23off:denoiser=shadows\&sh.stepTest=false\&sh.edgeBox=false\&sh.floorE=0 \
  c-hn1:denoiser=shadows\&sh.clampHistoryNoise=1 c-hn2:denoiser=shadows\&sh.clampHistoryNoise=2 c-hn1sb:denoiser=shadows\&sh.clampHistoryNoise=1\&sh.stabilizeBox=0.1 \
  dbg-w:denoiser=shadows\&sh.debugStabilize=weight dbg-a:denoiser=shadows\&sh.debugStabilize=age; do
  runs+=("capture=three-knot-wide&output=${r%%:*}&warm=0&${r#*:}"); done
BASE=http://127.0.0.1:5304/ node tools/rt-capture/run-headless.mjs "${runs[@]}" > /tmp/s-wide-replays.log 2>&1
# (3)
srv examples/realtime-denoiser tb
OUT=$D/bench-1080p.jsonl node $D/bench.mjs 3 200 > /tmp/s-bench.log 2>&1
python3 $D/cost-hacks.py nocopy; sleep 2
PAGES_FILTER='^default$' OUT=$D/bench-1080p-probe-nocopy.jsonl node $D/bench.mjs 3 200 >> /tmp/s-bench.log 2>&1
git checkout -- packages/denoiser-realtime/src/shaders/shadow.ts; python3 $D/cost-hacks.py uniform; sleep 2
PAGES_FILTER='^default$' OUT=$D/bench-1080p-probe-uniform.jsonl node $D/bench.mjs 3 200 >> /tmp/s-bench.log 2>&1
git checkout -- packages/denoiser-realtime/src/shaders/shadow.ts
srv tools/rt-capture rtc
echo done
