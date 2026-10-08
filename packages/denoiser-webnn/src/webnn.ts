// Minimal WebNN typings — the surface Chrome 154/157 ships behind
// `--enable-features=WebMachineLearningNeuralNetwork` (probed, not exhaustive).
export type MLOperandDataType = 'float32' | 'float16' | 'int32';
export type MLDeviceType = 'cpu' | 'gpu' | 'npu';
export interface MLOperandDescriptor { dataType: MLOperandDataType; shape: number[] }
export interface MLTensorDescriptor extends MLOperandDescriptor { readable?: boolean; writable?: boolean }
export interface MLOperand { readonly dataType?: string; readonly shape?: number[] }
export interface MLTensor { readonly shape: number[]; readonly dataType: string; destroy(): void }
export interface MLGraph { destroy(): void }
export interface MLContext {
  createTensor(desc: MLTensorDescriptor): Promise<MLTensor>;
  /** WebNN <-> WebGPU interop (Chrome): float16 only today. */
  createExportableTensor?(desc: MLOperandDescriptor, device: GPUDevice): Promise<MLTensor>;
  /** Hands the tensor to WebGPU as a new GPUBuffer; WebNN can't use it until that buffer is destroyed. */
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
  maxPool2d(x: MLOperand, opts?: { windowDimensions?: number[]; strides?: number[]; layout?: 'nchw' | 'nhwc' }): MLOperand;
  resample2d(x: MLOperand, opts?: { mode?: 'nearest-neighbor' | 'linear'; scales?: number[]; sizes?: number[]; axes?: number[] }): MLOperand;
  concat(xs: MLOperand[], axis: number): MLOperand;
  transpose(x: MLOperand, opts?: { permutation?: number[] }): MLOperand;
  build(outputs: Record<string, MLOperand>): Promise<MLGraph>;
}
export interface ML {
  createContext(opts?: { deviceType?: MLDeviceType; powerPreference?: string } | GPUDevice): Promise<MLContext>;
}

export function getML(): ML | undefined {
  return (globalThis.navigator as unknown as { ml?: ML } | undefined)?.ml;
}

export function newGraphBuilder(ctx: MLContext): MLGraphBuilder {
  const Ctor = (globalThis as unknown as { MLGraphBuilder?: new (c: MLContext) => MLGraphBuilder }).MLGraphBuilder;
  if (!Ctor) throw new Error('WebnnRuntime: MLGraphBuilder unavailable');
  return new Ctor(ctx);
}
