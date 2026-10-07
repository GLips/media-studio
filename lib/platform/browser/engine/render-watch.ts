// render-watch.ts: a render browser watched from Node, which every Remotion call that opens a render page runs in.
// Its progress keeps it alive: frames drawn, a call's progress callback, its page's lines and pulses
// (render-page-log.ts). None for RENDER_STALL_MS, and its page or GPU process is stuck: the call is cancelled, the
// browser closed, and the work fails as its browser did (render-browser-failure.ts). A browser that closes under the
// work, crashed or killed, fails it the same way, at once. So the wall-clock ceiling (RENDER_TIMEOUT_MS) is only a
// backstop. Node only.

import { makeCancelSignal, type BrowserLog, type CancelSignal, type HeadlessBrowser } from '@remotion/renderer';
import { renderBrowserFailureText } from '../models/render-browser-failure.ts';
import { renderPageAlive } from '../models/render-page-log.ts';
import { createPageTraceIntake, type PageTraceIntakeTarget } from '#lib/platform/trace/engine/page-trace-intake.ts';
import { pageTraceBatchOf } from '#lib/platform/trace/models/page-trace-batch.ts';
import { inRenderBrowser, printRenderPageLog } from './render-browser.ts';

/**
 * How long a watched browser may go with no progress before it's stuck, however slow its frames have been: a painted
 * shot pulses at least every 15 s while it progresses (shot-watch.ts), and nothing unpainted takes minutes. Past a
 * painted shot's own watch (SHOT_STALL_SECONDS), so a stall in a page that can name it is named there.
 */
export const RENDER_STALL_MS = 120_000;

/** What work in a watched browser hands Remotion, and tells of its progress. */
export type RenderWatch = {
  /** Remotion's cancelSignal: the watch stops the call through it before closing the browser. */
  readonly cancelSignal: CancelSignal;
  /** Remotion's onBrowserLog: prints a page's line for the terminal; a line or a pulse is progress. */
  readonly onBrowserLog: (log: BrowserLog) => void;
  /** A frame drawn: progress, and no longer the frame a stall names. */
  readonly frameDrawn: (frame: number) => void;
  /** Any other progress: renderMedia's onProgress, a still drawn. */
  readonly progressed: () => void;
  /** Where the work times its own steps, when the render is traced: the browser's span. */
  readonly trace?: PageTraceIntakeTarget;
};

/**
 * What a watched browser does, for a failure's error: its `pass` (the sound, the stills), and the `frames` it draws in
 * order, when it draws frames, so the error names the one it was drawing. `stallMs`: RENDER_STALL_MS unless given.
 * `trace`: where the browser's opening and its pages' traces go, when the render is traced.
 */
export type RenderWatchWork = { readonly pass: string; readonly frames?: readonly number[]; readonly stallMs?: number; readonly trace?: PageTraceIntakeTarget };

/** renderFrames' options for `watch`: its cancel signal, its page's lines, and each frame drawn, told on to `onFrame`. */
export const watchedRenderFrames = (watch: RenderWatch, onFrame?: (frame: number) => void) => ({
  cancelSignal: watch.cancelSignal,
  onBrowserLog: watch.onBrowserLog,
  onFrameUpdate: (_count: number, frame: number) => {
    watch.frameDrawn(frame);
    onFrame?.(frame);
  },
});

/** renderMedia's options for `watch`: its cancel signal, its page's lines, and its progress. */
export const watchedRenderMedia = (watch: RenderWatch) => ({ cancelSignal: watch.cancelSignal, onBrowserLog: watch.onBrowserLog, onProgress: watch.progressed });

/**
 * Runs `run` in a render browser of its own (inRenderBrowser) under a watch that fails it as its browser's failure once
 * its progress stops (closing the browser) or its browser closes under it. Returns `run`'s result, the browser's GPU and
 * the seconds it waited for the GPU lease, which the watch doesn't count: it starts once the browser opens.
 */
export async function inWatchedRenderBrowser<T>(run: (browser: HeadlessBrowser, watch: RenderWatch) => Promise<T>, { pass, frames, stallMs = RENDER_STALL_MS, trace }: RenderWatchWork): Promise<{ result: T; gpu: string; waited: number }> {
  const intake = trace && createPageTraceIntake(trace);
  return inRenderBrowser(async (browser) => {
    const { cancel, cancelSignal } = makeCancelSignal();
    const drawn = new Set<number>();
    let alive = performance.now(), running = true, failed: Error | null = null;
    const drawing = () => frames?.find((frame) => !drawn.has(frame));
    /** Fails the work as its browser's failure, worded `text`, and stops its call. */
    const fail = (text: string) => {
      if (!running || failed) return;
      failed = new Error(renderBrowserFailureText(text));
      cancel();
    };
    // Registered after the connection's own listener, so Remotion's calls are already rejected but not yet heard (their
    // handlers run as microtasks): cancelled here, renderFrames stops, rather than retrying the frame in a browser it
    // opens itself in this one's place, which no option turns off, outside the watch and the GPU lease.
    browser.connection.transport.websocket.addEventListener('close', () => {
      const frame = drawing();
      fail(`the browser closed ${frame === undefined ? `in the ${pass} pass` : `drawing frame ${frame}`}: it crashed, or something killed it`);
    });
    const timer = setInterval(() => {
      const quiet = performance.now() - alive;
      if (failed || quiet < stallMs) return;
      const frame = drawing(), secs = Math.round(quiet / 1000);
      fail(`${frame === undefined ? `the ${pass} pass has made no progress in ${secs} s` : `frame ${frame} hasn't drawn in ${secs} s`}: its page or GPU process is stuck`);
      // Cancelled first: renderFrames replaces a browser that closes under it, and a cancelled one stops instead.
      void browser.close({ silent: true });
    }, 1000);
    const progressed = () => {
      alive = performance.now();
    };
    const watch: RenderWatch = {
      cancelSignal,
      onBrowserLog: (log) => {
        const batch = pageTraceBatchOf(log.text);
        if (batch) {
          intake?.(batch);
          return;
        }
        if (renderPageAlive(log.text)) progressed();
        printRenderPageLog(log);
      },
      frameDrawn: (frame) => {
        drawn.add(frame);
        progressed();
      },
      progressed,
      ...(trace && { trace }),
    };
    try {
      return await run(browser, watch);
    } catch (error) {
      throw failed ?? error;
    } finally {
      running = false;
      clearInterval(timer);
    }
  }, trace);
}
