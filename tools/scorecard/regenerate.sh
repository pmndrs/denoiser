#!/bin/bash
cd "$(dirname "$0")/../.."
L=tools/gpu-lock.sh
export RT_GPU_LOCK=/tmp/rt-gpu.lock
W=${SCORECARD_LOGS:-/tmp/scorecard-logs}; mkdir -p "$W"
$L "T0-scorecard replays (9 scenes + golden G4, ~5 min)" env SCORECARD_LOCK_HELD=1 node tools/scorecard/run.mjs --replay-only > $W/c1.log 2>&1
node tools/scorecard/run.mjs --skip-replay > $W/c2.log 2>&1
$L "T0-scorecard calibration replays (~5 min)" env SCORECARD_LOCK_HELD=1 node tools/scorecard/calibration/make-pairs.mjs --replay-only > $W/c3.log 2>&1
$L "T0-scorecard cost 1080p timing" env SCORECARD_LOCK_HELD=1 node tools/scorecard/run.mjs --cost-only > $W/c4.log 2>&1
node tools/scorecard/calibration/make-pairs.mjs --skip-replay > $W/c5.log 2>&1
echo chain-done > $W/chain.done
