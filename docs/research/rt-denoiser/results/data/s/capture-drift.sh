#!/bin/zsh
# Track S: captures of the free-running realtime-shadows page's own motion (needs the local path.ts patch, tracks/s.md):
# three-knot-drift (wide shot drift + knot rotating) and three-knot-drift-frozen (same drift, knot frozen). Holds the lock.
cd /Users/dex/Developer/Denoiser-track-s/examples/three-temporal
L=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
until mkdir "$L" 2>/dev/null; do sleep 2; done
echo "S capture knot-drift $(date)" > "$L/owner"
trap 'rm -rf "$L"' EXIT
for p in knot-drift knot-drift-frozen; do
  node run-realtime.mjs capture --port=5304 --path=$p --windows=three-$p:0:48 --refShadow=2048 --refDiffuse=16 --refSpec=8 --stepTimeout=3600000 --timeout=3600000
done
