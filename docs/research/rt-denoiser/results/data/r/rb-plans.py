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
    return p


if __name__ == '__main__':
    name, out = sys.argv[1], sys.argv[2]
    pl = plans()[name] if name in plans() else json.loads(name)
    pl['tag'] = pl.get('tag', name if name in plans() else 'adhoc')
    json.dump(pl, open(out, 'w'), indent=0)
