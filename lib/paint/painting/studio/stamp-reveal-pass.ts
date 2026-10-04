// stamp-reveal-pass.ts: a film's reveals as one cut over its layer target, the share of its finished paint each texel
// shows (stamp-reveal.ts). A lay takes each texel's opacity times it before compositing, so a reveal cuts pigment
// before it becomes colour; an own sheet's edge joins its films' coverage cut alike, so its card follows its paint.
//
// A strokes reveal's arrivals are drawn once into a map (rgba32float: first, cover, full, seconds per px), kept in the
// device's cache under the reveal, where it lies and the texels it covers; each cut reads the map at its time. A
// field's arrivals are read where they're needed, no map.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import { STAMP_REST_POINT_WGSL } from '../models/stamp-rest-map.ts';
import {
  STAMP_REVEAL_ARRIVAL_WGSL, STAMP_REVEAL_SEGMENT_FLOATS, STAMP_REVEAL_TILE, STAMP_REVEAL_WGSL, stampRevealKey, stampRevealSegments, stampRevealTiles,
  type StampReveal, type StampRevealLink,
} from '../models/stamp-reveal.ts';
import { stampStageTexelsWithin, stampStageWgsl, type StampStage, type StampWrapPeriods } from '../models/stamp-stage.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { dispatchStampCompute, STAMP_WORKGROUP, stampPaintBuffer, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

const ARRIVAL = gpuUniformLayout('RevealArrival', [['origin', 'vec2u'], ['extent', 'vec2u'], ['columns', 'u32']]);
// Each texel's arrival over the segments its tile lists: texel `origin` + id of the layer target.
const arrivalWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_REVEAL_WGSL}
${ARRIVAL.wgsl}
@group(0) @binding(0) var<uniform> u: RevealArrival;
@group(0) @binding(1) var<storage, read> segments: array<vec4f>;
@group(0) @binding(2) var<storage, read> spans: array<u32>;
@group(0) @binding(3) var<storage, read> listed: array<u32>;
@group(0) @binding(4) var arrival: texture_storage_2d<rgba32float, write>;
${STAMP_REVEAL_ARRIVAL_WGSL}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn revealArrival(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let tile = id.xy / ${STAMP_REVEAL_TILE}u;
  let t = tile.y * u.columns + tile.x;
  textureStore(arrival, id.xy, revealArrivalAt(stagePoint(vec2i(u.origin + id.xy)), spans[2u * t], spans[2u * t + 1u]));
}`;

const CUT = gpuUniformLayout('RevealCut', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['first', 'u32'], ['at', 'f32'], ['softS', 'f32'], ['mapOrigin', 'vec2u'], ['mapExtent', 'vec2u'],
  ['toRest', 'vec4f'], ['baseKind', 'i32'], ['baseEnds', 'vec2f'], ['baseGeometry', 'vec4f'], ['delayKind', 'i32'], ['delayEnds', 'vec2f'], ['delayGeometry', 'vec4f'],
]);
// One reveal's share of each texel over `origin` `extent` of the cut: written by the film's first, multiplied in by
// the rest. A strokes reveal reads its arrival map (none past it: never reached); a field reads its arrivals at the
// texel's rest point, its front's seconds per px across a px each way, as stampRevealFieldShown does.
const cutWgsl = (stage: StampStage, kind: StampReveal['kind']) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_REST_POINT_WGSL}
${STAMP_REVEAL_WGSL}
${CUT.wgsl}
@group(0) @binding(0) var<uniform> u: RevealCut;
@group(0) @binding(1) var cut: texture_storage_2d<r32float, read_write>;
${kind === 'strokes' ? /* wgsl */ `@group(0) @binding(2) var arrival: texture_2d<f32>;
fn shownAt(texel: vec2i) -> f32 {
  let m = texel - vec2i(u.mapOrigin);
  if (any(m < vec2i(0)) || any(m >= vec2i(u.mapExtent))) { return 0.0; }
  let a = textureLoad(arrival, vec2u(m), 0);
  return max(a.y * revealRamp(u.at, a.x, a.w, u.softS), revealRamp(u.at, a.z, a.w, u.softS));
}` : /* wgsl */ `
fn arrivalAt(p: vec2f) -> f32 {
  let r = restPoint(u.toRest, p);
  return revealFieldValue(r, u.baseKind, u.baseEnds, u.baseGeometry) + revealFieldValue(r, u.delayKind, u.delayEnds, u.delayGeometry);
}
fn shownAt(texel: vec2i) -> f32 {
  let p = stagePoint(texel);
  let across = vec2f(arrivalAt(p + vec2f(0.5, 0.0)) - arrivalAt(p - vec2f(0.5, 0.0)), arrivalAt(p + vec2f(0.0, 0.5)) - arrivalAt(p - vec2f(0.0, 0.5)));
  return revealRamp(u.at, arrivalAt(p), length(across), u.softS);
}`}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn revealCut(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let texel = u.origin + id.xy;
  var shown = shownAt(vec2i(texel));
  if (u.first == 0u) { shown *= textureLoad(cut, texel).r; }
  textureStore(cut, texel, vec4f(shown));
}`;

/**
 * `revealAt(texel)`: a cut (createStampRevealPass's) bound at `binding`, read at a texel of the layer it cuts; nothing
 * shows past it. A lay, a glow and a gathered cover read it alike.
 */
export const stampRevealAtWgsl = (binding: number) => /* wgsl */ `
@group(0) @binding(${binding}) var reveal: texture_2d<f32>;
fn revealAt(texel: vec2i) -> f32 {
  if (any(texel < vec2i(0)) || any(texel >= vec2i(textureDimensions(reveal)))) { return 0.0; }
  return textureLoad(reveal, vec2u(texel), 0).r;
}`;

/** The uniform slots cutting by `links` may take: a cut a link, and a strokes reveal's arrival map drawn. */
export const stampRevealSlots = (links: readonly StampRevealLink[]) => links.reduce((sum, { reveal }) => sum + (reveal.kind === 'strokes' ? 2 : 1), 0);

/** What a cut reads: a film's reveals, the texels of its layer target its paint lies over, that target's size, and the periods its document wraps by. */
export type StampRevealCutting = {
  readonly links: readonly StampRevealLink[];
  readonly box: StampPixelBox;
  readonly size: { readonly width: number; readonly height: number };
  readonly periods: StampWrapPeriods;
};

/** A kept arrival map's note: the layer target's texels it covers. */
type StampRevealArrivalNote = { readonly box: StampPixelBox };
const arrivalStores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampRevealArrivalNote>>();

/**
 * Cuts on `owner`'s device for layer targets a margin in on `stage`, each pass's uniform from `arena`. A strokes
 * reveal's arrival map is drawn from lists made through `device`: a scope's frees them with it; otherwise `release`
 * does, once the work that read them is submitted.
 */
export function createStampRevealPass(owner: StampPaintGpuOwner, device: StampPaintDevice, stage: StampStage) {
  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const spent: GPUBuffer[] = [];
  let store = arrivalStores.get(owner);
  if (!store) arrivalStores.set(owner, (store = owner.cache.store<StampRevealArrivalNote>('arrival')));
  const arrivals = store;

  /** `link`'s arrival map over the texels its strokes reach, drawn unless kept; null where they reach none. */
  function arrivalOf(encoder: GPUCommandEncoder, arena: StampUniformArena, link: StampRevealLink & { readonly reveal: { readonly kind: 'strokes' } }, { size, periods }: StampRevealCutting) {
    const key = `${stampRevealKey(link.reveal)}|${link.toFilm.join(',')}|${periods.x},${periods.y}|${stage.margin}|${size.width}x${size.height}`;
    const found = arrivals.find(key, encoder);
    if (found) return { view: found.textures[0].createView(), box: found.note.box };
    const segments = stampRevealSegments(link.reveal.strokes, link.toFilm, periods), count = segments.length / STAMP_REVEAL_SEGMENT_FLOATS;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < count; k++) {
      const s = k * STAMP_REVEAL_SEGMENT_FLOATS, pad = segments[s + 4] + 1;
      x0 = Math.min(x0, segments[s] - pad, segments[s + 2] - pad);
      y0 = Math.min(y0, segments[s + 1] - pad, segments[s + 3] - pad);
      x1 = Math.max(x1, segments[s] + pad, segments[s + 2] + pad);
      y1 = Math.max(y1, segments[s + 1] + pad, segments[s + 3] + pad);
    }
    const within = count > 0 ? stampStageTexelsWithin({ ...stage, width: size.width, height: size.height }, x0, y0, x1, y1) : null;
    if (!within) return null;
    const box = { x: within.x, y: within.y, w: within.w, h: within.h }, usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const [texture] = arrivals.make(key, encoder, [{ width: box.w, height: box.h, layers: 1, format: 'rgba32float', usage }], { box }).textures;
    const tiles = stampRevealTiles(segments, { x: box.x - stage.margin, y: box.y - stage.margin, w: box.w, h: box.h });
    const lists = [segments, tiles.spans, tiles.listed].map((data) => stampPaintBuffer(device, data, GPUBufferUsage.STORAGE));
    spent.push(...lists);
    const view = texture.createView();
    dispatchStampCompute(device, encoder, compute(arrivalWgsl(stage)), [
      arena.slot((views) => {
        const put = gpuUniformWriter(ARRIVAL, views);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        put('columns', tiles.columns);
      }),
      ...lists.map((buffer) => ({ buffer })), view,
    ], box.w, box.h);
    return { view, box };
  }

  return {
    /**
     * The share of a film's paint `cutting.links` show over `cutting.box`, r32float over a target the layer target's
     * size; null for a film nothing cuts. The view is overwritten by the next cut of that size.
     */
    cut(encoder: GPUCommandEncoder, arena: StampUniformArena, cutting: StampRevealCutting): GPUTextureView | null {
      const { links, box, size } = cutting;
      if (!links.length) return null;
      const target = owner.target(`reveal cut ${size.width}x${size.height}`, { size: [size.width, size.height], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      const view = target.createView();
      links.forEach((link, i) => {
        const { reveal } = link, map = reveal.kind === 'strokes' ? arrivalOf(encoder, arena, { ...link, reveal }, cutting) : null;
        const slot = arena.slot((views) => {
          const put = gpuUniformWriter(CUT, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          put('first', i === 0 ? 1 : 0);
          put('at', link.at);
          put('softS', reveal.softS ?? 0);
          put('toRest', link.toRest);
          if (map) {
            put('mapOrigin', [map.box.x, map.box.y]);
            put('mapExtent', [map.box.w, map.box.h]);
          }
          if (reveal.kind !== 'field') return;
          for (const [name, field] of [['base', reveal.base], ['delay', reveal.delay]] as const) {
            if (!field) continue;
            const { first, second, kind, geometry } = stampPaintFieldEnds(field);
            put(`${name}Kind`, kind);
            put(`${name}Ends`, [first, second]);
            put(`${name}Geometry`, geometry);
          }
        });
        // A strokes reveal reaching none of the target's texels reads an empty map: never reached.
        const arrival = reveal.kind === 'strokes' ? [map?.view ?? owner.target('reveal no arrival', { size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView()] : [];
        dispatchStampCompute(device, encoder, compute(cutWgsl(stage, reveal.kind)), [slot, view, ...arrival], box.w, box.h);
      });
      return view;
    },
    /** Frees the lists arrival maps were drawn from: once the work that drew them is submitted. */
    release() {
      for (const buffer of spent.splice(0)) buffer.destroy();
    },
  };
}

export type StampRevealPass = ReturnType<typeof createStampRevealPass>;
