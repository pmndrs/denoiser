import type { Mesh, Object3D } from 'three';

export interface UnwrapOptions {
  attribute?: 'uv' | 'uv1' | 'uv2' | 'uv3';
  mode?: 'lightmap' | 'normal';
  resolution?: number;
  padding?: number;
  texelsPerUnit?: number;
  respectUVSeams?: boolean;
  useInputUVs?: boolean;
}
export interface UnwrapResult {
  attribute: string;
  resolution: number;
  padding: number;
  texelsPerUnit: number;
  charts: { x: number; y: number; width: number; height: number }[];
  meshes: { mesh: Mesh; sourceVertices: Uint32Array; faceCharts: Int32Array }[];
}
export function unwrapUVs(root: Object3D, options?: UnwrapOptions): UnwrapResult | null;
