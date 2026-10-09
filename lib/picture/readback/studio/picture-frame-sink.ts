// picture-frame-sink.ts: where a render's page sends each finished frame, and when a frame is finished. The render
// serves a sink in Node (render-frame-sink.ts) and names it in the page's input props; the bundle's entry sets it here
// as it loads. A page with none set (a pass that only measures, the Studio) sends nothing.
//
// A frame is finished once every other delayRender has cleared: the moment Remotion would have screenshotted it.
// Remotion keeps its open holds in window.remotion_delayRenderHandles, replacing the array as each clears, so a
// setter on it says when to look again.

import { holdRenderPageOpen } from '#lib/platform/browser/studio/render-page-settle.ts';

let sink: string | null = null;

/** Sets the page's frame sink, once, as the bundle loads. */
export function setPictureFrameSink(url: string | undefined) {
  sink = url ?? null;
}

/** The page's frame sink, or null when this page sends no frames. */
export const pictureFrameSink = (): string | null => sink;

const handlesChanged = new Set<() => void>();
let watching = false;

/** Watches Remotion's open holds, keeping the array it reads and writes as its own. */
function watchDelayRenderHandles() {
  if (watching) return;
  watching = true;
  // Remotion sets the array as its bundle loads, before any frame renders.
  let handles = window.remotion_delayRenderHandles;
  Object.defineProperty(window, 'remotion_delayRenderHandles', {
    configurable: true,
    get: () => handles,
    set: (next: number[]) => {
      handles = next;
      for (const changed of handlesChanged) changed();
    },
  });
}

/**
 * Resolves once `own` is the page's only open delayRender: every other hold the frame took has cleared. A hold
 * taken after that, by something the frame's last hold set off, isn't waited for, as Remotion's own wait doesn't.
 */
export function pictureFrameSettled(own: number): Promise<void> {
  watchDelayRenderHandles();
  const settled = () => window.remotion_delayRenderHandles.every((handle) => handle === own);
  if (settled()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!settled()) return;
      handlesChanged.delete(check);
      resolve();
    };
    handlesChanged.add(check);
  });
}

/** The page's send in flight, settled either way: a frame's send starts once the one before it has landed. */
let sendInFlight: Promise<void> = Promise.resolve();

/**
 * Sends frame `frame`'s `pixels` (`width` × `height` RGBA, straight alpha, as they come back from the GPU) to the
 * page's sink once the previous frame's send has landed: one in flight a page, so an encoder's backpressure still
 * reaches it. Resolves once that wait is over, with `landed`, which settles once Node holds the frame; the page stays
 * open until then.
 */
export async function startPictureFrameSend(frame: number, pixels: Promise<Uint8ClampedArray<ArrayBuffer>>, { width, height }: { width: number; height: number }): Promise<{ landed: Promise<void> }> {
  await sendInFlight;
  const landed = (async () => {
    // A Blob body: Chrome copies an ArrayBuffer body far more slowly (320 ms a 1080p frame against 14).
    const response = await fetch(`${sink}?frame=${frame}&width=${width}&height=${height}`, { method: 'POST', body: new Blob([await pixels]) });
    if (!response.ok) throw new Error(`the render refused frame ${frame}: ${response.status} ${await response.text()}`);
  })();
  sendInFlight = landed.catch(() => {});
  holdRenderPageOpen(landed);
  return { landed };
}
