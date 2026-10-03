// paint-rig-cuts.ts: a painted layer, one whole painting at rest, divided among the parts cut from it, purely: each
// texel owned wholly by one part, so the parts tile the layer and recompose it exactly at rest. How a painter's drawn
// regions become that ownership is the painting tool's (the paint session's); a rig reads it back from masks.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * A texel grid in the layer's px, the space its regions and pivots are given in: texel (i, j) covers x0 + i … x0 + i + 1,
 * y0 + j … y0 + j + 1.
 */
export type PaintRigTexelBox = { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number };

/**
 * A part as it's declared cut from a layer: its draw order and, below the root, its parent by id and how it meets it
 * there, at its rest `pivot`: a skin joint blending the two parts' moves over `blend` px, or a hinge.
 */
export type PaintRigCutDeclaration = { readonly id: string; readonly z: number } & (
  | { readonly parent: null }
  | { readonly parent: string; readonly joint: 'skin'; readonly pivot: StampPoint; readonly blend: number }
  | { readonly parent: string; readonly joint: 'hinge'; readonly pivot: StampPoint });

/**
 * How a part meets its parent within its layer, the parent an index into the layer's parts. `loose`: its parent isn't
 * cut from this layer (or it has none), so it starts a group of its own here, as a root does.
 */
export type PaintRigCutJoint =
  | { readonly kind: 'loose' }
  | { readonly kind: 'skin'; readonly parent: number; readonly pivot: StampPoint; readonly blend: number }
  | { readonly kind: 'hinge'; readonly parent: number; readonly pivot: StampPoint };

/** A part as its layer's cuts know it. */
export type PaintRigCutPart = { readonly id: string; readonly z: number; readonly joint: PaintRigCutJoint };

/**
 * A layer's cuts: `parts` cut from it; `owner` each texel's part (an index into `parts`, -1 none); `matte` the
 * layer's coverage; `overlaps` each hinge part's extra texels past its joint, taken from its parent's.
 */
export type PaintRigCutLayer = {
  readonly id: string; readonly box: PaintRigTexelBox; readonly parts: readonly PaintRigCutPart[];
  readonly owner: Int16Array; readonly matte: Float32Array; readonly overlaps: ReadonlyMap<number, Uint8Array>;
};

/** `declared`, one layer's parts in order, with each parent found among them. */
export function paintRigCutParts(declared: readonly PaintRigCutDeclaration[]): PaintRigCutPart[] {
  const index = new Map(declared.map((part, k) => [part.id, k]));
  return declared.map((part): PaintRigCutPart => {
    const { id, z } = part, parent = part.parent === null ? undefined : index.get(part.parent);
    if (!('joint' in part) || parent === undefined) return { id, z, joint: { kind: 'loose' } };
    if (part.joint === 'skin') return { id, z, joint: { kind: 'skin', parent, pivot: part.pivot, blend: part.blend } };
    return { id, z, joint: { kind: 'hinge', parent, pivot: part.pivot } };
  });
}
