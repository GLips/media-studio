// Bar 8's model: the poster's lockup and its camera, framed, whipped, punched and shaken. Bar 8 draws the poster
// through `posterCameraAt`, and `studio look --graph=models` reads the camera and the lockup's type on screen, the
// type's boxes with their clearance from the HUD.

import type { Point, Rect } from '#models/camera/camera.ts';
import { clamp, lerp } from '#models/motion/motion.ts';
import { definePieceTracks } from '#models/motion/piece-tracks.ts';
import type { ShowcaseClock } from '../bar.ts';
import { showcaseHudBoxesAt } from '../hud.ts';

export const PAY_LESS_CENTRE: Point = { x: 960, y: 540 };

// The lockup at scale 1: the price's digits 426 px tall (0.71 of its size) and 1206 px wide, centred on x 960; the
// label and the old price over its ends; PAY LESS. under it, as wide; the stamp beside the price.
export const PAY_LESS_PRICE = { x: 357, y: 649, size: 600, stretch: 68 };
export const PAY_LESS_LABEL = { x: 369, y: 157, size: 26 };
export const PAY_LESS_WAS = { right: 1563, y: 187, size: 72 };
export const PAY_LESS_WORDS = { x: 357, y: 918, cap: 200, stretch: 77 };
/** Where the stamp lands, lockup px: a little under the price's baseline, its disc over the 0's right edge. */
export const PAY_LESS_STAMP_AT: Point = { x: 1768, y: 673 };

/** Where the lockup's type stands once shown, lockup px: the label, the price with its $ past the digits, PAY LESS. */
export const PAY_LESS_TYPE_BOXES = {
  label: { x: PAY_LESS_LABEL.x, y: 134, w: 430, h: 28 },
  price: { x: PAY_LESS_PRICE.x, y: 180, w: 1206, h: 510 },
  words: { x: PAY_LESS_WORDS.x, y: 714, w: 1206, h: 208 },
} as const satisfies Record<string, Rect>;

/** The poster's transform, screen = scale × lockup + (x, y). */
export type PosterCamera = { x: number; y: number; scale: number };

export const onPoster = (cam: PosterCamera, p: Point): Point => ({ x: cam.scale * p.x + cam.x, y: cam.scale * p.y + cam.y });
const rectOnPoster = (cam: PosterCamera, r: Rect): Rect => ({ ...onPoster(cam, r), w: cam.scale * r.w, h: cam.scale * r.h });

/** How the camera frames the poster: its scale about the frame's centre, and its offset from centred, px. */
type Framing = { scale: number; x: number; y: number };

/** Bar 8's hits and its camera on its clock. */
export function payLessPoster(clock: ShowcaseClock<'pay-less'>) {
  /**
   * The bar's hits, a beat or two apart so each lands and reads before the next: PAY LESS. on the music's second
   * downbeat, and the finale's downbeat, which the stamped poster holds over.
   */
  const hit = {
    cut: clock.beat(0), land: clock.cues.lock, slash: clock.beat(3), words: clock.beat(4), stamp: clock.cues.stamp,
    downbeat: clock.beat(8),
  } as const;

  // Bar 7 whips its camera to the right, so the page comes in from the right. Its out-expo settle (2^(−10k) of the way
  // still to go) starts WHIP.lead frames before the cut, so the cut lands it 234 px short, still streaking at 180 px a
  // frame with $2.00 whole; the camera's glide carries it on.
  const WHIP = { lead: 3, frames: 9, px: 2350 };
  const whipAt = (f: number) => WHIP.px * 2 ** ((-10 * (f - (hit.cut - WHIP.lead))) / WHIP.frames);

  // The camera glides between SHOTS, each big hit knocking it the other way: it carries the whip left, pushing in
  // faster and faster onto the lock; recoils right, pulling back and rising to make room for PAY LESS.; swings left
  // toward the stamp, whose slam slows it to a push and pan. Linear glides: nothing slows between hits.
  const SHOTS: readonly (Framing & { at: number; gather?: number })[] = [
    { at: hit.cut, scale: 0.88, x: 190, y: 140 },
    { at: hit.land, scale: 1.2, x: -95, y: 190, gather: 1.3 },
    // From PAY LESS. on, the lockup nearly spans the HUD's rows: the label stays 60 px under the top one, where it
    // can't read as a third line of it, even as the stamp's punch lifts it 20 px, so scale and y barely move.
    { at: hit.words, scale: 0.95, x: 130, y: 42 },
    { at: hit.stamp, scale: 0.975, x: -145, y: 38 },
    { at: clock.to, scale: 1.01, x: -240, y: 36, gather: 1.6 },
  ];

  /** The framing on frame `f`, between the shots either side of it; a shot's scale eases in as k^gather. */
  function framingAt(f: number): Framing {
    const i = clamp(SHOTS.findLastIndex(({ at }) => at < f), 0, SHOTS.length - 2);
    const from = SHOTS[i], to = SHOTS[i + 1], k = clamp((f - from.at) / (to.at - from.at), 0, 1);
    return { scale: from.scale * (to.scale / from.scale) ** (k ** (to.gather ?? 1)), x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
  }

  // The lock punches the camera in 8% about the price, falling back by e every 1.6 frames, gone after 6; the slash
  // knocks it 2.5% about the old price, PAY LESS. 3% about the words, the stamp 4% about the stamp. The finale's
  // downbeat lands inside the hold, so it gets a 1.2% nudge there rather than a cut.
  const PUNCHES = [
    { at: hit.land, size: 0.08, tau: 1.6, frames: 6, into: { x: 960, y: 436 } },
    { at: hit.slash, size: 0.025, tau: 1.6, frames: 5, into: { x: 1468, y: 162 } },
    { at: hit.words, size: 0.03, tau: 1.6, frames: 5, into: { x: 960, y: 818 } },
    { at: hit.stamp, size: 0.04, tau: 1.8, frames: 6, into: PAY_LESS_STAMP_AT },
    { at: hit.downbeat, size: 0.012, tau: 1.8, frames: 6, into: PAY_LESS_STAMP_AT },
  ];

  // The stamp's impact shakes the poster: 6 px on the hit, 3 back, halving a frame, gone after four. Down and to the
  // left, the way the stamp comes down.
  const SHAKE_PX = [6, -3, 1.5, -0.75];
  function stampShakeAt(f: number): Point {
    const a = SHAKE_PX[Math.round(f) - hit.stamp] ?? 0;
    return { x: -0.45 * a, y: 0.89 * a };
  }

  /** The poster's transform on frame `f`: framed, whipped, punched and shaken. */
  function posterCameraAt(f: number): PosterCamera {
    const { scale: s, x: dx, y: dy } = framingAt(f), shake = stampShakeAt(f);
    const x = PAY_LESS_CENTRE.x * (1 - s) + dx + whipAt(f) + shake.x, y = PAY_LESS_CENTRE.y * (1 - s) + dy + shake.y;
    const punch = PUNCHES.find(({ at, frames }) => f >= at && f < at + frames);
    if (!punch) return { x, y, scale: s };
    // The punch holds what it's into where the camera has it, and scales about it.
    const k = 1 + punch.size * Math.exp(-(f - punch.at) / punch.tau);
    const fx = s * punch.into.x + x, fy = s * punch.into.y + y;
    return { x: fx + k * (x - fx), y: fy + k * (y - fy), scale: k * s };
  }

  return { hit, whipAt, posterCameraAt };
}

export const payLessPieceTracks = definePieceTracks<ShowcaseClock<'pay-less'>>('pay-less', (clock) => {
  const { hit, posterCameraAt } = payLessPoster(clock);
  /** A piece of the lockup's type on screen from frame `from`: its box's centre, and the box. */
  const typeTrack = (box: Rect, from: number) => (f: number) => {
    if (f < from) return null;
    const onScreen = rectOnPoster(posterCameraAt(f), box);
    return { x: onScreen.x + onScreen.w / 2, y: onScreen.y + onScreen.h / 2, box: onScreen };
  };
  return {
    tracks: {
      // Where the lockup's centre is on screen, with the camera's scale.
      camera: (f) => {
        const cam = posterCameraAt(f), at = onPoster(cam, PAY_LESS_CENTRE);
        return { x: at.x, y: at.y, values: { scale: cam.scale } };
      },
      label: typeTrack(PAY_LESS_TYPE_BOXES.label, clock.from),
      price: typeTrack(PAY_LESS_TYPE_BOXES.price, clock.from),
      // PAY LESS. once it has risen, on its beat.
      words: typeTrack(PAY_LESS_TYPE_BOXES.words, hit.words),
    },
    keepClear: showcaseHudBoxesAt,
  };
});
