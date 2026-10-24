// scenes.ts (shared with the Pipeline Lab) imports this tracer source file, which ships no types
declare module 'three-gpu-pathtracer/src/textures/GradientEquirectTexture.js' {
  import { DataTexture } from 'three';
  export class GradientEquirectTexture extends DataTexture {
    constructor(resolution?: number);
    topColor: import('three').Color;
    bottomColor: import('three').Color;
    exponent: number;
    update(): void;
  }
}
