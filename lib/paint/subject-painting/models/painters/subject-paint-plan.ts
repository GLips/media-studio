// subject-paint-plan.ts: what the subject painters plan alike before they lay paint. Parts are washed together by
// material, split only where an author's intent or tune treats some differently in what a pass reads, so tuning the
// belly never reseeds the body. Eyes and cheeks are found by the tags a subject gives them.

import type { Footprint, Region } from '#lib/paint/document/models/painting-document.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { subjectAreaBox, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import { subjectAreasUnion } from '#lib/paint/subject/models/subject-area-union.ts';
import { hasSubjectTag, SUBJECT_WELL_KNOWN_TAGS } from '#lib/paint/subject/models/subject-tags.ts';
import type { PaintableRef, Subject, SubjectFeature, SubjectHex, SubjectMaterial } from '#lib/paint/subject/models/subject.ts';
import { subjectAreaRegion } from '../subject-document-geometry.ts';
import type { ResolvedSubjectIntent, SubjectKeySegment, SubjectPainterContext, VisibleSubjectFeature, VisibleSubjectPart } from '../subject-painter.ts';
import { subjectHexLuminance } from './subject-paint-colour.ts';

/**
 * Whether the painter draws `feature` as an eye, with a pupil and glint of its own making: a region tagged `eye` on a
 * part with no `pupil` region, as a primitive figure's eyeball is. A designed eye (the clapper's) is painted as regions.
 */
export function isSubjectPainterEye(subject: Subject, feature: SubjectFeature): boolean {
  if (!hasSubjectTag(feature, SUBJECT_WELL_KNOWN_TAGS.eye)) return false;
  return feature.kind === 'landmark'
    || (feature.kind === 'region' && ![...subject.features.values()].some((other) => other.kind === 'region' && other.owner === feature.owner && hasSubjectTag(other, SUBJECT_WELL_KNOWN_TAGS.pupil)));
}

/**
 * Parts a pass washes as one: one material, intent and set of the options it reads. `segments` name it in keys and
 * seeds by what it paints, never its treatment's values: the material alone for parts painted as the material is, the
 * material and its parts for parts an author treats apart. So retuning a value reseeds nothing.
 */
export type SubjectPaintGroup<O> = {
  readonly material: SubjectMaterial;
  readonly segments: readonly SubjectKeySegment[];
  readonly intent: ResolvedSubjectIntent;
  readonly options: O;
  readonly parts: readonly [VisibleSubjectPart, ...VisibleSubjectPart[]];
  /** The parts' union, never empty: a group whose parts enclose nothing on the union's grid isn't planned. */
  readonly area: SubjectArea;
};

/** What a pass batches parts by: equal text, one wash. It never reaches a key. */
const treatmentText = <O>(intent: ResolvedSubjectIntent, options: O, controls: readonly (keyof O)[]) =>
  JSON.stringify([intent.localColor, intent.preserveLocalColor, intent.emphasis, intent.edge ?? null, controls.map((control) => options[control])]);

/**
 * The parts painted in `slot` that `include` keeps, grouped by material and treatment, materials in declaration
 * order. `controls` are the options this pass reads per group; a tune of any other leaves its group whole.
 */
export function planSubjectPaintGroups<S extends Subject, O, Slot extends string>(
  context: SubjectPainterContext<S, O, Slot>, slot: Slot, controls: readonly (keyof O)[], include: (part: VisibleSubjectPart) => boolean = () => true,
): SubjectPaintGroup<O>[] {
  const groups = new Map<string, { material: SubjectMaterial; text: string; intent: ResolvedSubjectIntent; options: O; parts: [VisibleSubjectPart, ...VisibleSubjectPart[]] }>();
  for (const material of context.subject.materials.values()) {
    for (const part of context.paintedParts(slot)) {
      if (part.material !== material.id || !include(part)) continue;
      const intent = context.intent(part.ref), options = context.optionsFor(part.ref);
      const text = treatmentText(intent, options, controls), id = `${material.id} ${text}`;
      const group = groups.get(id);
      if (group) group.parts.push(part);
      else groups.set(id, { material, text, intent, options, parts: [part] });
    }
  }
  return [...groups.values()].flatMap(({ material, text, intent, options, parts }): SubjectPaintGroup<O>[] => {
    const [first, ...rest] = parts.map(({ visibility }) => visibility.geometry);
    const union = subjectAreasUnion([first, ...rest]);
    if (union.kind === 'hidden') {
      context.report({
        severity: 'warning', address: `material:${material.id}`, message: `${parts.map(({ id }) => `part:${id}`).join(', ')} enclose nothing a brush can wash`,
        fix: 'give the parts an area wider than a pixel, or hide them',
      });
      return [];
    }
    const plain = treatmentText({ localColor: material.localColor, preserveLocalColor: material.preserveLocalColor, emphasis: 'normal' }, context.options, controls);
    const segments = text === plain ? [material.ref] : [material.ref, ...parts.map(({ ref }) => ref)];
    return [{ material, segments, intent, options, parts, area: union.geometry }];
  });
}

/** The subject's size on the page: its silhouette's height in px, what a painter scales its brushes and marks by. */
export function subjectUnitPx(subject: Subject): number {
  if (subject.silhouette.kind === 'hidden') return 0;
  const box = subjectAreaBox(subject.silhouette.geometry);
  return box.y1 - box.y0;
}

/** An eye to paint: where it is, its iris's region and radius, and the colour its own material gives its iris. */
export type SubjectEyeSpot = {
  readonly ref: PaintableRef;
  readonly centre: StampPoint;
  readonly radiusPx: number;
  readonly region: Region;
  readonly iris?: SubjectHex;
};

/** An eye drawn at a landmark, which has no size of its own: its radius as a share of the subject's height. */
const LANDMARK_EYE_SHARE = 0.03;

/** The eyes the painter draws in `slot`: parts tagged `eye` and isSubjectPainterEye's features. A region's or part's iris is its colour. */
export function subjectEyeSpots<S extends Subject, O, Slot extends string>(context: SubjectPainterContext<S, O, Slot>, slot: Slot): SubjectEyeSpot[] {
  const ofArea = (ref: PaintableRef, area: SubjectArea): SubjectEyeSpot => {
    const box = subjectAreaBox(area);
    const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    return { ref, centre, radiusPx: Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2, region: subjectAreaRegion(area), iris: context.intent(ref).localColor };
  };
  const parts = context.paintedParts(slot).filter((part) => hasSubjectTag(part, SUBJECT_WELL_KNOWN_TAGS.eye)).map((part) => ofArea(part.ref, part.visibility.geometry));
  const radiusPx = LANDMARK_EYE_SHARE * subjectUnitPx(context.subject);
  const features = context.paintedFeatures(slot).filter((feature) => isSubjectPainterEye(context.subject, feature)).flatMap((feature): SubjectEyeSpot[] => {
    if (feature.kind === 'region') return [ofArea(feature.ref, feature.visibility.geometry)];
    if (feature.kind !== 'landmark') return [];
    const { at } = feature.visibility.geometry;
    return [{ ref: feature.ref, centre: at, radiusPx, region: { kind: 'ellipse', center: at, radiusX: radiusPx, radiusY: radiusPx * 1.08 } }];
  });
  return [...parts, ...features];
}

/** The landmarks tagged `cheek` painted in `slot`. */
export const subjectCheekSpots = <S extends Subject, O, Slot extends string>(context: SubjectPainterContext<S, O, Slot>, slot: Slot) =>
  context.paintedFeatures(slot).flatMap((feature) => (feature.kind === 'landmark' && hasSubjectTag(feature, SUBJECT_WELL_KNOWN_TAGS.cheek) ? [{ ref: feature.ref, at: feature.visibility.geometry.at }] : []));

/** A pupil's ellipse in an eye, a little below and right of its centre, and the glint high on its left. */
export function subjectEyeMarks({ centre, radiusPx }: SubjectEyeSpot, pupilShare: number, glintShare: number): { pupil: Region; glint: Region } {
  return {
    pupil: { kind: 'ellipse', center: { x: centre.x + 0.08 * radiusPx, y: centre.y + 0.06 * radiusPx }, radiusX: pupilShare * radiusPx, radiusY: (pupilShare + 0.06) * radiusPx },
    glint: { kind: 'ellipse', center: { x: centre.x - 0.3 * radiusPx, y: centre.y - 0.32 * radiusPx }, radiusX: glintShare * radiusPx, radiusY: (glintShare - 0.02) * radiusPx },
  };
}

const boxesMeet = (a: StampBox, b: StampBox) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/**
 * What a group's paint keeps clear, so each feature lands on paper rather than over a colour it can't hide: an eye
 * always, and with `lights` any region lighter than the group, painted automatically or by a replacement keeping its
 * ground; and every area a replacement reserves as its own ground.
 */
export function subjectGroupFeatureReserves<S extends Subject, O, Slot extends string>(
  context: SubjectPainterContext<S, O, Slot>, group: SubjectPaintGroup<O>, which: 'eyes' | 'lights',
): Footprint[] {
  const owners = new Set<string>(group.parts.map(({ id }) => id));
  const groupLuminance = subjectHexLuminance(group.intent.localColor);
  const features = [...context.subject.features.values()].flatMap((feature): Footprint[] => {
    if (feature.kind !== 'region' || feature.visibility.kind === 'hidden' || !owners.has(feature.owner) || !context.keepsGround(feature.ref)) return [];
    const lighter = which === 'lights' && feature.material !== undefined && subjectHexLuminance(context.intent(feature.ref).localColor) > groupLuminance + 0.05;
    return hasSubjectTag(feature, SUBJECT_WELL_KNOWN_TAGS.eye) || lighter ? [{ kind: 'region', region: subjectAreaRegion(feature.visibility.geometry) }] : [];
  });
  const box = subjectAreaBox(group.area);
  const grounds = context.reservedGrounds.filter((area) => boxesMeet(subjectAreaBox(area), box)).map((area): Footprint => ({ kind: 'region', region: subjectAreaRegion(area) }));
  return [...features, ...grounds];
}

type RegionFeature = Extract<VisibleSubjectFeature, { kind: 'region' }>;

/** The region features painted in `slot` as regions, in declaration order: every one but an eye the painter draws itself. */
export const subjectPaintedRegions = <S extends Subject, O, Slot extends string>(context: SubjectPainterContext<S, O, Slot>, slot: Slot): RegionFeature[] =>
  context.paintedFeatures(slot).filter((feature): feature is RegionFeature => feature.kind === 'region' && !isSubjectPainterEye(context.subject, feature));

/** What `regions[at]` keeps clear: later regions on its part at least as light, as a glint in a pupil or a tongue in a mouth. */
export function subjectLaterLighterRegions<S extends Subject, O, Slot extends string>(
  context: SubjectPainterContext<S, O, Slot>, regions: readonly RegionFeature[], at: number,
): Footprint[] {
  const feature = regions[at], luminance = subjectHexLuminance(context.intent(feature.ref).localColor);
  return regions.slice(at + 1)
    .filter((later) => later.owner === feature.owner && subjectHexLuminance(context.intent(later.ref).localColor) >= luminance - 0.02)
    .map((later) => ({ kind: 'region', region: subjectAreaRegion(later.visibility.geometry) }));
}
