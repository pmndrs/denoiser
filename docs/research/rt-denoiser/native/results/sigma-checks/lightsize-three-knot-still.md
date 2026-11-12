# three-knot-still: replay scores

960×540, 32 frames, resets at [0], referenceSpp 64. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-sigma-ls1 | visibility | 16.79 → **21.47** | 21.47 | 21.47 | 21.48 | 21.48 | 21.49 | 12.53 | 12.53 | 0.0474 → 0.0152 | 0.0069 | 0 | 0.352 | 0.51 |
| nrd-sigma-ls16 | visibility | 16.79 → **20.54** | 20.54 | 20.54 | 20.56 | 20.56 | 20.55 | 12.28 | 12.28 | 0.0474 → 0.0156 | 0.0132 | 0 | 0.353 | 0.76 |
| nrd-sigma-ls4 | visibility | 16.79 → **21.06** | 21.06 | 21.06 | 21.08 | 21.08 | 21.08 | 12.38 | 12.38 | 0.0474 → 0.0153 | 0.0077 | 0 | 0.352 | 0.76 |
