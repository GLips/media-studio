// render-page-log.ts: how drawing code writes a line for the render's terminal (models/render-page-log.ts says who
// reads it). It reads no clock: the render's Node side stamps nothing, and a line never reaches a frame.

import { RENDER_PAGE_LOG_PREFIX } from '../models/render-page-log.ts';

/**
 * Logs `text` for the render's terminal. Logged with no script on the stack: Remotion prints a line from the bundle
 * whatever the render's log level, and one from nowhere only at verbose, so the render prints it once, its own way.
 */
export const logRenderPageLine = (text: string) => queueMicrotask(console.log.bind(console, RENDER_PAGE_LOG_PREFIX + text));
