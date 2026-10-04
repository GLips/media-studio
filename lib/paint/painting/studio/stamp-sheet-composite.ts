// stamp-sheet-composite.ts: the films of several sheets laid as one picture (ENGINE 5.4, 5.5). The root sheet's paper
// is the ground; then, back to front, each film by its own sheet's lay (its compositor, paper colour and photograph),
// and an own sheet's card where its owner comes: its paper laid as far as the union of its films' coverage reaches,
// cover = min(1, STAMP_OPAQUE_COVER × union). A placed sheet is laid moved by a similarity. A film cut by reveals is
// laid, and joins its card's union, as they show it; the union is cached under its films' keys and reveals.
//
// Whoever solved a composite's films holds them until it's laid (holdStampSheetFilms): another solve meanwhile may
// make entries past the cache's budget.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { stampSimilarityPoint, type StampSheetPlace } from '../models/stamp-rest-map.ts';
import { stampSheetMixedPainting, type StampSheetCompositeStep, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampRevealLinksKey, type StampRevealLink } from '../models/stamp-reveal.ts';
import { stampBoxUnion, stampStage, stampStageTexelsOf, stampStageWgsl, stampWrapPeriods, type StampPointBox, type StampStage } from '../models/stamp-stage.ts';
import { copyStampLayerForReadback, readStampLayerCopy, type StampLayerReadback } from './stamp-layer-readback.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { clearStampTarget, copyStampTextureBox, dispatchStampCompute, STAMP_WORKGROUP, stampBindGroup, stampPaintSamplers, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { createStampPaintLay, stampPaintOutputWgsl, type StampPaintBacking, type StampPaintLay } from './stamp-paint-lay-pass.ts';
import { createStampRevealPass, stampRevealAtWgsl, stampRevealSlots } from './stamp-reveal-pass.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';
import { keptStampSheetFilm, type StampSheetFilmKept } from './stamp-sheet-films.ts';
import { createStampUniformArena, type StampUniformArena } from './stamp-uniform-arena.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/** A sheet's films as a solve kept them: its program, and film f of it kept as `films[f]`. */
export type StampSheetKeptFilms = { readonly program: StampSheetProgram; readonly films: readonly StampSheetFilmKept[] };

/**
 * A sheet as a composite lays it: its kept films; `place`, where its films, card and paper lie (null: where they were
 * painted); and `reveals`, each film's, outermost first (none cut any when left out).
 */
export type StampSheetLaid = StampSheetKeptFilms & { readonly place: StampSheetPlace | null; readonly reveals?: readonly (readonly StampRevealLink[])[] };

/**
 * Sheets laid as one picture: the root's first, its paper the ground when one is laid; the steps laying them, back
 * to front. Every sheet is the same document's: one size.
 */
export type StampSheetsComposite = { sheets: readonly StampSheetLaid[]; steps: readonly StampSheetCompositeStep[] };

/** A kept edge's note: the painting points its union covers. */
type StampSheetEdgeNote = { box: StampPointBox };
const edgeStores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampSheetEdgeNote>>();

const STAMP_SHEET_EDGE = gpuUniformLayout('EdgeFilm', [['origin', 'vec2u'], ['extent', 'vec2u'], ['cutOrigin', 'vec2u'], ['shown', 'f32']]);
// One film's coverage, times how much it shows, joined into its sheet's union by max: the film's texel 0 is its box's
// first, laid at `origin` of the union's box. `revealed`: its coverage taken times its reveals' cut, its texel 0 at
// the cut's `cutOrigin`.
const edgeWgsl = (revealed: boolean) => /* wgsl */ `
${STAMP_SHEET_EDGE.wgsl}
@group(0) @binding(0) var<uniform> u: EdgeFilm;
@group(0) @binding(1) var film: texture_2d_array<f32>;
@group(0) @binding(2) var edge: texture_storage_2d<r32float, read_write>;
${revealed ? stampRevealAtWgsl(3) : ''}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn join(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let at = u.origin + id.xy;
  let covered = u.shown * max(textureLoad(film, id.xy, 0, 0).x, 0.0)${revealed ? ' * revealAt(vec2i(u.cutOrigin + id.xy))' : ''};
  textureStore(edge, at, vec4f(max(textureLoad(edge, at).r, covered)));
}`;

/** A sheet's edge as a card reads it: the union of its films' coverage (r32float) over `box`, painting points. */
export type StampSheetEdge = { view: GPUTextureView; box: StampPointBox };

/** A film a card is cut round, and how much of its coverage the card counts (0..1; 1 for all of it). */
export type StampSheetEdgeFilm = { readonly film: StampSheetFilmKept; readonly shown: number };

/**
 * A sheet's films' reveals as its edge joins them: `key` naming them all (stampRevealLinksKey's, a film each), and
 * `cutOf`, film f's cut (StampRevealPass's; f indexing the edge's films) and the cut's texel its box's first lies at,
 * made as it's asked for; null for a film nothing cuts.
 */
export type StampSheetEdgeCuts = {
  readonly key: string;
  readonly cutOf: (film: number) => { readonly view: GPUTextureView; readonly origin: readonly [number, number] } | null;
};

/**
 * The union of `films`' coverage, each times how much it shows and cut by its reveals when `cuts` says, used by
 * `encoder`'s work: kept under their keys, shares and reveals, so a sheet whose films haven't changed joins them no
 * more. Null for films painted nowhere.
 */
export function stampSheetEdge(
  owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, films: readonly StampSheetEdgeFilm[], cuts?: StampSheetEdgeCuts,
): StampSheetEdge | null {
  const box = films.reduce<StampPointBox | null>((union, { film }) => stampBoxUnion(union, film.box), null);
  if (!box) return null;
  let store = edgeStores.get(owner);
  if (!store) edgeStores.set(owner, (store = owner.cache.store<StampSheetEdgeNote>('edge')));
  const key = `${films.map(({ film, shown }) => `${film.key}*${shown}`).join('+')}${cuts ? ` cut ${cuts.key}` : ''}`, found = store.find(key, encoder);
  if (found) return { view: found.textures[0].createView(), box: found.note.box };
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  const [texture] = store.make(key, encoder, [{ width: box.w, height: box.h, layers: 1, format: 'r32float', usage }], { box }).textures;
  const view = texture.createView(), join = (revealed: boolean) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: edgeWgsl(revealed) }) } });
  films.forEach(({ film, shown }, f) => {
    if (!film.box) return;
    const kept = keptStampSheetFilm(owner, film, encoder)!, { x, y, w, h } = film.box, cut = cuts?.cutOf(f) ?? null;
    dispatchStampCompute(device, encoder, join(cut !== null), [
      arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_SHEET_EDGE, views);
        put('origin', [x - box.x, y - box.y]);
        put('extent', [w, h]);
        put('shown', shown);
        if (cut) put('cutOrigin', [cut.origin[0], cut.origin[1]]);
      }),
      kept.createView({ dimension: '2d-array' }), view, cut?.view ?? null,
    ], w, h);
  });
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

/** The uniform slots cutting `sheet`'s film `film` by its reveals may take. */
const revealSlots = (sheet: StampSheetLaid, film: number) => stampRevealSlots(sheet.reveals?.[film] ?? []);

/**
 * How many uniform slots laying `composite` may take: the ground, a rest map a sheet, a card and its edge's joins
 * (each film cut first), a lay a film and its cut.
 */
const compositeSlots = ({ sheets, steps }: StampSheetsComposite) => 1 + sheets.length + steps.reduce((sum, step) => {
  const sheet = sheets[step.sheet];
  return sum + (step.kind === 'card' ? 1 + sheet.films.reduce((joins, _, f) => joins + 1 + revealSlots(sheet, f), 0) : 1 + revealSlots(sheet, step.film));
}, 0);

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
 * root's paper, or a measuring backing); a reserve or lift showing `ground` too. Lists a reveal's arrival map is drawn
 * from are made through `device`: a scope's, freeing them once the work is submitted.
 */
function encodeStampSheetsSteps(
  owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, composite: StampSheetsComposite,
  { stage, compositors, lays }: StampSheetsLays, painting: GPUTextureView, ground: StampPaintBacking,
) {
  const revealing = createStampRevealPass(owner, device, stage), size = { width: stage.width, height: stage.height };
  /** Sheet `s`'s film `f` cut by its reveals over `box`, its stage texels; null for one nothing cuts. */
  const cutOf = (s: number, f: number, box: StampPixelBox) => {
    const { program, reveals } = composite.sheets[s];
    return revealing.cut(encoder, arena, { links: reveals?.[f] ?? [], box, size, periods: stampWrapPeriods(program, program.wrap) });
  };
  const rests = composite.sheets.map(({ place }, s) => {
    if (!place) return null;
    const rest = owner.target(`sheet composite rest ${s}`, { size: [stage.width, stage.height], format: 'rg32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const view = rest.createView();
    lays[s].drawPlacedRest(encoder, view, place.rest);
    return view;
  });
  for (const step of composite.steps) {
    const { films, place, reveals } = composite.sheets[step.sheet], rest = rests[step.sheet];
    if (step.kind === 'card') {
      const cuts = reveals?.some((links) => links.length > 0) ? {
        key: reveals.map(stampRevealLinksKey).join('|'),
        cutOf: (f: number) => {
          const box = films[f].box && stampStageTexelsOf(stage, films[f].box), view = box && cutOf(step.sheet, f, box);
          return box && view ? { view, origin: [box.x, box.y] as const } : null;
        },
      } : undefined;
      const edge = stampSheetEdge(owner, device, encoder, arena, films.map((film) => ({ film, shown: 1 })), cuts), edgeBox = edge && stampStageTexelsOf(stage, edge.box);
      const box = edgeBox && (place ? placedBox(stage, edgeBox, place) : edgeBox);
      if (edge && edgeBox && box) lays[step.sheet].layCard(encoder, { edge: edge.view, edgeBox, painting, box, rest });
      continue;
    }
    const film = films[step.film], kept = keptStampSheetFilm(owner, film, encoder), filmBox = film.box && stampStageTexelsOf(stage, film.box);
    const box = filmBox && (place ? placedBox(stage, filmBox, place) : filmBox);
    if (!kept || !filmBox || !box) continue;
    const shape = compositors[step.sheet].targets.layer, usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
    const layer = stampSheetCompositeTarget(owner, `layer ${shape.kind === 'array' ? shape.layers : 1}`, stage, shape, usage);
    // A moved lay's taps read past the film's box: nothing an earlier film left there may show.
    if (place) for (const view of layer.layers) clearStampTarget(encoder, view);
    copyStampTextureBox(encoder, { texture: kept, x: 0, y: 0 }, { texture: layer.texture, x: filmBox.x, y: filmBox.y }, filmBox);
    const reveal = cutOf(step.sheet, step.film, filmBox);
    lays[step.sheet].layGroup(encoder, { layer: layer.view, painting, index: step.film, opacity: 1, glaze: true, box, backing: ground, rest, paperFromRest: true, reveal });
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
 * Premultiplied linear-light RGBA over `w` × `h` px from painting point (x0, y0), alpha its coverage: the shape a rig's
 * picture takes (PaintRigPicture), which this feature can't name.
 */
export type StampSheetsPicture = { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly rgba: Float32Array };

/** A composite's light over a crop on one ground, and that ground's own light, measured where nothing lies on it. */
type StampSheetsLight = { light: StampLayerReadback; ground: StampLayerReadback };

/** What a composite read back is laid on: the root's paper, opaque; or nothing, its paint and cards measured clear. */
export type StampSheetsGround = 'paper' | 'clear';

/**
 * `composite` read back over `crop` (painting points) as a premultiplied picture on `ground`: on the root's paper, or
 * clear, measured on white and on black, the light over each backing taken as C + T·b per channel (the plane passes'
 * reading, stampPlanePictureWgsl), each backing's own light measured before anything lies on it. Each backing's
 * readback is counted into `costs`.
 */
export async function readStampSheetsPicture(
  owner: StampPaintGpuOwner, composite: StampSheetsComposite, crop: StampPointBox, ground: StampSheetsGround, costs?: StampPaintCostTally,
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
      const texels = stampStageTexelsOf(stage, crop), groundCopy = measure({ x: texels.x, y: texels.y, w: 1, h: 1 }, 'ground');
      encodeStampSheetsSteps(owner, device, encoder, arena, composite, lays, painting.view, backing);
      const lightCopy = measure(texels, 'light');
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
    return { x0: crop.x, y0: crop.y, w: crop.w, h: crop.h, rgba };
  } finally {
    scope.destroy();
  }
}
