// stamp-sheet-composite.ts: the films of several sheets laid as one picture (ENGINE 5.4, 5.5). The root sheet's paper
// is the ground; then, back to front, each film by its own sheet's lay (its compositor, its paper's colour baked in,
// and its photograph), and an own sheet's card where its owner comes: its paper laid as far as the union of its
// films' coverage reaches, cover = min(1, STAMP_OPAQUE_COVER × union). A placed sheet is laid moved by a similarity,
// its grain travelling with it. A card's union (its edge) is cached under its films' keys.
//
// Whoever solved a composite's films holds them until it's laid (holdStampSheetFilms): another solve meanwhile may
// make entries past the cache's budget.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { stampSimilarityPoint, type StampSheetPlace } from '../models/stamp-rest-map.ts';
import { stampSheetMixedPainting, type StampSheetCompositeStep, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampBoxUnion, stampStage, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { copyStampLayerForReadback, readStampLayerCopy, type StampLayerReadback } from './stamp-layer-readback.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { clearStampTarget, copyStampTextureBox, dispatchStampCompute, STAMP_WORKGROUP, stampBindGroup, stampPaintSamplers, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { createStampPaintLay, stampPaintOutputWgsl, type StampPaintBacking, type StampPaintLay } from './stamp-paint-lay-pass.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';
import { keptStampSheetFilm, type StampSheetFilmKept } from './stamp-sheet-films.ts';
import { createStampUniformArena, type StampUniformArena } from './stamp-uniform-arena.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/** A sheet's films as a solve kept them: its program, and film f of it kept as `films[f]`. */
export type StampSheetKeptFilms = { readonly program: StampSheetProgram; readonly films: readonly StampSheetFilmKept[] };

/** A sheet as a composite lays it: its kept films, and `place`, where its films, card and paper lie; null where they were painted. */
export type StampSheetLaid = StampSheetKeptFilms & { readonly place: StampSheetPlace | null };

/**
 * Sheets laid as one picture: the root's first, its paper the ground when one is laid; the steps laying them, back
 * to front. Every sheet is the same document's: one size.
 */
export type StampSheetsComposite = { sheets: readonly StampSheetLaid[]; steps: readonly StampSheetCompositeStep[] };

/** A kept edge's note: the stage texels its union covers. */
type StampSheetEdgeNote = { box: StampPixelBox };
const edgeStores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampSheetEdgeNote>>();

const STAMP_SHEET_EDGE = gpuUniformLayout('EdgeFilm', [['origin', 'vec2u'], ['extent', 'vec2u']]);
// One film's coverage joined into its sheet's union by max: the film's texel 0 is its box's first, laid at `origin`
// of the union's box.
const EDGE_WGSL = /* wgsl */ `
${STAMP_SHEET_EDGE.wgsl}
@group(0) @binding(0) var<uniform> u: EdgeFilm;
@group(0) @binding(1) var film: texture_2d_array<f32>;
@group(0) @binding(2) var edge: texture_storage_2d<r32float, read_write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn join(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let at = u.origin + id.xy;
  textureStore(edge, at, vec4f(max(textureLoad(edge, at).r, max(textureLoad(film, id.xy, 0, 0).x, 0.0))));
}`;

/** A sheet's edge as a card reads it: the union of its films' coverage (r32float) over `box`, document px. */
export type StampSheetEdge = { view: GPUTextureView; box: StampPixelBox };

/**
 * The union of `films`' coverage, used by `encoder`'s work: kept under their keys, so a sheet whose films haven't
 * changed joins them no more. Null for films painted nowhere.
 */
export function stampSheetEdge(owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, films: readonly StampSheetFilmKept[]): StampSheetEdge | null {
  const box = films.reduce<StampPixelBox | null>((union, { box: painted }) => stampBoxUnion(union, painted), null);
  if (!box) return null;
  let store = edgeStores.get(owner);
  if (!store) edgeStores.set(owner, (store = owner.cache.store<StampSheetEdgeNote>('edge')));
  const key = films.map((film) => film.key).join('+'), found = store.find(key, encoder);
  if (found) return { view: found.textures[0].createView(), box: found.note.box };
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  const [texture] = store.make(key, encoder, [{ width: box.w, height: box.h, layers: 1, format: 'r32float', usage }], { box }).textures;
  const view = texture.createView(), join = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: EDGE_WGSL }) } });
  for (const film of films) {
    if (!film.box) continue;
    const kept = keptStampSheetFilm(owner, film, encoder)!, { x, y, w, h } = film.box;
    dispatchStampCompute(device, encoder, join, [
      arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_SHEET_EDGE, views);
        put('origin', [x - box.x, y - box.y]);
        put('extent', [w, h]);
      }),
      kept.createView({ dimension: '2d-array' }), view,
    ], w, h);
  }
  return { view, box };
}

/** `box` (stage texels) laid by `place`: the stage texels its laid corners span, a texel round for the bilinear taps, held to the stage. */
function placedBox(stage: StampStage, box: StampPixelBox, place: StampSheetPlace): StampPixelBox | null {
  const m = stage.margin, corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([u, v]) => {
    const laid = stampSimilarityPoint(place.laid, u - m, v - m);
    return [laid.x + m, laid.y + m];
  });
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map(([u]) => u))) - 1), y0 = Math.max(0, Math.floor(Math.min(...corners.map(([, v]) => v))) - 1);
  const x1 = Math.min(stage.width, Math.ceil(Math.max(...corners.map(([u]) => u))) + 1), y1 = Math.min(stage.height, Math.ceil(Math.max(...corners.map(([, v]) => v))) + 1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** How many uniform slots laying `composite` may take: the ground, a rest map a sheet, a card and its edge's joins, a lay a film. */
const compositeSlots = ({ sheets, steps }: StampSheetsComposite) =>
  1 + sheets.length + steps.reduce((sum, step) => sum + (step.kind === 'card' ? 1 + sheets[step.sheet].films.length : 1), 0);

/** A composite's sheets made ready to lay on a device: each one's compositor and lay, its paper's photograph loaded. */
export type StampSheetsLays = { stage: StampStage; compositors: readonly StampPaintCompositor[]; lays: readonly StampPaintLay[]; painting: StampPaintTarget };

/** What laying `sheets` needs that loads: each one's paper photograph. */
export async function stampSheetsPhotographs(owner: StampPaintGpuOwner, sheets: readonly Pick<StampSheetKeptFilms, 'program'>[]) {
  return Promise.all(sheets.map(async ({ program: { paper } }) => (paper.image ? (await owner.images([{ asset: paper.image, kind: 'photograph' }]))[0] : null)));
}

/**
 * Each of `sheets`' compositor and lay on `device`, from `arena`, on `stage` (the document's, no margin, when left
 * out), each photograph covering the document. Throws unless every sheet's compositor keeps one painting alike.
 */
export function stampSheetsLays(
  owner: StampPaintGpuOwner, device: StampPaintDevice, arena: StampUniformArena, sheets: readonly Pick<StampSheetKeptFilms, 'program'>[],
  photographs: Awaited<ReturnType<typeof stampSheetsPhotographs>>, on?: StampStage,
): StampSheetsLays {
  const [first] = sheets, stage = on ?? stampStage(first.program), paperFrame = { width: first.program.width, height: first.program.height };
  const blank = owner.target('sheet blank', { size: [1, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
  const compositors = sheets.map(({ program }) => stampPaintCompositorFor(stampSheetMixedPainting(program)).compositorOn(device));
  const painting = compositors[0].targets.painting;
  compositors.forEach((compositor, s) => {
    if (JSON.stringify(compositor.targets.painting) !== JSON.stringify(painting)) throw new Error(`stamp sheet: ${sheets[s].program.name} keeps its painting otherwise than ${first.program.name}, so the two can't be laid as one`);
  });
  const sampler = stampPaintSamplers(device).mirrorTile;
  const lays = sheets.map(({ program }, s) => createStampPaintLay(device, arena, { stage, compositor: compositors[s], paper: program.paper, photograph: photographs[s], blank, sampler, paperFrame }));
  return { stage, compositors, lays, painting };
}

/** `owner`'s target `name` of `stage`'s size shaped as `shape`, sampled and `usage`: whoever lays into it overwrites all it reads. */
export function stampSheetCompositeTarget(owner: StampPaintGpuOwner, name: string, stage: StampStage, shape: StampPaintTarget, usage: number) {
  const layers = shape.kind === 'array' ? shape.layers : 1;
  const texture = owner.target(`sheet composite ${name}`, { size: [stage.width, stage.height, layers], format: 'rgba16float', usage: usage | GPUTextureUsage.TEXTURE_BINDING });
  return { texture, view: texture.createView({ dimension: shape.kind === 'array' ? '2d-array' : '2d' }), layers: Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })) };
}

/**
 * `composite`'s steps laid in `encoder` onto `painting` (a target the lays' compositors keep, `ground` laid on it: the
 * root's paper, or a measuring backing); a reserve or lift showing `ground` too.
 */
function encodeStampSheetsSteps(
  owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, composite: StampSheetsComposite,
  { stage, compositors, lays }: StampSheetsLays, painting: GPUTextureView, ground: StampPaintBacking,
) {
  const rests = composite.sheets.map(({ place }, s) => {
    if (!place) return null;
    const rest = owner.target(`sheet composite rest ${s}`, { size: [stage.width, stage.height], format: 'rg32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const view = rest.createView();
    lays[s].drawPlacedRest(encoder, view, place.rest);
    return view;
  });
  for (const step of composite.steps) {
    const { films, place } = composite.sheets[step.sheet], rest = rests[step.sheet];
    if (step.kind === 'card') {
      const edge = stampSheetEdge(owner, device, encoder, arena, films), box = edge && (place ? placedBox(stage, edge.box, place) : edge.box);
      if (edge && box) lays[step.sheet].layCard(encoder, { edge: edge.view, edgeBox: edge.box, painting, box, rest });
      continue;
    }
    const film = films[step.film], kept = keptStampSheetFilm(owner, film, encoder), box = film.box && (place ? placedBox(stage, film.box, place) : film.box);
    if (!kept || !film.box || !box) continue;
    const shape = compositors[step.sheet].targets.layer, usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
    const layer = stampSheetCompositeTarget(owner, `layer ${shape.kind === 'array' ? shape.layers : 1}`, stage, shape, usage);
    // A moved lay's taps read past the film's box: nothing an earlier film left there may show.
    if (place) for (const view of layer.layers) clearStampTarget(encoder, view);
    copyStampTextureBox(encoder, { texture: kept, x: 0, y: 0 }, { texture: layer.texture, x: film.box.x, y: film.box.y }, film.box);
    lays[step.sheet].layGroup(encoder, { layer: layer.view, painting, index: step.film, opacity: 1, glaze: true, box, backing: ground, rest, paperFromRest: true });
  }
}

/** `composite` laid on its root's paper and shown on `surface`, the document's size. */
export async function drawStampSheetsStill(surface: StampPaintSurface, composite: StampSheetsComposite): Promise<void> {
  const { owner } = surface, { program } = composite.sheets[0];
  if (surface.width !== program.width || surface.height !== program.height) {
    throw new Error(`stamp sheet: a ${program.width} × ${program.height} painting is shown on a surface its size, not ${surface.width} × ${surface.height}`);
  }
  const photographs = await stampSheetsPhotographs(owner, composite.sheets);
  const scope = owner.scope();
  try {
    await owner.checked('laying sheets\' films', () => {
      const { device } = scope, arena = createStampUniformArena(device, compositeSlots(composite));
      const lays = stampSheetsLays(owner, device, arena, composite.sheets, photographs), { stage, compositors } = lays;
      const painting = stampSheetCompositeTarget(owner, 'painting', stage, lays.painting, GPUTextureUsage.STORAGE_BINDING);
      const encoder = device.createCommandEncoder();
      lays.lays[0].drawPaper(encoder, painting.view, 'paper', stage.width, stage.height);
      encodeStampSheetsSteps(owner, device, encoder, arena, composite, lays, painting.view, 'paper');
      const module = device.createShaderModule({ code: stampPaintOutputWgsl(compositors[0], surface.format.endsWith('8unorm'), stage) });
      const output = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format: surface.format }] } });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.frameTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(output);
      pass.setBindGroup(0, stampBindGroup(device, output, [painting.view]));
      pass.draw(3);
      pass.end();
      arena.flush();
      device.queue.submit([encoder.finish()]);
    });
  } finally {
    scope.destroy();
  }
}

const STAMP_SHEET_LIGHT = gpuUniformLayout('SheetLight', [['origin', 'vec2u'], ['extent', 'vec2u']]);
// The painting's linear light over a box, as a picture holds it.
const lightWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 0, compositor.targets.painting, null)}
${GPU_SRGB_WGSL}
${compositor.output}
${STAMP_SHEET_LIGHT.wgsl}
@group(0) @binding(1) var<uniform> u: SheetLight;
@group(0) @binding(2) var lit: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn light(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  textureStore(lit, id.xy, vec4f(linearLight(u.origin + id.xy), 1.0));
}`;

/**
 * Premultiplied linear-light RGBA over `w` × `h` stage texels from (x0, y0), alpha its coverage: the shape a rig's
 * picture takes (PaintRigPicture), which this feature can't name.
 */
export type StampSheetsPicture = { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly rgba: Float32Array };

/** A composite's light over a crop on one ground, and that ground's own light, measured where nothing lies on it. */
type StampSheetsLight = { light: StampLayerReadback; ground: StampLayerReadback };

/** What a composite read back is laid on: the root's paper, opaque; or nothing, its paint and cards measured clear. */
export type StampSheetsGround = 'paper' | 'clear';

/**
 * `composite` read back over `crop` (stage texels) as a premultiplied picture on `ground`: on the root's paper, or
 * clear, measured on white and on black, the light over each backing taken as C + T·b per channel (the plane passes'
 * reading, stampPlanePictureWgsl), each backing's own light measured before anything lies on it. Each backing's
 * readback is counted into `costs`.
 */
export async function readStampSheetsPicture(
  owner: StampPaintGpuOwner, composite: StampSheetsComposite, crop: StampPixelBox, ground: StampSheetsGround, costs?: StampPaintCostTally,
): Promise<StampSheetsPicture> {
  const photographs = await stampSheetsPhotographs(owner, composite.sheets);
  const scope = owner.scope();
  try {
    const backings: readonly StampPaintBacking[] = ground === 'paper' ? ['paper'] : ['white', 'black'];
    const copies = await owner.checked('reading sheets back as a picture', () => backings.map((backing) => {
      const { device } = scope, arena = createStampUniformArena(device, compositeSlots(composite) + 2);
      const lays = stampSheetsLays(owner, device, arena, composite.sheets, photographs), { stage, compositors } = lays;
      const painting = stampSheetCompositeTarget(owner, 'painting', stage, lays.painting, GPUTextureUsage.STORAGE_BINDING);
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: lightWgsl(compositors[0], stage) }) } });
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
      const measure = (box: StampPixelBox, name: string) => {
        const light = owner.target(`sheet composite ${name} ${box.w}x${box.h}`, { size: [box.w, box.h], format: 'rgba16float', usage });
        dispatchStampCompute(device, encoder, pipeline, [painting.view, arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_SHEET_LIGHT, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
        }), light.createView()], box.w, box.h);
        return copyStampLayerForReadback(device, encoder, light, { x: 0, y: 0, w: box.w, h: box.h });
      };
      const encoder = device.createCommandEncoder();
      lays.lays[0].drawPaper(encoder, painting.view, backing, stage.width, stage.height);
      const groundCopy = measure({ x: crop.x, y: crop.y, w: 1, h: 1 }, 'ground');
      encodeStampSheetsSteps(owner, device, encoder, arena, composite, lays, painting.view, backing);
      const lightCopy = measure(crop, 'light');
      arena.flush();
      device.queue.submit([encoder.finish()]);
      return { lightCopy, groundCopy };
    }));
    const [onWhite, onBlack = onWhite]: StampSheetsLight[] = await Promise.all(copies.map(async ({ lightCopy, groundCopy }) => ({ light: await readStampLayerCopy(lightCopy), ground: await readStampLayerCopy(groundCopy) })));
    costs?.count('readbacks', backings.length);
    const rgba = new Float32Array(crop.w * crop.h * 4);
    for (let i = 0; i < crop.w * crop.h; i++) {
      const at = i * 4;
      let through = 0;
      for (let c = 0; c < 3; c++) {
        const black = onBlack.ground.values[c], gap = onWhite.ground.values[c] - black;
        const t = ground === 'paper' ? 0 : Math.min(1, Math.max(0, (onWhite.light.values[at + c] - onBlack.light.values[at + c]) / gap));
        rgba[at + c] = Math.max(0, onBlack.light.values[at + c] - t * black);
        through += t / 3;
      }
      rgba[at + 3] = 1 - through;
    }
    const { margin } = stampStage(composite.sheets[0].program);
    return { x0: crop.x - margin, y0: crop.y - margin, w: crop.w, h: crop.h, rgba };
  } finally {
    scope.destroy();
  }
}
