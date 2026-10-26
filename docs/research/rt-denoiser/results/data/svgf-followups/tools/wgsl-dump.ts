// WGSL of the SVGF passes at their default (and existing-option) variants, for a src dir given at build time
import { atrousPass, variancePass, temporalPass } from 'SRC/shaders/svgf';
import { gradientCreatePassV2, gradientAtrousPassV2, gradientLambdaPassV2 } from 'SRC/shaders/gradient';
const out: Record<string, string> = {};
const KS = [['diffuse', 'specular'], ['diffuse'], ['specular'], ['diffuse', 'diffuse']] as const;
for (const ks of KS) {
  const k = [...ks] as never[];
  const tag = ks.join('+');
  out[`temporal_${tag}`] = temporalPass(k).code;
  for (const fb of ['off', 'strict'] as const) out[`temporal_${tag}_fb${fb}`] = temporalPass(k, { fallback: fb }).code;
  out[`temporal_${tag}_rel`] = temporalPass(k, { normalTest: 'relative' }).code;
  if (ks.includes('specular' as never)) {
    for (const m of ['virtual', 'dual'] as const) out[`temporal_${tag}_${m}`] = temporalPass(k, { reflection: ks.map((s) => (s === 'specular' ? m : 'surface')) as never, hitTest: ks.map(() => true) }).code;
  }
  for (let it = 0; it < 5; it++) {
    const t = 1 << it;
    const tile = t <= 4 ? { tile: t } : {};
    for (const young of [{}, { youngNormal: ks.map((s) => s === 'diffuse'), sharedDepth: ks.length > 1, youngTile: true }, { youngLum: ks.map(() => true) }]) {
      for (const box of [true, false]) {
        if (!box && t <= 4) continue;
        out[`atrous_${tag}_${it}_${JSON.stringify(young)}_${box}`] = atrousPass(k, { writeHist: false, last: it === 4, box, ...young, ...(box ? tile : {}) } as never).code;
        out[`atrous_fb_${tag}_${it}_${JSON.stringify(young)}_${box}`] = atrousPass(k, { writeHist: it === 0, last: it === 4, box, ...young, ...(box ? tile : {}) } as never).code;
      }
    }
  }
  out[`variance_${tag}`] = variancePass(k, { tile: true }).code;
  out[`variance_${tag}_yf`] = variancePass(k, { tile: true, youngFlag: ks.map(() => true) }).code;
  out[`variance_${tag}_hw`] = variancePass(k, { historyWeight: ks.map(() => true) }).code;
  for (const fi of [false, true]) out[`gcreate_${tag}_${fi}`] = gradientCreatePassV2(ks.length, fi).code;
  out[`gatrous_${tag}`] = gradientAtrousPassV2(ks.length).code;
  out[`glambda_${tag}`] = gradientLambdaPassV2(ks.length).code;
  out[`gcreate_chroma_${tag}`] = gradientCreatePassV2(ks.length, false, { chroma: true }).code;
  out[`glambda_gain_${tag}`] = gradientLambdaPassV2(ks.length, { gain: ks.map(() => 2) }).code;
}
console.log(JSON.stringify(out));
