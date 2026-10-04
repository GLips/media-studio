// render-page-log.ts: how drawing code writes a line for the render's Node side (models/render-page-log.ts says who
// reads it). It reads no clock: the render's Node side stamps nothing, and a line never reaches a frame.

import { RENDER_PAGE_LOG_PREFIX, RENDER_PAGE_PULSE_PREFIX } from '../models/render-page-log.ts';

/**
 * Logs `text` behind `prefix` for the render's Node side. Logged with no script on the stack: Remotion prints a line
 * from the bundle whatever the render's log level, and one from nowhere only at verbose, so Node reads it unechoed.
 */
export const logToRenderHost = (prefix: string, text: string) =>
  // oxlint-disable-next-line no-console -- a page's console is the one wire Remotion carries back to Node.
  queueMicrotask(console.log.bind(console, prefix + text));

/** Logs `text` for the render's terminal, which prints it. */
export const logRenderPageLine = (text: string) => logToRenderHost(RENDER_PAGE_LOG_PREFIX, text);

/** Tells the render's Node side the page is making progress, printing nothing. */
export const logRenderPagePulse = () => logToRenderHost(RENDER_PAGE_PULSE_PREFIX, '');
