// picture-root.tsx: the top of a composition's picture. In a render that sends its frames (picture-frame-sink.ts), the
// page lies inside one drawable canvas (Chrome's HTML-in-Canvas): each frame, once every other hold has cleared, the
// canvas draws the page's paint, reads it back, starts sending it, and lets Remotion move on. Anywhere else it's a
// plain box.
//
// The browser draws everything, effects and nested canvases included: drawElementImage replays the page's own paint,
// so a frame matches a screenshot of the same page (npm run picture:oracle). That holds from Chrome 157; 149 dropped
// paint under nested opacity and froze nested canvases.

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { getRemotionEnvironment, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import { logToRenderHost } from '#lib/platform/browser/studio/render-page-log.ts';
import { renderPageTrace } from '#lib/platform/trace/studio/page-trace.ts';
import { PICTURE_READBACK_SPAN_KIND, type PictureReadbackStep } from '../models/picture-readback-span.ts';
import { pictureFrameSettled, pictureFrameSink, startPictureFrameSend } from './picture-frame-sink.ts';

/** Chrome's HTML-in-Canvas, which Remotion's browsers enable: not yet in TypeScript's DOM. */
type DrawableCanvas = HTMLCanvasElement & { requestPaint: () => void; layoutSubtree: boolean };
type DrawableContext = CanvasRenderingContext2D & { drawElementImage: (element: Element, x: number, y: number) => void };

/**
 * `children`, a composition's picture, at the composition's size. Wrap each composition Root registers in one, outside
 * any Freeze: the frame it sends is the composition's.
 */
export function PictureRoot({ children }: { readonly children?: ReactNode }) {
  const { width, height } = useVideoConfig(), frame = useCurrentFrame();
  const sending = getRemotionEnvironment().isRendering && pictureFrameSink() !== null;
  const [canvas, setCanvas] = useState<DrawableCanvas | null>(null);
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  // Remotion sets the page's device scale to the render's.
  const scale = window.devicePixelRatio;
  const box = { position: 'absolute', left: 0, top: 0, width, height } as const;

  useLayoutEffect(() => {
    if (!canvas || !page) return undefined;
    const handle = delayRender(`sending frame ${frame}`);
    let open = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    // Each step's ms on the frame's span, as `studio profile` reports them (frame-profiling.ts).
    const traced = renderPageTrace(logToRenderHost).begin('frame readback', { kind: PICTURE_READBACK_SPAN_KIND, attributes: { frame: { value: frame, unit: 'frame' } } });
    const step = async <T,>(name: PictureReadbackStep, work: () => Promise<T> | T): Promise<T> => {
      const stop = traced.time(name);
      const done = await work();
      stop();
      return done;
    };
    void (async () => {
      await step('settle', async () => {
        // A task's wait first: holds taken in the frame's passive effects, which React runs after this, count too.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await pictureFrameSettled(handle);
        await document.fonts.ready;
      });
      await step('paint', () => new Promise<void>((resolve) => {
        canvas.addEventListener('paint', () => resolve(), { once: true });
        canvas.requestPaint();
      }));
      const pixels = await step('read', () => {
        // Read back once a frame: willReadFrequently would move the canvas to the CPU, and draw the page there.
        // SAFETY: Remotion's browsers enable HTML-in-Canvas, whose 2D context draws elements.
        const ctx = canvas.getContext('2d', { willReadFrequently: false }) as DrawableContext;
        // No transform: drawElementImage already draws in device pixels, the render's scale applied.
        ctx.reset();
        ctx.drawElementImage(page, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      });
      // Remotion moves on once the send has started: the send overlaps the next frame's drawing.
      const { landed } = await step('send', () => startPictureFrameSend(frame, pixels, { width: canvas.width, height: canvas.height }));
      traced.end();
      release();
      landed.catch((error: Error) => cancelRender(error));
    })().catch((error: Error) => {
      traced.fail(error);
      if (open) cancelRender(error);
    });
    return release;
  }, [canvas, page, frame, delayRender, continueRender, cancelRender]);

  if (!sending) return <div style={box}>{children}</div>;
  return (
    <canvas
      // `content="drawable"` and layoutSubtree both opt the canvas in, as Remotion's HtmlInCanvas sets them.
      {...{ content: 'drawable' }}
      ref={(element) => {
        // SAFETY: Remotion's browsers enable HTML-in-Canvas, whose canvases take layoutSubtree and requestPaint.
        const drawable = element as DrawableCanvas | null;
        if (drawable) drawable.layoutSubtree = true;
        setCanvas(drawable);
      }}
      width={Math.round(width * scale)}
      height={Math.round(height * scale)}
      style={box}
    >
      <div {...{ drawable: '' }} style={box} ref={setPage}>{children}</div>
    </canvas>
  );
}
