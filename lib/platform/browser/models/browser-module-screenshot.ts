// browser-module-screenshot.ts: how a browser module's page asks the tool running it for a screenshot of itself
// (engine/browser-module-page.ts takes it, studio/browser-module-screenshot.ts asks): a binding the page calls with a
// request, and a function on the page's globalThis the tool answers through.

/** The binding the page calls with a BrowserModuleScreenshotRequest as JSON. */
export const BROWSER_MODULE_SCREENSHOT_BINDING = 'browserModuleScreenshotRequest';

/** The page's globalThis function the tool calls back: a BrowserModuleScreenshotAnswer. */
export const BROWSER_MODULE_SCREENSHOT_ANSWER = 'browserModuleScreenshotAnswer';

/** A box of the page's viewport to photograph, whole CSS px. */
export type BrowserModuleViewportBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** A screenshot asked for: `box`, its answer paired with it by `id`. */
export type BrowserModuleScreenshotRequest = { readonly id: number; readonly box: BrowserModuleViewportBox };

/** Request `id`'s answer: the PNG in base64, or why there's none. */
export type BrowserModuleScreenshotAnswer = (id: number, png: string | null, error: string | null) => void;
