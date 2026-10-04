// shot-instances.ts: an instanced plane's items among a frame's drawables. Each variant is a finished selection laid
// once, whole on the stage, as a painted plane is; an item lays that picture through the lens by its own similarity at
// its own depth, sorted with every plane far to near each frame (shot-plan.ts). Consecutive items of one variant at one
// stepped defocus draw as one batch, and an item keyed alike at the shutter's two ends blurs along its own travel.
// Items aren't occurrences: no motion nodes, rigs, visibility keys or masks reach them.

import { paintSimilarityAfter, paintSimilarityInverse, paintSimilarityOf, paintSimilarityScale, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { PaintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintingProblem, paintingProblemsError, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment, StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import type { CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotPlaneMomentAt } from './shot-frame-plan.ts';
import type { CompiledShotMotion } from './shot-motion.ts';
import { shotPlaneOccurrences } from './shot-occurrences.ts';
import type { ShotDrawable } from './shot-plan.ts';
import type { InstancedPlaneProps, PlaneInstance } from './shot-props.ts';
import { paintedSourceProblems, paintedSourceSelection } from './shot-selection.ts';
import type { ShotMomentAt } from './shot-sheet-lays.ts';

/** A run of a frame's drawing: a plane, or consecutive items of one plane and variant blurred alike, drawn at once. */
export type ShotDrawStep =
  | { readonly kind: 'plane'; readonly plane: string }
  | { readonly kind: 'items'; readonly plane: string; readonly variant: string; readonly sigma: number; readonly items: readonly PlaneInstance[] };

/**
 * `drawables` (shotDrawableOrder) as draws: consecutive items of one plane and variant whose defocus (`sigmaOf`, picture
 * px of sigma) steps to one sigma batch together, a variant's picture blurred once per stepped sigma. Any other
 * drawable between two items splits them.
 */
export function shotDrawSteps(drawables: readonly ShotDrawable[], sigmaOf: (plane: string, item: PlaneInstance) => number): ShotDrawStep[] {
  const steps: ShotDrawStep[] = [];
  let run: { plane: string; variant: string; sigma: number; items: PlaneInstance[] } | null = null;
  for (const drawable of drawables) {
    if (drawable.kind === 'plane') {
      run = null;
      steps.push({ kind: 'plane', plane: drawable.plane });
      continue;
    }
    const { plane, item } = drawable, sigma = lensSigmaStepped(sigmaOf(plane, item));
    if (run && run.plane === plane && run.variant === item.variant && run.sigma === sigma) {
      run.items.push(item);
      continue;
    }
    run = { plane, variant: item.variant, sigma, items: [item] };
    steps.push({ kind: 'items', ...run });
  }
  return steps;
}

/** An item present at both of the shutter's ends by one key: where it lay as the shutter opened and as it closed. */
export type ShotInstanceTravel = { readonly open: PlaneInstance; readonly close: PlaneInstance };

/**
 * Each item key present in both `open` and `close` (the plane's items at the shutter's ends), with the item at
 * each: its travel between them is its motion. A key missing at either end draws without motion of its own.
 */
export function shotInstanceTravel(open: readonly PlaneInstance[], close: readonly PlaneInstance[]): ReadonlyMap<string, ShotInstanceTravel> {
  const closing = new Map(close.map((item) => [item.key, item]));
  return new Map(open.flatMap((item) => {
    const closed = closing.get(item.key);
    return closed ? [[item.key, { open: item, close: closed }]] : [];
  }));
}

/** What keeps instanced `plane`'s depths and variants from holding items: depths above 0, `near` ≤ `far`, nearer than the back plane `back`; a variant at least. */
function shotInstancedPlaneProblems(plane: InstancedPlaneProps, back: { readonly id: string; readonly depth: number }): PaintingProblem[] {
  const problems: PaintingProblem[] = [], { near, far } = plane.depths;
  if (!(near > 0 && Number.isFinite(near) && far >= near && Number.isFinite(far))) {
    problems.push(paintingProblem('error', plane.id, 'depths', `${near}..${far}; items lie between depths above 0, near first`));
  } else if (!(far < back.depth)) {
    problems.push(paintingProblem('error', plane.id, 'depths.far', `${far} isn't nearer than the back, ${back.id} at depth ${back.depth}`));
  }
  if (Object.keys(plane.variants).length === 0) problems.push(paintingProblem('error', plane.id, 'variants', 'an instanced plane needs a variant to lay'));
  return problems;
}

/**
 * What keeps `items`, instanced `plane`'s at scene second `at`, from drawing: a key used twice, a variant the plane
 * doesn't have, a depth outside its `depths`, a visibility outside 0..1, or a lay that isn't finite or doesn't scale
 * by more than 0.
 */
export function shotInstanceProblems(plane: InstancedPlaneProps, items: readonly PlaneInstance[], at: number): PaintingProblem[] {
  const problems: PaintingProblem[] = [], seen = new Set<string>(), { near, far } = plane.depths;
  const error = (message: string) => problems.push(paintingProblem('error', plane.id, '', message));
  for (const { key, variant, depth, lay, visibility = 1 } of items) {
    if (seen.has(key)) error(`two items are called ${key} at ${at} s`);
    seen.add(key);
    if (!Object.hasOwn(plane.variants, variant)) error(`${key} at ${at} s lays ${variant}, which isn't one of ${plane.id}'s variants`);
    if (!(depth >= near && depth <= far)) error(`${key} at ${at} s lies at depth ${depth}, outside ${plane.id}'s depths ${near}..${far}`);
    if (!(visibility >= 0 && visibility <= 1)) error(`${key} at ${at} s is ${visibility} visible; visibility is within 0..1`);
    const { placement: { x, y, rotation, scale }, pivot } = lay;
    if (![x, y, rotation, pivot.x, pivot.y].every(Number.isFinite) || !(scale > 0 && Number.isFinite(scale))) {
      error(`${key} at ${at} s is laid by a placement that isn't finite or scales by ${scale}; a lay scales by more than 0`);
    }
  }
  return problems;
}

/**
 * A variant compiled: laid as a painted plane (`painted`, its document's first texel on the stage's, never the back),
 * its document px taken to its picture's px by `picture`.
 */
export type CompiledShotVariant = { readonly name: string; readonly painted: CompiledShotPaintedPlane; readonly picture: PaintSimilarity };

/** An instanced plane compiled: its id, canvas and depths, its props (whose `instances` each frame reads) and its variants by name. */
export type CompiledShotInstancedPlane = {
  readonly id: string;
  readonly canvas: number;
  readonly depths: InstancedPlaneProps['depths'];
  readonly props: InstancedPlaneProps;
  readonly variants: ReadonlyMap<string, CompiledShotVariant>;
};

/**
 * Instanced `props` compiled in canvas `canvas` over the shot's `back` and `stage`, or null and every problem keeping
 * it from being drawn: its depths, a variant at least, and each variant's source, one selection (a dissolve between
 * its ends isn't drawn) whose document the stage holds.
 */
export function compileShotInstancedPlane(
  props: InstancedPlaneProps, canvas: number, back: { readonly id: string; readonly depth: number }, stage: StampStage, problems: PaintingProblem[],
): CompiledShotInstancedPlane | null {
  const own = shotInstancedPlaneProblems(props, back);
  problems.push(...own);
  const { margin } = stage, lay: StampGroupLay = { placement: { x: -margin, y: -margin, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } };
  const picture = paintSimilarityOf(lay.placement, lay.pivot), variants = new Map<string, CompiledShotVariant>();
  for (const [name, source] of Object.entries(props.variants)) {
    const field = `variants.${name}`, sourceProblems = paintedSourceProblems(props.id, source, field);
    problems.push(...sourceProblems);
    if (sourceProblems.length) continue;
    const drawn = paintedSourceSelection(source);
    if ('problem' in drawn) {
      problems.push(paintingProblem('error', props.id, field, drawn.problem));
      continue;
    }
    const { widthPx, heightPx } = drawn.selection.painting.document;
    if (widthPx > stage.width || heightPx > stage.height) {
      problems.push(paintingProblem('error', props.id, field, `paints a ${widthPx} × ${heightPx} document, and the stage is ${stage.width} × ${stage.height}: a variant is laid whole on the stage`));
      continue;
    }
    variants.set(name, {
      name, picture, painted: {
        kind: 'painted', id: props.id, depth: props.depths.far, canvas, source, sourceClock: [], lay: { kind: 'still', lay }, first: drawn.selection,
        occurrences: shotPlaneOccurrences(props.id, source), back: false,
      },
    });
  }
  return !own.length && variants.size === Object.keys(props.variants).length ? { id: props.id, canvas, depths: props.depths, props, variants } : null;
}

/** Instanced `plane`'s items at frame moment `t`, read at its clock's moment. Throws on any it can't draw (shotInstanceProblems). */
export function shotInstancesAt(plane: CompiledShotInstancedPlane, motion: CompiledShotMotion, t: PaintMoment): readonly PlaneInstance[] {
  const moment = shotPlaneMomentAt(motion, plane.id, t), items = plane.props.instances(moment), problems = shotInstanceProblems(plane.props, items, moment.at);
  if (problems.length) throw paintingProblemsError(`shot plane ${plane.id}'s instances at ${moment.at} s`, problems);
  return items;
}

/**
 * How the lens lays an item's variant picture: `view`, picture px to frame px; its views at the shutter's ends (null:
 * still); its distance from the camera; `sigma`, its defocus in picture px, unstepped; and how visible it is.
 */
export type ShotItemLook = {
  readonly view: PaintSimilarity;
  readonly shutter: { readonly open: PaintSimilarity; readonly close: PaintSimilarity } | null;
  readonly distance: number;
  readonly sigma: number;
  readonly visibility: number;
};

const sameSimilarity = (a: PaintSimilarity, b: PaintSimilarity) => a.ma === b.ma && a.mb === b.mb && a.kx === b.kx && a.ky === b.ky;

/**
 * `item`'s look in one exposure (`looks`, the camera's): its variant's picture (`picture`, the variant's document px to
 * picture px) laid by its lay at its depth. With `travel` (its key at both of the shutter's ends) each end is where it
 * lay then, seen as the camera saw then; without, the camera's motion alone carries it.
 */
export function shotItemLook(looks: PaintCameraDepthLooks, plane: string, item: PlaneInstance, travel: ShotInstanceTravel | undefined, picture: PaintSimilarity): ShotItemLook {
  const unpictured = paintSimilarityInverse(picture), name = `${plane}'s item ${item.key}`;
  const seen = (camera: PaintSimilarity, laid: PlaneInstance) => paintSimilarityAfter(camera, paintSimilarityAfter(paintSimilarityOf(laid.lay.placement, laid.lay.pivot), unpictured));
  const look = looks.lookAt(item.depth, name), view = seen(look.view, item);
  const end = (laid: PlaneInstance, which: 'open' | 'close') => {
    const there = laid.depth === item.depth ? look : looks.lookAt(laid.depth, name);
    return seen(there.shutter?.[which] ?? there.view, laid);
  };
  const open = end(travel?.open ?? item, 'open'), close = end(travel?.close ?? item, 'close');
  return {
    view, shutter: sameSimilarity(open, close) ? null : { open, close }, distance: look.distance, sigma: look.defocus / paintSimilarityScale(view), visibility: item.visibility ?? 1,
  };
}

/** An exposure's items: every instanced plane's by its id (shotInstancesAt), and how the lens lays each (`lookOf`). */
export type ShotExposureItems = {
  readonly items: ReadonlyMap<string, readonly PlaneInstance[]>;
  readonly lookOf: (plane: string, item: PlaneInstance) => ShotItemLook;
};

/**
 * `planes`' items in an exposure at `moment`, each looked at through the camera's `looks` (shotItemLook), its travel
 * read at the shutter's ends when the exposure has them.
 */
export function shotExposureItems(
  planes: readonly CompiledShotInstancedPlane[], motion: CompiledShotMotion, { at, shutter }: ShotMomentAt, looks: PaintCameraDepthLooks,
): ShotExposureItems {
  const looked = new Map<string, ReadonlyMap<PlaneInstance, ShotItemLook>>();
  const items = new Map(planes.map((plane) => {
    const now = shotInstancesAt(plane, motion, at);
    const travel = shutter ? shotInstanceTravel(shotInstancesAt(plane, motion, shutter.open), shotInstancesAt(plane, motion, shutter.close)) : null;
    looked.set(plane.id, new Map(now.map((item) => [item, shotItemLook(looks, plane.id, item, travel?.get(item.key), plane.variants.get(item.variant)!.picture)])));
    return [plane.id, now] as const;
  }));
  return { items, lookOf: (plane, item) => looked.get(plane)!.get(item)! };
}
