// assemble <cap>-ng: hard links to every file of captures/<cap> + normal_geom.f32 from captures/ng-<cap>;
// checks that ng-<cap>'s depth / normal / motion equal the original's (same poses), byte for byte
import { readFileSync, writeFileSync, mkdirSync, linkSync, existsSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
const C = '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/captures';
const cap = process.argv[2];
const src = path.join(C, cap), ng = path.join(C, `ng-${cap}`), dst = path.join(C, `${cap}-ng`);
const m = JSON.parse(readFileSync(path.join(src, 'capture.json'), 'utf8'));
let bad = 0;
mkdirSync(dst, { recursive: true });
for (let f = 0; f < m.frames.length; f++) {
  const fd = `frame_${String(f).padStart(4, '0')}`;
  for (const b of ['depth', 'normal', 'motion', 'viewz']) {
    const a = readFileSync(path.join(src, fd, `${b}.f32`)), c = readFileSync(path.join(ng, fd, `${b}.f32`));
    if (!a.equals(c)) { bad++; if (bad < 5) console.log('DIFF', fd, b); }
  }
  mkdirSync(path.join(dst, fd), { recursive: true });
  for (const file of readdirSync(path.join(src, fd))) { const t = path.join(dst, fd, file); if (!existsSync(t)) linkSync(path.join(src, fd, file), t); }
  const t = path.join(dst, fd, 'normal_geom.f32'); if (!existsSync(t)) linkSync(path.join(ng, fd, 'normal_geom.f32'), t);
}
m.version = 1;
if (!m.buffers.some((b) => b.name === 'normal_geom')) m.buffers.push({ name: 'normal_geom', channels: 3 });
m.extra = { ...(m.extra ?? {}), normalGeom: `normal_geom from captures/ng-${cap} (examples/three-temporal &normalGeom=1, same poses: depth / normal / motion / viewz byte-identical: ${bad === 0})` };
writeFileSync(path.join(dst, 'capture.json'), JSON.stringify(m, null, 1));
console.log(cap, 'assembled', dst, 'pose mismatches', bad);
