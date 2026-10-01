// stamp-gate-stage.ts: the gate's stage cases, what the renderer holds past and over a group's paint: the stage's
// margin (stamp-stage.ts). A margin must leave every frame as it was and show what a lay brings in from off the frame.

import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { stampBloom } from '#lib/paint/painting/models/stamp-wet-techniques.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_PAINTING_IDS, STAMP_GATE_WHITE, stampGateBrush, stampGatePainting, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { STAMP_GATE_ANIMATION_FPS, STAMP_GATE_KNOCKOUT_FAR, stampGateBloomBoilPainting, stampGateCutOutPainting, stampGateKnockoutPainting } from './stamp-gate-animation.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_REGION_IDS, stampGateRegionPaintings } from './stamp-gate-regions.ts';
import { STAMP_GATE_WASH_IDS, stampGateWashCase } from './stamp-gate-washes.ts';
import { stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from './stamp-gate-frames.ts';

export const STAMP_GATE_STAGE_IDS = ['stage/margin', 'stage/pan', 'stage/layer-cache'];

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
 * boiling on twos (its key's epoch changing), mid strokes painted over frames 1 to 3 and a near flood over 4 and 5
 * (frames drawn before they settle, which a cached layer must not stand for).
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
        pass.stroke(`reed${k}`, { brush: steady, size: 10, well: { paint: mixture(W.burntSienna) }, path: [{ x, y: 150 }, { x: x + 8, y: 70 }], reveal: { at: frameAt(1), over: frameAt(2) } });
      }
    }));
    p.group('near', { composite: 'opaque' }, (g) => g.passage('leaf', { wetHistory: false }, (pass) => pass.fill('leaf', {
      brush: steady, size: 20, application: { kind: 'flood' }, well: { paint: mixture(W.phthaloBlue) }, region: { kind: 'ellipse', x: 200, y: 130, radiusX: 40, radiusY: 22 }, reveal: { at: frameAt(4), over: frameAt(1) },
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
export function checkStampGateLayerCache(frames: readonly { frame: number; difference: StampGateFrameDifference }[], restores: number): StampGateWashCheck {
  const worst = frames.reduce((most, f) => (f.difference.max > most.difference.max ? f : most));
  return {
    id: 'stage/layer-cache: a frame laying cached layers is the frame drawn fresh, in any order', passed: worst.difference.max === 0 && restores > 0,
    detail: `${frames.length} frames in order ${STAMP_GATE_PARALLAX_ORDER.join(',')}: worst frame ${worst.frame}, max ${worst.difference.max}, mean ${worst.difference.mean.toFixed(4)} (past 0 fails); `
      + `${restores} layers copied back from the cache (none fails)`,
  };
}
