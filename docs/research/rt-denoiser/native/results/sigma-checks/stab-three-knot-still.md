# three-knot-still: replay scores

960×540, 32 frames, resets at [0], referenceSpp 64. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-sigma-stab0 | visibility | 16.79 → **21.37** | 21.37 | 21.37 | 21.38 | 21.38 | 21.39 | 12.43 | 12.43 | 0.0474 → 0.0187 | 0.0121 | 0 | 0.263 | 0.55 |
| nrd-sigma-stab5 | visibility | 16.79 → **21.47** | 21.47 | 21.47 | 21.48 | 21.48 | 21.49 | 12.53 | 12.53 | 0.0474 → 0.0152 | 0.0069 | 0 | 0.346 | 0.63 |
