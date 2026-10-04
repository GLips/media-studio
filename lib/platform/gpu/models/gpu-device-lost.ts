// gpu-device-lost.ts: what a studio device's loss says. Its GPU process crashed or was reset, which a fresh browser
// may not meet, so a render's chunk is drawn again (render-browser-failure.ts).

import { renderBrowserFailureText } from '#lib/platform/browser/models/render-browser-failure.ts';

/** The error of a device lost, WebGPU's `message` saying why. */
export const gpuDeviceLostText = (message: string): string => renderBrowserFailureText(`gpu: the device was lost: ${message}`);
