// stamp-sheet-composite.ts: the films of several sheets laid as one picture. The root sheet's paper is the ground;
// then, back to front, each film by its own sheet's lay, and an own sheet's card where its owner comes: its paper laid
// by its cover, from its laid films' paint and any figure (stamp-card-edge.ts). A placed sheet is laid moved by a
// similarity. Reveals cut a film and its card's cover, cached under its films' keys and reveals. A card's relief (stamp-card-relief-pass.ts): its shadow
// before it, its rim after its sheet's last film.
//
// Whoever solved a composite's films holds them until it's laid (holdStampSheetFilms): another solve meanwhile may
// make entries past the cache's budget.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { stampCardEdgeKey, stampCardFigureBox, stampCardFigurePoints, stampCardPaintRaise, stampCardEdgeOf, type StampCardEdge } from '../models/stamp-card-edge.ts';
import { stampCardReliefSteps, type StampCardReliefStepIn } from '../models/stamp-card-relief.ts';
import type { PaintLight } from '../models/stamp-form.ts';
import { stampSimilarityPoint, type StampSheetPlace } from '../models/stamp-rest-map.ts';
import { type StampSheetCompositeShown, type StampSheetCompositeStep, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { STAMP_POLYGON_DISTANCE_WGSL } from '../models/stamp-region.ts';
import { stampSheetRevealsKey, type StampFilmRevealLinks } from '../models/stamp-reveal.ts';
import { stampBoxUnion, stampStage, stampStageTexelsOf, stampStageWgsl, stampWrapPeriods, type StampPointBox, type StampStage, type StampWrapPeriods } from '../models/stamp-stage.ts';
import { createStampCardRelief, stampCardReliefSlots } from './stamp-card-relief-pass.ts';
import { copyStampLayerForReadback, readStampLayerCopy, type StampLayerReadback } from './stamp-layer-readback.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { stampSheetCompositorFor } from './stamp-paint-compositor-for.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { clearStampTarget, copyStampTextureBox, dispatchStampCompute, STAMP_WORKGROUP, stampBindGroup, stampPaintBuffer, stampPaintSamplers, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { createStampPaintLay, stampPaintOutputWgsl, type StampPaintBacking, type StampPaintLay } from './stamp-paint-lay-pass.ts';
import { createStampRevealPass, stampRevealAtWgsl, stampRevealSlots, type StampRevealPass } from './stamp-reveal-pass.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';
import { keptStampSheetFilm, type StampSheetFilmKept } from './stamp-sheet-films.ts';
import { createStampSpanFade, type StampFadedTarget, type StampSpanKept } from './stamp-span-fade-pass.ts';
import { createStampUniformArena, type StampUniformArena } from './stamp-uniform-arena.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/**
 * A sheet's films as a solve kept them: its program, and film f of it kept as `films[f]`. Film f is laid by its
 * program's mixing group f, its palette and drying: a composite leaving films out keeps every one at its index.
 */
export type StampSheetKeptFilms = { readonly program: StampSheetProgram; readonly films: readonly StampSheetFilmKept[] };

/**
 * A sheet as a composite lays it: its kept films; `place`, where its films, card and paper lie (null: where they were
 * painted); and `reveals`, each film's, outermost first (STAMP_FILMS_WHOLE for a readback, read as painted).
 */
export type StampSheetLaid = StampSheetKeptFilms & { readonly place: StampSheetPlace | null; readonly reveals: StampFilmRevealLinks };

/**
 * Sheets laid as one picture: the root's first, its paper the ground when one is laid; the steps laying them, back
 * to front, faded by `shown` (all shown when left out). Every sheet is one document's: one size. A card is cut round
 * the films the steps lay on its sheet, or with `cardFilms: 'kept'` every film it keeps.
 */
export type StampSheetsComposite = {
  sheets: readonly StampSheetLaid[]; steps: readonly StampSheetCompositeStep[]; cardFilms?: 'laid' | 'kept'; shown?: StampSheetCompositeShown;
};

/** Each sheet's films its card is cut round, in film order (StampSheetsComposite's `cardFilms`). */
function stampSheetsCardFilms({ sheets, steps, cardFilms = 'laid' }: StampSheetsComposite): readonly (readonly number[])[] {
  const counted = sheets.map(({ films }) => films.map(() => cardFilms === 'kept'));
  for (const step of steps) if (step.kind === 'film') counted[step.sheet][step.film] = true;
  return counted.map((films) => films.flatMap((on, f) => (on ? [f] : [])));
}

/** A kept cover's note: the painting points it covers. */
type StampCardCoverNote = { box: StampPointBox };
const coverStores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampCardCoverNote>>();

const STAMP_CARD_COVER_FILM = gpuUniformLayout('CoverFilm', [['origin', 'vec2u'], ['extent', 'vec2u'], ['cutOrigin', 'vec2u'], ['shown', 'f32'], ['raise', 'f32']]);
// One film's coverage, times how much it shows and raised (stampCardPaintRaise), joined into the cover by max: the film's texel 0 is its box's first, laid at \`origin\` of the cover's box. \`revealed\`: its
// coverage taken times its reveals' cut, its texel 0 at the cut's \`cutOrigin\`.
const coverFilmWgsl = (revealed: boolean) => /* wgsl */ `
${STAMP_CARD_COVER_FILM.wgsl}
@group(0) @binding(0) var<uniform> u: CoverFilm;
@group(0) @binding(1) var film: texture_2d_array<f32>;
@group(0) @binding(2) var cover: texture_storage_2d<r32float, read_write>;
${revealed ? stampRevealAtWgsl(3) : ''}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn join(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let at = u.origin + id.xy;
  let covered = u.shown * max(textureLoad(film, id.xy, 0, 0).x, 0.0)${revealed ? ' * revealAt(vec2i(u.cutOrigin + id.xy))' : ''};
  textureStore(cover, at, vec4f(max(textureLoad(cover, at).r, min(1.0, u.raise * covered))));
}`;

const STAMP_CARD_COVER_FIGURE = gpuUniformLayout('CoverFigure', [
  ['box', 'vec2f'], ['extent', 'vec2u'], ['cutOrigin', 'vec2u'], ['total', 'u32'], ['shown', 'f32'], ['fade', 'f32'], ['ramp', 'u32'],
]);
// A figure card's cover: whole inside its rings, antialiased at the line, times how much a film shows and,
// \`revealed\`, its reveals' cut (texel 0 at \`cutOrigin\`), joined by max. With \`ramp\` (the first join only) the
// paint's coverage past the rings is first taken times a ramp falling, squared, to nothing \`fade\` px out.
const coverFigureWgsl = (revealed: boolean) => /* wgsl */ `
${STAMP_CARD_COVER_FIGURE.wgsl}
@group(0) @binding(0) var<uniform> u: CoverFigure;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var cover: texture_storage_2d<r32float, read_write>;
${revealed ? stampRevealAtWgsl(3) : ''}
${STAMP_POLYGON_DISTANCE_WGSL}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn figure(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let d = ringsDistance(u.box + vec2f(id.xy) + 0.5, 0u, u.total);
  let ramp = select(1.0, clamp(1.0 + d / u.fade, 0.0, 1.0), u.ramp == 1u);
  let inside = u.shown * clamp(d + 0.5, 0.0, 1.0)${revealed ? ' * revealAt(vec2i(u.cutOrigin + id.xy))' : ''};
  textureStore(cover, id.xy, vec4f(max(inside, textureLoad(cover, id.xy).r * ramp * ramp)));
}`;

/** An own sheet's card cover as its lay reads it: how much of its paper lies at each texel (r32float) over `box`, painting points. */
export type StampCardCover = { view: GPUTextureView; box: StampPointBox };

/** A film a card is cut round, and how much of its coverage the card counts (0..1; 1 for all of it). */
export type StampCardCoverFilm = { readonly film: StampSheetFilmKept; readonly shown: number };

/**
 * How a sheet's films are cut as its card's cover joins them: their `reveals`, in the cover's films' order; the `pass`
 * cutting them, on `stage`; and the `size` of the layer target a cut is made over and the `periods` the document
 * wraps by (StampRevealCutting's).
 */
export type StampCardCoverCutting = {
  readonly reveals: StampFilmRevealLinks;
  readonly pass: StampRevealPass;
  readonly stage: StampStage;
  readonly size: { readonly width: number; readonly height: number };
  readonly periods: StampWrapPeriods;
};

/**
 * The cover of a card with `edge`: `films`' coverage times its share, cut by its reveals (`cutting`) and raised as the
 * edge says, and a figure's outline wholly, shown as each film is where its reveals reach. Cached under the films' keys, shares,
 * reveals and the edge, so an unchanged card isn't joined again. Null when it covers nothing.
 */
export function stampCardCover(
  owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, edge: StampCardEdge, films: readonly StampCardCoverFilm[],
  { reveals, pass, stage, size, periods }: StampCardCoverCutting,
): StampCardCover | null {
  const shownMost = Math.max(0, ...films.map(({ shown }) => shown)), figureBox = stampCardFigureBox(edge, stage.frame);
  const figureOn = shownMost > 0 ? figureBox : null;
  const box = films.reduce<StampPointBox | null>((union, { film }) => stampBoxUnion(union, film.box), figureOn);
  if (!box) return null;
  let store = coverStores.get(owner);
  if (!store) coverStores.set(owner, (store = owner.cache.store<StampCardCoverNote>('edge')));
  const cut = reveals.some((links) => links.length > 0);
  const key = `${stampCardEdgeKey(edge)} ${films.map(({ film, shown }) => `${film.key}*${shown}`).join('+')}${cut ? ` cut ${stampSheetRevealsKey(reveals)}` : ''}`;
  const found = store.find(key, encoder);
  if (found) return { view: found.textures[0].createView(), box: found.note.box };
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  const [texture] = store.make(key, encoder, [{ width: box.w, height: box.h, layers: 1, format: 'r32float', usage }], { box }).textures;
  const view = texture.createView(), raise = stampCardPaintRaise(edge);
  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  films.forEach(({ film, shown }, f) => {
    if (!film.box) return;
    const kept = keptStampSheetFilm(owner, film, encoder)!, { x, y, w, h } = film.box, texels = stampStageTexelsOf(stage, film.box);
    const reveal = pass.cut(encoder, arena, { links: reveals[f] ?? [], box: texels, size, periods });
    dispatchStampCompute(device, encoder, compute(coverFilmWgsl(reveal !== null)), [
      arena.slot((views) => {
        const put = gpuUniformWriter(STAMP_CARD_COVER_FILM, views);
        put('origin', [x - box.x, y - box.y]);
        put('extent', [w, h]);
        put('shown', shown);
        put('cutOrigin', [texels.x, texels.y]);
        put('raise', raise);
      }),
      kept.createView({ dimension: '2d-array' }), view, reveal,
    ], w, h);
  });
  if (edge !== 'union') {
    // The figure shows as each film does, where its reveals have reached: an unrevealed card lays no paper.
    const joins = cut ? films.flatMap(({ shown }, f) => (shown > 0 ? [{ shown, f }] : [])) : [{ shown: shownMost, f: -1 }];
    const outline = stampCardFigurePoints(edge), total = outline.length / 2, points = { buffer: stampPaintBuffer(device, outline, GPUBufferUsage.STORAGE) };
    const texels = stampStageTexelsOf(stage, box);
    (joins.length ? joins : [{ shown: 0, f: -1 }]).forEach(({ shown, f }, i) => {
      const reveal = f < 0 ? null : pass.cut(encoder, arena, { links: reveals[f] ?? [], box: texels, size, periods });
      dispatchStampCompute(device, encoder, compute(coverFigureWgsl(reveal !== null)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_CARD_COVER_FIGURE, views);
          put('box', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          put('cutOrigin', [texels.x, texels.y]);
          put('total', total);
          put('shown', shown);
          put('fade', edge.fadePx);
          put('ramp', i === 0 ? 1 : 0);
        }),
        points, view, reveal,
      ], box.w, box.h);
    });
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

/** The uniform slots cutting `sheet`'s film `film` by its reveals may take. */
const revealSlots = (sheet: StampSheetLaid, film: number) => stampRevealSlots(sheet.reveals[film] ?? []);

/**
 * How many uniform slots laying `composite` may take: the ground, a rest map a sheet, a mix a faded span, a card and
 * its cover's joins (each film cut first, then its figure as each film shows, cut again) and its light, a lay a film and its cut.
 */
const compositeSlots = (composite: StampSheetsComposite) => {
  const { sheets, steps } = composite, cardFilms = stampSheetsCardFilms(composite);
  const cards = steps.filter((step) => step.kind === 'card').length;
  return 1 + sheets.length + (composite.shown?.fades.length ?? 0) + stampCardReliefSlots(cards, sheets.length) + steps.reduce((sum, step) => {
    const sheet = sheets[step.sheet];
    if (step.kind === 'rim') return sum;
    return sum + (step.kind === 'card' ? 2 + 2 * cardFilms[step.sheet].reduce((joins, f) => joins + 1 + revealSlots(sheet, f), 0) : 1 + revealSlots(sheet, step.film));
  }, 0);
};

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
  const blank = owner.blank('r8unorm').createView();
  const compositors = sheets.map(({ program }) => stampSheetCompositorFor(program).compositorOn(device));
  const painting = compositors[0].targets.painting;
  compositors.forEach((compositor, s) => {
    if (JSON.stringify(compositor.targets.painting) !== JSON.stringify(painting)) throw new Error(`stamp sheet: ${sheets[s].program.name} keeps its painting otherwise than ${first.program.name}, so the two can't be laid as one`);
  });
  const sampler = stampPaintSamplers(device).mirrorTile;
  const lays = sheets.map(({ program }, s) => createStampPaintLay(device, arena, { stage, compositor: compositors[s], paper: program.paper, photograph: photographs[s], blank, sampler, paperFrame }));
  return { stage, compositors, lays, painting };
}

/**
 * `owner`'s target `name` of `stage`'s size shaped as `shape`, sampled and `usage`, used by `encoder`'s work: whoever
 * lays into it overwrites all it reads.
 */
export function stampSheetCompositeTarget(owner: StampPaintGpuOwner, name: string, stage: StampStage, shape: StampPaintTarget, usage: number, encoder: GPUCommandEncoder) {
  const layers = shape.kind === 'array' ? shape.layers : 1;
  const texture = owner.target(`sheet composite ${name}`, { size: [stage.width, stage.height, layers], format: 'rgba16float', usage: usage | GPUTextureUsage.TEXTURE_BINDING }, encoder);
  return { texture, view: texture.createView({ dimension: shape.kind === 'array' ? '2d-array' : '2d' }), layers: Array.from({ length: layers }, (_, layer) => texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 })) };
}

/**
 * `composite`'s steps laid in `encoder` onto `painting` (a target the lays' compositors keep, `ground` laid on it: the
 * root's paper, or a measuring backing); a reserve or lift showing `ground` too; its cards lit by `light`, or unlit
 * for null (a readback). Lists a reveal's arrival map is drawn from are made through `device`, a scope's.
 */
function encodeStampSheetsSteps(
  owner: StampPaintGpuOwner, device: StampPaintDevice, encoder: GPUCommandEncoder, arena: StampUniformArena, composite: StampSheetsComposite,
  { stage, compositors, lays }: StampSheetsLays, painting: StampFadedTarget, ground: StampPaintBacking, light: PaintLight | null,
) {
  const revealing = createStampRevealPass(owner, device, stage), size = { width: stage.width, height: stage.height }, cardFilms = stampSheetsCardFilms(composite);
  const carding = light && createStampCardRelief(owner, { stage, arena });
  const lit = light ? stampCardReliefSteps(composite.steps.map((step): StampCardReliefStepIn => {
    if (step.kind === 'card') return { kind: 'card', sheet: step.sheet, look: composite.sheets[step.sheet].program.card };
    return step.kind === 'rim' ? step : { kind: 'other' };
  })) : [];
  const { shown } = composite, fade = shown?.fades.length ? createStampSpanFade(owner, arena) : null;
  const periodsOf = (s: number) => stampWrapPeriods(composite.sheets[s].program, composite.sheets[s].program.wrap);
  const rests = composite.sheets.map(({ place }, s) => {
    if (!place) return null;
    const rest = owner.target(`sheet composite rest ${s}`, { size: [stage.width, stage.height], format: 'rg32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }, encoder);
    const view = rest.createView();
    lays[s].drawPlacedRest(encoder, view, place.rest);
    return view;
  });
  const layStep = (step: StampSheetCompositeStep, index: number) => {
    const { films, place, reveals } = composite.sheets[step.sheet], rest = rests[step.sheet], lighting = lit[index];
    const onto = { compositor: compositors[step.sheet], painting: painting.view, light: light! };
    if (step.kind === 'rim') {
      if (carding && lighting?.kind === 'rim') carding.rim(encoder, lighting.level, onto);
      return;
    }
    if (step.kind === 'card') {
      const counted = cardFilms[step.sheet], cutting = { reveals: counted.map((f) => reveals[f] ?? []), pass: revealing, stage, size, periods: periodsOf(step.sheet) };
      const edge = stampCardCover(owner, device, encoder, arena, stampCardEdgeOf(composite.sheets[step.sheet].program), counted.map((f) => ({ film: films[f], shown: shown?.counted[step.sheet][f] ?? 1 })), cutting);
      const edgeBox = edge && stampStageTexelsOf(stage, edge.box);
      const box = edgeBox && (place ? placedBox(stage, edgeBox, place) : edgeBox);
      if (!edge || !edgeBox || !box) return;
      if (carding && lighting?.kind === 'cast') carding.cast(encoder, lighting, { kind: 'card', edge: edge.view, edgeBox, rest, box, mask: null }, onto);
      lays[step.sheet].layCard(encoder, { edge: edge.view, edgeBox, painting: painting.view, box, rest });
      return;
    }
    const opacity = shown?.opacity[index] ?? 1, film = films[step.film], filmBox = film.box && stampStageTexelsOf(stage, film.box);
    const box = filmBox && (place ? placedBox(stage, filmBox, place) : filmBox);
    if (opacity <= 0 || !filmBox || !box) return;
    const kept = keptStampSheetFilm(owner, film, encoder);
    if (!kept) return;
    const shape = compositors[step.sheet].targets.layer, usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
    const layer = stampSheetCompositeTarget(owner, `layer ${shape.kind === 'array' ? shape.layers : 1}`, stage, shape, usage, encoder);
    // A moved lay's taps read past the film's box: nothing an earlier film left there may show.
    if (place) for (const view of layer.layers) clearStampTarget(encoder, view);
    copyStampTextureBox(encoder, { texture: kept, x: 0, y: 0 }, { texture: layer.texture, x: filmBox.x, y: filmBox.y }, filmBox);
    const reveal = revealing.cut(encoder, arena, { links: reveals[step.film] ?? [], box: filmBox, size, periods: periodsOf(step.sheet) });
    lays[step.sheet].layGroup(encoder, { layer: layer.view, painting: painting.view, index: step.film, opacity, glaze: true, box, backing: ground, rest, paperFromRest: true, reveal });
  };
  const open: { last: number; visibility: number; kept: StampSpanKept }[] = [];
  composite.steps.forEach((step, index) => {
    for (const span of shown?.fades ?? []) if (span.first === index) open.push({ ...span, kept: fade!.keep(encoder, [painting], open.length) });
    layStep(step, index);
    // Inner spans close first: they were opened last.
    while (open.length && open.at(-1)!.last === index) {
      const { visibility, kept } = open.pop()!;
      fade!.mix(encoder, kept, visibility, { x: 0, y: 0, w: stage.width, h: stage.height });
    }
  });
}

/**
 * `composite` laid on its root's paper and shown on `surface`, the document's size, its cards catching `light`: a
 * painting's own still takes PAPER_KEY_LIGHT; a print another renderer lights (a three card's texture) takes null.
 */
export async function drawStampSheetsStill(surface: StampPaintSurface, composite: StampSheetsComposite, light: PaintLight | null): Promise<void> {
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
      const encoder = device.createCommandEncoder();
      const painting = stampSheetCompositeTarget(owner, 'painting', stage, lays.painting, GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, encoder);
      lays.lays[0].drawPaper(encoder, painting.view, 'paper', stage.width, stage.height);
      encodeStampSheetsSteps(owner, device, encoder, arena, composite, lays, { texture: painting.texture, shape: lays.painting, view: painting.view }, 'paper', light);
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
 * clear, measured on white and on black and read as C + T·b per channel (stampPlanePictureWgsl). Its cards cast no shadow and show no
 * rim: a rig's pieces are lit as they're posed. Each readback is counted into `costs`.
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
      const encoder = device.createCommandEncoder();
      const painting = stampSheetCompositeTarget(owner, 'painting', stage, lays.painting, GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, encoder);
      const pipeline =device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: lightWgsl(compositors[0], stage) }) } });
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
      // Each crop's light is measured into a texture of the scope's, freed with it once read: a crop is any size.
      const measure = (box: StampPixelBox) => {
        const light = device.createTexture({ size: [box.w, box.h], format: 'rgba16float', usage });
        dispatchStampCompute(device, encoder, pipeline, [painting.view, arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_SHEET_LIGHT, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
        }), light.createView()], box.w, box.h);
        return copyStampLayerForReadback(device, encoder, light, { x: 0, y: 0, w: box.w, h: box.h });
      };
      lays.lays[0].drawPaper(encoder, painting.view, backing, stage.width, stage.height);
      const texels = stampStageTexelsOf(stage, crop), groundCopy = measure({ x: texels.x, y: texels.y, w: 1, h: 1 });
      encodeStampSheetsSteps(owner, device, encoder, arena, composite, lays, { texture: painting.texture, shape: lays.painting, view: painting.view }, backing, null);
      const lightCopy = measure(texels);
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
