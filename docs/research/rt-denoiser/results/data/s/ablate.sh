#!/bin/zsh
# Track S phase 1: one-at-a-time ablations of the shipped shadow defaults on one capture (replay.sh holds the lock).
#   ablate.sh <capture>
D=/Users/dex/Developer/Denoiser-track-s/docs/research/rt-denoiser/results/data/s
cap=$1
$D/replay.sh $cap \
  a-stab0:denoiser=shadows\&sh.stabilize=0 \
  a-stab015:denoiser=shadows\&sh.stabilize=0.15 \
  a-stabal0:denoiser=shadows\&sh.stabilizeAntiLag=0 \
  a-stabal16:denoiser=shadows\&sh.stabilizeAntiLag=16 \
  a-stabbox2:denoiser=shadows\&sh.stabilizeBox=0.1 \
  a-al0:denoiser=shadows\&sh.antiLagGain=0 \
  a-al16:denoiser=shadows\&sh.antiLagGain=16 \
  a-alh3:denoiser=shadows\&sh.antiLagHistory=3 \
  a-mh31:denoiser=shadows\&sh.maxHistory=31 \
  a-cr0:denoiser=shadows\&sh.catmullRom=false \
  a-nb0:denoiser=shadows\&sh.noiseBlend=0 \
  a-rot:denoiser=shadows\&sh.rotationStep=0.6180339887 \
  a-ym0:denoiser=shadows\&sh.youngMean=0 \
  a-snapT:denoiser=shadows\&sh.uniformSnap=true \
  a-snapF:denoiser=shadows\&sh.uniformSnap=false \
  a-q23off:denoiser=shadows\&sh.stepTest=false\&sh.edgeBox=false\&sh.floorE=0 \
  a-hs1:denoiser=shadows\&sh.historyShrink=1 \
  a-cg0:denoiser=shadows\&sh.clampGeometry=false \
  a-mms31:denoiser=shadows\&sh.maxScaleHistory=31 \
  a-tonly:denoiser=shadows\&sh.spatialPasses=0 \
  a-noh:denoiser=shadows\&sh.noHistory=true \
  a-st01al16:denoiser=shadows\&sh.stabilize=0.1\&sh.stabilizeAntiLag=16 \
  dbg-w:denoiser=shadows\&sh.debugStabilize=weight \
  dbg-a:denoiser=shadows\&sh.debugStabilize=age
