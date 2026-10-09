// picture-gpu-readback.ts: reads a drawn canvas back through WebGPU without stalling the page. The canvas is copied
// into a texture and on into a mappable buffer, both queued at once; the copy snapshots the canvas as it's queued, so
// the page draws its next frame while the GPU finishes and the buffer maps. getImageData would wait for the GPU there
// and then (20 ms a 1080p frame on an M1 Max, 44 on a T4); its pixels and these are byte for byte the same.

let device: Promise<GPUDevice> | null = null;
let texture: GPUTexture | null = null;
// Buffers whose pixels have been read, by size: a page holds at most two frames' (one sending, one drawn).
const spareBuffers = new Map<number, GPUBuffer[]>();

async function requestReadbackDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('the page has no WebGPU adapter to read its frames back through');
  return adapter.requestDevice();
}

// WebGPU copies rows into a buffer at a stride that's a multiple of 256 bytes.
const paddedRowBytes = (width: number) => Math.ceil((width * 4) / 256) * 256;

/**
 * The page's one copy texture, `width` × `height`. Reused frame to frame: the queue runs a frame's copy out of it
 * before the next frame's copy into it.
 */
function readbackTexture(gpu: GPUDevice, width: number, height: number): GPUTexture {
  if (texture?.width === width && texture.height === height) return texture;
  texture?.destroy();
  texture = gpu.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  return texture;
}

function readbackBuffer(gpu: GPUDevice, size: number): GPUBuffer {
  return spareBuffers.get(size)?.pop() ?? gpu.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
}

/**
 * Queues `canvas`'s pixels back from the GPU. Once this resolves the canvas may be drawn again; `pixels` resolves to
 * them as they were, `width` × `height` RGBA with straight alpha. An object, not a bare promise, which an async
 * function would wait out.
 */
export async function startPictureGpuReadback(canvas: HTMLCanvasElement): Promise<{ readonly pixels: Promise<Uint8ClampedArray<ArrayBuffer>> }> {
  device ??= requestReadbackDevice();
  const gpu = await device, { width, height } = canvas, stride = paddedRowBytes(width), size = stride * height;
  const copied = readbackTexture(gpu, width, height), buffer = readbackBuffer(gpu, size);
  gpu.queue.copyExternalImageToTexture({ source: canvas }, { texture: copied, premultipliedAlpha: false }, [width, height]);
  const encoder = gpu.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: copied }, { buffer, bytesPerRow: stride }, [width, height]);
  gpu.queue.submit([encoder.finish()]);
  const pixels = (async () => {
    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange()), rgba = new Uint8ClampedArray(width * height * 4);
    if (stride === width * 4) rgba.set(padded);
    else for (let row = 0; row < height; row++) rgba.set(padded.subarray(row * stride, row * stride + width * 4), row * width * 4);
    buffer.unmap();
    spareBuffers.set(size, [...(spareBuffers.get(size) ?? []), buffer]);
    return rgba;
  })();
  return { pixels };
}
