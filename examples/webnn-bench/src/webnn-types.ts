// Minimal WebNN typings (Chrome 154 surface, as probed by probe.html). Not exhaustive.
export type MLOperandDataType = 'float32' | 'float16' | 'int32';
export interface MLOperandDescriptor { dataType: MLOperandDataType; shape: number[] }
export interface MLTensorDescriptor extends MLOperandDescriptor { readable?: boolean; writable?: boolean }
// biome-ignore lint/suspicious/noEmptyInterface: opaque
export interface MLOperand {}
export interface MLTensor { readonly shape: number[]; readonly dataType: string; destroy(): void }
export interface MLGraph { destroy(): void }
export interface MLContext {
  createTensor(desc: MLTensorDescriptor): Promise<MLTensor>;
  createExportableTensor?(desc: MLOperandDescriptor, device: GPUDevice): Promise<MLTensor>;
  exportToGPU?(tensor: MLTensor): Promise<GPUBuffer>;
  writeTensor(tensor: MLTensor, data: ArrayBufferView | ArrayBuffer): void;
  readTensor(tensor: MLTensor): Promise<ArrayBuffer>;
  dispatch(graph: MLGraph, inputs: Record<string, MLTensor>, outputs: Record<string, MLTensor>): void;
  opSupportLimits(): Record<string, unknown>;
  destroy(): void;
}
export interface MLGraphBuilder {
  input(name: string, desc: MLOperandDescriptor): MLOperand;
  constant(desc: MLOperandDescriptor, data: ArrayBufferView): MLOperand;
  conv2d(input: MLOperand, filter: MLOperand, opts?: {
    padding?: number[]; strides?: number[]; dilations?: number[]; groups?: number;
    inputLayout?: 'nchw' | 'nhwc'; filterLayout?: 'oihw' | 'hwio' | 'ohwi' | 'ihwo'; bias?: MLOperand;
  }): MLOperand;
  clamp(x: MLOperand, opts?: { minValue?: number; maxValue?: number }): MLOperand;
  relu(x: MLOperand): MLOperand;
  maxPool2d(x: MLOperand, opts?: { windowDimensions?: number[]; strides?: number[]; layout?: 'nchw' | 'nhwc' }): MLOperand;
  resample2d(x: MLOperand, opts?: { mode?: 'nearest-neighbor' | 'linear'; scales?: number[]; sizes?: number[]; axes?: number[] }): MLOperand;
  concat(xs: MLOperand[], axis: number): MLOperand;
  transpose(x: MLOperand, opts?: { permutation?: number[] }): MLOperand;
  cast(x: MLOperand, type: MLOperandDataType): MLOperand;
  build(outputs: Record<string, MLOperand>): Promise<MLGraph>;
}
export interface ML {
  createContext(opts?: { deviceType?: 'cpu' | 'gpu' | 'npu'; powerPreference?: string } | GPUDevice): Promise<MLContext>;
}
export const ml = (navigator as unknown as { ml?: ML }).ml;
export const MLGraphBuilderCtor = (globalThis as unknown as { MLGraphBuilder?: new (ctx: MLContext) => MLGraphBuilder }).MLGraphBuilder;
