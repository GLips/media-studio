// shot-effect.ts: an effect's models half, and the image it makes as plain data. A definition checks its parameters,
// names the finite reads it makes of its inputs (each through a map in plane px, at a moment mapped from the
// frame's), and how far its output spreads past them. Its studio half (shot-effect-gpu.ts) shades the reads; the
// halves meet in a shot's effect table, so a project defines its own exactly as the built-ins are.
//
// The runtime owns its key (shotEffectImageKey), its box (input boxes mapped, grown, then clipped to the stage), and
// keeping its inputs' pictures until it's drawn. Inputs need not be placed: each is drawn through the placement of
// the plane holding the effect.

import { redrawSeed, type RedrawToken } from '#lib/timing/drawings/models/drawing-schedule.ts';
import { paintIdHash } from '#lib/paint/animation/models/paint-motion-clips.ts';
import { paintNodeTimeAt } from '#lib/paint/animation/models/paint-clock.ts';
import { paintAnimationFrameAt } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { paintSpanFrameRange } from '#lib/paint/animation/models/paint-span-moments.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityBox, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingBoxUnion } from '#lib/paint/document/models/painting-footprint.ts';
import { paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampBoxGrown, type StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import type { ShotFigure } from './shot-figure.ts';
import type { PaintingInTime } from './shot-painting-in-time.ts';
import type { PaintedSource } from './shot-selection.ts';

/** A parameter's value: plain data, so parameters key an output as written; a record groups a few (`every: { drawings: 2 }`). */
export type ShotEffectParamValue = number | boolean | string | readonly number[] | { readonly [name: string]: ShotEffectParamValue };

/** An effect's parameters by name. */
export type ShotEffectParams = Readonly<Record<string, ShotEffectParamValue>>;

/**
 * When a read reads its input, from the frame's moment: `{ drawingsEarlier: n }`, n drawings back on the clock its
 * plane's `sourceClock` declares (refused on a plane declaring none); or a map of the moment, which reads the past by
 * momentEarlier's convention, shifting both `at` and `frame`, and gives the same moment for the same moment.
 */
export type ShotEffectMoment = { readonly drawingsEarlier: number } | ((moment: PaintMoment) => PaintMoment);

/**
 * One read an effect makes of input `input`: its picture carried by `map` (input plane px to the output's; the
 * identity left out), at the moment `moment` says (the frame's own left out). A read of a moment before its source's
 * first drawing in the shot lays nothing.
 */
export type ShotEffectRead<I extends string = string> = {
  readonly input: I;
  readonly map?: PaintSimilarity;
  readonly moment?: ShotEffectMoment;
};

/**
 * A drawing-varying shader reads its source token as a u32 seed with shotRedrawSeed().
 * A moment-varying shader reads exposure seconds with shotSeconds(). Both inputs participate in the image key.
 */
export type ShotEffectVaries = 'drawing' | 'moment';

/** A problem an effect finds in its parameters: the parameter's field (`count`, `step.x`) and what's wrong. */
export type ShotEffectProblem = { readonly field: string; readonly message: string };

type ShotEffectExtent = 'inputs' | 'stage';
type ExtentOf<P> = { choose(params: P): ShotEffectExtent }['choose'];

/**
 * An effect's models half. `name` keys its output, unique among a shot's effects. `inputs` names what it reads,
 * `optional` those it may skip. `problems` checks its parameters, defaults filled in; `reads` lists at
 * most SHOT_EFFECT_READS_MOST reads of the inputs `given`; `grow`, px its output spreads past them (0 when left out);
 * `varies`, what of the moment it follows.
 */
export type ShotEffectDefinition<P extends ShotEffectParams = ShotEffectParams, I extends string = string, O extends I = I> = {
  readonly name: string;
  readonly inputs: readonly I[];
  /** Shade every stage texel, including the camera margin and where every input is clear. */
  readonly extent?: ShotEffectExtent | ExtentOf<P>;
  readonly optional?: readonly O[];
  readonly defaults: P;
  /** Its film's emission is light of its own: it blooms, and throws spill on a plane `illuminate`s. */
  readonly emits?: boolean;
  // Methods, so a definition of any parameters stands as one of ShotEffectParams in a table (method parameters are bivariant).
  problems?(params: P): readonly ShotEffectProblem[];
  reads?(params: P, given: readonly I[]): readonly ShotEffectRead<I>[];
  grow?(params: P): number;
  varies?(params: P): readonly ShotEffectVaries[];
};

/** Maximum logical reads in one dispatch. Pictures beyond the binding budget share an array texture. */
export const SHOT_EFFECT_READS_MOST = 24;

/** What an effect reads: a painted source, a painting in time, a figure, or another effect's image. */
export type ShotImageSource = PresentationValue<PaintedSource> | PaintingInTime | ShotFigure | ShotEffectImage | ShotPlaneImage;

/** The sharp image of a placed painted or effect plane, with its masks, pose and visibility, at the read's moment. */
export type ShotPlaneImage = { readonly kind: 'plane-image'; readonly plane: string };

/** Read a placed painted or effect plane where the camera shows it, in the coordinate system of the effect. */
export const shotPlaneImage = (plane: string): ShotPlaneImage => ({ kind: 'plane-image', plane });

/** An effect's image as written: its definition, its inputs by name, and its parameters as given. Plain data until a shot draws it. */
export type ShotEffectImage = {
  readonly kind: 'effect';
  readonly definition: ShotEffectDefinition;
  readonly inputs: Readonly<Record<string, ShotImageSource>>;
  readonly params: Partial<ShotEffectParams>;
};

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * An effect's inputs as its constructor takes them: the source itself for an effect of one, else each by name, those
 * in `O` optional.
 */
export type ShotEffectInputs<I extends string, O extends I = never> = true extends IsUnion<I>
  ? Readonly<Record<Exclude<I, O>, ShotImageSource>> & Partial<Readonly<Record<O, ShotImageSource>>>
  : ShotImageSource;

/** An effect's constructor, `offsetCopies(hero, { count: 3 })`, and its definition, which its studio half and the effect table name. */
export type ShotEffect<P extends ShotEffectParams, I extends string, O extends I = never> = ((inputs: ShotEffectInputs<I, O>, params?: Partial<P>) => ShotEffectImage) & {
  readonly definition: ShotEffectDefinition<P, I, O>;
};

/** `definition` as a constructor of its images: place one with shotPlace, or read it in another effect. */
export function defineShotEffect<P extends ShotEffectParams>(definition: ShotEffectDefinition<P, never> & { readonly inputs: readonly []; readonly extent: 'stage' }):
  ((params?: Partial<P>) => ShotEffectImage) & { readonly definition: ShotEffectDefinition<P> };
export function defineShotEffect<P extends ShotEffectParams, const I extends string, const O extends I = never>(
  definition: ShotEffectDefinition<P, I, O> & { readonly inputs: readonly [I, ...I[]] },
): ShotEffect<P, I, O>;
export function defineShotEffect(definition: ShotEffectDefinition) {
  const make = (source?: ShotImageSource | Readonly<Record<string, ShotImageSource>> | Partial<ShotEffectParams>, params: Partial<ShotEffectParams> = {}): ShotEffectImage => {
    // SAFETY: the constructor overloads pair the input count with its calling convention.
    if (!definition.inputs.length) return { kind: 'effect', definition, inputs: {}, params: (source ?? {}) as ShotEffectParams };
    // SAFETY: the one-input signature accepts the source itself, the multi-input signature a record by name.
    const inputs = definition.inputs.length === 1 ? { [definition.inputs[0]]: source as ShotImageSource } : source as Record<string, ShotImageSource>;
    return { kind: 'effect', definition, inputs, params };
  };
  return Object.assign(make, { definition });
}

// ---- compiled ------------------------------------------------------------------------------------------------------

/** An image compiled: a painted image laid through its plane's placement (a leaf), or an effect's. */
export type CompiledShotImage = CompiledShotPaintedPlane | CompiledShotEffectImage | ShotPlaneImage;

/** A read compiled: the image read, its map (input plane px to output plane px), and its moment map (null: the frame's own). */
export type CompiledShotEffectRead = { readonly input: CompiledShotImage; readonly map: PaintSimilarity; readonly moment: ((moment: PaintMoment) => PaintMoment) | null };

export const shotEffectRedrawSeed = (name: string, token: RedrawToken) => paintIdHash(redrawSeed(name, token));

/** Only declared variation participates in the pass and its cache key. */
export type ShotEffectTime = { readonly token: RedrawToken | null; readonly seconds: number };

/**
 * An effect's image compiled: its definition; its parameters, defaults filled in; its reads, in order; how far its
 * output spreads past them, px; `key`, what of its output's key its parameters fix (its reads' keys follow); and
 * `timeAt`, what it reads of the moment it's drawn at (null: nothing, the same every frame).
 */
export type CompiledShotEffectImage = {
  readonly kind: 'effect';
  readonly definition: ShotEffectDefinition;
  readonly params: ShotEffectParams;
  readonly reads: readonly CompiledShotEffectRead[];
  readonly grow: number;
  readonly extent: ShotEffectExtent;
  readonly key: string;
  readonly timeAt: ((moment: PaintMoment) => ShotEffectTime) | null;
};

/** What `effect` drawn at `moment` reads of it, with a null token for an effect following no drawing. */
export const shotEffectTimeAt = (effect: CompiledShotEffectImage, moment: PaintMoment): ShotEffectTime => effect.timeAt?.(moment) ?? { token: null, seconds: 0 };

/** What of `effect`'s output's key it fixes drawn at `moment`: its own key, and what it reads of the moment, if anything. */
export const shotEffectKeyAt = (effect: CompiledShotEffectImage, moment: PaintMoment) => {
  if (!effect.timeAt) return effect.key;
  const { token, seconds } = effect.timeAt(moment);
  return JSON.stringify([effect.key, token, seconds]);
};

const finiteMap = ({ ma, mb, kx, ky }: PaintSimilarity) => [ma, mb, kx, ky].every(Number.isFinite) && (ma !== 0 || mb !== 0);

/**
 * `image`'s parameters, defaults filled in, and its reads and growth, or why plane `plane` (its effect at `field`)
 * can't draw them: a parameter it doesn't take, its own check's problems, a read naming no input, more reads than
 * SHOT_EFFECT_READS_MOST, a map that isn't a finite similarity, a growth below 0. Inputs are compiled by the caller.
 */
export function shotEffectChecked(plane: string, field: string, image: ShotEffectImage): {
  readonly params: ShotEffectParams; readonly reads: readonly ShotEffectRead[]; readonly grow: number; readonly varies: readonly ShotEffectVaries[];
  readonly extent: ShotEffectExtent; readonly problems: readonly PaintingProblem[];
} {
  const { definition } = image, { name } = definition, problems: PaintingProblem[] = [];
  const error = (at: string, message: string) => problems.push(paintingProblem('error', plane, paintingField(field, at), `${name}: ${message}`));
  const taken = Object.keys(definition.defaults);
  for (const key of Object.keys(image.params)) if (!taken.includes(key)) error(`params.${key}`, `takes no parameter ${key}; it takes ${taken.join(', ') || 'none'}`);
  const optional: readonly string[] = definition.optional ?? [], required = definition.inputs.filter((input) => !optional.includes(input));
  for (const input of required) if (image.inputs[input] === undefined) error('inputs', `reads ${input}, which isn't given: give ${required.join(', ')}`);
  for (const input of Object.keys(image.inputs)) if (!definition.inputs.includes(input)) error(`inputs.${input}`, `has no input ${input}; it reads ${definition.inputs.join(', ')}`);
  // SAFETY: every key given is one of the defaults' (checked above, refusing the rest), each its own check's to judge.
  const params = { ...definition.defaults, ...image.params } as ShotEffectParams;
  if (problems.length) return { params, reads: [], grow: 0, extent: 'inputs', varies: [], problems };
  for (const { field: at, message } of (definition.problems?.(params) ?? [])) error(`params.${at}`, message);
  if (problems.length) return { params, reads: [], grow: 0, extent: 'inputs', varies: [], problems };
  const varies = definition.varies?.(params) ?? [];
  const given = definition.inputs.filter((input) => image.inputs[input] !== undefined);
  const reads = definition.reads?.(params, given) ?? given.map((input): ShotEffectRead => ({ input }));
  const grow = definition.grow?.(params) ?? 0;
  const extent = typeof definition.extent === 'function' ? definition.extent(params) : definition.extent ?? 'inputs';
  if (!reads.length && extent !== 'stage') error('params', 'reads nothing: an effect reads one of its inputs at least');
  if (reads.length > SHOT_EFFECT_READS_MOST) error('params', `makes ${reads.length} reads, past the ${SHOT_EFFECT_READS_MOST} one effect makes: read the output of one in another`);
  reads.forEach(({ input, map, moment }, i) => {
    if (!given.includes(input)) error('params', `its read ${i} names ${input}, which isn't one of the inputs given (${given.join(', ')})`);
    if (map && !finiteMap(map)) error('params', `its read ${i}'s map (${map.ma}, ${map.mb}, ${map.kx}, ${map.ky}) isn't a finite similarity that keeps a size`);
    if (moment && typeof moment !== 'function' && !(Number.isInteger(moment.drawingsEarlier) && moment.drawingsEarlier >= 0)) {
      error('params', `its read ${i} reads ${moment.drawingsEarlier} drawings earlier, not a whole number from 0`);
    }
  });
  if (!(grow >= 0 && Number.isFinite(grow))) error('params', `grows its output by ${grow} px; it grows by 0 or more`);
  return { params, reads, grow, extent, varies, problems };
}

/** A compiled effect image from its checked parts, compiled reads and time: its parameters keyed with its definition's name. */
export const compiledShotEffect = (
  definition: ShotEffectDefinition, params: ShotEffectParams, reads: readonly CompiledShotEffectRead[], grow: number, extent: ShotEffectExtent, timeAt: CompiledShotEffectImage['timeAt'],
): CompiledShotEffectImage => ({ kind: 'effect', definition, params, reads, grow, extent, key: JSON.stringify([definition.name, params]), timeAt });

/** A read's map, its identity when the read gives none. */
export const shotEffectReadMap = (read: ShotEffectRead) => read.map ?? PAINT_SIMILARITY_IDENTITY;

/**
 * Where `effect`'s output can lie, plane px, given where each read's input can (`inputBox`, null: nowhere): each
 * box carried through its read's map, unioned, grown by the effect's growth. Before any clip: the stage clips it after.
 * An input is drawn within the stage, so a read carrying paint from past the stage's edge shows that edge.
 */
export function shotEffectBox(effect: CompiledShotEffectImage, inputBox: (read: CompiledShotEffectRead, index: number) => StampBox | null, maps?: readonly PaintSimilarity[]): StampBox | null {
  let box: StampBox | undefined;
  effect.reads.forEach((read, i) => {
    const input = inputBox(read, i);
    if (input) box = paintingBoxUnion(box, paintSimilarityBox(maps?.[i] ?? read.map, input));
  });
  return box ? stampBoxGrown(box, effect.grow) : null;
}

/** Every painted image `image` reads, through any effect, each once, in read order. */
export function shotImageLeaves(image: CompiledShotImage): CompiledShotPaintedPlane[] {
  const leaves: CompiledShotPaintedPlane[] = [];
  const visit = (at: CompiledShotImage) => {
    if (at.kind === 'painted') {
      if (!leaves.includes(at)) leaves.push(at);
      return;
    }
    if (at.kind === 'plane-image') return;
    for (const { input } of at.reads) visit(input);
  };
  visit(image);
  return leaves;
}

/** A painted image an image reads, and the moment maps it's read through, outermost first. */
export type ShotImageLeafRead = { readonly leaf: CompiledShotPaintedPlane; readonly moments: readonly ((moment: PaintMoment) => PaintMoment)[] };

/**
 * Each painted image `image` reads and the moment maps it's read through, outermost first: a leaf read through two
 * nested reads at moments is read at the inner's map of the outer's. A painted image is its own, at the frame's moment.
 */
export function shotImageLeafReads(image: CompiledShotImage): ShotImageLeafRead[] {
  const found: { leaf: CompiledShotPaintedPlane; moments: ((moment: PaintMoment) => PaintMoment)[] }[] = [];
  const visit = (at: CompiledShotImage, moments: ((moment: PaintMoment) => PaintMoment)[]) => {
    if (at.kind === 'painted') {
      found.push({ leaf: at, moments });
      return;
    }
    if (at.kind === 'plane-image') return;
    for (const { input, moment } of at.reads) visit(input, moment ? [...moments, moment] : moments);
  };
  visit(image, []);
  return found;
}

/** The moment `moments` (shotImageLeafReads', outermost first) read frame moment `t` at. */
export const shotMomentMapped = (moments: readonly ((moment: PaintMoment) => PaintMoment)[], t: PaintMoment): PaintMoment =>
  moments.reduce((at, map) => map(at), t);

/**
 * The moment a leaf read (shotImageLeafReads') reads at frame moment `t`, or null before its source begins: when
 * the drawing its source shows then, through its `sourceClock`, is older than the one it shows at the shot's first
 * frame. So no ghost reads a drawing the shot never showed.
 */
export function shotLeafReadMoment(
  shot: Pick<CompiledPaintedShot, 'span' | 'motion'>, { leaf, moments }: ShotImageLeafRead, t: PaintMoment,
): PaintMoment | null {
  const mapped = shotMomentMapped(moments, t);
  return !moments.length || shotDrawingStarted(shot, leaf.sourceClock, mapped) ? mapped : null;
}

/** A read at a mapped moment can show a drawing only once its source clock reaches the shot's first drawing. */
export function shotDrawingStarted(
  shot: Pick<CompiledPaintedShot, 'span' | 'motion'>, clock: CompiledShotPaintedPlane['sourceClock'], mapped: PaintMoment,
): boolean {
  // A moment mapped back by seconds can land a rounding error short of the animation grid.
  const fps = shot.motion.animationFps, drawn = (m: PaintMoment) => paintAnimationFrameAt(paintNodeTimeAt(clock, m, fps).frame, fps);
  const { first } = paintSpanFrameRange(shot.span);
  return drawn(mapped) >= drawn(paintMoment(first / shot.span.fps));
}

/** Each placed input and the enclosing read maps in evaluation order. */
export function shotPlacedReads(image: CompiledShotImage, moments: ShotImageLeafRead['moments'] = []): { plane: string; moments: ShotImageLeafRead['moments'] }[] {
  if (image.kind === 'painted') return [];
  if (image.kind === 'plane-image') return [{ plane: image.plane, moments }];
  return image.reads.flatMap((read) => shotPlacedReads(read.input, read.moment ? [...moments, read.moment] : moments));
}
