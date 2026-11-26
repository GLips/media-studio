// shot-neon.ts: neon, a recipe of parts a shot can take whole or one at a time. `neonTubes` is an effect turning a
// figure's lines into glass tubes of a palette's gas colours, white-hot at the core, that emit; `flicker` is a value in
// time for the tubes' visibility; a spill throws their light on a wall. The tubes need no wall: place them anywhere an
// image goes, or read them in another effect. The tubes' glow is the lens's bloom (`camera.lens.bloom`), set apart
// from the spill's reach and gain, so each is tuned alone.

import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintHexToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { hashRandom } from '#lib/picture/motion/models/random.ts';
import { defineShotEffect, type ShotEffectImage, type ShotEffectProblem, type ShotImageSource } from './shot-effect.ts';
import { shotPlace } from './shot-figure.ts';
import { illuminate, lightSpill, type ShotLightSpill } from './shot-light-spill.ts';
import type { PlaneProps } from './shot-props.ts';

/** Neon pink, the gas a tube takes when given no palette. */
const NEON_PINK: readonly number[] = paintHexToLinear('#ff3fa4');

/** The most gas colours a tube effect takes. */
export const NEON_PALETTE_MOST = 8;

/**
 * Neon tubes' parameters: `palette`, gas colours as linear RGB, three numbers each; `width`, px a tube spreads past
 * the line it's bent along; `core`, how white-hot a tube burns where its line is solid, 0..1; `intensity`, the light
 * it emits for the lens to bloom, times its colour.
 */
export type NeonTubesParams = { readonly palette: readonly number[]; readonly width: number; readonly core: number; readonly intensity: number };

/**
 * `source`'s lines as neon tubes: each takes the palette colour nearest its paint's hue (the first for black or grey
 * paint), spreads `width` px, burns white at its core and emits. Read it in place of the figure it's made from.
 */
export const neonTubes = defineShotEffect({
  name: 'neonTubes',
  inputs: ['source'],
  emits: true,
  defaults: { palette: NEON_PINK, width: 2, core: 0.4, intensity: 2 } satisfies NeonTubesParams,
  problems: ({ palette, width, core, intensity }) => {
    const problems: ShotEffectProblem[] = [];
    if (!(palette.length >= 3 && palette.length % 3 === 0 && palette.length <= NEON_PALETTE_MOST * 3 && palette.every((v) => v >= 0 && Number.isFinite(v)))) {
      problems.push({ field: 'palette', message: `holds ${palette.length} numbers: it's 1 to ${NEON_PALETTE_MOST} linear RGB colours, three numbers each, none below 0` });
    }
    if (!(width >= 0 && width <= 8)) problems.push({ field: 'width', message: `${width} px isn't within 0..8` });
    if (!(core >= 0 && core <= 1)) problems.push({ field: 'core', message: `${core} isn't within 0..1` });
    if (!(intensity >= 0 && Number.isFinite(intensity))) problems.push({ field: 'intensity', message: `${intensity} isn't 0 or more` });
    return problems;
  },
  reads: () => [{ input: 'source' }],
  grow: ({ width }) => Math.ceil(width) + 1,
});

/**
 * A flicker: steady but for a faint buzz, dipping by up to `depth` on a `chance` share of the `rate` steps a second,
 * each step's fate drawn from `seed`. The same at a moment on every render, whatever order frames are drawn in.
 */
export type NeonFlicker = { readonly rate: number; readonly depth: number; readonly chance: number; readonly seed: number | string };

/** `flicker` as a value in time, 0..1, for the tubes' visibility. */
export function neonFlickerValue({ rate, depth, chance, seed }: NeonFlicker): (moment: PaintMoment) => number {
  return ({ at }) => {
    const step = Math.floor(at * rate), buzz = 0.03 * hashRandom('neon buzz', seed, step);
    return hashRandom('neon dip', seed, step) < chance ? 1 - depth * (0.4 + 0.6 * hashRandom('neon depth', seed, step)) : 1 - buzz;
  };
}

/** How a neon's light falls on a wall: lightSpill's reach, gain, added light and map. */
export type NeonSpill = { readonly reach: number; readonly gain?: number; readonly added?: number; readonly map?: PaintSimilarity };

/** A neon's options: its gas colours (`#rrggbb`), its tubes' look, how its light spills, and its flicker (false: steady). */
export type NeonOptions = {
  readonly palette: readonly string[];
  readonly tube?: Partial<Omit<NeonTubesParams, 'palette'>>;
  readonly spill?: NeonSpill;
  readonly flicker?: Partial<NeonFlicker> | false;
};

/**
 * A neon's parts, each plain data to read or use alone: `tubes` makes the tubes of a figure (or any image); `flicker`
 * is their visibility in time; `spill` the light a plane of them throws; `place` puts tubes on a plane flickering;
 * `light` lets a receiving plane take the light of the plane `source` placing them.
 */
export type Neon = {
  readonly tubes: (figure: ShotImageSource) => ShotEffectImage;
  readonly flicker: PresentationValue<number>;
  readonly spill: (source: string) => ShotLightSpill;
  readonly place: (figure: ShotImageSource, plane: Omit<PlaneProps, 'source'>) => PlaneProps;
  readonly light: (receiver: PlaneProps, source: string) => PlaneProps;
};

/**
 * Neon: `neon({ palette: ['#ff3fa4', '#3ff0ff'], spill: { reach: 48, gain: 6 }, flicker: { seed: 3 } })`, then
 * `sign.place(shotFigure(painting, card), { id: 'sign', depth: 1.2 })` and `sign.light(wall, 'sign')`.
 */
export function neon({ palette, tube = {}, spill = { reach: 48 }, flicker = {} }: NeonOptions): Neon {
  const params: Partial<NeonTubesParams> = { ...tube, palette: palette.flatMap(paintHexToLinear) };
  const flickering = flicker === false ? 1 : neonFlickerValue({ rate: 12, depth: 0.6, chance: 0.08, seed: 1, ...flicker });
  const tubes = (figure: ShotImageSource) => neonTubes(figure, params);
  const spillOf = (source: string) => lightSpill(source, { gain: 6, added: 0.5, ...spill });
  return {
    tubes,
    flicker: flickering,
    spill: spillOf,
    place: (figure, plane) => {
      const { visibility } = plane;
      // A plane's own visibility still fades it, under the flicker.
      const shown = visibility === undefined ? flickering : (moment: PaintMoment) => presentationValueAt(flickering, moment) * presentationValueAt(visibility, moment);
      return shotPlace(tubes(figure), { ...plane, visibility: shown });
    },
    light: (receiver, source) => illuminate(receiver, spillOf(source)),
  };
}
