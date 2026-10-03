// paint-rig-cel-layer.ts: parts painted whole on cels of their own, laid as one layer so skin joints can bend across
// them (paint-rig-skin.ts) as they bend across a layer's cuts. Each cel keeps its place in the z order inside the
// layer, so paint the painter tucked under a neighbour stays under it, bent.

import { paintRigCutParts, type PaintRigCutDeclaration, type PaintRigCutLayer } from './paint-rig-cuts.ts';
import type { PaintRigPicture } from './paint-rig-pieces.ts';

/** A part painted whole on a cel of its own: how it's declared in the layer, and its rest cel. */
export type PaintRigCelPart = { readonly declaration: PaintRigCutDeclaration; readonly picture: PaintRigPicture };

/**
 * `cels` laid as layer `id`: its picture the cels over one another by z (ties in the order given), each texel owned by
 * the topmost cel painting it, the matte their coverage together.
 */
export function paintRigCelLayer(id: string, cels: readonly PaintRigCelPart[]): { picture: PaintRigPicture; cuts: PaintRigCutLayer } {
  const painted = cels.filter(({ picture }) => picture.w > 0);
  if (!painted.length) throw new Error(`paint rig: layer ${id}'s cels are all clear`);
  const x0 = Math.min(...painted.map(({ picture }) => picture.x0)), y0 = Math.min(...painted.map(({ picture }) => picture.y0));
  const w = Math.max(...painted.map(({ picture }) => picture.x0 + picture.w)) - x0, h = Math.max(...painted.map(({ picture }) => picture.y0 + picture.h)) - y0;
  const rgba = new Float32Array(w * h * 4), owner = new Int16Array(w * h).fill(-1), matte = new Float32Array(w * h);
  const backToFront = cels.map((cel, k) => ({ ...cel, k })).toSorted((a, b) => a.declaration.z - b.declaration.z);
  for (const { picture, k } of backToFront) {
    for (let j = 0; j < picture.h; j++) for (let i = 0; i < picture.w; i++) {
      const from = 4 * (j * picture.w + i), a = picture.rgba[from + 3];
      if (a <= 0) continue;
      const t = (picture.y0 - y0 + j) * w + picture.x0 - x0 + i, keep = 1 - a;
      for (let c = 0; c < 4; c++) rgba[4 * t + c] = picture.rgba[from + c] + rgba[4 * t + c] * keep;
      owner[t] = k;
      matte[t] = rgba[4 * t + 3];
    }
  }
  const box = { x0, y0, w, h };
  return { picture: { ...box, rgba }, cuts: { id, box, parts: paintRigCutParts(cels.map(({ declaration }) => declaration)), owner, matte, overlaps: new Map() } };
}

/**
 * The chains of cel parts joined by skin among `parts`, each by its root (the first up the chain not `skinned` to its
 * parent) and listing it first, then its skinned parts in the order given.
 */
export function paintRigCelSkinChains<P extends { readonly id: string; readonly parent: string | null }>(parts: readonly P[], skinned: (part: P) => boolean): Map<P, P[]> {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const rootOf = (part: P): P => {
    const parent = part.parent === null ? undefined : byId.get(part.parent);
    return skinned(part) && parent ? rootOf(parent) : part;
  };
  const chains = new Map<P, P[]>();
  for (const part of parts.filter(skinned)) {
    const root = rootOf(part);
    if (root !== part) chains.set(root, [...(chains.get(root) ?? [root]), part]);
  }
  return chains;
}
