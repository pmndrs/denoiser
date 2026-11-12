#!/bin/zsh
# rb-lock.sh <plan.json> <tag>: run a plan through the shared fair GPU queue (tools/gpu-lock.sh on
# feat/rt-denoiser-cleanroom, copied to /tmp/gpu-lock.sh; TASKS rule 11: one batch per hold, <= 15 min), then score it.
# RB_OUT = PNG output (scratch), metrics JSON -> results/data/r/<tag>.json
set -e
HERE=${0:A:h}
GL=${GPU_LOCK_SH:-/tmp/gpu-lock.sh}
"$GL" "R reflect-bench $2" node "$HERE/rb-run.mjs" "$1"
python3 "$HERE/rb-metrics.py" "$RB_OUT" "$RB_OUT/runs-$2.json" "$HERE/$2.json"
