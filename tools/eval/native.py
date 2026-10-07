"""Evaluation inputs + native OIDN ground truth for every RT model.

1. Builds the eval inputs in tools/eval/out/inputs/ (PFM, values rounded to fp16
   so the web runtimes, which upload rgba16float textures, see identical data):
     - spheres, eiffel: LDR gallery scenes @ 4 spp (sRGB-encoded) + albedo/normal
       + converged reference (examples/gallery/public/scenes/<id>/)
     - hdrdump: the linear-HDR path tracer dump + aux (tools/oidn-native-compare/)
   each at 512x512 (quality) and 1920x1080 (timing; nearest-resampled).
2. Runs Intel's native oidnDenoise for each (scene, model) with the exact .tza
   weights the web runtimes load (-w): CPU output = ground truth, Metal output +
   warm timings on both devices at both sizes.
3. Writes tools/eval/out/plan.json (what the web eval page runs) and
   tools/eval/out/native.json (native timings).

Usage:
  OIDN_BIN=/path/to/oidn-x.y.z/bin tools/onnx-convert/.venv/bin/python tools/eval/native.py
"""
from __future__ import annotations

import json
import os
import re
import statistics
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tools', 'eval', 'out')
TZAS = os.path.join(ROOT, 'packages', 'denoiser', 'tzas')
SCENES = os.path.join(ROOT, 'examples', 'gallery', 'public', 'scenes')
HDRDUMP = os.path.join(ROOT, 'tools', 'oidn-native-compare')
SIZES = {'512': (512, 512), '1080': (1920, 1080)}

# The 17 RT color models (prefilter rt_alb/rt_nrm and lightmap models excluded).
LDR_MODELS = [
    'rt_ldr_small', 'rt_ldr', 'rt_ldr_alb_small', 'rt_ldr_alb',
    'rt_ldr_alb_nrm_small', 'rt_ldr_alb_nrm', 'rt_ldr_calb_cnrm_small', 'rt_ldr_calb_cnrm',
]
HDR_MODELS = [
    'rt_hdr_small', 'rt_hdr', 'rt_hdr_alb_small', 'rt_hdr_alb',
    'rt_hdr_alb_nrm_small', 'rt_hdr_alb_nrm', 'rt_hdr_calb_cnrm_small', 'rt_hdr_calb_cnrm',
    'rt_hdr_calb_cnrm_large',
]
SCENE_MODELS = {'spheres': LDR_MODELS, 'eiffel': LDR_MODELS, 'hdrdump': HDR_MODELS}


def f16(a: np.ndarray) -> np.ndarray:
    return a.astype(np.float16).astype(np.float32)


def write_pfm(path: str, rgb: np.ndarray) -> None:
    h, w, _ = rgb.shape
    with open(path, 'wb') as f:
        f.write(f'PF\n{w} {h}\n-1.0\n'.encode())
        f.write(np.ascontiguousarray(rgb[::-1], dtype='<f4').tobytes())  # PFM rows are bottom-up


def read_pfm(path: str) -> np.ndarray:
    with open(path, 'rb') as f:
        assert f.readline().strip() == b'PF'
        w, h = map(int, f.readline().split())
        scale = float(f.readline())
        data = np.frombuffer(f.read(), dtype='<f4' if scale < 0 else '>f4')
    return data.reshape(h, w, 3)[::-1].astype(np.float32)


def png(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255.0


def resample(a: np.ndarray, w: int, h: int) -> np.ndarray:
    ys = (np.arange(h) * a.shape[0] / h).astype(int)
    xs = (np.arange(w) * a.shape[1] / w).astype(int)
    return a[ys][:, xs]


def scene_inputs() -> dict[str, dict[str, np.ndarray]]:
    out: dict[str, dict[str, np.ndarray]] = {}
    for sid in ('spheres', 'eiffel'):
        d = os.path.join(SCENES, sid)
        out[sid] = {
            'color': png(os.path.join(d, 'spp4.png')),
            'albedo': png(os.path.join(d, 'albedo.png')),
            'normal': png(os.path.join(d, 'normal.png')) * 2.0 - 1.0,  # stored n*0.5+0.5
            'reference': png(os.path.join(d, 'reference.png')),
        }
    out['hdrdump'] = {k: read_pfm(os.path.join(HDRDUMP, f'{k}.pfm')) for k in ('color', 'albedo', 'normal')}
    return out


def native_flags(model: str, files: dict[str, str]) -> list[str]:
    ldr = '_ldr' in model
    flags = ['--ldr', files['color'], '--srgb'] if ldr else ['--hdr', files['color']]
    if 'calb_cnrm' in model:
        flags += ['--alb', files['albedo'], '--nrm', files['normal'], '--clean_aux']
    else:
        if '_alb' in model:
            flags += ['--alb', files['albedo']]
        if '_nrm' in model:
            flags += ['--nrm', files['normal']]
    return flags + ['-w', os.path.join(TZAS, f'{model}.tza')]


def run_native(bin_dir: str, device: str, flags: list[str], out: str | None, n: int) -> list[float]:
    cmd = [os.path.join(bin_dir, 'oidnDenoise'), '-d', device, *flags, '-n', str(n), '-v', '2']
    if out:
        cmd += ['-o', out]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    # "Denoising\n  msec=12.3, hash=..." per run
    return [float(m) for m in re.findall(r'Denoising\s+msec=([\d.]+)', res.stdout)]


def warm(times: list[float], skip: int = 2) -> dict[str, float]:
    t = times[skip:] or times
    return {'median': statistics.median(t), 'min': min(t), 'n': len(t)}


def channels(model: str) -> int:
    if 'calb_cnrm' in model or '_alb_nrm' in model:
        return 9
    return 6 if '_alb' in model else 3


def main() -> None:
    bin_dir = os.environ.get('OIDN_BIN')
    if not bin_dir:
        sys.exit('set OIDN_BIN to the native OIDN bin/ directory (oidnDenoise)')
    for sub in ('inputs', 'native'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    inputs = scene_inputs()
    files: dict[str, dict[str, dict[str, str]]] = {}
    for sid, imgs in inputs.items():
        files[sid] = {}
        for size, (w, h) in SIZES.items():
            files[sid][size] = {}
            for k, a in imgs.items():
                if k == 'reference' and size != '512':
                    continue
                a = a if size == '512' else resample(a, w, h)
                p = os.path.join(OUT, 'inputs', f'{sid}.{k}.{size}.pfm')
                write_pfm(p, f16(a))
                files[sid][size][k] = p

    plan, native = [], {}
    for sid, models in SCENE_MODELS.items():
        for model in models:
            key = f'{sid}/{model}'
            print(f'native {key} ...', flush=True)
            q = files[sid]['512']
            cpu_out = os.path.join(OUT, 'native', f'{sid}.{model}.cpu.pfm')
            metal_out = os.path.join(OUT, 'native', f'{sid}.{model}.metal.pfm')
            cpu512 = run_native(bin_dir, 'cpu', native_flags(model, q), cpu_out, 6)
            metal512 = run_native(bin_dir, 'metal', native_flags(model, q), metal_out, 14)
            hd = files[sid]['1080']
            cpu1080 = run_native(bin_dir, 'cpu', native_flags(model, hd), None, 4)
            metal1080 = run_native(bin_dir, 'metal', native_flags(model, hd), None, 14)
            native[key] = {
                'cpu': {'512': warm(cpu512, 1), '1080': warm(cpu1080, 1)},
                'metal': {'512': warm(metal512), '1080': warm(metal1080)},
            }
            metal_vs_cpu = float(np.abs(read_pfm(metal_out) - read_pfm(cpu_out)).max())
            native[key]['metalVsCpuMaxAbs'] = metal_vs_cpu
            plan.append({
                'scene': sid, 'model': model, 'channels': channels(model), 'hdr': sid == 'hdrdump',
                'inputs': {size: {k: os.path.relpath(p, OUT) for k, p in d.items()} for size, d in files[sid].items()},
                'native': {'cpu': os.path.relpath(cpu_out, OUT), 'metal': os.path.relpath(metal_out, OUT)},
            })
            n = native[key]
            print(f'  cpu {n["cpu"]["512"]["median"]:.1f} / {n["cpu"]["1080"]["median"]:.1f} ms · '
                  f'metal {n["metal"]["512"]["median"]:.2f} / {n["metal"]["1080"]["median"]:.2f} ms · '
                  f'metal vs cpu max|d| {metal_vs_cpu:.2e}', flush=True)

    version = subprocess.run([os.path.join(bin_dir, 'oidnDenoise'), '--ld'], capture_output=True, text=True).stdout
    json.dump({'device': version.strip(), 'binDir': bin_dir, 'results': native}, open(os.path.join(OUT, 'native.json'), 'w'), indent=1)
    json.dump(plan, open(os.path.join(OUT, 'plan.json'), 'w'), indent=1)
    print(f'\n{len(plan)} (scene, model) cases -> {OUT}/plan.json, native.json')


if __name__ == '__main__':
    main()
