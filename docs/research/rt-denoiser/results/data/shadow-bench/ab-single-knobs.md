### std540 (7 captures, vs sb-ship)

| variant | pooled dB | Δ mean | Δ worst (capture) | FLIP Δ | boil Δ | boil clause worst | dyn boil clause worst | static-pen boil clause worst | region boil clause worst | flicker share static | > 0.04 | Δ static (worst) | dynamic | Δ dyn | edge / soft / contact / changing dB | trail | lag | sharpness | GPU Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sb-ship | 37.03 | +0.000 | +0.000 (std540-orbit) | +0 % | +0 % | 0 | 0 | 0 | 0 | 0.993 % | 0.461 % | +0 % (+0 % std540-orbit) | 18.403 % | +0 % | 26.58 / 30.98 / 22.03 / 23.49 | 0.017 | – | 0.965 | +0 % |
| sb-hs0 | 36.90 | -0.132 | -0.509 (std540-light) | +0 % | -1 % | +0 % (std540-pan) | 0 | 0 | +2 % (contact, std540-pan) | 0.984 % | 0.454 % | -1 % (+0 % std540-pan) | 18.208 % | -1 % | 26.32 / 30.98 / 21.61 / 23.38 | 0.018 | – | 0.964 | -23 % |
| sb-al0 | 36.03 | -1.004 | -4.593 (std540-light) | +6 % | -16 % | 0 | 0 | 0 | +1 % (changing, std540-object) | 0.792 % | 0.336 % | -17 % (-6 % std540-pan) | 15.676 % | -15 % | 26.10 / 30.09 / 21.92 / 22.14 | 0.028 | – | 0.960 | -31 % |
| sb-al8 | 36.90 | -0.130 | -1.009 (std540-light) | +0 % | -9 % | 0 | +0 % (std540-object) | 0 | +6 % (changing, std540-object) | 0.850 % | 0.374 % | -13 % (-4 % std540-pan) | 17.110 % | -8 % | 26.63 / 30.85 / 22.09 / 23.21 | 0.020 | – | 0.964 | -20 % |
| sb-cs08 | 36.06 | -0.965 | -4.834 (std540-light) | +3 % | -15 % | 0 | +0 % (std540-object) | 0 | +28 % (changing, std540-object) | 0.762 % | 0.312 % | -20 % (-11 % std540-pan) | 16.747 % | -10 % | 26.48 / 29.96 / 22.05 / 21.88 | 0.030 | – | 0.969 | -24 % |
| sb-alh2 | 36.65 | -0.383 | -2.031 (std540-light) | +1 % | -14 % | 0 | 0 | 0 | 0 | 0.829 % | 0.352 % | -14 % (-5 % std540-pan) | 16.569 % | -10 % | 26.46 / 30.69 / 22.04 / 22.74 | 0.025 | – | 0.962 | -17 % |

### real (11 captures, vs sb-ship)

| variant | pooled dB | Δ mean | Δ worst (capture) | FLIP Δ | boil Δ | boil clause worst | dyn boil clause worst | static-pen boil clause worst | region boil clause worst | flicker share static | > 0.04 | Δ static (worst) | dynamic | Δ dyn | edge / soft / contact / changing dB | trail | lag | sharpness | GPU Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sb-ship | 30.88 | +0.000 | +0.000 (three-knot-static) | +0 % | +0 % | 0 | 0 | 0 | 0 | 1.477 % | 0.912 % | +0 % (+0 % three-knot-static) | 18.825 % | +0 % | 19.56 / 29.70 / 16.92 / 17.46 | 0.035 | – | 0.838 | +0 % |
| sb-hs0 | 29.87 | -1.006 | -1.705 (bistro-orbit) | +4 % | +5 % | +23 % (three-pan) | 0 | 0 | +34 % (contact, three-pan) | 1.412 % | 0.858 % | -7 % (+0 % sponza-pan) | 16.425 % | -12 % | 18.47 / 29.67 / 15.66 / 16.28 | 0.041 | – | 0.823 | -17 % |
| sb-al0 | 30.53 | -0.354 | -0.834 (three-knot-static) | +2 % | -5 % | +1 % (bistro-pan) | 0 | +0 % (bistro-move) | +30 % (changing, sponza-move) | 1.412 % | 0.875 % | -9 % (+3 % bistro-move) | 17.377 % | -9 % | 19.08 / 29.32 / 16.66 / 17.01 | 0.043 | – | 0.829 | -17 % |
| sb-al8 | 30.81 | -0.068 | -0.201 (three-knot-static) | +0 % | -4 % | 0 | 0 | 0 | 0 | 1.424 % | 0.878 % | -7 % (+1 % bistro-move) | 17.972 % | -6 % | 19.45 / 29.64 / 16.90 / 17.35 | 0.037 | – | 0.835 | -17 % |
| sb-cs08 | 30.98 | +0.096 | -0.329 (bistro-move) | -4 % | -5 % | 0 | 0 | 0 | +18 % (changing, sponza-move) | 1.361 % | 0.848 % | -13 % (-2 % bistro-orbit) | 17.866 % | -7 % | 19.74 / 29.51 / 17.16 / 17.04 | 0.044 | – | 0.848 | -20 % |
| sb-alh2 | 30.73 | -0.153 | -0.367 (three-knot-static) | +0 % | -5 % | +0 % (bistro-pan) | 0 | 0 | +15 % (changing, sponza-move) | 1.431 % | 0.883 % | -7 % (+4 % bistro-move) | 17.865 % | -6 % | 19.30 / 29.71 / 16.78 / 17.24 | 0.040 | – | 0.832 | -15 % |

### motion (8 captures, vs sb-ship)

| variant | pooled dB | Δ mean | Δ worst (capture) | FLIP Δ | boil Δ | boil clause worst | dyn boil clause worst | static-pen boil clause worst | region boil clause worst | flicker share static | > 0.04 | Δ static (worst) | dynamic | Δ dyn | edge / soft / contact / changing dB | trail | lag | sharpness | GPU Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sb-ship | 34.89 | +0.000 | +0.000 (sm-hard-camera) | +0 % | +0 % | 0 | 0 | 0 | 0 | 0.993 % | 0.514 % | +0 % (+0 % sm-hard-camera) | 26.047 % | +0 % | 24.70 / 27.19 / 22.01 / 17.48 | 0.072 | – | 0.950 | +0 % |
| sb-hs0 | 34.33 | -0.569 | -3.210 (sm-hard-light) | +4 % | -18 % | +13 % (sm-hard-light) | 0 | 0 | +52 % (contact, sm-hard-light) | 0.730 % | 0.324 % | -25 % (-10 % sm-sun-camera) | 23.820 % | -10 % | 24.06 / 27.24 / 20.53 / 16.18 | 0.085 | – | 0.938 | +9 % |
| sb-al0 | 34.37 | -0.523 | -2.207 (sm-sun-light) | +4 % | -13 % | +10 % (sm-hard-light) | 0 | 0 | +18 % (changing, sm-hard-light) | 0.801 % | 0.396 % | -20 % (-0 % sm-hard-light) | 23.826 % | -11 % | 24.22 / 26.68 / 21.81 / 16.40 | 0.093 | – | 0.944 | +9 % |
| sb-al8 | 34.75 | -0.146 | -1.391 (sm-sun-light) | +1 % | -11 % | 0 | 0 | 0 | +1 % (changing, sm-hard-light) | 0.828 % | 0.409 % | -18 % (-3 % sm-hard-camera) | 24.505 % | -8 % | 24.58 / 27.27 / 21.91 / 17.05 | 0.078 | – | 0.947 | +9 % |
| sb-cs08 | 34.77 | -0.128 | -3.124 (sm-sun-light) | -5 % | -13 % | +11 % (sm-hard-light) | 0 | 0 | +22 % (changing, sm-hard-light) | 0.754 % | 0.373 % | -25 % (-8 % sm-hard-camera) | 24.175 % | -10 % | 24.68 / 26.69 / 22.38 / 16.23 | 0.094 | – | 0.956 | +8 % |
| sb-alh2 | 34.67 | -0.224 | -1.332 (sm-hard-light) | +2 % | -11 % | +5 % (sm-hard-light) | 0 | 0 | +10 % (changing, sm-hard-light) | 0.860 % | 0.418 % | -14 % (+1 % sm-hard-light) | 24.774 % | -6 % | 24.48 / 27.06 / 21.89 / 16.84 | 0.086 | – | 0.946 | +9 % |

