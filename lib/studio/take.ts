// take.ts: takes (recordings of the site from lib/capture.ts) as pure math: which frame shows when, where a page rect
// sits in it, and how the take's time is fitted to the scene's.
//
// A take's frame is a viewport-sized Shot, so cameras, Capture, highlights and the framing check work on it as on a
// still. Its coordinates are viewport pixels; the page scrolls under them, so a page rect from a mark is moved by the
// scroll of the frame it's drawn on (`onTake`).
//
// A take is filmed at the site's own pace and fitted to the voice afterwards: `fitTake` pins moments of the take
// (marks, by name) to scene times, playing between the pins at whatever speed joins them, and at the take's own
// speed before the first and after the last. Two pins on one mark hold its frame.

import { assertKeysInOrder, type Rect, type Shot } from '#models/camera/camera.ts';
import { noteTakeFitStrain, type TakeFitStrain } from './take-fit-strain.ts';

export type TakeFrame = { src: string; t: number; scrollY: number };
/** [t, x, y, click]: a cursor waypoint in viewport pixels; `click` is 1 where it clicked. */
export type TakeMouse = readonly [number, number, number, 0 | 1];
export type TakeMark = { t: number; scrollY: number; rects: Readonly<Record<string, Rect | readonly Rect[]>> };
export type Take = {
  /** Viewport size in CSS pixels. */
  w: number;
  h: number;
  scale: number;
  duration: number;
  /** In time order, the first at 0. A frame shows until the next: Chrome only sends one when the page repaints. */
  frames: readonly TakeFrame[];
  marks: Readonly<Record<string, TakeMark>>;
  mouse: readonly TakeMouse[];
  /** When each typed key was struck. */
  keys: readonly number[];
};

/** The frame showing at take time `time`. */
export function takeFrameAt(take: Take, time: number): TakeFrame {
  const { frames } = take;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

/** The take at `time` as a Shot, for cameras and `view()`. It carries no rects: those are the marks', via `onTake`. */
export const takeShot = (take: Take, time: number): Shot => ({ src: takeFrameAt(take, time).src, w: take.w, h: take.h, scale: take.scale, rects: {}, take: true });

/** Where page rect `rect` (from a mark) sits in the frame at take time `time`: moved by how far the page has scrolled. */
export const onTake = (take: Take, time: number, rect: Rect): Rect => ({ ...rect, y: rect.y - takeFrameAt(take, time).scrollY });

export type TakeFit = { take: Take; pins: readonly (readonly [scene: number, take: number])[] };

// Past these the footage stops reading as someone using the site: sped-up hurry, or slow-motion drift.
const STRAINED_FAST = 1.6, STRAINED_SLOW = 0.6;

/**
 * Pins take moments to scene times: `[[s.line('a').word('spec').start, 'pick'], [b.start, 'shown']]`. A moment is a
 * mark's name or take seconds. Between pins faster than 1.6× or slower than 0.6×, `studio check` warns.
 */
export function fitTake<T extends Take>(take: T, pins: readonly (readonly [number, (keyof T['marks'] & string) | number])[]): TakeFit {
  const resolved = pins.map(([scene, at]) => [scene, typeof at === 'number' ? at : take.marks[at].t] as const);
  checkSourcePins('take', resolved, (i) => pins[i][1]);
  return { take, pins: resolved };
}

/**
 * Checks pins of a take (`fitTake`) or generated footage (`previs.retime`) to the scene, `[sceneTime, sourceTime]`:
 * throws unless both rise, and notes stretches played too far from the source's own pace for `studio check`.
 * `label(i)` names pin i's source moment in the warning (a mark's name), seconds if it gives none.
 */
export function checkSourcePins(source: TakeFitStrain['source'], pins: readonly (readonly [number, number])[], label: (i: number) => string | number = (i) => pins[i][1]) {
  const what = source === 'take' ? 'fitTake' : 'previs.retime';
  assertKeysInOrder(what, pins);
  const name = (i: number) => { const at = label(i); return typeof at === 'number' ? `${at.toFixed(2)}s` : at; };
  for (let i = 1; i < pins.length; i++) {
    if (pins[i][1] < pins[i - 1][1]) throw new Error(`${what} pin ${i} goes back in the ${source}, to ${pins[i][1].toFixed(2)}s`);
    const speed = (pins[i][1] - pins[i - 1][1]) / (pins[i][0] - pins[i - 1][0]);
    // A speed of 0 is a hold: two pins on one moment, on purpose.
    if (speed > 0 && (speed > STRAINED_FAST || speed < STRAINED_SLOW)) {
      noteTakeFitStrain({ source, from: name(i - 1), to: name(i), speed: Math.round(speed * 100) / 100 });
    }
  }
}

/** Take time at scene time `t`. */
export const takeTimeAt = ({ take, pins }: TakeFit, t: number): number => pinnedSourceTime(pins, t, take.duration);

/**
 * Source time at scene time `t`, for a source (a take, generated footage) of `duration` seconds pinned to the scene at
 * `[scene, source]` times: straight between pins, at the source's own speed before the first and after the last.
 */
export function pinnedSourceTime(pins: readonly (readonly [number, number])[], t: number, duration: number): number {
  const clampSource = (v: number) => Math.min(duration, Math.max(0, v));
  if (t <= pins[0][0]) return clampSource(pins[0][1] - (pins[0][0] - t));
  for (let i = 1; i < pins.length; i++) {
    const [s0, k0] = pins[i - 1], [s1, k1] = pins[i];
    if (t <= s1) return k0 + ((k1 - k0) * (t - s0)) / (s1 - s0);
  }
  const [sn, kn] = pins[pins.length - 1];
  return clampSource(kn + (t - sn));
}

/** Where the logged cursor is at take time `time`, straight between waypoints. */
export function takeMouseAt(take: Take, time: number): { x: number; y: number } {
  const { mouse } = take;
  let i = 0;
  while (i + 1 < mouse.length && mouse[i + 1][0] <= time) i++;
  const [t0, x0, y0] = mouse[i], next = mouse[i + 1];
  if (!next || next[0] === t0) return { x: x0, y: y0 };
  const k = Math.min(1, Math.max(0, (time - t0) / (next[0] - t0)));
  return { x: x0 + (next[1] - x0) * k, y: y0 + (next[2] - y0) * k };
}

/** Scene time when the take reaches `time`: the first, if a hold keeps it there. */
export function sceneTimeOf({ pins }: TakeFit, time: number): number {
  if (time <= pins[0][1]) return pins[0][0] - (pins[0][1] - time);
  for (let i = 1; i < pins.length; i++) {
    const [s0, k0] = pins[i - 1], [s1, k1] = pins[i];
    if (time <= k1) return k1 === k0 ? s0 : s0 + ((s1 - s0) * (time - k0)) / (k1 - k0);
  }
  const [sn, kn] = pins[pins.length - 1];
  return sn + (time - kn);
}
