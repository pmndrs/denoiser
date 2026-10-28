# Recurrent `dropoutGuard` (2026-10-28): v1 failed on clean mirrors; v2 keeps marker 1 exact, two marker-2 regressions

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

## v1 next design (built as v2 below)
The signature has to be specific to hit/miss flicker, not to hit-distance variation. Candidates:
1. **Miss mix.** Count real misses only (ĥ = 1, i.e. hit distance 0, the library's miss convention) and fire where a
   3×3 holds both misses and hits. This needs apps to pass 0 for probe or environment fills; the workbench and
   reflections-rooms write 100. Clean traced mirrors only mix at reflected sky silhouettes.
2. **Persistence.** Keep a per-pixel EMA of hit/miss state changes, so only pixels that keep flipping count as
   dropout, while a one-time change (a disocclusion, a moving reflected object) does not. This needs storage: data's
   m bits are written but read by no pass.
3. **Both:** a miss mix gated by persistence.
Then rerun the 12 rm paths first (the cheap test this design failed), then the full rule-9 set.

## v2: flip persistence × hit/miss mix (built 2026-10-28)
Trigger (shaders/recurrent.ts `DropoutGuard`):
- **Persistence:** φ, a per-pixel EMA (rate 1/8) of hit/miss state changes. It is kept with the last state in data's m bits,
  which no other pass reads, and reprojected from the nearest valid tap.
- **Mix:** the geometry-valid 3×3 holds both misses (ĥ = 1, hit distance 0) and hits.
- **Weight:** w = smoothstep(0.1, 0.3, φ) × mix. It is applied in the same four places as v1. The history fix uses
  smoothstep(0.1, 0.3, φ).
- **Default WGSL** is byte-identical to HEAD (495,629 bytes).

Apps must pass 0 for probe or environment fills. The workbench's new pane option `missZero` does that:
- three's tracer: probe samples.
- Ben's tracer: a pixel counts as a miss below coverage 0.5.

On its own, `missZero` changes nothing visible: 2.51 → 2.52 and 4.06 → 4.03.

### Workbench, Ben's mirror scene (same measure as above)
| | off | v2 on | v1 on | FFX |
|---|---|---|---|---|
| mirrors, Ben's tracer | 2.51 | 1.03 | 0.70 | 0.72 |
| mirrors, three's tracer | 4.06 | 1.36 | 1.17 | 1.19 |
| roughness 0.25, Ben's tracer | 0.72 | 0.54 | 0.47 | 0.24 |
| roughness 0.25, three's tracer | 1.82 | 1.50 | 1.48 | 0.50 |

### Reflection paths (same run as v1; table: [data/dropout-guard/rm-v2-marker.md](data/dropout-guard/rm-v2-marker.md))
- **Marker 1:** unchanged on all 12 paths (|Δ| ≤ 0.03 dB on every metric; v1 lost up to 8.4 dB).
- **Marker 2, settled:** +0.2 … +2.5 dB on 10 paths. Duplicate frames on rm-graze-plane fall from 9 to 3.
- **Regressions:**
  - **rm-refl-turn marker 2** (the mirror turns): moving −1.59 dB, hold −0.84; position error +1.7 px, trail +2.2 px,
    ghost +0.09, duplicate frames 24 → 27 of 40. Settled +1.48.
  - **rm-obj-convex marker 2:** moving −1.47 dB, settled −1.52.
  - **rm-cam-concave marker 2:** moving −0.50 dB (settled +2.48).

**Reading:** where these traced mirrors gain, the reflected sky edges flip hit/miss under sampling. Keeping history
there anti-aliases them, which is the intended effect. The losses are on a moving reflector and on a convex mirror.
There the virtual reprojection is least exact, and relaxing the virtual hit test lets mismatched history through.

**Verdict:** much closer than v1, but not clean. It stays opt-in and experimental.

**Next candidate:** relax only the detector and the history fix, not the two virtual tolerances; or use the
persistence alone, without relaxing the hit test where the reflector moves. Test on rm-refl-turn and rm-obj-convex
plus the workbench first.

### v2 ablation: which effect costs the two paths (tune `dropoutParts`)
`dropoutParts` is a compile-time mask: 1 detector, 2 virtual hit test, 4 virtual confidence, 8 history fix. The
default 15 is byte-identical to v2. Marker 2 deltas against guard off (table:
[data/dropout-guard/rm-v2-parts-marker.md](data/dropout-guard/rm-v2-parts-marker.md)):

| path | all (15) | no virtual (9) | no confidence (11) | no hit test (13) |
|---|---|---|---|---|
| rm-refl-turn, moving dB | −1.59 | −1.48 | −1.47 | −1.42 |
| rm-refl-turn, position error px | +1.72 | +1.56 | +1.66 | +1.44 |
| rm-obj-convex, settled dB | −1.52 | −1.58 | −1.70 | −1.41 |
| rm-cam-concave, moving dB | −0.50 | +0.16 | −0.19 | +0.10 |
| rm-cam-plane, settled dB | +1.80 | +1.67 | +1.73 | +1.75 |

- **The virtual tolerances are not the cause.** Keeping both strict still loses about 1.5 dB on the two paths, so the
  losses come from the detector floor/centring or the history-fix window.
- **The SSR gain does need the relaxed hit test.** The v1 ablation showed the hit test is what drops a perfect
  mirror's history.
- **No combination of the four removes the losses.**

Stopped here (rule 8: the second miss of the same kind). Recorded.

**Scope as it stands:** an opt-in for screen-space reflection input (its target). On ray-traced input the tracked
reflection is unaffected, and the cost sits at reflected sky edges of moving or curved mirrors. Ray-traced apps have
no reason to turn it on.

**Untested:** SSR under camera or object motion (the workbench has no reference). That needs a visual review with
orbit on, guard on vs off.

### v2 with a resolver (workbench, Ben's mirrors, his tracer with conservative Hi-Z, still camera)
The tables above have the resolver off, to show the denoiser alone. With the workbench's resolvers on:

| | resolver off | FSR3 1.5× | Ben's TRAA |
|---|---|---|---|
| raw | 3.71 | 0.68 | – |
| recurrent | 2.50 | 0.58 | 0.56 |
| recurrent + dropoutGuard v2 | 1.03 | 0.42 | 0.36 |
| FFX port | 0.72 | 0.36 | – |
| Ben's CoverageDenoiseNode | 0.38 | – | 0.28 |

- **The resolver does most of the work:** raw input goes from 3.71 to 0.68 with FSR3 alone.
- **The denoiser sets the residual:** without the guard, recurrent adds little over raw under FSR3 (0.68 → 0.58). The
  guard closes about half of the remaining gap to FFX.
