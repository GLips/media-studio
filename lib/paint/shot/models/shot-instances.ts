// shot-instances.ts: an instanced plane's items among a frame's drawables. Each variant is a finished selection laid
// once, whole and centred on the stage, as a painted plane is; an item lays that picture through the lens by its own
// similarity at its own depth, sorted with every plane far to near each frame (shot-plan.ts). Consecutive items of one
// variant at one stepped defocus draw as one batch, and an item keyed alike at the shutter's two ends blurs along its
// own travel. Items aren't occurrences: no motion nodes, rigs, visibility keys or masks reach them.

import { paintSimilarityAfter, paintSimilarityInverse, paintSimilarityOf, paintSimilarityScale, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { PaintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintingProblem, paintingProblemsError, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment, StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { lensGaussianReach, lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import type { CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotPlaneMomentAt } from './shot-frame-plan.ts';
import type { CompiledShotMotion } from './shot-motion.ts';
import type { ShotDrawable } from './shot-plan.ts';
import type { InstancedPlaneProps, PlaneInstance } from './shot-props.ts';
import type { ShotMomentAt } from './shot-sheet-lays.ts';

/** A run of a frame's drawing: a plane, or consecutive items of one plane and variant blurred alike, drawn at once. */
export type ShotDrawStep =
  | { readonly kind: 'plane'; readonly plane: string }
  | { readonly kind: 'items'; readonly plane: string; readonly variant: string; readonly sigma: number; readonly items: readonly PlaneInstance[] };

/** A batch of one variant's items, as shotDrawSteps groups them. */
export type ShotItemsStep = Extract<ShotDrawStep, { readonly kind: 'items' }>;

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
type ShotInstanceTravel = { readonly open: PlaneInstance; readonly close: PlaneInstance };

/**
 * Each item key present in both `open` and `close` (the plane's items at the shutter's ends), with the item at
 * each: its travel between them is its motion. A key missing at either end draws without motion of its own.
 */
function shotInstanceTravel(open: readonly PlaneInstance[], close: readonly PlaneInstance[]): ReadonlyMap<string, ShotInstanceTravel> {
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
 * A variant compiled: `painted`, laid still and centred on the stage; `picture`, its document px to its picture's
 * px; `room`, the stage px round its document on its narrowest side, the farthest an item's blur may spread it.
 */
export type CompiledShotVariant = {
  readonly name: string;
  // Its instanced plane's id, on purpose: its lay plan reads that plane's clock and visibility by it (shotPlaneMomentAt,
  // shotVisibilityAt), so a held or faded plane holds or fades every item. Key what's kept per variant by object.
  readonly painted: CompiledShotPaintedPlane;
  readonly picture: PaintSimilarity;
  readonly room: number;
};

/** An instanced plane compiled: its id, canvas and depths, its props (whose `instances` each frame reads) and its variants by name. */
export type CompiledShotInstancedPlane = {
  readonly id: string;
  readonly canvas: number;
  readonly depths: InstancedPlaneProps['depths'];
  readonly props: InstancedPlaneProps;
  readonly variants: ReadonlyMap<string, CompiledShotVariant>;
};

/**
 * Instanced `props` compiled in canvas `canvas` over the shot's `back` and `stage`, its `variants` each compiled as a
 * painted plane (null: refused, its problems already found), or null and every problem keeping it from being drawn:
 * its depths, a variant at least, and a variant whose document the stage can't hold.
 */
export function compileShotInstancedPlane(
  props: InstancedPlaneProps, canvas: number, back: { readonly id: string; readonly depth: number }, stage: StampStage,
  variants: readonly (readonly [name: string, painted: CompiledShotPaintedPlane | null])[], problems: PaintingProblem[],
): CompiledShotInstancedPlane | null {
  const own = shotInstancedPlaneProblems(props, back), compiled = new Map<string, CompiledShotVariant>();
  problems.push(...own);
  for (const [name, painted] of variants) {
    if (!painted) continue;
    const { widthPx, heightPx } = painted.first.painting.document;
    if (widthPx > stage.width || heightPx > stage.height) {
      problems.push(paintingProblem('error', props.id, `variants.${name}`, `paints a ${widthPx} × ${heightPx} document, and the stage is ${stage.width} × ${stage.height}: a variant is laid whole on the stage`));
      continue;
    }
    // Centred, so an item's blur spreads it alike on every side before the stage's edge would clip it.
    const x = Math.floor((stage.width - widthPx) / 2), y = Math.floor((stage.height - heightPx) / 2);
    const lay: StampGroupLay = { placement: { x: x - stage.margin, y: y - stage.margin, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } };
    compiled.set(name, {
      name, painted: { ...painted, lay: { kind: 'still', lay } }, picture: paintSimilarityOf(lay.placement, lay.pivot),
      room: Math.min(x, y, stage.width - widthPx - x, stage.height - heightPx - y),
    });
  }
  return !own.length && compiled.size === variants.length ? { id: props.id, canvas, depths: props.depths, props, variants: compiled } : null;
}

/** Instanced `plane`'s items at frame moment `t`, read at its clock's moment. Throws on any it can't draw (shotInstanceProblems). */
function shotInstancesAt(plane: CompiledShotInstancedPlane, motion: CompiledShotMotion, t: PaintMoment): readonly PlaneInstance[] {
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
function shotItemLook(looks: PaintCameraDepthLooks, plane: string, item: PlaneInstance, travel: ShotInstanceTravel | undefined, picture: PaintSimilarity): ShotItemLook {
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

/** Why a shown item of `plane`, laid as `looked` says at scene second `at`, can't be drawn: its blur spreading its variant past its room. */
function shotItemBlurProblems(plane: CompiledShotInstancedPlane, looked: ReadonlyMap<PlaneInstance, ShotItemLook>, at: number): PaintingProblem[] {
  return [...looked].flatMap(([{ key, variant }, { sigma, visibility }]) => {
    const { room } = plane.variants.get(variant)!, reach = lensGaussianReach(lensSigmaStepped(sigma));
    if (visibility <= 0 || reach <= room) return [];
    const message = `${key} at ${at} s blurs ${variant} ${reach} px past its document, and the stage leaves it ${room}: paint ${variant} on a smaller document, or lay the item larger`;
    return [paintingProblem('error', plane.id, '', message)];
  });
}

/** An exposure's items: every instanced plane's by its id (shotInstancesAt), and how the lens lays each (`lookOf`). */
export type ShotExposureItems = {
  readonly items: ReadonlyMap<string, readonly PlaneInstance[]>;
  readonly lookOf: (plane: string, item: PlaneInstance) => ShotItemLook;
};

/**
 * `planes`' items in an exposure at `moment`, each looked at through the camera's `looks` (shotItemLook), its travel
 * read at the shutter's ends when the exposure has them. Throws on an item it can't draw (shotInstanceProblems), or
 * one blurred past its variant's room.
 */
export function shotExposureItems(
  planes: readonly CompiledShotInstancedPlane[], motion: CompiledShotMotion, { at, shutter }: ShotMomentAt, looks: PaintCameraDepthLooks,
): ShotExposureItems {
  const looked = new Map<string, ReadonlyMap<PlaneInstance, ShotItemLook>>();
  const items = new Map(planes.map((plane) => {
    const now = shotInstancesAt(plane, motion, at);
    const travel = shutter ? shotInstanceTravel(shotInstancesAt(plane, motion, shutter.open), shotInstancesAt(plane, motion, shutter.close)) : null;
    const seen = new Map(now.map((item) => [item, shotItemLook(looks, plane.id, item, travel?.get(item.key), plane.variants.get(item.variant)!.picture)]));
    const problems = shotItemBlurProblems(plane, seen, at.at);
    if (problems.length) throw paintingProblemsError(`shot plane ${plane.id}'s items at ${at.at} s`, problems);
    looked.set(plane.id, seen);
    return [plane.id, now] as const;
  }));
  return { items, lookOf: (plane, item) => looked.get(plane)!.get(item)! };
}
