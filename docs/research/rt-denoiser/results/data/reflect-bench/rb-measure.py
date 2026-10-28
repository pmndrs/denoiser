# per-pixel temporal std of luma over rb/<prefix>-NN.png; crop excludes the GUI (right), tags (top), status (bottom)
import sys, glob, numpy as np
from PIL import Image
for prefix in sys.argv[1:]:
    files = sorted(glob.glob(f'rb/{prefix}-[0-9][0-9].png'))
    a = np.stack([np.asarray(Image.open(f).convert('RGB'), dtype=np.float32)[40:720, 0:1090] for f in files])
    y = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    s = y.std(axis=0)
    print(f'{prefix:26s} n={len(files):2d} sigma={s.mean():6.2f} p99={np.percentile(s, 99):6.2f} luma={y.mean():6.1f}')
