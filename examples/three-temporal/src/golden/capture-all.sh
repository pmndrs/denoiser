#!/bin/bash
# Writes the golden captures (priority order: G3, G4 light-change paths, holds, then G2, G5) under the GPU lock (TASKS rule 11),
# each validated. Needs the dev server on :5301 and RT_SCENE_ASSETS for G3/G4. Output: tools/rt-capture/captures/golden-*
export RT_GPU_LOCK=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
acquire() { until mkdir "$RT_GPU_LOCK" 2>/dev/null; do sleep 2; done; echo "T0-scenes capture $1 $(date)" > "$RT_GPU_LOCK/owner"; }
cd "$(dirname "$0")/../.."
cap() { # scene path frames spp name
  acquire "$5"
  node src/golden/driver.mjs capture --scene=$1 --path=$2 --frames=$3 --referenceSpp=$4 --referenceSppSpec=$4 --name=$5 | grep -E "seconds|gpuErrors"
  rm -rf "$RT_GPU_LOCK"
  (cd ../.. && node tools/rt-capture/validate.mjs $5 | grep -E "VALID|FAIL|fail")
}
cap G3 orbit 64 4096 golden-G3-orbit
cap G4 pan-light-on 64 4096 golden-G4-pan-light-on
cap G4 pan-light-colour 64 4096 golden-G4-pan-light-colour
cap G4 pan-light-fade 64 4096 golden-G4-pan-light-fade
cap G4 pan-lamp-switch 64 4096 golden-G4-pan-lamp-switch
cap G3 hold 32 16384 golden-G3-hold
cap G4 hold-light-on 32 16384 golden-G4-hold-light-on
cap G2 occluder 64 4096 golden-G2-occluder
cap G5 turntable 64 4096 golden-G5-turntable
du -sh ../../tools/rt-capture/captures/golden-*
