#!/bin/zsh
# Track S phase 1, rounds 2 + 3 in one GPU-lock hold: anti-lag / clamp / stabilizer candidates and clampHistoryNoise, on
# the drift / orbit / static knot captures and the lag-side captures (sponza-move, bistro-move); plus a default rerun
# (s-def2) for the byte check against the pre-edit s-def.
cd /Users/dex/Developer/Denoiser-track-s
L=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
until mkdir "$L" 2>/dev/null; do sleep 0.3; done
echo "S replays rounds 2+3 $(date)" > "$L/owner"
trap 'rm -rf "$L"' EXIT
R=(b-al8:sh.antiLagGain=8 b-cs6:sh.clampSigma=0.6 b-cf08:sh.clampFloor=0.08
   b-c1:sh.antiLagHistory=3\&sh.stabilizeBox=0.1 b-c2:sh.antiLagHistory=3\&sh.stabilizeBox=0.1\&sh.clampGeometry=false
   b-c3:sh.antiLagGain=8\&sh.stabilizeBox=0.1 b-c4:sh.antiLagGain=0\&sh.stabilizeBox=0.1
   c-hn1:sh.clampHistoryNoise=1 c-hn2:sh.clampHistoryNoise=2 c-hn1sb:sh.clampHistoryNoise=1\&sh.stabilizeBox=0.1
   c-hn2sb:sh.clampHistoryNoise=2\&sh.stabilizeBox=0.1 c-hn1al8:sh.clampHistoryNoise=1\&sh.antiLagGain=8)
X=(s-def:denoiser=shadows s-ffx:denoiser=ffx-shadows s-raw:denoiser=passthrough a-al0:denoiser=shadows\&sh.antiLagGain=0
   a-alh3:denoiser=shadows\&sh.antiLagHistory=3 a-cg0:denoiser=shadows\&sh.clampGeometry=false a-stabbox2:denoiser=shadows\&sh.stabilizeBox=0.1)
for cap in three-knot-drift sponza-move bistro-move three-knot-orbit three-knot-static; do
  runs=()
  for r in $R; do runs+=("capture=$cap&output=${r%%:*}&warm=0&denoiser=shadows&${r#*:}"); done
  case $cap in sponza-move|bistro-move) for r in $X; do runs+=("capture=$cap&output=${r%%:*}&warm=0&${r#*:}"); done ;; esac
  [[ $cap == three-knot-static ]] && runs+=("capture=$cap&output=s-def2&warm=0&denoiser=shadows")
  BASE=http://127.0.0.1:5304/ node tools/rt-capture/run-headless.mjs "${runs[@]}" > /tmp/s-r23-$cap.log 2>&1
done
echo done
