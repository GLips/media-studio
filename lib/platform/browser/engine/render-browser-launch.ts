// render-browser-launch.ts: how a render's browser opens, and the Chrome every Remotion call that opens a render page
// is told it runs. Apart from render-browser.ts so a browser keeper (kept-render-browsers.ts) opens browsers as a render
// would without importing what borrows them. Node only.
//
// On Linux (a cloud NVIDIA GPU, remote-render) Chrome is Chrome for Testing with ANGLE over Vulkan, and is asked for
// its GPU info once before any page asks WebGPU for an adapter.
import { openBrowser, type ChromiumOptions, type HeadlessBrowser } from '@remotion/renderer';

const LINUX = process.platform === 'linux';

/**
 * Every render's browser runs on the GPU: Chrome's compositing goes through its GL backend, which Remotion's default
 * software renderer makes crawl; WebGPU needs no flag. On Linux ANGLE goes over Vulkan: over the NVIDIA driver's EGL,
 * Chrome 157 lists the card but hands WebGPU only SwiftShader.
 */
export const RENDER_CHROMIUM: ChromiumOptions = LINUX ? { gl: 'vulkan' } : { gl: 'angle' };

/**
 * The Chrome a render opens, told to every Remotion call so none fetches another. On Linux it's Chrome for Testing:
 * chrome-headless-shell there has no WebGPU at all ("Failed to create WebGPU Context Provider").
 */
export const RENDER_CHROME_MODE = LINUX ? 'chrome-for-testing' : 'headless-shell';

/** A CDP command Remotion's connection doesn't type, sent on it; its answer is the caller's to read. */
export function sendRenderBrowserCommand(browser: HeadlessBrowser, method: string): Promise<{ value: object }> {
  // SAFETY: Connection.send passes any method through to the browser; Remotion's types list only the ones it sends.
  // Each caller sends a parameterless command whose answer is a CDP result object.
  return (browser.connection.send as (method: string) => Promise<{ value: object }>)(method);
}

/** Opens a render browser of its own, its GPU process ready for a page's first WebGPU adapter. */
export async function openRenderBrowser(): Promise<HeadlessBrowser> {
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM, chromeMode: RENDER_CHROME_MODE });
  // On Linux a page's first requestAdapter answers null until the GPU process has reported in; SystemInfo.getInfo
  // waits for that report.
  if (LINUX) await sendRenderBrowserCommand(browser, 'SystemInfo.getInfo');
  return browser;
}

/**
 * Attaches to a running render browser through `shim`, an executable that prints the browser's DevTools endpoint as
 * Chrome would and then idles (kept-render-browsers.ts): Remotion takes it for the browser it launched, and closing
 * it ends only the shim.
 */
export const attachRenderBrowser = (shim: string): Promise<HeadlessBrowser> =>
  openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM, chromeMode: RENDER_CHROME_MODE, browserExecutable: shim });
