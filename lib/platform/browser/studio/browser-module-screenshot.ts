// browser-module-screenshot.ts: a browser module page (engine/browser-module-page.ts) photographing a box of itself as
// the browser composites it: its CSS blending, and its WebGPU canvases as presented, which a canvas read back can't
// show (one on the page reads back clear once presented).

import {
  BROWSER_MODULE_SCREENSHOT_ANSWER, BROWSER_MODULE_SCREENSHOT_BINDING, type BrowserModuleScreenshotAnswer, type BrowserModuleScreenshotRequest, type BrowserModuleViewportBox,
} from '../models/browser-module-screenshot.ts';

const browserModuleScreenshotsWaiting = new Map<number, { readonly resolve: (png: string) => void; readonly reject: (error: Error) => void }>();
let browserModuleScreenshotCount = 0;

const answerBrowserModuleScreenshot: BrowserModuleScreenshotAnswer = (id, png, error) => {
  const waiting = browserModuleScreenshotsWaiting.get(id)!;
  browserModuleScreenshotsWaiting.delete(id);
  if (png === null) waiting.reject(new Error(`browser module screenshot: ${error}`));
  else waiting.resolve(png);
};

/**
 * `box` of the page's viewport as the browser next composites it, RGBA bytes row by row. A WebGPU canvas shows the
 * frame it last presented: wait for the page's frame after drawing before asking.
 */
export async function browserModuleScreenshot(box: BrowserModuleViewportBox): Promise<ImageData> {
  // SAFETY: Runtime.addBinding sets a function of one string; a page opened otherwise has none.
  const scope = globalThis as typeof globalThis & { [BROWSER_MODULE_SCREENSHOT_BINDING]?: (payload: string) => void; [BROWSER_MODULE_SCREENSHOT_ANSWER]?: BrowserModuleScreenshotAnswer };
  const ask = scope[BROWSER_MODULE_SCREENSHOT_BINDING];
  if (!ask) throw new Error('browser module screenshot: this page has no screenshot binding; withBrowserModulePage opens pages that do');
  scope[BROWSER_MODULE_SCREENSHOT_ANSWER] = answerBrowserModuleScreenshot;
  const id = browserModuleScreenshotCount++;
  const png = await new Promise<string>((resolve, reject) => {
    browserModuleScreenshotsWaiting.set(id, { resolve, reject });
    ask(JSON.stringify({ id, box } satisfies BrowserModuleScreenshotRequest));
  });
  const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
  // Bytes as captured: the render browser composites in sRGB, so no conversion is wanted on the way back.
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (image.width !== box.width || image.height !== box.height) {
    throw new Error(`browser module screenshot: asked for ${box.width} × ${box.height} px and got ${image.width} × ${image.height}: the page's device pixel ratio isn't 1`);
  }
  const context = new OffscreenCanvas(box.width, box.height).getContext('2d')!;
  context.drawImage(image, 0, 0);
  image.close();
  return context.getImageData(0, 0, box.width, box.height);
}
