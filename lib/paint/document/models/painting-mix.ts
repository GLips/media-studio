// painting-mix.ts: a document's mix as the engine's mixture, the one place a hex part becomes a pigment: the compile
// lays it, the mix check mixes it and a layer's slots count it.

import { paintColorPigmentId } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMixture } from '#lib/paint/materials/models/paint-mixture.ts';
import type { PaintMixturePigment } from '#lib/paint/materials/models/paint-pigment.ts';
import { stampPaintFieldEnds } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { Field, Hex, Mix, MixPart } from './painting-document.ts';

/** Whether a part's pigment is a hex, a colour standing for a pigment of its own, rather than a named appearance. */
export const isPaintingHexPigment = (pigment: MixPart['pigment']): pigment is Hex => typeof pigment === 'string';

/** A part's pigment as the engine's mixture reads it: a hex is a pigment of its own (`color:#rrggbb`), fitted as its medium fits a colour. */
export const paintingPartPigment = (pigment: MixPart['pigment']): PaintMixturePigment =>
  (isPaintingHexPigment(pigment) ? { color: pigment, id: paintColorPigmentId(pigment), name: pigment } : pigment);

/** `mix` as the engine's mixture. */
export const paintingMixture = ({ parts, strength }: Mix): PaintMixture => ({ parts: parts.map(({ pigment, amount }) => ({ pigment: paintingPartPigment(pigment), amount })), strength });

/** The mixes a charge's mix, constant or a field, names: a field's two ends. */
export function paintingFieldMixes(mix: Mix | Field<Mix>): readonly Mix[] {
  if ('parts' in mix) return [mix];
  const { first, second } = stampPaintFieldEnds(mix);
  return [first, second];
}

/** Every pigment a charge's mix names, as a mixture names it. */
export function paintingMixPigments(mix: Mix | Field<Mix>): PaintMixturePigment[] {
  return paintingFieldMixes(mix).flatMap(({ parts }) => parts.map(({ pigment }) => paintingPartPigment(pigment)));
}
