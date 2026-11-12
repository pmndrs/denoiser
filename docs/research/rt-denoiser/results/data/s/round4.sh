#!/bin/zsh
# Track S phase 1, round 4: significance-gated anti-lag (antiLagNoise), alone and with the wider stabilizer box.
cd /Users/dex/Developer/Denoiser-track-s
L=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
until mkdir "$L" 2>/dev/null; do sleep 0.3; done
echo "S replays round 4 $(date)" > "$L/owner"
trap 'rm -rf "$L"' EXIT
curl -s -o /dev/null http://127.0.0.1:5304/@vite/client || exit 1
R=(d-aln1:sh.antiLagNoise=1 d-aln2:sh.antiLagNoise=2 d-aln3:sh.antiLagNoise=3
   d-aln2sb:sh.antiLagNoise=2\&sh.stabilizeBox=0.1 d-aln3sb:sh.antiLagNoise=3\&sh.stabilizeBox=0.1)
for cap in three-knot-drift sponza-move bistro-move three-knot-orbit three-knot-static; do
  runs=()
  for r in $R; do runs+=("capture=$cap&output=${r%%:*}&warm=0&denoiser=shadows&${r#*:}"); done
  BASE=http://127.0.0.1:5304/ node tools/rt-capture/run-headless.mjs "${runs[@]}" > /tmp/s-r4-$cap.log 2>&1
done
echo done
