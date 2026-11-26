// shot-light-spill.ts: light one plane throws onto another, as plain data. A spill is its source plane's emission as
// it lies (visibility and flicker included), blurred by `reach`, carried into the receiver's px, where it
// changes the receiver's colour in linear light and never its emission: a lit wall doesn't bloom. The source's own
// glow is the lens's bloom.
//
// The identity map holds a spill where the frame shows its source at rest (every plane's px are frame px then), so it
// stays on the receiver as the camera moves, following the source's lay. A three receiver takes it in frame px
// as if flat at its depth: a screen-space approximation. A source that doesn't emit throws no light.

import type { PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PlaneProps } from './shot-props.ts';

/**
 * Light plane `source` throws onto the plane it's given to: its emission blurred by a gaussian of `reach` px, then on
 * the receiver its paint's light times 1 + `gain`·E, plus `added`·E where it covers. `map` takes source plane px to the
 * receiver's (left out: the identity, where the frame shows the source at rest).
 */
export type ShotLightSpill = {
  readonly kind: 'light-spill';
  readonly source: string;
  readonly reach: number;
  readonly gain: number;
  readonly added: number;
  readonly map?: PaintSimilarity;
};

/** The most spills one plane receives: each binds its own light in the pass that lays them. */
export const SHOT_LIGHT_SPILLS_MOST = 4;

/** The widest reach a spill takes, px: its light is blurred over a box grown by three times it. */
export const SHOT_LIGHT_SPILL_REACH_MOST = 512;

/**
 * Light plane `source` throws, to give `illuminate`: `lightSpill('sign', { reach: 48, gain: 6, added: 0.5 })`. `reach`
 * (sigma, px) is how far it spreads; `gain`, how strongly the receiver's paint reflects it; `added`, light laid over
 * what the receiver covers whatever its colour (a sheen, a haze); `map`, source plane px to the receiver's.
 */
export function lightSpill(source: string, { reach, gain = 1, added = 0, map }: { readonly reach: number; readonly gain?: number; readonly added?: number; readonly map?: PaintSimilarity }): ShotLightSpill {
  return { kind: 'light-spill', source, reach, gain, added, ...(map && { map }) };
}

/** `receiver` lit by `spills` as well as any it's lit by already: a plane of any kind, the back included. */
export const illuminate = (receiver: PlaneProps, ...spills: readonly ShotLightSpill[]): PlaneProps => ({ ...receiver, spills: [...(receiver.spills ?? []), ...spills] });

const finite = (value: number) => Number.isFinite(value);

/**
 * Why plane `receiver`'s `spills` can't be drawn, `kindOf` giving each plane's kind by id (undefined: no plane of the
 * shot): too many; a source that's no painted or effect plane, or the receiver itself; a reach outside
 * 0..SHOT_LIGHT_SPILL_REACH_MOST; a gain or added light below 0; a map that isn't a finite similarity.
 */
export function shotLightSpillProblems(receiver: string, spills: readonly ShotLightSpill[], kindOf: (id: string) => string | undefined): PaintingProblem[] {
  const problems: PaintingProblem[] = [], error = (field: string, message: string) => problems.push(paintingProblem('error', receiver, field, message));
  if (spills.length > SHOT_LIGHT_SPILLS_MOST) error('spills', `takes ${spills.length} spills, past the ${SHOT_LIGHT_SPILLS_MOST} one plane receives: light it from an effect gathering the sources`);
  spills.forEach(({ source, reach, gain, added, map }, i) => {
    const at = `spills[${i}]`, kind = kindOf(source);
    if (source === receiver) error(`${at}.source`, 'is the plane it lights: a plane throws no light on itself');
    else if (kind === undefined) error(`${at}.source`, `names ${source}, which is no plane of this shot`);
    else if (kind !== 'painted' && kind !== 'effect') error(`${at}.source`, `names ${source}, a ${kind} plane: light is thrown by a painted or effect plane's emission`);
    if (!(reach > 0 && reach <= SHOT_LIGHT_SPILL_REACH_MOST)) error(`${at}.reach`, `${reach} px isn't a reach above 0 and at most ${SHOT_LIGHT_SPILL_REACH_MOST}`);
    if (!(gain >= 0 && finite(gain))) error(`${at}.gain`, `${gain} isn't a gain of 0 or more`);
    if (!(added >= 0 && finite(added))) error(`${at}.added`, `${added} isn't added light of 0 or more`);
    if (map && !([map.ma, map.mb, map.kx, map.ky].every(finite) && (map.ma !== 0 || map.mb !== 0))) error(`${at}.map`, `(${map.ma}, ${map.mb}, ${map.kx}, ${map.ky}) isn't a finite similarity that keeps a size`);
  });
  return problems;
}
