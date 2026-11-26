// shot-effect.ts: an effect's models half, and the image it makes as plain data. A definition checks its parameters,
// names the finite reads it makes of its inputs (each through a map in plane px, at a moment mapped from the
// frame's), and how far its output spreads past them. Its studio half (shot-effect-gpu.ts) shades the reads; the
// halves meet in a shot's effect table, so a project defines its own exactly as the built-ins are.
//
// The runtime owns its key (shotEffectImageKey), its box (input boxes mapped, grown, then clipped to the stage), and
// keeping its inputs' pictures until it's drawn. Inputs need not be placed: each is drawn through the placement of
// the plane holding the effect.

import { PAINT_SIMILARITY_IDENTITY, paintSimilarityBox, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingBoxUnion } from '#lib/paint/document/models/painting-footprint.ts';
import { paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampBoxGrown, type StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledShotPaintedPlane } from './shot-compile.ts';
import type { ShotFigure } from './shot-figure.ts';
import type { PaintingInTime } from './shot-painting-in-time.ts';
import type { PaintedSource } from './shot-selection.ts';

/** A parameter's value: plain data, so parameters key an output as written. */
export type ShotEffectParamValue = number | boolean | string | readonly number[];

/** An effect's parameters by name. */
export type ShotEffectParams = Readonly<Record<string, ShotEffectParamValue>>;

/**
 * One read an effect makes of input `input`: its picture carried by `map` (input plane px to the output's; the
 * identity left out), at the moment `moment` maps the frame's to (its own left out). A moment map shifts both a
 * moment's `at` and `frame` for an earlier drawing; it must give the same moment for the same moment.
 */
export type ShotEffectRead<I extends string = string> = {
  readonly input: I;
  readonly map?: PaintSimilarity;
  readonly moment?: (moment: PaintMoment) => PaintMoment;
};

/** A problem an effect finds in its parameters: the parameter's field (`count`, `step.x`) and what's wrong. */
export type ShotEffectProblem = { readonly field: string; readonly message: string };

/**
 * An effect's models half. `name` keys its output and names it in problems, so it's unique among a shot's effects.
 * `inputs` names what it reads. `problems` checks its parameters, `defaults` filled in; `reads` lists its reads, at
 * most SHOT_EFFECT_READS_MOST; `grow`, px its output spreads past them (a blur's reach), 0 when left out.
 */
export type ShotEffectDefinition<P extends ShotEffectParams = ShotEffectParams, I extends string = string> = {
  readonly name: string;
  readonly inputs: readonly [I, ...I[]];
  readonly defaults: P;
  readonly emits?: boolean;
  // Methods, so a definition of any parameters stands as one of ShotEffectParams in a table (method parameters are bivariant).
  problems(params: P): readonly ShotEffectProblem[];
  reads(params: P): readonly ShotEffectRead<I>[];
  grow?(params: P): number;
};

/** The most reads one effect makes: each binds a texture in its pass, which a device holds 16 of; nest effects for more. */
export const SHOT_EFFECT_READS_MOST = 12;

/** What an effect reads: a painted source, a painting in time, a figure, or another effect's image. */
export type ShotImageSource = PresentationValue<PaintedSource> | PaintingInTime | ShotFigure | ShotEffectImage;

/** An effect's image as written: its definition, its inputs by name, and its parameters as given. Plain data until a shot draws it. */
export type ShotEffectImage = {
  readonly kind: 'effect';
  readonly definition: ShotEffectDefinition;
  readonly inputs: Readonly<Record<string, ShotImageSource>>;
  readonly params: Partial<ShotEffectParams>;
};

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/** An effect's inputs as its constructor takes them: the source itself for an effect of one, else each by name. */
export type ShotEffectInputs<I extends string> = true extends IsUnion<I> ? Readonly<Record<I, ShotImageSource>> : ShotImageSource;

/** An effect's constructor, `offsetCopies(hero, { count: 3 })`, and its definition, which its studio half and the effect table name. */
export type ShotEffect<P extends ShotEffectParams, I extends string> = ((inputs: ShotEffectInputs<I>, params?: Partial<P>) => ShotEffectImage) & {
  readonly definition: ShotEffectDefinition<P, I>;
};

/** `definition` as a constructor of its images: place one with shotPlace, or read it in another effect. */
export function defineShotEffect<P extends ShotEffectParams, const I extends string>(definition: ShotEffectDefinition<P, I>): ShotEffect<P, I> {
  const [only] = definition.inputs, lone = definition.inputs.length === 1;
  const make = (inputs: ShotEffectInputs<I>, params: Partial<P> = {}): ShotEffectImage => ({
    kind: 'effect', definition,
    // SAFETY: an effect of one input takes the source itself (ShotEffectInputs); of more, a record by name.
    inputs: lone ? { [only]: inputs as ShotImageSource } : (inputs as Readonly<Record<string, ShotImageSource>>),
    params,
  });
  return Object.assign(make, { definition });
}

// ---- compiled ------------------------------------------------------------------------------------------------------

/** An image compiled: a painted image laid through its plane's placement (a leaf), or an effect's. */
export type CompiledShotImage = CompiledShotPaintedPlane | CompiledShotEffectImage;

/** A read compiled: the image read, its map (input plane px to output plane px), and its moment map (null: the frame's own). */
export type CompiledShotEffectRead = { readonly input: CompiledShotImage; readonly map: PaintSimilarity; readonly moment: ((moment: PaintMoment) => PaintMoment) | null };

/**
 * An effect's image compiled: its definition; its parameters, defaults filled in; its reads, in order; how far its
 * output spreads past them, px; and `key`, what of its output's key its parameters fix (its reads' keys follow).
 */
export type CompiledShotEffectImage = {
  readonly kind: 'effect';
  readonly definition: ShotEffectDefinition;
  readonly params: ShotEffectParams;
  readonly reads: readonly CompiledShotEffectRead[];
  readonly grow: number;
  readonly key: string;
};

const finiteMap = ({ ma, mb, kx, ky }: PaintSimilarity) => [ma, mb, kx, ky].every(Number.isFinite) && (ma !== 0 || mb !== 0);

/**
 * `image`'s parameters, defaults filled in, and its reads and growth, or why plane `plane` (its effect at `field`)
 * can't draw them: a parameter it doesn't take, its own check's problems, a read naming no input, more reads than
 * SHOT_EFFECT_READS_MOST, a map that isn't a finite similarity, a growth below 0. Inputs are compiled by the caller.
 */
export function shotEffectChecked(plane: string, field: string, image: ShotEffectImage): {
  readonly params: ShotEffectParams; readonly reads: readonly ShotEffectRead[]; readonly grow: number; readonly problems: readonly PaintingProblem[];
} {
  const { definition } = image, { name } = definition, problems: PaintingProblem[] = [];
  const error = (at: string, message: string) => problems.push(paintingProblem('error', plane, paintingField(field, at), `${name}: ${message}`));
  const taken = Object.keys(definition.defaults);
  for (const key of Object.keys(image.params)) if (!taken.includes(key)) error(`params.${key}`, `takes no parameter ${key}; it takes ${taken.join(', ') || 'none'}`);
  for (const input of definition.inputs) if (!(input in image.inputs)) error('inputs', `reads ${input}, which isn't given: give ${definition.inputs.join(', ')}`);
  for (const input of Object.keys(image.inputs)) if (!definition.inputs.includes(input)) error(`inputs.${input}`, `has no input ${input}; it reads ${definition.inputs.join(', ')}`);
  // SAFETY: every key given is one of the defaults' (checked above, refusing the rest), each its own check's to judge.
  const params = { ...definition.defaults, ...image.params } as ShotEffectParams;
  if (problems.length) return { params, reads: [], grow: 0, problems };
  for (const { field: at, message } of definition.problems(params)) error(`params.${at}`, message);
  if (problems.length) return { params, reads: [], grow: 0, problems };
  const reads = definition.reads(params), grow = definition.grow?.(params) ?? 0;
  if (!reads.length) error('params', 'reads nothing: an effect reads one of its inputs at least');
  if (reads.length > SHOT_EFFECT_READS_MOST) error('params', `makes ${reads.length} reads, past the ${SHOT_EFFECT_READS_MOST} one effect makes: read the output of one in another`);
  reads.forEach(({ input, map }, i) => {
    if (!definition.inputs.includes(input)) error('params', `its read ${i} names ${input}, which isn't one of its inputs (${definition.inputs.join(', ')})`);
    if (map && !finiteMap(map)) error('params', `its read ${i}'s map (${map.ma}, ${map.mb}, ${map.kx}, ${map.ky}) isn't a finite similarity that keeps a size`);
  });
  if (!(grow >= 0 && Number.isFinite(grow))) error('params', `grows its output by ${grow} px; it grows by 0 or more`);
  return { params, reads, grow, problems };
}

/** A compiled effect image from its checked parts and compiled reads: its parameters keyed with its definition's name. */
export const compiledShotEffect = (definition: ShotEffectDefinition, params: ShotEffectParams, reads: readonly CompiledShotEffectRead[], grow: number): CompiledShotEffectImage =>
  ({ kind: 'effect', definition, params, reads, grow, key: JSON.stringify([definition.name, params]) });

/** A read's map, its identity when the read gives none. */
export const shotEffectReadMap = (read: ShotEffectRead) => read.map ?? PAINT_SIMILARITY_IDENTITY;

/**
 * Where `effect`'s output can lie, plane px, given where each read's input can (`inputBox`, null: nowhere): each
 * box carried through its read's map, unioned, grown by the effect's growth. Before any clip: the stage clips it after.
 * An input is drawn within the stage, so a read carrying paint from past the stage's edge shows that edge.
 */
export function shotEffectBox(effect: CompiledShotEffectImage, inputBox: (read: CompiledShotEffectRead, index: number) => StampBox | null): StampBox | null {
  let box: StampBox | undefined;
  effect.reads.forEach((read, i) => {
    const input = inputBox(read, i);
    if (input) box = paintingBoxUnion(box, paintSimilarityBox(read.map, input));
  });
  return box ? stampBoxGrown(box, effect.grow) : null;
}

/** Whether `image` makes light of its own: an effect within it whose definition `emits`. A read may glow besides. */
export function shotEffectImageEmits(image: CompiledShotImage): boolean {
  return image.kind === 'effect' && (!!image.definition.emits || image.reads.some(({ input }) => shotEffectImageEmits(input)));
}

/** Every painted image `image` reads, through any effect, each once, in read order. */
export function shotImageLeaves(image: CompiledShotImage): CompiledShotPaintedPlane[] {
  const leaves: CompiledShotPaintedPlane[] = [];
  const visit = (at: CompiledShotImage) => {
    if (at.kind === 'painted') {
      if (!leaves.includes(at)) leaves.push(at);
      return;
    }
    for (const { input } of at.reads) visit(input);
  };
  visit(image);
  return leaves;
}

/**
 * Each painted image `image` reads and the moment maps it's read through, outermost first: a leaf read through two
 * nested reads at moments is read at the inner's map of the outer's. A painted image is its own, at the frame's moment.
 */
export function shotImageLeafReads(image: CompiledShotImage): { readonly leaf: CompiledShotPaintedPlane; readonly moments: readonly ((moment: PaintMoment) => PaintMoment)[] }[] {
  const found: { leaf: CompiledShotPaintedPlane; moments: ((moment: PaintMoment) => PaintMoment)[] }[] = [];
  const visit = (at: CompiledShotImage, moments: ((moment: PaintMoment) => PaintMoment)[]) => {
    if (at.kind === 'painted') {
      found.push({ leaf: at, moments });
      return;
    }
    for (const { input, moment } of at.reads) visit(input, moment ? [...moments, moment] : moments);
  };
  visit(image, []);
  return found;
}

/** The moment `moments` (shotImageLeafReads', outermost first) read frame moment `t` at. */
export const shotMomentMapped = (moments: readonly ((moment: PaintMoment) => PaintMoment)[], t: PaintMoment): PaintMoment =>
  moments.reduce((at, map) => map(at), t);
