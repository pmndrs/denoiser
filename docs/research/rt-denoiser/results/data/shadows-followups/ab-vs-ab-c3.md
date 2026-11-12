
### std540 (7 captures), vs ab-c3

| variant | pooled | Δ min (capture) | FLIP | FLIP Δ | boil Δ (worst) | dyn boil Δ | static-pen boil Δ (worst) | sharpness | edge | soft | contact | changing | trail |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ab-c3 | 35.68 |  | 0.0188 |  |  |  |  | 0.952 | 25.53 | 29.02 | 22.00 | 22.79 | 0.0192 |
| ab-ta | 36.98 | 0.67 (std540-light) | 0.0150 | -20 % | -11 % (-1 % std540-light) | -1 % | -7 % (-2 % std540-light) | 0.961 | 26.44 | 30.99 | 21.81 | 23.45 | 0.0176 |
| sf-ab-fe | 35.67 | -0.05 (std540-orbit) | 0.0187 | -1 % | +1 % (+3 % std540-light) | +0 % | +1 % (+3 % std540-light) | 0.953 | 25.51 | 29.02 | 22.01 | 22.78 | 0.0193 |
| sf-ab-tahs | 37.02 | 0.69 (std540-light) | 0.0144 | -23 % | -12 % (-1 % std540-light) | -0 % | -7 % (-2 % std540-light) | 0.963 | 26.53 | 30.99 | 21.81 | 23.49 | 0.0174 |
| sf-ab-c3tahs | 37.05 | 0.78 (std540-thin) | 0.0144 | -23 % | -11 % (-4 % std540-light) | +1 % | -7 % (-3 % std540-thin) | 0.964 | 26.60 | 30.99 | 22.02 | 23.51 | 0.0174 |
| sf-ab-lm1 | 35.94 | -0.06 (std540-cut) | 0.0186 | -1 % | -1 % (+2 % std540-object) | -0 % | +2 % (+11 % std540-light) | 0.952 | 25.63 | 29.42 | 21.96 | 23.34 | 0.0165 |
| sf-ab-c3lm1 | 35.95 | -0.00 (std540-object) | 0.0186 | -1 % | -1 % (-0 % std540-orbit) | +0 % | +1 % (+7 % std540-light) | 0.953 | 25.67 | 29.41 | 22.13 | 23.34 | 0.0165 |
| sf-ab-all | 37.03 | 0.74 (std540-thin) | 0.0143 | -24 % | -11 % (-1 % std540-light) | +1 % | -7 % (-2 % std540-light) | 0.965 | 26.58 | 30.98 | 22.03 | 23.49 | 0.0174 |

region boil vs base (mean Δ; worst increase that counts under the amended clause):

- ab-ta: edge -8 % (+0 % std540-orbit) · soft -18 % (+0 % std540-orbit) · contact +0 % (+7 % std540-light) · changing -6 % (+0 % std540-orbit) · static -13 % (+2 % std540-light)
- sf-ab-fe: edge +2 % (+7 % std540-light) · soft +0 % (+0 % std540-orbit) · contact +4 % (+21 % std540-light) · changing +1 % (+2 % std540-light) · static +1 % (+3 % std540-light)
- sf-ab-tahs: edge -9 % (+0 % std540-orbit) · soft -18 % (+0 % std540-orbit) · contact +0 % (+7 % std540-light) · changing -6 % (+0 % std540-orbit) · static -14 % (+1 % std540-light)
- sf-ab-c3tahs: edge -7 % (+0 % std540-orbit) · soft -18 % (+0 % std540-orbit) · contact +1 % (+8 % std540-thin) · changing -3 % (+0 % std540-orbit) · static -14 % (+0 % std540-orbit)
- sf-ab-lm1: edge -0 % (+8 % std540-light) · soft -1 % (+3 % std540-object) · contact +0 % (+13 % std540-light) · changing -5 % (+0 % std540-orbit) · static +2 % (+12 % std540-light)
- sf-ab-c3lm1: edge +0 % (+3 % std540-light) · soft -2 % (+0 % std540-orbit) · contact +1 % (+5 % std540-light) · changing -3 % (+0 % std540-pan) · static +1 % (+5 % std540-light)
- sf-ab-all: edge -5 % (+3 % std540-light) · soft -18 % (+0 % std540-orbit) · contact +5 % (+21 % std540-light) · changing -2 % (+0 % std540-orbit) · static -13 % (+0 % std540-orbit)

### real (11 captures), vs ab-c3

| variant | pooled | Δ min (capture) | FLIP | FLIP Δ | boil Δ (worst) | dyn boil Δ | static-pen boil Δ (worst) | sharpness | edge | soft | contact | changing | trail |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ab-c3 | 29.29 |  | 0.0304 |  |  |  |  | 0.766 | 17.53 | 29.55 | 15.92 | 15.38 | 0.0399 |
| ab-ta | 29.49 | -0.42 (bistro-pan) | 0.0302 | -2 % | +17 % (+76 % bistro-move) | +7 % | +2 % (+12 % bistro-move) | 0.783 | 17.81 | 29.74 | 15.60 | 16.60 | 0.0427 |
| sf-ab-fe | 29.69 | 0.11 (three-knot-orbit) | 0.0288 | -5 % | +2 % (+9 % bistro-move) | +2 % | +2 % (+6 % bistro-move) | 0.784 | 18.01 | 29.54 | 16.30 | 15.40 | 0.0405 |
| sf-ab-tahs | 29.76 | -0.09 (bistro-move) | 0.0280 | -9 % | +17 % (+74 % bistro-move) | +12 % | +6 % (+21 % bistro-orbit) | 0.807 | 18.11 | 29.72 | 15.72 | 17.29 | 0.0341 |
| sf-ab-c3tahs | 30.31 | 0.44 (bistro-move) | 0.0271 | -11 % | -1 % (+2 % three-knot-still) | +12 % | +5 % (+22 % bistro-orbit) | 0.820 | 18.75 | 29.71 | 16.50 | 17.44 | 0.0343 |
| sf-ab-lm1 | 28.87 | -0.53 (three-knot-static) | 0.0310 | +2 % | +20 % (+78 % bistro-move) | -0 % | +5 % (+24 % three-knot-static) | 0.754 | 17.06 | 29.62 | 15.23 | 15.30 | 0.0388 |
| sf-ab-c3lm1 | 29.30 | -0.00 (sponza-pan) | 0.0301 | -1 % | -0 % (+0 % sponza-pan) | -0 % | +0 % (+3 % bistro-move) | 0.767 | 17.54 | 29.60 | 15.92 | 15.42 | 0.0392 |
| sf-ab-all | 30.88 | 0.76 (sponza-pan) | 0.0254 | -16 % | +1 % (+7 % sponza-move) | +13 % | +6 % (+22 % bistro-orbit) | 0.838 | 19.56 | 29.70 | 16.92 | 17.46 | 0.0348 |

region boil vs base (mean Δ; worst increase that counts under the amended clause):

- ab-ta: edge +17 % (+83 % bistro-move) · soft +2 % (+15 % three-knot-still) · contact +40 % (+210 % bistro-move) · changing -3 % (+2 % bistro-pan) · static +23 % (+130 % bistro-move)
- sf-ab-fe: edge +2 % (+9 % bistro-move) · soft +0 % (+1 % bistro-pan) · contact +5 % (+29 % sponza-move) · changing +2 % (+6 % sponza-orbit) · static +2 % (+13 % bistro-move)
- sf-ab-tahs: edge +17 % (+81 % bistro-move) · soft +3 % (+15 % three-knot-still) · contact +41 % (+210 % bistro-move) · changing -6 % (+0 % three-knot-static) · static +23 % (+129 % bistro-move)
- sf-ab-c3tahs: edge -4 % (+1 % bistro-pan) · soft +2 % (+9 % three-knot-still) · contact +2 % (+15 % three-knot-still) · changing -6 % (+1 % sponza-move) · static -0 % (+2 % bistro-orbit)
- sf-ab-lm1: edge +24 % (+85 % bistro-move) · soft +3 % (+15 % three-knot-static) · contact +40 % (+212 % bistro-move) · changing +1 % (+12 % three-knot-static) · static +26 % (+132 % bistro-move)
- sf-ab-c3lm1: edge +0 % (+0 % bistro-move) · soft +0 % (+2 % bistro-move) · contact +0 % (+0 % bistro-move) · changing +0 % (+0 % bistro-move) · static -0 % (+0 % sponza-pan)
- sf-ab-all: edge -2 % (+7 % sponza-move) · soft +2 % (+9 % three-knot-still) · contact +7 % (+27 % sponza-move) · changing -4 % (+6 % sponza-orbit) · static +2 % (+11 % bistro-move)

### live test bed, 1080p, 7 paths (means of per-path values; Δ min = worst path vs shadows)

| variant | pooled | Δ min (path) | penumbra | dynamic | static penumbra | FLIP | flicker | tPSNR | frame 0 |
|---|---|---|---|---|---|---|---|---|---|
| shadows | 38.49 |  | 29.39 | 24.07 | 30.80 | 0.0124 | 0.0024 | 41.09 | 35.44 |
| shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0 | 38.56 | -0.00 (glossy) | 29.43 | 24.18 | 30.81 | 0.0124 | 0.0024 | 41.17 | 35.45 |
| shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0@sh.floorE=0.05 | 38.57 | -0.00 (glossy) | 29.43 | 24.18 | 30.81 | 0.0123 | 0.0024 | 41.15 | 35.41 |
| shadows@sh.terminatorAnalytic=true | 39.96 | 0.87 (thin) | 30.90 | 24.84 | 32.57 | 0.0094 | 0.0018 | 41.92 | 37.88 |
| shadows@sh.terminatorAnalytic=true@sh.horizonSnap=true | 40.00 | 0.95 (thin) | 30.90 | 24.86 | 32.57 | 0.0090 | 0.0018 | 41.96 | 37.88 |
| shadows@sh.lightMotion=1 | 38.56 | 0.00 (orbit) | 29.46 | 24.15 | 30.86 | 0.0123 | 0.0024 | 41.31 | 35.44 |
| shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0@sh.lightMotion=1 | 38.63 | -0.00 (glossy) | 29.50 | 24.26 | 30.87 | 0.0123 | 0.0023 | 41.40 | 35.45 |
| shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0@sh.floorE=0.05@sh.terminatorAnalytic=true@sh.horizonSnap=true | 40.10 | 0.95 (thin) | 30.95 | 24.99 | 32.58 | 0.0089 | 0.0018 | 42.00 | 37.82 |

per path pooled:

- shadows: orbit 37.92, pan 40.19, light 34.64, thin 37.60, glossy 42.99, cut 38.92, object 37.21
- shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0: orbit 38.04, pan 40.21, light 34.80, thin 37.62, glossy 42.99, cut 39.09, object 37.21
- shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0@sh.floorE=0.05: orbit 38.03, pan 40.20, light 34.85, thin 37.60, glossy 42.99, cut 39.11, object 37.21
- shadows@sh.terminatorAnalytic=true: orbit 39.38, pan 42.86, light 35.83, thin 38.46, glossy 44.57, cut 40.34, object 38.24
- shadows@sh.terminatorAnalytic=true@sh.horizonSnap=true: orbit 39.45, pan 42.90, light 35.86, thin 38.54, glossy 44.58, cut 40.38, object 38.28
- shadows@sh.lightMotion=1: orbit 37.92, pan 40.19, light 35.08, thin 37.60, glossy 42.99, cut 38.92, object 37.21
- shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0@sh.lightMotion=1: orbit 38.04, pan 40.21, light 35.27, thin 37.62, glossy 42.99, cut 39.09, object 37.21
- shadows@sh.stepTest=true@sh.edgeBox=true@sh.rotationStep=0@sh.floorE=0.05@sh.terminatorAnalytic=true@sh.horizonSnap=true: orbit 39.61, pan 42.90, light 36.14, thin 38.55, glossy 44.57, cut 40.66, object 38.28
