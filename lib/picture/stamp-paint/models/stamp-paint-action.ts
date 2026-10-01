// stamp-paint-action.ts: what a deposit does, as written and compiled: paint, and in a wash clean water or a lift.
// Water rides on the action, so a dry pass's deposits, typed paint-only, can't carry any.

import { paintMixtureProblem } from '#lib/picture/paint/models/paint-mixture.ts';
import type { StampBlend, StampBrush } from './stamp-brush.ts';
import { jitterStampStrokeColor } from './stamp-paint-color.ts';
import { stampPaintFieldEnds, stampPaintFieldProblem, type StampPaintField } from './stamp-paint-field.ts';
import { stampMaterialKeysProblem } from './stamp-material-keys.ts';
import type { PaintMaterial, StampKeyedMaterial, StampPaintColor, StampPaintMaterial } from './stamp-paint-recipe.ts';

/** Paint as written: what a dry pass's deposits all do. */
export type StampRecipePaint = { kind: 'paint'; material: StampPaintMaterial; blend?: StampBlend; secondaryColor?: StampPaintColor; burnish?: boolean };
/** What a wash's deposit does as written: paints, carrying `water` (its medium's when left out), wets, or lifts. */
export type StampRecipeWashAction = (StampRecipePaint & { water?: number }) | { kind: 'water'; water: number } | { kind: 'lift'; strength?: number };

/**
 * Paint laid where a deposit's stamps land: its material, each colour (each key's) moved by the brush's stroke colour
 * jitter; its `secondaryColor` is none for a mixture, as a brush's colour dynamics move a colour, not pigments, and
 * none unless written for keyed colour, which then follows its colour as it changes. `burnish`: StampPaintSettings'.
 */
export type CompiledStampPaintAction = { kind: 'paint'; material: StampPaintField<StampKeyedMaterial>; secondaryColor?: StampPaintColor; burnish: boolean };

/**
 * What a wash's deposit does: paint carrying `water` (0..1; left out, its medium's PaintWetting.brushWater), clean
 * `water` wetting the paper, or a `lift` taking up paint, which carries none.
 */
export type CompiledStampAction =
  | (CompiledStampPaintAction & { water?: number })
  | { kind: 'water'; water: number }
  | { kind: 'lift'; strength: number };

const isMaterialField = (material: StampPaintMaterial): material is StampPaintField<StampKeyedMaterial> => material.kind === 'constant' || material.kind === 'linear' || material.kind === 'radial';

const materialProblem = (material: PaintMaterial) => (material.kind === 'mixture' ? paintMixtureProblem(material) : null);

/** A material, or each of its keys', mapped. */
const mapKeyedMaterial = (material: StampKeyedMaterial, map: (m: PaintMaterial) => PaintMaterial): StampKeyedMaterial => (material.kind === 'keys'
  ? { kind: 'keys', keys: material.keys.map(({ at, material: m }) => ({ at, material: map(m) })) }
  : map(material));

/** A field's values mapped, its geometry kept. */
function mapStampPaintField<T, U>(field: StampPaintField<T>, map: (value: T) => U): StampPaintField<U> {
  if (field.kind === 'constant') return { kind: 'constant', value: map(field.value) };
  if (field.kind === 'linear') return { kind: 'linear', from: { ...field.from, value: map(field.from.value) }, to: { ...field.to, value: map(field.to.value) } };
  return { ...field, inner: map(field.inner), outer: map(field.outer) };
}

/** A wash's `action` checked: its water and strength in range, its paint as compilePaintAction's. */
export function compileWashAction(full: string, action: StampRecipeWashAction, brush: StampBrush, draws: readonly number[]): CompiledStampAction {
  if (action.kind === 'lift') {
    const strength = action.strength ?? 1;
    if (!(strength >= 0 && strength <= 1)) throw new Error(`stamp paint: ${full} lifts with strength ${strength}, and a lift's is 0..1`);
    return { kind: 'lift', strength };
  }
  const { water } = action;
  if (water !== undefined && !(water >= 0 && water <= 1)) throw new Error(`stamp paint: ${full} carries ${water} water, and a brush carries 0..1`);
  if (action.kind === 'water') return { kind: 'water', water: action.water };
  return { ...compilePaintAction(full, action, brush, draws), ...(water !== undefined && { water }) };
}

/** Paint as written checked, its colours moved by the brush's stroke colour jitter from `draws`. */
export function compilePaintAction(full: string, action: StampRecipePaint, brush: StampBrush, draws: readonly number[]): CompiledStampPaintAction {
  const field = isMaterialField(action.material) ? action.material : { kind: 'constant' as const, value: action.material };
  const problem = stampPaintFieldProblem(field, (end) => (end.kind === 'keys' ? stampMaterialKeysProblem(end, materialProblem) : materialProblem(end)));
  if (problem) throw new Error(`stamp paint: ${full}'s material can't be painted: ${problem}`);
  const material = mapStampPaintField(field, (end) => mapKeyedMaterial(end, (m) => (m.kind === 'color' && brush.color ? { kind: 'color', color: jitterStampStrokeColor(m.color, brush.color.stroke, draws) } : m)));
  const { first } = stampPaintFieldEnds(field);
  const colour = first.kind === 'keys' ? first.keys[0].material.kind === 'color' : first.kind === 'color';
  const secondaryColor = colour ? action.secondaryColor ?? (first.kind === 'color' ? first.color : undefined) : undefined;
  return { kind: 'paint', material, ...(secondaryColor && { secondaryColor }), burnish: action.burnish ?? false };
}
