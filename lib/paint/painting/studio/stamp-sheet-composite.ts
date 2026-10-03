// stamp-sheet-composite.ts: the films of several sheets laid as one picture (ENGINE 5.4, 5.5). The root sheet's paper
// is the ground; then, back to front, each film by its own sheet's lay (its compositor, its paper's colour baked in,
// and its photograph), and an own sheet's card where its owner comes: its paper laid as far as the union of its
// films' coverage reaches, cover = min(1, STAMP_OPAQUE_COVER × union). A placed sheet's films, card and paper are laid
// moved by a similarity, so its grain travels with it. A card's union (its edge) is kept in the device's cache under
// its films' keys.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampGroupPlacement } from '../models/stamp-group-motion.ts';
import { stampSheetMixedPainting, type StampSheetCompositeStep, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampBoxUnion, stampStage, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { copyStampLayerForReadback, readStampLayerCopy } from './stamp-layer-readback.ts';
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

/**
 * A sheet as a composite lays it: its program, the films a solve of it kept (film f its program's), and `place`, the
 * placement about the origin its films, card and paper are laid by: null where they were painted.
 */
export type StampSheetLaid = { program: StampSheetProgram; films: readonly StampSheetFilmKept[]; place: StampGroupPlacement | null };

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

/** A sheet's edge as a card reads it: the union of its films' coverage (r32float) over `box`, stage texels. */
type StampSheetEdge = { view: GPUTextureView; box: StampPixelBox };

/**
 * The union of `films`' coverage, used by `encoder`'s work: kept under their keys, so a sheet whose films haven't
 * changed joins them no more. Null for films painted nowhere.
 */
function stampSheetEdge(owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, films: readonly StampSheetFilmKept[]): StampSheetEdge | null {
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

/** `box` (stage texels) laid by `place`: the stage texels its moved corners span, a texel round for the bilinear taps, held to the stage. */
function placedBox(stage: StampStage, box: StampPixelBox, { x, y, rotation, scale }: StampGroupPlacement): StampPixelBox | null {
  const cos = Math.cos(rotation) * scale, sin = Math.sin(rotation) * scale, m = stage.margin;
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([u, v]) => [cos * (u - m) - sin * (v - m) + x + m, sin * (u - m) + cos * (v - m) + y + m]);
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map(([u]) => u))) - 1), y0 = Math.max(0, Math.floor(Math.min(...corners.map(([, v]) => v))) - 1);
  const x1 = Math.min(stage.width, Math.ceil(Math.max(...corners.map(([u]) => u))) + 1), y1 = Math.min(stage.height, Math.ceil(Math.max(...corners.map(([, v]) => v))) + 1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** How many uniform slots laying `composite` may take: the ground, a rest map a sheet, a card and its edge's joins, a lay a film. */
const compositeSlots = ({ sheets, steps }: StampSheetsComposite) =>
  1 + sheets.length + steps.reduce((sum, step) => sum + (step.kind === 'card' ? 1 + sheets[step.sheet].films.length : 1), 0);

/** A composite's sheets made ready to lay on a device: each one's compositor and lay, its paper's photograph loaded. */
type StampSheetsLays = { stage: StampStage; compositors: readonly StampPaintCompositor[]; lays: readonly StampPaintLay[]; painting: StampPaintTarget };

/** What laying `composite` needs that loads: each sheet's paper photograph. */
async function stampSheetsPhotographs(owner: StampPaintGpuOwner, composite: StampSheetsComposite) {
  return Promise.all(composite.sheets.map(async ({ program: { paper } }) => (paper.image ? (await owner.images([{ asset: paper.image, kind: 'photograph' }]))[0] : null)));
}

/** Each sheet's compositor and lay on `device`, from `arena`. Throws unless every sheet's compositor keeps one painting alike. */
function stampSheetsLays(owner: StampPaintGpuOwner, device: StampPaintDevice, arena: StampUniformArena, composite: StampSheetsComposite, photographs: Awaited<ReturnType<typeof stampSheetsPhotographs>>): StampSheetsLays {
  const [first] = composite.sheets, stage = stampStage(first.program);
  const blank = owner.target('sheet blank', { size: [1, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
  const compositors = composite.sheets.map(({ program }) => stampPaintCompositorFor(stampSheetMixedPainting(program)).compositorOn(device));
  const painting = compositors[0].targets.painting;
  compositors.forEach((compositor, s) => {
    if (JSON.stringify(compositor.targets.painting) !== JSON.stringify(painting)) throw new Error(`stamp sheet: ${composite.sheets[s].program.name} keeps its painting otherwise than ${first.program.name}, so the two can't be laid as one`);
  });
  const sampler = stampPaintSamplers(device).mirrorTile;
  const lays = composite.sheets.map(({ program }, s) => createStampPaintLay(device, arena, { stage, compositor: compositors[s], paper: program.paper, photograph: photographs[s], blank, sampler }));
  return { stage, compositors, lays, painting };
}

/** `owner`'s target `name` of `stage`'s size shaped as `shape`, sampled and `usage`: whoever lays into it overwrites all it reads. */
function compositeTarget(owner: StampPaintGpuOwner, name: string, stage: StampStage, shape: StampPaintTarget, usage: number) {
  const layers = shape.kind === 'array' ? shape.layers : 1;
  const texture = owner.target(`sheet composite ${name}`, { size: [stage.width, stage.height, layers], format: 'rgba16float', usage: usage | GPUTextureUsage.TEXTURE_BINDING });
  return { texture, view: texture.createView({ dimension: shape.kind === 'array' ? '2d-array' : '2d' }), layers: Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })) };
}

/**
 * `composite` laid in `encoder` onto `painting` (a target the lays' compositors keep): the ground over `ground` (the
 * root's paper, or a measuring backing), then its steps; a reserve or lift showing `ground` too.
 */
function encodeStampSheetsComposite(
  owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, composite: StampSheetsComposite,
  { stage, compositors, lays }: StampSheetsLays, painting: GPUTextureView, ground: StampPaintBacking,
) {
  lays[0].drawPaper(encoder, painting, ground, stage.width, stage.height);
  const rests = composite.sheets.map(({ place }, s) => {
    if (!place) return null;
    const rest = owner.target(`sheet composite rest ${s}`, { size: [stage.width, stage.height], format: 'rg32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const view = rest.createView();
    lays[s].drawPlacedRest(encoder, view, place);
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
    const layer = compositeTarget(owner, `layer ${shape.kind === 'array' ? shape.layers : 1}`, stage, shape, usage);
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
  const photographs = await stampSheetsPhotographs(owner, composite);
  const scope = owner.scope();
  try {
    await owner.checked('laying sheets\' films', () => {
      const { device } = scope, arena = createStampUniformArena(device, compositeSlots(composite));
      const lays = stampSheetsLays(owner, device, arena, composite, photographs), { stage, compositors } = lays;
      const painting = compositeTarget(owner, 'painting', stage, lays.painting, GPUTextureUsage.STORAGE_BINDING);
      const encoder = device.createCommandEncoder();
      encodeStampSheetsComposite(owner, device, encoder, arena, composite, lays, painting.view, 'paper');
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
// The painting's linear light over a crop, as a picture holds it.
const lightWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 0, compositor.targets.painting, null)}
${GPU_SRGB_WGSL}
${compositor.output}
${STAMP_SHEET_LIGHT.wgsl}
@group(0) @binding(1) var<uniform> u: SheetLight;
@group(0) @binding(2) var light: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn light(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  textureStore(light, id.xy, vec4f(linearLight(u.origin + id.xy), 1.0));
}`;

/**
 * Premultiplied linear-light RGBA over `w` × `h` stage texels from (x0, y0), alpha its coverage: the shape a rig's
 * picture takes (PaintRigPicture), which this feature can't name.
 */
export type StampSheetsPicture = { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly rgba: Float32Array };

/**
 * `composite` read back over `crop` (stage texels) as a premultiplied picture: laid on the root's paper when `ground`
 * (opaque), else measured on white and on black, its colour what lies over black and its alpha what white shows
 * less of (C + T·b, the plane passes' two-point reading).
 */
export async function readStampSheetsPicture(owner: StampPaintGpuOwner, composite: StampSheetsComposite, crop: StampPixelBox, ground: boolean): Promise<StampSheetsPicture> {
  const photographs = await stampSheetsPhotographs(owner, composite);
  const scope = owner.scope();
  try {
    const backings: readonly StampPaintBacking[] = ground ? ['paper'] : ['black', 'white'];
    const copies = await owner.checked('reading sheets back as a picture', () => backings.map((backing) => {
      const { device } = scope, arena = createStampUniformArena(device, compositeSlots(composite) + 1);
      const lays = stampSheetsLays(owner, device, arena, composite, photographs), { stage, compositors } = lays;
      const painting = compositeTarget(owner, 'painting', stage, lays.painting, GPUTextureUsage.STORAGE_BINDING);
      const light = owner.target(`sheet composite light ${crop.w}x${crop.h}`, { size: [crop.w, crop.h], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
      const encoder = device.createCommandEncoder();
      encodeStampSheetsComposite(owner, device, encoder, arena, composite, lays, painting.view, backing);
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: lightWgsl(compositors[0], stage) }) } });
      dispatchStampCompute(device, encoder, pipeline, [
        painting.view,
        arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_SHEET_LIGHT, views);
          put('origin', [crop.x, crop.y]);
          put('extent', [crop.w, crop.h]);
        }),
        light.createView(),
      ], crop.w, crop.h);
      const copy = copyStampLayerForReadback(device, encoder, light, { x: 0, y: 0, w: crop.w, h: crop.h });
      arena.flush();
      device.queue.submit([encoder.finish()]);
      return copy;
    }));
    const [over, white] = await Promise.all(copies.map(readStampLayerCopy));
    const rgba = new Float32Array(crop.w * crop.h * 4);
    for (let i = 0; i < crop.w * crop.h; i++) {
      const at = i * 4, shows = white ? (white.values[at] + white.values[at + 1] + white.values[at + 2] - over.values[at] - over.values[at + 1] - over.values[at + 2]) / 3 : 0;
      rgba.set([over.values[at], over.values[at + 1], over.values[at + 2], Math.min(1, Math.max(0, 1 - shows))], at);
    }
    const { margin } = stampStage(composite.sheets[0].program);
    return { x0: crop.x - margin, y0: crop.y - margin, w: crop.w, h: crop.h, rgba };
  } finally {
    scope.destroy();
  }
}
