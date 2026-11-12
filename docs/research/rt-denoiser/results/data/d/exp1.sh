#!/bin/zsh
# Track D experiment batch 1 (tracks/d.md "Causes"): one change at a time against the shipped joint default (svgf-auto),
# diffuse scored; AO arms against occlusion-svgf-auto. Settings go through the registry (svgfOptions; d. = diffuse only).
D=${0:A:h}
$D/replay.sh sponza-orbit,sponza-move,bistro-orbit,bistro-pan \
  'e1-off=svgf-auto;diffuse,specular;antiLag=off&temporalAlpha=0.1' \
  'e2-a05=svgf-auto;diffuse,specular;d.temporalAlpha=0.05' \
  'e3-a03=svgf-auto;diffuse,specular;d.temporalAlpha=0.03' \
  'e4-varmean=svgf-auto;diffuse,specular;d.luminanceVariance=mean' \
  'e5-sl8=svgf-auto;diffuse,specular;d.sigmaLuminance=8' \
  'e5-sl2=svgf-auto;diffuse,specular;d.sigmaLuminance=2' \
  'e6-nf3=svgf-auto;diffuse,specular;d.antiLagNoiseFloor=3' \
  'e7-fb=svgf-auto;diffuse,specular;feedback=1' \
  'e8-cr=svgf-auto;diffuse,specular;d.historyFilter=catmull-rom' \
  'e9-center=svgf-auto;diffuse,specular;normalTest=center' \
  'e10-ynp0=svgf-auto;diffuse,specular;d.youngNormalPower=0' \
  'e11-fboff=svgf-auto;diffuse,specular;historyFallback=off' \
  'e12-it4=svgf-auto;diffuse,specular;atrousIterations=4' \
  'a2-a05=occlusion-svgf-auto;ao;temporalAlpha=0.05' \
  'a4-varmean=occlusion-svgf-auto;ao;luminanceVariance=mean' \
  'a1-off=occlusion-svgf-auto;ao;antiLag=off&temporalAlpha=0.1' \
  'a7-fb=occlusion-svgf-auto;ao;feedback=1'
