// line.ts: the line painter, ink or pencil line art with no washes. A line is weighted by its kind, its nearness,
// the depth of the occlusion it marks and which side of the light it faces, as far as the evidence tells. Near-black
// design colours are spotted solid, as an inker blacks in a pupil.
//
// Lines the subject states (its path features) are drawn as stated, never doubled from an area's outline. When it
// states its occluding edges, a part's area adds only the silhouette they leave; when not, as built by hand, each
// shared edge is inked once, by the part in front.
//
// Slots: `contours` (parts' outlines and spot blacks), then `features`, so a face replacement leaves the outlines.

import type { BrushRef, DirectApplication, LayerNode, Subpath } from '#lib/paint/document/models/painting-document.ts';
import { stampPolygonBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectWithEvidence } from '#lib/paint/subject/models/subject-check.ts';
import { subjectKeyPageDirection } from '#lib/paint/subject/models/subject-evidence.ts';
import { subjectAreaBox, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import type { PartId } from '#lib/paint/subject/models/subject-id.ts';
import type { PaintableRef, SubjectHex, SubjectLineKind } from '#lib/paint/subject/models/subject.ts';
import { subjectAreaRegion } from '../subject-document-geometry.ts';
import {
  defineSubjectPainter, type ResolvedSubjectIntent, type SubjectContribution, type SubjectEdgeIntent, type SubjectPainterContext,
  type SubjectPainterReport, type VisibleSubjectPart,
} from '../subject-painter.ts';
import {
  lineAreaSize, lineBoxesMeet, lineContourOutlines, lineDepthField, lineEdgeReader, lineStatedEdges, type LineContourPoint, type LineDepthField, type LineEdgeReader,
  type LineStatedEdges,
} from './line-edges.ts';
import { subjectHexLuminance } from './subject-paint-colour.ts';
import { subjectOptionHexProblems, subjectOptionRangeProblems, subjectSmoothStep } from './subject-paint-kit.ts';
import { lineAreaOutlines, linePathOutline, lineRunsSeeded, lineRunsWhere, lineStrokeSubpaths, type LineHand, type LineOutlinePoint, type LineRun } from './line-strokes.ts';

/** What the line painter draws with: a crisp, tapered ink line or a grainy pencil one. */
export type LineTool = 'ink' | 'pencil';

/** The line painter's options; every one is also a control a tune may set per part or feature. */
export type LineSubjectOptions = {
  /** Which bound brush draws: a crisp, tapered ink line or a grainy pencil one. */
  readonly tool: LineTool;
  /** A multiplier on the painter's line width, which it sizes from the subject's larger side. */
  readonly lineWeight: number;
  /** 0..1, how far down the line hierarchy it draws: 0 is outlines and design lines alone, 1 every crease. */
  readonly detail: number;
  readonly lineColor: SubjectHex;
  /** Fill parts and regions whose colour is near black with solid ink. */
  readonly spotBlacks: boolean;
  /**
   * 0..6: how far each stroke runs on straight past its ends, in line widths, as a hand inking fast carries the pen
   * past a corner and across the silhouette. Each end varies a little, seeded. 0 lifts the pen where the line ends.
   */
  readonly overshoot: number;
};

/** The brushes a style binds for each tool. Engine painters never import a style; `work/styles/<name>/` binds them. */
export type LineSubjectBrushes = { readonly [T in LineTool]: BrushRef };

/** The line painter's options when a painting gives none: ink at full detail, near-black spotted solid. */
export const LINE_SUBJECT_DEFAULTS: LineSubjectOptions = { tool: 'ink', lineWeight: 1, detail: 1, lineColor: '#1c1a19', spotBlacks: true, overshoot: 0 };

/**
 * The kinds of line, by how much they carry: the silhouette most, a crease least. `contour` is a part's edge against
 * another part where nothing says it occludes; `region` a feature region's outline.
 */
type LineCategory = 'silhouette' | 'contour' | 'region' | SubjectLineKind;

const LINE_CATEGORY_WEIGHT: Record<LineCategory, number> = {
  silhouette: 1, 'occluding-edge': 0.85, authored: 0.7, contour: 0.62, region: 0.6, 'material-boundary': 0.5, crease: 0.42,
};

/** The `detail` a category needs before it's drawn: outlines and design lines always, creases only at high detail. */
const LINE_CATEGORY_DETAIL: Record<LineCategory, number> = {
  silhouette: 0, authored: 0, region: 0, 'occluding-edge': 0.15, contour: 0.3, 'material-boundary': 0.5, crease: 0.7,
};

const EMPHASIS_WEIGHT: Record<ResolvedSubjectIntent['emphasis'], number> = { subdued: 0.7, normal: 1, accent: 1.3 };

/** An edge intent's share of line width; `lost` draws nothing, so its weight is never read. */
const EDGE_WEIGHT: Record<SubjectEdgeIntent, number> = { lost: 0, soft: 0.65, firm: 1, hard: 1.15 };

/**
 * How squarely a silhouette may face the key before it breaks, lost and found; firm and hard edges hold everywhere.
 * Left unset, an edge breaks only where it faces the key almost straight on.
 */
const EDGE_BREAK_AT: Record<SubjectEdgeIntent, number> = { lost: 0.82, soft: 0.55, firm: Infinity, hard: Infinity };
const DEFAULT_BREAK_AT = 0.82;

/** Scale headroom: a stroke's diameter is this times its base width, so the heaviest line still fits under scale 1. */
const WEIGHT_HEADROOM = 1.8;

/** Luminance under which a design colour reads as black, and an inker would spot it. */
const SPOT_BLACK_LUMINANCE = 0.2;

type LineSlot = 'contours' | 'features';
type LineContext = SubjectPainterContext<SubjectWithEvidence<never>, LineSubjectOptions, LineSlot>;

/** What every line reads: the subject's scale, the evidence it carries, its edges and the lines it states for them. */
type LineScene = {
  readonly basePx: number;
  readonly unit: number;
  readonly step: number;
  readonly depth: LineDepthField | undefined;
  readonly light: { readonly x: number; readonly y: number } | undefined;
  readonly edges: LineEdgeReader;
  /** Every visible path feature's points: a contour or region outline they already draw is left to them. */
  readonly stated: LineStatedEdges;
  /** Whether the subject states its occluding edges, so area contours add only the silhouette those leave. */
  readonly statesOcclusion: boolean;
  readonly outlines: ReadonlyMap<PartId, readonly LineContourPoint[][]>;
};

// ---- weights ---------------------------------------------------------------------------------------------------------

/** A target's share of line width from its intent: lost draws nothing, hard draws heavier and untapered. */
const intentWeight = (intent: ResolvedSubjectIntent) => EMPHASIS_WEIGHT[intent.emphasis] * (intent.edge ? EDGE_WEIGHT[intent.edge] : 1);

/** Nearer lines are heavier, as an inker weights the foreground. Without depth, every line sits at middle distance. */
const nearnessWeight = (scene: LineScene, x: number, y: number) => 0.8 + 0.35 * (scene.depth?.nearness(x, y) ?? 0.5);

/**
 * The weight of a point on an edge, or undefined where the line breaks: below the detail asked for, or a silhouette
 * facing straight into the key (lost and found). `stated` is the kind its source gives; the silhouette, or a deep
 * occlusion the depth shows, outranks it.
 */
function edgeWeight(scene: LineScene, point: LineOutlinePoint, stated: 'contour' | 'occluding-edge', intent: ResolvedSubjectIntent, detail: number): number | undefined {
  const onSilhouette = scene.edges.onSilhouette(point);
  const { nx, ny, gap } = scene.edges.facing(point, onSilhouette);
  // How deep the occlusion is, as a share of the subject's depth: a limb across the body is deep, a cuff on a wrist not.
  const gapness = gap === undefined || !scene.depth ? undefined : subjectSmoothStep(gap / (0.1 * scene.depth.span));
  let category: LineCategory = stated;
  if (onSilhouette) category = 'silhouette';
  else if (gapness !== undefined && gapness > 0.5) category = 'occluding-edge';
  if (detail < LINE_CATEGORY_DETAIL[category]) return undefined;
  const facing = scene.light ? nx * scene.light.x + ny * scene.light.y : 0;
  if (onSilhouette && facing > (intent.edge ? EDGE_BREAK_AT[intent.edge] : DEFAULT_BREAK_AT)) return undefined;
  const base = !onSilhouette && gapness !== undefined ? 0.5 + 0.4 * gapness : LINE_CATEGORY_WEIGHT[category];
  const inside = { x: point.x - nx * scene.edges.probe, y: point.y - ny * scene.edges.probe };
  return base * (1 - 0.3 * facing) * nearnessWeight(scene, inside.x, inside.y);
}

/** Whether a stated line or another part's outline inks this outline point, so this part's leaves it to them. */
function contourHandedOver(scene: LineScene, point: LineContourPoint): boolean {
  const { edge } = point;
  return scene.stated.covers(point) || (scene.statesOcclusion ? edge.kind !== 'silhouette' : edge.kind === 'shared' && !edge.owned);
}

/** A part's outline point's weight: only where no stated line or other part draws it. */
const contourWeight = (scene: LineScene, point: LineContourPoint, intent: ResolvedSubjectIntent, detail: number): number | undefined =>
  (contourHandedOver(scene, point) ? undefined : edgeWeight(scene, point, 'contour', intent, detail));

// ---- spot blacks -----------------------------------------------------------------------------------------------------

const isSpotBlack = (intent: ResolvedSubjectIntent, options: LineSubjectOptions) => options.spotBlacks && subjectHexLuminance(intent.localColor) < SPOT_BLACK_LUMINANCE;

/** A solid black: the area it fills, and the lighter regions lying on it kept clear, so a black mouth keeps its tongue. */
type LineSpotBlack = { readonly area: SubjectArea; readonly reserved: readonly SubjectArea[] };

/**
 * A lighter region lies on the black when it is smaller and they meet, as a glint on a pupil; a larger one (the eye's
 * white round a pupil) lies under it. Reserved rather than cut as holes: a region traced beside its owner's edge would
 * cross the owner's ring.
 */
function lineSpotBlack(context: LineContext, area: SubjectArea, owner: PartId, self: PaintableRef): LineSpotBlack {
  const box = subjectAreaBox(area), size = lineAreaSize(area);
  const reserved = [...context.subject.features.values()].flatMap((feature) => {
    if (feature.kind !== 'region' || feature.owner !== owner || feature.visibility.kind !== 'visible' || (self.kind === 'feature' && feature.id === self.id)) return [];
    if (isSpotBlack(context.intent(feature.ref), context.optionsFor(feature.ref))) return [];
    const lighter = feature.visibility.geometry;
    return lineAreaSize(lighter) < size && lineBoxesMeet(subjectAreaBox(lighter), box) ? [lighter] : [];
  });
  return { area, reserved };
}

// ---- applications ----------------------------------------------------------------------------------------------------

/**
 * How each tool moves: ink in long strokes a fifth of the subject long, tapering hard at each lift; pencil in shorter,
 * more overlapped strokes that taper less and wander more, as a hand sketches. Lengths are shares of the subject's size.
 */
const TOOL_HANDS: Record<LineTool, { strokeShare: number; strokePx: readonly [number, number]; overlapWidths: number; taperFloor: number; wobble: { pressure: number; position: number } }> = {
  ink: { strokeShare: 0.18, strokePx: [30, 360], overlapWidths: 3, taperFloor: 0.28, wobble: { pressure: 0.08, position: 0.05 } },
  pencil: { strokeShare: 0.09, strokePx: [20, 200], overlapWidths: 5, taperFloor: 0.5, wobble: { pressure: 0.2, position: 0.18 } },
};

/**
 * How each tool spots a black: ink floods it with a broad brush; pencil cross-hatches it close with the point, since a
 * graphite flood of a small shape leaves it grey and patchy.
 */
const TOOL_SPOT_FILLS: Record<LineTool, (widthPx: number) => Pick<DirectApplication & { kind: 'fill' }, 'diameterPx' | 'laying' | 'direction'>> = {
  ink: (widthPx) => ({ diameterPx: Math.max(4, Math.round(widthPx * 3)) }),
  pencil: (widthPx) => ({
    diameterPx: Math.max(3, Math.round(widthPx * 1.2)), direction: -0.8,
    laying: { kind: 'strokes', pattern: { kind: 'crossHatch' }, spacing: 0.45, variation: 0.4 },
  }),
};

function toolHand(scene: LineScene, options: LineSubjectOptions, intent: ResolvedSubjectIntent): LineHand {
  const { strokeShare, strokePx: [shortest, longest], overlapWidths, taperFloor } = TOOL_HANDS[options.tool];
  return {
    strokePx: Math.min(longest, Math.max(shortest, scene.unit * strokeShare)), overlapPx: scene.basePx * overlapWidths,
    taperFloor: intent.edge === 'hard' ? 0.85 : taperFloor, pressure: 1, overshootPx: options.overshoot * scene.basePx * options.lineWeight,
  };
}

/**
 * What one target draws: its runs of line, each with its role (what kind of line it inks), the target's middle its
 * runs are ordered round, and the rings it spots solid when its colour reads black.
 */
type LineMarks = {
  readonly operation: 'contour' | 'line';
  readonly target: PaintableRef;
  readonly runs: readonly LineRun[];
  readonly roleOf: (run: LineRun) => LineCategory;
  readonly centre: StampPoint;
  readonly spot?: LineSpotBlack;
};

const boxCentre = ({ x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }): StampPoint => ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });

function lineApplications(scene: LineScene, brushes: LineSubjectBrushes, options: LineSubjectOptions, intent: ResolvedSubjectIntent, marks: LineMarks, paintKey: LineContext['paintKey']): DirectApplication[] {
  const { tool } = options;
  const widthPx = scene.basePx * options.lineWeight;
  const diameterPx = Math.max(2, Math.round(widthPx * WEIGHT_HEADROOM));
  const hand = toolHand(scene, options, intent);
  const strokesKey = paintKey(marks.operation, marks.target, 'strokes'), spotKey = paintKey(marks.operation, marks.target, 'spot-black');
  const charge = { kind: 'paint' as const, mix: { parts: [{ pigment: options.lineColor, amount: 1 }], strength: 1 } };
  const subpaths: Subpath[] = lineRunsSeeded(marks.runs, marks.centre, marks.roleOf, strokesKey).flatMap(({ run, seed }) =>
    lineStrokeSubpaths({ ...run, points: run.points.map((p) => ({ ...p, weight: p.weight / WEIGHT_HEADROOM })) }, hand, seed));
  const spot: DirectApplication[] = marks.spot ? [{
    key: spotKey, kind: 'fill', area: { region: subjectAreaRegion(marks.spot.area) },
    ...(marks.spot.reserved.length && { reserves: marks.spot.reserved.map((area) => ({ kind: 'region' as const, region: subjectAreaRegion(area) })) }),
    brush: brushes[tool], seed: spotKey, charge, ...TOOL_SPOT_FILLS[tool](widthPx),
  }] : [];
  const strokes: DirectApplication[] = subpaths.length ? [{
    key: strokesKey, kind: 'stroke', subpaths, brush: brushes[tool], diameterPx, seed: strokesKey, charge,
    hand: { curvature: 0.15, wobble: TOOL_HANDS[tool].wobble },
  }] : [];
  return [...spot, ...strokes];
}

function lineContribution(slot: LineSlot, marks: LineMarks, applications: readonly DirectApplication[], paintKey: LineContext['paintKey']): SubjectContribution<LineSlot>[] {
  if (!applications.length) return [];
  const key = paintKey(marks.operation, marks.target);
  const layer: LayerNode = { key, washes: [{ key: paintKey(marks.operation, marks.target, 'wash'), wetHistory: false, applications }] };
  return [{ key, slot, targets: [marks.target], layers: [layer] }];
}

// ---- the painter -----------------------------------------------------------------------------------------------------

function paintLineSubject(context: LineContext, brushes: LineSubjectBrushes): SubjectContribution<LineSlot>[] {
  const { subject, paintKey } = context;
  if (subject.silhouette.kind === 'hidden') return [];
  const box = subjectAreaBox(subject.silhouette.geometry);
  // Line width follows the subject's size, as a pen is chosen for the drawing's size, not the page's.
  const unit = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const basePx = Math.min(20, Math.max(1.5, unit * 0.009));
  const step = Math.min(4, Math.max(1, basePx * 0.5));
  const depth = subject.surface && lineDepthField(subject.surface);
  const light = subject.illumination && subjectKeyPageDirection(subject.illumination);
  const visible = [...subject.parts.values()].filter((part): part is VisibleSubjectPart => part.visibility.kind === 'visible');
  const edges = lineEdgeReader(subject.silhouette.geometry.rings, step, depth);
  const paths = [...subject.features.values()].flatMap((feature) => (feature.kind === 'path' && feature.visibility.kind === 'visible' ? [{ ...feature, visibility: feature.visibility }] : []));
  const stated = lineStatedEdges(paths.flatMap(({ visibility }) => visibility.geometry.runs.flatMap((run) => linePathOutline(run, step))), edges.tolerance);
  const scene: LineScene = {
    basePx, unit, step, depth, light, edges, stated, statesOcclusion: paths.some(({ line }) => line === 'occluding-edge'), outlines: lineContourOutlines(visible, edges, step, depth),
  };
  const minLength = basePx * 2.5;
  // How far a line handing its edge over inks on: past the gap the edge tolerance leaves between two lines' ends.
  const handoverReach = 2 * edges.tolerance;
  const sideWeight = (owner: PartId) => (subject.parts.get(owner)?.side === 'far' ? 0.8 : 1);
  const painted = (slot: LineSlot, marks: LineMarks, options: LineSubjectOptions, intent: ResolvedSubjectIntent) =>
    lineContribution(slot, marks, lineApplications(scene, brushes, options, intent, marks, paintKey), paintKey);

  const contours = context.paintedParts('contours').flatMap((part) => {
    const intent = context.intent(part.ref), options = context.optionsFor(part.ref);
    const share = sideWeight(part.id) * intentWeight(intent);
    const runs = intent.edge === 'lost' ? [] : scene.outlines.get(part.id)!.flatMap((outline) => lineRunsWhere(outline, true, minLength, (point) => {
      const weight = contourWeight(scene, point, intent, options.detail);
      return weight === undefined ? undefined : weight * share;
    }, { at: (point) => contourHandedOver(scene, point), reachPx: handoverReach }));
    // A contour run's role is the edge its middle inks: the silhouette, or another part's.
    const roleOf = ({ points }: LineRun): LineCategory => (scene.edges.onSilhouette(points[Math.floor(points.length / 2)]) ? 'silhouette' : 'contour');
    const spot = isSpotBlack(intent, options) ? lineSpotBlack(context, part.visibility.geometry, part.id, part.ref) : undefined;
    const centre = boxCentre(subjectAreaBox(part.visibility.geometry));
    return painted('contours', { operation: 'contour', target: part.ref, runs, roleOf, centre, ...(spot && { spot }) }, options, intent);
  });

  const features = context.paintedFeatures('features').flatMap((feature) => {
    if (feature.kind === 'landmark') return [];
    const intent = context.intent(feature.ref), options = context.optionsFor(feature.ref);
    const category: LineCategory = feature.kind === 'path' ? feature.line : 'region';
    const drawn = intent.edge !== 'lost' && options.detail >= LINE_CATEGORY_DETAIL[category];
    const share = LINE_CATEGORY_WEIGHT[category] * intentWeight(intent) * sideWeight(feature.owner);
    const weightAt = (point: LineOutlinePoint) => {
      if (category === 'region' && scene.stated.covers(point)) return undefined;
      if (category !== 'occluding-edge') return share * nearnessWeight(scene, point.x, point.y);
      const weight = edgeWeight(scene, point, 'occluding-edge', intent, options.detail);
      return weight === undefined ? undefined : weight * intentWeight(intent) * sideWeight(feature.owner);
    };
    const outlines = feature.kind === 'path'
      ? feature.visibility.geometry.runs.map((run) => ({ points: linePathOutline(run, step), closed: run.closed }))
      : lineAreaOutlines(feature.visibility.geometry, step).map((points) => ({ points, closed: true }));
    // A stated line ends where another takes its edge over: a region at a line covering it, a path at the silhouette.
    const runs = drawn ? outlines.flatMap(({ points, closed }) => lineRunsWhere(points, closed, minLength, weightAt, { reachPx: handoverReach, at: (point) => (closed
      ? category === 'region' && scene.stated.covers(point)
      : (point === points[0] || point === points.at(-1)) && scene.edges.onSilhouette(point)) })) : [];
    const spot = feature.kind === 'region' && isSpotBlack(intent, options) ? lineSpotBlack(context, feature.visibility.geometry, feature.owner, feature.ref) : undefined;
    const centre = boxCentre(feature.kind === 'path' ? stampPolygonBox(feature.visibility.geometry.runs.flatMap(({ points }) => points)) : subjectAreaBox(feature.visibility.geometry));
    return painted('features', { operation: 'line', target: feature.ref, runs, roleOf: () => category, centre, ...(spot && { spot }) }, options, intent);
  });

  return [...contours, ...features];
}

const lineOptionProblems = ({ lineWeight, detail, lineColor, overshoot }: LineSubjectOptions): SubjectPainterReport[] => [
  ...subjectOptionRangeProblems('lineWeight', lineWeight, 0.1, 4),
  ...subjectOptionRangeProblems('overshoot', overshoot, 0, 6),
  ...subjectOptionRangeProblems('detail', detail, 0, 1),
  ...subjectOptionHexProblems('lineColor', lineColor),
];

/**
 * The line painter, drawing with a style's ink and pencil brushes. Reads surface evidence for depth and occlusion and
 * illumination for which side a line faces when the subject carries them, and draws a plain hierarchy of lines when not.
 * Interprets `localColor` only to decide what to spot black.
 */
export const lineSubjectPainter = (brushes: LineSubjectBrushes) => defineSubjectPainter<LineSubjectOptions>()({
  id: 'line',
  evidence: [],
  defaults: LINE_SUBJECT_DEFAULTS,
  slots: ['contours', 'features'],
  replaceAllAt: 'contours',
  controls: ['tool', 'lineWeight', 'detail', 'lineColor', 'spotBlacks', 'overshoot'],
  intents: ['localColor', 'emphasis', 'edge'],
  checkOptions: lineOptionProblems,
  paint: (context) => paintLineSubject(context, brushes),
});
