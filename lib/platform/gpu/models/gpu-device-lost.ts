// gpu-device-lost.ts: what a studio device's loss says. Its GPU process crashed or was reset, which a fresh browser
// may not meet, so a render's chunk is drawn again: isRenderBrowserFailure (render-browser-failure.ts) asks
// isGpuDeviceLostText. The render browser takes the GPU lease, so the browser feature imports this one, never the
// reverse: the loss carries its own words rather than the browser's mark.

const GPU_DEVICE_LOST = 'gpu: the device was lost: ';

/** The error of a device lost, WebGPU's `message` saying why. */
export const gpuDeviceLostText = (message: string): string => `${GPU_DEVICE_LOST}${message}`;

/** Whether an error's `message` tells of a device lost, however it was wrapped on its way out of the page. */
export const isGpuDeviceLostText = (message: string): boolean => message.includes(GPU_DEVICE_LOST);
