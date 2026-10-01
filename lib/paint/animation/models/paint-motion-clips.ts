// paint-motion-clips.ts: what a play plays, as typed data over the clip's own time (seconds, from 0): pose clips
// (pins' moves keyed and eased), breathe (a pin's scale on a period), sway (a part bending from its root), flutter (a
// part narrowing across an axis and opening again) and place (a group's rigid placement keyed). Each is read by a
// pure function of its time; the play's clock (paint-clock.ts) makes that time, and paint-deform.ts the bend.
//
// Before its first key a clip reads its first; past its last, its last. A time below 0 reads as 0, so a clip waiting
// for its cue shows its first drawing.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { clipSeconds, type ClipSeconds } from './paint-clock.ts';
import type { PaintPinMove } from './paint-pins.ts';

/** How a key is reached from the one before: evenly, slow then fast (`in`), fast then slow (`out`), or both. */
export type PaintEase = 'linear' | 'in' | 'out' | 'inOut';

export function paintEased(ease: PaintEase, u: number): number {
  switch (ease) {
    case 'linear': return u;
    case 'in': return u * u;
    case 'out': return u * (2 - u);
    case 'inOut': return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    default: return ease satisfies never;
  }
}

/** A pose names only the pins it moves; the rest are at rest. */
export type PaintPose<P extends string> = Partial<Readonly<Record<P, PaintPinMove>>>;
/** A key `at` s into the clip, reached from the key before by `ease` (linear when left out). */
export type PaintPoseKey<P extends string> = { readonly at: number; readonly pose: PaintPose<P>; readonly ease?: PaintEase };

/** Deform: pins' moves keyed over the clip's time, keys in increasing order. */
export type PaintPoseClip<P extends string> = { readonly kind: 'poses'; readonly keys: readonly PaintPoseKey<P>[] };
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
/** Place: a group's rigid placement about its pivot, keyed: offsets px, rotation radians, scale. */
export type PaintPlaceClip = {
  readonly kind: 'place';
  readonly keys: readonly ({ readonly at: number; readonly x: number; readonly y: number; readonly rotation?: number; readonly scale?: number; readonly ease?: PaintEase })[];
};

/** A clip moving pins: what a node's pin lane holds. */
export type PaintPinClip<P extends string> = PaintPoseClip<P> | PaintBreatheClip<P>;
export type PaintMotionClip<P extends string> = PaintPinClip<P> | PaintSwayClip | PaintFlutterClip | PaintPlaceClip;

/** The clip's length in its own seconds: its last key, or Infinity for a generator, which never finishes. */
export const paintMotionClipLength = (clip: PaintMotionClip<string>): ClipSeconds =>
  clipSeconds(clip.kind === 'poses' || clip.kind === 'place' ? (clip.keys.at(-1)?.at ?? 0) : Infinity);

/** The pins a clip moves. */
export function paintMotionClipPins<P extends string>(clip: PaintMotionClip<P>): P[] {
  if (clip.kind === 'breathe') return [clip.pin];
  return clip.kind === 'poses' ? [...new Set(clip.keys.flatMap((key) => keyPins(key.pose)))] : [];
}

// SAFETY: a PaintPose<P>'s keys are P.
const keyPins = <P extends string>(pose: PaintPose<P>) => Object.keys(pose) as P[];

const finite = (...values: (number | undefined)[]) => values.every((value) => value === undefined || Number.isFinite(value));

/** Why `keys` can't be eased, or null: none, times not finite and increasing, or a move not finite with a positive scale. */
function paintKeysProblem(keys: readonly { at: number }[], moves: (i: number) => readonly (PaintPinMove | undefined)[]): string | null {
  if (!keys.length) return 'it has no keys';
  for (const [i, key] of keys.entries()) {
    if (!Number.isFinite(key.at)) return `key ${i} is at ${key.at}s, not a finite time`;
    if (i && !(key.at > keys[i - 1].at)) return `its keys need increasing times; key ${i} is at ${key.at}s after ${keys[i - 1].at}s`;
    for (const move of moves(i)) {
      if (move && !(finite(move.x, move.y, move.rotation, move.scale) && (move.scale ?? 1) > 0)) return `key ${i} needs finite moves and a positive scale`;
    }
  }
  return null;
}

/** Why `clip` can't be played, or null: keys out of order, numbers not finite, a scale or period not positive. */
export function paintMotionClipProblem(clip: PaintMotionClip<string>): string | null {
  switch (clip.kind) {
    case 'poses': return paintKeysProblem(clip.keys, (i) => Object.values(clip.keys[i].pose));
    case 'place': return paintKeysProblem(clip.keys, (i) => [clip.keys[i]]);
    case 'breathe': return clip.period > 0 && clip.amount > -1 && Number.isFinite(clip.amount) ? null : `its breathe needs a positive period and an amount above −1, not ${clip.period}s and ${clip.amount}`;
    case 'sway': return clip.period > 0 && clip.length > 0 && finite(clip.amount, clip.direction, clip.root.x, clip.root.y) ? null : `its sway needs a positive period and length, not ${clip.period}s and ${clip.length} px`;
    case 'flutter': return clip.period > 0 && clip.least > 0 && clip.least <= 1 && finite(clip.direction, clip.at.x, clip.at.y) ? null : `its flutter needs a positive period and a least spread in (0, 1], not ${clip.period}s and ${clip.least}`;
    default: return clip satisfies never;
  }
}

/** Where `keys` stand at time: the key before and after, and the eased share of the way between, held beyond them. */
export function paintKeySpanAt(keys: readonly { at: number; ease?: PaintEase }[], time: number): { from: number; to: number; share: number } {
  const next = keys.findIndex((key) => key.at > time);
  if (next === 0) return { from: 0, to: 0, share: 0 };
  if (next < 0) return { from: keys.length - 1, to: keys.length - 1, share: 0 };
  return { from: next - 1, to: next, share: paintEased(keys[next].ease ?? 'linear', (time - keys[next - 1].at) / (keys[next].at - keys[next - 1].at)) };
}

const restMove: Required<PaintPinMove> = { x: 0, y: 0, rotation: 0, scale: 1 };
const between = (a: number, b: number, share: number) => a + (b - a) * share;

/** Each pin `clip` moves, as it stands time s into the clip: a pin a key leaves out is at rest there. */
export function paintPoseClipAt<P extends string>(clip: PaintPoseClip<P>, time: ClipSeconds): Map<P, Required<PaintPinMove>> {
  const { from, to, share } = paintKeySpanAt(clip.keys, Math.max(0, time));
  const whole = (move: PaintPinMove | undefined): Required<PaintPinMove> => ({ ...restMove, ...move });
  return new Map(paintMotionClipPins(clip).map((pin) => {
    const a = whole(clip.keys[from].pose[pin]), b = whole(clip.keys[to].pose[pin]);
    return [pin, { x: between(a.x, b.x, share), y: between(a.y, b.y, share), rotation: between(a.rotation, b.rotation, share), scale: between(a.scale, b.scale, share) }];
  }));
}

/** The breathing pin's scale time s into the clip: 1 at its start and every period, 1 + amount half way. */
export const paintBreatheScaleAt = ({ amount, period }: PaintBreatheClip<string>, time: ClipSeconds) => 1 + amount * (1 - Math.cos((2 * Math.PI * Math.max(0, time)) / period)) / 2;

/** How `pin` moves time s into a clip moving pins: at rest where the clip leaves it out. */
export function paintPinClipMoveAt<P extends string>(clip: PaintPinClip<P>, pin: P, time: ClipSeconds): PaintPinMove {
  if (clip.kind === 'breathe') return { scale: paintBreatheScaleAt(clip, time) };
  return paintPoseClipAt(clip, time).get(pin) ?? {};
}

/** The group's placement time s into a place clip. */
export function paintPlaceClipAt(clip: PaintPlaceClip, time: ClipSeconds): StampGroupPlacement {
  const { from, to, share } = paintKeySpanAt(clip.keys, Math.max(0, time));
  const a = clip.keys[from], b = clip.keys[to];
  return { x: between(a.x, b.x, share), y: between(a.y, b.y, share), rotation: between(a.rotation ?? 0, b.rotation ?? 0, share), scale: between(a.scale ?? 1, b.scale ?? 1, share) };
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
