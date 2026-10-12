// review-mark-paint.ts: the one mark renderer. The stage draws a note's point and strokes with it over the frame, and
// the composer burns them into the frame image the note carries, so the agent reading review/frames/<id>.jpg sees the
// marks the reviewer drew, drawn the same way.
import type { ReviewMark, ReviewPoint } from '#lib/output/review/models/review-threads.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';

/** How marks are stroked, in the canvas's own pixels: `ring` is the radius of the circle round a pinned point. */
export type ReviewMarkPaint = { color: string; halo: string; width: number; ring: number };

/** What one note draws on its frame, in 0–1 frame coordinates. */
export type ReviewMarkLayer = { point?: ReviewPoint; marks: readonly ReviewMark[] };

type ReviewMarkCanvas = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** An arrowhead's barbs: their angle off the shaft, and their length in stroke widths. */
const ARROW_BARB_ANGLE = Math.PI / 7;
const ARROW_BARB_WIDTHS = 4.5;
/** The halo under each stroke, in stroke widths. */
const MARK_HALO_WIDTHS = 2.5;

/**
 * The colour a token holds now. A canvas can't read CSS variables, and StyleX's tokens are `var(--…)`, so the
 * variable is read off the document, where defineVars declares it.
 */
export function reviewTokenColorOf(token: string): string {
  const name = /^var\((--[^),\s]+)/.exec(token)?.[1];
  return (name && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || token;
}

function traceReviewMark(ctx: ReviewMarkCanvas, mark: ReviewMark, { w, h }: { w: number; h: number }, barb: number) {
  ctx.beginPath();
  if (mark.kind === 'ellipse') {
    ctx.ellipse(mark.c.x * w, mark.c.y * h, mark.rx * w, mark.ry * h, 0, 0, Math.PI * 2);
    return;
  }
  if (mark.kind === 'path') {
    mark.points.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    return;
  }
  const from = { x: mark.from.x * w, y: mark.from.y * h }, to = { x: mark.to.x * w, y: mark.to.y * h };
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  for (const side of [-1, 1]) {
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - barb * Math.cos(angle + side * ARROW_BARB_ANGLE), to.y - barb * Math.sin(angle + side * ARROW_BARB_ANGLE));
  }
}

/**
 * Strokes `layer` onto a `w`×`h` canvas: everything once as a wider halo, then in its colour, so a mark holds on bright
 * and dark footage alike.
 */
export function drawReviewMarks(ctx: ReviewMarkCanvas, layer: ReviewMarkLayer, size: { w: number; h: number }, paint: ReviewMarkPaint) {
  const { point } = layer;
  const trace = [
    ...layer.marks.map((mark) => () => traceReviewMark(ctx, mark, size, paint.width * ARROW_BARB_WIDTHS)),
    ...(point ? [() => { ctx.beginPath(); ctx.arc(point.x * size.w, point.y * size.h, paint.ring, 0, Math.PI * 2); }] : []),
  ];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [color, width] of [[paint.halo, paint.width * MARK_HALO_WIDTHS], [paint.color, paint.width]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const shape of trace) {
      shape();
      ctx.stroke();
    }
  }
  ctx.restore();
}

type ReviewFrameImageOptions = {
  readonly point?: ReviewPoint;
  readonly marks?: readonly ReviewMark[];
  /** A transparent render's frame is kept as PNG, alpha and all; any other is JPEG. */
  readonly transparent: boolean;
};

/**
 * The paused frame at native size, pin and strokes burned in by the stage's mark renderer: the image a note carries.
 * None while no frame is decoded (still loading, or gone), and the note saves without. The frame is drawn before the
 * first await, so the caller may discard the draft or seek as soon as this returns.
 */
export async function composeReviewFrameImage(media: HTMLVideoElement | HTMLImageElement, { point, marks = [], transparent }: ReviewFrameImageOptions): Promise<Uint8Array | undefined> {
  const video = media instanceof HTMLVideoElement;
  if (video ? media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA : !media.complete) return undefined;
  const w = video ? media.videoWidth : media.naturalWidth;
  const h = video ? media.videoHeight : media.naturalHeight;
  if (!w || !h) return undefined;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser has no 2D canvas to compose the frame image on');
  ctx.drawImage(media, 0, 0, w, h);
  const short = Math.min(w, h);
  drawReviewMarks(ctx, { marks, ...(point && { point }) }, { w, h }, {
    color: reviewTokenColorOf(colors.accent), halo: reviewTokenColorOf(colors.ground),
    width: Math.max(3, Math.round(short / 270)), ring: Math.max(14, Math.round(short * 0.03)),
  });
  const blob = await canvas.convertToBlob(transparent ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.85 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The attribute the stage and the stills view put on the `<video>` or `<img>` showing the reviewed frame, so a note's
 * frame image is cut from exactly what the reviewer sees.
 */
export const REVIEW_MEDIA_ATTRIBUTE = 'data-review-media';

/**
 * The frame on screen, composed with the note's pin and strokes. No image when nothing shows a frame (the Board is
 * up): the image is optional, and the note still saves.
 */
export async function composeShownReviewFrame(options: { point?: ReviewPoint; marks?: readonly ReviewMark[]; transparent: boolean }): Promise<Uint8Array | undefined> {
  // The topmost one showing: a slice laid in over the cut comes later in the stage, and is hidden (opacity) off its span.
  const media = [...document.querySelectorAll(`video[${REVIEW_MEDIA_ATTRIBUTE}], img[${REVIEW_MEDIA_ATTRIBUTE}]`)]
    .findLast((m) => m.checkVisibility({ opacityProperty: true }));
  if (!(media instanceof HTMLVideoElement || media instanceof HTMLImageElement)) return undefined;
  return composeReviewFrameImage(media, options);
}
