// stamp-outside-layer.ts: an outside layer, a slot in a painting's group order whose pixels someone else renders each
// frame (a three.js scene, paint/three-layers), laid like a group: over the groups before it, under those after. Its
// pixels arrive as a texture on the renderer's device, stage-sized, linear light, premultiplied.
//
// Declared beside the painting, not in it: a compiled painting is pure paint, the same with or without a 3D layer set
// into it, and an outside layer has no passes, marks, boil or wetness for the painting's compilers to skip. Its slot
// names the painted group it lies beneath.

import type { StampGroupFrameState } from './stamp-paint-frame-state.ts';
import type { CompiledStampPaint } from './stamp-paint-recipe-compile.ts';

/** Where an outside layer lies: beneath painted group `beneath` (its id), or over every group when `beneath` is null. */
export type StampOutsideLayerSlot = { id: string; beneath: string | null };

/**
 * An outside layer's state for one frame: `content` names its pixels (equal keys, equal pixels: the checkpoints after
 * it are held under it), and it takes a group's visibility, defocus and glow.
 */
export type StampOutsideLayerState = Pick<StampGroupFrameState, 'visibility' | 'defocus' | 'glow'> & { content: string };

/** Each outside layer's state by its id. Every declared outside layer needs one, every frame. */
export type StampOutsideFrameState = ReadonlyMap<string, StampOutsideLayerState>;

/**
 * An outside layer placed in the order: laid just before group `groupIndex` (the painting's group count: after them
 * all), so a checkpoint after `event` events holds it when it's laid before then; `slot` its index as declared.
 */
export type StampOutsideLayerPlace = { id: string; slot: number; groupIndex: number };

/**
 * `slots` placed in `painting`'s order, checked: ids unique and none a group's, each `beneath` a group the painting
 * has. Two slots beneath one group are laid in the order declared.
 */
export function stampOutsideLayerPlaces(painting: CompiledStampPaint, slots: readonly StampOutsideLayerSlot[]): StampOutsideLayerPlace[] {
  const groupIds = painting.groups.map((group) => group.id), seen = new Set<string>();
  return slots.map(({ id, beneath }, slot) => {
    if (groupIds.includes(id)) throw new Error(`stamp paint: outside layer ${id} has a painted group's id`);
    if (seen.has(id)) throw new Error(`stamp paint: two outside layers are called ${id}`);
    seen.add(id);
    const groupIndex = beneath === null ? groupIds.length : groupIds.indexOf(beneath);
    if (groupIndex < 0) throw new Error(`stamp paint: outside layer ${id} lies beneath ${beneath}, which the painting has no group of`);
    return { id, slot, groupIndex };
  });
}
