#!/usr/bin/env python3
# Track S cost probes: TIMING-ONLY local patches of packages/denoiser-realtime/src/shaders/shadow.ts (wrong output; applied
# for one bench run, then `git checkout` of the file). Upper bounds of what a pass change could save.
#   cost-hacks.py nocopy   the temporal pass skips its second unfiltered store (outT)      -> bound for "one unfiltered copy"
#   cost-hacks.py uniform  workgroups whose 12x12 raw tile is uniform and has no mixed history skip reprojection, clamp,
#                          E and stores only (v, 0, 0, 0)                              -> bound for a uniform-tile fast path
import sys
p = '/Users/dex/Developer/Denoiser-track-s/packages/denoiser-realtime/src/shaders/shadow.ts'
s = open(p).read()
mode = sys.argv[1]
if mode == 'nocopy':
    old = "    textureStore(outT, p, vec4f(vOut, 0.0, 0.0, 0.0));\n"
    assert s.count(old) == 1
    s = s.replace(old, "")
elif mode == 'uniform':
    old = "    if (g.z > 0.0) {\n      g.n = normalize(nIn);"
    assert s.count(old) == 1
    s = s.replace(old, "    if (g.z > 0.0 && !mixedTile) { g.n = normalize(nIn); }\n    else if (g.z > 0.0) {\n      g.n = normalize(nIn);")
else:
    raise SystemExit('mode?')
open(p, 'w').write(s)
print('patched', mode)
