// model-guides.ts: what a model guide holds, a model's surface seen through a shot camera, one float image per
// target, rendered on the GPU (model-guide-render.ts) and read back. CPU consumers (the model painter's tracing, a
// measurement) read these channels; they never rasterise the mesh again.
//
// Fixed channels (MODEL_GUIDE_FIXED_SLOTS), then region fields four to a target. `rest` is the mesh's position before
// skinning or morphs; `depth` is along the camera's view; `object` is the id the request gave the mesh seen, from 1. Texel
// (i, j) is the frame point (i + 0.5, j + 0.5), rows from the top. Where no mesh is, every channel is 0.

import type { FrameSize } from '#lib/picture/frame/models/frame.ts';

/** The largest id a guide's `object` channel holds: a float32 holds every whole number up to 2^24 exactly. */
export const MODEL_GUIDE_MAX_MESH_ID = 2 ** 24;

/** Floats in a texel of every target: rgba32float. */
export const MODEL_GUIDE_TEXEL_FLOATS = 4;
/** Bytes a texel of one target holds, against a device's maxColorAttachmentBytesPerSample. */
export const MODEL_GUIDE_TEXEL_BYTES = MODEL_GUIDE_TEXEL_FLOATS * 4;

/** Where a channel sits: its target, and its first component in a texel there. */
export type ModelGuideSlot = { readonly target: number; readonly offset: number };

export type ModelGuideFixedChannel = 'normal' | 'facing' | 'rest' | 'depth' | 'object';

/** The fixed channels' slots; normal and rest are three wide, the rest one. */
export const MODEL_GUIDE_FIXED_SLOTS: Readonly<Record<ModelGuideFixedChannel, ModelGuideSlot>> = {
  normal: { target: 0, offset: 0 }, facing: { target: 0, offset: 3 },
  rest: { target: 1, offset: 0 }, depth: { target: 1, offset: 3 },
  object: { target: 2, offset: 0 },
};

/** The fields target that holds `object` first and the regions after it. */
const FIRST_FIELDS_TARGET = MODEL_GUIDE_FIXED_SLOTS.object.target;

/**
 * A guide's shape: its region fields in order, and its targets' names (each an MRT output and a render target
 * texture). Regions are named as the vertex attributes that carry them, so a name is a shader identifier.
 */
export type ModelGuideLayout = { readonly regions: readonly string[]; readonly targets: readonly string[] };

const REGION_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** The layout of a guide carrying `regions`, each a vertex attribute of that name on every mesh the guide sees. */
export function modelGuideLayout(regions: readonly string[]): ModelGuideLayout {
  const bad = regions.find((name) => !REGION_NAME.test(name));
  if (bad !== undefined) throw new Error(`model guides: a region is named as a vertex attribute, letters and digits from a letter, not "${bad}"`);
  if (new Set(regions).size !== regions.length) throw new Error(`model guides: regions are named once each, not ${regions.join(', ')}`);
  const fieldsTargets = Math.ceil((1 + regions.length) / MODEL_GUIDE_TEXEL_FLOATS);
  return { regions: [...regions], targets: ['surface', 'place', ...Array.from({ length: fieldsTargets }, (_, k) => `fields${k}`)] };
}

/** Where region `name` sits in a guide of `layout`. */
export function modelGuideRegionSlot(layout: ModelGuideLayout, name: string): ModelGuideSlot {
  const k = layout.regions.indexOf(name);
  if (k < 0) throw new Error(`model guides: this guide carries regions ${layout.regions.join(', ') || '(none)'}, not "${name}"`);
  return { target: FIRST_FIELDS_TARGET + Math.floor((1 + k) / MODEL_GUIDE_TEXEL_FLOATS), offset: (1 + k) % MODEL_GUIDE_TEXEL_FLOATS };
}

/**
 * The layout's targets split into render passes of at most `perPass` targets each (a device's colour attachments,
 * or its bytes per sample over MODEL_GUIDE_TEXEL_BYTES, whichever is fewer): each pass draws the meshes again.
 */
export function modelGuidePasses(layout: ModelGuideLayout, perPass: number): number[][] {
  if (!(perPass >= 1)) throw new Error(`model guides: a pass writes at least one target, not ${perPass}`);
  const indices = layout.targets.map((_, k) => k);
  return Array.from({ length: Math.ceil(indices.length / perPass) }, (_, p) => indices.slice(p * perPass, (p + 1) * perPass));
}

/** A model's guide as read back: per layout target, `frame.width × frame.height` texels of four floats, row by row. */
export type ModelGuides = { readonly frame: FrameSize; readonly layout: ModelGuideLayout; readonly targets: readonly Float32Array[] };

/** A channel in place: texel `i`'s component `k` of it is `data[i * MODEL_GUIDE_TEXEL_FLOATS + offset + k]`. */
export type ModelGuideChannelView = { readonly data: Float32Array; readonly offset: number };

const viewOf = (guides: ModelGuides, { target, offset }: ModelGuideSlot): ModelGuideChannelView => ({ data: guides.targets[target], offset });

/** A fixed channel of `guides`, in place. */
export const modelGuideChannel = (guides: ModelGuides, channel: ModelGuideFixedChannel) => viewOf(guides, MODEL_GUIDE_FIXED_SLOTS[channel]);

/** Region `name`'s field in `guides`, in place. */
export const modelGuideRegion = (guides: ModelGuides, name: string) => viewOf(guides, modelGuideRegionSlot(guides.layout, name));

/**
 * The texels (inclusive, i across and j down) holding mesh `object` (any mesh unless given), or null where none
 * does: a tracer crops to it before contouring the frame's few covered texels.
 */
export function modelGuideCoverageBox(guides: ModelGuides, object?: number): { i0: number; j0: number; i1: number; j1: number } | null {
  const { data, offset } = modelGuideChannel(guides, 'object'), { width, height } = guides.frame;
  let i0 = width, j0 = height, i1 = -1, j1 = -1;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const seen = data[(j * width + i) * MODEL_GUIDE_TEXEL_FLOATS + offset];
      if (object === undefined ? seen === 0 : seen !== object) continue;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
  }
  return i1 < 0 ? null : { i0, j0, i1, j1 };
}
