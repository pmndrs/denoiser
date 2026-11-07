#!/bin/zsh
# Track D light-change lag (tracks/d.md): T3's fixed-camera paths (results/T3-light-changes.md) re-captured at HEAD
# (diffuse + specular, 96 frames, 960x540, 256-spp references), replayed through the shipped default and anchors.
D=${0:A:h}
REPO=/Users/dex/Developer/Denoiser-track-d
for p in step hue jump fade; do
  [[ -f $REPO/tools/rt-capture/captures/lc540-$p/frame_0095/diffuse_ref.f32 ]] && continue
  node $REPO/examples/realtime-denoiser/run-headless.mjs "mode=capture&name=lc540-$p&path=lc-$p&start=0&frames=96&w=960&h=540&signal=diffuse,specular&refspp=256" > /dev/null 2>&1
  echo "captured lc540-$p $(ls $REPO/tools/rt-capture/captures/lc540-$p | grep -c frame)"
done
$D/replay.sh lc540-step,lc540-hue,lc540-jump,lc540-fade 'd0-auto=svgf-auto;diffuse,specular' 'd0-svgf=svgf;diffuse,specular' 'd0-rec=recurrent;diffuse,specular' "$@"
