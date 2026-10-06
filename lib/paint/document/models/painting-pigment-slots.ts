// painting-pigment-slots.ts: how a layer's film is laid out: its palette, every pigment its paint lays in first-use
// order (a hex a pigment of its own, the medium's white where it lightens a mix below full strength), as the engine
// fits a group's palette (stamp-pigment-paint.ts), and the four-channel layers holding them. A pigment added late in
// a layer changes the layout its first application is solved in, so the evaluation diff reads it there.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampPigmentLayers } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { AnyApplication, Field, Layer, Mix, Wash } from './painting-document.ts';
import { paintingFieldMixes, paintingPartPigment } from './painting-mix.ts';

/**
 * A layer's film layout: `palette`, pigment ids a slot each; `paintLayers`, the four-channel layers holding coverage,
 * a channel per slot and, when it keeps a wet history or lifts, its open share in channel `open` (null when neither).
 */
export type PaintingPigmentSlots = { readonly palette: readonly string[]; readonly paintLayers: number; readonly open: number | null };

/** The pigment ids one mix lays in `medium`, sorted by id as the engine's mixture components are. */
function mixPigmentIds({ parts, strength }: Mix, medium: PaintMedium): string[] {
  const ids = parts.filter(({ amount }) => amount > 0).map(({ pigment }) => paintingPartPigment(pigment).id);
  const { lightening } = medium;
  if (lightening.kind === 'white' && strength < 1 && !ids.includes(lightening.white.id)) ids.push(lightening.white.id);
  return ids.toSorted((a, b) => a.localeCompare(b, 'en'));
}

/** The pigment ids a charge's mix lays in `medium`, in first-use order: a field's first end's, then its second's. */
const paintingMixPigmentIds = (mix: Mix | Field<Mix>, medium: PaintMedium): string[] =>
  [...new Set(paintingFieldMixes(mix).flatMap((end) => mixPigmentIds(end, medium)))];

/**
 * Whether `wash` lifts. A lift takes up what the paper holds through its wetness (stampDepositionLaw), an eraser in a
 * direct wash too, so its film keeps the open share and its wash compiles `lifts` (StampSheetWash), mixed as a wash.
 */
export function paintingWashLifts(wash: Wash): boolean {
  const applications: readonly AnyApplication[] = wash.applications;
  return applications.some(({ charge }) => charge.kind === 'lift');
}

/**
 * `layer`'s film layout in `medium`, its applications read in document order (its sheet's order, within one layer).
 * Expects mixes that are checked.
 */
export function paintingLayerSlots(layer: Layer, medium: PaintMedium): PaintingPigmentSlots {
  const palette = new Set<string>();
  for (const wash of layer.washes) {
    const applications: readonly AnyApplication[] = wash.applications;
    for (const { charge } of applications) {
      if (charge.kind === 'paint') for (const id of paintingMixPigmentIds(charge.mix, medium)) palette.add(id);
    }
  }
  const wet = layer.washes.some((wash) => wash.wetHistory !== false || paintingWashLifts(wash)), paintLayers = stampPigmentLayers(palette.size, wet);
  return { palette: [...palette], paintLayers, open: wet ? 4 * paintLayers - 1 : null };
}
