#!/bin/zsh
# dump.sh <srcdir> <out.json>
S=/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/svgfcost
sed "s#SRC/#$1/#" $S/wgsl/dump.ts > $S/wgsl/dump-tmp.ts
cd /Users/dex/Developer/Denoiser-nrd-cleanroom && node_modules/.bin/rolldown $S/wgsl/dump-tmp.ts --format esm -o $S/wgsl/dump-tmp.mjs > /dev/null 2>&1 && node $S/wgsl/dump-tmp.mjs > $2 && echo "dumped $(wc -c < $2) bytes"
