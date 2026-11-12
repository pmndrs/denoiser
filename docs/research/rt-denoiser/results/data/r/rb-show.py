"""Compact view of a scored plan: python3 rb-show.py <plan>.json [regions...]"""
import json, sys
d = json.load(open(sys.argv[1]))
regs = sys.argv[2:] or ['crop', 'table', 'model', 'model_gloss', 'model_rough']
print(f"{'run':34s}" + ''.join(f'{r:>26s}' for r in regs) + '   (sigma sigma_norm bias)')
for r in d:
    s = r.get('still', {})
    cells = ''.join((f"{s[k]['sigma']:7.3f} {s[k].get('sigma_norm', float('nan')):6.3f} {s[k].get('bias', float('nan')):+6.2f}   " if k in s else ' ' * 26) for k in regs)
    t = ' ms ' + ' '.join(f"{k}:{v.get('total')}" for k, v in r['timing'].items()) if 'timing' in r else ''
    print(f"{r['name']:34s}{cells}{t}")
