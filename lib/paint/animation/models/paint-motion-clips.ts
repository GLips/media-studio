// paint-motion-clips.ts: what a play plays, over the clip's own time (seconds, from 0): poses (pins' moves) and place
// (a group's rigid placement), each a value of the moment (paint-value.ts, keyed by paint-keyed.ts); and generators,
// pure functions of their time: breathe (a pin's scale on a period), sway (a part bending from its root) and flutter
// (a part narrowing across an axis and opening again). The play's clock (paint-clock.ts) makes that time, and
// paint-deform.ts the bend.
//
// A time below 0 reads as 0, so a clip waiting for its cue shows its first drawing.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { clipSeconds, paintLaneClipAt, type ClipSeconds, type PaintLane } from './paint-clock.ts';
import type { PaintPlacementMove } from './paint-pins.ts';
import { presentationValueAt, presentationValueLength, presentationValueSnapsBetween, type PresentationValue } from './paint-value.ts';

/** A pose names only the pins it moves; the rest are at rest. */
export type PaintPose<P extends string> = Partial<Readonly<Record<P, PaintPlacementMove>>>;

/** Deform: pins' moves, a value of the clip's moment. It names the same pins throughout: those it names at 0. */
export type PaintPoseClip<P extends string> = { readonly kind: 'poses'; readonly value: PresentationValue<PaintPose<P>> };
/** Deform: `pin` scales 1 → 1 + `amount` → 1 every `period` s (0.03 is 3%). */
export type PaintBreatheClip<P extends string> = { readonly kind: 'breathe'; readonly pin: P; readonly amount: number; readonly period: number };
/**
 * Deform: the part bends from `root` toward `direction` (radians in painting px, y down: −π/2 is up), `length` px to
 * its tip, which swings `amount` px either way every `period` s. Its phase comes from the target's id, so neighbours
 * sway apart. It eases in over its first half period, so it starts from rest.
 */
export type PaintSwayClip = { readonly kind: 'sway'; readonly root: StampPoint; readonly direction: number; readonly length: number; readonly amount: number; readonly period: number };
/**
 * Deform: wings beating, seen from above. Paint's distance across the axis (the line through `at` along `direction`,
 * radians) narrows to `least` of itself (0..1) and opens again every `period` s; along the axis nothing moves. Its
 * phase comes from the target's id, so two fliers beat apart, and it eases in over its first period from open.
 */
export type PaintFlutterClip = { readonly kind: 'flutter'; readonly at: StampPoint; readonly direction: number; readonly least: number; readonly period: number };
/**
 * Place: a group's rigid placement about its pivot, a value of the clip's moment: offsets px, rotation radians, scale.
 * A scale of 0 draws nothing.
 */
export type PaintPlaceClip = { readonly kind: 'place'; readonly value: PresentationValue<PaintPlacementMove> };

/** A clip moving pins: what a node's pin lane holds. */
export type PaintPinClip<P extends string> = PaintPoseClip<P> | PaintBreatheClip<P>;
export type PaintMotionClip<P extends string> = PaintPinClip<P> | PaintSwayClip | PaintFlutterClip | PaintPlaceClip;

/** The clip's length in its own seconds: how long its value changes for (presentationValueLength), a generator for ever. */
export const paintMotionClipLength = (clip: PaintMotionClip<string>): ClipSeconds =>
  clipSeconds(clip.kind === 'poses' || clip.kind === 'place' ? presentationValueLength(clip.value) : Infinity);

/** A clip's moment from a play's: its own seconds, a time below 0 read as 0. */
export const paintClipMoment = (moment: PaintMoment): PaintMoment => ({ at: Math.max(0, moment.at), frame: Math.max(0, moment.frame) });

/**
 * Whether the play writing `lane` at moments `a` and `b` means a jump between them: one play writing at both, its
 * clip's value snapping between the clip moments it reads then (presentationValueSnapsBetween).
 */
export function paintLaneSnapsBetween<V>(lane: PaintLane<{ readonly value: PresentationValue<V> }>, a: PaintMoment, b: PaintMoment, animationFps: number): boolean {
  const from = paintLaneClipAt(lane, a, animationFps), to = paintLaneClipAt(lane, b, animationFps);
  if (!from || !to || from.play !== to.play) return false;
  return presentationValueSnapsBetween(from.play.clip.value, paintClipMoment(from.moment), paintClipMoment(to.moment));
}

const CLIP_START: PaintMoment = { at: 0, frame: 0 };

/** The pins a clip moves: a breathe's pin, or those its poses name at its start. */
export function paintMotionClipPins<P extends string>(clip: PaintMotionClip<P>): P[] {
  if (clip.kind === 'breathe') return [clip.pin];
  // SAFETY: a PaintPose<P>'s keys are P.
  return clip.kind === 'poses' ? (Object.keys(presentationValueAt(clip.value, CLIP_START)) as P[]) : [];
}

const finite = (...values: (number | undefined)[]) => values.every((value) => value === undefined || Number.isFinite(value));

/**
 * Why `move` can't be drawn, or null: a part not finite, or a scale below 0 (a placement's, which at 0 draws nothing)
 * or, for what `mustShow` names (a pin, which would fold its bend; the back, which must hold the frame), at 0 too.
 */
export function paintPlacementMoveProblem(move: PaintPlacementMove, mustShow: 'a pin' | 'the back' | null): string | null {
  if (!finite(move.x, move.y, move.rotation, move.scale)) return `its move ${JSON.stringify(move)} isn't finite`;
  const scale = move.scale ?? 1;
  if (mustShow ? scale > 0 : scale >= 0) return null;
  return `it scales by ${scale}; ${mustShow ? `${mustShow} scales by more than 0` : 'a placement scales by 0 or more'}`;
}

/** Why `pose` can't be drawn, or null; `pins` the only pins it may name (null: any). */
function poseProblem(pose: PaintPose<string>, pins: readonly string[] | null): string | null {
  for (const [pin, move] of Object.entries(pose)) {
    if (pins && !pins.includes(pin)) return `it moves pin '${pin}', which it didn't name at its start (${pins.join(', ') || 'none'}); a pose names the same pins throughout`;
    const problem = move && paintPlacementMoveProblem(move, 'a pin');
    if (problem) return `pin '${pin}': ${problem}`;
  }
  return null;
}

/**
 * Why `clip`'s value can't be drawn at clip moment `moment`, or null: what paintMotionClipProblem checks of a constant,
 * checked of a function where a shot samples it. Generators are checked whole.
 */
export function paintMotionClipValueProblem(clip: PaintMotionClip<string>, moment: PaintMoment): string | null {
  if (clip.kind === 'poses') return poseProblem(presentationValueAt(clip.value, moment), paintMotionClipPins(clip));
  if (clip.kind === 'place') return paintPlacementMoveProblem(presentationValueAt(clip.value, moment), null);
  return null;
}

/**
 * Why `clip` can't be played, or null: a constant pose or placement not finite or with a scale it can't take, a
 * generator's numbers not finite or its period not positive. A function's values are checked where a shot samples
 * them (paintMotionClipValueProblem).
 */
export function paintMotionClipProblem(clip: PaintMotionClip<string>): string | null {
  switch (clip.kind) {
    case 'poses': return typeof clip.value === 'function' ? null : poseProblem(clip.value, null);
    case 'place': return typeof clip.value === 'function' ? null : paintPlacementMoveProblem(clip.value, null);
    case 'breathe': return clip.period > 0 && clip.amount > -1 && Number.isFinite(clip.amount) ? null : `its breathe needs a positive period and an amount above −1, not ${clip.period}s and ${clip.amount}`;
    case 'sway': return clip.period > 0 && clip.length > 0 && finite(clip.amount, clip.direction, clip.root.x, clip.root.y) ? null : `its sway needs a positive period and length, not ${clip.period}s and ${clip.length} px`;
    case 'flutter': return clip.period > 0 && clip.least > 0 && clip.least <= 1 && finite(clip.direction, clip.at.x, clip.at.y) ? null : `its flutter needs a positive period and a least spread in (0, 1], not ${clip.period}s and ${clip.least}`;
    default: return clip satisfies never;
  }
}

/** The breathing pin's scale time s into the clip: 1 at its start and every period, 1 + amount half way. */
export const paintBreatheScaleAt = ({ amount, period }: PaintBreatheClip<string>, time: ClipSeconds) => 1 + amount * (1 - Math.cos((2 * Math.PI * Math.max(0, time)) / period)) / 2;

/** How `pin` moves at clip moment `moment` of a clip moving pins: at rest where the clip leaves it out. */
export function paintPinClipMoveAt<P extends string>(clip: PaintPinClip<P>, pin: P, moment: PaintMoment): PaintPlacementMove {
  const at = paintClipMoment(moment);
  // SAFETY: a clip's moment holds its own seconds.
  if (clip.kind === 'breathe') return { scale: paintBreatheScaleAt(clip, clipSeconds(at.at)) };
  return presentationValueAt(clip.value, at)[pin] ?? {};
}

/** The group's placement at clip moment `moment` of a place clip, its parts left out at rest. */
export function paintPlaceClipAt(clip: PaintPlaceClip, moment: PaintMoment): StampGroupPlacement {
  const { x = 0, y = 0, rotation = 0, scale = 1 } = presentationValueAt(clip.value, paintClipMoment(moment));
  return { x, y, rotation, scale };
}

/** A string's 32-bit FNV-1a hash: randomness keyed by a target's id, the same in every frame and render. */
export function paintIdHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** A phase in [0, 1) from `id`, so each target sways or flutters on its own beat. */
export const paintIdPhase = (id: string) => (paintIdHash(id) % 10007) / 10007;

/** How far the sway has turned its tip, radians, time s in, for a target of phase `phase`. */
export function paintSwayAngleAt({ amount, length, period }: PaintSwayClip, phase: number, time: ClipSeconds): number {
  const t = Math.max(0, time), ramp = Math.min(1, (2 * t) / period), easeIn = ramp * ramp * (3 - 2 * ramp);
  return (amount / length) * easeIn * Math.sin(2 * Math.PI * (t / period + phase));
}

/** How open a flutter is, time s in, for a target of phase `phase`: 1 open, `least` closed. */
export function paintFlutterSpreadAt({ least, period }: PaintFlutterClip, phase: number, time: ClipSeconds): number {
  const t = Math.max(0, time), ramp = Math.min(1, t / period), easeIn = ramp * ramp * (3 - 2 * ramp);
  return 1 - ((1 - least) * easeIn * (1 - Math.cos(2 * Math.PI * (t / period + phase)))) / 2;
}
