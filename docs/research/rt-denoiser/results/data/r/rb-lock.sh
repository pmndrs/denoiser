#!/bin/zsh
# rb-lock.sh <plan.json> <tag>: run a plan under the shared GPU lock (TASKS rule 11), then score it.
# RB_OUT = PNG output (scratch), metrics JSON -> results/data/r/<tag>.json
set -e
HERE=${0:A:h}
L=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
until mkdir "$L" 2>/dev/null; do sleep 20; done
echo "R (track r) reflect-bench $2 $(date) pid $$" > "$L/owner"
trap 'rm -rf "$L"' EXIT
node "$HERE/rb-run.mjs" "$1"
rm -rf "$L"; trap - EXIT
python3 "$HERE/rb-metrics.py" "$RB_OUT" "$RB_OUT/runs-$2.json" "$HERE/$2.json"
