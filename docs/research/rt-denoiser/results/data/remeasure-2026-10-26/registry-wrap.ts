// Scratch registry wrapper (timing evaluator, 2026-10-26; same as the 2026-10-25 remeasure's): re-exports the project
// registry and adds j-<id> = the registry entry <id> forced to its joint (two-signal) instance, registered for one
// signal only, so the test bed's bench times the joint dispatch. Option variants come from the page URL's settings.
export * from '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/src/denoisers';
import { DENOISERS, registerDenoiser } from '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/src/denoisers';

function forced(id: string, as: string, signals: string[]) {
  const base = DENOISERS.get(id);
  if (!base) throw new Error('timing wrap: no registry entry ' + id);
  registerDenoiser({
    id: 'j-' + id, description: 'scratch: ' + id + ' forced joint (' + signals.join('+') + '), registered for ' + as,
    signals: [as] as never,
    create: (device, ctx) => base.create(device, { ...ctx, signals: signals as never }),
  });
}
for (const id of ['svgf', 'svgf-auto', 'recurrent', 'recurrent-svgfspec']) forced(id, 'diffuse', ['diffuse', 'specular']);
for (const id of ['occlusion-svgf', 'occlusion-svgf-auto', 'occlusion-recurrent']) forced(id, 'ao', ['ao', 'so']);
