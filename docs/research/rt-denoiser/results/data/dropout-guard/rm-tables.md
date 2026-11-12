| path | marker | image motion px/f | surface reproj. err px | virtual (R-9) err px | ref vs oracle px | multi-image frames |
|---|---|---|---|---|---|---|
| rm-cam-plane | 1 | 1.31 | 1.36 | 0.16 | 0.06 | 0 |
| rm-cam-plane | 2 | 5.85 | 6.20 | 0.05 | 0.02 | 0 |
| rm-bump-plane | 1 | 1.31 | 1.36 | 0.16 | 6.01 | 0 |
| rm-bump-plane | 2 | 5.85 | 6.20 | 0.05 | 3.97 | 0 |
| rm-graze-plane | 1 | 4.04 | 2.23 | 0.14 | 0.10 | 0 |
| rm-graze-plane | 2 | 1.32 | 6.37 | 0.05 | 0.10 | 0 |
| rm-obj-plane | 1 | 6.20 | 6.20 | 6.20 | 0.06 | 0 |
| rm-obj-plane | 2 | 0.00 | 0.00 | 0.00 | 0.01 | 0 |
| rm-obj-exit | 1 | 6.40 | 6.40 | 6.40 | 0.20 | 0 |
| rm-obj-exit | 2 | 0.00 | 0.00 | 0.00 | 0.01 | 0 |
| rm-refl-slide | 1 | 0.00 | 5.61 | 0.00 | 0.07 | 0 |
| rm-refl-slide | 2 | 0.00 | 5.89 | 0.00 | 0.01 | 0 |
| rm-refl-turn | 1 | 0.98 | 0.94 | 0.98 | 0.04 | 0 |
| rm-refl-turn | 2 | 4.11 | 4.10 | 4.11 | 0.02 | 0 |
| rm-cam-convex | 1 | 1.38 | 0.99 | 0.07 | 0.09 | 0 |
| rm-cam-convex | 2 | 1.16 | 1.35 | 0.02 | 0.09 | 0 |
| rm-obj-convex | 1 | 3.50 | 3.50 | 3.50 | 0.05 | 0 |
| rm-obj-convex | 2 | 0.00 | 0.00 | 0.00 | 0.23 | 0 |
| rm-refl-ball | 1 | 3.25 | 1.39 | 3.25 | 0.08 | 0 |
| rm-refl-ball | 2 | 3.96 | 0.78 | 3.96 | 0.15 | 0 |
| rm-cam-concave | 1 | 1.03 | 1.05 | 0.15 | 1.12 | 0 |
| rm-cam-concave | 2 | 3.45 | 3.45 | 6.18 | 0.07 | 0 |
| rm-cut-plane | 1 | 1.29 | 1.38 | 0.16 | 0.08 | 0 |
| rm-cut-plane | 2 | 5.91 | 6.16 | 0.05 | 0.03 | 0 |

| path | checked px | non-reflector | view z abs (max) | normal deg (max) | motion px (max) | mirror hit dist rel (max) |
|---|---|---|---|---|---|---|
| rm-cam-plane | 144 | 0 | 0.0000 | 0.000 | 0.000 | 0.0030 |
| rm-bump-plane | 144 | 0 | 0.0000 | 0.000 | 0.000 | – |
| rm-graze-plane | 138 | 0 | 0.0000 | 0.000 | 0.000 | 0.0020 |
| rm-obj-plane | 144 | 0 | 0.0000 | 0.000 | 0.000 | 0.0040 |
| rm-obj-exit | 95 | 0 | 0.0000 | 0.000 | 0.000 | 0.0040 |
| rm-refl-slide | 142 | 0 | 0.0000 | 0.000 | 0.000 | 0.0040 |
| rm-refl-turn | 144 | 0 | 0.0000 | 0.002 | 0.000 | 0.0060 |
| rm-cam-convex | 144 | 0 | 0.0000 | 0.011 | 0.000 | 0.0110 |
| rm-obj-convex | 144 | 0 | 0.0000 | 0.020 | 0.000 | 0.0090 |
| rm-refl-ball | 144 | 0 | 0.0000 | 0.012 | 0.000 | 0.0060 |
| rm-cam-concave | 144 | 0 | 0.0000 | 0.007 | 0.000 | 0.0200 |
| rm-cut-plane | 144 | 0 | 0.0000 | 0.000 | 0.000 | 0.0030 |

| path | m | denoiser | ROI dB moving | ROI dB hold | settled | pos err px | lag px | trail px | ghost | dup frames | ghost @stop+1 | recovery f | ghost gone f |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rm-cam-plane | 1 | noisy | 28.77 | 29.46 | 29.48 | 0.08 | -0.02 | 0.0 | 0.001 | 0/40 | 0.000 | 28 | – |
| rm-cam-plane | 1 | recurrent | 25.40 | 31.47 | 34.82 | 0.46 | -0.44 | 1.0 | 0.004 | 0/40 | 0.004 | 23 | – |
| rm-cam-plane | 1 | recurrent@r.dropoutGuard=true | 23.98 | 28.41 | 30.14 | 0.19 | -0.13 | 1.0 | 0.011 | 2/40 | 0.010 | 12 | – |
| rm-cam-plane | 1 | ffx-reflections | 20.50 | 23.31 | 23.62 | 2.21 | 1.53 | 0.0 | 0.037 | 0/40 | 0.023 | 4 | – |
| rm-cam-plane | 2 | noisy | 25.68 | 24.30 | 24.28 | 0.19 | -0.00 | 2.1 | 0.007 | 0/40 | 0.000 | 0 | – |
| rm-cam-plane | 2 | recurrent | 19.44 | 26.60 | 30.47 | 5.41 | 5.36 | 2.9 | 0.338 | 7/40 | 0.230 | 13 | – |
| rm-cam-plane | 2 | recurrent@r.dropoutGuard=true | 19.65 | 27.00 | 31.12 | 5.83 | 5.80 | 2.9 | 0.323 | 10/40 | 0.217 | 23 | – |
| rm-cam-plane | 2 | ffx-reflections | 23.42 | 23.24 | 23.14 | 1.98 | 1.93 | 0.0 | 0.010 | 9/40 | 0.002 | 0 | – |
| rm-bump-plane | 1 | noisy | 28.74 | 29.07 | 29.24 | 6.64 | -1.24 | 0.0 | 0.000 | 0/40 | 0.000 | 31 | – |
| rm-bump-plane | 1 | recurrent | 23.35 | 28.81 | 33.51 | 6.55 | -1.35 | 1.0 | 0.000 | 0/40 | 0.000 | 23 | – |
| rm-bump-plane | 1 | recurrent@r.dropoutGuard=true | 22.49 | 24.79 | 25.10 | 6.96 | -1.97 | 1.1 | 0.000 | 0/40 | 0.000 | 2 | – |
| rm-bump-plane | 1 | ffx-reflections | 19.47 | 19.71 | 19.71 | 11.57 | -3.15 | 0.9 | 0.004 | 0/40 | 0.008 | 0 | – |
| rm-bump-plane | 2 | noisy | 30.90 | 31.89 | 31.47 | 4.99 | 0.30 | 0.0 | 0.017 | 8/40 | 0.086 | 25 | – |
| rm-bump-plane | 2 | recurrent | 26.52 | 30.25 | 33.39 | 4.60 | 0.06 | 2.2 | 0.032 | 11/40 | 0.158 | 25 | – |
| rm-bump-plane | 2 | recurrent@r.dropoutGuard=true | 27.22 | 31.14 | 33.90 | 5.04 | 0.79 | 1.8 | 0.021 | 2/40 | 0.130 | 25 | – |
| rm-bump-plane | 2 | ffx-reflections | 24.83 | 25.89 | 25.93 | – | – | – | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-graze-plane | 1 | noisy | 25.64 | 24.35 | 24.20 | 0.12 | -0.05 | 0.6 | 0.001 | 0/40 | 0.001 | 0 | – |
| rm-graze-plane | 1 | recurrent | 20.64 | 26.84 | 30.02 | 0.38 | -0.17 | 13.3 | 0.019 | 11/40 | 0.014 | 31 | – |
| rm-graze-plane | 1 | recurrent@r.dropoutGuard=true | 19.97 | 23.58 | 29.86 | 0.73 | -0.64 | 14.4 | 0.026 | 17/40 | 0.069 | 16 | – |
| rm-graze-plane | 1 | ffx-reflections | 19.42 | 21.19 | 22.00 | 2.05 | -0.98 | 4.8 | 0.016 | 1/40 | 0.014 | 8 | – |
| rm-graze-plane | 2 | noisy | 24.59 | 24.37 | 24.23 | 0.22 | -0.14 | 3.0 | 0.006 | 0/35 | 0.006 | 0 | – |
| rm-graze-plane | 2 | recurrent | 19.99 | 25.96 | 30.95 | 2.13 | -2.13 | 16.1 | 0.122 | 9/35 | 0.177 | 24 | – |
| rm-graze-plane | 2 | recurrent@r.dropoutGuard=true | 20.16 | 26.26 | 32.16 | 2.48 | -2.48 | 16.4 | 0.120 | 12/35 | 0.176 | 24 | – |
| rm-graze-plane | 2 | ffx-reflections | 22.40 | 24.91 | 25.41 | 2.20 | -1.96 | 5.4 | 0.018 | 0/35 | 0.016 | 6 | – |
| rm-obj-plane | 1 | noisy | 28.63 | 28.53 | 28.49 | 0.09 | 0.01 | 0.1 | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-obj-plane | 1 | recurrent | 24.35 | 31.94 | 32.75 | 0.92 | -0.92 | 10.7 | 0.011 | 0/40 | 0.001 | 19 | – |
| rm-obj-plane | 1 | recurrent@r.dropoutGuard=true | 21.60 | 28.85 | 30.18 | 1.95 | -1.94 | 6.3 | 0.013 | 0/40 | 0.001 | 10 | – |
| rm-obj-plane | 1 | ffx-reflections | 18.31 | 23.00 | 23.92 | 5.04 | -4.79 | 8.9 | 0.026 | 0/40 | 0.010 | 8 | – |
| rm-obj-plane | 2 | noisy | 25.82 | 25.94 | 25.77 | 0.18 | 0.03 | 1.0 | 0.006 | 0/40 | 0.008 | 0 | – |
| rm-obj-plane | 2 | recurrent | 31.70 | 32.34 | 31.82 | 0.12 | 0.02 | 1.1 | 0.005 | 0/40 | 0.006 | 26 | – |
| rm-obj-plane | 2 | recurrent@r.dropoutGuard=true | 32.13 | 32.97 | 32.48 | 0.11 | 0.03 | 1.1 | 0.005 | 0/40 | 0.006 | 26 | – |
| rm-obj-plane | 2 | ffx-reflections | 24.54 | 24.41 | 24.40 | 0.37 | 0.35 | 0.0 | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-obj-exit | 1 | noisy | 28.30 | – | – | 0.22 | -0.11 | 0.1 | 0.000 | 0/22 | – | – | 1 |
| rm-obj-exit | 1 | recurrent | 24.14 | – | – | 1.05 | -1.05 | 15.8 | 0.013 | 0/22 | – | – | 1 |
| rm-obj-exit | 1 | recurrent@r.dropoutGuard=true | 21.47 | – | – | 2.03 | -2.03 | 6.7 | 0.014 | 0/22 | – | – | 1 |
| rm-obj-exit | 1 | ffx-reflections | 18.05 | – | – | 5.12 | -4.93 | 9.1 | 0.027 | 0/22 | – | – | 1 |
| rm-obj-exit | 2 | noisy | 25.82 | 25.94 | 25.77 | 0.18 | 0.03 | 1.0 | 0.006 | 0/40 | 0.008 | 0 | – |
| rm-obj-exit | 2 | recurrent | 31.70 | 32.34 | 31.82 | 0.12 | 0.02 | 1.1 | 0.005 | 0/40 | 0.006 | 26 | – |
| rm-obj-exit | 2 | recurrent@r.dropoutGuard=true | 32.13 | 32.97 | 32.48 | 0.11 | 0.03 | 1.1 | 0.005 | 0/40 | 0.006 | 26 | – |
| rm-obj-exit | 2 | ffx-reflections | 24.54 | 24.41 | 24.40 | 0.37 | 0.35 | 0.0 | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-refl-slide | 1 | noisy | 28.11 | 27.45 | 27.67 | 0.11 | -0.06 | 0.3 | 0.001 | 0/40 | 0.000 | 12 | – |
| rm-refl-slide | 1 | recurrent | 26.02 | 31.70 | 34.61 | 0.59 | 0.59 | 0.3 | 0.001 | 0/40 | 0.000 | 27 | – |
| rm-refl-slide | 1 | recurrent@r.dropoutGuard=true | 26.03 | 29.73 | 30.06 | 0.84 | 0.84 | 0.0 | 0.001 | 0/40 | 0.000 | 2 | – |
| rm-refl-slide | 1 | ffx-reflections | 23.67 | 22.73 | 22.71 | 0.86 | -0.13 | 0.0 | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-refl-slide | 2 | noisy | 25.69 | 25.94 | 25.77 | 0.18 | 0.00 | 1.0 | 0.006 | 0/39 | 0.008 | 0 | – |
| rm-refl-slide | 2 | recurrent | 27.91 | 32.18 | 31.84 | 1.12 | 1.10 | 1.0 | 0.008 | 2/39 | 0.006 | 26 | – |
| rm-refl-slide | 2 | recurrent@r.dropoutGuard=true | 27.69 | 32.49 | 32.45 | 1.16 | 1.15 | 1.0 | 0.008 | 3/39 | 0.006 | 26 | – |
| rm-refl-slide | 2 | ffx-reflections | 24.22 | 24.41 | 24.40 | 0.47 | 0.46 | 0.0 | 0.000 | 0/39 | 0.000 | 0 | – |
| rm-refl-turn | 1 | noisy | 28.76 | 28.79 | 28.66 | 0.09 | 0.05 | 0.2 | 0.000 | 0/40 | 0.000 | 20 | – |
| rm-refl-turn | 1 | recurrent | 25.85 | 31.87 | 34.01 | 0.84 | -0.84 | 1.6 | 0.000 | 0/40 | 0.000 | 22 | – |
| rm-refl-turn | 1 | recurrent@r.dropoutGuard=true | 23.01 | 27.74 | 29.49 | 1.73 | -1.72 | 2.0 | 0.000 | 0/40 | 0.000 | 17 | – |
| rm-refl-turn | 1 | ffx-reflections | 20.14 | 23.65 | 24.22 | 3.58 | -3.29 | 4.5 | 0.015 | 0/40 | 0.008 | 6 | – |
| rm-refl-turn | 2 | noisy | 25.72 | 25.82 | 25.72 | 0.18 | -0.01 | 1.2 | 0.007 | 0/40 | 0.000 | 30 | – |
| rm-refl-turn | 2 | recurrent | 22.17 | 28.82 | 31.79 | 2.71 | -2.70 | 20.2 | 0.101 | 24/40 | 0.151 | 30 | – |
| rm-refl-turn | 2 | recurrent@r.dropoutGuard=true | 21.51 | 28.88 | 32.40 | 3.52 | -3.52 | 20.7 | 0.122 | 26/40 | 0.142 | 30 | – |
| rm-refl-turn | 2 | ffx-reflections | 21.50 | 23.59 | 24.06 | 3.75 | -3.74 | 3.1 | 0.005 | 0/40 | 0.002 | 5 | – |
| rm-cam-convex | 1 | noisy | 26.71 | 29.56 | 29.24 | 0.08 | -0.01 | 0.0 | 0.000 | 0/40 | 0.000 | 27 | – |
| rm-cam-convex | 1 | recurrent | 21.37 | 26.90 | 32.15 | 0.43 | 0.42 | 0.6 | 0.000 | 0/40 | 0.000 | 24 | – |
| rm-cam-convex | 1 | recurrent@r.dropoutGuard=true | 20.92 | 23.70 | 24.48 | 0.51 | 0.50 | 0.8 | 0.000 | 0/40 | 0.000 | 9 | – |
| rm-cam-convex | 1 | ffx-reflections | 17.04 | 18.37 | 18.22 | 0.48 | 0.27 | 0.0 | 0.000 | 0/40 | 0.001 | 0 | – |
| rm-cam-convex | 2 | noisy | 32.07 | 31.97 | 33.38 | 0.22 | 0.00 | 0.1 | 0.000 | 0/40 | 0.151 | 30 | – |
| rm-cam-convex | 2 | recurrent | 29.42 | 33.03 | 34.46 | 0.54 | 0.53 | 0.1 | 0.000 | 0/40 | 0.118 | 14 | – |
| rm-cam-convex | 2 | recurrent@r.dropoutGuard=true | 29.66 | 34.73 | 37.13 | 0.57 | 0.56 | 0.2 | 0.000 | 0/40 | 0.084 | 21 | – |
| rm-cam-convex | 2 | ffx-reflections | 24.24 | 24.62 | 24.66 | – | – | – | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-obj-convex | 1 | noisy | 26.78 | 27.86 | 28.06 | 0.10 | 0.00 | 0.0 | 0.000 | 0/40 | 0.000 | 27 | – |
| rm-obj-convex | 1 | recurrent | 20.84 | 28.70 | 30.26 | 0.62 | -0.62 | 3.5 | 0.005 | 0/40 | 0.002 | 22 | – |
| rm-obj-convex | 1 | recurrent@r.dropoutGuard=true | 17.41 | 22.70 | 23.66 | 1.56 | -1.55 | 3.8 | 0.009 | 0/40 | 0.001 | 10 | – |
| rm-obj-convex | 1 | ffx-reflections | 14.25 | 16.08 | 16.33 | 2.40 | -2.39 | 1.6 | 0.002 | 0/40 | 0.003 | 2 | – |
| rm-obj-convex | 2 | noisy | 30.79 | 31.05 | 31.27 | 0.28 | -0.13 | 0.0 | 0.000 | 0/40 | 0.000 | 31 | – |
| rm-obj-convex | 2 | recurrent | 35.48 | 35.26 | 34.06 | 0.21 | -0.12 | 0.0 | 0.000 | 0/40 | 0.000 | 24 | – |
| rm-obj-convex | 2 | recurrent@r.dropoutGuard=true | 37.21 | 38.49 | 36.24 | 0.23 | -0.15 | 0.0 | 0.000 | 0/40 | 0.000 | 24 | – |
| rm-obj-convex | 2 | ffx-reflections | 24.34 | 24.33 | 24.33 | – | – | – | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-refl-ball | 1 | noisy | 27.07 | 25.96 | 26.07 | 0.10 | -0.02 | 0.0 | 0.000 | 0/40 | 0.000 | 30 | – |
| rm-refl-ball | 1 | recurrent | 21.29 | 29.00 | 30.09 | 0.35 | 0.33 | 0.9 | 0.000 | 0/40 | 0.000 | 30 | – |
| rm-refl-ball | 1 | recurrent@r.dropoutGuard=true | 21.72 | 25.76 | 26.20 | 0.26 | 0.11 | 1.0 | 0.000 | 0/40 | 0.003 | 4 | – |
| rm-refl-ball | 1 | ffx-reflections | 16.98 | 16.63 | 16.55 | 1.31 | 0.88 | 0.0 | 0.002 | 0/40 | 0.001 | 0 | – |
| rm-refl-ball | 2 | noisy | 31.81 | 32.13 | 31.24 | 0.23 | -0.03 | 0.0 | 0.000 | 0/40 | 0.000 | 25 | – |
| rm-refl-ball | 2 | recurrent | 29.63 | 35.44 | 35.19 | 0.42 | 0.38 | 0.0 | 0.000 | 0/40 | 0.000 | 25 | – |
| rm-refl-ball | 2 | recurrent@r.dropoutGuard=true | 28.55 | 36.58 | 39.23 | 0.70 | 0.70 | 0.0 | 0.000 | 0/40 | 0.000 | 25 | – |
| rm-refl-ball | 2 | ffx-reflections | 24.22 | 24.09 | 24.13 | – | – | – | 0.000 | 0/40 | 0.000 | 0 | – |
| rm-cam-concave | 1 | noisy | 21.96 | 22.75 | 22.60 | 0.67 | -0.23 | 1.6 | 0.001 | 0/40 | 0.001 | 0 | – |
| rm-cam-concave | 1 | recurrent | 24.99 | 28.61 | 28.84 | 1.01 | -0.70 | 2.2 | 0.001 | 0/40 | 0.001 | 29 | – |
| rm-cam-concave | 1 | recurrent@r.dropoutGuard=true | 25.36 | 29.62 | 30.89 | 0.74 | -0.36 | 1.0 | 0.000 | 0/40 | 0.000 | 12 | – |
| rm-cam-concave | 1 | ffx-reflections | 20.01 | 21.97 | 21.87 | 1.75 | -1.42 | 0.1 | 0.003 | 0/40 | 0.001 | 0 | – |
| rm-cam-concave | 2 | noisy | 18.84 | 18.79 | 18.68 | 0.18 | -0.00 | 9.4 | 0.013 | 2/40 | 0.012 | 0 | – |
| rm-cam-concave | 2 | recurrent | 18.54 | 23.72 | 24.82 | 2.01 | -2.00 | 20.4 | 0.039 | 29/40 | 0.039 | 6 | – |
| rm-cam-concave | 2 | recurrent@r.dropoutGuard=true | 18.22 | 24.06 | 25.68 | 2.94 | -2.93 | 21.3 | 0.036 | 26/40 | 0.034 | 7 | – |
| rm-cam-concave | 2 | ffx-reflections | 16.14 | 20.56 | 21.09 | 7.18 | -6.67 | 10.9 | 0.037 | 0/40 | 0.015 | 5 | – |
| rm-cut-plane | 1 | noisy | 28.63 | 28.63 | 28.95 | 0.08 | -0.01 | 0.0 | 0.000 | 0/35 | 0.000 | 22 | – |
| rm-cut-plane | 1 | recurrent | 25.37 | 32.18 | 33.12 | 0.46 | -0.44 | 1.0 | 0.004 | 0/35 | 0.000 | 22 | – |
| rm-cut-plane | 1 | recurrent@r.dropoutGuard=true | 23.90 | 31.15 | 30.75 | 0.19 | -0.12 | 1.0 | 0.011 | 2/35 | 0.000 | 1 | – |
| rm-cut-plane | 1 | ffx-reflections | 20.48 | 23.73 | 23.76 | 2.18 | 1.52 | 0.0 | 0.036 | 0/35 | 0.001 | 0 | – |
| rm-cut-plane | 2 | noisy | 25.76 | 23.79 | 23.76 | 0.19 | -0.01 | 2.2 | 0.007 | 0/35 | 0.011 | 0 | – |
| rm-cut-plane | 2 | recurrent | 19.51 | 29.08 | 29.98 | 5.38 | 5.32 | 3.0 | 0.337 | 6/35 | 0.011 | 33 | – |
| rm-cut-plane | 2 | recurrent@r.dropoutGuard=true | 19.72 | 29.42 | 30.38 | 5.79 | 5.76 | 3.0 | 0.322 | 8/35 | 0.011 | 33 | – |
| rm-cut-plane | 2 | ffx-reflections | 23.48 | 24.04 | 23.75 | 1.99 | 1.93 | 0.0 | 0.010 | 9/35 | 0.000 | 0 | – |

| path | denoiser | pooled dB | reflector bin dB | dynamic dB | FLIP | flicker (mc) |
|---|---|---|---|---|---|---|
| rm-cam-plane | noisy | 18.49 | 33.30 | 16.16 | 0.3329 | 0.1055 |
| rm-cam-plane | recurrent | 31.85 | 30.53 | 23.02 | 0.0849 | 0.0089 |
| rm-cam-plane | recurrent@r.dropoutGuard=true | 31.78 | 30.30 | 22.98 | 0.0851 | 0.0089 |
| rm-cam-plane | ffx-reflections | 27.33 | 29.87 | 19.16 | 0.1486 | 0.0098 |
| rm-bump-plane | noisy | 18.50 | 33.88 | 15.24 | 0.3328 | 0.1055 |
| rm-bump-plane | recurrent | 32.12 | 31.50 | 21.81 | 0.0869 | 0.0090 |
| rm-bump-plane | recurrent@r.dropoutGuard=true | 32.00 | 31.06 | 21.63 | 0.0871 | 0.0090 |
| rm-bump-plane | ffx-reflections | 26.93 | 27.41 | 17.65 | 0.1534 | 0.0100 |
| rm-graze-plane | noisy | 20.37 | 35.50 | 17.33 | 0.2293 | 0.0714 |
| rm-graze-plane | recurrent | 33.06 | 33.27 | 22.46 | 0.0691 | 0.0073 |
| rm-graze-plane | recurrent@r.dropoutGuard=true | 32.81 | 32.72 | 22.50 | 0.0693 | 0.0073 |
| rm-graze-plane | ffx-reflections | 29.38 | 32.63 | 19.94 | 0.1059 | 0.0082 |
| rm-obj-plane | noisy | 18.62 | 33.71 | 15.45 | 0.3267 | 0.1024 |
| rm-obj-plane | recurrent | 33.57 | 35.75 | 23.70 | 0.0790 | 0.0028 |
| rm-obj-plane | recurrent@r.dropoutGuard=true | 33.21 | 33.77 | 22.38 | 0.0792 | 0.0029 |
| rm-obj-plane | ffx-reflections | 27.75 | 29.49 | 18.19 | 0.1408 | 0.0031 |
| rm-obj-exit | noisy | 18.66 | 34.33 | 16.04 | 0.3265 | 0.1022 |
| rm-obj-exit | recurrent | 33.79 | 37.46 | 25.34 | 0.0803 | 0.0027 |
| rm-obj-exit | recurrent@r.dropoutGuard=true | 33.62 | 36.08 | 24.39 | 0.0804 | 0.0028 |
| rm-obj-exit | ffx-reflections | 28.21 | 31.66 | 20.10 | 0.1414 | 0.0030 |
| rm-refl-slide | noisy | 18.60 | 33.53 | 23.59 | 0.3258 | 0.1020 |
| rm-refl-slide | recurrent | 33.21 | 35.80 | 23.86 | 0.0846 | 0.0020 |
| rm-refl-slide | recurrent@r.dropoutGuard=true | 33.18 | 35.61 | 23.72 | 0.0847 | 0.0020 |
| rm-refl-slide | ffx-reflections | 27.69 | 31.89 | 20.85 | 0.1458 | 0.0022 |
| rm-refl-turn | noisy | 18.59 | 33.55 | 20.93 | 0.3276 | 0.1027 |
| rm-refl-turn | recurrent | 32.81 | 32.85 | 18.65 | 0.0831 | 0.0018 |
| rm-refl-turn | recurrent@r.dropoutGuard=true | 32.45 | 31.54 | 17.74 | 0.0833 | 0.0018 |
| rm-refl-turn | ffx-reflections | 27.50 | 29.45 | 16.94 | 0.1466 | 0.0019 |
| rm-cam-convex | noisy | 18.61 | 40.43 | 17.14 | 0.3419 | 0.1116 |
| rm-cam-convex | recurrent | 35.32 | 37.19 | 24.86 | 0.0798 | 0.0079 |
| rm-cam-convex | recurrent@r.dropoutGuard=true | 35.26 | 36.49 | 24.75 | 0.0798 | 0.0079 |
| rm-cam-convex | ffx-reflections | 29.85 | 31.83 | 21.13 | 0.1343 | 0.0097 |
| rm-obj-convex | noisy | 18.65 | 40.11 | 16.92 | 0.3386 | 0.1101 |
| rm-obj-convex | recurrent | 35.29 | 38.46 | 23.29 | 0.0768 | 0.0020 |
| rm-obj-convex | recurrent@r.dropoutGuard=true | 34.96 | 35.04 | 20.78 | 0.0769 | 0.0020 |
| rm-obj-convex | ffx-reflections | 29.85 | 30.48 | 16.97 | 0.1254 | 0.0030 |
| rm-refl-ball | noisy | 18.68 | 40.10 | 19.66 | 0.3372 | 0.1096 |
| rm-refl-ball | recurrent | 35.39 | 38.01 | 20.81 | 0.0789 | 0.0012 |
| rm-refl-ball | recurrent@r.dropoutGuard=true | 35.37 | 37.78 | 21.53 | 0.0790 | 0.0012 |
| rm-refl-ball | ffx-reflections | 30.00 | 31.78 | 17.29 | 0.1266 | 0.0023 |
| rm-cam-concave | noisy | 18.52 | 27.41 | 15.18 | 0.3307 | 0.1063 |
| rm-cam-concave | recurrent | 32.33 | 28.80 | 19.77 | 0.0824 | 0.0077 |
| rm-cam-concave | recurrent@r.dropoutGuard=true | 32.30 | 28.73 | 19.46 | 0.0825 | 0.0077 |
| rm-cam-concave | ffx-reflections | 27.44 | 26.24 | 16.02 | 0.1406 | 0.0081 |
| rm-cut-plane | noisy | 18.71 | 33.52 | 16.34 | 0.3214 | 0.1006 |
| rm-cut-plane | recurrent | 32.73 | 31.84 | 23.33 | 0.0832 | 0.0077 |
| rm-cut-plane | recurrent@r.dropoutGuard=true | 32.68 | 31.68 | 23.29 | 0.0834 | 0.0077 |
| rm-cut-plane | ffx-reflections | 27.89 | 30.87 | 19.43 | 0.1413 | 0.0088 |
