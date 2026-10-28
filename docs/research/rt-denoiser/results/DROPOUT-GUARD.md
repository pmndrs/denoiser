# Recurrent `dropoutGuard` (2026-10-28): built, fails rule 9 on clean mirrors

Dennis asked for a mirror improvement that leaves clean input alone, after the three-temporal workbench showed the
recurrent specular filter passing SSR hit/miss flicker straight through on Ben Houston's mirror scene (three.js
#35228 example: no local probes, so misses fall back to a white environment behind a red and gold model).

## What the option does
Recurrent specular, option `dropoutGuard` (default false, compiled in only when true; default WGSL byte-identical to
HEAD: temporal and history-fix passes, 4 kind sets × variants, 495,629 bytes).
- **Weight:** w = smoothstep(0.05, 0.15, σ of this frame's 3×3 ĥ). The history fix uses the fast history's raw 3×3 ĥ σ.
- **Where w applies:** f_r becomes max(f_r, w) in the detector's floor and centring and in the history-fix window, and
  roughness becomes max(r, w) in the virtual hit test's and the virtual confidence's ĥ tolerances.

## Workbench (SSR, still camera, mean temporal σ of 8-bit luma over 16 frames)

| | guard off | guard on | FFX port |
|---|---|---|---|
| mirrors, Ben's tracer | 2.50 | 0.70 | 0.72 |
| mirrors, three r186 tracer | 4.16 | 1.17 | 1.22 |
| roughness 0.25, Ben's tracer | 0.72 | 0.47 | 0.24 |
| roughness 0.25, three's tracer | 1.83 | 1.48 | 0.50 |

Ablation (guard off): `virtualMotion: false` = raw (3.71), because a perfect mirror's surface history is capped at 0
(lobe half-angle 0). `virtualHitTest: false` → 2.00, `historyAntiLag: false` → 2.20. With the guard on,
`virtualHitTest: false` or `virtualHitTolerance: 1` → 0.62–0.63. **The virtual hit test is what drops mirror history
under dropout.**

## Reflection paths (rule 9's ghosting check): fails
12 `rm-*` paths, 960×540, 72 frames, 256-spp references, recurrent-specular vs `@r.dropoutGuard=true`
(tables: [data/dropout-guard/rm-tables.md](data/dropout-guard/rm-tables.md)).

Settled ROI dB per marker, guard on minus off:

| marker 1 | marker 2 |
|---|---|
| cam-plane −4.68, bump-plane −8.41, graze-plane −0.16, obj-plane −2.57, refl-slide −4.55, refl-turn −4.52, cam-convex −7.67, obj-convex −6.60, refl-ball −3.89, cam-concave +2.05, cut-plane −2.37 | +0.40 … +4.04 on every path |

- **Duplicate-image frames:** up slightly on 5 paths (cam-plane 0 → 2, graze-plane 11 → 17), down on bump-plane (11 → 2).
- **Trails behind moving reflected objects:** shorter (obj-plane 10.7 → 6.3 px, obj-exit 15.8 → 6.7).

**Why:** these paths are ray traced, with no hit/miss dropout, yet the guard fires. A wide 3×3 ĥ spread also occurs on
clean mirrors wherever the reflected geometry varies in depth: bumps, curved reflectors, reflected silhouettes.
There, treating the mirror as rough keeps history the strict tests rightly dropped.

## Next design (not built)
The signature has to be specific to hit/miss flicker, not to hit-distance variation. Candidates:
1. **Miss mix.** Count real misses only (ĥ = 1, i.e. hit distance 0, the library's miss convention) and fire where a
   3×3 holds both misses and hits. This needs apps to pass 0 for probe or environment fills; the workbench and
   reflections-rooms write 100. Clean traced mirrors only mix at reflected sky silhouettes.
2. **Persistence.** Keep a per-pixel EMA of hit/miss state changes, so only pixels that keep flipping count as
   dropout, while a one-time change (a disocclusion, a moving reflected object) does not. This needs storage: data's
   m bits are written but read by no pass.
3. **Both:** a miss mix gated by persistence.
Then rerun the 12 rm paths first (the cheap test this design failed), then the full rule-9 set.
