// stamp-gate-in-time.ts: the gate's painting in time (shot/properties-in-time). A ridge under a sky, its top swept
// down over a second and back up a little over the next, a property of the painting on a step of 5 px: the shot keys
// its first and last moments, where the sweep turns and between, at most four drawings, and draws every frame from
// those. What its checks draw and read is here; stamp-gate-in-time-page.ts measures it.

import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import type { PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { paintingInTime } from '#lib/paint/shot/models/shot-painting-in-time.ts';
import type { ShotKeyReason } from '#lib/paint/shot/models/shot-key-drawings.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const RIDGE_FRAME = { width: 200, height: 140 } as const;
const { cerulean, burntUmber, phthaloGreen } = WATERCOLOUR_PIGMENTS;

const ridgeProperties = {
  ridgeTopPx: { type: 'number', unit: 'px down the sheet', min: 30, max: 110, step: 5, default: 80 },
} as const satisfies PropertySchema;

/** A sky over the sheet, and once it's dry a ridge rising to `ridgeTopPx` on its left shoulder. */
export const STAMP_GATE_RIDGE: PaintingSourceModule<typeof ridgeProperties> = {
  properties: ridgeProperties,
  default: function gateRidge({ ridgeTopPx: top }: PropertyValues<typeof ridgeProperties>): PaintingDocument {
    const { width, height } = RIDGE_FRAME;
    return {
      widthPx: width, heightPx: height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, width, 0, width, height, 0, height), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.45 }, 0.8),
        stampGateHeronLayer(
          'ridge', stampGateHeronPolygon(0, top + 14, 64, top, width, top + 22, width, height, 0, height),
          { parts: [{ pigment: burntUmber, amount: 1 }, { pigment: phthaloGreen, amount: 0.4 }], strength: 0.6 }, 0.7, 'dry',
        ),
      ],
    };
  },
};

/** The ridge's sweep, px: down from 100 to 50 by 1 s, back to 70 by 2 s. */
const RIDGE_SWEEP = paintKeyed([{ at: 0, value: 100 }, { at: 1, value: 50 }, { at: 2, value: 70 }]);

/** The drawings the sweep may solve. */
export const STAMP_GATE_RIDGE_DRAWINGS = 4;

/**
 * The frames the checks draw, scene seconds: the ridge at 70 px (a drawing's own value) and at 50 (where it turns),
 * 60 between them, and the sweep's end, 70 again; drawn in that order, so between and the end come after their keys.
 */
export const STAMP_GATE_IN_TIME_AT = { seventy: 0.6, fifty: 1, between: 0.8, end: 2 } as const;

/** The keys the sweep's plan is held to, at 30 fps: each moment, the ridge's top it draws, and why. */
export const STAMP_GATE_IN_TIME_KEYS: readonly { readonly at: number; readonly ridgeTopPx: number; readonly reason: ShotKeyReason }[] = [
  { at: 0, ridgeTopPx: 100, reason: 'first' }, { at: 0.5, ridgeTopPx: 75, reason: 'between' }, { at: 19 / 30, ridgeTopPx: 70, reason: 'between' },
  { at: 1, ridgeTopPx: 50, reason: 'turn' }, { at: 2, ridgeTopPx: 70, reason: 'last' },
];

/** The ridge swept on one plane under a still camera; `warm`, a span solved before any frame. */
export function stampGateInTimeShot({ warm }: { readonly warm?: StampGateShot['warm'] } = {}): StampGateShot {
  return {
    camera: { stage: stampStage(RIDGE_FRAME, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [{
      id: 'ridge', depth: 1,
      source: paintingInTime(STAMP_GATE_RIDGE, { values: { ridgeTopPx: RIDGE_SWEEP }, layers: ['sky', 'ridge'], drawings: STAMP_GATE_RIDGE_DRAWINGS }),
    }],
    ...(warm && { warm }),
  };
}
