"""Plans for rb-run.mjs (track R phase 1). python3 rb-plans.py <name> <out.json>; names below.
Every run renders the same still pose (or orbit) from a rebuilt graph; `still` = 60 warm-up + 16 grabbed frames."""
import json
import sys

STILL = {'warm': 60, 'frames': 24, 'stride': 8}
STILL1 = {'warm': 60, 'frames': 16, 'stride': 1}  # consecutive frames (high-frequency flicker only)
ORBIT = {'samples': [60, 61, 90, 91, 120, 121, 150, 151]}
DEN = ['none', 'ffx', 'recurrent', 'svgf']


def run(name, cfg, still=True, orbit=False, timing=False, ref=True):
    r = {'name': name, 'cfg': cfg, 'ref': ref}
    if still:
        r['still'] = STILL if still is True else still
    if orbit:
        r['orbit'] = ORBIT
    if timing:
        r['timing'] = {'frames': 60}
    return r


def side(den, **kw):
    return {'left': den, 'right': den, **kw}


def plans():
    p = {}
    # baseline: presets x sources x denoisers, still + orbit + timing (rb-lock.sh baseline)
    p['baseline'] = {'base': {'resolve': '1.5', 'tableRough': 0}, 'runs': [
        run(f'{pr}-{src}-{d}', side(d, preset=pr, refl=src), orbit=True, timing=d != 'none')
        for pr in ['defaults', 'ben'] for src in ['rt', 'hybrid'] for d in DEN]
        + [run(f'{pr}-{src}-{d}-consec', side(d, preset=pr, refl=src), still=STILL1) for pr in ['defaults'] for src in ['rt'] for d in DEN]}
    base = {'resolve': '1.5', 'tableRough': 0, 'preset': 'defaults', 'refl': 'rt'}
    # jitter: no resolver (no jitter, no FSR) and FSR3 with the denoisers seeing the jittered projection
    p['jitter'] = {'base': base, 'runs': [run(f'nofsr-{d}', side(d, resolve='off')) for d in DEN]
                   + [run(f'viewoffset-{d}', side(d, node={'ignoreViewOffset': False})) for d in DEN if d != 'none']
                   + [run(f'ben-nofsr-{d}', side(d, resolve='off', preset='ben')) for d in DEN]}
    # low-roughness history: table roughness sweep (model defaults, traced)
    p['tablesweep'] = {'base': base, 'runs': [run(f'table{t}-{d}', side(d, tableRough=t)) for t in [0, 0.05, 0.15, 0.3] for d in DEN]}
    # normal-mapped gloss: model normal maps off
    p['normalmaps'] = {'base': base, 'runs': [run(f'nonormal-{d}', side(d, normalMaps=False)) for d in DEN]
                       + [run(f'nonormal-hyb-{d}', side(d, normalMaps=False, refl='hybrid')) for d in DEN]}
    # our filters with FFX-like settings, one change at a time (model defaults, traced)
    rec = lambda **o: {'recurrent': o}
    sv = lambda **o: {'svgf': o}
    p['ours'] = {'base': base, 'runs': [
        run('rec-noHistAntiLag', side('recurrent', **rec(historyAntiLag=False))),
        run('rec-noCurDetector', side('recurrent', **rec(antiLagCurrentSigma=0))),
        run('rec-noAntiLagBoth', side('recurrent', **rec(historyAntiLag=False, antiLagCurrentSigma=0))),
        run('rec-noStabilize', side('recurrent', **rec(stabilizationFrames=0))),
        run('rec-stab31', side('recurrent', **rec(stabilizationFrames=31))),
        run('rec-noFirefly', side('recurrent', **rec(fireflyThreshold=0))),
        run('rec-noPreBlur', side('recurrent', **rec(preBlurRadius=0))),
        run('svgf-alpha32', side('svgf', **sv(temporalAlpha=1 / 32))),
        run('svgf-antiLagOff', side('svgf', **sv(antiLag='off'))),
        run('svgf-antiLagOff-alpha32', side('svgf', **sv(antiLag='off', temporalAlpha=1 / 32))),
        run('svgf-feedback', side('svgf', **sv(feedback=True))),
        run('svgf-alpha32-feedback', side('svgf', **sv(temporalAlpha=1 / 32, feedback=True))),
        run('svgf-atrous1', side('svgf', **sv(atrousIterations=1))),
    ]}
    # FFX made like ours, one change at a time (WGSL patches through the bench hook)
    P = lambda label, find, rep: {'label': f'ffx-reflections {label}', 'find': find, 'replace': rep}
    p['ffxpatch'] = {'base': base, 'runs': [
        run('ffx-maxSamples10', side('ffx', patches=[P('reproject', 'let max_samples = 32.0;', 'let max_samples = 10.0;')])),
        run('ffx-lumWeight0', side('ffx', patches=[P('reproject', 'const AVG_RADIANCE_LUMINANCE_WEIGHT: f32 = 0.3;', 'const AVG_RADIANCE_LUMINANCE_WEIGHT: f32 = 0.0;')])),
        run('ffx-noNewClip', side('ffx', patches=[P('resolve', 'new_signal = clipAABB(rmin, rmax, new_signal);', '')])),
        run('ffx-noAvgBlend', side('ffx', patches=[P('resolve', 'new_signal = mix(new_signal, avg_radiance, 1.0 / max(num_samples + 1.0, 1.0));', '')])),
        run('ffx-noPrefilter', side('ffx', patches=[P('prefilter', 'let needs_denoiser = center.variance > 0.0', 'let needs_denoiser = false && center.variance > 0.0')])),
        run('ffx-noHistClip', side('ffx', patches=[P('resolve', 'let clipped_old_signal = clipAABB(radiance_min, radiance_max, old_signal);', 'let clipped_old_signal = old_signal;')])),
        run('ffx-stab0.35', side('ffx', ffx={'temporalStabilityFactor': 0.35})),
        run('ffx-stab1.4', side('ffx', ffx={'temporalStabilityFactor': 1.4})),
        run('ffx-energy', side('ffx', patches=[P('reproject', 'const AVG_RADIANCE_LUMINANCE_WEIGHT: f32 = 0.3;', 'const AVG_RADIANCE_LUMINANCE_WEIGHT: f32 = 0.0;'),
                                                P('resolve', 'new_signal = clipAABB(rmin, rmax, new_signal);', '')])),
    ]}
    # mirrors (r = 0): history floors like FFX's 8 frames, and FFX without its floor
    PS = lambda find, rep: {'label': 'svgf-specular temporal', 'find': find, 'replace': rep}
    PR = lambda find, rep: {'label': 'recurrent-specular temporal', 'find': find, 'replace': rep}
    svgf8 = PS('return clamp(aSpec + 1.0, 1.0, P0.maxHistory);', 'return clamp(aSpec + 8.0, 1.0, P0.maxHistory);')
    rec7 = PR('return min(aSpec, P0.aCap);', 'return min(max(aSpec, 7.0), P0.aCap);')
    ffx1 = P('reproject', 'let s_max_samples = max(8.0, max_samples * samplesForRoughness(roughness));',
             'let s_max_samples = max(1.0, max_samples * samplesForRoughness(roughness));')
    mr = []
    for pr, src in [('defaults', 'rt'), ('ben', 'rt'), ('ben', 'hybrid')]:
        c = {'preset': pr, 'refl': src}
        mr += [run(f'{pr}-{src}-svgf-cap8', side('svgf', patches=[svgf8], **c)),
               run(f'{pr}-{src}-rec-cap7', side('recurrent', patches=[rec7], **c)),
               run(f'{pr}-{src}-rec-detRough0', side('recurrent', recurrent={'tune': {'detRough': 0}}, **c)),
               run(f'{pr}-{src}-rec-cap7-detRough0', side('recurrent', patches=[rec7], recurrent={'tune': {'detRough': 0}}, **c)),
               run(f'{pr}-{src}-ffx-mirror1', side('ffx', patches=[ffx1], **c))]
    p['mirror'] = {'base': base, 'runs': mr}
    # combinations of the measured causes, with the orbit (ghosting / lag under motion), FSR3 1.5x and no resolver
    svC = {'svgf': {'antiLag': 'off', 'temporalAlpha': 1 / 32}, 'patches': [svgf8]}
    svD = {'svgf': {'temporalAlpha': 1 / 32, 'antiLagNoiseFloor': 3}, 'patches': [svgf8]}
    reC = {'recurrent': {'historyAntiLag': False}}
    reD = {'recurrent': {'historyAntiLag': False, 'tune': {'detRough': 0}}, 'patches': [rec7]}
    cb = []
    for pr, src in [('defaults', 'rt'), ('defaults', 'hybrid'), ('ben', 'hybrid')]:
        for res in ['1.5', 'off']:
            c = {'preset': pr, 'refl': src, 'resolve': res}
            tag = f'{pr}-{src}-{"fsr" if res != "off" else "nofsr"}'
            cb += [run(f'{tag}-ffx', side('ffx', **c), orbit=True),
                   run(f'{tag}-svgf', side('svgf', **c), orbit=True),
                   run(f'{tag}-svgf-C', side('svgf', **svC, **c), orbit=True),
                   run(f'{tag}-svgf-D', side('svgf', **svD, **c), orbit=True),
                   run(f'{tag}-rec', side('recurrent', **c), orbit=True),
                   run(f'{tag}-rec-C', side('recurrent', **reC, **c), orbit=True),
                   run(f'{tag}-rec-D', side('recurrent', **reD, **c), orbit=True)]
    p['combos'] = {'base': base, 'runs': cb}
    # FFX's energy loss: the prefilter's radiance weight against the 8x8 average (bright samples weigh up to 100x less)
    rw1 = P('prefilter', 'fn radianceWeight(cr: vec3f, nr: vec3f, variance: f32) -> f32 {', 'fn radianceWeight(cr: vec3f, nr: vec3f, variance: f32) -> f32 { return 1.0;')
    p['ffx2'] = {'base': base, 'runs': [
        run('ffx-rw1', side('ffx', patches=[rw1])),
        run('ffx-rw1-nofsr', side('ffx', resolve='off', patches=[rw1])),
        run('ffx-rw1-hybrid', side('ffx', refl='hybrid', patches=[rw1])),
        run('ffx-maxSamples10-nofsr', side('ffx', resolve='off', patches=[P('reproject', 'let max_samples = 32.0;', 'let max_samples = 10.0;')])),
    ]}
    # recurrent without C-10 darkens the body (-4.7): is it the anti-firefly applied to an ever longer history?
    p['recbias'] = {'base': base, 'runs': [
        run('rec-noHAL-noFF', side('recurrent', recurrent={'historyAntiLag': False, 'fireflyThreshold': 0})),
        run('rec-noHAL-noFF-cap7', side('recurrent', recurrent={'historyAntiLag': False, 'fireflyThreshold': 0}, patches=[rec7])),
        run('rec-noHAL-noFF-nofsr', side('recurrent', resolve='off', recurrent={'historyAntiLag': False, 'fireflyThreshold': 0})),
        run('rec-noHAL-nofsr', side('recurrent', resolve='off', recurrent={'historyAntiLag': False})),
        run('svgf-C-nofsr-noTableFix', side('svgf', resolve='off', svgf={'antiLag': 'off', 'temporalAlpha': 1 / 32})),
    ]}
    # GPU time per denoiser, each alone, at the denoiser's own 1080p (no resolver; run with RB_W=1920 RB_H=1223 so the
    # canvas is 1920 x 1080), 300 timed frames after 60, three rounds interleaved; model defaults, traced
    p['timing'] = {'base': {**base, 'resolve': 'off'}, 'runs': [
        {'name': f'time{k}-{d}', 'cfg': side(d), 'timing': {'frames': 300}} for k in range(3) for d in ['ffx', 'recurrent', 'svgf']]}
    return p


if __name__ == '__main__':
    name, out = sys.argv[1], sys.argv[2]
    pl = plans()[name] if name in plans() else json.loads(name)
    pl['tag'] = pl.get('tag', name if name in plans() else 'adhoc')
    json.dump(pl, open(out, 'w'), indent=0)
