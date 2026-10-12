// review-peaks-canvas.ts: a waveform from the review engine's peaks (review-peaks.ts), fetched once per file version
// and drawn on a canvas: the dock's sound lane draws the render's at its zoom, a decision's audio candidate its whole.
import { queryOptions } from '@tanstack/react-query';
import type { ReviewPeaks } from '#lib/output/review/models/review-timeline-geometry.ts';
import { reviewPeaksUrl } from '#web/shared/media-urls.ts';

/**
 * A file's peaks at `hash`: pinned to those bytes (an archived copy once replaced), or with `pinned: false` cut from
 * the file as it is now, `hash` only keying the cache.
 */
export const reviewPeaksQueryOptions = (project: string, path: string, hash: string, { pinned }: { pinned: boolean }) => queryOptions({
  queryKey: ['review-peaks', project, path, hash],
  queryFn: async (): Promise<ReviewPeaks> => {
    const response = await fetch(reviewPeaksUrl(project, path, pinned ? hash : undefined));
    if (!response.ok) throw new Error(await response.text());
    // SAFETY: the route answers review-peaks.ts's file, a ReviewPeaks written by JSON.stringify.
    return (await response.json()) as ReviewPeaks;
  },
  staleTime: Infinity,
  retry: false,
});

/**
 * The seconds `from`–`to` of `peaks` across the canvas, mirrored about its middle, a column a device pixel wide holding
 * the loudest slice under it, in the canvas's own `color`.
 */
export function drawReviewPeaks(canvas: HTMLCanvasElement, peaks: ReviewPeaks, { from, to }: { from: number; to: number }) {
  const scale = window.devicePixelRatio, w = Math.round(canvas.clientWidth * scale), h = Math.round(canvas.clientHeight * scale);
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context || w === 0) return;
  context.fillStyle = getComputedStyle(canvas).color;
  const sliceAt = (x: number) => Math.floor((from + ((to - from) * x) / w) * peaks.perSecond);
  for (let x = 0; x < w; x++) {
    const first = sliceAt(x), last = Math.max(first + 1, sliceAt(x + 1));
    let loudest = 0;
    for (let i = Math.max(0, first); i < Math.min(last, peaks.peaks.length); i++) loudest = Math.max(loudest, peaks.peaks[i]);
    const reach = Math.max(scale / 2, (loudest * h) / 2);
    context.fillRect(x, h / 2 - reach, 1, reach * 2);
  }
}
