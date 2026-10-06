// paint-value.ts: the one type painting takes wherever a value may vary in time: a constant, or a function of the
// moment, which paint-keyed.ts builds from keys. A plane's lay, source and visibility, a rig's pose and a node's place
// and poses, and the camera's move and focus all take it; each is read at the moment its frame or play hands it.

import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';

/** A constant, or read at each moment: `at` the second seen (a shutter's moment), `frame` the frame shown. */
export type PresentationValue<T> = T | ((moment: PaintMoment) => T);

/**
 * Whether `value` varies in time. Every T painting presents (a source, a number, a pose, a placement) is data, so a
 * function is only ever the value's own.
 */
const variesInTime = <T,>(value: PresentationValue<T>): value is (moment: PaintMoment) => T => typeof value === 'function';

/** `value` at `moment`: a constant as it is, a function called. */
export const presentationValueAt = <T,>(value: PresentationValue<T>, moment: PaintMoment): T => (variesInTime(value) ? value(moment) : value);

/** A value built from keys (paintKeyed): a function of the moment that knows when it settles on its last key. */
export type PaintKeyed<T> = ((moment: PaintMoment) => T) & {
  /** The second it holds its last value from: its last key's, or later while a spring into it settles. */
  readonly settlesAt: number;
  /** The seconds of its keys that snap: where its speed changes at once, meant. */
  readonly snaps: readonly number[];
};

const isKeyed = <T,>(value: (moment: PaintMoment) => T): value is PaintKeyed<T> => 'settlesAt' in value;

/**
 * Whether `value` means its speed to jump between moments `a` and `b`, as it reads them: a keyed value with a key
 * that snaps at a second from one's `at` to the other's. A constant never jumps, and a callback can't say.
 */
export function presentationValueSnapsBetween<T>(value: PresentationValue<T>, a: PaintMoment, b: PaintMoment): boolean {
  if (!variesInTime(value) || !isKeyed(value)) return false;
  const from = Math.min(a.at, b.at), to = Math.max(a.at, b.at);
  return value.snaps.some((at) => at >= from && at <= to);
}

/**
 * How long `value` changes for, played on a clock, in the seconds it reads: a constant never does, a keyed value until
 * it settles, and any other function for ever, so a play of one writes until its clock's `until`.
 */
export function presentationValueLength<T>(value: PresentationValue<T>): number {
  if (!variesInTime(value)) return 0;
  return isKeyed(value) ? value.settlesAt : Infinity;
}
