// subject-paint-plan.ts: what the subject painters plan alike before they lay paint. Parts are washed together by
// material, split only where an author's intent or tune treats some differently, so tuning the belly never reseeds
// the body. Eyes and cheeks are found by the tags a subject gives them.

import type { Footprint, Region } from '#lib/paint/document/models/painting-document.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { subjectAreaBox, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import type { PaintableRef, Subject, SubjectFeature, SubjectHex, SubjectMaterial } from '#lib/paint/subject/models/subject.ts';
import { subjectAreaRegion } from '../subject-document-geometry.ts';
import type { ResolvedSubjectIntent, SubjectKeySegment, SubjectPainterContext, VisibleSubjectFeature, VisibleSubjectPart } from '../subject-painter.ts';
import { subjectHexLuminance } from './subject-paint-colour.ts';

/** The tag a part or feature carries to be painted as an eye: an iris, a pupil and a glint of light. */
export const SUBJECT_EYE_TAG = 'eye';
/** The tag a landmark carries to be painted as a blush. */
export const SUBJECT_CHEEK_TAG = 'cheek';
/** The tag of a region drawn as an eye's pupil: an eye whose part carries one is painted as the design draws it. */
export const SUBJECT_PUPIL_TAG = 'pupil';

export const hasSubjectTag = (target: { readonly tags: readonly string[] }, tag: string) => target.tags.some((each) => each === tag);

/**
 * Whether the painter draws `feature` as an eye, with a pupil and glint of its own making: a region tagged `eye` on a
 * part with no `pupil` region, as a primitive figure's eyeball is. A designed eye (the clapper's) is painted as regions.
 */
export function isSubjectPainterEye(subject: Subject, feature: SubjectFeature): boolean {
  if (!hasSubjectTag(feature, SUBJECT_EYE_TAG)) return false;
  return feature.kind === 'landmark'
    || (feature.kind === 'region' && ![...subject.features.values()].some((other) => other.kind === 'region' && other.owner === feature.owner && hasSubjectTag(other, SUBJECT_PUPIL_TAG)));
}

/**
 * Parts a painter washes as one: one material, one resolved intent and one set of tuned options. `segments` name it
 * in keys: the material alone while it is treated as the material is, else the material and a variant of its treatment.
 */
export type SubjectPaintGroup<O> = {
  readonly material: SubjectMaterial;
  readonly segments: readonly SubjectKeySegment[];
  readonly intent: ResolvedSubjectIntent;
  readonly options: O;
  readonly parts: readonly VisibleSubjectPart[];
  readonly areas: readonly SubjectArea[];
};

/** FNV-1a, 32 bits, in base 36: a short, stable name for a treatment. */
function treatmentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

const treatmentText = <O>(intent: ResolvedSubjectIntent, options: O, controls: readonly (keyof O)[]) =>
  JSON.stringify([intent.localColor, intent.preserveLocalColor, intent.emphasis, intent.edge ?? null, controls.map((control) => options[control])]);

/**
 * The parts painted in `slot` that `include` keeps, grouped by material and treatment, materials in declaration
 * order. `controls` are the options the painter reads per group; a tune of any other leaves the group whole.
 */
export function planSubjectPaintGroups<S extends Subject, O, Slot extends string>(
  context: SubjectPainterContext<S, O, Slot>, slot: Slot, controls: readonly (keyof O)[], include: (part: VisibleSubjectPart) => boolean = () => true,
): SubjectPaintGroup<O>[] {
  const groups = new Map<string, { material: SubjectMaterial; text: string; intent: ResolvedSubjectIntent; options: O; parts: VisibleSubjectPart[] }>();
  for (const material of context.subject.materials.values()) {
    for (const part of context.paintedParts(slot)) {
      if (part.material !== material.id || !include(part)) continue;
      const intent = context.intent(part.ref), options = context.optionsFor(part.ref);
      const text = treatmentText(intent, options, controls), id = `${material.id} ${text}`;
      const group = groups.get(id) ?? { material, text, intent, options, parts: [] };
      group.parts.push(part);
      groups.set(id, group);
    }
  }
  return [...groups.values()].map(({ material, text, intent, options, parts }) => {
    const plain = treatmentText({ localColor: material.localColor, preserveLocalColor: material.preserveLocalColor, emphasis: 'normal' }, context.options, controls);
    const segments = text === plain ? [material.ref] : [material.ref, `variant-${treatmentHash(text)}`];
    return { material, segments, intent, options, parts, areas: parts.map(({ visibility }) => visibility.geometry) };
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
  const parts = context.paintedParts(slot).filter((part) => hasSubjectTag(part, SUBJECT_EYE_TAG)).map((part) => ofArea(part.ref, part.visibility.geometry));
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
  context.paintedFeatures(slot).flatMap((feature) => (feature.kind === 'landmark' && hasSubjectTag(feature, SUBJECT_CHEEK_TAG) ? [{ ref: feature.ref, at: feature.visibility.geometry.at }] : []));

/** A pupil's ellipse in an eye, a little below and right of its centre, and the glint high on its left. */
export function subjectEyeMarks({ centre, radiusPx }: SubjectEyeSpot, pupilShare: number, glintShare: number): { pupil: Region; glint: Region } {
  return {
    pupil: { kind: 'ellipse', center: { x: centre.x + 0.08 * radiusPx, y: centre.y + 0.06 * radiusPx }, radiusX: pupilShare * radiusPx, radiusY: (pupilShare + 0.06) * radiusPx },
    glint: { kind: 'ellipse', center: { x: centre.x - 0.3 * radiusPx, y: centre.y - 0.32 * radiusPx }, radiusX: glintShare * radiusPx, radiusY: (glintShare - 0.02) * radiusPx },
  };
}

/**
 * Region features kept clear under a group's paint, so each lands on paper rather than over a colour it can't hide:
 * an eye always, and with `lights` any region lighter than the group. A feature replaced in the slot that would paint
 * it (`slots.eyes`, `slots.regions`) keeps no hole, since its replacement paints over the form.
 */
export function subjectGroupFeatureReserves<S extends Subject, O, Slot extends string>(
  context: SubjectPainterContext<S, O, Slot>, group: SubjectPaintGroup<O>, which: 'eyes' | 'lights', slots: { readonly eyes: Slot; readonly regions: Slot },
): Footprint[] {
  const owners = new Set<string>(group.parts.map(({ id }) => id));
  const groupLuminance = subjectHexLuminance(group.intent.localColor);
  return [...context.subject.features.values()].flatMap((feature): Footprint[] => {
    if (feature.kind !== 'region' || feature.visibility.kind === 'hidden' || !owners.has(feature.owner)) return [];
    if (!context.paints(feature.ref, isSubjectPainterEye(context.subject, feature) ? slots.eyes : slots.regions)) return [];
    const lighter = which === 'lights' && feature.material !== undefined && subjectHexLuminance(context.intent(feature.ref).localColor) > groupLuminance + 0.05;
    return hasSubjectTag(feature, SUBJECT_EYE_TAG) || lighter ? [{ kind: 'region', region: subjectAreaRegion(feature.visibility.geometry) }] : [];
  });
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
