// render-watch.ts: a render browser watched from Node, which every Remotion call that opens a render page runs in.
// Its progress keeps it alive: frames drawn, a call's progress callback, its page's lines and pulses
// (render-page-log.ts). None for max(RENDER_STALL_FLOOR_MS, 5 × its slowest frame past the first), and its page or
// GPU process is stuck: the call is cancelled, the browser closed, and the work fails as its browser did
// (render-browser-failure.ts). So the wall-clock ceiling (RENDER_TIMEOUT_MS) is only a backstop. Node only.

import { makeCancelSignal, type BrowserLog, type CancelSignal, type HeadlessBrowser } from '@remotion/renderer';
import { renderBrowserFailureText } from '../models/render-browser-failure.ts';
import { renderPageAlive } from '../models/render-page-log.ts';
import { inRenderBrowser, printRenderPageLog } from './render-browser.ts';

/**
 * The least time a watched browser may go with no progress before it's stuck: past a painted shot's own watch
 * (SHOT_STALL_SECONDS), so a stall in a page that can name it is named there.
 */
export const RENDER_STALL_FLOOR_MS = 120_000;

/** What work in a watched browser hands Remotion, and tells of its progress. */
export type RenderWatch = {
  /** Remotion's cancelSignal: the watch stops the call through it before closing the browser. */
  readonly cancelSignal: CancelSignal;
  /** Remotion's onBrowserLog: prints a page's line for the terminal; a line or a pulse is progress. */
  readonly onBrowserLog: (log: BrowserLog) => void;
  /** A frame drawn in `ms`: progress, and past the first (which loads the page), how slow a frame may be. */
  readonly frameDrawn: (frame: number, ms: number) => void;
  /** Any other progress: renderMedia's onProgress, a still drawn. */
  readonly progressed: () => void;
};

/**
 * What a watched browser does, for a stall's error: its `pass` (the sound, the stills), and the `frames` it draws in
 * order, when it draws frames, so the error names the one it waits on.
 */
export type RenderWatchWork = { readonly pass: string; readonly frames?: readonly number[]; readonly stallFloorMs?: number };

/** renderFrames' options for `watch`: its cancel signal, its page's lines, and each frame drawn, told on to `onFrame`. */
export const watchedRenderFrames = (watch: RenderWatch, onFrame?: (frame: number) => void) => ({
  cancelSignal: watch.cancelSignal,
  onBrowserLog: watch.onBrowserLog,
  onFrameUpdate: (_count: number, frame: number, ms: number) => {
    watch.frameDrawn(frame, ms);
    onFrame?.(frame);
  },
});

/** renderMedia's options for `watch`: its cancel signal, its page's lines, and its progress. */
export const watchedRenderMedia = (watch: RenderWatch) => ({ cancelSignal: watch.cancelSignal, onBrowserLog: watch.onBrowserLog, onProgress: watch.progressed });

/**
 * Runs `run` in a render browser of its own (inRenderBrowser) under a watch that closes the browser once its progress
 * stops, the work then rejected as stuck. Returns `run`'s result, the browser's GPU and the seconds it waited for the
 * GPU lease, which the watch doesn't count: it starts once the browser opens.
 */
export async function inWatchedRenderBrowser<T>(run: (browser: HeadlessBrowser, watch: RenderWatch) => Promise<T>, { pass, frames, stallFloorMs = RENDER_STALL_FLOOR_MS }: RenderWatchWork): Promise<{ result: T; gpu: string; waited: number }> {
  return inRenderBrowser(async (browser) => {
    const { cancel, cancelSignal } = makeCancelSignal();
    const drawn = new Set<number>();
    let alive = performance.now(), slowest = 0, stuck: Error | null = null;
    const timer = setInterval(() => {
      const quiet = performance.now() - alive;
      if (stuck || quiet < Math.max(stallFloorMs, 5 * slowest)) return;
      const waiting = frames?.find((frame) => !drawn.has(frame)), secs = Math.round(quiet / 1000);
      const what = waiting === undefined ? `the ${pass} pass has made no progress in ${secs} s` : `frame ${waiting} hasn't drawn in ${secs} s`;
      stuck = new Error(renderBrowserFailureText(`${what}: its page or GPU process is stuck`));
      // Cancelled first: renderFrames replaces a browser that closes under it, and a cancelled one stops instead.
      cancel();
      void browser.close({ silent: true });
    }, 1000);
    const progressed = () => {
      alive = performance.now();
    };
    const watch: RenderWatch = {
      cancelSignal,
      onBrowserLog: (log) => {
        if (renderPageAlive(log.text)) progressed();
        printRenderPageLog(log);
      },
      frameDrawn: (frame, ms) => {
        if (drawn.size) slowest = Math.max(slowest, ms);
        drawn.add(frame);
        progressed();
      },
      progressed,
    };
    try {
      return await run(browser, watch);
    } catch (error) {
      throw stuck ?? error;
    } finally {
      clearInterval(timer);
    }
  });
}
