// stamp-gate-glaze.ts: the gate's glaze over a page (ENGINE 6.3, shot/page): a violet watercolour wash in a later
// canvas, laid over a coloured HTML block and the back's flat colour, and the same wash drawn in one canvas over a
// flat picture of each colour, which is what the page should show. What the check measures of them is here, pure.

import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedShotProps, PlaneProps } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';

/** Encoded sRGB bytes. */
export type StampGateRgb = readonly [number, number, number];

const GLAZE_FRAME = { width: 200, height: 140 } as const;
const { ultramarine, quinacridoneRose } = WATERCOLOUR_PIGMENTS;

/** The HTML block, frame px, and its colour: the frame's left half, a warm yellow, far in hue from the violet over it. */
export const STAMP_GATE_GLAZE_BLOCK: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rgb: StampGateRgb } = {
  x: 0, y: 0, width: 100, height: 140, rgb: [232, 196, 52],
};

/** The back's flat colour: a pale teal. */
export const STAMP_GATE_GLAZE_BACK: StampGateRgb = [168, 214, 204];

/** A box of the frame, px. */
export type StampGateGlazeBox = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/**
 * Where the check measures, frame px: the wash over the block and over the back, each clear of the wash's edge and
 * the block's, and the block and the back bare, clear of the wash's bleed.
 */
export const STAMP_GATE_GLAZE_REGIONS = {
  'glaze over the block': { x0: 36, y0: 36, x1: 88, y1: 104 },
  'glaze over the back': { x0: 112, y0: 36, x1: 164, y1: 104 },
  'the block bare': { x0: 2, y0: 30, x1: 14, y1: 110 },
  'the back bare': { x0: 186, y0: 30, x1: 198, y1: 110 },
} as const satisfies Record<string, StampGateGlazeBox>;
export type StampGateGlazeRegion = keyof typeof STAMP_GATE_GLAZE_REGIONS;

/** The wash: ultramarine and quinacridone rose flooded across the frame's middle, over the block's edge onto the back. */
const STAMP_GATE_GLAZE: PaintingSourceModule = {
  default: function gateGlaze(): PaintingDocument {
    return {
      widthPx: GLAZE_FRAME.width, heightPx: GLAZE_FRAME.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [stampGateHeronLayer('wash', stampGateHeronPolygon(24, 22, 176, 22, 176, 118, 24, 118), { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: quinacridoneRose, amount: 1 }], strength: 0.6 }, 0.7)],
    };
  },
};

const glazeWash = () => layersOf(painting(STAMP_GATE_GLAZE), ['wash']);

const glazeCamera = () => ({ stage: stampStage(GLAZE_FRAME, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [] });

/** A flat picture of `rgb` filling the whole stage: one picture, so it uploads once. */
function flatBack(rgb: StampGateRgb, canvas?: string): PlaneProps {
  const { width, height } = glazeCamera().stage, linear = rgb.map((v) => srgbToLinear(v / 255));
  const picture: StampPictureRgba = { box: { x: 0, y: 0, w: width, h: height }, rgba: new Float32Array(width * height * 4).map((_, i) => (i % 4 === 3 ? 1 : linear[i % 4])) };
  return { id: 'back', depth: 2, ...(canvas && { canvas }), source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: () => Promise.resolve(picture) } };
}

/** The glaze's canvases, in document order: the back's, and the wash's over the HTML block. */
export const STAMP_GATE_GLAZE_CANVASES = ['under', 'over'] as const;

/** The shot over the page: the back's flat colour in canvas `under`, the wash in canvas `over`, the HTML block between. */
export const stampGateGlazePageShot = (): PaintedShotProps => ({
  camera: glazeCamera(), planes: [flatBack(STAMP_GATE_GLAZE_BACK, 'under'), { id: 'wash', depth: 1, canvas: 'over', source: glazeWash() }],
});

/** The wash drawn in one canvas over a flat picture of `rgb`: what the page should show of it over that colour. */
export const stampGateGlazeOverShot = (rgb: StampGateRgb): PaintedShotProps => ({
  camera: glazeCamera(), planes: [flatBack(rgb), { id: 'wash', depth: 1, source: glazeWash() }],
});

/** `rgba`'s (a `width` px wide frame's bytes) mean colour in `box`, encoded, per channel. */
export function stampGateGlazeMean(rgba: ArrayLike<number>, width: number, { x0, y0, x1, y1 }: StampGateGlazeBox): StampGateRgb {
  const sum = [0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) sum[c] += rgba[(y * width + x) * 4 + c];
  }
  const count = (x1 - x0) * (y1 - y0);
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * How opaque a glaze is at each texel, 0 to 255 by luminance: its colour and filter images (RGBA bytes,
 * unpremultiplied, as the browser reads a canvas back) laid over white and over black as the page lays them, and what
 * passes between the two, in linear light, taken from 1.
 */
export function stampGateGlazeAlpha(colour: ArrayLike<number>, filter: ArrayLike<number>): Uint8ClampedArray {
  return Uint8ClampedArray.from({ length: colour.length / 4 }, (_, texel) => {
    const a = colour[texel * 4 + 3] / 255, under = filter[texel * 4 + 3] / 255;
    const passed = [0, 1, 2].map((c) => {
      const own = (a * colour[texel * 4 + c]) / 255, filtered = 1 - under + (under * filter[texel * 4 + c]) / 255;
      return srgbToLinear(own + (1 - a) * filtered) - srgbToLinear(own);
    });
    return Math.round(255 * (1 - luminance(passed)));
  });
}
