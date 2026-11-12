#!/bin/zsh
# Track S replays: holds the GPU lock (TASKS rule 11) for one batch of replay runs.
#   replay.sh <capture> <output>:<extra query> [<output>:<extra query> ...]
#   e.g. replay.sh three-knot-static s-def:denoiser=shadows s-ffx:denoiser=ffx-shadows
# Needs the tools/rt-capture dev server on BASE (default :5304) with captures/ symlinked (tracks/s.md).
cd /Users/dex/Developer/Denoiser-track-s
L=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
until mkdir "$L" 2>/dev/null; do sleep 0.3; done
echo "S replay $* $(date)" > "$L/owner"
trap 'rm -rf "$L"' EXIT
cap=$1; shift
runs=()
for r in "$@"; do out=${r%%:*}; q=${r#*:}; runs+=("capture=$cap&output=$out&warm=0&$q"); done
BASE=${BASE:-http://127.0.0.1:5304/} node tools/rt-capture/run-headless.mjs "${runs[@]}" 2>&1 | grep -v '^\s*$' | cut -c1-300
