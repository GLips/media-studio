// stamp-tip-support.ts: where a deposit's stamps can lay paint, read from its tips' canonical levels
// (stamp-tip-levels.ts) as the renderer draws them. A stamp is its tip's hull (stamp-tip-hull.ts) at the coarsest level
// its marks sample, scaled, squashed, mirrored and turned as the stamp shader places it; its support is that polygon's
// box. Bounds (a landing's wet window, a deposit's drawn box, an ordered layer's tile bins) read support, never a
// guess from its diameter: a rotated square tip reaches its corners, an off-centre one further.
//
// Tips come as data (StampTipsOf), never decoded here: the renderer gives its surface's levels, a test its own.

import type { StampBrush, StampBrushMeasuredProfile, StampBrushTip, StampTipSupport } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampBrushMeasuredProfile, stampBrushStatedProfile, stampBrushSupportAround, type StampTipSupportAround } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { FrozenStampMarks, PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampTipLevels, type StampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';
import { STAMP_BLUR_LEVELS } from './stamp-deposit-stages.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe-compile.ts';
import type { StampBox } from './stamp-region.ts';
import { coarsestStampTipLevel, stampTipHull, type StampTipHull } from './stamp-tip-hull.ts';
import { rememberedFor, rememberedOnce } from './stamp-remembered.ts';

/** A pressed tip's contact as data: its levels, and its ramp as StampBrushTip's pressed states it. */
export type StampTipPressed = { levels: StampTipLevels; range: readonly [lo: number, hi: number]; softness: number; diameter: number | null };

/**
 * A layer's tip footprint, as bounds and contact read it: its levels; `span`, its image's width over a stamp's diameter;
 * `center`, the point of the image on the stamp's place (shares of width and height); `roundness`, the stamp's height
 * over its width before its own roundness (the tip's, times its image's height over width); `pressed`, its contact.
 */
export type StampTipFootprint = { levels: StampTipLevels; span: number; center: readonly [number, number]; roundness: number; pressed: StampTipPressed | null };

/** A deposit's tips: its brush's main layer's and its dual's (null without one), as the renderer binds them for it. */
export type StampDepositTips = { main: StampTipFootprint; dual: StampTipFootprint | null };

/** Each deposit's tips: what a compile step reading support or contact is given, its levels already made. */
export type StampTipsOf = (deposit: CompiledStampDeposit) => StampDepositTips;

const footprints = new WeakMap<object, StampTipFootprint>();
/** `tip`'s shape, its images' levels from `levelsOf`, made once a tip. */
export function stampTipFootprintOf<Image>(tip: StampBrushTip<Image>, levelsOf: (image: Image) => StampTipLevels): StampTipFootprint {
  return rememberedOnce(footprints, tip, () => {
    const levels = levelsOf(tip.image), { pressed } = tip;
    return {
      levels, span: tip.span ?? 1, center: tip.center ?? [0.5, 0.5], roundness: tip.roundness * (levels[0].height / levels[0].width),
      pressed: pressed ? { levels: levelsOf(pressed.contact), range: pressed.range, softness: pressed.softness, diameter: pressed.diameter ?? null } : null,
    };
  });
}

/** What picks the coarsest tip level `marks` read: their smallest diameter, most blur and least roundness. */
type StampMarksExtremes = { smallest: number; blurred: number; roundest: number };
/** `marks`' extremes; with none, Infinity, 0 and 1. */
const marksExtremesOf = (marks: readonly PlacedStamp[]): StampMarksExtremes => ({
  smallest: marks.reduce((least, s) => Math.min(least, s.diameter), Infinity),
  blurred: marks.reduce((most, s) => Math.max(most, s.blur), 0),
  roundest: marks.reduce((least, s) => Math.min(least, s.roundness), 1),
});
const marksExtremes = new WeakMap<FrozenStampMarks, StampMarksExtremes>();
/** `marks`' extremes, worked out once. */
const stampMarksExtremes = (marks: FrozenStampMarks): StampMarksExtremes => rememberedOnce(marksExtremes, marks, () => marksExtremesOf(marks));

const hulls = new WeakMap<StampTipLevels, Map<number, StampTipHull>>();
/** `levels`' hull to level `coarsest`, made once. */
const hullOf = (levels: StampTipLevels, coarsest: number): StampTipHull => rememberedFor(hulls, levels, coarsest, () => stampTipHull(levels, coarsest));

/**
 * The hull `shape`'s tip is drawn in for `marks`: to the coarsest level the smallest, most squashed or most blurred of
 * them reads. The tip's texels spread over its span, so its pixels per texel go by the image's width.
 */
export function stampMarksTipHull(shape: StampTipFootprint, marks: FrozenStampMarks): StampTipHull {
  const { levels } = shape;
  return hullOf(levels, coarsestLevelFor({ ...levels[0], span: shape.span, roundness: shape.roundness }, levels.length, stampMarksExtremes(marks)));
}

/**
 * The coarsest level of `count` a tip (level 0's texels, its span and roundness) is drawn to for marks with
 * `extremes` (stampMarksTipHull).
 */
function coarsestLevelFor(tip: { width: number; height: number; span: number; roundness: number }, count: number, extremes: StampMarksExtremes): number {
  const blurred = Math.ceil(extremes.blurred * STAMP_BLUR_LEVELS);
  return Math.min(count - 1, coarsestStampTipLevel(tip, extremes.smallest * tip.span, tip.roundness * extremes.roundest, count) + blurred);
}

/**
 * `shape`'s support as a brush's profile keeps it (StampTipSupport): at each level, its hull's farthest corner from the
 * stamp's place, in stamp diameters. A stamp's roundness only squashes it, so the unsquashed tip bounds every turn.
 */
export function stampTipSupportOf(shape: StampTipFootprint): StampTipSupport {
  const { levels, span, roundness } = shape;
  const reach = levels.map((_, k) => stampTipHullReach(shape, hullOf(levels, k)));
  return { width: levels[0].width, height: levels[0].height, span, roundness, reach };
}

/** How far `shape`'s tip drawn in `hull` lays paint from its stamp's place, in stamp diameters: its farthest corner. */
function stampTipHullReach({ span, roundness, center: [cx, cy] }: StampTipFootprint, hull: StampTipHull): number {
  let most = 0;
  for (let i = 0; i < hull.length; i += 2) most = Math.max(most, Math.hypot(hull[i] - cx, (hull[i + 1] - cy) * roundness));
  return span * most;
}

/**
 * A stamp's place for its tip: from a point of the tip's square (u, v) to the painting, px, as the stamp shader puts
 * it. Never thinner than a pixel, as the shader keeps a flat tip.
 */
export function stampTipPlace(shape: StampTipFootprint, { x, y, diameter, rotation, roundness, flipX, flipY }: PlacedStamp) {
  const width = diameter * shape.span, height = width * Math.max(shape.roundness * roundness, 1 / width);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const sx = (flipX ? -1 : 1) * width, sy = (flipY ? -1 : 1) * height, [cx, cy] = shape.center;
  return { width, height, cos, sin, sx, sy, cx, cy, x, y };
}

/**
 * Grows `into` (x0, y0, x1, y1) by the box of `hull` placed at `stamp`. Past it the stamp lays nothing; the shader's
 * sliver past a side on the square's edge (under a pixel) is in every bound's rounding out to whole pixels.
 */
export function stampPlacedSupportInto(shape: StampTipFootprint, hull: StampTipHull, stamp: PlacedStamp, into: number[]) {
  const { cos, sin, sx, sy, cx, cy, x, y } = stampTipPlace(shape, stamp);
  for (let i = 0; i < hull.length; i += 2) {
    const lx = (hull[i] - cx) * sx, ly = (hull[i + 1] - cy) * sy;
    const px = x + cos * lx - sin * ly, py = y + sin * lx + cos * ly;
    if (px < into[0]) into[0] = px;
    if (py < into[1]) into[1] = py;
    if (px > into[2]) into[2] = px;
    if (py > into[3]) into[3] = py;
  }
}

const marksSupports = new WeakMap<FrozenStampMarks, Map<StampTipFootprint, readonly number[]>>();
/** Grows `into` (x0, y0, x1, y1) by the support of `marks` drawn with `shape`'s tip. */
export function stampMarksSupport(marks: FrozenStampMarks, shape: StampTipFootprint, into: number[]) {
  const [x0, y0, x1, y1] = rememberedFor(marksSupports, marks, shape, () => {
    const hull = stampMarksTipHull(shape, marks), found = [Infinity, Infinity, -Infinity, -Infinity];
    for (const stamp of marks) stampPlacedSupportInto(shape, hull, stamp, found);
    return found;
  });
  into[0] = Math.min(into[0], x0); into[1] = Math.min(into[1], y0); into[2] = Math.max(into[2], x1); into[3] = Math.max(into[3], y1);
}

/** Where `deposit` can lay paint, px: its stamps' and dual stamps' support; null for nothing. */
export function stampDepositSupport(deposit: CompiledStampDeposit, tips: StampDepositTips): StampBox | null {
  const into = [Infinity, Infinity, -Infinity, -Infinity];
  stampMarksSupport(deposit.stamps, tips.main, into);
  if (tips.dual) stampMarksSupport(deposit.dualStamps, tips.dual, into);
  return boxOf(into);
}

/** `into` (x0, y0, x1, y1) as a box, null if empty. */
const boxOf = (into: number[]): StampBox | null => (into[0] <= into[2] ? { x0: into[0], y0: into[1], x1: into[2], y1: into[3] } : null);

/** Pixels past its hull a stamp may lay paint: the stamp shader keeps a flat tip a pixel thick. */
export const STAMP_FLAT_TIP_FLOOR = 1;

/**
 * How far `marks` can lay paint at any turn, in stamp diameters, drawn by `tips`, the measured supports of their tip at
 * the profile's samples either side of their diameter (stampBrushSupportAround's, a deposit's main tip's or its dual's):
 * the coarsest tip level they're drawn to, the larger of the two. A stamp's bound is that times its diameter, plus
 * STAMP_FLAT_TIP_FLOOR.
 */
export function stampMeasuredStampReach(tips: StampTipSupportAround, marks: readonly PlacedStamp[]): number {
  const extremes = marksExtremesOf(marks);
  return Math.max(...tips.map((tip) => tip.reach[coarsestLevelFor(tip, tip.reach.length, extremes)]));
}

/**
 * Where `deposit` can lay paint, px, from its brush's profile (refused without one): each stamp's measured reach
 * (stampMeasuredStampReach). For bounds made before any tip is decoded (motion's); a
 * renderer's tips give the closer stampDepositSupport.
 */
export function stampDepositMeasuredSupport(deposit: CompiledStampDeposit): StampBox | null {
  const into = [Infinity, Infinity, -Infinity, -Infinity];
  const { main, dual } = stampBrushSupportAround(stampBrushMeasuredProfile(deposit.brush), deposit.diameter, deposit.brush.name);
  const layers: (readonly [readonly PlacedStamp[], StampTipSupportAround])[] = [[deposit.stamps, main], ...(dual ? [[deposit.dualStamps, dual] as const] : [])];
  for (const [marks, tips] of layers) {
    const reach = stampMeasuredStampReach(tips, marks);
    for (const { x, y, diameter } of marks) {
      const r = reach * diameter + STAMP_FLAT_TIP_FLOOR;
      into[0] = Math.min(into[0], x - r); into[1] = Math.min(into[1], y - r); into[2] = Math.max(into[2], x + r); into[3] = Math.max(into[3], y + r);
    }
  }
  return boxOf(into);
}

/**
 * Every deposit drawn with a hard round tip `size` texels across, and no dual: for paintings whose stamps stand for a
 * disc written by hand (the gate's stage cases) and for tests.
 */
export function stampRoundTipsOf(size = 64): StampTipsOf {
  const tips = { main: stampRoundTipFootprint(size), dual: null };
  return () => tips;
}

/**
 * `brush`'s profile as a hard round tip's (stampRoundTipFootprint): its paint reaching half a diameter from a stroke's
 * centreline. For brushes no pack holds (tests).
 */
export function stampRoundTipStatedProfile(brush: StampBrush): StampBrushMeasuredProfile {
  const round = stampTipSupportOf(stampRoundTipFootprint());
  return stampBrushStatedProfile(brush, 0.5, { main: round, dual: brush.dual ? round : null });
}

/** A hard round tip `size` texels across, spanning its stamp's diameter (stampRoundTipsOf). */
export function stampRoundTipFootprint(size = 64): StampTipFootprint {
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels[y * size + x] = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size / 2 ? 0 : 255;
  return { levels: stampTipLevels({ width: size, height: size, pixels }), span: 1, center: [0.5, 0.5], roundness: 1, pressed: null };
}
