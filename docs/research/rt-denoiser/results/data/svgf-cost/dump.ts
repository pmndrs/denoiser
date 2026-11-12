// dump the WGSL of the default joint SVGF passes (a-trous per iteration + variance) for a src dir given at build time
import { atrousPass, variancePass } from 'SRC/shaders/svgf';
const kinds = ['diffuse', 'specular'] as const;
const out: Record<string, string> = {};
const young = { youngNormal: [true, false], sharedDepth: true };
for (let it = 0; it < 5; it++) {
  const t = 1 << it;
  const tile = t <= 4 ? { tile: t, tileForm: 'packed' } : {};
  out[`atrous_${it}`] = atrousPass([...kinds], { writeHist: false, last: it === 4, box: true, ...young, ...tile } as never).code;
  out[`atrous_fb_${it}`] = atrousPass([...kinds], { writeHist: it === 0, last: it === 4, box: true, ...tile } as never).code;
}
out.variance = variancePass([...kinds], { tile: true }).code;
out.varianceAo = variancePass(['diffuse', 'diffuse'], { tile: true }).code;
console.log(JSON.stringify(out));
