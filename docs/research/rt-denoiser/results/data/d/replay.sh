#!/bin/zsh
# Track D replay batch: replays (capture x arm) on the pinned test-bed server at $BASE, one run-headless call per
# replay (retry once if no run.json), under the GPU lock (TASKS rule 11) when LOCKED is unset.
#   replay.sh <captures,comma> <arm> [<arm> ...]      arm = <output>=<denoiser>[;<signals>][;<extra query>]
#   e.g. replay.sh sponza-orbit,bistro-orbit 'd0-auto=svgf-auto;diffuse,specular' 'd0-occ=occlusion-svgf-auto;ao'
REPO=${REPO:-/Users/dex/Developer/Denoiser-track-d}
OUT=${RT_OUT:-$REPO/tools/rt-capture/outputs}
caps=(${(s:,:)1}); shift
for c in $caps; do
  for arm in "$@"; do
    name=${arm%%=*}; rest=${arm#*=}
    parts=("${(@s:;:)rest}")
    den=$parts[1]; sig=${parts[2]:-}; extra=${parts[3]:-}
    q="mode=replay&capture=$c&denoiser=$den&output=$name${sig:+&signals=$sig}${extra:+&$extra}"
    for try in 1 2; do
      rm -rf "$OUT/$c/$name"
      node $REPO/examples/realtime-denoiser/run-headless.mjs "$q" > /dev/null 2>&1
      [[ -f "$OUT/$c/$name/run.json" ]] && break
      echo "retry $c $name"
    done
    [[ -f "$OUT/$c/$name/run.json" ]] && echo "ok $c $name $(ls $OUT/$c/$name | grep -c frame)" || echo "FAIL $c $name"
  done
done
