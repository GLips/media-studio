// stamp-gate-rain.ts: the gate's rain (ENGINE test 5's still-camera rain, drawn through a PaintedShot): a street, a
// post nearer, and an instanced plane of drops falling between them and in front of the post, under a still camera
// focused on the street, its shutter open half a frame. A drop's key is one fall: it takes a new key each time it
// starts again at the top. A lone drop over the street measures its own blur. Its documents are one painting's layers.

import type { PaintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import type { LayerNode, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedShotProps, PlaneInstance } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';

const { yellowOchre, burntUmber, ultramarine, cerulean } = WATERCOLOUR_PIGMENTS;

/** The rain's frame, px, and its stage's margin: room for the post's defocus past the frame's foot. */
const RAIN_FRAME = { width: 160, height: 120 } as const;
const RAIN_MARGIN = 16;

/** Where the drop's paint lies in the painting, document px: a short streak in its top left corner, its centre `at`. */
const DROP = { from: { x: 6, y: 4 }, to: { x: 6, y: 20 }, at: { x: 6, y: 12 }, diameterPx: 4 } as const;

const drop: LayerNode = {
  key: 'drop', washes: [{
    key: 'drop-wash', applications: [{
      key: 'drop-streak', kind: 'stroke', subpaths: [[DROP.from, DROP.to]], brush: { style: 'gate', brush: 'round' }, diameterPx: DROP.diameterPx, seed: 'drop',
      charge: { kind: 'paint', mix: { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: cerulean, amount: 1 }], strength: 0.75 }, water: 0.6 },
    }],
  }],
};

/** The rain's painting: a `wall` over a `road`, a `post`, and a `drop`, each a plane's or the rain's own selection. */
export const STAMP_GATE_RAIN_PAINTING: PaintingSourceModule = {
  default: function gateRain(): PaintingDocument {
    const { width, height } = RAIN_FRAME;
    return {
      widthPx: width, heightPx: height, paper: stampGateHeronPaper('#efece4', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('wall', stampGateHeronPolygon(0, 0, width, 0, width, 84, 0, 84), { parts: [{ pigment: yellowOchre, amount: 1 }], strength: 0.35 }, 0.8),
        stampGateHeronLayer('road', stampGateHeronPolygon(0, 84, width, 84, width, height, 0, height), { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.45 }, 0.8),
        stampGateHeronLayer('post', stampGateHeronPolygon(108, 6, 118, 6, 118, height, 108, height), { parts: [{ pigment: burntUmber, amount: 1 }, { pigment: ultramarine, amount: 1 }], strength: 0.75 }, 0.7),
        drop,
      ],
    };
  },
};

/**
 * The rain: each drop's column (frame px), the share of its fall it starts at, and its depth; how fast a drop at
 * depth 1.5 falls (px a second, nearer faster as it's larger); the fall, from above the frame to below it; the
 * shutter; and the scene seconds the gate draws, a frame apart.
 */
export const STAMP_GATE_RAIN = {
  drops: [
    [8, 0.1, 1.2], [19, 0.62, 2.2], [30, 0.33, 1.5], [41, 0.85, 2.4], [52, 0.2, 1.3], [63, 0.71, 1.9], [74, 0.47, 2.3],
    [85, 0.05, 1.4], [96, 0.58, 2], [107, 0.92, 1.25], [118, 0.39, 2.1], [129, 0.66, 1.7], [140, 0.14, 2.45], [151, 0.8, 1.35],
  ],
  speed: 480,
  fall: { from: -16, to: 136 },
  shutter: 0.5 / 24,
  at: { first: 1 + 0.5 / 24, next: 1 + 1.5 / 24 },
} as const;

/** The post's depth, the rain's depths about it, and the street's: the farther drops fall behind the post, the nearer in front. */
export const STAMP_GATE_RAIN_DEPTHS = { street: 3, post: 1.6, rain: { near: 1.1, far: 2.5 } } as const;

/** A drop of the painting's laid with its centre at `x`, `y` frame px, scaled 1.5 / its depth, as a nearer drop looks larger. */
const dropAt = (key: string, x: number, y: number, depth: number): PlaneInstance => ({
  key, variant: 'drop', depth, lay: { placement: { x: x - DROP.at.x, y: y - DROP.at.y, rotation: 0, scale: 1.5 / depth }, pivot: DROP.at },
});

/** The rain at scene second `at`: each drop where its fall has it, keyed by its column and which fall it's in. */
export function stampGateRainAt(at: number): PlaneInstance[] {
  const { drops, speed, fall } = STAMP_GATE_RAIN, span = fall.to - fall.from;
  return drops.map(([x, start, depth], i) => {
    const fallen = start * span + speed * (1.5 / depth) * at, which = Math.floor(fallen / span);
    return dropAt(`drop-${i}-${which}`, x, fall.from + fallen - which * span, depth);
  });
}

/** The camera focused on the street, its aperture `aperture`. */
const focusOnStreet = (aperture: number): PaintCameraPlay => ({
  clip: { kind: 'focus', keys: [{ at: 0, focus: STAMP_GATE_RAIN_DEPTHS.street, aperture }] }, clock: { at: 0 }, origin: 'the camera focuses on the street',
});

/** A shot of the street and `rain`, still, its shutter open `shutter` s; `post` puts the post between the rain's depths. */
function streetShot(rain: (at: number) => readonly PlaneInstance[], { shutter, post, plays }: { shutter: number; post: boolean; plays: readonly PaintCameraPlay[] }): PaintedShotProps {
  const evaluation = painting(STAMP_GATE_RAIN_PAINTING);
  return {
    camera: { stage: stampStage(RAIN_FRAME, RAIN_MARGIN), fov: 35, lens: { bloom: 0, shutter }, plays },
    planes: [
      { id: 'street', depth: STAMP_GATE_RAIN_DEPTHS.street, source: layersOf(evaluation, ['wall', 'road']) },
      ...(post ? [{ id: 'post', depth: STAMP_GATE_RAIN_DEPTHS.post, source: layersOf(evaluation, ['post']) }] : []),
      { kind: 'instanced', id: 'rain', depths: STAMP_GATE_RAIN_DEPTHS.rain, variants: { drop: layersOf(evaluation, ['drop']) }, instances: ({ at }) => rain(at) },
    ],
  };
}

/** The rain falling over the street, past the post, focused on the street. */
export const stampGateRainShot = (): PaintedShotProps => streetShot(stampGateRainAt, { shutter: STAMP_GATE_RAIN.shutter, post: true, plays: [focusOnStreet(1.5)] });

/** Where the lone drop is at scene second `at`: falling at depth 1.5 down column 60, at 60 px at STAMP_GATE_LONE_DROP_AT. */
export const STAMP_GATE_LONE_DROP_AT = 0.125;
const loneDropY = (at: number) => 60 + STAMP_GATE_RAIN.speed * (at - STAMP_GATE_LONE_DROP_AT);

/**
 * The lone drop's shots: `none` draws no drop; `sharp` the drop, shutter shut; `defocused` shut, focused on the street,
 * its blur reaching past its document's top; `blurred` shutter open, one key for its fall; `recycled` open, keyed anew
 * each millisecond, so no key spans the shutter.
 */
export function stampGateLoneDropShot(kind: 'none' | 'sharp' | 'defocused' | 'blurred' | 'recycled'): PaintedShotProps {
  const rain = (at: number) => (kind === 'none' ? [] : [dropAt(kind === 'recycled' ? `drop-${Math.round(at * 1000)}` : 'drop', 60, loneDropY(at), 1.5)]);
  const shut = kind === 'sharp' || kind === 'defocused';
  return streetShot(rain, { shutter: shut ? 0 : STAMP_GATE_RAIN.shutter, post: false, plays: kind === 'defocused' ? [focusOnStreet(3)] : [] });
}

/** How far the lone drop falls while the shutter's open, frame px. */
export const STAMP_GATE_LONE_DROP_TRAVEL = STAMP_GATE_RAIN.speed * STAMP_GATE_RAIN.shutter;
