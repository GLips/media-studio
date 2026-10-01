// stamp-gate-three-plane.ts: the GPU gate's three-plane cases (three/flat, three/pigment, three/defocus). A painted
// ground at the back, a three.js plane of known colours before it (stamp-plane.ts), its texture written by the gate,
// and a painted plane in front, an opaque box on clear film, in each compositor. Held to: each opaque colour showing as itself
// within a level; a half-transparent patch laid over the ground in linear light; the front plane covering it; an
// all-clear texture drawing as the planes without it; any frame order drawing the same frames; and the lens's defocus
// as the content blurred on the CPU.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { linearToSrgb, srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { stampDefocusSigmaStepped } from '#lib/paint/painting/models/stamp-defocus.ts';
import { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { compileStampPlanes, type CompiledStampPlanes, type StampLensFrame, type StampPlane } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampGateFrameDifference, stampGateFramePasses } from './stamp-gate-frames.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_WHITE, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { STAMP_GATE_DEFOCUS_TOLERANCE, STAMP_GATE_REST_LOOK, stampGateGaussian } from './stamp-gate-lens.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_THREE_IDS = ['three/defocus', 'three/flat', 'three/pigment'] as const;
export type StampGateThreeKind = 'flat' | 'pigment';
/** The compositor case `id` names, or null for one that isn't a compositor case. */
export const stampGateThreeKind = (id: string): StampGateThreeKind | null => ({ 'three/flat': 'flat', 'three/pigment': 'pigment' } as const)[id] ?? null;

export const STAMP_GATE_THREE_SIZE = { width: 240, height: 160 };
/** The three plane's id. */
export const STAMP_GATE_CARD = 'card';
/** How far an opaque colour may show from itself in bytes, in levels: the output's dither, half a level, rounds either way. */
export const STAMP_GATE_THREE_ROUND_TRIP = 1;
/** How far the half-transparent patch may sit from linear light's over, worked out from the all-clear frame's bytes. */
export const STAMP_GATE_THREE_OVER = 2;
/** The card's defocus in the defocus case, frame px. */
export const STAMP_GATE_THREE_DEFOCUS = 3;

type Box = { x0: number; x1: number; y0: number; y1: number };
/** A patch of the card: linear light, `alpha` its coverage (its colour premultiplied by it as laid). */
type Patch = { box: Box; rgb: readonly [number, number, number]; alpha: number };

/** Content `a`: opaque colours, one a near primary green, a half-white, a patch under the front. */
const PATCHES_A: readonly Patch[] = [
  { box: { x0: 20, x1: 70, y0: 20, y1: 70 }, rgb: [0.8, 0.35, 0.05], alpha: 1 },
  { box: { x0: 80, x1: 130, y0: 20, y1: 70 }, rgb: [0.02, 0.3, 0.6], alpha: 1 },
  { box: { x0: 20, x1: 70, y0: 90, y1: 140 }, rgb: [0, 0.8, 0], alpha: 1 },
  { box: { x0: 80, x1: 130, y0: 90, y1: 140 }, rgb: [1, 1, 1], alpha: 0.5 },
  { box: { x0: 140, x1: 200, y0: 40, y1: 120 }, rgb: [0.7, 0.1, 0.5], alpha: 1 },
];
/** Content `b`: the same patches, their colours turned round, for the frame order. */
const PATCHES_B: readonly Patch[] = PATCHES_A.map((patch, i) => ({ ...patch, rgb: PATCHES_A[(i + 1) % PATCHES_A.length].rgb }));

/** The front plane's opaque box, and its inside, clear of its edge. */
const FRONT: Box = { x0: 150, x1: 230, y0: 20, y1: 140 };
const FRONT_INSIDE: Box = { x0: 162, x1: 218, y0: 32, y1: 128 };

/** The card's content `which` as linear premultiplied rgba floats, row by row: nothing outside its patches. */
export function stampGateThreeContent(which: 'a' | 'b'): Float32Array {
  const { width, height } = STAMP_GATE_THREE_SIZE, rgba = new Float32Array(width * height * 4);
  for (const { box, rgb, alpha } of which === 'a' ? PATCHES_A : PATCHES_B) {
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) rgba.set([rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha, alpha], (y * width + x) * 4);
  }
  return rgba;
}

/**
 * Content a as the lens defocuses it, worked out on the CPU: premultiplied, so a patch fades into clear, at the sigma
 * the renderer steps the defocus to.
 */
export function stampGateThreeContentBlurred(): Float64Array {
  const { width, height } = STAMP_GATE_THREE_SIZE;
  return stampGateGaussian(stampGateThreeContent('a'), width, height, 4, stampDefocusSigmaStepped(STAMP_GATE_THREE_DEFOCUS), 0);
}

/** The defocus case's lens: the card STAMP_GATE_THREE_DEFOCUS px out of focus. */
export const STAMP_GATE_THREE_DEFOCUS_LENS: StampLensFrame = { planes: new Map([[STAMP_GATE_CARD, { ...STAMP_GATE_REST_LOOK, defocus: STAMP_GATE_THREE_DEFOCUS }]]), bloom: 0 };

const flood = (box: Box) => stampGatePolygon(box.x0, box.y0, box.x1, box.y0, box.x1, box.y1, box.x0, box.y1);

/** The painting: an opaque ground over the frame and a group in front, in flat colour or watercolour. */
export function stampGateThreePainting(kind: StampGateThreeKind): StampGatePainting {
  const round = stampGateBrush('Round', { flow: 0.8 });
  const paint = (flat: `#${string}`, pigments: PaintMaterial): PaintMaterial => (kind === 'flat' ? { kind: 'color', color: flat } : pigments);
  const mixing = kind === 'flat' ? { kind: 'flat' as const } : { kind: 'pigment' as const, medium: PAINT_MEDIA.gouache, pigments: W };
  // Gouache keeps a wet history its passages give up, as these were laid by the direct law; flat colour has none to give.
  const direct = kind === 'flat' ? {} : { wetHistory: false as const };
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing }, (p) => {
    p.group('ground', { composite: 'opaque' }, (g) => g.passage('flat', direct, (pass) => pass.fill('ground', {
      brush: round, size: 30, application: { kind: 'flood' }, region: flood({ x0: -20, x1: 260, y0: -20, y1: 180 }),
      well: { paint: paint('#7a8ea8', { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 0.6 }, { pigment: W.burntSienna, amount: 0.3 }], strength: 0.5 }) },
    })));
    p.group('front', { composite: 'opaque' }, (g) => g.passage('block', direct, (pass) => pass.fill('block', {
      brush: round, size: 12, application: { kind: 'flood' }, region: flood(FRONT),
      well: { paint: paint('#3a2a1a', { kind: 'mixture', parts: [{ pigment: W.burntUmber, amount: 1 }], strength: 1 }) },
    })));
  }));
  return { painting, ...STAMP_GATE_THREE_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/**
 * The painting's planes: the ground at the back, the card before it when `card`, and the front's box on clear film.
 * Without the card they're what an all-clear card should draw as.
 */
export function stampGateThreePlanes(painting: CompiledStampPaint, { card }: { card: boolean }): CompiledStampPlanes {
  const problems: string[] = [];
  const planes: StampPlane[] = [
    { id: 'ground', depth: 2, source: { kind: 'painted', groups: ['ground'] } },
    ...(card ? [{ id: STAMP_GATE_CARD, depth: 1, source: { kind: 'three' } } as const] : []),
    { id: 'front', depth: 0.8, source: { kind: 'painted', groups: ['front'] } },
  ];
  const compiled = compileStampPlanes(painting, planes, problems);
  if (!compiled || problems.length) throw new Error(`stamp gate: the three-plane case's planes: ${problems.join('; ')}`);
  return compiled;
}

type Rgba = ArrayLike<number>;
const GATE_WIDTH = STAMP_GATE_THREE_SIZE.width;
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
/** Where a patch shows unhidden by the front plane, clear of its own edge. */
const shown = (box: Box): Box => inset({ ...box, x1: Math.min(box.x1, FRONT.x0) }, 2);
const sameBox = (a: Rgba, b: Rgba, box: Box) => farthest(a, box, (i, c) => b[i + c]);

/**
 * The checks of case `kind`, from its frames: `plain`, the planes with no card; `a`, `b`, `aAgain`, `clear` drawn in
 * turn on one renderer with content a, b, a and none; `bFresh`, content b on a renderer of its own.
 */
export function checkStampGateThreePlane(kind: StampGateThreeKind, { plain, a, b, aAgain, clear, bFresh }: Record<'plain' | 'a' | 'b' | 'aAgain' | 'clear' | 'bFresh', Rgba>): StampGateWashCheck[] {
  const id = `three/${kind}`;
  const opaque = PATCHES_A.filter(({ alpha }) => alpha === 1), half = PATCHES_A.find(({ alpha }) => alpha < 1)!;
  // Against the colour in bytes, as a screen shows it: the output's dither moves a pixel half a level either way.
  const roundTrips = opaque.map(({ box, rgb }) => farthest(a, shown(box), (_, c) => Math.round(255 * linearToSrgb(rgb[c]))));
  const over = farthest(a, shown(half.box), (i, c) => 255 * linearToSrgb(half.rgb[c] * half.alpha + srgbToLinear(clear[i + c] / 255) * (1 - half.alpha)));
  const covered = sameBox(a, clear, FRONT_INSIDE);
  const untouched = stampGateFrameDifference(clear, plain), again = stampGateFrameDifference(a, aAgain), fresh = stampGateFrameDifference(b, bFresh);
  return [{
    id: `${id}: a three plane's colours show as rendered, opaque and half covering`,
    passed: Math.max(...roundTrips) <= STAMP_GATE_THREE_ROUND_TRIP && over <= STAMP_GATE_THREE_OVER,
    detail: `opaque patches worst ${roundTrips.map((d) => d.toFixed(1)).join(', ')} levels (past ${STAMP_GATE_THREE_ROUND_TRIP} fails); half-white over the ground ${over.toFixed(1)} from linear over (past ${STAMP_GATE_THREE_OVER} fails)`,
  }, {
    id: `${id}: a nearer plane's opaque paint covers a three plane, and an all-clear one draws nothing`,
    passed: covered <= 1 && stampGateFramePasses(untouched),
    detail: `inside the front plane, with content a against all clear: max ${covered} (past 1 fails); all clear against no three plane: max ${untouched.max}, mean ${untouched.mean.toFixed(4)}`,
  }, {
    id: `${id}: frames with a three plane are the same in any order`,
    passed: stampGateFramePasses(again) && stampGateFramePasses(fresh),
    detail: `content a after b against before it: max ${again.max}, mean ${again.mean.toFixed(4)}; b after a against b cold: max ${fresh.max}, mean ${fresh.mean.toFixed(4)}`,
  }];
}

/**
 * Whether the card defocused through the lens (`blurred`) lays as its content blurred on the CPU and laid sharp
 * (`cpuBlurred`), within a defocus's tolerance, and visibly unlike the card laid sharp (`sharp`).
 */
export function checkStampGateThreeDefocus({ blurred, cpuBlurred, sharp }: Record<'blurred' | 'cpuBlurred' | 'sharp', Rgba>): StampGateWashCheck {
  const twin = stampGateFrameDifference(blurred, cpuBlurred), unlike = stampGateFrameDifference(sharp, blurred);
  return {
    id: 'three/defocus: a three plane defocuses as its content blurred',
    passed: twin.max <= STAMP_GATE_DEFOCUS_TOLERANCE && unlike.max > 40,
    detail: `defocused ${STAMP_GATE_THREE_DEFOCUS} px against its content blurred on the CPU: max ${twin.max} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails), against sharp ${unlike.max} (40 or under fails)`,
  };
}
