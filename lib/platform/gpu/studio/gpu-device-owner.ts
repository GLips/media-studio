// gpu-device-owner.ts: the one owner of a WebGPU device the studio draws on, and of the one three.js renderer on it
// (studio-three-renderer.ts). Stamp painting builds its owner on this one (stamp-paint-gpu-owner.ts); three.js
// scenes, previs blockouts and model guides take one each.
//
// Warning: error scopes are one stack per device. A synchronous check pops within its task, so it nests inside
// anything open. An asynchronous one (three.js's loads) stays open across awaits, so they run one after another:
// two open at once would pop each other's scopes.

import { gpuDeviceLostText } from '../models/gpu-device-lost.ts';
import { createStudioThreeRenderer, type StudioThreeRenderer } from './studio-three-renderer.ts';

const GPU_ERROR_SCOPES = ['validation', 'out-of-memory', 'internal'] as const;

// SAFETY: a real WebGPU feature name, newer than TypeScript's DOM lib; an adapter without it is refused below.
const TIER2 = 'texture-formats-tier2' as GPUFeatureName;
/**
 * What every studio device has: half-float storage textures (stamp painting's), and 32-bit float targets that blend
 * and filter (an exposure sum, a guide image). One kind of device, so anything may draw on any owner.
 */
const STUDIO_GPU_FEATURES: readonly GPUFeatureName[] = [TIER2, 'float32-blendable', 'float32-filterable'];

export type GpuDeviceOwner = {
  /** The device itself. */
  webgpu: GPUDevice;
  /**
   * Runs `work`, which mustn't await, and resolves with what it returns once WebGPU has checked it, or rejects naming
   * `what` and the error. Its scopes are popped before any other work can push one, so checks never catch each
   * other's errors.
   */
  checked: <T>(what: string, work: () => T) => Promise<T>;
  /**
   * Runs `work`, which may await, once every asynchronous check asked for before it is done, and resolves or rejects
   * as `checked` does. Its errors are those of the work done meanwhile outside any synchronous check.
   */
  checkedAsync: <T>(what: string, work: () => Promise<T>) => Promise<T>;
  /** Throws if the device was lost (a lost device isn't an error a scope catches). */
  assertLive: () => void;
  /** Resolves with the device's loss as an error, for work to race; never for a device `dispose` destroyed. */
  whenLost: Promise<Error>;
  /**
   * How many checks (`checked`, `checkedAsync`) have settled, either way: work the device finished. It only grows, so
   * a watchdog reads a device that's stuck as this standing still.
   */
  checksSettled: () => number;
  /** The device's one three.js renderer, made the first time it's asked for. */
  three: () => Promise<StudioThreeRenderer>;
  /** Lets go of the three.js renderer and destroys the device; dispose what draws on it first. */
  dispose: () => void;
};

/**
 * A device with the studio's features, or a thrown error naming what the browser lacks. Bare, for a check that
 * runs its own passes (the stamp gate); everything else draws on an owner's.
 */
export async function requestStudioGpuDevice(): Promise<GPUDevice> {
  if (!navigator.gpu) throw new Error('gpu: this browser has no WebGPU (navigator.gpu), which the studio draws with; it exists only in a secure context');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('gpu: this browser has no WebGPU adapter');
  if (adapter.info.isFallbackAdapter) throw new Error('gpu: this browser\'s WebGPU adapter is a software fallback');
  const missing = STUDIO_GPU_FEATURES.filter((feature) => !adapter.features.has(feature));
  if (missing.length) throw new Error(`gpu: this GPU lacks ${missing.join(', ')}`);
  // A painting's stamps sit in one buffer, bound whole as storage, which a large painting takes past WebGPU's
  // defaults (256 MiB a buffer, 128 MiB a binding); a guide render writes several float images at once.
  const { maxBufferSize, maxStorageBufferBindingSize, maxColorAttachmentBytesPerSample } = adapter.limits;
  // Timestamps where the adapter has them, for a trace's GPU times (gpu-step-timer.ts); a device without them draws alike.
  const timed: GPUFeatureName[] = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  return adapter.requestDevice({ requiredFeatures: [...STUDIO_GPU_FEATURES, ...timed], requiredLimits: { maxBufferSize, maxStorageBufferBindingSize, maxColorAttachmentBytesPerSample } });
}

/** An owner of a new device. */
export async function createGpuDeviceOwner(): Promise<GpuDeviceOwner> {
  const webgpu = await requestStudioGpuDevice();
  let lost: string | null = null, settled = 0;
  const whenLost = new Promise<Error>((resolve) => {
    void webgpu.lost.then(({ reason, message }) => {
      if (reason !== 'destroyed') {
        lost ??= message;
        resolve(new Error(gpuDeviceLostText(message)));
      }
      return undefined;
    });
  });

  const checked = async <T,>(what: string, work: () => T): Promise<T> => {
    for (const scope of GPU_ERROR_SCOPES) webgpu.pushErrorScope(scope);
    let popped: Promise<(GPUError | null)[]>, result: T;
    try {
      result = work();
    } finally {
      // Popped together, before anything else can push, so no other work's errors land in them; a destroyed
      // device's resolve with no error.
      popped = Promise.all(GPU_ERROR_SCOPES.map(() => webgpu.popErrorScope()));
    }
    const error = (await popped.finally(() => settled++)).find(Boolean);
    if (error) throw new Error(`gpu: ${what} failed: ${error.message}`);
    return result;
  };

  // The asynchronous checks asked for so far, each settled before the next pushes.
  let asyncChecks: Promise<unknown> = Promise.resolve();
  const checkedAsync = <T,>(what: string, work: () => Promise<T>): Promise<T> => {
    const run = asyncChecks.then(async () => {
      for (const scope of GPU_ERROR_SCOPES) webgpu.pushErrorScope(scope);
      // Every scope is popped before anything is thrown: one left pushed would swallow the next check's errors.
      const popped = () => Promise.all(GPU_ERROR_SCOPES.map(() => webgpu.popErrorScope()));
      let result: T;
      try {
        result = await work();
      } catch (error) {
        await popped();
        throw error;
      }
      const error = (await popped()).find(Boolean);
      if (error) throw new Error(`gpu: ${what} failed: ${error.message}`);
      return result;
    });
    asyncChecks = run.catch(() => {}).finally(() => settled++);
    return run;
  };

  let three: Promise<StudioThreeRenderer> | null = null, made: StudioThreeRenderer | null = null, disposed = false;
  return {
    webgpu, checked, checkedAsync, whenLost,
    assertLive: () => {
      if (lost) throw new Error(gpuDeviceLostText(lost));
    },
    checksSettled: () => settled,
    three: () => (three ??= checkedAsync('making the three.js renderer', async () => {
      const renderer = await createStudioThreeRenderer(webgpu);
      // One finished after the owner went is let go of at once.
      if (disposed) renderer.dispose();
      else made = renderer;
      return renderer;
    })),
    dispose: () => {
      disposed = true;
      made?.dispose();
      webgpu.destroy();
    },
  };
}
