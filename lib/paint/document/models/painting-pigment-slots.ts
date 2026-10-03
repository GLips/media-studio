// painting-pigment-slots.ts: how a layer's film is laid out: its palette, every pigment its paint lays in first-use
// order (a hex a pigment of its own, the medium's white where it lightens a mix below full strength), as the engine
// fits a group's palette (stamp-pigment-paint.ts), and the four-channel layers holding them. A pigment added late in
// a layer changes the layout its first application is solved in, so the evaluation diff reads it there.

import { paintColorPigmentId, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampPaintFieldEnds } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { stampPigmentLayers } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { AnyApplication, Field, Layer, Mix, MixPart } from './painting-document.ts';

/**
 * A layer's film layout: `palette`, pigment ids a slot each; `paintLayers`, the four-channel layers holding coverage,
 * a channel per slot and, when it keeps a wet history, its open share in channel `open` (null when it doesn't).
 */
export type PaintingPigmentSlots = { readonly palette: readonly string[]; readonly paintLayers: number; readonly open: number | null };

/** A part's pigment by id: an appearance's own, or a hex's `color:#rrggbb`. */
const paintingPigmentId = (pigment: MixPart['pigment']) => (typeof pigment === 'string' ? paintColorPigmentId(pigment) : pigment.id);

/** The pigment ids one mix lays in `medium`, sorted by id as the engine's mixture components are. */
function mixPigmentIds({ parts, strength }: Mix, medium: PaintMedium): string[] {
  const ids = parts.filter(({ amount }) => amount > 0).map(({ pigment }) => paintingPigmentId(pigment));
  const { lightening } = medium;
  if (lightening.kind === 'white' && strength < 1 && !ids.includes(lightening.white.id)) ids.push(lightening.white.id);
  return ids.toSorted((a, b) => a.localeCompare(b, 'en'));
}

/** The pigment ids a charge's mix lays in `medium`, in first-use order: a field's first end's, then its second's. */
function paintingMixPigmentIds(mix: Mix | Field<Mix>, medium: PaintMedium): string[] {
  if ('parts' in mix) return mixPigmentIds(mix, medium);
  const { first, second } = stampPaintFieldEnds(mix);
  return [...new Set([...mixPigmentIds(first, medium), ...mixPigmentIds(second, medium)])];
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
  const wet = layer.washes.some((wash) => wash.wetHistory !== false), paintLayers = stampPigmentLayers(palette.size, wet);
  return { palette: [...palette], paintLayers, open: wet ? 4 * paintLayers - 1 : null };
}
