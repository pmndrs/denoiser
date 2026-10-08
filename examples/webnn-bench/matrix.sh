#!/bin/sh
# Every model x precision through index.html (needs the dev server on 5200).
#   [MODELS=..] [PRECISIONS=..] [FEATURES=..] sh matrix.sh [extra query], e.g. "&devs=gpu,npu,wgsl&warm=10"
cd "$(dirname "$0")"
EXTRA="${1:-&devs=gpu,npu,wgsl&warm=10}"
for m in ${MODELS:-rt_hdr_small rt_hdr rt_hdr_calb_cnrm rt_hdr_calb_cnrm_large}; do
  for p in ${PRECISIONS:-fp32 fp16}; do
    node run-headless.mjs "index.html?model=$m&precision=$p$EXTRA"
  done
done
