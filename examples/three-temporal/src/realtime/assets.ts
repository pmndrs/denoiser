// Third-party scenes for the realtime pages (?scene=sponza | bistro): Crytek Sponza (Khronos glTF-Sample-Assets)
// and the Amazon Lumberyard Bistro exterior, geometry only. Neither model is in this repository: the dev server
// serves them from a folder outside git (scene-assets-plugin.ts, CAPTURES.md "Bistro and Sponza").
//
// The loader is a minimal glTF 2.0 reader (both files are plain float32 positions / normals and uint16 / uint32
// triangle lists, no Draco, no quantization): node transforms are baked into world space, textures, UVs and
// tangents are never read, BLEND materials (Bistro's one decal glass) are dropped, MASK foliage is solid. Each
// material becomes one merged mesh with a flat colour (name keywords for Bistro, an index palette for Sponza's
// unnamed materials) and a roughness; the floor / pavement materials are glossy so SSR has something to reflect.
// The BVH gets one merged geometry of everything static (one BLAS: material groups overlap in space, so a
// TLAS over them would visit many BLASes per ray).
import * as THREE from 'three/webgpu';

export type AssetScene = 'sponza' | 'bistro';

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; name?: string }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number; material?: number }[] }[];
  materials?: { name?: string; alphaMode?: string; doubleSided?: boolean }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
}

export interface AssetMaterial { name: string; color: number; roughness: number; doubleSided: boolean; floor: boolean }
export interface LoadedAsset {
  /** One merged mesh per (kept) material, world space, position + normal + index. */
  meshes: THREE.Mesh[];
  /** Everything static merged into one geometry (position + index) for the BVH. */
  bvhGeometry: THREE.BufferGeometry;
  materials: AssetMaterial[];
  triangles: number;
  bounds: THREE.Box3;
  loadMs: { fetch: number; parse: number };
}

const URLS: Record<AssetScene, string[]> = {
  sponza: ['/__scene-assets/sponza/Sponza.gltf', '/__scene-assets/sponza/Sponza.bin'],
  bistro: ['/__scene-assets/bistro/bistro-uncompressed.glb'],
};

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
  return r.arrayBuffer();
}

function readGlb(glb: ArrayBuffer): { json: GltfJson; bin: Uint8Array<ArrayBuffer> } {
  const v = new DataView(glb);
  if (v.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (missing file answered with a page?)');
  let json: GltfJson | null = null, bin: Uint8Array<ArrayBuffer> | null = null;
  for (let at = 12; at + 8 <= glb.byteLength;) {
    const len = v.getUint32(at, true), type = v.getUint32(at + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, at + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(glb, at + 8, len);
    at += 8 + ((len + 3) & ~3);
  }
  if (!json || !bin) throw new Error('GLB needs a JSON and a BIN chunk');
  return { json, bin };
}

const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(json: GltfJson, bin: Uint8Array<ArrayBuffer>, i: number): Float32Array | Uint16Array | Uint32Array {
  const a = json.accessors[i];
  const view = json.bufferViews[a.bufferView!];
  const n = NCOMP[a.type] * a.count;
  const off = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const C = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : a.componentType === 5123 ? Uint16Array : null;
  if (!C || a.normalized) throw new Error(`accessor ${i}: component type ${a.componentType} not supported`);
  const stride = view.byteStride ?? 0;
  if (stride && stride !== C.BYTES_PER_ELEMENT * NCOMP[a.type]) throw new Error(`accessor ${i}: interleaved`);
  if (off % C.BYTES_PER_ELEMENT === 0) return new C(bin.buffer, off, n);
  return new C(bin.buffer.slice(off, off + n * C.BYTES_PER_ELEMENT));
}

// ---- materials ---------------------------------------------------------------------------------------------

/** Bistro: flat colour + roughness from the material name (first matching keyword wins). Linear-ish sRGB hex. */
const BISTRO_RULES: [RegExp, number, number][] = [
  [/Wet/i, 0x55524c, 0.12],                       // wet pavement: glossy (SSR)
  [/Pavement|Cobble|Curbstone|Manhole/i, 0x7c766c, 0.35],
  [/Foliage.*(Leaves|leaf|Hedges|Flowers)/i, 0x4f6b35, 0.8],
  [/Foliage|Trunk|branches/i, 0x5a4634, 0.85],
  [/Brick.*Red/i, 0x8e4a3a, 0.75],
  [/Brick/i, 0xb9a88e, 0.75],
  [/Roof/i, 0x5d6268, 0.6],
  [/Glass/i, 0x2c3338, 0.08],
  [/Awning.*Red|Red_Color/i, 0x8f2e2a, 0.7],
  [/Awning.*Cyan|Cyan|Blue/i, 0x2f6e78, 0.7],
  [/Awning|Fabric|Curtain/i, 0x9a8a6a, 0.8],
  [/Green/i, 0x3d5a3c, 0.6],
  [/Wood/i, 0x6e5038, 0.55],
  [/Metal|Bronze|Chains|Pipe|Antenna|Bollard|Streetlight|Lantern|Pivot/i, 0x3a3a3c, 0.4],
  [/Plaster|Concrete|Balcony|Trim|Cornice|Building/i, 0xc4b79e, 0.8],
];
const SPONZA_PALETTE = [0xb9b2a4, 0xa89b86, 0x9c8f7c, 0xb8aa94, 0x8f8a80, 0xa6665a, 0x7d8f6a, 0x7a86a3, 0xc2b79d, 0x948672];

function materialOf(scene: AssetScene, i: number, def: { name?: string; doubleSided?: boolean } | undefined): AssetMaterial {
  const name = def?.name ?? `material-${i}`;
  if (scene === 'bistro') {
    const r = BISTRO_RULES.find(([re]) => re.test(name));
    return { name, color: r?.[1] ?? 0xa89c88, roughness: r?.[2] ?? 0.7, doubleSided: !!def?.doubleSided, floor: !!r && r[2] <= 0.35 && /Pavement|Cobble|Wet|Curb|Manhole/i.test(name) };
  }
  return { name, color: SPONZA_PALETTE[i % SPONZA_PALETTE.length], roughness: 0.7, doubleSided: !!def?.doubleSided, floor: false };
}

// ---- load ----------------------------------------------------------------------------------------------------

export interface LoadOptions {
  /** Keep only triangles whose centroid is inside this box (world, metres): a documented subset. */
  cull?: THREE.Box3;
}

export async function loadAsset(scene: AssetScene, opts: LoadOptions = {}): Promise<LoadedAsset> {
  const t0 = performance.now();
  let json: GltfJson, bin: Uint8Array<ArrayBuffer>;
  if (scene === 'bistro') {
    ({ json, bin } = readGlb(await fetchBytes(URLS.bistro[0])));
  } else {
    const [g, b] = await Promise.all(URLS.sponza.map(fetchBytes));
    json = JSON.parse(new TextDecoder().decode(g));
    bin = new Uint8Array(b);
  }
  const t1 = performance.now();

  const defs = json.materials ?? [];
  const mats = defs.map((d, i) => materialOf(scene, i, d));
  // per material: lists of (positions, normals, index) chunks, world space
  const groups = new Map<number, { p: Float32Array[]; n: Float32Array[]; idx: Uint32Array[]; verts: number; tris: number; floorArea: number; area: number }>();
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), cen = new THREE.Vector3();
  const local = (nd: GltfJson['nodes'][number]) => nd.matrix ? new THREE.Matrix4().fromArray(nd.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3(...((nd.translation ?? [0, 0, 0]) as [number, number, number])),
    new THREE.Quaternion(...((nd.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
    new THREE.Vector3(...((nd.scale ?? [1, 1, 1]) as [number, number, number])));
  const visit = (ni: number, parent: THREE.Matrix4) => {
    const nd = json.nodes[ni];
    const world = parent.clone().multiply(local(nd));
    if (nd.mesh !== undefined) {
      for (const prim of json.meshes[nd.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4 || prim.indices === undefined) continue;
        const mi = prim.material ?? 0;
        if (defs[mi]?.alphaMode === 'BLEND') continue;
        const pos = accessor(json, bin, prim.attributes.POSITION) as Float32Array;
        const nrm = prim.attributes.NORMAL !== undefined ? accessor(json, bin, prim.attributes.NORMAL) as Float32Array : null;
        const src = accessor(json, bin, prim.indices);
        m4.copy(world); nm.getNormalMatrix(m4);
        const nv = pos.length / 3;
        const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3);
        for (let i = 0; i < nv; i++) {
          v.fromArray(pos, i * 3).applyMatrix4(m4); v.toArray(p, i * 3);
          if (nrm) { v.fromArray(nrm, i * 3).applyMatrix3(nm).normalize(); v.toArray(n, i * 3); }
        }
        // cull (optional) and per-material floor statistics
        let keep: number[] | null = opts.cull ? [] : null;
        const g = groups.get(mi) ?? { p: [], n: [], idx: [], verts: 0, tris: 0, floorArea: 0, area: 0 };
        for (let t = 0; t < src.length; t += 3) {
          ta.fromArray(p, src[t] * 3); tb.fromArray(p, src[t + 1] * 3); tc.fromArray(p, src[t + 2] * 3);
          if (keep) { cen.copy(ta).add(tb).add(tc).multiplyScalar(1 / 3); if (!opts.cull!.containsPoint(cen)) continue; keep.push(t); }
          const cr = tb.clone().sub(ta).cross(tc.clone().sub(ta));
          const area = cr.length() / 2;
          g.area += area;
          if (cr.y / Math.max(cr.length(), 1e-12) > 0.9 && (ta.y + tb.y + tc.y) / 3 < 0.3) g.floorArea += area;
        }
        const nt = keep ? keep.length : src.length / 3;
        if (!nt) continue;
        const idx = new Uint32Array(nt * 3);
        if (keep) keep.forEach((t, k) => { idx[k * 3] = src[t] + g.verts; idx[k * 3 + 1] = src[t + 1] + g.verts; idx[k * 3 + 2] = src[t + 2] + g.verts; });
        else for (let k = 0; k < src.length; k++) idx[k] = src[k] + g.verts;
        if (!nrm) { const tmp = new THREE.BufferGeometry(); tmp.setAttribute('position', new THREE.BufferAttribute(p, 3)); tmp.setIndex(new THREE.BufferAttribute(new Uint32Array(src), 1)); tmp.computeVertexNormals(); n.set(tmp.getAttribute('normal').array as Float32Array); }
        g.p.push(p); g.n.push(n); g.idx.push(idx); g.verts += nv; g.tris += nt;
        groups.set(mi, g);
      }
    }
    for (const c of nd.children ?? []) visit(c, world);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i);
  for (const r of roots) visit(r, new THREE.Matrix4());

  // Sponza's materials have no names: the material with the most up-facing area at floor height is the floor
  if (scene === 'sponza') {
    let best = -1, bestA = 0;
    for (const [mi, g] of groups) if (g.floorArea > bestA) { bestA = g.floorArea; best = mi; }
    if (best >= 0) { mats[best].floor = true; mats[best].roughness = 0.18; mats[best].color = 0xa39a8a; }
  }

  const cat = <T extends Float32Array | Uint32Array>(C: new (n: number) => T, parts: T[]) => {
    const out = new C(parts.reduce((a, x) => a + x.length, 0));
    let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  };
  const meshes: THREE.Mesh[] = [];
  const bvhP: Float32Array[] = [], bvhI: Uint32Array[] = [];
  let bvhVerts = 0, triangles = 0;
  const bounds = new THREE.Box3();
  for (const [mi, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    const geo = new THREE.BufferGeometry();
    const P = cat(Float32Array, g.p), I = cat(Uint32Array, g.idx);
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cat(Float32Array, g.n), 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    bounds.union(geo.boundingBox!);
    const md = mats[mi] ?? materialOf(scene, mi, undefined);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: md.color, roughness: md.roughness, metalness: 0, side: md.doubleSided ? THREE.DoubleSide : THREE.FrontSide }));
    mesh.name = `${scene}-${md.name}`;
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
    bvhP.push(P);
    const J = new Uint32Array(I.length); for (let k = 0; k < I.length; k++) J[k] = I[k] + bvhVerts;
    bvhI.push(J); bvhVerts += P.length / 3; triangles += g.tris;
  }
  const bvhGeometry = new THREE.BufferGeometry();
  bvhGeometry.setAttribute('position', new THREE.BufferAttribute(cat(Float32Array, bvhP), 3));
  bvhGeometry.setIndex(new THREE.BufferAttribute(cat(Uint32Array, bvhI), 1));
  return { meshes, bvhGeometry, materials: mats, triangles, bounds, loadMs: { fetch: Math.round(t1 - t0), parse: Math.round(performance.now() - t1) } };
}
