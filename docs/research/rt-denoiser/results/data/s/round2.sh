#!/bin/zsh
# Track S phase 1, round 2: the anti-lag / clamp / stabilizer candidates from round 1 (ablate.sh), alone and combined,
# on the drift / orbit / static knot captures and the moving-occluder / moving-light real captures (lag side).
D=/Users/dex/Developer/Denoiser-track-s/docs/research/rt-denoiser/results/data/s
for cap in three-knot-drift sponza-move bistro-move three-knot-orbit three-knot-static; do
  base=()
  case $cap in sponza-move|bistro-move) base=(s-def:denoiser=shadows s-ffx:denoiser=ffx-shadows s-raw:denoiser=passthrough a-al0:denoiser=shadows\&sh.antiLagGain=0 a-alh3:denoiser=shadows\&sh.antiLagHistory=3 a-cg0:denoiser=shadows\&sh.clampGeometry=false a-stabbox2:denoiser=shadows\&sh.stabilizeBox=0.1) ;; esac
  $D/replay.sh $cap "${base[@]}" \
    b-al8:denoiser=shadows\&sh.antiLagGain=8 \
    b-cs6:denoiser=shadows\&sh.clampSigma=0.6 \
    b-cf08:denoiser=shadows\&sh.clampFloor=0.08 \
    b-c1:denoiser=shadows\&sh.antiLagHistory=3\&sh.stabilizeBox=0.1 \
    b-c2:denoiser=shadows\&sh.antiLagHistory=3\&sh.stabilizeBox=0.1\&sh.clampGeometry=false \
    b-c3:denoiser=shadows\&sh.antiLagGain=8\&sh.stabilizeBox=0.1 \
    b-c4:denoiser=shadows\&sh.antiLagGain=0\&sh.stabilizeBox=0.1 > /tmp/s-round2-$cap.log 2>&1
done
echo done
