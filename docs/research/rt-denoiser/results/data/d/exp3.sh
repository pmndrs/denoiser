#!/bin/zsh
# Track D experiment batch 3 (tracks/d.md): light-change lag of the two calm levers (output stabilization; anti-lag off
# with a long history), the corner captures for the native comparison, and stabilization with 4 a-trous iterations.
D=${0:A:h}
$D/replay.sh lc540-step,lc540-hue,lc540-jump,lc540-fade,three-orbit,three-pan \
  'f6-stab=x-auto;diffuse,specular;stabilize=1' \
  'f2-off03=svgf-auto;diffuse,specular;antiLag=off&temporalAlpha=0.03'
$D/replay.sh sponza-orbit,sponza-move,bistro-orbit,bistro-move \
  'f8-stab-it4=x-auto;diffuse,specular;stabilize=1&atrousIterations=4'
