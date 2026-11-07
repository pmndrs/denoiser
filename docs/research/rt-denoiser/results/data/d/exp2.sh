#!/bin/zsh
# Track D experiment batch 2 (tracks/d.md): anti-lag false triggers vs history length, and output stabilization
# (x-auto = the worktree copy with the `stabilize` experiment option, served by tools/wrap.ts). dbg-n writes
# (history length n, lambda, output luma) per signal for the mechanism statistics (lambda.mjs).
D=${0:A:h}
$D/replay.sh sponza-orbit,sponza-move,bistro-orbit,bistro-pan,bistro-move,bistro-hold \
  'f1-off05=svgf-auto;diffuse,specular;antiLag=off&temporalAlpha=0.05' \
  'f2-off03=svgf-auto;diffuse,specular;antiLag=off&temporalAlpha=0.03' \
  'f3-nf4=svgf-auto;diffuse,specular;d.antiLagNoiseFloor=4' \
  'f4-nf3a03=svgf-auto;diffuse,specular;d.antiLagNoiseFloor=3&d.temporalAlpha=0.03' \
  'f5-g05=svgf-auto;diffuse,specular;d.antiLagGain=0.5' \
  'f6-stab=x-auto;diffuse,specular;d.stabilize=1&stabilize=1' \
  'f7-stab05=x-auto;diffuse,specular;stabilize=1&d.stabilizeAlpha=0.05&d.stabilizeClip=1.5' \
  'g1-off05=occlusion-svgf-auto;ao;o.antiLag=off&o.temporalAlpha=0.05' \
  'g3-nf4=occlusion-svgf-auto;ao;o.antiLagNoiseFloor=4' \
  'dbg=dbg-n;diffuse'
