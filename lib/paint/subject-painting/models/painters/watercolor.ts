// watercolor.ts: any subject painted in watercolour, light first, since the paper is the only white. Each material's
// parts are washed as one: a pale warm tint, then the local colour, thin as vid-144's hand-painted frog glazes it,
// lighter features kept as paper. Then the light, read from the subject's normals against its key (`soft`, `cel` or
// `cel-full`), far parts deeper, a mottle, the features, the eyes and a light ink line where materials meet. Where a
// wash meets the silhouette it bleeds into the paper (`bleed`), so the figure ends in a soft wet edge.
//
// The brushes and pigments come from a binding (work/styles/<name>/subject-painter.ts), never a style's own names.

import type { Application, BrushRef, Clip, DirectApplication, Edge, EdgedRegion, Footprint, LayerNode, Mix, MixPart, Region } from '#lib/paint/document/models/painting-document.ts';
import { subjectAreasUnion } from '#lib/paint/subject/models/subject-area-union.ts';
import { subjectAreaBox } from '#lib/paint/subject/models/subject-geometry.ts';
import type { PaintableRef, SubjectHex, SubjectLineKind } from '#lib/paint/subject/models/subject.ts';
import { hasSubjectTag, SUBJECT_WELL_KNOWN_TAGS } from '#lib/paint/subject/models/subject-tags.ts';
import { subjectAreaRegion } from '../subject-document-geometry.ts';
import {
  defineSubjectPainter, type ResolvedSubjectIntent, type SubjectContribution, type SubjectEmphasis, type SubjectPainterContext, type SubjectPainterReport,
} from '../subject-painter.ts';
import { blendSubjectHex, mutedSubjectHex, subjectHexLuminance } from './subject-paint-colour.ts';
import { subjectMaterialEdgeStretches, subjectPathRuns, subjectSilhouetteStretches, subjectStretchRuns } from './subject-paint-lines.ts';
import {
  planSubjectPaintGroups, subjectGroupFeatureReserves, subjectLaterLighterRegions, subjectPaintedRegions, subjectCheekSpots, subjectEyeMarks, subjectEyeSpots, subjectUnitPx, type SubjectPaintGroup,
} from './subject-paint-plan.ts';
import {
  clampSubjectPaint, directSubjectLayer, SUBJECT_LINE_EDGE_WEIGHTS, subjectLightOptionProblems, subjectOptionHexProblems, subjectOptionRangeProblems, wetSubjectLayer,
} from './subject-paint-kit.ts';
import { subjectLightField, subjectLightZoneRings, type LitSubject, type SubjectLightField, type SubjectLightTreatment } from './subject-light-zones.ts';
import { subjectOutlineEdgedRegion, subjectOutlineReader, type SubjectOutlineReader } from './subject-paint-outline.ts';

/** A pigment as a mix names one: a medium's own (WATERCOLOUR_PIGMENTS) or a hex fitted as one. */
export type SubjectPigment = MixPart['pigment'];

/** The brushes a watercolour subject is painted with, by what each does. */
export type WatercolorSubjectBrushes = {
  /** Floods a local colour, a tint and a shade band. */
  readonly wash: BrushRef;
  /** The core laid into the shade while it's wet (`cel-full`). */
  readonly wet: BrushRef;
  /** Marks and regions over the dry form. */
  readonly mark: BrushRef;
  /** A broken mottle scribbled over each colour. */
  readonly texture: BrushRef;
  /** Eyes, ink shapes and creases. */
  readonly detail: BrushRef;
  /** The outline's ink. */
  readonly line: BrushRef;
};

/**
 * What a watercolour subject is painted with. `shadow`: the cool and warm a shade is greyed with, as ultramarine and
 * burnt umber; `sky`: the cool of a cast shadow on the ground.
 */
export type WatercolorSubjectBinding = {
  readonly brushes: WatercolorSubjectBrushes;
  readonly pigments: { readonly cool: SubjectPigment; readonly warm: SubjectPigment; readonly sky: SubjectPigment };
};

/**
 * `light`: how light is modelled. `terminator`: the cosine to the key below which form is shade, unless the subject
 * authors one. Per target: `shadowDepth` (0..2) scales shades; `mute` (0..1) greys an unpreserved colour; `texture`
 * (0..1) is the mottle's most opacity; `lineWeight` scales lines; `lineColor` inks lines and pupils.
 */
export type WatercolorSubjectOptions = {
  readonly light: SubjectLightTreatment;
  readonly terminator: number;
  readonly shadowDepth: number;
  readonly mute: number;
  readonly texture: number;
  readonly lineWeight: number;
  readonly lineColor: SubjectHex;
  readonly blush: SubjectHex;
  /**
   * Outline the form in a light ink line, as the hand frog's is: the silhouette and every occluding edge. Off, only the
   * lines the design draws (authored, creases, material boundaries) are inked.
   */
  readonly contours: boolean;
  /** A soft cast shadow on the ground under the subject. */
  readonly groundShadow: boolean;
  /**
   * 0..0.1: how far the washes bleed past the silhouette into the paper, a share of the subject's height, ragged as a
   * wet edge dries. 0 stops them at the outline. A part whose edge intent is `firm` or `hard` never bleeds.
   */
  readonly bleed: number;
};

const WATERCOLOR_SLOTS = ['ground', 'form', 'light', 'texture', 'features', 'accents', 'lines'] as const;
/** Where watercolour lays its paint, back to front: what a replacement names to sit among it. */
export type WatercolorSubjectSlot = (typeof WATERCOLOR_SLOTS)[number];

type WatercolorContext = SubjectPainterContext<LitSubject, WatercolorSubjectOptions, WatercolorSubjectSlot>;
type WatercolorGroup = SubjectPaintGroup<WatercolorSubjectOptions>;

/** The options each pass reads per group, so tuning any other per target leaves that pass's shared wash whole. */
const PASS_CONTROLS = { form: ['mute', 'bleed'], light: ['mute', 'shadowDepth'], texture: ['mute', 'texture'] } as const;

const clamp = clampSubjectPaint;

const watercolorOptionProblems = (options: WatercolorSubjectOptions): SubjectPainterReport[] => [
  ...subjectLightOptionProblems(options.light),
  ...subjectOptionRangeProblems('terminator', options.terminator, -1, 1),
  ...subjectOptionRangeProblems('shadowDepth', options.shadowDepth, 0, 2),
  ...subjectOptionRangeProblems('mute', options.mute, 0, 1),
  ...subjectOptionRangeProblems('texture', options.texture, 0, 1),
  ...subjectOptionRangeProblems('bleed', options.bleed, 0, 0.1),
  ...subjectOptionRangeProblems('lineWeight', options.lineWeight, 0.1, 3),
  ...subjectOptionHexProblems('lineColor', options.lineColor),
  ...subjectOptionHexProblems('blush', options.blush),
];

/** How an emphasis moves a colour's charge, its muting and its shade. */
const EMPHASIS: Record<SubjectEmphasis, { strength: number; mute: number; shade: number }> = {
  subdued: { strength: 0.8, mute: 1.8, shade: 0.7 },
  normal: { strength: 1, mute: 1, shade: 1 },
  accent: { strength: 1.15, mute: 0.3, shade: 1.1 },
};

/** Everything a pass reads: the context, the binding, sizes from the subject's height, and the light field. */
type WatercolorKit = {
  readonly context: WatercolorContext;
  readonly binding: WatercolorSubjectBinding;
  readonly unit: number;
  readonly flood: number;
  readonly field: SubjectLightField;
  readonly outline: SubjectOutlineReader;
};

const tint = (hex: SubjectHex, strength: number): Mix => ({ parts: [{ pigment: hex, amount: 1 }], strength });

/** The depth from which a shade lays its full charge; a shallower one thins toward nothing, so depth 0 is no shade at all. */
const FULL_SHADE_DEPTH = 0.2;

/** The local colour greyed with the cool and warm; a near-white local takes half the depth, as its full shadow reads dirty. */
function shadeOf({ binding }: WatercolorKit, hex: SubjectHex, depth: number): Mix {
  const d = depth * (0.5 + 0.5 * Math.min(1, 1.6 * (1 - subjectHexLuminance(hex))));
  const { cool, warm } = binding.pigments;
  const strength = (0.45 + 0.35 * d) * Math.min(1, depth / FULL_SHADE_DEPTH);
  return { parts: [{ pigment: hex, amount: 1 }, { pigment: cool, amount: 0.35 * d }, { pigment: warm, amount: 0.3 * d }], strength };
}

/** A region darker than this is ink, never a glaze. */
const INK_LUMINANCE = 0.15;

/** Whether a colour is built up in glazes: a pale tint, then the local thinned. A preserved or near-black one goes straight down at full strength, since a thinned black reads grey. */
const glazedSubjectColour = (intent: ResolvedSubjectIntent) => !intent.preserveLocalColor && subjectHexLuminance(intent.localColor) >= INK_LUMINANCE;

/** A colour as this painter lays it: muted unless preserved. */
const localHex = (intent: ResolvedSubjectIntent, mute: number) =>
  (intent.preserveLocalColor ? intent.localColor : mutedSubjectHex(intent.localColor, clamp(mute * EMPHASIS[intent.emphasis].mute, 0, 1)));

/** A local colour's charge: thin for a light colour, as the hand frog's glazes are, fuller for a dark one; full when not glazed. */
const localStrength = (intent: ResolvedSubjectIntent, hex: SubjectHex) =>
  (!glazedSubjectColour(intent) ? 1 : clamp((0.45 + 0.55 * (1 - subjectHexLuminance(hex)) ** 0.7) * EMPHASIS[intent.emphasis].strength, 0, 1));

const edgeOf = (intent: ResolvedSubjectIntent, unit: number): Edge | undefined => {
  if (intent.edge === 'lost') return { kind: 'feather', widthPx: Math.max(6, 0.03 * unit) };
  if (intent.edge === 'soft') return { kind: 'feather', widthPx: Math.max(4, 0.012 * unit) };
  return undefined;
};

const regionArea = (region: Region, edge?: Edge) => ({ region, ...(edge && { edge }) });

/**
 * How a group's washes leave the figure: a ragged bleed `bleed` of the subject's height past the silhouette, seeded by
 * the group's own key so it holds while the figure moves; none when its edge intent holds it firm. A near-black runs a
 * third as far: an even dark halo reads as smoke, not water.
 */
function outlineBleed({ context, unit }: WatercolorKit, group: WatercolorGroup): Extract<Edge, { kind: 'bleed' }> | undefined {
  const reachPx = group.options.bleed * unit * (subjectHexLuminance(group.intent.localColor) < INK_LUMINANCE ? 1 / 3 : 1);
  if (!(reachPx > 0) || group.intent.edge === 'firm' || group.intent.edge === 'hard') return undefined;
  return { kind: 'bleed', reachPx, roughness: { amountPx: 0.8 * reachPx, featurePx: Math.max(12, 4 * reachPx), seed: context.paintKey('bleed', ...group.segments) } };
}

/**
 * Where a group's form wash lays: edged `inside` within the figure, bleeding past the silhouette as the group may. Only
 * an area's own bleed lays paint past its line (a bleeding boundary just opens it to water), so the area bleeds all
 * round and its clip, open along the silhouette alone, holds it at the figure's inside edges.
 */
function groupWashBounds(kit: WatercolorKit, group: WatercolorGroup, region: Region, inside?: Edge): { area: EdgedRegion; clips: Clip[] } {
  const outline = outlineBleed(kit, group);
  if (!outline) return { area: regionArea(region, inside), clips: [{ region }] };
  const others = otherPartsClip(kit, group, outline.reachPx);
  return { area: { region, edge: outline }, clips: [subjectOutlineEdgedRegion(kit.outline, region, { ...(inside && { inside }), outline }), ...(others ? [others] : [])] };
}

/**
 * Everywhere but the figure's other parts: where a part meets the silhouette right beside another (a glove against
 * the slate it rests on), a bleed would otherwise run onto that part and lift it into a pale bloom.
 */
function otherPartsClip({ context }: WatercolorKit, group: WatercolorGroup, reachPx: number): Clip | undefined {
  const own = new Set(group.parts.map(({ id }) => id));
  const others = [...context.subject.parts.values()].flatMap((part) => (part.visibility.kind === 'visible' && !own.has(part.id) ? [part.visibility.geometry] : []));
  const [first, ...rest] = others;
  if (!first || context.subject.silhouette.kind === 'hidden') return undefined;
  const union = subjectAreasUnion([first, ...rest]);
  if (union.kind === 'hidden') return undefined;
  const box = subjectAreaBox(context.subject.silhouette.geometry), pad = 4 * reachPx + 8;
  const page = [{ x: box.x0 - pad, y: box.y0 - pad }, { x: box.x1 + pad, y: box.y0 - pad }, { x: box.x1 + pad, y: box.y1 + pad }, { x: box.x0 - pad, y: box.y1 + pad }];
  return { region: { kind: 'polygon', rings: [page, ...union.geometry.rings] } };
}

const wetLayer = wetSubjectLayer, directLayer = directSubjectLayer;

const groupTargets = (groups: readonly WatercolorGroup[]): PaintableRef[] => groups.flatMap(({ parts }) => parts.map(({ ref }) => ref));

const reservedFeatures = (kit: WatercolorKit, group: WatercolorGroup, which: 'eyes' | 'lights') => subjectGroupFeatureReserves(kit.context, group, which);

const formGroups = (context: WatercolorContext, slot: 'form' | 'light' | 'texture') =>
  planSubjectPaintGroups(context, slot, PASS_CONTROLS[slot], (part) => !hasSubjectTag(part, SUBJECT_WELL_KNOWN_TAGS.eye));

function groundContribution({ context, binding, unit, flood }: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const parts = context.paintedParts('ground');
  if (!context.options.groundShadow || !parts.length || context.subject.silhouette.kind === 'hidden') return [];
  const box = subjectAreaBox(context.subject.silhouette.geometry), key = context.paintKey('ground');
  const shadow: Application = {
    key: `${key}.shadow`, kind: 'fill', brush: binding.brushes.wash, diameterPx: Math.min(flood, 40), seed: key,
    area: regionArea({ kind: 'ellipse', center: { x: (box.x0 + box.x1) / 2, y: box.y1 - 0.02 * unit }, radiusX: 0.55 * (box.x1 - box.x0), radiusY: 0.05 * unit }, { kind: 'feather', widthPx: Math.max(6, 0.06 * unit) }),
    charge: { kind: 'paint', mix: { parts: [{ pigment: binding.pigments.sky, amount: 1 }, { pigment: binding.pigments.warm, amount: 0.5 }], strength: 0.14 }, water: 0.7 },
  };
  return [{ key, slot: 'ground', targets: parts.map(({ ref }) => ref), layers: [wetLayer(key, [shadow])] }];
}

/** Soft light is read over this share of the subject's height, so it models the mass rather than each piece of it. */
const SOFT_LIGHT_MASS = 0.07;

/** The warm a glazed colour's first tint leans to, so the lit side, left at that tint, glows rather than greys. */
const WARM_LIGHT: SubjectHex = '#f2e2a4';

/**
 * Under soft light, where the key falls fullest the local colour is lifted off with a wide feather, leaving the warm
 * tint: the light a watercolourist saves rather than paints. A cel keeps its local flat and lets the shade turn the form.
 */
function savedLights(kit: WatercolorKit, group: WatercolorGroup): Footprint[] {
  if (kit.context.options.light !== 'soft') return [];
  const rings = subjectLightZoneRings(kit.field, group.parts.map(({ visibility }) => visibility.geometry), { above: kit.field.terminator + 0.6 });
  return rings.length ? [{ kind: 'region', region: { kind: 'polygon', rings }, edge: { kind: 'feather', widthPx: Math.max(16, 0.1 * kit.unit) } }] : [];
}

/** A pale warm tint of each colour first, as the glazes build, then the colour; a preserved colour goes straight down. */
function formContribution(kit: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const { context, binding, unit, flood } = kit, groups = formGroups(context, 'form');
  if (!groups.length) return [];
  const key = context.paintKey('form');
  const tints: Application[] = [], locals: Application[] = [];
  for (const group of groups) {
    const hex = localHex(group.intent, group.options.mute), region = subjectAreaRegion(group.area), reserves = reservedFeatures(kit, group, 'lights');
    const name = (pass: string) => context.paintKey('form', pass, ...group.segments);
    const glazed = glazedSubjectColour(group.intent);
    if (glazed) {
      tints.push({ key: name('tint'), kind: 'fill', ...groupWashBounds(kit, group, region), reserves, brush: binding.brushes.wash, diameterPx: flood, seed: name('tint'), charge: { kind: 'paint', mix: tint(blendSubjectHex(hex, WARM_LIGHT, 0.4), 0.3), water: 0.6 } });
    }
    locals.push({
      key: name('local'), kind: 'fill', ...groupWashBounds(kit, group, region, edgeOf(group.intent, unit)), reserves: [...reserves, ...(glazed ? savedLights(kit, group) : [])],
      brush: binding.brushes.wash, diameterPx: flood, seed: name('local'), charge: { kind: 'paint', mix: tint(hex, localStrength(group.intent, hex)), water: 0.65 },
    });
  }
  const layer: LayerNode = { key, washes: [...(tints.length ? [{ key: `${key}.tint`, applications: tints }] : []), { key: `${key}.local`, applications: locals }] };
  return [{ key, slot: 'form', targets: groupTargets(groups), layers: [layer] }];
}

/** A group's light, as the treatment models it, each band in the colour's own shade and clipped to the group. */
function groupLightApplications(kit: WatercolorKit, group: WatercolorGroup): Application[] {
  const { context, binding, unit, flood, field } = kit;
  const hex = localHex(group.intent, group.options.mute), region = subjectAreaRegion(group.area), clips = [{ region }];
  const eyes = reservedFeatures(kit, group, 'eyes');
  const depth = group.options.shadowDepth * EMPHASIS[group.intent.emphasis].shade, t = field.terminator;
  const band = (pass: string, rings: readonly (readonly { x: number; y: number }[])[], shade: number, extra: Partial<Pick<Application, 'brush'>> & { edge?: Edge } = {}): Application[] => {
    if (!rings.length || !(shade * depth > 0)) return [];
    const name = context.paintKey('light', pass, ...group.segments);
    return [{
      key: name, kind: 'fill', area: regionArea({ kind: 'polygon', rings }, extra.edge), clips, reserves: eyes,
      brush: extra.brush ?? binding.brushes.wash, diameterPx: flood, seed: name, charge: { kind: 'paint', mix: shadeOf(kit, hex, shade * depth), water: 0.5 },
    }];
  };
  const zone = (above: number | undefined, below: number | undefined) => subjectLightZoneRings(field, group.parts.map(({ visibility }) => visibility.geometry), { ...(above !== undefined && { above }), ...(below !== undefined && { below }) });
  const far = group.parts.filter(({ side }) => side === 'far');
  // The normals already shade a far part where the light misses it: this is only a cool recession.
  const farBand = band('far', far.flatMap(({ visibility }) => visibility.geometry.rings), 0.25);
  const passes: Record<SubjectLightTreatment, () => Application[]> = {
    // Two light glazes laid wet into wet, each feathered, melt into one gradation over the lit side the form wash
    // saved: two, not more, as stacked darks turn a soft form muddy.
    soft: () => [
      ...band('turn', zone(undefined, t + 0.4), 0.2, { edge: { kind: 'feather', widthPx: Math.max(10, 0.07 * unit) } }),
      ...band('shade', zone(undefined, t), 0.4, { edge: { kind: 'feather', widthPx: Math.max(8, 0.05 * unit) } }),
      ...farBand,
    ],
    cel: () => [...band('shade', zone(undefined, t), 0.55), ...farBand],
    'cel-full': () => [
        ...band('half', zone(undefined, 0.55), 0.25),
        ...band('shade', zone(undefined, t), 0.55),
      ...band('core', zone(t - 0.2, t + 0.1), 0.75, { brush: binding.brushes.wet }),
      ...farBand,
    ],
  };
  return passes[context.options.light]();
}

/** The light waits on the form being dry: its first application carries the gate. */
function lightContribution(kit: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const groups = formGroups(kit.context, 'light');
  const [first, ...rest] = groups.flatMap((group) => groupLightApplications(kit, group));
  if (!first) return [];
  const key = kit.context.paintKey('light');
  return [{ key, slot: 'light', targets: groupTargets(groups), layers: [wetLayer(key, [{ ...first, on: 'dry' }, ...rest])] }];
}

/** Scribbled, not back and forth: parallel rows read as stripes. One per colour, in its own shade: a blue mottle over cream reads as a stain. */
function textureContribution(kit: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const { context, binding, unit } = kit, groups = formGroups(context, 'texture').filter(({ options }) => options.texture > 0);
  if (!groups.length) return [];
  const key = context.paintKey('texture');
  const applications = groups.map((group): DirectApplication => {
    const hex = localHex(group.intent, group.options.mute), region = subjectAreaRegion(group.area), name = context.paintKey('texture', 'mottle', ...group.segments);
    return {
      key: name, kind: 'fill', area: { region }, clips: [{ region }], reserves: reservedFeatures(kit, group, 'lights'),
      laying: { kind: 'strokes', pattern: { kind: 'scribble' }, variation: 0.6, reach: { past: 0 } },
      brush: binding.brushes.texture, diameterPx: clamp(Math.round(unit * 0.09), 30, 80), seed: name,
      charge: { kind: 'paint', mix: shadeOf(kit, hex, 0.3), opacityCap: group.options.texture },
    };
  });
  return [{ key, slot: 'texture', targets: groupTargets(groups), layers: [directLayer(key, applications)] }];
}

/** Each line's width as a share of the contour's: a design's own lines (a brow, an eye's ring) read bolder than its forms' edges. */
const LINE_KIND_WEIGHT: Record<SubjectLineKind, number> = { authored: 1.5, 'occluding-edge': 1, crease: 0.6, 'material-boundary': 0.6 };


/**
 * Region features over the dry form: one in a preserved colour or ink laid solid and crisp (an ink shape, a brand's mark),
 * any other glazed in its colour (its own material's, else its part's). Over its part, a second glaze of the part's
 * colour reads as a mark; cut out of its part, it fills the gap.
 */
function featureContributions(kit: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const { context, binding, unit } = kit;
  const regions = subjectPaintedRegions(context, 'features');
  const glazes: { ref: PaintableRef; application: Application }[] = [], solids: { ref: PaintableRef; application: DirectApplication }[] = [];
  regions.forEach((feature) => {
    const intent = context.intent(feature.ref), hex = localHex(intent, context.optionsFor(feature.ref).mute), name = context.paintKey('features', feature.ref);
    const reserves = subjectLaterLighterRegions(context, feature);
    const area = regionArea(subjectAreaRegion(feature.visibility.geometry), edgeOf(intent, unit));
    const diameterPx = clamp(Math.round(unit * 0.03), 8, 40);
    // Ink is laid as ink: a glaze that dark over the form would let the form's colour through as a tinted grey.
    if (intent.preserveLocalColor || subjectHexLuminance(intent.localColor) < INK_LUMINANCE) {
      solids.push({ ref: feature.ref, application: { key: name, kind: 'fill', area, reserves, brush: binding.brushes.detail, diameterPx, seed: name, charge: { kind: 'paint', mix: tint(intent.localColor, 1) } } });
      return;
    }
    const mix = tint(hex, localStrength(intent, hex));
    glazes.push({ ref: feature.ref, application: { key: name, on: 'dry', kind: 'fill', area, reserves, brush: binding.brushes.mark, diameterPx, seed: name, charge: { kind: 'paint', mix, water: 0.45 } } });
  });
  const glazeKey = context.paintKey('features', 'glaze'), solidKey = context.paintKey('features', 'solid');
  return [
    ...(glazes.length ? [{ key: glazeKey, slot: 'features' as const, targets: glazes.map(({ ref }) => ref), layers: [wetLayer(glazeKey, glazes.map(({ application }) => application))] }] : []),
    ...(solids.length ? [{ key: solidKey, slot: 'features' as const, targets: solids.map(({ ref }) => ref), layers: [directLayer(solidKey, solids.map(({ application }) => application))] }] : []),
  ];
}

/** Eyes (an iris round a glint of paper, then the pupil) and cheeks' blush. */
function accentContributions(kit: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const { context, binding, unit } = kit;
  const eyes = subjectEyeSpots(context, 'accents'), cheeks = subjectCheekSpots(context, 'accents');
  const applications = eyes.flatMap((eye): Application[] => {
    const { pupil, glint } = subjectEyeMarks(eye, 0.5, 0.26), reserves: Footprint[] = [{ kind: 'region', region: glint }];
    const { lineColor } = context.optionsFor(eye.ref), name = (pass: string) => context.paintKey('accents', pass, eye.ref);
    const iris: Application[] = eye.iris === undefined ? [] : [{
      key: name('iris'), kind: 'fill', area: { region: eye.region }, reserves, brush: binding.brushes.detail, diameterPx: clamp(Math.round(eye.radiusPx * 0.6), 6, 40),
      seed: name('iris'), charge: { kind: 'paint', mix: tint(eye.iris, 0.9), water: 0.35 },
    }];
    return [...iris, {
      key: name('pupil'), kind: 'fill', area: { region: eye.iris === undefined ? eye.region : pupil }, reserves, brush: binding.brushes.detail,
      diameterPx: clamp(Math.round(eye.radiusPx * 0.4), 4, 30), seed: name('pupil'), charge: { kind: 'paint', mix: tint(lineColor, 1), water: 0.3 },
    }];
  });
  const blushes = cheeks.map(({ ref, at }): Application => {
    const name = context.paintKey('accents', 'blush', ref);
    return {
      key: name, kind: 'fill', area: regionArea({ kind: 'ellipse', center: at, radiusX: 0.045 * unit, radiusY: 0.03 * unit }, { kind: 'feather', widthPx: Math.max(4, 0.02 * unit) }),
      brush: binding.brushes.wash, diameterPx: 20, seed: name, charge: { kind: 'paint', mix: tint(context.optionsFor(ref).blush, 0.3), water: 0.4 },
    };
  });
  const [first, ...rest] = [...applications, ...blushes];
  if (!first) return [];
  const key = context.paintKey('accents');
  return [{ key, slot: 'accents', targets: [...eyes.map(({ ref }) => ref), ...cheeks.map(({ ref }) => ref)], layers: [wetLayer(key, [{ ...first, on: 'dry' }, ...rest])] }];
}

/**
 * A light line, as the hand frog's: thinner and weaker than an ink drawing's, so the washes carry the form. The
 * silhouette and drawn or occluding lines in ink; creases and material boundaries finer and fainter.
 */
function lineContributions(kit: WatercolorKit): SubjectContribution<WatercolorSubjectSlot>[] {
  const { context, binding, unit } = kit;
  const line = clamp(Math.round(unit * 0.009), 3, 9), runPx = unit * 0.4;
  const hand = { curvature: 0.3, wobble: { pressure: 0.15 } };
  const contributions: SubjectContribution<WatercolorSubjectSlot>[] = [];
  // One silhouette, each stretch inked as the part it bounds is: its line options, and its edge (a lost one left out).
  const stretches = context.options.contours ? subjectSilhouetteStretches(context, 'lines', line) : [];
  const silhouette = stretches.flatMap(({ part, stretches: owned }): { ref: PaintableRef; application: DirectApplication }[] => {
    const weight = SUBJECT_LINE_EDGE_WEIGHTS[context.intent(part.ref).edge ?? 'firm'];
    if (!weight.width) return [];
    const { lineWeight, lineColor } = context.optionsFor(part.ref), name = context.paintKey('lines', 'silhouette', part.ref), diameterPx = line * lineWeight * weight.width;
    return [{ ref: part.ref, application: {
      key: name, kind: 'stroke', subpaths: subjectStretchRuns(owned, runPx, diameterPx), hand,
      brush: binding.brushes.line, diameterPx, seed: name, charge: { kind: 'paint', mix: tint(lineColor, clamp(0.75 * weight.strength, 0, 1)) },
    } }];
  });
  if (silhouette.length) {
    const key = context.paintKey('lines', 'silhouette');
    contributions.push({ key, slot: 'lines', targets: silhouette.map(({ ref }) => ref), layers: [directLayer(key, silhouette.map(({ application }) => application))] });
  }
  for (const feature of context.paintedFeatures('lines')) {
    if (feature.kind !== 'path' || (feature.line === 'occluding-edge' && !context.options.contours)) continue;
    const intent = context.intent(feature.ref), weight = SUBJECT_LINE_EDGE_WEIGHTS[intent.edge ?? 'firm'];
    if (!weight.width) continue;
    const { lineWeight, lineColor } = context.optionsFor(feature.ref), inked = feature.line === 'authored' || feature.line === 'occluding-edge';
    const key = context.paintKey('lines', feature.ref), diameterPx = Math.max(2, line * LINE_KIND_WEIGHT[feature.line] * lineWeight * weight.width);
    // An occluding edge inside one material is a seam between the pieces a form was built of: the washes carry it.
    const subpaths = feature.line === 'occluding-edge'
      ? subjectStretchRuns(subjectMaterialEdgeStretches(context.subject, feature.visibility.geometry, line, 6 * diameterPx), runPx, diameterPx)
      : subjectPathRuns(feature.visibility.geometry, runPx, diameterPx);
    if (!subpaths.length) continue;
    contributions.push({ key, slot: 'lines', targets: [feature.ref], layers: [directLayer(key, [{
      key: `${key}.ink`, kind: 'stroke', subpaths, hand,
      brush: inked ? binding.brushes.line : binding.brushes.detail, diameterPx, seed: key,
      charge: { kind: 'paint', mix: tint(lineColor, clamp((inked ? 0.75 : 0.55) * weight.strength, 0, 1)) },
    }])] });
  }
  return contributions;
}

/** Watercolour's options when a painting gives none: cel light, a light mute and mottle, contours in a light ink, a modest bleed. */
export const WATERCOLOR_SUBJECT_DEFAULTS: WatercolorSubjectOptions = {
  light: 'cel', terminator: 0, shadowDepth: 1, mute: 0.08, texture: 0.16, lineWeight: 1, lineColor: '#22232a', blush: '#f3a99a',
  contours: true, groundShadow: true, bleed: 0.012,
};

/** The watercolour painter, bound to a style's brushes and pigments. */
export const watercolorSubjectPainter = (binding: WatercolorSubjectBinding) => defineSubjectPainter<WatercolorSubjectOptions>()({
  id: 'watercolor',
  evidence: ['surface', 'illumination'],
  defaults: WATERCOLOR_SUBJECT_DEFAULTS,
  slots: WATERCOLOR_SLOTS,
  // A part painted by hand sits over the automatic form and light round it, under the lines.
  replaceAllAt: 'features',
  controls: ['shadowDepth', 'mute', 'texture', 'bleed', 'lineWeight', 'lineColor', 'blush'],
  intents: ['localColor', 'preserveLocalColor', 'emphasis', 'edge'],
  checkOptions: watercolorOptionProblems,
  paint: (context) => {
    const unit = subjectUnitPx(context.subject);
    const kit: WatercolorKit = { context, binding, unit, flood: clamp(Math.round(unit * 0.12), 30, 110), field: subjectLightField(context.subject, context.options.terminator, context.options.light === 'soft' ? SOFT_LIGHT_MASS * unit : 0), outline: subjectOutlineReader(context.subject) };
    return [
      ...groundContribution(kit), ...formContribution(kit), ...lightContribution(kit), ...textureContribution(kit),
      ...featureContributions(kit), ...accentContributions(kit), ...lineContributions(kit),
    ];
  },
});
