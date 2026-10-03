// painting-application-check.ts: one application held to its geometry, its tip, its charge and its layer's medium:
// what the recipe compiler would throw on, said by key and field before anything is solved, and what the types refuse
// checked again for a source written in JS.

import { paintMediumCan, type PaintCapability, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_FILL_PATTERNS, type StampFillPattern } from '#lib/paint/painting/models/stamp-fill-strokes.ts';
import { STAMP_BLOOM_LEAST_SIGMA, STAMP_BLOOM_SURPLUS, stampBloomSigma } from '#lib/paint/painting/models/stamp-wet-bloom.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { AnyApplication, BrushRef, DepositGeometry, FillGeometry, Footprint, PaintCharge, StampsGeometry, StrokeGeometry } from './painting-document.ts';
import { checkPaintingMix } from './painting-mix-check.ts';
import { isPaintingList, type PaintingProblemList } from './painting-problem.ts';
import {
  checkPaintingAmount, checkPaintingEdge, checkPaintingEdgedRegion, checkPaintingRegion, paintingField, paintingInsideRings, paintingPointsBox,
  paintingRegionBox, paintingRegionRings,
} from './painting-region-check.ts';
import type { PaintingStyleCatalogue } from './painting-styles.ts';

/** What an application is checked in: its layer's medium, whether its wash keeps a wet history, and the styles, if known. */
export type PaintingApplicationSetting = {
  readonly medium: PaintMedium;
  readonly direct: boolean;
  readonly styles?: PaintingStyleCatalogue;
};

const WET_HISTORY_NEEDED = 'needs a wet history: its wash says wetHistory: false';
const GUIDE_ID = /^[^|/~]+$/;

const within01 = (value: number) => value >= 0 && value <= 1;
const positive = (value: number) => value > 0 && Number.isFinite(value);
const finitePoint = ({ x, y }: StampPoint) => Number.isFinite(x) && Number.isFinite(y);

/**
 * The largest diameter `geometry` lays at, px: a stroke's at its widest point, a stamp's own where it states one.
 * Read before the shape is checked, so it reads only what's there.
 */
export function paintingLargestDiameter(geometry: DepositGeometry, diameterPx: number): number {
  if (geometry.kind === 'stroke' && isPaintingList(geometry.subpaths)) {
    return diameterPx * Math.max(1, ...geometry.subpaths.flat().map((point) => (Number.isFinite(point?.scale) ? point.scale ?? 1 : 1)));
  }
  if (geometry.kind === 'stamps' && isPaintingList(geometry.placements)) {
    return Math.max(diameterPx, ...geometry.placements.map((stamp) => (Number.isFinite(stamp?.diameter) ? stamp.diameter ?? 0 : 0)));
  }
  return diameterPx;
}

/** The box `geometry` may lay paint in, document px: its points or area, grown by half its largest diameter. */
export function paintingGeometryBox(geometry: DepositGeometry, diameterPx: number): StampBox | undefined {
  const pad = (Number.isFinite(diameterPx) ? paintingLargestDiameter(geometry, diameterPx) : 0) / 2;
  if (geometry.kind === 'stroke') return isPaintingList(geometry.subpaths) ? paintingPointsBox(geometry.subpaths.flat(), pad) : undefined;
  if (geometry.kind === 'stamps') return isPaintingList(geometry.placements) ? paintingPointsBox(geometry.placements, pad) : undefined;
  return geometry.area?.region ? paintingRegionBox(geometry.area.region, pad) : undefined;
}

/** Why `medium` refuses what needs `capability`, or null. */
const capabilityProblem = (medium: PaintMedium, capability: PaintCapability) =>
  (paintMediumCan(medium, capability) ? null : `needs '${capability}', which ${medium.name} doesn't declare`);

function checkBrush(list: PaintingProblemList, owner: string, field: string, brush: BrushRef, styles: PaintingStyleCatalogue | undefined, box?: StampBox): void {
  if (!brush || !brush.style || !brush.brush) {
    list.error(owner, field, 'a brush is {style, brush}, both named', box);
    return;
  }
  const style = styles?.get(brush.style);
  if (styles && !style) list.error(owner, paintingField(field, 'style'), `names style ${brush.style}, which isn't one of ${[...styles.keys()].join(', ')}`, box);
  else if (style && !style.brushes.has(brush.brush)) list.error(owner, paintingField(field, 'brush'), `${brush.style} has no brush ${brush.brush}: its brushes are ${[...style.brushes.keys()].join(', ')}`, box);
}

/** Problems in a stroke's or stamps' marks and its tip: what a footprint of explicit marks shares with an application. */
function checkMarks(list: PaintingProblemList, owner: string, field: string, marks: StrokeGeometry | StampsGeometry, box?: StampBox): void {
  if (marks.kind === 'stroke') {
    if (!isPaintingList(marks.subpaths) || marks.subpaths.length === 0) list.error(owner, paintingField(field, 'subpaths'), 'a stroke needs at least one subpath', box);
    else marks.subpaths.forEach((subpath, i) => {
      const at = paintingField(field, `subpaths[${i}]`), points = isPaintingList(subpath) ? subpath : [];
      const bad = points.findIndex((point) => !finitePoint(point) || !(point.pressure === undefined || within01(point.pressure)) || !(point.scale === undefined || positive(point.scale)));
      if (points.length === 0) list.error(owner, at, 'a subpath needs at least one point', box);
      else if (bad >= 0) list.error(owner, `${at}[${bad}]`, 'a stroke point is finite, its pressure 0..1 and its scale above 0', paintingPointsBox(points));
    });
    return;
  }
  if (!isPaintingList(marks.placements) || marks.placements.length === 0) {
    list.error(owner, paintingField(field, 'placements'), 'stamps need at least one placement', box);
    return;
  }
  const bad = marks.placements.findIndex((stamp) => !finitePoint(stamp) || !(stamp.diameter === undefined || positive(stamp.diameter))
    || !(stamp.pressure === undefined || within01(stamp.pressure)) || !(stamp.rotation === undefined || Number.isFinite(stamp.rotation)));
  if (bad >= 0) list.error(owner, paintingField(field, `placements[${bad}]`), 'a placement is finite, its diameter above 0 and its pressure 0..1', box);
}

/** Which way a guide runs, first point to last. */
const guideHeading = (path: readonly StampPoint[]) => [path.at(-1)!.x - path[0].x, path.at(-1)!.y - path[0].y];

/** Why a paint charge's `maxSpreadPx` can't hold, or null. */
function maxSpreadProblem(maxSpreadPx: number, { medium, direct }: PaintingApplicationSetting): string | null {
  if (direct) return `maxSpreadPx ${WET_HISTORY_NEEDED}`;
  if (!(medium.wetting.spread > 0)) return `${medium.name}'s paint doesn't spread`;
  return positive(maxSpreadPx) ? null : `${maxSpreadPx} isn't above 0`;
}

function checkFill(list: PaintingProblemList, owner: string, fill: FillGeometry, setting: PaintingApplicationSetting, box?: StampBox): void {
  if (!fill.area?.region) {
    list.error(owner, 'area', 'a fill needs an area', box);
    return;
  }
  checkPaintingEdgedRegion(list, owner, 'area', fill.area, setting.direct ? `bleed ${WET_HISTORY_NEEDED}` : null);
  if (fill.direction !== undefined && !Number.isFinite(fill.direction)) list.error(owner, 'direction', `${fill.direction} isn't a finite angle`, box);
  if (fill.load !== undefined) checkPaintingAmount(list, owner, 'load', fill.load, box);
  const { laying } = fill;
  if (!laying) return;
  const layingKind: string = laying.kind;
  if (layingKind !== 'flood' && layingKind !== 'strokes') {
    list.error(owner, 'laying.kind', `'${layingKind}' isn't flood or strokes`, box);
    return;
  }
  if (laying.reach !== undefined && laying.reach !== 'inside' && !(laying.reach.past >= 0 && Number.isFinite(laying.reach.past))) {
    list.error(owner, 'laying.reach', `reaches 'inside' or a finite 0 or more diameters past, not ${laying.reach.past}`, box);
  }
  if (laying.kind === 'flood') return;
  if (laying.spacing !== undefined && !positive(laying.spacing)) list.error(owner, 'laying.spacing', `${laying.spacing} isn't above 0`, box);
  if (laying.variation !== undefined && !within01(laying.variation)) list.error(owner, 'laying.variation', `${laying.variation} isn't within 0..1`, box);
  const pattern: StampFillPattern | undefined = laying.pattern, patternKind: string | undefined = pattern?.kind;
  if (!pattern || patternKind === undefined || !Object.hasOwn(STAMP_FILL_PATTERNS, patternKind)) {
    const kinds = Object.keys(STAMP_FILL_PATTERNS).join(', ');
    list.error(owner, 'laying.pattern', patternKind === undefined ? `a pattern is {kind}, one of ${kinds}` : `'${patternKind}' isn't a pattern: one of ${kinds}`, box);
    return;
  }
  const turns: string | undefined = 'turns' in pattern ? pattern.turns : undefined;
  if (turns !== undefined && turns !== 'eased' && turns !== 'pressed') list.error(owner, 'laying.pattern.turns', `'${turns}' isn't eased or pressed`, box);
  if (pattern.kind !== 'guided') return;
  const { guides } = pattern;
  if (!isPaintingList(guides) || guides.length < 2) {
    list.error(owner, 'laying.pattern.guides', `a guided fill needs at least two guides, not ${isPaintingList(guides) ? guides.length : 'none'}`, box);
    return;
  }
  const rings = paintingRegionRings(fill.area.region);
  guides.forEach(({ id, path }, g) => {
    const at = `laying.pattern.guides[${g}]`, guideBox = paintingPointsBox(path);
    if (!GUIDE_ID.test(id) || guides.findIndex((other) => other.id === id) !== g) list.error(owner, paintingField(at, 'id'), `'${id}' needs to be its own: non-empty, unique, no |, / or ~`, guideBox);
    else if (path.length < 2 || !path.every(finitePoint)) list.error(owner, paintingField(at, 'path'), 'a guide needs at least two finite points', guideBox);
    else if ([path[0], path.at(-1)!].some(({ x, y }) => paintingInsideRings(rings, x, y))) list.error(owner, paintingField(at, 'path'), 'ends inside the area: guides span the shape, from outside it to outside it', guideBox);
    else if (g > 0) {
      const [ax, ay] = guideHeading(guides[g - 1].path), [bx, by] = guideHeading(path);
      if (ax * bx + ay * by <= 0) list.error(owner, paintingField(at, 'path'), `runs against guide ${guides[g - 1].id}: guides all run the same way`, guideBox);
    }
  });
}

/** Problems in a reserve's or resist's footprint at `field`: an application's, or a prewet's reserves. */
export function checkPaintingFootprint(list: PaintingProblemList, owner: string, field: string, footprint: Footprint, styles: PaintingStyleCatalogue | undefined): void {
  const anchor: string | undefined = footprint.anchor;
  if (anchor !== undefined && anchor !== 'paper') list.error(owner, paintingField(field, 'anchor'), `'${anchor}' isn't 'paper'`);
  if (footprint.kind === 'region') {
    if (!checkPaintingRegion(list, owner, paintingField(field, 'region'), footprint.region)) return;
    if (footprint.edge) checkPaintingEdge(list, owner, paintingField(field, 'edge'), footprint.edge, "a mask's edge is crisp or feather: masking fluid and wax don't bleed", paintingRegionBox(footprint.region));
    return;
  }
  const kind: string = footprint.kind;
  if (kind !== 'stroke' && kind !== 'stamps') {
    list.error(owner, paintingField(field, 'kind'), `'${kind}' isn't region, stroke or stamps`);
    return;
  }
  const box = paintingGeometryBox(footprint, footprint.diameterPx);
  if (!positive(footprint.diameterPx)) list.error(owner, paintingField(field, 'diameterPx'), `${footprint.diameterPx} isn't above 0`, box);
  checkBrush(list, owner, paintingField(field, 'brush'), footprint.brush, styles, box);
  checkMarks(list, owner, field, footprint, box);
}

function checkPaintCharge(list: PaintingProblemList, owner: string, charge: PaintCharge, application: AnyApplication, setting: PaintingApplicationSetting, box?: StampBox): void {
  const { medium, direct, styles } = setting;
  if (!charge.mix) list.error(owner, 'charge.mix', 'a paint charge needs a mix', box);
  else checkPaintingMix(list, owner, 'charge.mix', charge.mix, box);
  if (charge.water !== undefined) {
    const dry = styles?.get(application.brush.style)?.brushes.get(application.brush.brush) === 'dry';
    const problem = direct ? `water ${WET_HISTORY_NEEDED}` : capabilityProblem(medium, 'water')
      ?? (dry ? 'states water, but its brush is dry and carries none' : null) ?? (within01(charge.water) ? null : `${charge.water} isn't within 0..1`);
    if (problem) list.error(owner, 'charge.water', problem, box);
  }
  if (charge.maxSpreadPx !== undefined) {
    const problem = maxSpreadProblem(charge.maxSpreadPx, setting);
    if (problem) list.error(owner, 'charge.maxSpreadPx', problem, box);
  }
  if (charge.opacityCap !== undefined && !within01(charge.opacityCap)) list.error(owner, 'charge.opacityCap', `${charge.opacityCap} isn't within 0..1`, box);
  if (charge.burnish !== undefined) {
    const problem = capabilityProblem(medium, 'burnish');
    if (problem) list.error(owner, 'charge.burnish', problem, box);
  }
}

function checkCharge(list: PaintingProblemList, owner: string, application: AnyApplication, setting: PaintingApplicationSetting, box?: StampBox): void {
  const { charge } = application, { medium, direct } = setting;
  const kind: string = charge?.kind;
  if (charge?.kind === 'paint') checkPaintCharge(list, owner, charge, application, setting, box);
  else if (charge?.kind === 'lift') {
    const problem = capabilityProblem(medium, 'lift') ?? (within01(charge.strength) ? null : `${charge.strength} isn't within 0..1`);
    if (problem) list.error(owner, 'charge.strength', problem, box);
  } else if (charge?.kind === 'water') {
    // A direct wash's types refuse water; a JS source may still write it.
    const problem = direct ? `water ${WET_HISTORY_NEEDED}` : capabilityProblem(medium, 'water') ?? (within01(charge.water) ? null : `${charge.water} isn't within 0..1`);
    if (problem) list.error(owner, direct ? 'charge' : 'charge.water', problem, box);
  } else list.error(owner, 'charge', `a charge is paint, water or lift, not ${kind ?? 'missing'}`, box);
}

function checkBloom(list: PaintingProblemList, owner: string, application: AnyApplication, setting: PaintingApplicationSetting, box?: StampBox): void {
  const effect: string | undefined = 'effect' in application ? application.effect : undefined;
  if (effect === undefined) return;
  if (effect !== 'bloom') {
    list.error(owner, 'effect', `'${effect}' isn't an effect: there's only 'bloom'`, box);
    return;
  }
  const charge = application.charge;
  if (charge.kind !== 'water') {
    list.error(owner, 'effect', `${charge.kind === 'lift' ? 'lifts' : 'lays paint'}; a bloom is water`, box);
    return;
  }
  const { medium } = setting, { spread } = medium.wetting;
  const largest = stampBloomSigma(spread, paintingLargestDiameter(application, application.diameterPx), 1);
  if (!(spread > 0)) list.error(owner, 'effect', `won't bloom: ${medium.name}'s water doesn't spread`, box);
  else if (largest < STAMP_BLOOM_LEAST_SIGMA) list.error(owner, 'effect', `won't bloom: ${medium.name} spreads ${spread} d, so its largest bloom is ${Number(largest.toFixed(2))} px`, box);
  else if (!(charge.water > STAMP_BLOOM_SURPLUS.least)) list.error(owner, 'effect', `won't bloom: its water ${charge.water} can't rise ${STAMP_BLOOM_SURPLUS.least} over the paper's`, box);
}

/**
 * Problems in `application`, named `owner`, in `setting`. Its key, `at` and `on`'s reachability are the wash's to
 * check, which knows its order and its clock.
 */
export function checkPaintingApplication(list: PaintingProblemList, owner: string, application: AnyApplication, setting: PaintingApplicationSetting): void {
  const geometryKind: string | undefined = application.kind;
  if (geometryKind !== 'stroke' && geometryKind !== 'stamps' && geometryKind !== 'fill') {
    list.error(owner, 'kind', geometryKind === undefined ? 'needs a kind: stroke, stamps or fill' : `'${geometryKind}' isn't stroke, stamps or fill`);
    return;
  }
  const box = paintingGeometryBox(application, application.diameterPx);
  if (application.kind === 'fill') checkFill(list, owner, application, setting, box);
  else checkMarks(list, owner, '', application, box);
  if (!positive(application.diameterPx)) list.error(owner, 'diameterPx', `${application.diameterPx} isn't above 0`, box);
  checkBrush(list, owner, 'brush', application.brush, setting.styles, box);
  checkCharge(list, owner, application, setting, box);
  checkBloom(list, owner, application, setting, box);
  const on: string | undefined = 'on' in application ? application.on : undefined;
  if (on !== undefined) {
    const problem = setting.direct ? `on ${WET_HISTORY_NEEDED}` : capabilityProblem(setting.medium, 'wet-conditions') ?? (['wet', 'damp', 'dry'].includes(on) ? null : `'${on}' isn't wet, damp or dry`);
    if (problem) list.error(owner, 'on', problem, box);
  }
  application.clips?.forEach((clip, i) => {
    checkPaintingEdgedRegion(list, owner, `clips[${i}]`, clip, setting.direct ? `bleed ${WET_HISTORY_NEEDED}` : null);
    const anchor: string | undefined = clip.anchor;
    if (anchor !== undefined && anchor !== 'paper') list.error(owner, `clips[${i}].anchor`, `'${anchor}' isn't 'paper'`, box);
  });
  application.reserves?.forEach((footprint, i) => checkPaintingFootprint(list, owner, `reserves[${i}]`, footprint, setting.styles));
  application.resists?.forEach(({ footprints, amount }, i) => {
    if (!within01(amount)) list.error(owner, `resists[${i}].amount`, `${amount} isn't within 0..1`, box);
    footprints.forEach((footprint, j) => checkPaintingFootprint(list, owner, `resists[${i}].footprints[${j}]`, footprint, setting.styles));
  });
}
