
### std540 (7 captures), vs ab-ship

| variant | pooled | Δ min (capture) | FLIP | FLIP Δ | boil Δ (worst) | dyn boil Δ | static-pen boil Δ (worst) | sharpness | edge | soft | contact | changing | trail |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ab-ship | 35.66 |  | 0.0189 |  |  |  |  | 0.951 | 25.47 | 29.04 | 21.79 | 22.77 | 0.0193 |
| ab-c3 | 35.68 | -0.05 (std540-pan) | 0.0188 | -0 % | +0 % (+2 % std540-orbit) | +1 % | -1 % (+1 % std540-glossy) | 0.952 | 25.53 | 29.02 | 22.00 | 22.79 | 0.0192 |
| ab-ta | 36.98 | 0.69 (std540-thin) | 0.0150 | -20 % | -11 % (-4 % std540-light) | +0 % | -8 % (-3 % std540-thin) | 0.961 | 26.44 | 30.99 | 21.81 | 23.45 | 0.0176 |
| sf-ab-fe | 35.67 | -0.08 (std540-thin) | 0.0187 | -1 % | +1 % (+3 % std540-orbit) | +1 % | -0 % (+2 % std540-glossy) | 0.953 | 25.51 | 29.02 | 22.01 | 22.78 | 0.0193 |
| sf-ab-tahs | 37.02 | 0.78 (std540-thin) | 0.0144 | -23 % | -12 % (-5 % std540-light) | +1 % | -8 % (-3 % std540-thin) | 0.963 | 26.53 | 30.99 | 21.81 | 23.49 | 0.0174 |
| sf-ab-c3tahs | 37.05 | 0.74 (std540-thin) | 0.0144 | -23 % | -11 % (-7 % std540-light) | +2 % | -8 % (-3 % std540-thin) | 0.964 | 26.60 | 30.99 | 22.02 | 23.51 | 0.0174 |
| sf-ab-lm1 | 35.94 | -0.00 (std540-object) | 0.0186 | -1 % | -1 % (+0 % std540-glossy) | +0 % | +1 % (+7 % std540-light) | 0.952 | 25.63 | 29.42 | 21.96 | 23.34 | 0.0165 |
| sf-ab-c3lm1 | 35.95 | -0.05 (std540-pan) | 0.0186 | -2 % | -1 % (+2 % std540-orbit) | +1 % | +0 % (+3 % std540-light) | 0.953 | 25.67 | 29.41 | 22.13 | 23.34 | 0.0165 |
| sf-ab-all | 37.03 | 0.69 (std540-thin) | 0.0143 | -24 % | -10 % (-4 % std540-light) | +2 % | -7 % (-3 % std540-thin) | 0.965 | 26.58 | 30.98 | 22.03 | 23.49 | 0.0174 |

region boil vs base (mean Δ; worst increase that counts under the amended clause):

- ab-c3: edge +1 % (+3 % std540-orbit) · soft -0 % (+2 % std540-cut) · contact +1 % (+7 % std540-orbit) · changing +2 % (+4 % std540-cut) · static -1 % (+1 % std540-thin)
- ab-ta: edge -7 % (+0 % std540-orbit) · soft -18 % (+0 % std540-orbit) · contact +1 % (+10 % std540-thin) · changing -3 % (+0 % std540-orbit) · static -14 % (+0 % std540-orbit)
- sf-ab-fe: edge +3 % (+4 % std540-orbit) · soft -0 % (+2 % std540-cut) · contact +5 % (+13 % std540-light) · changing +3 % (+6 % std540-cut) · static +0 % (+2 % std540-thin)
- sf-ab-tahs: edge -8 % (+0 % std540-orbit) · soft -18 % (+0 % std540-orbit) · contact +1 % (+9 % std540-thin) · changing -4 % (+0 % std540-orbit) · static -14 % (+0 % std540-orbit)
- sf-ab-c3tahs: edge -7 % (+0 % std540-glossy) · soft -19 % (+0 % std540-orbit) · contact +1 % (+11 % std540-thin) · changing -1 % (+2 % std540-thin) · static -15 % (+0 % std540-orbit)
- sf-ab-lm1: edge +0 % (+3 % std540-light) · soft -2 % (+0 % std540-thin) · contact +1 % (+6 % std540-light) · changing -3 % (+0 % std540-glossy) · static +1 % (+5 % std540-light)
- sf-ab-c3lm1: edge +1 % (+3 % std540-orbit) · soft -2 % (+2 % std540-cut) · contact +1 % (+7 % std540-orbit) · changing -0 % (+4 % std540-cut) · static -0 % (+1 % std540-thin)
- sf-ab-all: edge -5 % (+1 % std540-glossy) · soft -19 % (+0 % std540-orbit) · contact +6 % (+13 % std540-light) · changing -0 % (+2 % std540-thin) · static -14 % (+0 % std540-orbit)

### real (11 captures), vs ab-ship

| variant | pooled | Δ min (capture) | FLIP | FLIP Δ | boil Δ (worst) | dyn boil Δ | static-pen boil Δ (worst) | sharpness | edge | soft | contact | changing | trail |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ab-ship | 28.86 |  | 0.0313 |  |  |  |  | 0.753 | 17.06 | 29.57 | 15.23 | 15.27 | 0.0396 |
| ab-c3 | 29.29 | 0.28 (sponza-pan) | 0.0304 | -2 % | -15 % (-1 % sponza-pan) | +0 % | -4 % (+1 % bistro-orbit) | 0.766 | 17.53 | 29.55 | 15.92 | 15.38 | 0.0399 |
| ab-ta | 29.49 | 0.02 (bistro-orbit) | 0.0302 | -4 % | -2 % (+1 % sponza-orbit) | +7 % | -2 % (+7 % three-pan) | 0.783 | 17.81 | 29.74 | 15.60 | 16.60 | 0.0427 |
| sf-ab-fe | 29.69 | 0.49 (sponza-pan) | 0.0288 | -7 % | -13 % (-2 % sponza-pan) | +2 % | -3 % (+2 % sponza-pan) | 0.784 | 18.01 | 29.54 | 16.30 | 15.40 | 0.0405 |
| sf-ab-tahs | 29.76 | 0.38 (bistro-move) | 0.0280 | -11 % | -2 % (+2 % three-pan) | +12 % | +2 % (+22 % bistro-orbit) | 0.807 | 18.11 | 29.72 | 15.72 | 17.29 | 0.0341 |
| sf-ab-c3tahs | 30.31 | 0.78 (sponza-orbit) | 0.0271 | -13 % | -15 % (-2 % sponza-pan) | +13 % | +1 % (+22 % bistro-orbit) | 0.820 | 18.75 | 29.71 | 16.50 | 17.44 | 0.0343 |
| sf-ab-lm1 | 28.87 | -0.00 (three-knot-orbit) | 0.0310 | -1 % | +0 % (+1 % bistro-move) | -0 % | +0 % (+2 % bistro-move) | 0.754 | 17.06 | 29.62 | 15.23 | 15.30 | 0.0388 |
| sf-ab-c3lm1 | 29.30 | 0.28 (sponza-pan) | 0.0301 | -3 % | -15 % (-1 % sponza-pan) | +0 % | -4 % (+1 % bistro-orbit) | 0.767 | 17.54 | 29.60 | 15.92 | 15.42 | 0.0392 |
| sf-ab-all | 30.88 | 1.04 (sponza-pan) | 0.0254 | -18 % | -14 % (-3 % sponza-pan) | +14 % | +2 % (+23 % bistro-orbit) | 0.838 | 19.56 | 29.70 | 16.92 | 17.46 | 0.0348 |

region boil vs base (mean Δ; worst increase that counts under the amended clause):

- ab-c3: edge -16 % (+0 % three-knot-static) · soft -2 % (+1 % three-pan) · contact -19 % (+0 % three-knot-static) · changing -1 % (+2 % sponza-move) · static -16 % (+0 % three-knot-static)
- ab-ta: edge -4 % (+0 % sponza-orbit) · soft -0 % (+1 % sponza-move) · contact +1 % (+6 % three-knot-still) · changing -3 % (+0 % sponza-move) · static -2 % (+1 % sponza-orbit)
- sf-ab-fe: edge -15 % (+0 % three-knot-static) · soft -2 % (+1 % three-pan) · contact -17 % (+0 % three-knot-static) · changing +1 % (+7 % sponza-orbit) · static -15 % (+0 % three-knot-static)
- sf-ab-tahs: edge -4 % (+2 % three-pan) · soft +0 % (+2 % bistro-orbit) · contact +1 % (+5 % three-pan) · changing -7 % (+1 % sponza-move) · static -2 % (+2 % bistro-pan)
- sf-ab-c3tahs: edge -19 % (+0 % three-knot-static) · soft -1 % (+3 % bistro-orbit) · contact -18 % (+0 % three-knot-static) · changing -7 % (+3 % sponza-move) · static -16 % (+0 % three-knot-static)
- sf-ab-lm1: edge +0 % (+1 % bistro-move) · soft +0 % (+2 % bistro-move) · contact +0 % (+1 % bistro-move) · changing +0 % (+0 % bistro-move) · static +0 % (+1 % bistro-move)
- sf-ab-c3lm1: edge -16 % (+0 % three-knot-static) · soft -2 % (+3 % bistro-move) · contact -19 % (+0 % three-knot-static) · changing -1 % (+2 % sponza-move) · static -16 % (+0 % three-knot-static)
- sf-ab-all: edge -18 % (+0 % three-knot-static) · soft -1 % (+3 % bistro-orbit) · contact -16 % (+0 % three-knot-static) · changing -5 % (+7 % sponza-orbit) · static -16 % (+0 % three-knot-static)

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
