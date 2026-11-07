# Scorecard (latest)

_Generated 2026-11-07T11:04:16.822Z by `node tools/scorecard/run.mjs` (repo 46c525e, packages ae853ef). GPU: Apple M5 Pro. Details: [tools/scorecard/README.md](../../../../tools/scorecard/README.md)._

Five numbers per scene and signal (TRACKS.md): **calm** = motion-compensated boil per region (value, and ×the clean reference's own boil in the same pixels) plus still-camera σ of luma where the camera is static; **detail** = FLIP vs the capture's reference (PSNR secondary); **lag** = frames until the error is within 10 % of its settled level after the event; **bias** = mean display luma minus the reference, 8-bit levels; **cost** = GPU ms and wall ms at 1080p on this Mac.

## G2-knot-static (G2): Knot over a floor, moving occluder (static camera, knot rotating)

960x540, 48 frames, reference 2048 spp, static camera, events: start@0. _provisional (kept capture three-knot-static; golden G2 pending T0-scenes)_

| gate | ours | bar | result |
|---|---|---|---|
| calm: moving boil <= FFX | 0.0177 | <= 0.0352 (FFX) | PASS |
| calm: static boil <= FFX | 0.0021 | <= 0.0020 (FFX) | FAIL |
| calm: still-camera sigma <= FFX | 0.0007 | <= 0.0017 (FFX) | PASS |
| detail: FLIP < FFX | 0.0174 | < 0.0470 (FFX) | PASS |
| cost: <= 0.6 ms GPU at 1080p | – | undefined 0.6000 (0.6) | n/a (no value for ours) |

### G2-knot-static / visibility

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0017 | 0.0209 | 0.0004 | 0.0006 | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1481 (85.00x) | 0.4575 (21.93x) | 0.0223 (60.26x) | 0.0409 | 0.0907 | 16.85 | start 0 | -5.98 | 0.000 | 0.00 |
| accumulate-32 | 0.0048 (2.76x) | 0.0178 (0.85x) | 0.0065 (17.51x) | 0.0036 | 0.0261 | 29.03 | start 35 | -0.15 | – | – |
| ours (shipped defaults) | 0.0021 (1.21x) | 0.0177 (0.85x) | 0.0008 (2.04x) | 0.0007 | 0.0174 | 37.13 | start 2 | -0.21 | – | – |
| FFX (MIT port) | 0.0020 (1.17x) | 0.0352 (1.69x) | 0.0061 (16.49x) | 0.0017 | 0.0470 | 28.68 | start 0 | +0.01 | – | – |
| native sigma (imported) | – | – | – | – | 0.0496 | 21.50 | start 0 | – | 1.115 † | 1.41 † |

![G2-knot-static visibility: raw | accumulate | ours | ffx | reference](crops/G2-knot-static-visibility.png)
_crop strip, frame 28: raw | accumulate | ours | ffx | reference_

## G2-knot-orbit (G2): Knot over a floor, moving occluder (camera orbit)

960x540, 40 frames, reference 2048 spp, moving camera, events: start@0. _provisional (kept capture three-knot-orbit)_

| gate | ours | bar | result |
|---|---|---|---|
| calm: moving boil <= FFX | 0.0634 | <= 0.0405 (FFX) | FAIL |
| calm: static boil <= FFX | 0.0117 | <= 0.0065 (FFX) | FAIL |
| detail: FLIP < FFX | 0.0193 | < 0.0545 (FFX) | PASS |

### G2-knot-orbit / visibility

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0146 | 0.0746 | 0.0121 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1539 (10.52x) | 0.4050 (5.43x) | 0.1418 (11.73x) | – | 0.1062 | 16.06 | start 0 | -6.84 | 0.000 | 0.00 |
| accumulate-32 | 0.0074 (0.50x) | 0.0218 (0.29x) | 0.0355 (2.94x) | – | 0.0398 | 26.03 | start 4 | +0.95 | – | – |
| ours (shipped defaults) | 0.0117 (0.80x) | 0.0634 (0.85x) | 0.0152 (1.26x) | – | 0.0193 | 33.62 | start 0 | +0.16 | – | – |
| FFX (MIT port) | 0.0065 (0.44x) | 0.0405 (0.54x) | 0.0135 (1.11x) | – | 0.0545 | 26.34 | start 0 | +0.22 | – | – |
| native sigma (imported) | – | – | – | – | 0.0495 | 24.93 | start 0 | – | 1.115 † | 1.41 † |

![G2-knot-orbit visibility: raw | accumulate | ours | ffx | reference](crops/G2-knot-orbit-visibility.png)
_crop strip, frame 24: raw | accumulate | ours | ffx | reference_

## G3-sponza-orbit (G3): Sponza orbit: diffuse GI + AO

960x540, 48 frames, reference 1024 spp, moving camera, events: start@0. _provisional (kept capture sponza-orbit)_

| gate | ours | bar | result |
|---|---|---|---|
| calm: static boil <= native | 0.0071 | – | n/a (no best native value on this capture) |
| lag <= native | 4.0000 | – | n/a (no best native value on this capture) |

### G3-sponza-orbit / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0093 | 0.0639 | 0.0075 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1371 (14.72x) | 0.2282 (3.57x) | 0.0965 (12.94x) | – | 0.5455 | 16.56 | start 0 | -43.50 | 0.000 | 0.00 |
| accumulate-32 | 0.0103 (1.10x) | 0.0165 (0.26x) | 0.0291 (3.91x) | – | 0.1848 | 26.39 | start 20 | -0.93 | – | – |
| ours (shipped defaults) | 0.0105 (1.13x) | 0.0729 (1.14x) | 0.0109 (1.46x) | – | 0.1134 | 32.07 | start 4 | -0.40 | – | – |

![G3-sponza-orbit diffuse: raw | accumulate | ours | reference](crops/G3-sponza-orbit-diffuse.png)
_crop strip, frame 28: raw | accumulate | ours | reference_

### G3-sponza-orbit / ao

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0163 | 0.0766 | 0.0118 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.2132 (13.11x) | 0.3145 (4.11x) | 0.2092 (17.67x) | – | 0.3755 | 13.38 | start 0 | -6.22 | 0.000 | 0.00 |
| accumulate-32 | 0.0099 (0.61x) | 0.0159 (0.21x) | 0.0468 (3.95x) | – | 0.0937 | 24.65 | start 7 | -0.20 | – | – |
| ours (shipped defaults) | 0.0161 (0.99x) | 0.0707 (0.92x) | 0.0146 (1.23x) | – | 0.0552 | 30.91 | start 3 | +0.15 | – | – |

![G3-sponza-orbit ao: raw | accumulate | ours | reference](crops/G3-sponza-orbit-ao.png)
_crop strip, frame 28: raw | accumulate | ours | reference_

## G3-sponza-move (G3): Sponza, static camera, moving knot: shadows + diffuse

960x540, 48 frames, reference 1024 spp, static camera, events: start@0. _provisional (kept capture sponza-move: moving occluder in the sun shaft)_

| gate | ours | bar | result |
|---|---|---|---|
| calm: moving boil <= FFX | 0.0844 | <= 0.0465 (FFX) | FAIL |
| detail: FLIP < FFX | 0.0264 | < 0.0682 (FFX) | PASS |

### G3-sponza-move / visibility

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0053 | 0.1178 | 0.0389 | 0.0004 | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1491 (28.29x) | 0.4652 (3.95x) | 0.1180 (3.04x) | 0.0136 | 0.0754 | 17.99 | start 0 | -4.78 | 0.000 | 0.00 |
| accumulate-32 | 0.0045 (0.86x) | 0.0163 (0.14x) | 0.0254 (0.65x) | 0.0013 | 0.0310 | 24.15 | start 38 | -0.15 | – | – |
| ours (shipped defaults) | 0.0058 (1.10x) | 0.0844 (0.72x) | 0.0263 (0.68x) | 0.0010 | 0.0264 | 29.88 | start 1 | +0.09 | – | – |
| FFX (MIT port) | 0.0035 (0.67x) | 0.0465 (0.39x) | 0.0222 (0.57x) | 0.0022 | 0.0682 | 24.73 | start 0 | +1.23 | – | – |

![G3-sponza-move visibility: raw | accumulate | ours | ffx | reference](crops/G3-sponza-move-visibility.png)
_crop strip, frame 28: raw | accumulate | ours | ffx | reference_

### G3-sponza-move / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0078 | 0.0197 | 0.0087 | 0.0067 | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1967 (25.26x) | 0.2338 (11.87x) | 0.1902 (21.80x) | 0.1509 | 0.7209 | 13.68 | start 0 | -62.21 | 0.000 | 0.00 |
| accumulate-32 | 0.0116 (1.49x) | 0.0152 (0.77x) | 0.0584 (6.69x) | 0.0271 | 0.2926 | 21.99 | start 35 | -5.27 | – | – |
| ours (shipped defaults) | 0.0059 (0.76x) | 0.0139 (0.70x) | 0.0174 (1.99x) | 0.0064 | 0.1071 | 32.58 | start 5 | -0.42 | – | – |

![G3-sponza-move diffuse: raw | accumulate | ours | reference](crops/G3-sponza-move-diffuse.png)
_crop strip, frame 28: raw | accumulate | ours | reference_

## G4-bistro-pan (G4): Bistro pan: diffuse + AO, thin geometry

960x540, 48 frames, reference 1024 spp, moving camera, events: start@0. _provisional (kept capture bistro-pan)_

| gate | ours | bar | result |
|---|---|---|---|
| calm: static boil <= native | 0.0124 | – | n/a (no best native value on this capture) |
| lag <= native | 37.0000 | – | n/a (no best native value on this capture) |

### G4-bistro-pan / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0186 | 0.0721 | 0.0189 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1987 (10.68x) | 0.2137 (2.96x) | 0.2094 (11.09x) | – | 0.7731 | 13.55 | start 0 | -65.16 | 0.000 | 0.00 |
| accumulate-32 | 0.0141 (0.76x) | 0.0154 (0.21x) | 0.0665 (3.52x) | – | 0.2419 | 22.53 | start 4 | -2.78 | – | – |
| ours (shipped defaults) | 0.0222 (1.19x) | 0.0816 (1.13x) | 0.0260 (1.38x) | – | 0.1292 | 28.88 | start 37 | -0.12 | – | – |

![G4-bistro-pan diffuse: raw | accumulate | ours | reference](crops/G4-bistro-pan-diffuse.png)
_crop strip, frame 28: raw | accumulate | ours | reference_

### G4-bistro-pan / ao

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0380 | 0.1332 | 0.0394 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.2406 (6.34x) | 0.3368 (2.53x) | 0.2744 (6.96x) | – | 0.4266 | 12.08 | start 0 | -8.06 | 0.000 | 0.00 |
| accumulate-32 | 0.0146 (0.38x) | 0.0240 (0.18x) | 0.0754 (1.91x) | – | 0.1663 | 19.75 | start 15 | +0.18 | – | – |
| ours (shipped defaults) | 0.0396 (1.04x) | 0.1376 (1.03x) | 0.0457 (1.16x) | – | 0.0892 | 25.54 | start 37 | +0.23 | – | – |

![G4-bistro-pan ao: raw | accumulate | ours | reference](crops/G4-bistro-pan-ao.png)
_crop strip, frame 28: raw | accumulate | ours | reference_

## G4-bistro-move (G4): Bistro, static camera, moving local light: shadows + diffuse

960x540, 48 frames, reference 1024 spp, static camera, events: start@0. _provisional (kept capture bistro-move: moving lantern; the golden 'light switching on' event is pending T0-scenes)_

| gate | ours | bar | result |
|---|---|---|---|
| calm: moving boil <= FFX | 0.0619 | <= 0.0417 (FFX) | FAIL |
| detail: FLIP < FFX | 0.0285 | < 0.1089 (FFX) | PASS |

### G4-bistro-move / visibility

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0007 | 0.0435 | – | 0.0000 | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.0232 (35.22x) | 0.4022 (9.25x) | – | 0.0001 | 0.0174 | 24.42 | start 45 | -1.05 | 0.000 | 0.00 |
| accumulate-32 | 0.0007 (1.11x) | 0.0132 (0.30x) | – | 0.0022 | 0.0744 | 17.96 | start – | +9.80 | – | – |
| ours (shipped defaults) | 0.0055 (8.31x) | 0.0619 (1.42x) | – | 0.0015 | 0.0285 | 24.38 | start 0 | +1.53 | – | – |
| FFX (MIT port) | 0.0041 (6.23x) | 0.0417 (0.96x) | – | 0.0061 | 0.1089 | 19.65 | start 0 | +6.77 | – | – |

![G4-bistro-move visibility: raw | accumulate | ours | ffx | reference](crops/G4-bistro-move-visibility.png)
_crop strip, frame 28: raw | accumulate | ours | ffx | reference_

### G4-bistro-move / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0059 | 0.0202 | – | 0.0070 | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1409 (23.85x) | 0.2195 (10.88x) | – | 0.1294 | 0.5500 | 17.10 | start 0 | -30.77 | 0.000 | 0.00 |
| accumulate-32 | 0.0060 (1.01x) | 0.0099 (0.49x) | – | 0.0173 | 0.2018 | 26.64 | start 33 | +0.33 | – | – |
| ours (shipped defaults) | 0.0052 (0.88x) | 0.0106 (0.53x) | – | 0.0072 | 0.0931 | 33.91 | start 5 | +0.35 | – | – |

![G4-bistro-move diffuse: raw | accumulate | ours | reference](crops/G4-bistro-move-diffuse.png)
_crop strip, frame 28: raw | accumulate | ours | reference_

## G4-bistro-hold (G4): Bistro, nothing moves: still-camera calm

960x540, 32 frames, reference 128 spp, static camera, events: start@0. _provisional (kept capture bistro-hold: static camera, 128-spp reference; still-camera sigma)_

### G4-bistro-hold / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0134 | 0.0271 | – | 0.0067 | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1479 (11.06x) | 0.1940 (7.16x) | – | 0.0427 | 0.6040 | 15.84 | start 0 | -37.53 | 0.000 | 0.00 |
| accumulate-32 | 0.0075 (0.56x) | 0.0099 (0.36x) | – | 0.0062 | 0.2497 | 23.91 | start 22 | -2.08 | – | – |
| ours (shipped defaults) | 0.0050 (0.37x) | 0.0073 (0.27x) | – | 0.0020 | 0.1533 | 30.42 | start 4 | +0.49 | – | – |

![G4-bistro-hold diffuse: raw | accumulate | ours | reference](crops/G4-bistro-hold-diffuse.png)
_crop strip, frame 19: raw | accumulate | ours | reference_

## corner-orbit: Corner scene, slow orbit

960x540, 40 frames, reference 1024 spp, moving camera, events: start@0. _kept capture three-orbit (the corner scene); native imported_

### corner-orbit / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0056 | 0.0732 | 0.0043 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1399 (25.02x) | 0.1824 (2.49x) | 0.1336 (30.85x) | – | 0.4461 | 16.88 | start 0 | -18.95 | 0.000 | 0.00 |
| accumulate-32 | 0.0080 (1.44x) | 0.0099 (0.14x) | 0.0368 (8.49x) | – | 0.0960 | 28.54 | start 20 | -0.34 | – | – |
| ours (shipped defaults) | 0.0042 (0.74x) | 0.0497 (0.68x) | 0.0039 (0.90x) | – | 0.0372 | 39.89 | start 2 | -0.24 | – | – |
| native reblur (imported) | – | – | – | – | 0.0780 | 32.93 | start 3 | – | 5.664 † | 5.85 † |
| native relax (imported) | – | – | – | – | 0.0563 | 37.59 | start 10 | – | 5.664 † | 5.85 † |

![corner-orbit diffuse: raw | accumulate | ours | reference](crops/corner-orbit-diffuse.png)
_crop strip, frame 24: raw | accumulate | ours | reference_

### corner-orbit / specular

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0030 | 0.0571 | 0.0045 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.0176 (5.86x) | 0.1117 (1.96x) | 0.0186 (4.09x) | – | 0.1378 | 34.79 | start 10 | -2.31 | 0.000 | 0.00 |
| accumulate-32 | 0.0009 (0.29x) | 0.0068 (0.12x) | 0.0045 (0.99x) | – | 0.0708 | 39.31 | start 1 | +1.33 | – | – |
| ours (shipped defaults) | 0.0025 (0.84x) | 0.0378 (0.66x) | 0.0035 (0.77x) | – | 0.0407 | 44.33 | start 24 | +0.83 | – | – |
| FFX (MIT port) | 0.0030 (0.99x) | 0.0213 (0.37x) | 0.0046 (1.02x) | – | 0.0707 | 39.12 | start 0 | +0.73 | – | – |
| native reblur (imported) | – | – | – | – | 0.0625 | 39.91 | start 0 | – | 5.664 † | 5.85 † |
| native relax (imported) | – | – | – | – | 0.0583 | 41.41 | start 4 | – | 5.664 † | 5.85 † |

![corner-orbit specular: raw | accumulate | ours | ffx | reference](crops/corner-orbit-specular.png)
_crop strip, frame 24: raw | accumulate | ours | ffx | reference_

### corner-orbit / visibility

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0147 | 0.0770 | 0.0122 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1546 (10.51x) | 0.4048 (5.26x) | 0.1415 (11.58x) | – | 0.1063 | 16.05 | start 0 | -6.86 | 0.000 | 0.00 |
| accumulate-32 | 0.0074 (0.50x) | 0.0217 (0.28x) | 0.0355 (2.91x) | – | 0.0398 | 26.03 | start 4 | +0.92 | – | – |
| ours (shipped defaults) | 0.0117 (0.79x) | 0.0652 (0.85x) | 0.0152 (1.25x) | – | 0.0195 | 33.63 | start 0 | +0.14 | – | – |
| FFX (MIT port) | 0.0065 (0.44x) | 0.0417 (0.54x) | 0.0135 (1.10x) | – | 0.0550 | 26.32 | start 0 | +0.18 | – | – |
| native sigma (imported) | – | – | – | – | 0.0493 | 24.93 | start 0 | – | 1.115 † | 1.41 † |

![corner-orbit visibility: raw | accumulate | ours | ffx | reference](crops/corner-orbit-visibility.png)
_crop strip, frame 24: raw | accumulate | ours | ffx | reference_

### corner-orbit / ao

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0096 | 0.1231 | 0.0095 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.2336 (24.40x) | 0.3822 (3.11x) | 0.2613 (27.53x) | – | 0.4222 | 12.52 | start 0 | -4.46 | 0.000 | 0.00 |
| accumulate-32 | 0.0115 (1.20x) | 0.0177 (0.14x) | 0.0686 (7.23x) | – | 0.0778 | 24.44 | start 14 | -0.42 | – | – |
| ours (shipped defaults) | 0.0067 (0.70x) | 0.0810 (0.66x) | 0.0099 (1.04x) | – | 0.0317 | 33.43 | start 1 | -0.12 | – | – |
| native reblur-occlusion (imported) | – | – | – | – | 0.1266 | 23.01 | start 6 | – | 5.664 † | 5.85 † |

![corner-orbit ao: raw | accumulate | ours | reference](crops/corner-orbit-ao.png)
_crop strip, frame 24: raw | accumulate | ours | reference_

## corner-pan: Corner scene, pan

960x540, 32 frames, reference 1024 spp, moving camera, events: start@0. _kept capture three-pan (the corner scene); native imported_

### corner-pan / diffuse

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0059 | 0.0886 | 0.0043 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1361 (23.18x) | 0.1819 (2.05x) | 0.1259 (29.58x) | – | 0.4394 | 17.09 | start 0 | -18.33 | 0.000 | 0.00 |
| accumulate-32 | 0.0097 (1.66x) | 0.0112 (0.13x) | 0.0391 (9.18x) | – | 0.1264 | 26.48 | start 6 | -0.92 | – | – |
| ours (shipped defaults) | 0.0041 (0.69x) | 0.0697 (0.79x) | 0.0027 (0.65x) | – | 0.0368 | 40.27 | start 3 | -0.28 | – | – |
| native reblur (imported) | – | – | – | – | 0.0714 | 33.18 | start 24 | – | 5.664 † | 5.85 † |
| native relax (imported) | – | – | – | – | 0.0510 | 38.73 | start 9 | – | 5.664 † | 5.85 † |

![corner-pan diffuse: raw | accumulate | ours | reference](crops/corner-pan-diffuse.png)
_crop strip, frame 19: raw | accumulate | ours | reference_

### corner-pan / specular

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0028 | 0.0311 | 0.0033 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.0162 (5.74x) | 0.0576 (1.85x) | 0.0126 (3.88x) | – | 0.1338 | 35.87 | start 4 | -1.99 | 0.000 | 0.00 |
| accumulate-32 | 0.0010 (0.36x) | 0.0039 (0.13x) | 0.0032 (0.97x) | – | 0.0800 | 37.22 | start 0 | +0.95 | – | – |
| ours (shipped defaults) | 0.0028 (1.00x) | 0.0284 (0.91x) | 0.0025 (0.76x) | – | 0.0399 | 46.11 | start 11 | +0.69 | – | – |
| FFX (MIT port) | 0.0030 (1.05x) | 0.0145 (0.47x) | 0.0031 (0.95x) | – | 0.0692 | 40.86 | start 0 | +0.59 | – | – |
| native reblur (imported) | – | – | – | – | 0.0596 | 41.65 | start 5 | – | 5.664 † | 5.85 † |
| native relax (imported) | – | – | – | – | 0.0566 | 42.67 | start 4 | – | 5.664 † | 5.85 † |

![corner-pan specular: raw | accumulate | ours | ffx | reference](crops/corner-pan-specular.png)
_crop strip, frame 19: raw | accumulate | ours | ffx | reference_

### corner-pan / visibility

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0156 | 0.1045 | 0.0064 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.1425 (9.15x) | 0.4068 (3.89x) | 0.0894 (13.93x) | – | 0.0867 | 16.79 | start 19 | -5.17 | 0.000 | 0.00 |
| accumulate-32 | 0.0088 (0.56x) | 0.0340 (0.32x) | 0.0252 (3.92x) | – | 0.0343 | 25.76 | start 6 | +0.51 | – | – |
| ours (shipped defaults) | 0.0115 (0.74x) | 0.0916 (0.88x) | 0.0083 (1.29x) | – | 0.0166 | 33.91 | start 0 | +0.17 | – | – |
| FFX (MIT port) | 0.0092 (0.59x) | 0.0625 (0.60x) | 0.0080 (1.25x) | – | 0.0407 | 27.87 | start 0 | -0.10 | – | – |
| native sigma (imported) | – | – | – | – | 0.0403 | 25.79 | start 9 | – | 1.115 † | 1.41 † |

![corner-pan visibility: raw | accumulate | ours | ffx | reference](crops/corner-pan-visibility.png)
_crop strip, frame 19: raw | accumulate | ours | ffx | reference_

### corner-pan / ao

| row | boil static | boil moving | boil disoccluded | still σ | FLIP ↓ | PSNR dB ↑ | lag (frames) ↓ | bias (8-bit levels) | GPU ms 1080p | wall ms 1080p |
|---|---|---|---|---|---|---|---|---|---|---|
| reference (its own noise) | 0.0092 | 0.1146 | 0.0070 | – | 0 | ∞ | – | 0 | – | – |
| raw 1-ray input | 0.2289 (24.78x) | 0.3551 (3.10x) | 0.2341 (33.63x) | – | 0.4135 | 12.74 | start 0 | -4.14 | 0.000 | 0.00 |
| accumulate-32 | 0.0136 (1.47x) | 0.0221 (0.19x) | 0.0658 (9.45x) | – | 0.0995 | 22.72 | start 5 | -0.42 | – | – |
| ours (shipped defaults) | 0.0068 (0.74x) | 0.0857 (0.75x) | 0.0072 (1.03x) | – | 0.0308 | 33.55 | start 15 | -0.11 | – | – |
| native reblur-occlusion (imported) | – | – | – | – | 0.1461 | 21.74 | start 2 | – | 5.664 † | 5.85 † |

![corner-pan ao: raw | accumulate | ours | reference](crops/corner-pan-ao.png)
_crop strip, frame 19: raw | accumulate | ours | reference_

## Notes

- Boil: RMS of the second temporal difference x_t − 2x_(t−1) + x_(t−2) along the reprojected history, / √6, on tonemapped values (Reinhard per channel for rgb, clamp for visibility / AO). Regions (per pixel and frame, ≥ 8 frames after a reset): **moving** = the reference changed by > 0.05 along its history within 4 frames; **disoccluded** = history age 2..6 frames; **static** = the rest. "×" = ratio to the reference's own boil in the same pixels (the reference is a 1024–2048-spp accumulation, so it has noise of its own).
- Native rows are **imported** from `docs/research/rt-denoiser/native/results/*/score-captures.json` (default settings, RTX 3060 Laptop): FLIP, PSNR and lag (from per-frame PSNR) are comparable; boil regions, σ and bias need the native outputs (set `RT_NATIVE_OUTPUTS`). † = timed on the Windows RTX, not this GPU.
- Cost "GPU ms" for `ours diffuse+specular` is the joint dispatch; the same figure is shown on both signals.
