# Review bench: A/B flip tests of the real-time denoiser options (2026-10-27)

_Tooling / UI implementer (RULES.md rule 8: no NRD code opened; this page runs our own denoisers only). Built for TASKS
rule 12 (Dennis, 2026-10-27: "build a test/review bench with these options specifically highlighted with toggles/controls
etc so we can easily do flip tests between the options… I hate url driven params so a UI is best")._

## Open it

```sh
yarn workspace three-temporal review
# then http://127.0.0.1:5262/review.html
```

`review` serves `examples/three-temporal` with `vite.review.config.ts`: the same config as `yarn dev`, but `denoiser/three`,
`denoiser/realtime` and `@pmndrs/denoiser-*` resolve to the packages' **source**, so the bench always runs today's code
and defaults (the other pages of `yarn dev` use `packages/denoiser/dist`, which needs `yarn build:lib` after a change).
`REVIEW_DIST=1 yarn workspace three-temporal review` uses the dist instead. Port 5262 is the bench's (TASKS rule 6 list:
5210 / 5220 / 5230 / 5240 are taken).

## What is on the page

- **The canvas**: side **A** left of the divider, side **B** right. Both sides denoise the same 1-ray inputs of one scene
  (the corner of `realtime-gi.html`, its torus-knot close-ups from `realtime-shadows.html`, Sponza, Bistro; the inputs come
  from `src/realtime/rays.ts`, shared with those pages). Drag on the canvas to move the divider.
- **Views**: split, A only, B only, |A − B| (gain 1 … 256, applied after tone mapping), the reference (accumulates while the
  camera holds still), the raw 1-ray signal. Split / A / B / difference switch by a uniform, so they are instant: **F**
  flips the whole view between A and B (blink test; the "blink A / B" box does it every 0.7 s), **X** swaps the two sides
  (configurations and histories), **S** / **D** / **R** / **N** pick split / difference / reference / raw.
- **Signals**: lit composite, diffuse, specular (SSR), AO, shadow.
- **Motion and events**: moving / paused (**Space**), camera cut (**K**: the other shot, or half a path ahead), light colour
  change at constant luminance (**C**, Sponza / Bistro: the case `antiLagChroma` is for), light brightness step (**L**),
  reset both histories (**0**); a camera-path menu per scene; the corner and knot have a panel-size slider (soft vs hard).
- **Flip tests** (top cards): the decisions Dennis asked to see highlighted, **q23** (stepTest + edgeBox + rotationStep 0)
  and **q29** (floorE 0.05). "Load the flip test" sets A = without, B = with, and jumps to the scene / path / signal where
  it shows best; the "also" buttons go to the other places worth a look; the per-option boxes toggle each part of the
  decision on side B alone (which part does what).
- **Options table**: one row per registry entry, grouped by filter (shadows, SVGF, occlusion, recurrent, SH), with the
  decision id (click: load its flip test) and status badges (default / opt-in / open), one control per side, the registry
  default, the "what to look for" sentence and a **show me** jump. Rows where A and B differ are highlighted; an override
  is outlined (↺ clears it back to the package default). "Show" filters to differing rows, rows with a decision id, or
  rows that apply. A control that doesn't apply on a side (an SVGF option while that side runs the recurrent filter, an SH
  option without the SH payload) is disabled with the reason.
- **Per side**: a preset menu (shipped defaults; "defaults before <date>" for every date a registered default changed:
  2026-10-27 = q04 / q23 / q24 / q25 / q26 / q29 / q31, 2026-10-26 = q18 / q19 / q21 / T1b / T5 / T6, 2026-10-25 = q01 / q02 /
  q06; copy the other side), reset to defaults, and the side's GPU ms per node (gi / ao / shadows, timestamp queries).
- **Decision preset** menu and the **Decisions** table: every decision with Dennis's answer, the options it flips
  (off → on) and a "load A / B" button.

Changing a control rebuilds only the nodes of that side whose options changed (options are structural: a new denoiser per
change), so the other side keeps its history; the old nodes are disposed a few frames later. Every denoiser of both
sides runs every frame (switching the signal keeps all histories), so the bench costs about twice a page's denoising.
SSR (the specular input) reflects the image lit by side A's diffuse and shadows of the previous frame: both sides get the
same specular input.

**Package-default check.** The registry states the default it expects; the page also reads what each denoiser actually
resolved (`denoiser.options`) on a side that doesn't override the option, and shows "package: X" under the default where
they differ. So a default flipped in `packages/denoiser-realtime` without a registry update (or a registry update before
the code lands) is visible on the page, and `__t.liveDefaults()` lists the mismatches (the smoke test prints them).
Presets set explicit values on both sides, so a flip test stays a flip test while a default is being changed.

**URL.** The URL mirrors the state (scene, path, signal, view, both sides' overrides) for sharing a setup; nothing needs
it. A scene switch reloads the page and carries the state over that way.

## Adding an option (one entry)

Everything on the page (controls, badges, presets, jumps, the decision table) is generated from
`examples/three-temporal/src/review/options.ts`. To put a new option or proposal on the bench, add one entry to `OPTIONS`:

```ts
{
  id: 'shadows.myOption', filter: 'shadows', key: 'myOption', targets: ['shadows'],
  values: [false, true], default: false, candidate: true, decision: 'q32', status: 'open',
  look: 'One plain sentence: what changes on screen when it flips.',
  where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow', note: 'what to watch there' },
},
```

- `filter` picks the table group and the gate (svgf / recurrent options only apply where that side runs that filter;
  `sh` needs the SH payload; `anyFilter: true` for keys both filters take). `targets` are the nodes the key goes to:
  `gi` (realtimeDiffuseSpecular, shared), `gi.diffuse` / `gi.specular` (one signal), `ao`, `shadows`.
- `values` are the choices offered (two booleans make a checkbox, anything else a select; `valueLabels` names them).
- `default` is the package default; when a decision flips it, update `default` and append
  `changes: [{ on: 'YYYY-MM-DD', from: <old>, by: 'qNN' }]` (that also feeds the "defaults before <date>" presets).
- `candidate` is the value the proposal turns on (omit it for a two-value option whose candidate is the non-default one).
- `decision` / `related`: the q-number(s). If the q-number is new, add a `DECISIONS` entry (title, Dennis's answer once
  given; `base` for overrides both sides need, `set` for an explicit [A, B] pair, `highlight: true` for a flip-test card).
- `requires` names options it needs (`{ 'svgf.antiLag': ['auto'] }`: the control is disabled with the reason otherwise);
  `radianceOnly: true` marks SVGF keys the SH payload rejects (with `gi.payload: 'sh'` they go to the specular node only).
  The package throws on such combinations; if one slips through, the page shows the error in the status line instead of
  stopping.
- `status`: `open` while waiting for Dennis, then `default` or `opt-in`. `tuning: true` keeps a knob out of its decision's
  preset; `unwired: '<reason>'` shows it disabled when the bench scenes can't feed it.
- Check: `npx tsc --noEmit -p examples/three-temporal/tsconfig.json`, open the page, find the row, press its "show me", and
  run `node run-realtime.mjs review --port=5262` (from `examples/three-temporal`).

Decision cards on the decisions page should name the bench preset to open (TASKS rule 12): "review bench → Decision preset
qNN" (or the flip-test card when highlighted).

## The registry (42 options, 22 decisions)

Defaults as the registry expects them after Dennis's 2026-10-27 answers (q23 / q24 / q25 / q26 / q29 / q31 flipped,
q27 / q28 / q30 opt-in); the page flags any that the package resolves differently.

| filter | option | values | default (history) | decision | status | shows best at |
|---|---|---|---|---|---|---|
| shadows | `stepTest` | false / true | true (was false before 2026-10-27) | q23 | default | bistro / bistro-move / shadow |
| shadows | `edgeBox` | false / true | true (was false before 2026-10-27) | q23 | default | bistro / bistro-move / shadow |
| shadows | `rotationStep` | 0 (fixed per pixel) / 0.618 (rotates every frame) | 0 (fixed per pixel) (was 0.618 (rotates every frame) before 2026-10-27) | q23 | default | knot / knot-still / shadow |
| shadows | `terminatorAnalytic` | false / true | true (was false before 2026-10-27) | q24 | default | knot / knot-static / shadow |
| shadows | `horizonSnap` | false / true | true (was false before 2026-10-27) | q24 | default | bistro / bistro-move / shadow |
| shadows | `floorE` | 0 / 0.05 | 0.05 (was 0 before 2026-10-27) | q29 | default | bistro / bistro-move / shadow |
| shadows | `lightMotion` | 0 / 1 | 0 | q30 | opt-in | bistro / bistro-move / shadow |
| shadows | `snapHardPx` | 0 / 2 | 2 (was 0 before 2026-10-26) | q21 | default | bistro / bistro-orbit / shadow |
| shadows | `backfacePass` | false / true | true (was false before 2026-10-26) | q21 | default | bistro / bistro-move / shadow |
| shadows | `noiseCap` | 0 / 2 | 0 | q22 | opt-in | bistro / bistro-move / shadow |
| shadows | `noiseCapSettled` | false / true | false | q22 | opt-in | bistro / bistro-move / shadow |
| shadows | `uniformSnap` | true / change / false | change (was true before 2026-10-25) | q06 | default | sponza / sponza-orbit / shadow |
| shadows | `stabilize` | 0 / 0.25 | 0.25 | q05 | default | knot / knot-static / shadow |
| shadows | `clampGeometry` | false / true | true | q05 | default | knot / knot-orbit / shadow |
| shadows | `normalThreshold` | 0 / 0.8 / 0.95 | 0 | – | opt-in | corner / knot-orbit / shadow |
| shadows | `normalTest` | center / relative | center | – | opt-in | corner / knot-orbit / shadow |
| shadows | `f16Rounding` | store / nearest | store | q25 | opt-in | knot / knot-still / shadow / diff |
| SVGF / A-SVGF | `normalTest` | center / relative / soft | soft (was center before 2026-10-27) | q31 | default | bistro / bistro-orbit / ao |
| SVGF / A-SVGF | `normalSoftThreshold` | 0.3 / 0.5 / 0.7 | 0.5 | q31 | opt-in, tuning | bistro / bistro-orbit / ao |
| SVGF / A-SVGF | `normalSoftHistory` | per kind (3 diffuse / AO, 1 specular) / 1 / 2 / 3 / 5 | per kind (3 diffuse / AO, 1 specular) | q31 | opt-in, tuning | bistro / bistro-orbit / ao |
| SVGF / A-SVGF | `antiLagChroma` | false / true | true (was false before 2026-10-27) | q26 | default | bistro / bistro-hold / diffuse + colour |
| SVGF / A-SVGF | `f16Rounding` | store / nearest | nearest (was store before 2026-10-27) | q25 | default | bistro / bistro-hold / diffuse / diff |
| SVGF / A-SVGF | `youngNormalPower` | 0 / 8 / 16 | 16 (was 0 before 2026-10-26) | q18 | default | corner / diffuse + cut |
| SVGF / A-SVGF | `antiLag` | off / auto | auto (was off before 2026-10-25) | q02 | default | sponza / sponza-pan / specular |
| SVGF / A-SVGF | `outputAliasing` | false / true | true (was false before 2026-10-27) | q04 | default | corner / orbit / diffuse / diff |
| SVGF / A-SVGF | `antiLagHistoryScale` | false / true | false | – | opt-in | bistro / bistro-hold / diffuse + brightness |
| SVGF / A-SVGF | `antiLagGain` | 1 / 2 / 4 | 1 | – | opt-in | sponza / sponza-orbit / specular |
| SVGF / A-SVGF | `historyFallback` | 3x3 / off / strict | 3x3 | – | opt-in | bistro / bistro-pan / diffuse |
| SVGF / A-SVGF | `historyNormal` | normal / geometric | normal | – | opt-in, not wired | bistro / bistro-orbit / diffuse |
| SVGF / A-SVGF | `reflectionReprojection` | surface / virtual / dual | surface | – | opt-in | corner / orbit / specular |
| SVGF / A-SVGF | `reflectionHitTest` | false / true | false | – | opt-in | corner / knot-orbit / specular |
| occlusion | `filter` (switch) | svgf / recurrent | svgf (was recurrent before 2026-10-25) | q01 | default | sponza / sponza-orbit / ao |
| occlusion | `youngNormalPower` | 0 / 16 | 0 | – | opt-in | corner / ao + cut |
| recurrent | `filter` (switch) | svgf / recurrent | svgf | q01 | default | sponza / sponza-orbit / diffuse |
| recurrent | `historyFix` | mips / spatial | spatial (was mips before 2026-10-26) | q19 | default | sponza / sponza-pan / diffuse |
| recurrent | `historyFixDense` | 0 / 4 | 4 (was 0 before 2026-10-26) | T1b | default | corner / diffuse + cut |
| recurrent | `normalThreshold` | 0 / 0.8 / 0.95 | 0.95 (was 0 before 2026-10-26) | T6 (q28) | default | corner / knot-orbit / diffuse |
| recurrent | `normalTest` | center / relative | relative (was center before 2026-10-26) | T6 (q28) | default | bistro / bistro-pan / diffuse |
| recurrent | `virtualHitTest` | false / true | true (was false before 2026-10-26) | T6 | default | corner / knot-orbit / specular |
| SH | `payload` (switch) | radiance / sh | radiance | q12 | opt-in | sponza / sponza-orbit / diffuse |
| SH | `shDetailNormalPower` | 0 / 8 / 16 | 0 | q27 | opt-in | sponza / sponza-orbit / diffuse |
| SH | `shSharpen` | 0.75 / 1 | 1 (was 0.75 before 2026-10-26) | T5 | default | sponza / sponza-orbit / diffuse |

Decisions with a card or preset: q01, q02, q04, q05, q06, q12, q18, q19, q21, q22, q23 (flip test), q24, q25, q26, q27,
q28, q29 (flip test), q30, q31, T1b, T5, T6.

## Limits of the bench scenes

- No normal maps on any bench scene (the asset loader drops textures; the corner has none): `shDetailNormalPower` (q27)
  and anything aimed at normal-map detail can't show here; the test bed's `dt-*` paths can.
- `historyNormal: 'geometric'` needs `guides.geometricNormal`, which `denoiser/three` doesn't pass: registered, not wired.
- The corner's area light is white and its power is a scalar in the shared WGSL: the light-colour event is Sponza / Bistro
  only (brightness steps work everywhere).
- Specular is three's SSR (screen-space, misses = environment), as on `realtime-gi.html`.
- The SH payload runs as its own `realtimeDiffuse` node next to `realtimeSpecular` (the joint node has no direction input).
- GPU ms come from the denoisers' timestamp queries while both sides run: compare A with B on one page, not with the
  benches in the results docs.

## Verification (2026-10-27)

- `npx tsc --noEmit -p examples/three-temporal/tsconfig.json`: clean.
- Refactor of the existing pages (8dfb9e7: the ray WGSL of `realtime-gi.ts` and `realtime-scenes.ts` moved unchanged to
  `src/realtime/rays.ts`): `run-realtime.mjs gi` on the corner and on Sponza (`--query=scene=sponza`) before / after, all 28
  manual-stepped screenshots byte-identical, every check passing (the Sponza run stops at `costs()`, which the asset-scene
  page never had: same before and after). After the apply-decisions agent rebuilt the dist (12:50) `gi` and `shadows` pass
  again; their screenshots now differ from the morning's because the shipped defaults changed, not the page.
- `node run-realtime.mjs review --port=5262 --scenes=corner,knot,sponza,bistro` (new scenario): per scene, NaN / Inf checks
  on all eight outputs at shipped defaults, after toggling 11 options on side B (shadows stepTest / floorE / lightMotion,
  SVGF normalTest / antiLagChroma, AO filter recurrent, diffuse + specular filter recurrent → historyFix mips → back to SVGF,
  SH payload + shDetailNormalPower) and after swap / flip; side A's node keys unchanged by the B toggles (history kept);
  screenshots of every signal and view; the q23 and q29 flip tests differ on screen (mean |A − B| of the displayed image
  per channel: q23 0.73 / 0.43 / 0.06 / 7.30 and q29 0.62 / 0.47 / 0.00 / 3.70 on corner / knot / Sponza / Bistro; Sponza's
  free view has almost no sun on screen and no hard contact, so q29 is reported there, not checked); no WebGPU validation
  errors. All checks pass; the registry's defaults match what the package (source, with the apply-decisions agent's
  2026-10-27 flips) resolves.
- Clicks and keys checked in the page (CDP): a B checkbox and an A select set only that side; F flips A / B; X swaps the
  configurations; "show me" jumps; the "defaults before 2026-10-27" preset and "reset to defaults" work; the URL mirrors the
  state.
- Both sides at the same configuration render identically (difference view exactly 0), so any non-zero |A − B| is the
  options.
