// review-guides.ts: the overlays the review stage cycles through with H, as shapes in 0–1 frame coordinates. Platform
// zones and feed sizes are the stills' own (still-presets.ts), the caption band the caption styles' (caption-band.ts);
// title- and action-safe and the thirds are defined only here, as nothing else in lib draws them.
import { captionSafeArea } from '#lib/picture/captions/models/caption-band.ts';
import { STILL_FEED_SIZES, STILL_PRESETS, STILL_UI_ZONES, type StillPreset } from '#lib/picture/stills/models/still-presets.ts';
import type { ReviewPoint } from './review-threads.ts';

export type ReviewGuideSet = 'safe' | 'platform' | 'thirds';
/** The order H cycles through. */
export const REVIEW_GUIDE_SETS: readonly ReviewGuideSet[] = ['safe', 'platform', 'thirds'];

/** `H` and the transport's ⌗: the next guide set, then back to none. */
export const nextReviewGuideSet = (now: ReviewGuideSet | null): ReviewGuideSet | null =>
  (now === null ? REVIEW_GUIDE_SETS[0] : REVIEW_GUIDE_SETS[REVIEW_GUIDE_SETS.indexOf(now) + 1] ?? null);

/** 0–1 across the frame. */
export type ReviewGuideRect = { x: number; y: number; w: number; h: number };
/** `frame`: keep what matters inside it. `zone`: something draws over it. */
export type ReviewGuideOverlay =
  | { kind: 'frame'; name: string; rect: ReviewGuideRect }
  | { kind: 'zone'; name: string; rect: ReviewGuideRect }
  | { kind: 'line'; from: ReviewPoint; to: ReviewPoint };

// SMPTE ST 2046-1's areas for a 16:9 frame, applied to any frame: action within 93%, titles within 90%.
const ACTION_SAFE = 0.93;
const TITLE_SAFE = 0.9;
// Aspects within 1% are the same shape: YouTube's 168×94 is its 1280×720 rounded.
const SAME_ASPECT = 0.01;

const centred = (fraction: number): ReviewGuideRect => ({ x: (1 - fraction) / 2, y: (1 - fraction) / 2, w: fraction, h: fraction });
const sameAspect = (a: number, b: number) => Math.abs(a / b - 1) <= SAME_ASPECT;

/** The still preset a frame of this shape is posted as, if any: a 1920×1080 video is seen as YouTube's 1280×720. */
export function reviewGuidePlatformOf({ w, h }: { w: number; h: number }): StillPreset | undefined {
  const presets = Object.keys(STILL_PRESETS).filter((p): p is StillPreset => p in STILL_PRESETS);
  return presets.find((p) => sameAspect(STILL_PRESETS[p].width / STILL_PRESETS[p].height, w / h));
}

/**
 * The shapes of one guide set on a `w`×`h` frame. `platform` is the still preset it's posted as (else the one of its
 * shape); a frame with none, a video, gets the caption band in its safe set instead of platform chrome.
 */
export function reviewGuidesFor(set: ReviewGuideSet, { w, h, platform }: { w: number; h: number; platform?: StillPreset }): ReviewGuideOverlay[] {
  if (set === 'thirds') {
    return [1 / 3, 2 / 3].flatMap((at) => [
      { kind: 'line' as const, from: { x: at, y: 0 }, to: { x: at, y: 1 } },
      { kind: 'line' as const, from: { x: 0, y: at }, to: { x: 1, y: at } },
    ]);
  }
  if (set === 'safe') {
    const safe: ReviewGuideOverlay[] = [{ kind: 'frame', name: 'action safe', rect: centred(ACTION_SAFE) }, { kind: 'frame', name: 'title safe', rect: centred(TITLE_SAFE) }];
    if (platform) return safe;
    const band = captionSafeArea({ width: w, height: h });
    const rect = { x: (w - band.maxWidth) / 2 / w, y: band.top / h, w: band.maxWidth / w, h: (h - band.bottom - band.top) / h };
    return [...safe, { kind: 'zone', name: 'captions', rect }];
  }
  const posted = platform ?? reviewGuidePlatformOf({ w, h });
  const zones: ReviewGuideOverlay[] = posted
    ? STILL_UI_ZONES[posted].map(({ name, rect: r }) => {
      const { width, height } = STILL_PRESETS[posted];
      return { kind: 'zone', name, rect: { x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height } };
    })
    : [];
  return [...zones, ...reviewFeedCrops(w / h)];
}

/** Where each other feed shape crops this frame, centred, one per distinct aspect. */
function reviewFeedCrops(aspect: number): ReviewGuideOverlay[] {
  const crops: { name: string; aspect: number }[] = [];
  for (const [preset, sizes] of Object.entries(STILL_FEED_SIZES)) {
    for (const size of sizes) {
      const a = size.w / size.h;
      if (!sameAspect(a, aspect) && !crops.some((c) => sameAspect(c.aspect, a))) crops.push({ name: `${preset} ${size.name}`, aspect: a });
    }
  }
  return crops.map(({ name, aspect: a }) => {
    const rect = a < aspect ? { w: a / aspect, h: 1 } : { w: 1, h: aspect / a };
    return { kind: 'frame', name, rect: { x: (1 - rect.w) / 2, y: (1 - rect.h) / 2, ...rect } };
  });
}
