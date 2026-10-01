// stamp-gate-outside-layer.ts: the GPU gate's outside layer cases (outside/flat, outside/pigment). A painted ground,
// an outside layer of known colours laid over it (stamp-outside-layer.ts), and a painted group in front of that, in
// each compositor. Held to: each opaque colour showing as itself within a level (the pigment compositor lifting it into
// its bands and back); a half-transparent patch laid over the ground in linear light; the group in front covering it;
// the layer hidden drawing as a painting with none; and any frame order drawing the same frames.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { linearToSrgb, srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampOutsideLayerSlot } from '#lib/paint/painting/models/stamp-outside-layer.ts';
import { stampGateFrameDifference, stampGateFramePasses } from './stamp-gate-frames.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_WHITE, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

export const STAMP_GATE_OUTSIDE_IDS = ['outside/flat', 'outside/pigment'] as const;
export type StampGateOutsideKind = 'flat' | 'pigment';
/** The compositor case `id` names, or null for an id the gate has no case of. */
export const stampGateOutsideKind = (id: string): StampGateOutsideKind | null => ({ 'outside/flat': 'flat', 'outside/pigment': 'pigment' } as const)[id] ?? null;

export const STAMP_GATE_OUTSIDE_SIZE = { width: 240, height: 160 };
/** The outside layer's slot: beneath the painted group in front. */
export const STAMP_GATE_OUTSIDE_SLOT: StampOutsideLayerSlot = { id: 'card', beneath: 'front' };
/** How far an opaque colour may show from itself in bytes, in levels: the output's dither, half a level, rounds either way. */
export const STAMP_GATE_OUTSIDE_ROUND_TRIP = 1;
/** How far the half-transparent patch may sit from linear light's over, worked out from the hidden frame's bytes. */
export const STAMP_GATE_OUTSIDE_OVER = 2;

type Box = { x0: number; x1: number; y0: number; y1: number };
/** A patch of the outside layer: linear light, `alpha` its coverage (its colour premultiplied by it as laid). */
type Patch = { box: Box; rgb: readonly [number, number, number]; alpha: number };

/** Content `a`: opaque colours, one a near primary green the pigment lift takes past 0..1, a half-white, a patch under the front. */
const PATCHES_A: readonly Patch[] = [
  { box: { x0: 20, x1: 70, y0: 20, y1: 70 }, rgb: [0.8, 0.35, 0.05], alpha: 1 },
  { box: { x0: 80, x1: 130, y0: 20, y1: 70 }, rgb: [0.02, 0.3, 0.6], alpha: 1 },
  { box: { x0: 20, x1: 70, y0: 90, y1: 140 }, rgb: [0, 0.8, 0], alpha: 1 },
  { box: { x0: 80, x1: 130, y0: 90, y1: 140 }, rgb: [1, 1, 1], alpha: 0.5 },
  { box: { x0: 140, x1: 200, y0: 40, y1: 120 }, rgb: [0.7, 0.1, 0.5], alpha: 1 },
];
/** Content `b`: the same patches, their colours turned round, for the frame order. */
const PATCHES_B: readonly Patch[] = PATCHES_A.map((patch, i) => ({ ...patch, rgb: PATCHES_A[(i + 1) % PATCHES_A.length].rgb }));

/** Where the group in front lies, and its inside, clear of its brush's soft edge. */
const FRONT: Box = { x0: 150, x1: 230, y0: 20, y1: 140 };
const FRONT_INSIDE: Box = { x0: 162, x1: 218, y0: 32, y1: 128 };

/** The outside layer's content `which` as linear premultiplied rgba floats, row by row: nothing outside its patches. */
export function stampGateOutsideContent(which: 'a' | 'b'): Float32Array {
  const { width, height } = STAMP_GATE_OUTSIDE_SIZE, rgba = new Float32Array(width * height * 4);
  for (const { box, rgb, alpha } of which === 'a' ? PATCHES_A : PATCHES_B) {
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) rgba.set([rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha, alpha], (y * width + x) * 4);
  }
  return rgba;
}

const flood = (box: Box) => stampGatePolygon(box.x0, box.y0, box.x1, box.y0, box.x1, box.y1, box.x0, box.y1);

/** The painting: an opaque ground over the frame, then the group in front, in flat colour or watercolour. */
export function stampGateOutsidePainting(kind: StampGateOutsideKind): StampGatePainting {
  const round = stampGateBrush('Round', { flow: 0.8 });
  const paint = (flat: `#${string}`, pigments: PaintMaterial): PaintMaterial => (kind === 'flat' ? { kind: 'color', color: flat } : pigments);
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('ground', { composite: 'opaque' }, (g) => g.pass('flat', {}, (pass) => pass.fill('ground', {
      brush: round, diameter: 30, application: { kind: 'flood' }, region: flood({ x0: -20, x1: 260, y0: -20, y1: 180 }),
      material: paint('#7a8ea8', { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 0.6 }, { pigment: W.burntSienna, amount: 0.3 }], strength: 0.5 }),
    })));
    p.group('front', { composite: 'opaque' }, (g) => g.pass('block', {}, (pass) => pass.fill('block', {
      brush: round, diameter: 12, application: { kind: 'flood' }, region: flood(FRONT),
      material: paint('#3a2a1a', { kind: 'mixture', parts: [{ pigment: W.burntUmber, amount: 1 }], strength: 1 }),
    })));
  }));
  const mixing = kind === 'flat' ? { kind: 'flat' as const } : { kind: 'pigment' as const, medium: PAINT_MEDIA.gouache, pigments: W };
  return { painting, paper: STAMP_GATE_WHITE, mixing, ...STAMP_GATE_OUTSIDE_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

type Rgba = ArrayLike<number>;
const GATE_WIDTH = STAMP_GATE_OUTSIDE_SIZE.width;
const inset = ({ x0, x1, y0, y1 }: Box, by: number): Box => ({ x0: x0 + by, x1: x1 - by, y0: y0 + by, y1: y1 - by });
/** The largest channel difference over `box` between `frame` and `expected(x, y, channel)`, in levels. */
function farthest(frame: Rgba, box: Box, expected: (i: number, c: number) => number): number {
  let most = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = (y * GATE_WIDTH + x) * 4;
    for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(frame[i + c] - expected(i, c)));
  }
  return most;
}
/** Where a patch shows unhidden by the group in front, clear of its own edge. */
const shown = (box: Box): Box => inset({ ...box, x1: Math.min(box.x1, FRONT.x0) }, 2);
const sameBox = (a: Rgba, b: Rgba, box: Box) => farthest(a, box, (i, c) => b[i + c]);

/**
 * The checks of case `kind`, from its frames: `plain`, painted with no outside layer; `a`, `b`, `aAgain` drawn in turn
 * on one renderer with content a, b, a; `hidden`, content a at visibility 0; `bFresh`, content b on a renderer of its own.
 */
export function checkStampGateOutsideLayer(kind: StampGateOutsideKind, { plain, a, b, aAgain, hidden, bFresh }: Record<'plain' | 'a' | 'b' | 'aAgain' | 'hidden' | 'bFresh', Rgba>): StampGateWashCheck[] {
  const id = `outside/${kind}`;
  const opaque = PATCHES_A.filter(({ alpha }) => alpha === 1), half = PATCHES_A.find(({ alpha }) => alpha < 1)!;
  // Against the colour in bytes, as a screen shows it: the output's dither moves a pixel half a level either way.
  const roundTrips = opaque.map(({ box, rgb }) => farthest(a, shown(box), (_, c) => Math.round(255 * linearToSrgb(rgb[c]))));
  const over = farthest(a, shown(half.box), (i, c) => 255 * linearToSrgb(half.rgb[c] * half.alpha + srgbToLinear(hidden[i + c] / 255) * (1 - half.alpha)));
  const covered = sameBox(a, hidden, FRONT_INSIDE);
  const untouched = stampGateFrameDifference(hidden, plain), again = stampGateFrameDifference(a, aAgain), fresh = stampGateFrameDifference(b, bFresh);
  return [{
    id: `${id}: an outside layer's colours show as rendered, opaque and half covering`,
    passed: Math.max(...roundTrips) <= STAMP_GATE_OUTSIDE_ROUND_TRIP && over <= STAMP_GATE_OUTSIDE_OVER,
    detail: `opaque patches worst ${roundTrips.map((d) => d.toFixed(1)).join(', ')} levels (past ${STAMP_GATE_OUTSIDE_ROUND_TRIP} fails); half-white over the ground ${over.toFixed(1)} from linear over (past ${STAMP_GATE_OUTSIDE_OVER} fails)`,
  }, {
    id: `${id}: a painted group after an outside layer covers it, and a hidden one draws nothing`,
    passed: covered <= 1 && stampGateFramePasses(untouched),
    detail: `inside the front group, with the layer against hidden: max ${covered} (past 1 fails); hidden against no outside layer: max ${untouched.max}, mean ${untouched.mean.toFixed(4)}`,
  }, {
    id: `${id}: frames with an outside layer are the same in any order`,
    passed: stampGateFramePasses(again) && stampGateFramePasses(fresh),
    detail: `content a after b against before it: max ${again.max}, mean ${again.mean.toFixed(4)}; b after a against b cold: max ${fresh.max}, mean ${fresh.mean.toFixed(4)}`,
  }];
}
