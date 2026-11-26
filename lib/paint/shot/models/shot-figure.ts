// shot-figure.ts: a figure as a shot's image source: the subtree of a figure card (subjectFigureCard's group) at
// each moment, with its paint, nested cards, order, reveals and visibility, on no ground. The root's paper and the
// ground slot lie outside the group, so neither is in it. A figure is plain data and draws nothing until a plane
// places it (shotPlace); placed, it compiles to the painted plane selecting its group would, so its image is that
// plane's. Its silhouette, the card's figure region, is evidence beside its picture, read at any moment.

import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { GroupKey, Region } from '#lib/paint/document/models/painting-document.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PropertySchema } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf, type LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintingEvaluation, PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import type { ShotEffectImage } from './shot-effect.ts';
import { shotPlaneSharesAt } from './shot-frame-plan.ts';
import { paintingInTime, type PaintingInTime, type PaintingInTimeOptions } from './shot-painting-in-time.ts';
import type { PlaneProps } from './shot-props.ts';
import type { PaintedSourceEnd } from './shot-selection.ts';

/**
 * A figure card's subtree as an image source: group `card` of the painting its `source` gives at each moment, alone,
 * on a transparent ground. Made by shotFigure or shotFigureInTime, which hold `source` to that selection.
 */
export type ShotFigure = { readonly kind: 'figure'; readonly card: GroupKey; readonly source: PresentationValue<LayerSelection> | PaintingInTime };

/**
 * Group `card` (subjectFigureCard's `key`) of `painting`, an evaluation or one per moment (a pose or a light moving),
 * as an image source; `at`, the scene second its clocked washes and reveals show (all of both when left out).
 */
export function shotFigure(painting: PresentationValue<PaintingEvaluation>, card: GroupKey, { at }: { readonly at?: number } = {}): ShotFigure {
  const select = (evaluation: PaintingEvaluation) => layersOf(evaluation, [card], { ground: 'transparent', ...(at !== undefined && { at }) });
  return { kind: 'figure', card, source: typeof painting === 'function' ? (moment) => select(painting(moment)) : select(painting) };
}

/** Group `card` of `source` painted with its properties in time (paintingInTime), as an image source: the shot chooses which moments to solve. */
export function shotFigureInTime<S extends PropertySchema>(
  source: PaintingSourceModule<S>, card: GroupKey, options: Omit<PaintingInTimeOptions<S>, 'layers' | 'ground'>,
): ShotFigure {
  return { kind: 'figure', card, source: paintingInTime(source, { ...options, layers: [card], ground: 'transparent' }) };
}

/** A plane laying `image`, a figure or an effect's image, where `plane` says: its placement and presentation, everything but its source. */
export const shotPlace = (image: ShotFigure | ShotEffectImage, plane: Omit<PlaneProps, 'source'>): PlaneProps => ({ ...plane, source: image });

/**
 * The silhouette of figure `card` in `selection`, document px: its own sheet's figure card's region. Null for a group
 * on no figure card: a hidden subject's, which subjectFigureCard groups without one.
 */
export function shotFigureSilhouette(selection: LayerSelection, card: GroupKey): Region | null {
  const sheet = selection.painting.tree.byKey.get(card)?.node.sheet;
  return sheet?.kind === 'own' && typeof sheet.card === 'object' && sheet.card.figure ? sheet.card.figure : null;
}

/**
 * Why `ends` can't be plane `plane`'s figure `card`: selecting more than its group on no ground, or naming a layer
 * or a group on a sheet that's no figure card. A group with no sheet passes as a hidden subject's, indistinguishable
 * from any such group. A callback is checked at its first moment only.
 */
export function shotFigureProblems(plane: string, card: GroupKey, ends: readonly PaintedSourceEnd[]): PaintingProblem[] {
  return ends.flatMap(({ selection, field }) => {
    const place = selection.painting.tree.byKey.get(card), refuse = (why: string) => [paintingProblem('error', plane, field, `names ${card} as its figure, which is ${why} of ${selection.painting.source}: a figure is a figure card's group (subjectFigureCard)`)];
    if (selection.layers.length !== 1 || selection.layers[0] !== card || selection.ground !== 'transparent') {
      return [paintingProblem('error', plane, field, `selects ${selection.layers.join(', ')} on ${selection.ground ?? 'the default'} ground as figure ${card}: make a figure with shotFigure or shotFigureInTime, which select its group alone on none`)];
    }
    if (place?.kind === 'layer') return refuse('a layer');
    if (place?.node.sheet && shotFigureSilhouette(selection, card) === null) return refuse('a group on a sheet that is no figure card');
    return [];
  });
}

/**
 * Plane `plane`'s figure silhouette at frame moment `t`, as its source reads then: each selection it blends, its
 * region (null: on no figure card) and weight. Several only between a painting in time's key drawings; none for a
 * plane placing no figure.
 */
export function shotFigureSilhouetteAt(
  shot: Pick<CompiledPaintedShot, 'motion' | 'rigs'>, plane: CompiledShotPaintedPlane, t: PaintMoment,
): { readonly region: Region | null; readonly weight: number }[] {
  const { figure } = plane;
  if (figure === null) return [];
  return shotPlaneSharesAt(shot, plane, t).map(({ selection, weight }) => ({ region: shotFigureSilhouette(selection, figure), weight }));
}
