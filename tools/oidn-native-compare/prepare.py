"""Convert the browser dumps (examples/three-pathtracer-webgpu/dumps) into PFM
files for the native oidnDenoise CLI.

Dump filename convention: <name>.<gpuFormat>.<size>  (raw RGBA rows, no padding)
  color  — the path tracer's linear-HDR output (TOP-DOWN rows since
           three-gpu-pathtracer 0.0.27; older dumps were BOTTOM-UP)
  albedo — raster G-buffer base color, [0,1]      (TOP-DOWN rows)
  normal — raster G-buffer view normals, [-1,1]   (TOP-DOWN rows)

PFM is written bottom-up (negative scale = little-endian); write_pfm flips the
top-down rows. Pass --color-bottom-up for dumps made with the older tracer pin.

Usage: python prepare.py [--color-bottom-up] [dumps_dir] [out_dir]

"""
import glob
import os
import sys

import numpy as np

args = [a for a in sys.argv[1:] if a != "--color-bottom-up"]
color_bottom_up = "--color-bottom-up" in sys.argv[1:]
dumps = args[0] if len(args) > 0 else "../../examples/three-pathtracer-webgpu/dumps"
outdir = args[1] if len(args) > 1 else "."


def load(name):
    matches = glob.glob(os.path.join(dumps, f"{name}.*"))
    if not matches:
        raise SystemExit(f"missing dump: {name} (run window.__dumpForOIDN() in the demo)")
    path = matches[0]
    _, fmt, size = os.path.basename(path).split(".")
    size = int(size)
    dtype = np.float32 if "32float" in fmt else np.float16
    data = np.fromfile(path, dtype=dtype).reshape(size, size, 4).astype(np.float32)
    return data[:, :, :3]  # drop alpha


def write_pfm(path, img_topdown):
    """img_topdown: (H, W, 3) float32, row 0 = top. PFM stores rows bottom-up."""
    h, w, _ = img_topdown.shape
    with open(path, "wb") as f:
        f.write(b"PF\n")
        f.write(f"{w} {h}\n".encode())
        f.write(b"-1.0\n")  # negative = little-endian
        np.flipud(img_topdown).astype("<f4").tofile(f)
    print(f"wrote {path}")


color = load("color")             # top-down (tracer 0.0.27+)
if color_bottom_up:
    color = np.flipud(color)      # older tracer pin: bottom-up -> top-down
albedo = load("albedo")           # already top-down
normal = load("normal")

write_pfm(os.path.join(outdir, "color.pfm"), color)
write_pfm(os.path.join(outdir, "albedo.pfm"), np.clip(albedo, 0, 1))
write_pfm(os.path.join(outdir, "normal.pfm"), np.clip(normal, -1, 1))

# Our own denoised outputs (window.__dumpOurOutputs(): linear HDR, top-down),
# for the web-vs-native diff. Optional — older dump sets won't have them.
for name in ("ours_color", "ours_aux"):
    if glob.glob(os.path.join(dumps, f"{name}.*")):
        write_pfm(os.path.join(outdir, f"{name}.pfm"), load(name))
