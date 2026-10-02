// studio-three-renderer.ts: the studio's one three.js setup, a three/webgpu renderer on an owner's device
// (gpu-device-owner.ts). It never draws to a canvas of its own: everything renders into a target, often one drawn
// into a texture of ours (targetInto), and a canvas shows a texture through gpu-canvas-output.ts.
//
// No WebGL fallback: stamp painting needs WebGPU, the render browser refuses a frame without a hardware adapter
// (render-browser.ts), and a second backend would be a second look to keep equal.

import {
  FloatType, HalfFloatType, Line, Mesh, Points, RenderTarget, UnsignedByteType, WebGPUBackend, WebGPURenderer, type BufferGeometry, type Material, type Object3D, type Texture,
} from 'three/webgpu';

export type StudioThreeRenderer = {
  renderer: WebGPURenderer;
  /**
   * A target three renders into `texture` through: its colour is our texture (three's own would be reachable only
   * through its backend's private map, and remade on a resize), multisampled `samples` times, with a depth buffer.
   * Several textures, of one size and format, are its attachments in order, each named by `names` for setMRT.
   */
  targetInto: (texture: GPUTexture | readonly { name: string; texture: GPUTexture }[], options?: { samples?: number }) => RenderTarget;
  dispose: () => void;
};

/** Something three draws from a geometry and its materials. */
export type ThreeGeometryDrawable = Object3D & { geometry: BufferGeometry; material: Material | Material[] };

/** Whether `object` is a mesh, points or a line: three's generic classes narrow to `any` geometry under instanceof. */
export const isThreeGeometryDrawable = (object: Object3D): object is ThreeGeometryDrawable => object instanceof Mesh || object instanceof Points || object instanceof Line;

/**
 * three's WebGPU backend with r186's setXRRenderTargetTextures, which registers a GPUTexture as a target's colour. It
 * reads only the target's `texture`.
 */
type OwnColourBackend = WebGPUBackend & { setXRRenderTargetTextures: (target: { texture: Texture }, color: GPUTexture) => void };

/**
 * Whether `backend` can render into a texture it's given. setXRRenderTargetTextures was built for WebXR and
 * @types/three leaves it out, so it's checked at load: a three upgrade that drops it fails there, not in a frame.
 */
function isOwnColourBackend(backend: unknown): backend is OwnColourBackend {
  return backend instanceof WebGPUBackend && 'setXRRenderTargetTextures' in backend && typeof backend.setXRRenderTargetTextures === 'function';
}

/** three's texel type for a texture of ours, so a multisampled target resolves into the same format. */
const TARGET_TYPES: Partial<Record<GPUTextureFormat, typeof HalfFloatType | typeof FloatType | typeof UnsignedByteType>> = {
  rgba16float: HalfFloatType, rgba32float: FloatType, rgba8unorm: UnsignedByteType,
};

/** The renderer on `device`, initialised; a target's clear is transparent black unless its user sets another. */
export async function createStudioThreeRenderer(device: GPUDevice): Promise<StudioThreeRenderer> {
  const renderer = new WebGPURenderer({ device, antialias: false, alpha: true });
  await renderer.init();
  renderer.setClearColor(0x000000, 0);
  const { backend } = renderer;
  if (!isOwnColourBackend(backend)) {
    void renderer.dispose();
    throw new Error('gpu: this three.js has no WebGPU backend that renders into a texture it\'s given (setXRRenderTargetTextures)');
  }
  return {
    renderer,
    targetInto: (given, { samples = 1 } = {}) => {
      const named = given instanceof GPUTexture ? [{ name: 'output', texture: given }] : given;
      const [{ texture }] = named;
      const type = TARGET_TYPES[texture.format];
      if (!type) throw new Error(`gpu: three renders into ${Object.keys(TARGET_TYPES).join(', ')}, not ${texture.format}`);
      const target = new RenderTarget(texture.width, texture.height, { type, depthBuffer: true, samples: samples > 1 ? samples : 0, count: named.length });
      // setXRRenderTargetTextures registers a target's first texture; handed another attachment's, it registers that.
      named.forEach(({ name, texture: own }, i) => {
        target.textures[i].name = name;
        backend.setXRRenderTargetTextures({ texture: target.textures[i] }, own);
      });
      return target;
    },
    // Not awaited: three frees its targets, textures and pipelines before its first await, and the owner destroys
    // the device after.
    dispose: () => {
      void renderer.dispose();
    },
  };
}
