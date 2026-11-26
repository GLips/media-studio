import type { Clip, Subpath } from '#lib/paint/document/models/painting-document.ts';
import { subjectFramePoint, type SubjectFrame } from '#lib/paint/subject/models/subject-frame.ts';
import type { SubjectArea, Visibility } from '#lib/paint/subject/models/subject-geometry.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import { redrawSeed, type RedrawToken } from '#lib/timing/drawings/models/drawing-schedule.ts';
import { subjectAreaRegion } from './subject-document-geometry.ts';
import type { SubjectPaintKey } from './subject-painter.ts';

const square = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] as const;

/**
 * Draw one addressed stroke on a named frame. Supply its owner's visibility and a subjectPaintKey for actor, part,
 * contribution and mark. Generate a pen-down path in the local square [-1,1]² using the token's random stream.
 * Spread the returned geometry into a stroke application; its clips trim the whole brush footprint. Hidden or
 * unavailable surfaces yield no applications.
 */
export function subjectFrameMarks(frame: SubjectFrame, visible: Visibility<SubjectArea>, key: SubjectPaintKey, token: RedrawToken,
  localStroke: (random: () => number) => Subpath,
): { key: SubjectPaintKey; seed: string; subpaths: readonly Subpath[]; clips: readonly Clip[] }[] {
  if (frame.status.kind === 'unavailable' || visible.kind === 'hidden') return [];
  const { basis } = frame.status;
  const seed = redrawSeed(key, token);
  const points = localStroke(seededRandom(seed));
  if (points.some(({ x, y }) => !(Math.abs(x) <= 1 && Math.abs(y) <= 1))) throw new Error('subject frame mark points must lie in the local square [-1,1]');
  const domain = { kind: 'polygon' as const, rings: [square.map(point => subjectFramePoint(basis, point))] };
  const project = (point: Subpath[number]) => ({ ...point, ...subjectFramePoint(basis, point) });
  return [{
    key, seed, subpaths: [points.map(project)],
    clips: [{ region: domain }, { region: subjectAreaRegion(visible.geometry) }],
  }];
}
