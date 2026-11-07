"""Metrics for reflection-bench runs (rb-run.mjs output). Luma = Rec. 709 weights on the 8-bit sRGB display values
(ACES + sRGB, what Dennis sees), so bias is in 8-bit display levels (TRACKS "the five numbers", 4).

  python3 rb-metrics.py <RB_OUT> <runs-*.json> [out.json]

Per run and region (all / crop = the 2026-10-28 screenshot crop / table / model / model glossy r < 0.25 /
model rough r >= 0.25 / background):
  sigma      still camera: mean over pixels of the per-pixel temporal std of luma (TRACKS "calm", still form)
  p99        99th percentile of that std
  luma       mean luma (temporal mean)
  bias       luma - reference luma (8-bit levels)
  sigma_norm sigma x reference luma / luma (calm at equal brightness; a darker output fluctuates less in display levels)
  rmse_mean  RMS(temporal mean - reference): the error left after time averaging (blur, bias, ghost of the pose)
  rmse_frame mean over frames of RMS(frame - reference)
Orbit (frames sampled along the scripted orbit, each against the reference accumulated at that pose):
  orbit_rmse, orbit_bias per sample, mean over samples; orbit_flicker for consecutive samples (k, k+1):
  RMS((o[k+1] - o[k]) - (ref[k+1] - ref[k])), the temporal change not explained by the reference's own change.
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

W709 = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def luma(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) @ W709


def masks(ref_dir, shape):
    out = {'all': np.ones(shape, bool)}
    crop = np.zeros(shape, bool)
    crop[40:720, 0:1090] = True
    out['crop'] = crop
    rp = os.path.join(ref_dir, 'regions.png')
    if os.path.exists(rp):
        r = np.asarray(Image.open(rp).convert('RGB'), dtype=np.float32)
        table = r[..., 0] > 128
        model = r[..., 1] > 128
        rough = r[..., 2] / 255.0
        out['table'] = table
        out['model'] = model
        out['model_gloss'] = model & (rough < 0.25)
        out['model_rough'] = model & (rough >= 0.25)
        out['bg'] = ~(table | model)
    return out


def stats(m, region):
    return float(m[region].mean()) if region.any() else float('nan')


def run_metrics(out_dir, info):
    d = os.path.join(out_dir, info['name'])
    ref_dir = os.path.join(out_dir, 'refs', info['refKey'])
    res = {'name': info['name'], 'cfg': info['cfg']}
    if 'timing' in info:
        res['timing'] = info['timing']
    still = sorted(glob.glob(os.path.join(d, 's-*.png')))
    ref_still = os.path.join(ref_dir, 'still.png')
    ref = luma(ref_still) if os.path.exists(ref_still) else None
    shape = None
    if still:
        y = np.stack([luma(f) for f in still])
        shape = y.shape[1:]
        mk = masks(ref_dir, shape)
        sd = y.std(axis=0)
        mean = y.mean(axis=0)
        reg = {}
        for k, m in mk.items():
            r = {'px': int(m.sum()), 'sigma': stats(sd, m), 'p99': float(np.percentile(sd[m], 99)) if m.any() else float('nan'),
                 'luma': stats(mean, m)}
            if ref is not None:
                r['ref_luma'] = stats(ref, m)
                r['bias'] = r['luma'] - r['ref_luma']
                # sigma rescaled to the reference's brightness (a darker output also fluctuates less in display levels)
                r['sigma_norm'] = r['sigma'] * r['ref_luma'] / max(r['luma'], 1e-3)
                r['rmse_mean'] = float(np.sqrt(((mean - ref) ** 2)[m].mean()))
                r['rmse_frame'] = float(np.mean([np.sqrt(((f - ref) ** 2)[m].mean()) for f in y]))
            reg[k] = {a: (round(b, 4) if isinstance(b, float) else b) for a, b in r.items()}
        res['still'] = reg
    orbit = sorted(glob.glob(os.path.join(d, 'o-*.png')))
    if orbit:
        ks = [int(os.path.basename(f)[2:5]) for f in orbit]
        o = {k: luma(f) for k, f in zip(ks, orbit)}
        rf = {k: luma(os.path.join(ref_dir, f'o-{k:03d}.png')) for k in ks if os.path.exists(os.path.join(ref_dir, f'o-{k:03d}.png'))}
        mk = masks(ref_dir, next(iter(o.values())).shape)
        # masks are from the still pose; under orbit only 'all' and 'crop' are exact, the rest approximate (labelled)
        reg = {}
        for name in ('all', 'crop'):
            m = mk[name]
            rm = [float(np.sqrt(((o[k] - rf[k]) ** 2)[m].mean())) for k in ks if k in rf]
            bi = [float((o[k] - rf[k])[m].mean()) for k in ks if k in rf]
            fl = [float(np.sqrt((((o[k + 1] - o[k]) - (rf[k + 1] - rf[k])) ** 2)[m].mean())) for k in ks if k + 1 in o and k in rf and k + 1 in rf]
            reg[name] = {'orbit_rmse': round(float(np.mean(rm)), 4) if rm else None, 'orbit_bias': round(float(np.mean(bi)), 4) if bi else None,
                         'orbit_flicker': round(float(np.mean(fl)), 4) if fl else None, 'samples': len(rm)}
        res['orbit'] = reg
    return res


def main():
    out_dir, runs_file = sys.argv[1], sys.argv[2]
    runs = json.load(open(runs_file))
    results = [run_metrics(out_dir, r) for r in runs]
    if len(sys.argv) > 3:
        json.dump(results, open(sys.argv[3], 'w'), indent=1)
    regions = ['all', 'crop', 'table', 'model', 'model_gloss', 'model_rough']
    print(f"{'run':34s} " + ' '.join(f'{r:>18s}' for r in regions) + '   (sigma / bias)')
    for r in results:
        s = r.get('still', {})
        cells = []
        for k in regions:
            v = s.get(k)
            cells.append(f"{v['sigma']:7.3f} / {v.get('bias', float('nan')):+6.2f}  " if v else ' ' * 18)
        line = f"{r['name']:34s} " + ' '.join(cells)
        if 'orbit' in r:
            a = r['orbit']['all']
            line += f"  orbit rmse {a['orbit_rmse']} flick {a['orbit_flicker']} bias {a['orbit_bias']}"
        if 'timing' in r:
            line += '  ms ' + ' '.join(f"{k}:{v.get('total')}" for k, v in r['timing'].items())
        print(line)


if __name__ == '__main__':
    main()
