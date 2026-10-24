// GuidePass: the per-frame camera uniform plus the geometry prepass shared by
// every signal (one pass even when diffuse and specular are denoised together).
// Owns the packed-geometry ping-pong (this frame / previous frame).
import type { FrameCamera, FrameGuides } from '@pmndrs/denoiser-core';
import { eyeFromView, invert, isDepthFormat, mat4, type PassTimer } from './common';
import { makeBindGroup, makeLayout, makePipeline, runPass, storageTex } from './gpu';
import {
  FRAME_HAS_MOTIONZ, FRAME_HAS_ROUGHNESS, FRAME_HAS_VIEWZ, FRAME_RESET, FRAME_SIZE,
} from './shaders/common';
import { prepassWgsl } from './shaders/prepass';

export class GuidePass {
  readonly frame: GPUBuffer;
  /** 1x1 zero textures for optional inputs. */
  readonly dummy: GPUTexture;
  readonly dummy32: GPUTexture;
  readonly sampler: GPUSampler;
  private geo: GPUTexture[] = [];
  private grad?: GPUTexture;
  private cur = 0;
  private frameIndex = 0;
  private layouts: Record<'depth' | 'float', GPUBindGroupLayout>;
  private pipes: Record<'depth' | 'float', GPUComputePipeline>;
  width = 0;
  height = 0;

  constructor(private device: GPUDevice, private label: string) {
    this.frame = device.createBuffer({ label: `${label} frame`, size: FRAME_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dummy = device.createTexture({ label: `${label} dummy`, size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummy32 = device.createTexture({ label: `${label} dummy32`, size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.layouts = {
      depth: makeLayout(device, `${label} prepass (depth)`, ['u', 'd', 'f', 'f', 'f', 'rg32uint', 'r32uint']),
      float: makeLayout(device, `${label} prepass (float)`, ['u', 'f', 'f', 'f', 'f', 'rg32uint', 'r32uint']),
    };
    this.pipes = {
      depth: makePipeline(device, `${label} prepass (depth)`, prepassWgsl(true), this.layouts.depth),
      float: makePipeline(device, `${label} prepass (float)`, prepassWgsl(false), this.layouts.float),
    };
  }

  configure(width: number, height: number) {
    this.destroyTargets();
    this.width = width;
    this.height = height;
    this.geo = [0, 1].map((i) => this.device.createTexture({
      label: `${this.label} geometry ${i}`, size: [width, height], format: 'rg32uint', usage: storageTex(),
    }));
    this.grad = this.device.createTexture({
      label: `${this.label} depth slope`, size: [width, height], format: 'r32uint', usage: storageTex(),
    });
    this.cur = 0;
  }

  get geoCur(): GPUTexture { return this.geo[this.cur]; }
  get geoPrev(): GPUTexture { return this.geo[this.cur ^ 1]; }
  /** Depth slope of the current frame (r32uint, pack2x16float). */
  get geoGrad(): GPUTexture { return this.grad!; }

  /** Writes the frame uniform and records the prepass. */
  encode(enc: GPUCommandEncoder, timer: PassTimer | undefined, guides: FrameGuides, camera: FrameCamera, reset: boolean) {
    const V = mat4(camera.view), P = mat4(camera.projection);
    const Vp = mat4(camera.prevView), Pp = mat4(camera.prevProjection);
    const f = new Float32Array(FRAME_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    f.set(invert(P), 0);
    f.set(invert(V), 16);
    f.set(V, 32);
    f.set(Vp, 48);
    f.set(invert(Pp), 64);
    f.set(invert(Vp), 80);
    f[96] = this.width; f[97] = this.height; f[98] = 1 / this.width; f[99] = 1 / this.height;
    f.set(camera.position ?? eyeFromView(V), 100); f[103] = camera.near;
    f.set(eyeFromView(Vp), 104); f[107] = camera.far;
    u[108] = (reset ? FRAME_RESET : 0) | (guides.viewZ ? FRAME_HAS_VIEWZ : 0)
      | (guides.motionZ ? FRAME_HAS_MOTIONZ : 0) | (guides.roughness ? FRAME_HAS_ROUGHNESS : 0);
    u[109] = this.frameIndex++;
    this.device.queue.writeBuffer(this.frame, 0, f);

    const kind = isDepthFormat(guides.depth.format) ? 'depth' : 'float';
    const depthView = kind === 'depth' ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    runPass(enc, timer, 'prepass', this.pipes[kind], makeBindGroup(this.device, this.layouts[kind], [
      this.frame, depthView, guides.viewZ ?? this.dummy, guides.normal, guides.roughness ?? this.dummy, this.geoCur, this.grad!,
    ]), Math.ceil(this.width / 8), Math.ceil(this.height / 8));
  }

  /** Call after the frame's passes are recorded: this frame becomes "previous". */
  endFrame() { this.cur ^= 1; }

  private destroyTargets() {
    for (const t of this.geo) t.destroy();
    this.grad?.destroy();
    this.geo = [];
    this.grad = undefined;
  }

  dispose() {
    this.destroyTargets();
    this.frame.destroy();
    this.dummy.destroy();
    this.dummy32.destroy();
  }
}
