// stamp-gate-stage.ts: the gate's stage cases, what the renderer holds past and over a group's paint: the stage's
// margin (stamp-stage.ts), and the films and planes' pictures it keeps between frames. A margin must leave every frame
// as it was and show what a lay brings in from off the frame; a kept film or picture must draw the frame drawn fresh.

import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { stampBloom } from '#lib/paint/painting/models/stamp-wet-techniques.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampScenePlanes, type StampLaidPlanes, type StampLensFrame } from '#lib/paint/painting/models/stamp-plane.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_PAINTING_IDS, STAMP_GATE_WHITE, stampGateBrush, stampGatePainting, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { STAMP_GATE_ANIMATION_FPS, STAMP_GATE_KNOCKOUT_FAR, stampGateBloomBoilPainting, stampGateCutOutPainting, stampGateKnockoutPainting } from './stamp-gate-animation.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_REGION_IDS, stampGateRegionPaintings } from './stamp-gate-regions.ts';
import { STAMP_GATE_WASH_IDS, stampGateWashCase } from './stamp-gate-washes.ts';
import { stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from './stamp-gate-frames.ts';

export const STAMP_GATE_STAGE_IDS = ['stage/margin', 'stage/pan', 'stage/film-cache'];
export const STAMP_GATE_PLANES_IDS = ['planes/cache', 'planes/one-sheet'];

/** The margin the stage cases draw with: past any gate painting's reach over its frame's edge, and even. */
export const STAMP_GATE_STAGE_MARGIN = 48;

/** A gate painting drawn at `t` in its frame state there, under `name`. */
export type StampGateStageSubject = { name: string; gate: StampGatePainting; t: number };

/** Frame `k`'s time at the animations' frame rate. */
const frameAt = (k: number) => k / STAMP_GATE_ANIMATION_FPS;

/**
 * What the margin case draws with and without a margin: every gate painting, every wash case's subject at its end,
 * and the animations that lay a group elsewhere (moved on its own paper or the ground's, warped, knocking out).
 */
export function stampGateMarginSubjects(): StampGateStageSubject[] {
  const at = frameAt;
  // No bend among them: a warp's lattice spans the group's painted box, which a margin lets run on past the frame, so
  // its cells, and how they sample the field, move with it.
  return [
    ...STAMP_GATE_PAINTING_IDS.map((id) => { const gate = stampGatePainting(id); return { name: `painting/${id}`, gate, t: gate.t }; }),
    ...STAMP_GATE_WASH_IDS.map((id) => { const { subject } = stampGateWashCase(id); return { name: id, gate: subject, t: subject.t }; }),
    ...STAMP_GATE_REGION_IDS.flatMap((id) => stampGateRegionPaintings(id).map((gate, i) => ({ name: `${id} ${i}`, gate, t: gate.t }))),
    { name: 'animation/cut-out own', gate: stampGateCutOutPainting('own'), t: at(2) },
    { name: 'animation/cut-out ground', gate: stampGateCutOutPainting('ground'), t: at(2) },
    { name: 'animation/warp', gate: stampGateCutOutPainting('own', 'warp'), t: at(2) },
    { name: 'animation/knockout far', gate: stampGateKnockoutPainting(), t: at(STAMP_GATE_KNOCKOUT_FAR) },
    { name: 'animation/bloom-boil', gate: stampGateBloomBoilPainting(), t: at(1) },
  ];
}

/**
 * How far in from the frame's edges the margin case compares, px. Paint reaching the frame's edge stops there without
 * a margin and runs on past it with one: its blur, flow, blooms and rims then differ near the edge, as they should.
 */
export const STAMP_GATE_MARGIN_INSET = 32;

/** How two RGBA frames `width` × `height` differ, as RGB, at least STAMP_GATE_MARGIN_INSET px from every edge. */
export function stampGateInsetDifference(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number): StampGateFrameDifference {
  const inset = (rgba: ArrayLike<number>) => {
    const kept: number[] = [];
    for (let y = STAMP_GATE_MARGIN_INSET; y < height - STAMP_GATE_MARGIN_INSET; y++) {
      for (let x = STAMP_GATE_MARGIN_INSET; x < width - STAMP_GATE_MARGIN_INSET; x++) for (let c = 0; c < 3; c++) kept.push(rgba[(y * width + x) * 4 + c]);
    }
    return kept;
  };
  return stampGateFrameDifference(inset(a), inset(b));
}

/** Whether every subject's frame drawn with a margin is its frame without within the inset, as close as a draw is to itself. */
export function checkStampGateMargin(subjects: readonly { name: string; difference: StampGateFrameDifference }[]): StampGateWashCheck {
  const failed = subjects.filter(({ difference }) => !stampGateFramePasses(difference));
  const worst = subjects.reduce((most, s) => (s.difference.max > most.difference.max ? s : most));
  return {
    id: `stage/margin: a ${STAMP_GATE_STAGE_MARGIN} px margin leaves every frame as it was, ${STAMP_GATE_MARGIN_INSET} px in`, passed: failed.length === 0,
    detail: `${subjects.length} frames; worst ${worst.name}: max ${worst.difference.max}, mean ${worst.difference.mean.toFixed(4)}; `
      + `${subjects.filter(({ difference }) => difference.max === 0).length} identical${failed.length ? `; failed ${failed.map(({ name, difference }) => `${name} (max ${difference.max}, mean ${difference.mean.toFixed(4)})`).join(', ')}` : ''}`,
  };
}

/** How far the pan moves the band, px: it brings in the band's left end, painted off the frame. */
export const STAMP_GATE_PAN = 40;
const PAN_SIZE = { width: 160, height: 100 };

/**
 * A band of flat strokes and a still ground. `off-frame`: the band painted from x -36, laid STAMP_GATE_PAN px right;
 * `on-frame`: painted that far right already, unmoved. Flat colour on plain paper, nothing read at a painting point
 * (grain, tooth, noise), so the two are one frame wherever the band is painted.
 */
export function stampGatePanPainting(authored: 'off-frame' | 'on-frame'): StampGatePainting {
  const dx = authored === 'on-frame' ? STAMP_GATE_PAN : 0;
  const brush = stampGateBrush('Pan', { flow: 0.7 });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' } }, (p) => {
    p.group('ground', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => pass.stroke('ground', {
      brush, size: 14, well: { paint: { kind: 'color', color: '#6a3a1a' } }, path: [{ x: 6, y: 88 }, { x: 154, y: 86 }],
    })));
    p.group('band', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
      for (const [k, y] of [24, 44, 64].entries()) {
        pass.stroke(`band${k}`, { brush, size: 16, well: { paint: { kind: 'color', color: (['#2a4d8f', '#8f2a4d', '#2a8f4d'] as const)[k] } }, path: [{ x: -36 + dx, y }, { x: 10 + dx, y: y + 6 }, { x: 70 + dx, y }] });
      }
    }));
  }));
  const panned = authored === 'off-frame'
    ? { frameAt: (): StampPaintFrameState => new Map([['band', { lay: { placement: { x: STAMP_GATE_PAN, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }]]) }
    : {};
  return { painting, ...PAN_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES, ...panned };
}

/** The band's rows, above the ground's stroke. */
const BAND_ROWS = 76;

/** The darkest any channel is in the band's rows of columns 0 … `columns` of an RGBA frame `width` wide. */
function darkestIn(rgba: ArrayLike<number>, width: number, columns: number) {
  let darkest = 255;
  for (let y = 0; y < BAND_ROWS; y++) for (let x = 0; x < columns; x++) for (let c = 0; c < 3; c++) darkest = Math.min(darkest, rgba[(y * width + x) * 4 + c]);
  return darkest;
}

/**
 * Whether the pan, drawn with a margin, is the band painted where it lands (`panned` against `onFrame`), and without
 * one shows bare paper where the band came in from off the frame (`bare`), so it's the margin that holds it.
 */
export function checkStampGatePan({ panned, onFrame, bare, difference }: { panned: ArrayLike<number>; onFrame: ArrayLike<number>; bare: ArrayLike<number>; difference: StampGateFrameDifference }): StampGateWashCheck {
  const columns = STAMP_GATE_PAN - 4, shown = darkestIn(panned, PAN_SIZE.width, columns), lost = darkestIn(bare, PAN_SIZE.width, columns), there = darkestIn(onFrame, PAN_SIZE.width, columns);
  return {
    id: 'stage/pan: a lay brings in what the margin holds', passed: stampGateFramePasses(difference) && shown < 200 && lost >= 250,
    detail: `panned with a ${STAMP_GATE_STAGE_MARGIN} px margin against the band painted where it lands: max ${difference.max}, mean ${difference.mean.toFixed(4)}; `
      + `darkest in the ${columns} columns it brings in: ${shown} (painted there ${there}; over 200 fails), without a margin ${lost} (under 250 fails)`,
  };
}

/** The parallax's frames, at the animations' frame rate, in the scrambled order one renderer draws them: some twice. */
export const STAMP_GATE_PARALLAX_ORDER = [7, 2, 11, 0, 9, 4, 11, 5, 10, 1, 8, 3, 6, 9];

/** Frame `k` of the parallax's time. */
export const stampGateParallaxTime = frameAt;

const mixture = (pigment: (typeof W)[keyof typeof W]) => ({ kind: 'mixture' as const, parts: [{ pigment, amount: 1 }], strength: 0.8 });

/**
 * Three groups under a camera panning and pushing in, each laid by its depth every frame: a far wash with a bloom
 * boiling on twos (its key's epoch changing), mid strokes and a near flood.
 */
export function stampGateParallaxPainting(): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } }, (p) => {
    p.group('far', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (g) => g.passage('sky', {}, (w) => {
      w.fill('sky', { brush: steady, size: 40, application: { kind: 'flood' }, region: stampGatePolygon(-20, 0, 260, 0, 260, 110, -20, 110), well: { paint: mixture(W.ultramarine) } });
      stampBloom(w, 'drop', { brush: steady, size: 30, at: [{ x: 120, y: 60 }] });
    }));
    p.group('mid', { composite: 'glaze', opacity: 1 }, (g) => g.passage('reeds', { wetHistory: false }, (pass) => {
      for (const [k, x] of [40, 110, 180].entries()) {
        pass.stroke(`reed${k}`, { brush: steady, size: 10, well: { paint: mixture(W.burntSienna) }, path: [{ x, y: 150 }, { x: x + 8, y: 70 }] });
      }
    }));
    p.group('near', { composite: 'opaque' }, (g) => g.passage('leaf', { wetHistory: false }, (pass) => pass.fill('leaf', {
      brush: steady, size: 20, application: { kind: 'flood' }, well: { paint: mixture(W.phthaloBlue) }, region: { kind: 'ellipse', x: 200, y: 130, radiusX: 40, radiusY: 22 },
    })));
  }));
  const depths = { far: 0.2, mid: 0.6, near: 1 };
  const parallax = (t: number): StampPaintFrameState => new Map(Object.entries(depths).map(([id, depth]) => [id, {
    lay: { placement: { x: -36 * depth * t * STAMP_GATE_ANIMATION_FPS / 11, y: 3 * depth * Math.sin(t * 9), rotation: 0, scale: 1 + 0.04 * depth * t }, pivot: { x: 120, y: 80 } },
  }]));
  return { painting, width: 240, height: 160, t: 0, images: STAMP_GATE_IMAGES, frameAt: parallax };
}

/**
 * Whether every parallax frame one renderer drew in scrambled order, its settled groups' layers from its cache, is the
 * frame a fresh renderer draws, exactly, and the cache stood for some of them (`restores`).
 */
export function checkStampGateFilmCache(frames: readonly { frame: number; difference: StampGateFrameDifference }[], restores: number): StampGateWashCheck {
  const worst = frames.reduce((most, f) => (f.difference.max > most.difference.max ? f : most));
  return {
    id: 'stage/film-cache: a frame laying cached films is the frame drawn fresh, in any order', passed: worst.difference.max === 0 && restores > 0,
    detail: `${frames.length} frames in order ${STAMP_GATE_PARALLAX_ORDER.join(',')}: worst frame ${worst.frame}, max ${worst.difference.max}, mean ${worst.difference.mean.toFixed(4)} (past 0 fails); `
      + `${restores} films copied back from the cache (none fails)`,
  };
}

/** The planes case's near flood. */
const PLANES_LEAF = { kind: 'ellipse' as const, x: 170, y: 110, radiusX: 44, radiusY: 26 };

/**
 * A wash at the back boiling on twos, as the parallax's far one does, and a still flood on a nearer plane, covering
 * as far as it's painted: the back's picture is painted again as its epoch changes, the near one's restored from the cache.
 */
export function stampGatePlanesPainting(): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } }, (p) => {
    p.group('far', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (g) => g.passage('sky', {}, (w) => {
      w.fill('sky', { brush: steady, size: 40, application: { kind: 'flood' }, region: stampGatePolygon(-40, -20, 280, -20, 280, 110, -40, 110), well: { paint: mixture(W.ultramarine) } });
      stampBloom(w, 'drop', { brush: steady, size: 30, at: [{ x: 120, y: 60 }] });
    }));
    p.group('near', { composite: 'opaque' }, (g) => g.passage('leaf', { wetHistory: false }, (pass) => pass.fill('leaf', {
      brush: steady, size: 20, application: { kind: 'flood' }, well: { paint: mixture(W.phthaloBlue) }, region: PLANES_LEAF,
    })));
  }));
  return { painting, width: 240, height: 160, t: 0, images: STAMP_GATE_IMAGES };
}


/** The planes case's planes: the far wash at the back, the near flood on a clear plane of its own. */
export function stampGatePlanesOf(painting: CompiledStampPaint): StampLaidPlanes {
  const problems: string[] = [];
  const planes = stampScenePlanes(painting, [
    { id: 'back', depth: 2, source: { kind: 'painted', groups: ['far'] } },
    { id: 'near', depth: 1, source: { kind: 'painted', groups: ['near'] } },
  ], problems);
  if (!planes || problems.length) throw new Error(`stamp gate: the planes case's planes: ${problems.join('; ')}`);
  return planes;
}

/**
 * Frame `k`'s lens, as a camera panning left would give it: the back pans with k, slightly out of focus; the near
 * plane pans faster and grows about the frame's centre, as a nearer plane does.
 */
export function stampGatePlanesLens(k: number): StampLensFrame {
  const grown = 1 + 0.01 * k;
  return {
    planes: new Map([
      ['back', { view: { ma: 1, mb: 0, kx: -2 * k, ky: 0.5 * k }, defocus: 1.5 }],
      ['near', { view: { ma: grown, mb: 0, kx: -5 * k + (1 - grown) * 120, ky: (1 - grown) * 80 }, defocus: 0 }],
    ]),
    bloom: 0,
  };
}

/**
 * Whether every frame one renderer drew through a moving camera in scrambled order, some pictures from its cache, is
 * the frame a fresh renderer draws, and the cache stood for some pictures (`restores`).
 */
export function checkStampGatePictureCache(frames: readonly { frame: number; difference: StampGateFrameDifference }[], restores: number): StampGateWashCheck {
  const worst = frames.reduce((most, f) => (f.difference.max > most.difference.max ? f : most));
  return {
    id: `planes/cache: a camera's frame laying cached pictures is the frame drawn fresh, in any order`, passed: frames.every(({ difference }) => stampGateFramePasses(difference)) && restores > 0,
    detail: `${frames.length} frames in order ${STAMP_GATE_PARALLAX_ORDER.join(',')}: worst frame ${worst.frame}, max ${worst.difference.max}, mean ${worst.difference.mean.toFixed(4)}; `
      + `${restores} pictures restored from the cache (none fails)`,
  };
}

type SheetBox = { x0: number; x1: number; y0: number; y1: number };

/** The one-sheet case's backs, a mid-grey and a saturated red side by side, and its films, each crossing both. */
const SHEET_BACKS = { grey: { x0: -30, x1: 120, y0: -30, y1: 190 }, red: { x0: 120, x1: 270, y0: -30, y1: 190 } } as const;
const SHEET_FILMS = { glaze: { x0: 30, x1: 210, y0: 18, y1: 68 }, gouache: { x0: 30, x1: 210, y0: 92, y1: 142 } } as const;
/** Where between the films nothing of the near plane's lies. */
const SHEET_BARE: SheetBox = { x0: 40, x1: 200, y0: 77, y1: 83 };
/** How far in from a flood's edge the case reads, past its soft edge and its neighbour's. */
const SHEET_INSET = 10;
const SHEET_SIZE = { width: 240, height: 160 };

/**
 * A back plane of watercolour floods, mid-grey and saturated red, and nearer, a clear phthalo glaze and a thin,
 * semi-opaque ochre gouache film across both. `planes/one-sheet` draws it on two planes and on one sheet.
 */
export function stampGateOneSheetPainting(): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 });
  const flood = (box: SheetBox, paint: ReturnType<typeof mixture>) => ({
    brush: steady, size: 20, application: { kind: 'flood' as const }, region: stampGatePolygon(box.x0, box.y0, box.x1, box.y0, box.x1, box.y1, box.x0, box.y1), well: { paint },
  });
  const grey = { kind: 'mixture' as const, parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntUmber, amount: 1 }], strength: 0.45 };
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } }, (p) => {
    p.group('grey', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', { wetHistory: false }, (pass) => pass.fill('grey', flood(SHEET_BACKS.grey, grey))));
    p.group('red', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', { wetHistory: false }, (pass) => pass.fill('red', flood(SHEET_BACKS.red, mixture(W.cadmiumRed)))));
    p.group('glaze', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', { wetHistory: false }, (pass) => pass.fill('glaze', flood(SHEET_FILMS.glaze, { ...mixture(W.phthaloBlue), strength: 0.3 }))));
    p.group('gouache', { composite: 'glaze', opacity: 0.3, mixing: { kind: 'pigment', medium: PAINT_MEDIA.gouache, pigments: W } }, (g) => g.passage('p', { wetHistory: false }, (pass) => (
      pass.fill('gouache', flood(SHEET_FILMS.gouache, { ...mixture(W.yellowOchre), strength: 0.2 }))
    )));
  }));
  return { painting, ...SHEET_SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

/** The one-sheet case's planes: the backs at depth 2, the films on a clear plane at 1. */
export function stampGateOneSheetPlanes(painting: CompiledStampPaint): StampLaidPlanes {
  const problems: string[] = [];
  const planes = stampScenePlanes(painting, [
    { id: 'back', depth: 2, source: { kind: 'painted', groups: ['grey', 'red'] } },
    { id: 'films', depth: 1, source: { kind: 'painted', groups: ['glaze', 'gouache'] } },
  ], problems);
  if (!planes || problems.length) throw new Error(`stamp gate: the one-sheet case's planes: ${problems.join('; ')}`);
  return planes;
}

/**
 * The most levels each film over each back, drawn as planes, may lie from the same groups on one sheet. The
 * two-backing measure is exact over white and black only; per RGB channel it misses how a strongly coloured glaze
 * filters coloured paint band by band. Measured 76, 29, 4 and 8 when set: kept visible, and from growing.
 */
export const STAMP_GATE_ONE_SHEET_BOUNDS = {
  glaze: { grey: 90, red: 40 },
  gouache: { grey: 8, red: 14 },
} as const satisfies Record<keyof typeof SHEET_FILMS, Record<keyof typeof SHEET_BACKS, number>>;

/** `a` against `b` (RGBA frames `width` wide) over `box`, RGB: the most and mean levels apart. */
function boxDifference(a: ArrayLike<number>, b: ArrayLike<number>, width: number, { x0, x1, y0, y1 }: SheetBox) {
  let max = 0, sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) {
    const i = (y * width + x) * 4 + c, d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    n++;
  }
  return { max, mean: sum / n };
}

/** Where `a` and `b` meet on the frame, SHEET_INSET in from each edge. */
const insetMeet = (a: SheetBox, b: SheetBox): SheetBox => ({
  x0: Math.max(a.x0, b.x0, 0) + SHEET_INSET, x1: Math.min(a.x1, b.x1, SHEET_SIZE.width) - SHEET_INSET,
  y0: Math.max(a.y0, b.y0, 0) + SHEET_INSET, y1: Math.min(a.y1, b.y1, SHEET_SIZE.height) - SHEET_INSET,
});

/**
 * Whether the films drawn as a clear plane over the backs (`planes`) are the same groups on one sheet (`sheet`) where
 * the plane is bare (a level of rounding), and within STAMP_GATE_ONE_SHEET_BOUNDS over each back.
 */
export function checkStampGateOneSheet({ planes, sheet }: { planes: ArrayLike<number>; sheet: ArrayLike<number> }): StampGateWashCheck {
  const { width } = SHEET_SIZE, bare = boxDifference(planes, sheet, width, SHEET_BARE);
  const rows = (['glaze', 'gouache'] as const).flatMap((film) => (['grey', 'red'] as const).map((back) => {
    const { max, mean } = boxDifference(planes, sheet, width, insetMeet(SHEET_FILMS[film], SHEET_BACKS[back]));
    return { film, back, bound: STAMP_GATE_ONE_SHEET_BOUNDS[film][back], max, mean };
  }));
  return {
    id: 'planes/one-sheet: a clear plane over paint is its groups on one sheet where bare, and within bounds where its films lie',
    passed: bare.max <= 1 && rows.every(({ max, bound }) => max <= bound),
    detail: `bare: max ${bare.max}, mean ${bare.mean.toFixed(3)} (past 1 fails); `
      + rows.map(({ film, back, max, mean, bound }) => `${film} over ${back}: max ${max}, mean ${mean.toFixed(2)} (past ${bound} fails)`).join('; '),
  };
}
