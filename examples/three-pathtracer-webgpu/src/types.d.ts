/// <reference types="@webgpu/types" />

// three-gpu-pathtracer ships types for its root and `/webgpu` entries; this
// deep import (the WebGL-free texture source) has none.
declare module 'three-gpu-pathtracer/src/textures/GradientEquirectTexture.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const GradientEquirectTexture: any;
}
