#!/bin/zsh
# Track S phase 1, round 3: clampHistoryNoise (the clamp window counts the history's own standard error), alone and with
# the stabilizer box, on the same five captures as round 2.
D=/Users/dex/Developer/Denoiser-track-s/docs/research/rt-denoiser/results/data/s
for cap in three-knot-drift sponza-move bistro-move three-knot-orbit three-knot-static; do
  $D/replay.sh $cap \
    c-hn1:denoiser=shadows\&sh.clampHistoryNoise=1 \
    c-hn2:denoiser=shadows\&sh.clampHistoryNoise=2 \
    c-hn1sb:denoiser=shadows\&sh.clampHistoryNoise=1\&sh.stabilizeBox=0.1 \
    c-hn2sb:denoiser=shadows\&sh.clampHistoryNoise=2\&sh.stabilizeBox=0.1 \
    c-hn1al8:denoiser=shadows\&sh.clampHistoryNoise=1\&sh.antiLagGain=8 > /tmp/s-round3-$cap.log 2>&1
done
echo done
