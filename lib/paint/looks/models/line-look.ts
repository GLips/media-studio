import type { DirectApplication, Hex, LayerNode, Subpath } from '#lib/paint/document/models/painting-document.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintSubject, requireSubjectPainting } from '#lib/paint/subject-painting/models/paint-subject.ts';
import { LINE_SUBJECT_DEFAULTS, lineSubjectPainter, type LineSubjectBrushes, type LineTool } from '#lib/paint/subject-painting/models/painters/line.ts';
import { subjectPaintKey } from '#lib/paint/subject-painting/models/subject-painter.ts';
import { subjectFramePoint } from '#lib/paint/subject/models/subject-frame.ts';
import { subjectAreaBox, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import { defineLook } from './paint-look.ts';
import { lookDraw } from './look-step.ts';

/** The line recipe's three draws in one tool: spot blacks, visible outlines, and face and stated lines. */
function lineDraws(brushes: LineSubjectBrushes, tool: LineTool) {
  function ink<const N extends 'contour' | 'features'>(name: N, description: string) {
    const painter = lineSubjectPainter(brushes, [name]);
    return lookDraw(name, description, { colour: LINE_SUBJECT_DEFAULTS.lineColor, weight: LINE_SUBJECT_DEFAULTS.lineWeight },
      (subject, { colour, weight }) => requireSubjectPainting(paintSubject(subject, painter, { tool, lineColor: colour, lineWeight: weight })).layers);
  }
  const fill = lineSubjectPainter(brushes, ['fill']);
  return [
    lookDraw('fill', 'spot blacks', { colour: LINE_SUBJECT_DEFAULTS.lineColor }, (subject, { colour }) =>
      requireSubjectPainting(paintSubject(subject, fill, { tool, lineColor: colour })).layers),
    ink('contour', 'visible outlines'), ink('features', 'face and stated lines'),
  ] as const;
}

/** Each line look's control: inkWeight scales contour and face strokes from the subject's size. */
const LINE_KNOBS = { inkWeight: [['contour', 'weight'], ['features', 'weight']] } as const;

/** Bind the line recipe to a style's brushes, in ink. */
export function createLineLook(brushes: LineSubjectBrushes) {
  return defineLook({
    name: 'line', palettes: ['ink'], sampling: { fps: 12 },
    steps: [...lineDraws(brushes, 'ink'), { name: 'actor', kind: 'place', sheet: ['fill', 'contour', 'features'], paper: { color: '#fffdf7', absorbency: 0.5 }, medium: 'watercolour' }],
    show: ['actor'],
  }, LINE_KNOBS);
}

/** A guide through page points `a` and `b`, run on past each by `runOn` of its length, pressed lightly. */
function guideThrough(a: StampPoint, b: StampPoint, runOn: number): Subpath {
  const dx = (b.x - a.x) * runOn, dy = (b.y - a.y) * runOn;
  return [{ x: a.x - dx, y: a.y - dy, pressure: 0.75 }, { x: b.x + dx, y: b.y + dy, pressure: 0.75 }];
}

/**
 * Construction guides, as a draughtsman blocks a figure in: each subject frame's square, edges and upright run on past
 * its corners (a `crossed` frame, a face, gets only its two axes), and a ground line under the feet. Run-ons are laid
 * in page space, so a steep perspective frame never reaches its horizon.
 */
function guideStrokes(subject: Subject, silhouette: SubjectArea, runOn: number, crossed: readonly string[]): { key: string; subpaths: Subpath[] }[] {
  const frames = [...subject.frames.values()].flatMap((frame) => {
    const owner = subject.parts.get(frame.owner);
    if (frame.status.kind === 'unavailable' || !owner) return [];
    const { basis } = frame.status, at = (x: number, y: number) => subjectFramePoint(basis, { x, y });
    const segments = crossed.includes(frame.id)
      ? [[at(0, -1), at(0, 1)], [at(-1, 0), at(1, 0)]]
      : [[at(-1, -1), at(1, -1)], [at(-1, 1), at(1, 1)], [at(-1, -1), at(-1, 1)], [at(1, -1), at(1, 1)], [at(0, -1), at(0, 1)]];
    return [{ key: subjectPaintKey(subject.id, [owner.ref, 'guides', frame.id]), subpaths: segments.map(([a, b]) => guideThrough(a, b, runOn)) }];
  });
  const { x0, x1, y1 } = subjectAreaBox(silhouette);
  return [...frames, { key: subjectPaintKey(subject.id, ['guides', 'ground']), subpaths: [guideThrough({ x: x0, y: y1 }, { x: x1, y: y1 }, 0.08)] }];
}

const GUIDES_DEFAULTS: { readonly colour: Hex; readonly strength: number; readonly runOn: number; readonly crossed: readonly string[] } = {
  colour: '#7a7e86', strength: 1, runOn: 0.35, crossed: ['face'],
};

function guidesDraw(brushes: LineSubjectBrushes) {
  return lookDraw('guides', 'construction guides from the subject\'s frames', GUIDES_DEFAULTS, (subject, { colour, strength, runOn, crossed }): LayerNode[] => {
    if (subject.silhouette.kind === 'hidden') return [];
    const { x0, x1 } = subjectAreaBox(subject.silhouette.geometry);
    const applications = guideStrokes(subject, subject.silhouette.geometry, runOn, crossed).map(({ key, subpaths }): DirectApplication => ({
      key, seed: key, kind: 'stroke', subpaths, brush: brushes.pencil, diameterPx: Math.max(2, Math.round((x1 - x0) * 0.006)),
      charge: { kind: 'paint', mix: { parts: [{ pigment: colour, amount: 1 }], strength } }, hand: { curvature: 0.05, wobble: { pressure: 0.25, position: 0.04 } },
    }));
    const key = subjectPaintKey(subject.id, ['guides']);
    return [{ key, washes: [{ key: `${key}.wash`, wetHistory: false, applications }] }];
  });
}

/**
 * Bind the line recipe to a style's pencil, over faint construction guides: a pencil drawing as it's built up. The
 * guides are a step of their own, so a derived look can redraw the contour on a schedule while the guides keep their marks.
 */
export function createPencilLook(brushes: LineSubjectBrushes) {
  return defineLook({
    name: 'pencil', palettes: ['graphite'], sampling: { fps: 12 },
    steps: [
      guidesDraw(brushes), ...lineDraws(brushes, 'pencil'),
      { name: 'actor', kind: 'place', sheet: ['guides', 'fill', 'contour', 'features'], paper: { color: '#f6f3ea', absorbency: 0.4 }, medium: 'watercolour' },
    ],
    show: ['actor'],
  }, LINE_KNOBS);
}
