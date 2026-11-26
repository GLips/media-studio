import { paintSubject, requireSubjectPainting } from '#lib/paint/subject-painting/models/paint-subject.ts';
import { LINE_SUBJECT_DEFAULTS, lineSubjectPainter, type LineSubjectBrushes } from '#lib/paint/subject-painting/models/painters/line.ts';
import { defineLook } from './paint-look.ts';
import { lookDraw } from './look-step.ts';

/** Bind the line recipe to a style's brushes. inkWeight scales contour and face strokes from the subject's size. */
export function createLineLook(brushes: LineSubjectBrushes) {
  function ink<const N extends 'contour' | 'features'>(name: N, description: string) {
    const painter = lineSubjectPainter(brushes, [name]);
    return lookDraw(name, description, { colour: LINE_SUBJECT_DEFAULTS.lineColor, weight: LINE_SUBJECT_DEFAULTS.lineWeight },
      (subject, { colour, weight }) => requireSubjectPainting(paintSubject(subject, painter, { lineColor: colour, lineWeight: weight })).layers);
  }
  const fill = lineSubjectPainter(brushes, ['fill']);
  return defineLook({
    name: 'line', palettes: ['ink'], sampling: { fps: 12 },
    steps: [
      lookDraw('fill', 'spot blacks', { colour: LINE_SUBJECT_DEFAULTS.lineColor }, (subject, { colour }) =>
        requireSubjectPainting(paintSubject(subject, fill, { lineColor: colour })).layers),
      ink('contour', 'visible outlines'), ink('features', 'face and stated lines'),
      { name: 'actor', kind: 'place', sheet: ['fill', 'contour', 'features'], paper: { color: '#fffdf7', absorbency: 0.5 }, medium: 'watercolour' },
    ],
    show: ['actor'],
  }, { inkWeight: [['contour', 'weight'], ['features', 'weight']] });
}
