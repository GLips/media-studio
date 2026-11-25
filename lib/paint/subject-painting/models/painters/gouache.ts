// gouache.ts: any subject painted in gouache, dark to light as the hand-painted rig cels are: a ground shadow, each
// material's parts blocked flat in their colour, then the light, read from the subject's normals against its key
// (`soft`, `cel` or `cel-full`) as bands of the colour's own shade, far parts darker, then features, eyes with a white
// glint, and lines. No outline unless asked: value separates the parts.
//
// The brushes and paper come from a binding (work/styles/gouache/subject-painter.ts binds the private pack).

import type { BrushRef, DirectApplication, Edge, Region } from '#lib/paint/document/models/painting-document.ts';
import { subjectAreaBox, type SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import type { PaintableRef, SubjectHex, SubjectLineKind } from '#lib/paint/subject/models/subject.ts';
import { hasSubjectTag, SUBJECT_WELL_KNOWN_TAGS } from '#lib/paint/subject/models/subject-tags.ts';
import { subjectAreaRegion } from '../subject-document-geometry.ts';
import {
  defineSubjectPainter, type ResolvedSubjectIntent, type SubjectContribution, type SubjectPainterContext, type SubjectPainterReport,
} from '../subject-painter.ts';
import { blendSubjectHex } from './subject-paint-colour.ts';
import {
  clampSubjectPaint as clamp, directSubjectLayer, SUBJECT_LINE_EDGE_WEIGHTS, subjectLightOptionProblems, subjectOptionHexProblems, subjectOptionRangeProblems,
} from './subject-paint-kit.ts';
import { subjectPathRuns, subjectSilhouetteStroke } from './subject-paint-lines.ts';
import {
  planSubjectPaintGroups, subjectGroupFeatureReserves, subjectLaterLighterRegions, subjectPaintedRegions, subjectCheekSpots, subjectEyeMarks, subjectEyeSpots, subjectUnitPx, type SubjectPaintGroup,
} from './subject-paint-plan.ts';
import { subjectLightField, subjectLightZoneRings, type LitSubject, type SubjectLightField, type SubjectLightTreatment } from './subject-light-zones.ts';

/** The brushes a gouache subject is painted with: `block` lays flat opaque colour in any shape, `detail` draws lines. */
export type GouacheSubjectBrushes = { readonly block: BrushRef; readonly detail: BrushRef };

/** What a gouache subject is painted with. `paperColor`: the sheet's colour, which the ground shadow is mixed from. */
export type GouacheSubjectBinding = { readonly brushes: GouacheSubjectBrushes; readonly paperColor: SubjectHex };

/**
 * `light` and `terminator` as watercolour's. Per target (controls): `shadowDepth` (1, 0..2) scales how far a shade
 * darkens; `lineWeight` scales lines; `lineColor` is the ink of lines and pupils; `blush` a cheek's colour.
 */
export type GouacheSubjectOptions = {
  readonly light: SubjectLightTreatment;
  readonly terminator: number;
  readonly shadowDepth: number;
  readonly lineWeight: number;
  readonly lineColor: SubjectHex;
  readonly blush: SubjectHex;
  /**
   * Outline the form: the silhouette and every occluding edge, as a cartoon's design does. Off, value separates the
   * parts, and only the lines the design draws (authored, creases, material boundaries) are inked.
   */
  readonly contours: boolean;
  readonly groundShadow: boolean;
};

const GOUACHE_SLOTS = ['ground', 'form', 'light', 'features', 'accents', 'lines'] as const;
/** Where gouache lays its paint, back to front: what a replacement names to sit among it. */
export type GouacheSubjectSlot = (typeof GOUACHE_SLOTS)[number];
/** The slots that paint a region feature: an eye in accents, any other in features. */
const FEATURE_SLOTS = { eyes: 'accents', regions: 'features' } as const;

type GouacheContext = SubjectPainterContext<LitSubject, GouacheSubjectOptions, GouacheSubjectSlot>;
type GouacheGroup = SubjectPaintGroup<GouacheSubjectOptions>;
type GouacheKit = { readonly context: GouacheContext; readonly binding: GouacheSubjectBinding; readonly unit: number; readonly flood: number; readonly field: SubjectLightField };

/** A dark colour shades toward a cool near-black rather than grey; a glint is white. */
const COOL_DARK: SubjectHex = '#1f2640', WHITE: SubjectHex = '#ffffff';

const GROUP_CONTROLS = ['shadowDepth'] as const;
/** Each line's width as a share of the contour's: a design's own lines (a brow, an eye's ring) read bolder than its forms' edges. */
const LINE_KIND_WEIGHT: Record<SubjectLineKind, number> = { authored: 1.6, 'occluding-edge': 1, crease: 0.7, 'material-boundary': 0.7 };

const gouacheOptionProblems = (options: GouacheSubjectOptions): SubjectPainterReport[] => [
  ...subjectLightOptionProblems(options.light),
  ...subjectOptionRangeProblems('terminator', options.terminator, -1, 1),
  ...subjectOptionRangeProblems('shadowDepth', options.shadowDepth, 0, 2),
  ...subjectOptionRangeProblems('lineWeight', options.lineWeight, 0.1, 3),
  ...subjectOptionHexProblems('lineColor', options.lineColor),
  ...subjectOptionHexProblems('blush', options.blush),
];

const solid = (hex: SubjectHex) => ({ kind: 'paint' as const, mix: { parts: [{ pigment: hex, amount: 1 }], strength: 1 } });
const darker = (hex: SubjectHex, share: number) => blendSubjectHex(hex, COOL_DARK, clamp(share, 0, 1));

/** A colour as gouache lays it: exact, or a subdued one let down toward the paper unless it's preserved. */
const blockHex = (kit: GouacheKit, intent: ResolvedSubjectIntent) =>
  (intent.emphasis === 'subdued' && !intent.preserveLocalColor ? blendSubjectHex(intent.localColor, kit.binding.paperColor, 0.15) : intent.localColor);

/** Gouache doesn't melt an edge into the paint under it, so even a lost edge is only a narrow feather. */
const edgeOf = (intent: ResolvedSubjectIntent, unit: number): Edge | undefined =>
  (intent.edge === 'lost' || intent.edge === 'soft' ? { kind: 'feather', widthPx: Math.max(3, (intent.edge === 'lost' ? 0.015 : 0.007) * unit) } : undefined);

const regionArea = (region: Region, edge?: Edge) => ({ region, ...(edge && { edge }) });
const groupTargets = (groups: readonly GouacheGroup[]): PaintableRef[] => groups.flatMap(({ parts }) => parts.map(({ ref }) => ref));
const formGroups = (context: GouacheContext, slot: GouacheSubjectSlot) =>
  planSubjectPaintGroups(context, slot, GROUP_CONTROLS, (part) => !hasSubjectTag(part, SUBJECT_WELL_KNOWN_TAGS.eye));

function groundContribution({ context, binding, unit }: GouacheKit): SubjectContribution<GouacheSubjectSlot>[] {
  const parts = context.paintedParts('ground');
  if (!context.options.groundShadow || !parts.length || context.subject.silhouette.kind === 'hidden') return [];
  const box = subjectAreaBox(context.subject.silhouette.geometry), key = context.paintKey('ground');
  return [{ key, slot: 'ground', targets: parts.map(({ ref }) => ref), layers: [directSubjectLayer(key, [{
    key: `${key}.shadow`, kind: 'fill', brush: binding.brushes.block, diameterPx: 40, seed: key,
    area: { region: { kind: 'ellipse', center: { x: (box.x0 + box.x1) / 2, y: box.y1 - 0.02 * unit }, radiusX: 0.55 * (box.x1 - box.x0), radiusY: 0.045 * unit } },
    charge: solid(blendSubjectHex(binding.paperColor, '#5c412f', 0.14)),
  }])] }];
}

function formContribution(kit: GouacheKit): SubjectContribution<GouacheSubjectSlot>[] {
  const { context, binding, unit, flood } = kit, groups = formGroups(context, 'form');
  if (!groups.length) return [];
  const key = context.paintKey('form');
  const blocks = groups.map((group): DirectApplication => {
    const name = context.paintKey('form', 'block', ...group.segments);
    return {
      key: name, kind: 'fill', area: regionArea(subjectAreaRegion(group.area), edgeOf(group.intent, unit)), reserves: subjectGroupFeatureReserves(context, group, 'lights', FEATURE_SLOTS),
      brush: binding.brushes.block, diameterPx: flood, seed: name, charge: solid(blockHex(kit, group.intent)),
    };
  });
  return [{ key, slot: 'form', targets: groupTargets(groups), layers: [directSubjectLayer(key, blocks)] }];
}

/** A group's light as flat bands of its colour's own shade, clipped to it; `soft` feathers them into each other. */
function groupLightApplications(kit: GouacheKit, group: GouacheGroup): DirectApplication[] {
  const { context, binding, unit, flood, field } = kit;
  const hex = blockHex(kit, group.intent), region = subjectAreaRegion(group.area), clips = [{ region }];
  const depth = group.options.shadowDepth * (group.intent.emphasis === 'accent' ? 1.15 : 1), t = field.terminator;
  const soft: Edge | undefined = context.options.light === 'soft' ? { kind: 'feather', widthPx: Math.max(4, 0.015 * unit) } : undefined;
  const band = (pass: string, rings: readonly SubjectRing[], share: number): DirectApplication[] => {
    if (!rings.length) return [];
    const name = context.paintKey('light', pass, ...group.segments);
    return [{ key: name, kind: 'fill', area: regionArea({ kind: 'polygon', rings }, soft), clips, brush: binding.brushes.block, diameterPx: flood, seed: name, charge: solid(darker(hex, share * depth)) }];
  };
  const zone = (above: number | undefined, below: number | undefined) => subjectLightZoneRings(field, group.parts.map(({ visibility }) => visibility.geometry), { ...(above !== undefined && { above }), ...(below !== undefined && { below }) });
  const far = band('far', group.parts.filter(({ side }) => side === 'far').flatMap(({ visibility }) => visibility.geometry.rings), 0.06);
  const passes: Record<SubjectLightTreatment, () => DirectApplication[]> = {
    soft: () => [...far, ...band('turn', zone(undefined, t + 0.3), 0.07), ...band('shade', zone(undefined, t), 0.14)],
    cel: () => [...far, ...band('shade', zone(undefined, t), 0.14)],
    'cel-full': () => [...far, ...band('half', zone(undefined, 0.55), 0.08), ...band('shade', zone(undefined, t), 0.14), ...band('core', zone(t - 0.2, t + 0.1), 0.22)],
  };
  return passes[context.options.light]();
}

/**
 * Each group's bands in a layer of its own under one `light` group: every band is a shade of its own, and a layer's
 * film holds only STAMP_PIGMENT_GROUP_SLOTS pigments, which a many-coloured subject's bands together outrun.
 */
function lightContribution(kit: GouacheKit): SubjectContribution<GouacheSubjectSlot>[] {
  const groups = formGroups(kit.context, 'light'), key = kit.context.paintKey('light');
  const children = groups.flatMap((group) => {
    const applications = groupLightApplications(kit, group);
    return applications.length ? [directSubjectLayer(kit.context.paintKey('light', ...group.segments), applications)] : [];
  });
  return children.length ? [{ key, slot: 'light', targets: groupTargets(groups), layers: [{ key, children }] }] : [];
}

/** Region features over the form in their colour: their own material's, else their part's. */
function featureContributions(kit: GouacheKit): SubjectContribution<GouacheSubjectSlot>[] {
  const { context, binding, unit } = kit;
  const regions = subjectPaintedRegions(context, 'features');
  if (!regions.length) return [];
  const key = context.paintKey('features');
  const fills = regions.map((feature, at): DirectApplication => {
    const intent = context.intent(feature.ref), name = context.paintKey('features', feature.ref);
    return {
      key: name, kind: 'fill', area: regionArea(subjectAreaRegion(feature.visibility.geometry), edgeOf(intent, unit)), reserves: subjectLaterLighterRegions(context, regions, at), brush: binding.brushes.block,
      diameterPx: 30, seed: name, charge: solid(blockHex(kit, intent)),
    };
  });
  return [{ key, slot: 'features', targets: regions.map(({ ref }) => ref), layers: [directSubjectLayer(key, fills)] }];
}

function accentContributions(kit: GouacheKit): SubjectContribution<GouacheSubjectSlot>[] {
  const { context, binding, unit } = kit;
  const eyes = subjectEyeSpots(context, 'accents'), cheeks = subjectCheekSpots(context, 'accents');
  const applications = eyes.flatMap((eye): DirectApplication[] => {
    const { pupil, glint } = subjectEyeMarks(eye, 0.52, 0.24), name = (pass: string) => context.paintKey('accents', pass, eye.ref);
    const fill = (pass: string, region: Region, hex: SubjectHex): DirectApplication =>
      ({ key: name(pass), kind: 'fill', area: { region }, brush: binding.brushes.block, diameterPx: 30, seed: name(pass), charge: solid(hex) });
    const { lineColor } = context.optionsFor(eye.ref);
    return [
      ...(eye.iris === undefined ? [] : [fill('iris', eye.region, eye.iris)]),
      fill('pupil', eye.iris === undefined ? eye.region : pupil, lineColor),
      fill('glint', glint, WHITE),
    ];
  });
  const blushes = cheeks.map(({ ref, at }): DirectApplication => {
    const name = context.paintKey('accents', 'blush', ref);
    return { key: name, kind: 'fill', area: { region: { kind: 'ellipse', center: at, radiusX: 0.045 * unit, radiusY: 0.03 * unit } }, brush: binding.brushes.block, diameterPx: 30, seed: name, charge: solid(context.optionsFor(ref).blush) };
  });
  if (!applications.length && !blushes.length) return [];
  const key = context.paintKey('accents');
  return [{ key, slot: 'accents', targets: [...eyes.map(({ ref }) => ref), ...cheeks.map(({ ref }) => ref)], layers: [directSubjectLayer(key, [...applications, ...blushes])] }];
}

/** Lines in solid ink with the detail brush: the contours when asked, and every line the design draws. */
function lineContributions(kit: GouacheKit): SubjectContribution<GouacheSubjectSlot>[] {
  const { context, binding, unit } = kit;
  const line = clamp(Math.round(unit * 0.008), 3, 10), runPx = unit * 0.4, hand = { curvature: 0.2 };
  const contributions: SubjectContribution<GouacheSubjectSlot>[] = [];
  const silhouette = context.options.contours ? subjectSilhouetteStroke(context, 'lines', runPx, line * context.options.lineWeight) : undefined;
  if (silhouette) {
    const key = context.paintKey('lines', 'silhouette'), { lineWeight, lineColor } = context.options;
    contributions.push({ key, slot: 'lines', targets: silhouette.targets, layers: [directSubjectLayer(key, [{
      key: `${key}.ink`, kind: 'stroke', subpaths: silhouette.subpaths, hand, reserves: silhouette.reserves,
      brush: binding.brushes.detail, diameterPx: line * lineWeight, seed: key, charge: solid(lineColor),
    }])] });
  }
  for (const feature of context.paintedFeatures('lines')) {
    if (feature.kind !== 'path' || (feature.line === 'occluding-edge' && !context.options.contours)) continue;
    const weight = SUBJECT_LINE_EDGE_WEIGHTS[context.intent(feature.ref).edge ?? 'firm'];
    if (!weight.width) continue;
    const { lineWeight, lineColor } = context.optionsFor(feature.ref);
    const key = context.paintKey('lines', feature.ref), diameterPx = Math.max(2, line * LINE_KIND_WEIGHT[feature.line] * lineWeight * weight.width);
    contributions.push({ key, slot: 'lines', targets: [feature.ref], layers: [directSubjectLayer(key, [{
      key: `${key}.ink`, kind: 'stroke', subpaths: subjectPathRuns(feature.visibility.geometry, runPx, diameterPx), hand,
      brush: binding.brushes.detail, diameterPx, seed: key, charge: solid(lineColor),
    }])] });
  }
  return contributions;
}

/** Gouache's options when a painting gives none: cel light, no contours (value separates the parts). */
export const GOUACHE_SUBJECT_DEFAULTS: GouacheSubjectOptions = {
  light: 'cel', terminator: 0, shadowDepth: 1, lineWeight: 1, lineColor: '#1a1a1a', blush: '#f3a99a', contours: false, groundShadow: true,
};

/** The gouache painter, bound to a style's brushes and paper. */
export const gouacheSubjectPainter = (binding: GouacheSubjectBinding) => defineSubjectPainter<GouacheSubjectOptions>()({
  id: 'gouache',
  evidence: ['surface', 'illumination'],
  defaults: GOUACHE_SUBJECT_DEFAULTS,
  slots: GOUACHE_SLOTS,
  // A part painted by hand sits over the automatic form and light round it, under the lines.
  replaceAllAt: 'features',
  controls: ['shadowDepth', 'lineWeight', 'lineColor', 'blush'],
  intents: ['localColor', 'preserveLocalColor', 'emphasis', 'edge'],
  checkOptions: gouacheOptionProblems,
  paint: (context) => {
    const unit = subjectUnitPx(context.subject);
    const kit: GouacheKit = { context, binding, unit, flood: clamp(Math.round(unit * 0.08), 30, 80), field: subjectLightField(context.subject, context.options.terminator) };
    return [...groundContribution(kit), ...formContribution(kit), ...lightContribution(kit), ...featureContributions(kit), ...accentContributions(kit), ...lineContributions(kit)];
  },
});
