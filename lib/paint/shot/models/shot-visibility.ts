// shot-visibility.ts: how visible a shot's planes and occurrences are, and which occurrences draw on their own.
// Visibility multiplies a drawable's composite and re-solves nothing. A group's fades all it holds as one, and an own
// sheet's owner, layer or group, fades its card with its paint, so either below 1 composites into a scratch picture
// first; any other layer's fades its own film only. Items aren't occurrences: an item fades by its own `visibility`.

import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { shotDrawableNamer, shotOccurrencePlane, type ShotOccurrence } from './shot-occurrences.ts';
import type { InstancedPlaneProps, OccurrenceKey, PaintedShotProps, PlaneProps } from './shot-props.ts';

/**
 * Why `key`'s visibility can't be drawn, or null: it lies within 0..1. A callback's value is read at scene second
 * `at` each frame, a constant's (no `at`) as the shot loads.
 */
export function shotVisibilityProblem(key: OccurrenceKey, visibility: number, at?: number): PaintingProblem | null {
  if (visibility >= 0 && visibility <= 1) return null;
  return paintingProblem('error', key, 'visibility', `${visibility}${at === undefined ? '' : ` at ${at} s`}; visibility is within 0..1`);
}

/**
 * What keeps a shot's `visibility` from drawing, as it loads: each key names a plane by id or an occurrence of a
 * painted plane (`occurrences`, each painted plane's), never an instanced plane's item, and each constant lies
 * within 0..1.
 */
export function shotVisibilityProblems(
  visibility: NonNullable<PaintedShotProps['visibility']>, planes: readonly (PlaneProps | InstancedPlaneProps)[], occurrences: ReadonlyMap<string, readonly OccurrenceKey[]>,
): PaintingProblem[] {
  const named = shotDrawableNamer(planes, occurrences);
  return Object.entries(visibility).flatMap(([key, value]) => {
    switch (named(key)) {
      case 'item': {
        const plane = shotOccurrencePlane(key);
        return [paintingProblem('error', key, 'visibility', `fades an item of ${plane}, which isn't an occurrence: set the item's own visibility in ${plane}'s instances`)];
      }
      case 'unknown':
        return [paintingProblem('error', key, 'visibility', 'names no plane or occurrence of this shot')];
      default: {
        const problem = typeof value === 'number' ? shotVisibilityProblem(key, value) : null;
        return problem ? [problem] : [];
      }
    }
  });
}

/**
 * The occurrences among `occurrences` that composite on their own this frame, faded below 1 (`visibility`, each
 * one's this frame, 1 when absent): groups, and layers owning an own sheet (`owners`, document keys). A mask reading
 * one at 1 gathers its coverage as it's laid in place.
 */
export function shotFadedApart(occurrences: readonly ShotOccurrence[], visibility: ReadonlyMap<OccurrenceKey, number>, owners: ReadonlySet<NodeKey>): ShotOccurrence[] {
  return occurrences.filter(({ key, node, kind }) => (kind === 'group' || owners.has(node)) && (visibility.get(key) ?? 1) < 1);
}
