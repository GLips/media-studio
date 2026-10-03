// painting-application-check.ts: one application held to its geometry, its tip, its charge and its layer's medium:
// what the recipe compiler would throw on, said by key and field before anything is solved, and what the types refuse
// checked again for a source written in JS.

import { paintMediumCan, type PaintCapability, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampFillGuidesProblem, stampFillReachProblem, stampFillStrokesProblem } from '#lib/paint/painting/models/stamp-fill-strokes.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_BLOOM_LEAST_SIGMA, STAMP_BLOOM_SURPLUS, stampBloomSigma } from '#lib/paint/painting/models/stamp-wet-bloom.ts';
import type { AnyApplication, BrushRef, FillGeometry, Footprint, PaintCharge, StampsGeometry, StrokeGeometry } from './painting-document.ts';
import { paintingGeometryBox, paintingLargestDiameter, paintingPointsBox, paintingRegionBox } from './painting-footprint.ts';
import { checkPaintingMix } from './painting-mix-check.ts';
import { isPaintingFinitePoint, isPaintingList, isPaintingPositive, isPaintingShare, paintingField, type PaintingProblemList } from './painting-problem.ts';
import { checkPaintingAmount, checkPaintingEdge, checkPaintingEdgedRegion, checkPaintingRegion, paintingRegionRings } from './painting-region-check.ts';
import { paintingBrushMedia, type PaintingStyleCatalogue } from './painting-styles.ts';

/** What an application is checked in: its layer's medium, whether its wash keeps a wet history, and the styles, if known. */
export type PaintingApplicationSetting = {
  readonly medium: PaintMedium;
  readonly direct: boolean;
  readonly styles?: PaintingStyleCatalogue;
};

const WET_HISTORY_NEEDED = 'needs a wet history: its wash says wetHistory: false';

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
      const bad = points.findIndex((point) => !isPaintingFinitePoint(point) || !(point.pressure === undefined || isPaintingShare(point.pressure)) || !(point.scale === undefined || isPaintingPositive(point.scale)));
      if (points.length === 0) list.error(owner, at, 'a subpath needs at least one point', box);
      else if (bad >= 0) list.error(owner, `${at}[${bad}]`, 'a stroke point is finite, its pressure 0..1 and its scale above 0', paintingPointsBox(points));
    });
    return;
  }
  if (!isPaintingList(marks.placements) || marks.placements.length === 0) {
    list.error(owner, paintingField(field, 'placements'), 'stamps need at least one placement', box);
    return;
  }
  const bad = marks.placements.findIndex((stamp) => !isPaintingFinitePoint(stamp) || !(stamp.diameter === undefined || isPaintingPositive(stamp.diameter))
    || !(stamp.pressure === undefined || isPaintingShare(stamp.pressure)) || !(stamp.rotation === undefined || Number.isFinite(stamp.rotation)));
  if (bad >= 0) list.error(owner, paintingField(field, `placements[${bad}]`), 'a placement is finite, its diameter above 0 and its pressure 0..1', box);
}

/** Why a paint charge's `maxSpreadPx` can't hold, or null. */
function maxSpreadProblem(maxSpreadPx: number, { medium, direct }: PaintingApplicationSetting): string | null {
  if (direct) return `maxSpreadPx ${WET_HISTORY_NEEDED}`;
  if (!(medium.wetting.spread > 0)) return `${medium.name}'s paint doesn't spread`;
  return isPaintingPositive(maxSpreadPx) ? null : `${maxSpreadPx} isn't above 0`;
}

function checkFill(list: PaintingProblemList, owner: string, fill: FillGeometry, setting: PaintingApplicationSetting, box?: StampBox): void {
  if (!fill.area?.region) {
    list.error(owner, 'area', 'a fill needs an area', box);
    return;
  }
  const readable = checkPaintingEdgedRegion(list, owner, 'area', fill.area, setting.direct ? `bleed ${WET_HISTORY_NEEDED}` : null);
  if (fill.direction !== undefined && !Number.isFinite(fill.direction)) list.error(owner, 'direction', `${fill.direction} isn't a finite angle`, box);
  if (fill.load !== undefined) checkPaintingAmount(list, owner, 'load', fill.load, box);
  const { laying } = fill;
  if (!laying) return;
  if (laying.kind === 'flood') {
    const problem = laying.reach === undefined ? null : stampFillReachProblem(laying.reach);
    if (problem) list.error(owner, 'laying.reach', problem, box);
    return;
  }
  const layingKind: string = laying.kind;
  if (layingKind !== 'strokes') {
    list.error(owner, 'laying.kind', `'${layingKind}' isn't flood or strokes`, box);
    return;
  }
  const problem = stampFillStrokesProblem(laying);
  if (problem) list.error(owner, 'laying', problem, box);
  if (problem || !readable || laying.pattern.kind !== 'guided') return;
  const guides = isPaintingList(laying.pattern.guides) ? laying.pattern.guides : [];
  const found = stampFillGuidesProblem(paintingRegionRings(fill.area.region), guides);
  if (!found) return;
  if (found.guide === null) list.error(owner, 'laying.pattern.guides', found.problem, box);
  else list.error(owner, `laying.pattern.guides[${found.guide}]`, found.problem, paintingPointsBox(guides[found.guide].path));
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
  if (!isPaintingPositive(footprint.diameterPx)) list.error(owner, paintingField(field, 'diameterPx'), `${footprint.diameterPx} isn't above 0`, box);
  checkBrush(list, owner, paintingField(field, 'brush'), footprint.brush, styles, box);
  checkMarks(list, owner, field, footprint, box);
}

function checkPaintCharge(list: PaintingProblemList, owner: string, charge: PaintCharge, application: AnyApplication, setting: PaintingApplicationSetting, box?: StampBox): void {
  const { medium, direct, styles } = setting;
  if (!charge.mix) list.error(owner, 'charge.mix', 'a paint charge needs a mix', box);
  else checkPaintingMix(list, owner, 'charge.mix', charge.mix, box);
  if (charge.water !== undefined) {
    const dry = paintingBrushMedia(styles, application.brush) === 'dry';
    const problem = direct ? `water ${WET_HISTORY_NEEDED}` : capabilityProblem(medium, 'water')
      ?? (dry ? 'states water, but its brush is dry and carries none' : null) ?? (isPaintingShare(charge.water) ? null : `${charge.water} isn't within 0..1`);
    if (problem) list.error(owner, 'charge.water', problem, box);
  }
  if (charge.maxSpreadPx !== undefined) {
    const problem = maxSpreadProblem(charge.maxSpreadPx, setting);
    if (problem) list.error(owner, 'charge.maxSpreadPx', problem, box);
  }
  if (charge.opacityCap !== undefined && !isPaintingShare(charge.opacityCap)) list.error(owner, 'charge.opacityCap', `${charge.opacityCap} isn't within 0..1`, box);
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
    const problem = capabilityProblem(medium, 'lift') ?? (isPaintingShare(charge.strength) ? null : `${charge.strength} isn't within 0..1`);
    if (problem) list.error(owner, 'charge.strength', problem, box);
  } else if (charge?.kind === 'water') {
    // A direct wash's types refuse water; a JS source may still write it.
    const problem = direct ? `water ${WET_HISTORY_NEEDED}` : capabilityProblem(medium, 'water') ?? (isPaintingShare(charge.water) ? null : `${charge.water} isn't within 0..1`);
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
  if (!isPaintingPositive(application.diameterPx)) list.error(owner, 'diameterPx', `${application.diameterPx} isn't above 0`, box);
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
    if (!isPaintingShare(amount)) list.error(owner, `resists[${i}].amount`, `${amount} isn't within 0..1`, box);
    footprints.forEach((footprint: Footprint, j) => {
      // The types give wax marks only; a JS source may still write a region.
      if (footprint.kind === 'region') list.error(owner, `resists[${i}].footprints[${j}]`, "is a region, and wax is laid by a brush's marks: give it a stroke or stamps", box);
      else checkPaintingFootprint(list, owner, `resists[${i}].footprints[${j}]`, footprint, setting.styles);
    });
  });
}
