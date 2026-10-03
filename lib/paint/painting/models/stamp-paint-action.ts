// stamp-paint-action.ts: what a deposit does, as written and compiled: paint, and in a wash clean water or a lift.
// Stated water rides on the action, so a dry pass's deposits, typed paint-only, can't state any; each deposit's water,
// stated or its medium's, is resolved once as it compiles in its medium (stampDepositWater).

import { paintMixtureProblem } from '#lib/paint/materials/models/paint-mixture.ts';
import { checkPaintCapability, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampBlend, StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { jitterStampStrokeColor } from './stamp-paint-color.ts';
import { stampPaintFieldEnds, stampPaintFieldProblem, stampSeededPaintField, type StampPaintField, type StampSeededPaintField } from './stamp-paint-field.ts';
import { compileStampMaterialKeys, stampMaterialKeysProblem, type CompiledStampMaterialKeys, type StampMaterialKey } from './stamp-material-keys.ts';
import { everyStampKey, mapStampKeyList } from './stamp-scene-keys.ts';
import type { CompiledStampKeyedMaterial, StampKeyedMaterial, StampPaintMaterial } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';

/** Paint as written: what a dry passage's deposits all do. */
export type StampRecipePaint = { kind: 'paint'; material: StampPaintMaterial; blend?: StampBlend; secondaryColor?: StampPaintColor; burnish?: boolean };
/** What a wet passage's deposit does as written: paints, carrying `water` (its medium's when left out), wets, or lifts. */
export type StampRecipeWashAction = (StampRecipePaint & { water?: number }) | { kind: 'water'; water: number } | { kind: 'lift'; strength?: number };

/**
 * Paint laid where a deposit's stamps land: each colour (each key's) jittered by the brush's stroke colour jitter,
 * then eased between keys, as pigment fits each key's colour while compiling. `secondaryColor`: as written, else a
 * colour material's own unjittered colour, keyed with it; none for a mixture (colour dynamics move a colour).
 */
export type CompiledStampPaintAction = {
  kind: 'paint'; material: StampSeededPaintField<CompiledStampKeyedMaterial>; secondaryColor?: StampPaintColor | CompiledStampMaterialKeys<StampPaintColor>; burnish: boolean;
};

/**
 * What a wash's deposit does: paint carrying `water` as written (0..1; left out, its medium's, which stampDepositWater
 * resolves), clean `water` wetting the paper, or a `lift` taking up paint, which carries none.
 */
export type CompiledStampAction =
  | (CompiledStampPaintAction & { water?: number })
  | { kind: 'water'; water: number }
  | { kind: 'lift'; strength: number };

/** Flat colour's water: in no medium its paint is wet, so a flood of it stops at its water's edge (wetLandCover). */
const STAMP_FLAT_COLOUR_WATER = 1;

/** What a deposit's water is read from: what it does, and the water it states. */
export type StampDepositWaterAction = { readonly kind: CompiledStampAction['kind']; readonly water?: number };

/**
 * How wet a deposit doing `action` through a brush of `media` leaves the paper it touches, 0..1, in `medium` (null:
 * flat colour): a lift's none, a dry brush's paint none (crayon, a dry-brush drag), else the water it states or the
 * medium's defaultWater. Unchecked: stampDepositWater refuses what can't carry water.
 */
export function stampDepositWetness(action: StampDepositWaterAction, media: StampBrush['media'], medium: PaintMedium | null): number {
  if (action.kind === 'lift' || (action.kind === 'paint' && media === 'dry')) return 0;
  return action.water ?? (medium ? medium.wetting.defaultWater : STAMP_FLAT_COLOUR_WATER);
}

/**
 * How wet `deposit` leaves the paper its brush touches (stampDepositWetness), resolved once as it compiles in `medium`,
 * refusing water stated through a dry brush's paint, or in a medium without 'water'. 0 is none.
 */
export function stampDepositWater(
  { id, action, brush }: { id: string; action: CompiledStampAction; brush: Pick<StampBrush, 'media'> }, medium: PaintMedium | null,
): number {
  const water = stampDepositWetness(action, brush.media, medium);
  if (action.kind === 'lift' || action.water === undefined) return water;
  if (action.kind === 'paint' && brush.media === 'dry') throw new Error(`stamp paint: ${id} states water, but its brush is dry and carries none`);
  checkPaintCapability(medium, 'water', `${id}'s water`);
  return water;
}

const isMaterialField = (material: StampPaintMaterial): material is StampPaintField<StampKeyedMaterial> => material.kind === 'constant' || material.kind === 'linear' || material.kind === 'radial' || material.kind === 'noise';

const materialProblem = (material: PaintMaterial) => (material.kind === 'mixture' ? paintMixtureProblem(material) : null);

/** A material, or each of its keys', mapped, its keys compiled. */
const compileKeyedMaterial = (material: StampKeyedMaterial, map: (m: PaintMaterial) => PaintMaterial): CompiledStampKeyedMaterial =>
  (material.kind === 'keys' ? compileStampMaterialKeys(material, map) : map(material));

const isColorKey = (key: StampMaterialKey<PaintMaterial>): key is StampMaterialKey<Extract<PaintMaterial, { kind: 'color' }>> => key.material.kind === 'color';

/** A colour material's own colour, keyed alongside it; none if any of it is a mixture. */
function ownColor(material: CompiledStampKeyedMaterial): StampPaintColor | CompiledStampMaterialKeys<StampPaintColor> | undefined {
  if (material.kind !== 'keys') return material.kind === 'color' ? material.color : undefined;
  const { keys } = material;
  if (!everyStampKey(keys, isColorKey)) return undefined;
  return { kind: 'keys', keys: mapStampKeyList(keys, ({ at, material: m }) => ({ at, material: m.color })) };
}

/** A field's values mapped, its geometry kept. */
function mapStampPaintField<T, U>(field: StampSeededPaintField<T>, map: (value: T) => U): StampSeededPaintField<U> {
  if (field.kind === 'constant') return { kind: 'constant', value: map(field.value) };
  if (field.kind === 'linear') return { kind: 'linear', from: { ...field.from, value: map(field.from.value) }, to: { ...field.to, value: map(field.to.value) } };
  if (field.kind === 'noise') return { ...field, a: map(field.a), b: map(field.b) };
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

/**
 * Paint as written checked, its colours moved by the brush's stroke colour jitter from `draws`, a noise material seeded
 * by deposit `full` unless it names its passage.
 */
export function compilePaintAction(full: string, action: StampRecipePaint, brush: StampBrush, draws: readonly number[]): CompiledStampPaintAction {
  const field = stampSeededPaintField(isMaterialField(action.material) ? action.material : { kind: 'constant' as const, value: action.material }, full);
  const problem = stampPaintFieldProblem(field, (end) => (end.kind === 'keys' ? stampMaterialKeysProblem(end, materialProblem) : materialProblem(end)));
  if (problem) throw new Error(`stamp paint: ${full}'s material can't be painted: ${problem}`);
  const material = mapStampPaintField(field, (end) => compileKeyedMaterial(end, (m) => (m.kind === 'color' && brush.color ? { kind: 'color', color: jitterStampStrokeColor(m.color, brush.color.stroke, draws) } : m)));
  const own = ownColor(compileKeyedMaterial(stampPaintFieldEnds(field).first, (m) => m));
  const secondaryColor = own && (action.secondaryColor ?? own);
  return { kind: 'paint', material, ...(secondaryColor && { secondaryColor }), burnish: action.burnish ?? false };
}
