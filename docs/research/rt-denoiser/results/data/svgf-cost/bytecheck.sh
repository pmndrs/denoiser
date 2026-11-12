#!/bin/zsh
# byte check: replays through the frozen baseline (port 5352) vs the live worktree (5353); diff outputs.
# usage: bytecheck.sh <tag> <captures...>   (variants listed below)
set -u
S=/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/svgfcost
R=/Users/dex/Developer/Denoiser-nrd-cleanroom
TAG=$1; shift
L=/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/gpu.lock
if [ -z "${NOLOCK:-}" ]; then until mkdir "$L" 2>/dev/null; do sleep 30; done
echo "svgf-cost byte check $TAG $(date) pid $$" > "$L/owner"; fi
cd $R
VARIANTS=(
  "svgf-auto|"
  "svgf|"
  "svgf-auto|feedback=1"
  "svgf-auto|specularNormalWeight=power"
  "svgf-auto|youngLuminanceWeight=0.25"
  "svgf-auto|youngNormalPower=0"
  "occlusion-svgf-auto|"
  "svgf-auto|outputAliasing=1"
  "svgf-auto|spatialVarianceRadius=3"
  "svgf-auto|spatialHistoryWeight=8"
  "svgf-auto|kernel=5x5"
  "svgf-sh-auto|"
)
for c in "$@"; do
  for v in $VARIANTS; do
    [[ -n "${VF:-}" && ! "$v" =~ $VF ]] && continue
    id=${v%%|*}; st=${v#*|}; k=$(echo "$id-$st" | tr -c 'a-zA-Z0-9-' '_')
    for side in base new; do
      port=5352; [ $side = new ] && port=5353
      BASE=http://127.0.0.1:$port/ node tools/rt-capture/run-headless.mjs "capture=$c&denoiser=$id&output=bc-$TAG-$side-$k${st:+&$st}" > $S/out/bc-$TAG-$side-$k.log 2>&1 || echo "FAIL $c $side $k"
    done
    O=tools/rt-capture/outputs/$c
    n=$(diff -rq $O/bc-$TAG-base-$k $O/bc-$TAG-new-$k 2>&1 | grep -v "run.json\|timings" | wc -l | tr -d ' ')
    echo "$c $k: differing files $n of $(ls $O/bc-$TAG-base-$k 2>/dev/null | wc -l | tr -d ' ') entries"
  done
done
[ -z "${NOLOCK:-}" ] && rm -rf "$L"
