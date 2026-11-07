#!/bin/bash
# Fair (first-in, first-out) GPU lock for heavy runs on the Mac (TASKS rule 11).
#
#   tools/gpu-lock.sh "<agent> <task>" <command> [args...]
#
# Takes a ticket in $RT_GPU_QUEUE, waits until it is the oldest live ticket and the lock
# ($RT_GPU_LOCK, a directory) is free, runs the command, then releases. Same lock directory as the
# inline rule-11 loop, so old and new callers exclude each other. Keep each call to one batch
# (≤ 15 min); call it again for the next batch so others get a turn.
set -u
LOCK=${RT_GPU_LOCK:-/tmp/rt-gpu.lock}
QUEUE=${RT_GPU_QUEUE:-/tmp/rt-gpu.queue}
WHO=${1:?usage: gpu-lock.sh "<agent> <task>" <command> [args...]}
shift
mkdir -p "$QUEUE"
TICKET="$QUEUE/$(date +%s%N 2>/dev/null || date +%s)000-$$"
echo "$WHO" > "$TICKET"
cleanup() { rm -f "$TICKET"; if [ "$(cat "$LOCK/owner" 2>/dev/null)" = "$WHO pid $$" ]; then rm -rf "$LOCK"; fi; }
trap cleanup EXIT INT TERM
while :; do
  # Drop tickets whose process is gone (the pid is the suffix after the last '-').
  for t in "$QUEUE"/*; do
    [ -e "$t" ] || continue
    pid=${t##*-}
    kill -0 "$pid" 2>/dev/null || rm -f "$t"
  done
  oldest=$(ls "$QUEUE" | sort | head -1)
  if [ "$QUEUE/$oldest" = "$TICKET" ] && mkdir "$LOCK" 2>/dev/null; then
    echo "$WHO pid $$" > "$LOCK/owner"
    break
  fi
  sleep 5
done
"$@"
status=$?
exit $status
