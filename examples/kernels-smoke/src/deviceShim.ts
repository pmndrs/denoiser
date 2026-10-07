// WORKAROUND, demo only — do not ship.
//
// @huggingface/kernels (0.0.1-preview.3) creates its own GPUDevice via
// navigator.gpu.requestAdapter() + adapter.requestDevice() on the first kernel
// call, with no option to pass one in. That puts kernels on a different device
// from ORT / three.js / our own WGSL, so nothing can be shared without a CPU
// round trip. This shim answers that one requestAdapter() call with a fake
// adapter whose requestDevice() returns OUR device.
//
// Caveats:
// - Never call disposeSharedKernelRuntime() in this mode: it calls
//   device.destroy() — on the shared device.
// - Kernels picks variants from the features/limits it sees; it sees exactly
//   what the shared device was created with.
// - Restore it as soon as the kernels runtime exists (after the first call).

export function shareDeviceWithKernels(device: GPUDevice): () => void {
  const gpu = navigator.gpu;
  const original = gpu.requestAdapter;
  const fakeAdapter = {
    features: device.features,
    limits: device.limits,
    info: device.adapterInfo,
    isFallbackAdapter: false,
    requestDevice: async () => device,
    requestAdapterInfo: async () => device.adapterInfo,
  } as unknown as GPUAdapter;
  gpu.requestAdapter = async () => fakeAdapter;
  return () => {
    gpu.requestAdapter = original;
  };
}
